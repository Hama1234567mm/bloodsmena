import ms from 'ms';
import { EmbedBuilder } from 'discord.js';
import { getDiscordClient, resolveGuild, fetchMember, ensureLogChannel, buildEmbedFromSettings, permissionsNeeded } from '../bot/client.js';
import { GuildSettings } from '../models/GuildSettings.js';
import { PunishmentLog } from '../models/PunishmentLog.js';

const WARN_THRESHOLD = 3;
const AUTO_TIMEOUT_DURATION = ms('1h');

export function roleAllowsPunishments(role) {
	return ['owner', 'co-owner', 'admin'].includes(role);
}

export function roleAllowsEmbedSettings(role) {
	return ['owner', 'co-owner'].includes(role);
}

export async function getOrCreateSettings(guildId) {
	let settings = await GuildSettings.findOne({ guildId });
	if (!settings) {
		settings = await GuildSettings.create({ guildId });
	}
	// Ensure punishmentsEnabled is set (default to true)
	if (settings.punishmentsEnabled === undefined || settings.punishmentsEnabled === null) {
		settings.punishmentsEnabled = true;
		await settings.save();
	}
	// Initialize default fields if they don't exist
	if (!settings.dmEmbed || !settings.dmEmbed.fields || settings.dmEmbed.fields.length === 0) {
		if (!settings.dmEmbed) {
			settings.dmEmbed = {};
		}
		settings.dmEmbed.fields = [
			{
				name: '📋 Action Type',
				value: '**<action>**',
				inline: true
			},
			{
				name: '👤 Moderator',
				value: '<actor>',
				inline: true
			},
			{
				name: '📝 Reason',
				value: '<reason>',
				inline: false
			}
		];
		await settings.save();
	}
	return settings;
}

export async function updateLogSettings({ guildId, logChannelId, dmEmbed, performedBy, enabled }) {
	const settings = await getOrCreateSettings(guildId);
	if (logChannelId !== undefined) {
		settings.logChannelId = logChannelId || '';
	}
	if (typeof enabled === 'boolean') {
		settings.punishmentsEnabled = enabled;
	}
	if (dmEmbed) {
		settings.dmEmbed = dmEmbed;
	}
	if (performedBy) {
		settings.updatedBy = performedBy.username;
		settings.updatedByRole = performedBy.role;
	}
	await settings.save();
	return settings;
}

export async function performPunishment({ guildId, actor, targetUserId, reason, action, duration, force }) {
	if (!roleAllowsPunishments(actor.role)) {
		throw new Error('Insufficient role');
	}
	const client = await getDiscordClient();
	if (!client) {
		throw new Error('Bot not ready');
	}
	const guild = await resolveGuild(client, guildId);
	if (!guild) {
		throw new Error('Guild not found');
	}
	const member = await fetchMember(guild, targetUserId);
	if (!member) {
		throw new Error('Member not found');
	}
	// Fetch bot member once for all checks
	const botMember = await guild.members.fetch(client.user.id);
	
	// Check permissions
	const perms = permissionsNeeded(action);
	if (perms.length) {
		const hasPerms = perms.every((perm) => botMember.permissions.has(perm));
		if (!hasPerms) {
			throw new Error(`Bot lacks required permissions: ${perms.map(p => p.replace('_', ' ')).join(', ')}`);
		}
	}
	
	// Check role hierarchy - bot's highest role must be above target member's highest role
	const botRoles = botMember.roles.cache.filter(role => role.id !== guild.id); // Exclude @everyone
	const botHighestRole = botRoles.size > 0 ? botRoles.reduce((prev, curr) => (prev.position > curr.position ? prev : curr)) : null;
	const targetRoles = member.roles.cache.filter(role => role.id !== guild.id);
	const targetHighestRole = targetRoles.size > 0 ? targetRoles.reduce((prev, curr) => (prev.position > curr.position ? prev : curr)) : null;
	
	if (botHighestRole && targetHighestRole) {
		if (botHighestRole.position <= targetHighestRole.position) {
			throw new Error(`Bot role (${botHighestRole.name}) must be higher than target's role (${targetHighestRole.name})`);
		}
	} else if (!botHighestRole) {
		throw new Error('Bot has no roles assigned. Please assign a role to the bot.');
	}
	const settings = await getOrCreateSettings(guildId);
	// Check if system is disabled (explicitly false, not undefined/null)
	if (settings.punishmentsEnabled === false && !force) {
		if (actor.role !== 'owner' && actor.role !== 'co-owner') {
			throw new Error('Punish system off');
		}
		throw new Error('Punishments are currently disabled.');
	}
	const placeholders = {
		reason: reason || 'No reason provided',
		duration: duration ? ms(duration, { long: true }) : 'N/A',
		servername: guild.name,
		user: `<@${targetUserId}>`,
		actor: actor.username || 'System'
	};

	const embed = buildEmbedFromSettings(settings, placeholders, action);
	const actionResult = { warnCount: 0 };
	
	switch (action) {
		case 'warn':
			await handleWarn({ member, reason, guildId, actor, embed, settings, actionResult });
			// DM is sent in handleWarn
			break;
		case 'timeout':
			// Send DM before timeout
			try {
				await member.send({ embeds: [embed] }).catch(() => null);
			} catch (err) {
				console.warn('Failed to send timeout DM:', err.message);
			}
			try {
				await member.timeout(duration || AUTO_TIMEOUT_DURATION, reason);
			} catch (err) {
				if (err.code === 50013 || err.message?.includes('Missing Permissions') || err.message?.includes('permission')) {
					throw new Error(`Cannot timeout user: Bot lacks permissions or bot's role is too low. Make sure the bot's role is above the target user's role.`);
				}
				throw err;
			}
			break;
		case 'ban':
			// Try to send DM before ban (user might still be in server)
			try {
				await member.send({ embeds: [embed] }).catch(() => null);
			} catch (err) {
				console.warn('Failed to send ban DM:', err.message);
			}
			try {
				await member.ban({ reason, deleteMessageSeconds: 0 });
			} catch (err) {
				if (err.code === 50013 || err.message?.includes('Missing Permissions') || err.message?.includes('permission')) {
					throw new Error(`Cannot ban user: Bot lacks permissions or bot's role is too low.`);
				}
				throw err;
			}
			break;
		case 'kick':
			// Send DM before kick
			try {
				await member.send({ embeds: [embed] }).catch(() => null);
			} catch (err) {
				console.warn('Failed to send kick DM:', err.message);
			}
			try {
				await member.kick(reason);
			} catch (err) {
				if (err.code === 50013 || err.message?.includes('Missing Permissions') || err.message?.includes('permission')) {
					throw new Error(`Cannot kick user: Bot lacks permissions or bot's role is too low.`);
				}
				throw err;
			}
			break;
		case 'voice_mute':
			// Send DM before voice mute
			try {
				await member.send({ embeds: [embed] }).catch(() => null);
			} catch (err) {
				console.warn('Failed to send voice mute DM:', err.message);
			}
			try {
				if (!member.voice?.channel) {
					throw new Error('User is not in a voice channel');
				}
				await member.voice.setMute(true, reason);
			} catch (err) {
				if (err.code === 50013 || err.message?.includes('Missing Permissions') || err.message?.includes('permission')) {
					throw new Error(`Cannot mute user: Bot lacks permissions or bot's role is too low.`);
				}
				throw err;
			}
			break;
		case 'voice_deafen':
			// Send DM before voice deafen
			try {
				await member.send({ embeds: [embed] }).catch(() => null);
			} catch (err) {
				console.warn('Failed to send voice deafen DM:', err.message);
			}
			try {
				if (!member.voice?.channel) {
					throw new Error('User is not in a voice channel');
				}
				await member.voice.setDeaf(true, reason);
			} catch (err) {
				if (err.code === 50013 || err.message?.includes('Missing Permissions') || err.message?.includes('permission')) {
					throw new Error(`Cannot deafen user: Bot lacks permissions or bot's role is too low.`);
				}
				throw err;
			}
			break;
		default:
			throw new Error('Unknown action');
	}

	await logAction({
		guildId,
		targetUserId,
		targetTag: member.user.tag,
		action,
		reason,
		duration,
		warnCount: actionResult.warnCount,
		actor
	});

	if (settings.logChannelId) {
		const channel = await ensureLogChannel(guild, settings.logChannelId);
		if (channel?.isTextBased()) {
			// Create a separate log embed with more details
			const actionColors = {
				warn: 0xffa500,
				timeout: 0xff6b6b,
				ban: 0xdc3545,
				kick: 0xffc107,
				voice_mute: 0x6c757d,
				voice_deafen: 0x495057
			};
			const logEmbed = new EmbedBuilder()
				.setTitle(`🔨 Moderation Action: ${action.toUpperCase()}`)
				.setDescription(`**Target:** ${member.user.tag} (${member.id})\n**Action:** ${action}\n**Reason:** ${reason || 'No reason provided'}`)
				.setColor(actionColors[action] || settings?.dmEmbed?.color || 0xff3b3b)
				.addFields(
					{ name: '👤 Moderator', value: `${actor.username} (${actor.role})`, inline: true },
					{ name: '🕐 Time', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true }
				)
				.setTimestamp()
				.setFooter({ text: `Case ID: ${Date.now()}` });
			
			if (duration && duration > 0) {
				logEmbed.addFields({ name: '⏱️ Duration', value: ms(duration, { long: true }), inline: true });
			}
			
			if (actionResult.warnCount > 0) {
				logEmbed.addFields({ name: '⚠️ Warning Count', value: `${actionResult.warnCount}`, inline: true });
			}
			
			await channel.send({ embeds: [logEmbed] }).catch(() => null);
		}
	}

	return actionResult;
}

async function handleWarn({ member, reason, guildId, actor, embed, settings, actionResult }) {
	const warnings = await PunishmentLog.countDocuments({
		guildId,
		targetUserId: member.id,
		action: 'warn'
	});
	const newCount = warnings + 1;
	actionResult.warnCount = newCount;
	
	// Update embed footer with warning count
	embed.setFooter({
		text: `Warning ${newCount}/${WARN_THRESHOLD} • Moderator: ${actor.username}`
	});
	
	// Send warning DM
	try {
		await member.send({ embeds: [embed] }).catch(() => null);
	} catch (err) {
		console.warn('Failed to send warning DM:', err.message);
	}

	if (newCount >= WARN_THRESHOLD) {
		try {
			await member.timeout(AUTO_TIMEOUT_DURATION, `Auto timeout: ${newCount} warnings`);
			
			// Send timeout notification
			try {
				const timeoutEmbed = buildEmbedFromSettings(settings, {
					reason: 'Auto timeout after 3 warnings',
					duration: ms(AUTO_TIMEOUT_DURATION, { long: true }),
					servername: member.guild.name,
					user: `<@${member.id}>`,
					actor: 'System'
				}, 'timeout');
				await member.send({ embeds: [timeoutEmbed] }).catch(() => null);
			} catch (err) {
				console.warn('Failed to send timeout DM:', err.message);
			}
			
			await logAction({
				guildId,
				targetUserId: member.id,
				targetTag: member.user.tag,
				action: 'timeout',
				reason: 'Auto timeout after 3 warnings',
				duration: AUTO_TIMEOUT_DURATION,
				actor,
				warnCount: newCount
			});
		} catch (err) {
			if (err.code === 50013 || err.message?.includes('Missing Permissions') || err.message?.includes('permission')) {
				throw new Error(`Cannot timeout user: Bot lacks permissions or bot's role is too low. Make sure the bot's role is above the target user's role.`);
			}
			throw err;
		}
	}
}

async function logAction({ guildId, targetUserId, targetTag, action, reason, duration, warnCount, actor }) {
	await PunishmentLog.create({
		guildId,
		targetUserId,
		targetTag,
		action,
		reason,
		durationMs: duration || 0,
		warnCount: warnCount || 0,
		performedById: actor.id,
		performedByName: actor.username,
		performedByRole: actor.role
	});
}


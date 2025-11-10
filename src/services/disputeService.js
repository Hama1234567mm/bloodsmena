import { Dispute } from '../models/Dispute.js';
import { getDiscordClient, resolveGuild, fetchMember } from '../bot/client.js';
import { getOrCreateSettings } from './punishmentService.js';
import { EmbedBuilder } from 'discord.js';

export async function createDispute({ guildId, user1Id, user2Id, createdBy, createdByRole }) {
	const client = await getDiscordClient();
	if (!client) throw new Error('Bot not ready');
	
	const guild = await resolveGuild(client, guildId);
	if (!guild) throw new Error('Guild not found');
	
	// Fetch user names
	const user1 = await fetchMember(guild, user1Id);
	const user2 = await fetchMember(guild, user2Id);
	
	if (!user1 || !user2) {
		throw new Error('One or both users not found in server');
	}
	
	// Check if dispute already exists
	const existing = await Dispute.findOne({
		guildId,
		active: true,
		$or: [
			{ user1Id, user2Id },
			{ user1Id: user2Id, user2Id: user1Id }
		]
	});
	
	if (existing) {
		throw new Error('Dispute already exists between these users');
	}
	
	const dispute = await Dispute.create({
		guildId,
		user1Id,
		user1Name: user1.user.globalName || user1.user.username,
		user2Id,
		user2Name: user2.user.globalName || user2.user.username,
		createdBy,
		createdByRole
	});
	
	return dispute;
}

export async function getActiveDisputes(guildId) {
	return Dispute.find({ guildId, active: true }).sort({ createdAt: -1 });
}

export async function deleteDispute(disputeId) {
	const dispute = await Dispute.findByIdAndDelete(disputeId);
	return dispute;
}

export async function deleteAllDisputes(guildId) {
	const result = await Dispute.deleteMany({ guildId });
	return result;
}

export async function handleVoiceStateUpdate(oldState, newState) {
	// Only process when user joins a channel (not leaves or moves)
	if (!newState.member || !newState.channel || oldState.channel?.id === newState.channel.id) {
		return;
	}
	
	const guildId = newState.guild.id;
	const userId = newState.member.id;
	
	// Check if dispute system is enabled
	const settings = await getOrCreateSettings(guildId);
	if (settings.disputesEnabled === false) {
		return; // Dispute system is disabled
	}
	
	// Get all active disputes involving this user
	const disputes = await Dispute.find({
		guildId,
		active: true,
		$or: [{ user1Id: userId }, { user2Id: userId }]
	});
	
	if (disputes.length === 0) return;
	
	// Check if the other user in any dispute is in the same channel
	for (const dispute of disputes) {
		const otherUserId = dispute.user1Id === userId ? dispute.user2Id : dispute.user1Id;
		const otherMember = await newState.guild.members.fetch(otherUserId).catch(() => null);
		
		if (otherMember && otherMember.voice?.channel?.id === newState.channel.id) {
			// Disconnect the user who just joined
			try {
				await newState.member.voice.disconnect('Disputed users cannot be in the same voice channel');
				
				// Send DM
				const embed = buildDisputeEmbed(settings, {
					dispute: `Dispute between ${dispute.user1Name} and ${dispute.user2Name}`,
					user: `<@${userId}>`,
					server: newState.guild.name
				});
				
				await newState.member.send({ embeds: [embed] }).catch(() => null);
				
				// Log to channel if configured
				if (settings.disputeLogChannelId) {
					try {
						const logChannel = await newState.guild.channels.fetch(settings.disputeLogChannelId).catch(() => null);
						if (logChannel && logChannel.isTextBased()) {
							const logEmbed = new EmbedBuilder()
								.setTitle('⚠️ Dispute Disconnect')
								.setDescription(`User <@${userId}> was disconnected from ${newState.channel.name} due to an active dispute with <@${otherUserId}>`)
								.addFields(
									{ name: 'Dispute', value: `${dispute.user1Name} ↔ ${dispute.user2Name}`, inline: true },
									{ name: 'Channel', value: newState.channel.toString(), inline: true },
									{ name: 'Disconnect Count', value: String((dispute.disconnectCount || 0) + 1), inline: true }
								)
								.setColor(0xff6b6b)
								.setTimestamp();
							await logChannel.send({ embeds: [logEmbed] }).catch(() => null);
						}
					} catch (err) {
						console.warn('Failed to log dispute disconnect:', err);
					}
				}
				
				// Update disconnect count
				dispute.disconnectCount += 1;
				await dispute.save();
			} catch (err) {
				console.error('Failed to disconnect disputed user:', err);
			}
		}
	}
}

function buildDisputeEmbed(settings, placeholders) {
	const embed = new EmbedBuilder();
	const disputeEmbed = settings?.disputeEmbed || {};
	
	const replace = (str) => {
		if (!str) return '';
		return Object.entries(placeholders || {}).reduce((acc, [key, val]) => {
			return acc.replaceAll(`<${key}>`, val ?? '');
		}, str);
	};
	
	const title = replace(disputeEmbed?.title) || 'Dispute Notice';
	const description = replace(disputeEmbed?.description) || 'You have been disconnected due to an active dispute.';
	
	embed.setTitle(title);
	embed.setDescription(description);
	embed.setColor(disputeEmbed?.color ?? 0xff6b6b);
	embed.setTimestamp(new Date());
	
	if (disputeEmbed?.fields && disputeEmbed.fields.length > 0) {
		disputeEmbed.fields.forEach((field) => {
			const fieldName = replace(field.name);
			const fieldValue = replace(field.value);
			if (fieldName && fieldValue) {
				embed.addFields({
					name: fieldName,
					value: fieldValue,
					inline: !!field.inline
				});
			}
		});
	} else {
		// Default fields
		embed.addFields(
			{
				name: '⚠️ Dispute Active',
				value: replace(placeholders.dispute || 'Active dispute'),
				inline: false
			},
			{
				name: '📋 Server',
				value: placeholders.server || 'Unknown',
				inline: true
			}
		);
	}
	
	return embed;
}


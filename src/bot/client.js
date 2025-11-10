import { Client, GatewayIntentBits, Partials, PermissionsBitField, EmbedBuilder } from 'discord.js';
import dotenv from 'dotenv';

dotenv.config();

let clientPromise;

const requiredIntents = [
	GatewayIntentBits.Guilds,
	GatewayIntentBits.GuildMembers,
	GatewayIntentBits.GuildMessages,
	GatewayIntentBits.GuildVoiceStates,
	GatewayIntentBits.DirectMessages,
	GatewayIntentBits.MessageContent
];

const partials = [Partials.Channel, Partials.GuildMember, Partials.User, Partials.Message];

export function getDiscordClient() {
	if (!process.env.BOT_TOKEN) {
		console.warn('BOT_TOKEN missing. Discord bot features disabled.');
		return null;
	}
	if (!clientPromise) {
		const client = new Client({ intents: requiredIntents, partials });
		clientPromise = client
			.login(process.env.BOT_TOKEN)
		.then(async () => {
			console.log('Discord bot logged in as', client.user?.tag);
			// Set bot start time for uptime calculation
			try {
				const { setBotStartTime } = await import('../services/botStatsService.js');
				setBotStartTime();
			} catch (err) {
				console.warn('Failed to set bot start time:', err);
			}
			
			// Wait for bot to be ready
			client.once('ready', () => {
				console.log('Bot is ready!');
			});
			
			// Set up voice state update listener for disputes
			client.on('voiceStateUpdate', async (oldState, newState) => {
				try {
					const { handleVoiceStateUpdate } = await import('../services/disputeService.js');
					await handleVoiceStateUpdate(oldState, newState);
				} catch (err) {
					console.error('Error handling voice state update:', err);
				}
				
				// Handle verify voice joins
				try {
					const { handleVerifyVoiceJoin, handleVerifyVoiceLeave } = await import('../services/verifyService.js');
					await handleVerifyVoiceJoin(oldState, newState);
					await handleVerifyVoiceLeave(oldState, newState);
				} catch (err) {
					console.error('Error handling verify voice state update:', err);
				}
			});
			
			// Set up button interaction listener for verify
			client.on('interactionCreate', async (interaction) => {
				if (interaction.isButton()) {
					try {
						const { handleVerifyButton } = await import('../services/verifyService.js');
						await handleVerifyButton(interaction);
					} catch (err) {
						console.error('Error handling verify button:', err);
					}
				}
			});
			
			return client;
		})
			.catch((err) => {
				console.error('Failed to login Discord bot:', err);
				throw err;
			});
	}
	return clientPromise;
}

export async function resolveGuild(client, guildId) {
	if (!client || !guildId) return null;
	const guild = await client.guilds.fetch(guildId).catch(() => null);
	return guild;
}

export async function fetchMember(guild, userId) {
	if (!guild || !userId) return null;
	return guild.members.fetch(userId).catch(() => null);
}

export async function ensurePermissions(member, permissions) {
	if (!member) return false;
	const perms = member.permissions;
	return permissions.every((perm) => perms.has(perm));
}

export async function ensureLogChannel(guild, channelId) {
	if (!guild || !channelId) return null;
	return guild.channels.fetch(channelId).catch(() => null);
}

export function buildEmbedFromSettings(settings, placeholders, action = 'warn') {
	const embed = new EmbedBuilder();
	const dmEmbed = settings?.dmEmbed;

	// Action-based color mapping
	const actionColors = {
		warn: 0xffa500,      // Orange
		timeout: 0xff6b6b,   // Red
		ban: 0xdc3545,       // Dark red
		kick: 0xffc107,      // Amber
		voice_mute: 0x6c757d, // Gray
		voice_deafen: 0x495057 // Dark gray
	};

	const actionEmojis = {
		warn: '⚠️',
		timeout: '⏰',
		ban: '🔨',
		kick: '👢',
		voice_mute: '🔇',
		voice_deafen: '🔕'
	};

	const actionNames = {
		warn: 'Warning',
		timeout: 'Timeout',
		ban: 'Ban',
		kick: 'Kick',
		voice_mute: 'Voice Mute',
		voice_deafen: 'Voice Deafen'
	};

	const replace = (str) => {
		if (!str) return '';
		let result = str;
		// Replace all placeholders including action
		if (placeholders) {
			Object.entries(placeholders).forEach(([key, val]) => {
				result = result.replaceAll(`<${key}>`, val ?? '');
			});
		}
		// Replace action placeholder
		const actionPlaceholder = actionNames[action] || action.toUpperCase();
		result = result.replaceAll('<action>', actionPlaceholder);
		return result;
	};

	const title = replace(dmEmbed?.title) || `${actionEmojis[action] || '⚙️'} Moderation Notice`;
	const description = replace(dmEmbed?.description) || `You have received a **${actionNames[action] || action}** in the server.`;
	
	embed.setTitle(title);
	embed.setDescription(description);
	embed.setColor(dmEmbed?.color ?? actionColors[action] ?? 0xff3b3b);
	embed.setTimestamp(new Date());
	embed.setFooter({ 
		text: `${actionNames[action] || 'Action'} • ${placeholders?.servername || 'Server'}`
	});

	// Add action placeholder for field replacement
	const actionPlaceholder = actionNames[action] || action.toUpperCase();
	const allPlaceholders = {
		...placeholders,
		action: actionPlaceholder
	};

	// Always use fields from settings (they should be initialized with defaults)
	if (dmEmbed?.fields && dmEmbed.fields.length > 0) {
		dmEmbed.fields.forEach((field) => {
			const fieldName = replace(field.name);
			let fieldValue = replace(field.value);
			
			// Replace <action> placeholder
			fieldValue = fieldValue.replaceAll('<action>', actionPlaceholder);
			
			if (fieldName && fieldValue) {
				embed.addFields({
					name: fieldName,
					value: fieldValue,
					inline: !!field.inline
				});
			}
		});
	} else {
		// Fallback if somehow fields are missing
		embed.addFields(
			{
				name: '📋 Action Type',
				value: `**${actionPlaceholder}**`,
				inline: true
			},
			{
				name: '👤 Moderator',
				value: placeholders?.actor || 'System',
				inline: true
			},
			{
				name: '📝 Reason',
				value: placeholders?.reason || 'No reason provided',
				inline: false
			}
		);
	}

	// Add duration field if duration exists and not already in custom fields
	if (placeholders?.duration && placeholders.duration !== 'N/A') {
		const hasDurationField = dmEmbed?.fields?.some(f => 
			replace(f.name).toLowerCase().includes('duration') || 
			replace(f.value).includes('<duration>')
		);
		if (!hasDurationField) {
			embed.addFields({
				name: '⏱️ Duration',
				value: placeholders.duration,
				inline: true
			});
		}
	}

	// Add thumbnail for visual appeal (optional)
	// embed.setThumbnail('https://your-server-icon-url.png');

	return embed;
}

export function permissionsNeeded(action) {
	switch (action) {
		case 'ban':
			return [PermissionsBitField.Flags.BanMembers];
		case 'kick':
			return [PermissionsBitField.Flags.KickMembers];
		case 'warn':
			return [PermissionsBitField.Flags.ModerateMembers];
		case 'timeout':
			return [PermissionsBitField.Flags.ModerateMembers];
		case 'voice_mute':
		case 'voice_deafen':
			return [PermissionsBitField.Flags.MuteMembers];
		default:
			return [];
	}
}


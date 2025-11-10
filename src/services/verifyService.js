import { getDiscordClient, resolveGuild, fetchMember } from '../bot/client.js';
import { getOrCreateSettings } from './punishmentService.js';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField } from 'discord.js';

// Store active verification requests: messageId -> { userId, channelId, adminId, voiceChannelId }
const activeVerifications = new Map();

export async function handleVerifyVoiceJoin(oldState, newState) {
	// Only process when user joins a channel (not leaves or moves)
	if (!newState.member || !newState.channel || oldState.channel?.id === newState.channel.id) {
		return;
	}
	
	const guildId = newState.guild.id;
	const userId = newState.member.id;
	
	// Check if verify system is enabled
	const settings = await getOrCreateSettings(guildId);
	if (settings.verifyEnabled === false) {
		return;
	}
	
	// Check if user joined the verify channel
	if (newState.channel.id !== settings.verifyChannelId) {
		return;
	}
	
	// Check if log channel is configured
	if (!settings.verifyLogChannelId) {
		return;
	}
	
	const client = await getDiscordClient();
	if (!client) return;
	
	const guild = await resolveGuild(client, guildId);
	if (!guild) return;
	
	const logChannel = await guild.channels.fetch(settings.verifyLogChannelId).catch(() => null);
	if (!logChannel || !logChannel.isTextBased()) {
		return;
	}
	
	// Build verification embed
	const embed = buildVerifyEmbed(settings, {
		user: `<@${userId}>`,
		channel: newState.channel.name,
		admin: ''
	});
	
	// Create claim button
	const claimButton = new ButtonBuilder()
		.setCustomId(`verify_claim_${userId}`)
		.setLabel('Claim')
		.setStyle(ButtonStyle.Primary)
		.setEmoji('✅');
	
	const row = new ActionRowBuilder().addComponents(claimButton);
	
	// Send verification request
	const message = await logChannel.send({
		embeds: [embed],
		components: [row]
	}).catch(() => null);
	
	if (message) {
		activeVerifications.set(message.id, {
			userId,
			channelId: newState.channel.id,
			adminId: null,
			voiceChannelId: null,
			messageId: message.id
		});
	}
}

export async function handleVerifyButton(interaction) {
	if (!interaction.isButton()) return;
	
	const customId = interaction.customId;
	
	// Handle claim button
	if (customId.startsWith('verify_claim_')) {
		const userId = customId.replace('verify_claim_', '');
		const verification = Array.from(activeVerifications.values()).find(v => v.userId === userId);
		
		if (!verification) {
			await interaction.reply({ content: 'This verification request has expired.', ephemeral: true });
			return;
		}
		
		// Check if admin is in a voice channel
		const adminMember = interaction.member;
		if (!adminMember.voice?.channel) {
			await interaction.reply({ content: 'You must be in a voice channel to claim this verification.', ephemeral: true });
			return;
		}
		
		// Check if admin has admin role
		const settings = await getOrCreateSettings(interaction.guild.id);
		const adminRoleIds = settings.verifyAdminRoleIds?.split(',').map(id => id.trim()).filter(Boolean) || [];
		const hasAdminRole = adminRoleIds.some(roleId => adminMember.roles.cache.has(roleId));
		
		if (!hasAdminRole) {
			await interaction.reply({ content: 'You do not have permission to claim verifications.', ephemeral: true });
			return;
		}
		
		// Update verification
		verification.adminId = adminMember.id;
		verification.voiceChannelId = adminMember.voice.channel.id;
		activeVerifications.set(verification.messageId, verification);
		
		// Create new voice channel in category
		if (!settings.verifyCategoryId) {
			await interaction.reply({ content: 'Category ID is not configured.', ephemeral: true });
			return;
		}
		
		const category = await interaction.guild.channels.fetch(settings.verifyCategoryId).catch(() => null);
		if (!category || category.type !== ChannelType.GuildCategory) {
			await interaction.reply({ content: 'Category not found.', ephemeral: true });
			return;
		}
		
		const userMember = await fetchMember(interaction.guild, userId);
		if (!userMember) {
			await interaction.reply({ content: 'User not found in server.', ephemeral: true });
			return;
		}
		
		// Create new voice channel
		const newChannel = await interaction.guild.channels.create({
			name: `verify-${userMember.user.username}`,
			type: ChannelType.GuildVoice,
			parent: category.id,
			permissionOverwrites: [
				{
					id: interaction.guild.id,
					deny: [PermissionsBitField.Flags.ViewChannel]
				},
				{
					id: userMember.id,
					allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect]
				},
				{
					id: adminMember.id,
					allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect]
				}
			]
		}).catch(() => null);
		
		if (!newChannel) {
			await interaction.reply({ content: 'Failed to create verification channel.', ephemeral: true });
			return;
		}
		
		// Move user and admin to new channel
		await userMember.voice.setChannel(newChannel.id).catch(() => null);
		await adminMember.voice.setChannel(newChannel.id).catch(() => null);
		
		// Update embed with claimed info and add gender buttons
		const updatedEmbed = buildVerifyEmbed(settings, {
			user: `<@${userId}>`,
			channel: interaction.channel.name,
			admin: `<@${adminMember.id}>`
		});
		
		updatedEmbed.setDescription(updatedEmbed.data.description + `\n\n**Claimed by:** <@${adminMember.id}>`);
		
		const girlButton = new ButtonBuilder()
			.setCustomId(`verify_girl_${userId}`)
			.setLabel('Girl')
			.setStyle(ButtonStyle.Success)
			.setEmoji('👩');
		
		const boyButton = new ButtonBuilder()
			.setCustomId(`verify_boy_${userId}`)
			.setLabel('Boy')
			.setStyle(ButtonStyle.Primary)
			.setEmoji('👨');
		
		const newRow = new ActionRowBuilder().addComponents(girlButton, boyButton);
		
		if (interaction.deferred || interaction.replied) {
			await interaction.editReply({
				embeds: [updatedEmbed],
				components: [newRow]
			});
		} else {
			await interaction.update({
				embeds: [updatedEmbed],
				components: [newRow]
			});
		}
		
		verification.voiceChannelId = newChannel.id;
		activeVerifications.set(verification.messageId, verification);
	}
	
	// Handle gender selection
	if (customId.startsWith('verify_girl_') || customId.startsWith('verify_boy_')) {
		const gender = customId.startsWith('verify_girl_') ? 'girl' : 'boy';
		const userId = customId.replace(`verify_${gender}_`, '');
		const verification = Array.from(activeVerifications.values()).find(v => v.userId === userId);
		
		if (!verification) {
			await interaction.reply({ content: 'This verification request has expired.', ephemeral: true });
			return;
		}
		
		const settings = await getOrCreateSettings(interaction.guild.id);
		const roleId = gender === 'girl' ? settings.verifyGirlRoleId : settings.verifyBoyRoleId;
		
		if (!roleId) {
			await interaction.reply({ content: `${gender === 'girl' ? 'Girl' : 'Boy'} role is not configured.`, ephemeral: true });
			return;
		}
		
		const userMember = await fetchMember(interaction.guild, userId);
		if (!userMember) {
			await interaction.reply({ content: 'User not found in server.', ephemeral: true });
			return;
		}
		
		// Give role
		await userMember.roles.add(roleId).catch(() => null);
		
		// Update embed and remove buttons
		const finalEmbed = buildVerifyEmbed(settings, {
			user: `<@${userId}>`,
			channel: interaction.channel.name,
			admin: `<@${verification.adminId}>`
		});
		
		finalEmbed.setDescription(finalEmbed.data.description + `\n\n**Claimed by:** <@${verification.adminId}>\n**Verified as:** ${gender === 'girl' ? '👩 Girl' : '👨 Boy'}`);
		finalEmbed.setColor(0x27c093); // Success green
		
		if (interaction.deferred || interaction.replied) {
			await interaction.editReply({
				embeds: [finalEmbed],
				components: []
			});
		} else {
			await interaction.update({
				embeds: [finalEmbed],
				components: []
			});
		}
		
		// Remove from active verifications
		activeVerifications.delete(verification.messageId);
	}
}

export async function handleVerifyVoiceLeave(oldState, newState) {
	// Check if user left a verification channel
	if (!oldState.channel || newState.channel) return;
	
	const settings = await getOrCreateSettings(oldState.guild.id);
	if (settings.verifyEnabled === false) return;
	
	// Find verification for this channel
	const verification = Array.from(activeVerifications.values()).find(
		v => v.voiceChannelId === oldState.channel.id
	);
	
	if (!verification) return;
	
	// Check if channel is empty
	const channel = oldState.channel;
	if (channel.members.size === 0) {
		// Delete channel
		await channel.delete().catch(() => null);
		
		// Remove from active verifications
		activeVerifications.delete(verification.messageId);
	}
}

function buildVerifyEmbed(settings, placeholders) {
	const embed = new EmbedBuilder();
	const verifyEmbed = settings?.verifyEmbed || {};
	
	const replace = (str) => {
		if (!str) return '';
		return Object.entries(placeholders || {}).reduce((acc, [key, val]) => {
			return acc.replaceAll(`<${key}>`, val ?? '');
		}, str);
	};
	
	const title = replace(verifyEmbed?.title) || 'Verification Request';
	const description = replace(verifyEmbed?.description) || '<user> wants to verify in <channel>.';
	
	embed.setTitle(title);
	embed.setDescription(description);
	embed.setColor(verifyEmbed?.color ?? 0x5b8cff);
	embed.setTimestamp(new Date());
	
	if (verifyEmbed?.fields && verifyEmbed.fields.length > 0) {
		verifyEmbed.fields.forEach((field) => {
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
	}
	
	return embed;
}


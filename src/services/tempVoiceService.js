import { ChannelType, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, UserSelectMenuBuilder, ComponentType, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { getOrCreateSettings } from './punishmentService.js';

// channelId -> {
//   ownerId, emoji, locked, trustedIds:Set<string>, blockedIds:Set<string>, originalNicks: Map<userId, originalNick>
// }
const tempVoiceState = new Map();

function ensureOriginalNick(state, member) {
	if (!state || !member) return;
	const current = member.nickname || member.user?.username || '';
	if (!state.originalNicks.has(member.id)) state.originalNicks.set(member.id, current);
}

function getBaseNick(state, member) {
	if (!state || !member) return member?.nickname || member?.user?.username || '';
	return state.originalNicks.get(member.id) || member.nickname || member.user?.username || '';
}

export async function handleTempVoiceJoin(oldState, newState) {
	if (!newState?.channel || oldState?.channel?.id === newState.channel.id) return;
	const settings = await getOrCreateSettings(newState.guild.id);
	if (settings.tempVoiceEnabled === false) return;
	if (!settings.tempVoiceHubChannelId || !settings.tempVoiceCategoryId) return;
	if (newState.channel.id !== settings.tempVoiceHubChannelId) return;

	const member = newState.member;
	if (!member) return;

	const emojis = (settings.tempVoiceEmojis || '🎧,🎵').split(',').map(e => e.trim()).filter(Boolean);
	const emoji = emojis[Math.floor(Math.random() * emojis.length)] || '🎧';
	const safeName = member.user.username.replace(/[^\w\- ]/g, '').slice(0, 20) || 'user';
	const channelName = `${emoji}・${safeName}`;

	const category = await newState.guild.channels.fetch(settings.tempVoiceCategoryId).catch(() => null);
	if (!category || category.type !== ChannelType.GuildCategory) return;

	const accessRoleIds = (settings.tempVoiceAccessRoleIds || '').split(',').map(id => id.trim()).filter(Boolean);

	const newChannel = await newState.guild.channels.create({
		name: channelName,
		type: ChannelType.GuildVoice,
		parent: category.id,
		permissionOverwrites: [
			// Hide from everyone by default
			{ id: newState.guild.id, deny: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect] },
			{ id: member.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.ManageChannels] },
			// Access roles can view/connect by default
			...accessRoleIds.map(rid => ({ id: rid, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect] }))
		]
	}).catch(() => null);
	if (!newChannel) return;

	tempVoiceState.set(newChannel.id, { ownerId: member.id, emoji, locked: false, trustedIds: new Set([member.id]), blockedIds: new Set(), originalNicks: new Map() });
	const state = tempVoiceState.get(newChannel.id);

	// Nickname prefix with emoji
	ensureOriginalNick(state, member);
	const baseNick = getBaseNick(state, member);
	await member.setNickname(`${emoji} ${baseNick}`.slice(0, 32)).catch(() => null);

	// Move owner into the new temp voice
	await member.voice.setChannel(newChannel.id).catch(() => null);

	// Post control panel inside the voice channel chat only
	const controlEmbed = buildControlEmbed(settings, member.id, newChannel.name);
	const rows = buildControlsRows(newChannel.id);
	await newChannel.send({ content: `<@${member.id}>`, embeds: [controlEmbed], components: rows }).catch(() => null);
}

export async function enforceTempVoiceJoin(oldState, newState) {
	if (!newState?.channel || oldState?.channel?.id === newState.channel.id) return;
	const state = tempVoiceState.get(newState.channel.id);
	if (!state) return;
	const settings = await getOrCreateSettings(newState.guild.id);
	if (settings.tempVoiceEnabled === false) return;

	const member = newState.member;
	if (!member) return;

	// Apply emoji-prefixed nickname (one-time store of original)
	ensureOriginalNick(state, member);
	const baseNick = getBaseNick(state, member);
	const desiredNick = `${state.emoji || '🎧'} ${baseNick}`.slice(0, 32);
	if ((member.nickname || member.user.username) !== desiredNick) {
		await member.setNickname(desiredNick).catch(() => null);
	}

	// Enforce lock/block for non-owner
	if (state.ownerId !== member.id) {
		if (state.blockedIds.has(member.id)) {
			await member.voice.disconnect().catch(() => null);
			await sendTempDm(settings, member, 'You are blocked from this voice channel.');
			return;
		}
		if (state.locked && !state.trustedIds.has(member.id)) {
			await member.voice.disconnect().catch(() => null);
			await sendTempDm(settings, member, 'This voice channel is locked.');
		}
	}
}

export async function handleTempVoiceLeave(oldState, newState) {
	try {
		if (!oldState?.channel || newState?.channel) return;
		const channel = oldState.channel;
		const state = channel ? tempVoiceState.get(channel.id) : null;
		if (!state) return;

		const leaving = oldState.member || null;
		if (leaving && state.originalNicks.has(leaving.id)) {
			const original = state.originalNicks.get(leaving.id);
			await leaving.setNickname(original).catch(() => null);
			state.originalNicks.delete(leaving.id);
		}

		if (channel && channel.members.size === 0) {
			await channel.delete().catch(() => null);
			tempVoiceState.delete(channel.id);
		}
	} catch {
		// swallow errors to avoid crashing the listener
	}
}

export async function handleTempVoiceButtons(interaction) {
	if (!interaction.isButton()) return;
	const [prefix, action, channelId] = interaction.customId.split('_');
	if (prefix !== 'tv') return;

	const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
	if (!channel) return interaction.reply({ content: 'Channel not found.', ephemeral: true }).catch(() => null);
	const state = tempVoiceState.get(channelId);
	if (!state) return interaction.reply({ content: 'Not a temp voice channel.', ephemeral: true }).catch(() => null);
	if (interaction.user.id !== state.ownerId) {
		return interaction.reply({ content: 'Only the owner can use these controls.', ephemeral: true }).catch(() => null);
	}

	if (action === 'lock') {
		await interaction.deferUpdate().catch(() => null);
		state.locked = true;
		// Revoke Connect from access roles while locked
		const settings = await getOrCreateSettings(interaction.guild.id);
		const accessRoleIds = (settings.tempVoiceAccessRoleIds || '').split(',').map(id => id.trim()).filter(Boolean);
		for (const rid of accessRoleIds) {
			await channel.permissionOverwrites.edit(rid, { Connect: false }).catch(() => null);
		}
		return interaction.editReply({}).catch(() => null);
	}
	if (action === 'unlock') {
		await interaction.deferUpdate().catch(() => null);
		state.locked = false;
		// Allow Connect for access roles when unlocked
		const settings = await getOrCreateSettings(interaction.guild.id);
		const accessRoleIds = (settings.tempVoiceAccessRoleIds || '').split(',').map(id => id.trim()).filter(Boolean);
		for (const rid of accessRoleIds) {
			await channel.permissionOverwrites.edit(rid, { Connect: true, ViewChannel: true }).catch(() => null);
		}
		return interaction.editReply({}).catch(() => null);
	}
	if (action === 'rename') {
		// Open modal to capture new base name
		const modal = new ModalBuilder()
			.setCustomId(`tv_rename_modal_${channelId}`)
			.setTitle('Rename Voice Channel');
		const input = new TextInputBuilder()
			.setCustomId('new_name')
			.setLabel('New base name (emoji is kept)')
			.setStyle(TextInputStyle.Short)
			.setRequired(true)
			.setMaxLength(20);
		const row = new ActionRowBuilder().addComponents(input);
		modal.addComponents(row);
		return interaction.showModal(modal).catch(() => null);
	}
	if (action === 'block' || action === 'trust' || action === 'kick') {
		const menu = new UserSelectMenuBuilder().setCustomId(`tv_sel_${action}_${channelId}`).setPlaceholder('Select a user').setMaxValues(1);
		const row = new ActionRowBuilder().addComponents(menu);
		return interaction.reply({ content: 'Choose a user:', components: [row], ephemeral: true }).catch(() => null);
	}
}

export async function handleTempVoiceSelect(interaction) {
	const isUserSelect = interaction.componentType === ComponentType.UserSelect || interaction.isUserSelectMenu?.();
	if (!isUserSelect) return;
	const parts = (interaction.customId || '').split('_');
	if (parts[0] !== 'tv' || parts[1] !== 'sel') return; // tv_sel_<op>_<channelId>
	const op = parts[2];
	const channelId = parts[3];

	const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
	if (!channel) return interaction.reply({ content: 'Channel not found.', ephemeral: true }).catch(() => null);
	const state = tempVoiceState.get(channelId);
	if (!state) return interaction.reply({ content: 'Not a temp voice channel.', ephemeral: true }).catch(() => null);
	if (interaction.user.id !== state.ownerId) {
		return interaction.reply({ content: 'Only the owner can use these controls.', ephemeral: true }).catch(() => null);
	}
	const targetId = interaction.values?.[0] || interaction.users?.first()?.id;
	if (!targetId) return interaction.reply({ content: 'No user selected.', ephemeral: true }).catch(() => null);

	if (op === 'block') {
		state.blockedIds.add(targetId);
		state.trustedIds.delete(targetId);
		await channel.permissionOverwrites.edit(targetId, { ViewChannel: false, Connect: false }).catch(() => null);
		return interaction.reply({ content: 'User blocked.', ephemeral: true }).catch(() => null);
	}
	if (op === 'trust') {
		state.trustedIds.add(targetId);
		state.blockedIds.delete(targetId);
		await channel.permissionOverwrites.edit(targetId, { ViewChannel: true, Connect: true }).catch(() => null);
		return interaction.reply({ content: 'User trusted.', ephemeral: true }).catch(() => null);
	}
	if (op === 'kick') {
		const m = await interaction.guild.members.fetch(targetId).catch(() => null);
		if (m?.voice?.channelId === channelId) await m.voice.disconnect().catch(() => null);
		return interaction.reply({ content: 'User disconnected.', ephemeral: true }).catch(() => null);
	}
}

export async function handleTempVoiceModal(interaction) {
	if (!interaction.isModalSubmit?.()) return;
	const parts = (interaction.customId || '').split('_');
	if (parts[0] !== 'tv' || parts[1] !== 'rename' || parts[2] !== 'modal') return; // tv_rename_modal_<channelId>
	const channelId = parts[3];
	const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
	if (!channel) return interaction.reply({ content: 'Channel not found.', ephemeral: true }).catch(() => null);
	const state = tempVoiceState.get(channelId);
	if (!state) return interaction.reply({ content: 'Not a temp voice channel.', ephemeral: true }).catch(() => null);
	if (interaction.user.id !== state.ownerId) return interaction.reply({ content: 'Only the owner can rename.', ephemeral: true }).catch(() => null);
	const raw = interaction.fields.getTextInputValue('new_name') || '';
	const safe = String(raw).replace(/[^\w\- ]/g, '').slice(0, 20) || 'voice';
	const emoji = state.emoji || '🎧';
	await channel.setName(`${emoji}-${safe}`).catch(() => null);
	return interaction.reply({ content: 'Channel renamed.', ephemeral: true }).catch(() => null);
}

function buildControlEmbed(settings, ownerId, channelName) {
	const embed = new EmbedBuilder();
	const e = settings?.tempVoiceControlEmbed || {};
	const replace = (str) => {
		if (!str) return '';
		return String(str).replaceAll('<owner>', `<@${ownerId}>`).replaceAll('<channel>', channelName);
	};
	embed.setTitle(replace(e.title) || 'Temp Voice Controls');
	embed.setDescription(replace(e.description) || `Owner: <@${ownerId}>, Channel: ${channelName}`);
	embed.setColor(e.color ?? 0x5b8cff);
	embed.setTimestamp(new Date());
	(e.fields || []).forEach(f => {
		if (f?.name && f?.value) embed.addFields({ name: replace(f.name), value: replace(f.value), inline: !!f.inline });
	});
	return embed;
}

async function sendTempDm(settings, member, fallback) {
	try {
		const dmCfg = settings?.tempVoiceDmEmbed || {};
		const embed = new EmbedBuilder()
			.setTitle(dmCfg.title || 'Voice Notice')
			.setDescription(dmCfg.description || fallback || '')
			.setColor(dmCfg.color ?? 0xff6b6b)
			.setTimestamp(new Date());
		(dmCfg.fields || []).forEach(f => {
			if (f?.name && f?.value) embed.addFields({ name: f.name, value: f.value, inline: !!f.inline });
		});
		await member.send({ embeds: [embed] }).catch(() => null);
	} catch {}
}

function buildControlsRows(channelId) {
	const lockBtn = new ButtonBuilder().setCustomId(`tv_lock_${channelId}`).setLabel('Lock').setStyle(ButtonStyle.Danger).setEmoji('🔒');
	const unlockBtn = new ButtonBuilder().setCustomId(`tv_unlock_${channelId}`).setLabel('Unlock').setStyle(ButtonStyle.Success).setEmoji('🔓');
	const blockBtn = new ButtonBuilder().setCustomId(`tv_block_${channelId}`).setLabel('Block User').setStyle(ButtonStyle.Secondary).setEmoji('⛔');
	const trustBtn = new ButtonBuilder().setCustomId(`tv_trust_${channelId}`).setLabel('Trusted User').setStyle(ButtonStyle.Primary).setEmoji('✅');
	const kickBtn = new ButtonBuilder().setCustomId(`tv_kick_${channelId}`).setLabel('Disconnect User').setStyle(ButtonStyle.Secondary).setEmoji('🛑');
	const renameBtn = new ButtonBuilder().setCustomId(`tv_rename_${channelId}`).setLabel('Rename').setStyle(ButtonStyle.Secondary).setEmoji('✏️');

	const row1 = new ActionRowBuilder().addComponents(lockBtn, unlockBtn, blockBtn, trustBtn, kickBtn);
	const row2 = new ActionRowBuilder().addComponents(renameBtn);
	return [row1, row2];
}

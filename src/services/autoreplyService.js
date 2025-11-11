import { PermissionsBitField } from 'discord.js';
import { getOrCreateSettings } from './punishmentService.js';

// Simple per-channel cooldown to avoid spam: `${channelId}` -> timestamp
const channelCooldowns = new Map();
const COOLDOWN_MS = 1500; // 1.5s between auto replies per channel

function normalize(str) {
  return String(str || '').trim().toLowerCase();
}

function matches(messageContent, trigger, matchType = 'contains') {
  const content = normalize(messageContent);
  const trg = normalize(trigger);
  if (!content || !trg) return false;
  switch (matchType) {
    case 'starts':
      return content.startsWith(trg);
    case 'ends':
      return content.endsWith(trg);
    case 'contains':
    default:
      return content.includes(trg);
  }
}

export async function handleMessageCreate(message) {
  try {
    // Ignore system messages, DMs (optional), and bot messages
    if (!message || message.system || message.author?.bot) return;
    if (!message.guild) return; // Scope to guild text channels only

    // Ensure bot can send messages in this channel
    const me = message.guild.members.me;
    const canSend = me?.permissionsIn(message.channel)?.has(PermissionsBitField.Flags.SendMessages);
    if (!canSend) return;

    // Cooldown per channel to prevent floods
    const last = channelCooldowns.get(message.channel.id) || 0;
    if (Date.now() - last < COOLDOWN_MS) return;

    // Load settings for this guild
    const guildId = message.guild.id || (process.env.MAIN_GUILD_ID || 'default');
    const settings = await getOrCreateSettings(guildId);
    const entries = Array.isArray(settings?.autoReplies) ? settings.autoReplies : [];
    if (!entries.length) return;

    // Find the first matching entry
    const match = entries.find((entry) => {
      return matches(message.content, entry.trigger, entry.matchType);
    });

    if (!match) return;

    // Optional placeholder support
    const response = String(match.response || '')
      .replaceAll('<user>', `<@${message.author.id}>`)
      .replaceAll('<channel>', `<#${message.channel.id}>`)
      .replaceAll('<server>', message.guild.name);

    // Reply to the triggering message
    await message.reply({ content: response }).catch(() => null);
    channelCooldowns.set(message.channel.id, Date.now());
  } catch (err) {
    console.error('AutoReply handleMessageCreate error:', err);
  }
}
import express from 'express';
import ms from 'ms';
import { User, allowedRoles } from '../models/User.js';
import {
	performPunishment,
	updateLogSettings,
	roleAllowsPunishments,
	roleAllowsEmbedSettings,
	getOrCreateSettings
} from '../services/punishmentService.js';
import {
	createDispute,
	getActiveDisputes,
	deleteDispute,
	deleteAllDisputes
} from '../services/disputeService.js';
import { getBotStats, getSystemStatus } from '../services/botStatsService.js';
import { getActiveVoiceActions } from '../services/punishmentService.js';
import { getDiscordClient, resolveGuild } from '../bot/client.js';

const router = express.Router();

function requireSession(req, res, next) {
	if (!req.session || !req.session.userId) {
		return res.status(401).json({ ok: false, error: 'unauthorized' });
	}
	next();
}

async function requireNotTimedOut(req, res, next) {
  try {
    const user = await User.findById(req.session.userId);
    if (user?.webTimeoutUntil && user.webTimeoutUntil > new Date()) {
      return res.status(403).json({ ok: false, error: 'timed_out', until: user.webTimeoutUntil });
    }
    return next();
  } catch (err) {
    console.error('Timeout check error:', err);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
}

router.post('/accounts', requireSession, requireNotTimedOut, async (req, res) => {
	try {
		const { role } = req.session;
		if (role !== 'owner') {
			return res.status(403).json({ ok: false, error: 'forbidden' });
		}
    const { username, password, role: userRole } = req.body;
    if (!username || !password || !userRole) {
      return res.status(400).json({ ok: false, error: 'username, password, and role are required' });
    }
    if (!allowedRoles.includes(userRole)) {
      return res.status(400).json({ ok: false, error: `role must be one of: ${allowedRoles.join(', ')}` });
    }
		const existing = await User.findOne({ username });
		if (existing) {
			return res.status(409).json({ ok: false, error: 'username already exists' });
		}
		const passwordHash = await User.hashPassword(password);
    const user = await User.create({ username, passwordHash, role: userRole });
		return res.status(201).json({ ok: true, id: user._id.toString(), username: user.username, role: user.role });
	} catch (err) {
		console.error('Create account error:', err);
		return res.status(500).json({ ok: false, error: 'internal_error' });
	}
});

// Public: list accounts (minimal fields)
router.get('/accounts', requireSession, requireNotTimedOut, async (req, res) => {
  try {
    const { role } = req.session;
    if (role !== 'owner') {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    const users = await User.find({}, { username: 1, role: 1, webTimeoutUntil: 1 }).sort({ username: 1 }).lean();
    return res.json({ ok: true, users });
  } catch (err) {
    console.error('List accounts error:', err);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

router.post('/punishments', requireSession, requireNotTimedOut, async (req, res) => {
	try {
		const { role, userId } = req.session;
		if (!roleAllowsPunishments(role)) {
			return res.status(403).json({ ok: false, error: 'forbidden' });
		}
		const { targetUserId, action, reason, duration, force = false } = req.body;
		if (!targetUserId || !action) {
			return res.status(400).json({ ok: false, error: 'targetUserId and action required' });
		}
		const durationMs = duration ? ms(duration) || Number(duration) || 0 : 0;
		const result = await performPunishment({
			guildId: process.env.MAIN_GUILD_ID || 'default',
			actor: {
				id: req.session.userId,
				username: req.session.username,
				role: req.session.role
			},
			targetUserId,
			reason,
			action,
			duration: durationMs,
			force
		});
		return res.json({ ok: true, ...result });
	} catch (error) {
		console.error('Punishment error:', error);
		return res.status(400).json({ ok: false, error: error.message || 'punishment_failed' });
	}
});

router.post('/settings/punishments', requireSession, requireNotTimedOut, async (req, res) => {
	try {
		const { role } = req.session;
		if (!roleAllowsEmbedSettings(role)) {
			return res.status(403).json({ ok: false, error: 'forbidden' });
		}
		const { logChannelId, enabled, dmEmbed } = req.body;
		const isOwner = role === 'owner';
		const parsedEmbed = parseEmbed(dmEmbed);
		const settings = await updateLogSettings({
			guildId: process.env.MAIN_GUILD_ID || 'default',
			logChannelId: isOwner ? logChannelId : undefined,
			enabled: isOwner ? (typeof enabled === 'boolean' ? enabled : enabled === 'true') : undefined,
			dmEmbed: parsedEmbed,
			performedBy: {
				username: req.session.username,
				role: req.session.role
			}
		});
		return res.json({ ok: true, settings });
	} catch (error) {
		console.error('Update punishment settings error:', error);
		return res.status(400).json({ ok: false, error: error.message || 'update_failed' });
	}
});

router.get('/settings/punishments', requireSession, requireNotTimedOut, async (req, res) => {
	try {
		const settings = await getOrCreateSettings(process.env.MAIN_GUILD_ID || 'default');
		return res.json({ ok: true, settings });
	} catch (error) {
		return res.status(500).json({ ok: false, error: 'failed_to_fetch' });
	}
});

router.post('/disputes', requireSession, requireNotTimedOut, async (req, res) => {
	try {
		const { role } = req.session;
		if (!roleAllowsPunishments(role)) {
			return res.status(403).json({ ok: false, error: 'forbidden' });
		}
		const { user1Id, user2Id } = req.body;
		if (!user1Id || !user2Id) {
			return res.status(400).json({ ok: false, error: 'user1Id and user2Id are required' });
		}
		if (user1Id === user2Id) {
			return res.status(400).json({ ok: false, error: 'Cannot create dispute with same user' });
		}
		const dispute = await createDispute({
			guildId: process.env.MAIN_GUILD_ID || 'default',
			user1Id,
			user2Id,
			createdBy: req.session.username,
			createdByRole: req.session.role
		});
		return res.json({ ok: true, dispute });
	} catch (error) {
		console.error('Create dispute error:', error);
		return res.status(400).json({ ok: false, error: error.message || 'dispute_failed' });
	}
});

router.get('/disputes', requireSession, requireNotTimedOut, async (req, res) => {
	try {
		const disputes = await getActiveDisputes(process.env.MAIN_GUILD_ID || 'default');
		return res.json({ ok: true, disputes });
	} catch (error) {
		return res.status(500).json({ ok: false, error: 'failed_to_fetch' });
	}
});

router.delete('/disputes/:id', requireSession, requireNotTimedOut, async (req, res) => {
	try {
		const { role } = req.session;
		if (!roleAllowsPunishments(role)) {
			return res.status(403).json({ ok: false, error: 'forbidden' });
		}
		const dispute = await deleteDispute(req.params.id);
		if (!dispute) {
			return res.status(404).json({ ok: false, error: 'Dispute not found' });
		}
		return res.json({ ok: true });
	} catch (error) {
		return res.status(500).json({ ok: false, error: error.message || 'delete_failed' });
	}
});

router.delete('/disputes', requireSession, requireNotTimedOut, async (req, res) => {
	try {
		const { role } = req.session;
		if (role !== 'owner') {
			return res.status(403).json({ ok: false, error: 'Only owner can delete all disputes' });
		}
		const result = await deleteAllDisputes(process.env.MAIN_GUILD_ID || 'default');
		return res.json({ ok: true, deletedCount: result.deletedCount });
	} catch (error) {
		return res.status(500).json({ ok: false, error: error.message || 'delete_failed' });
	}
});

router.get('/settings/disputes', requireSession, requireNotTimedOut, async (req, res) => {
	try {
		const settings = await getOrCreateSettings(process.env.MAIN_GUILD_ID || 'default');
		return res.json({ ok: true, settings });
	} catch (error) {
		return res.status(500).json({ ok: false, error: 'failed_to_fetch' });
	}
});

router.post('/settings/disputes', requireSession, requireNotTimedOut, async (req, res) => {
	try {
		const { role } = req.session;
		if (!roleAllowsEmbedSettings(role)) {
			return res.status(403).json({ ok: false, error: 'forbidden' });
		}
		const { disputeEmbed, disputesEnabled, disputeLogChannelId } = req.body;
		const isOwner = role === 'owner';
		const parsedEmbed = parseEmbed(disputeEmbed);
		const settings = await getOrCreateSettings(process.env.MAIN_GUILD_ID || 'default');
		
		if (parsedEmbed) {
			settings.disputeEmbed = parsedEmbed;
		}
		
		// Only owner can change enabled status and log channel
		if (isOwner) {
			if (typeof disputesEnabled === 'boolean') {
				settings.disputesEnabled = disputesEnabled;
			}
			if (disputeLogChannelId !== undefined) {
				settings.disputeLogChannelId = disputeLogChannelId || '';
			}
		}
		
		await settings.save();
		return res.json({ ok: true, settings });
	} catch (error) {
		console.error('Update dispute settings error:', error);
		return res.status(400).json({ ok: false, error: error.message || 'update_failed' });
	}
});

router.get('/settings/verify', requireSession, requireNotTimedOut, async (req, res) => {
	try {
		const settings = await getOrCreateSettings(process.env.MAIN_GUILD_ID || 'default');
		return res.json({ ok: true, settings });
	} catch (error) {
		return res.status(500).json({ ok: false, error: 'failed_to_fetch' });
	}
});

router.post('/settings/verify', requireSession, requireNotTimedOut, async (req, res) => {
	try {
		const { role } = req.session;
		const isOwner = role === 'owner';
		const canEditEmbed = roleAllowsEmbedSettings(role);
		
		if (!isOwner && !canEditEmbed) {
			return res.status(403).json({ ok: false, error: 'forbidden' });
		}
		
		const { 
			verifyCategoryId, 
			verifyLogChannelId, 
			verifyChannelId,
			verifyAdminRoleIds,
			verifyBoyRoleId,
			verifyGirlRoleId,
			verifyEnabled,
			verifyEmbed
		} = req.body;
		
		const settings = await getOrCreateSettings(process.env.MAIN_GUILD_ID || 'default');
		
		// Only owner can change channel and role settings
		if (isOwner) {
			if (verifyCategoryId !== undefined) {
				settings.verifyCategoryId = verifyCategoryId || '';
			}
			if (verifyLogChannelId !== undefined) {
				settings.verifyLogChannelId = verifyLogChannelId || '';
			}
			if (verifyChannelId !== undefined) {
				settings.verifyChannelId = verifyChannelId || '';
			}
			if (verifyAdminRoleIds !== undefined) {
				settings.verifyAdminRoleIds = verifyAdminRoleIds || '';
			}
			if (verifyBoyRoleId !== undefined) {
				settings.verifyBoyRoleId = verifyBoyRoleId || '';
			}
			if (verifyGirlRoleId !== undefined) {
				settings.verifyGirlRoleId = verifyGirlRoleId || '';
			}
			if (typeof verifyEnabled === 'boolean') {
				settings.verifyEnabled = verifyEnabled;
			}
		}
		
		// Owner and co-owner can change embed settings
		if (canEditEmbed && verifyEmbed) {
			const parsedEmbed = parseEmbed(verifyEmbed);
			if (parsedEmbed) {
				settings.verifyEmbed = parsedEmbed;
			}
		}
		
		await settings.save();
		return res.json({ ok: true, settings });
	} catch (error) {
		console.error('Update verify settings error:', error);
		return res.status(400).json({ ok: false, error: error.message || 'update_failed' });
	}
});

// Active voice mutes/deafens
router.get('/voice-actions', requireSession, requireNotTimedOut, async (req, res) => {
	try {
		const { role } = req.session;
		if (!roleAllowsPunishments(role)) {
			return res.status(403).json({ ok: false, error: 'forbidden' });
		}
		const guildId = process.env.MAIN_GUILD_ID || 'default';
		const list = getActiveVoiceActions().filter(a => a.guildId === guildId);
		const client = await getDiscordClient();
		let guild = null;
		try { guild = await resolveGuild(client, guildId); } catch {}
		const enriched = [];
		for (const item of list) {
			let tag = '';
			if (guild) {
				try {
					const m = await guild.members.fetch(item.userId).catch(() => null);
					tag = m ? (m.user.tag || m.user.username) : '';
				} catch {}
			}
			enriched.push({ ...item, tag });
		}
		return res.json({ ok: true, actions: enriched });
	} catch (error) {
		console.error('Fetch voice actions error:', error);
		return res.status(500).json({ ok: false, error: 'internal_error' });
	}
});

// Auto replies (owner only)
router.get('/autoreply', requireSession, requireNotTimedOut, async (req, res) => {
	try {
		if (req.session.role !== 'owner') return res.status(403).json({ ok: false, error: 'forbidden' });
		const settings = await getOrCreateSettings(process.env.MAIN_GUILD_ID || 'default');
		return res.json({ ok: true, replies: settings.autoReplies || [] });
	} catch (error) {
		console.error('Fetch autoreplies error:', error);
		return res.status(500).json({ ok: false, error: 'internal_error' });
	}
});

router.post('/autoreply', requireSession, requireNotTimedOut, async (req, res) => {
	try {
		if (req.session.role !== 'owner') return res.status(403).json({ ok: false, error: 'forbidden' });
		const { trigger, response, matchType, id } = req.body || {};
		if (!trigger || !response) return res.status(400).json({ ok: false, error: 'trigger and response required' });
		const settings = await getOrCreateSettings(process.env.MAIN_GUILD_ID || 'default');
		const safeMatch = ['starts', 'contains', 'ends'].includes(matchType) ? matchType : 'contains';
		if (id) {
			const target = settings.autoReplies.id(id);
			if (!target) return res.status(404).json({ ok: false, error: 'Not found' });
			target.trigger = trigger;
			target.response = response;
			target.matchType = safeMatch;
		} else {
			settings.autoReplies.push({ trigger, response, matchType: safeMatch });
		}
		await settings.save();
		return res.json({ ok: true, replies: settings.autoReplies });
	} catch (error) {
		console.error('Save autoreply error:', error);
		return res.status(500).json({ ok: false, error: 'internal_error' });
	}
});

router.delete('/autoreply/:id', requireSession, requireNotTimedOut, async (req, res) => {
	try {
		if (req.session.role !== 'owner') return res.status(403).json({ ok: false, error: 'forbidden' });
		const settings = await getOrCreateSettings(process.env.MAIN_GUILD_ID || 'default');
		const target = settings.autoReplies.id(req.params.id);
		if (!target) return res.status(404).json({ ok: false, error: 'Not found' });
		target.deleteOne();
		await settings.save();
		return res.json({ ok: true });
	} catch (error) {
		console.error('Delete autoreply error:', error);
		return res.status(500).json({ ok: false, error: 'internal_error' });
	}
});

// Temp voice settings
router.get('/settings/tempvoice', requireSession, requireNotTimedOut, async (req, res) => {
	try {
		const settings = await getOrCreateSettings(process.env.MAIN_GUILD_ID || 'default');
		return res.json({ ok: true, settings });
	} catch (error) {
		return res.status(500).json({ ok: false, error: 'failed_to_fetch' });
	}
});

router.post('/settings/tempvoice', requireSession, requireNotTimedOut, async (req, res) => {
	try {
		const { role } = req.session;
		const isOwner = role === 'owner';
		const canEditEmbed = role === 'owner' || role === 'co-owner';
		const settings = await getOrCreateSettings(process.env.MAIN_GUILD_ID || 'default');
		const { tempVoiceEnabled, tempVoiceHubChannelId, tempVoiceCategoryId, tempVoiceLogChannelId, tempVoiceEmojis, tempVoiceDmEmbed, tempVoiceControlEmbed, tempVoiceAccessRoleIds } = req.body;
		if (typeof tempVoiceEnabled === 'boolean' && canEditEmbed) settings.tempVoiceEnabled = tempVoiceEnabled;
		if (isOwner) {
			if (tempVoiceHubChannelId !== undefined) settings.tempVoiceHubChannelId = tempVoiceHubChannelId || '';
			if (tempVoiceCategoryId !== undefined) settings.tempVoiceCategoryId = tempVoiceCategoryId || '';
			if (tempVoiceLogChannelId !== undefined) settings.tempVoiceLogChannelId = tempVoiceLogChannelId || '';
			if (tempVoiceEmojis !== undefined) settings.tempVoiceEmojis = tempVoiceEmojis || '';
			if (tempVoiceAccessRoleIds !== undefined) settings.tempVoiceAccessRoleIds = tempVoiceAccessRoleIds || '';
		}
		if (canEditEmbed && tempVoiceDmEmbed) settings.tempVoiceDmEmbed = parseEmbed(tempVoiceDmEmbed) || settings.tempVoiceDmEmbed;
		if (canEditEmbed && tempVoiceControlEmbed) settings.tempVoiceControlEmbed = parseEmbed(tempVoiceControlEmbed) || settings.tempVoiceControlEmbed;
		await settings.save();
		return res.json({ ok: true, settings });
	} catch (error) {
		console.error('Update tempvoice settings error:', error);
		return res.status(400).json({ ok: false, error: error.message || 'update_failed' });
	}
});

router.get('/bot-stats', requireSession, requireNotTimedOut, async (req, res) => {
	try {
		const guildId = process.env.MAIN_GUILD_ID || 'default';
		const stats = await getBotStats(guildId);
		return res.json({ ok: true, stats });
	} catch (error) {
		return res.status(500).json({ ok: false, error: 'failed_to_fetch' });
	}
});

// Owner-only: delete account (cannot delete owner accounts)
router.delete('/accounts/:id', requireSession, requireNotTimedOut, async (req, res) => {
  try {
    const { role } = req.session;
    if (role !== 'owner') {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    const target = await User.findById(req.params.id);
    if (!target) {
      return res.status(404).json({ ok: false, error: 'not_found' });
    }
    if (target.role === 'owner') {
      return res.status(400).json({ ok: false, error: 'cannot_delete_owner' });
    }
    await target.deleteOne();
    return res.json({ ok: true });
  } catch (error) {
    console.error('Delete account error:', error);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// Owner-only: timeout account (cannot timeout owner), via query (?time=&user=) or body { time|duration, user }
router.post('/timeoutaccount', requireSession, requireNotTimedOut, async (req, res) => {
  try {
    const { role } = req.session;
    if (role !== 'owner') {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    const timeParam = req.query.time || req.query.duration || req.body?.time || req.body?.duration;
    const userParam = req.query.user || req.body?.user;
    if (!timeParam || !userParam) {
      return res.status(400).json({ ok: false, error: 'time and user are required' });
    }
    const durationMs = ms(String(timeParam)) || Number(timeParam);
    if (!durationMs || durationMs <= 0) {
      return res.status(400).json({ ok: false, error: 'invalid_duration' });
    }

    // Resolve user by id or username
    let target = null;
    if (/^[a-fA-F0-9]{24}$/.test(String(userParam))) {
      target = await User.findById(userParam);
    }
    if (!target) {
      target = await User.findOne({ username: userParam });
    }
    if (!target) {
      return res.status(404).json({ ok: false, error: 'user_not_found' });
    }
    if (target.role === 'owner') {
      return res.status(400).json({ ok: false, error: 'cannot_timeout_owner' });
    }

    target.webTimeoutUntil = new Date(Date.now() + durationMs);
    await target.save();
    return res.json({ ok: true, userId: target._id.toString(), until: target.webTimeoutUntil });
  } catch (error) {
    console.error('Timeout account error:', error);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// Current user's timeout status (usable while timed out)
router.get('/userstimoutes', requireSession, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    let timedOut = false;
    let until = null;
    let remainingMs = 0;
    if (user?.webTimeoutUntil && user.webTimeoutUntil > new Date()) {
      timedOut = true;
      until = user.webTimeoutUntil;
      remainingMs = until.getTime() - Date.now();
    }
    return res.json({ ok: true, timedOut, remainingMs, until });
  } catch (error) {
    console.error('Fetch user timeout status error:', error);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

function parseEmbed(dmEmbed) {
	if (!dmEmbed) return undefined;
	const result = {
		title: dmEmbed.title || 'Moderation Notice',
		description: dmEmbed.description || '',
		color: normalizeColor(dmEmbed.color),
		fields: []
	};
	if (Array.isArray(dmEmbed.fields)) {
		result.fields = dmEmbed.fields
			.filter((field) => field && field.name && field.value)
			.map((field) => ({
				name: field.name,
				value: field.value,
				inline: field.inline === true || field.inline === 'true'
			}));
	}
	return result;
}

function normalizeColor(val) {
	if (val === undefined || val === null || val === '') return undefined;
	if (typeof val === 'number') return val;
	if (typeof val === 'string') {
		const v = val.trim();
		if (v.startsWith('#')) {
			const hex = v.slice(1);
			const n = parseInt(hex, 16);
			return isNaN(n) ? undefined : n;
		}
		const n = Number(v);
		return isNaN(n) ? undefined : n;
	}
	return undefined;
}

export default router;



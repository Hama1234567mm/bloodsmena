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

const router = express.Router();

function requireSession(req, res, next) {
	if (!req.session || !req.session.userId) {
		return res.status(401).json({ ok: false, error: 'unauthorized' });
	}
	next();
}

router.post('/accounts', async (req, res) => {
	try {
		const { username, password, role } = req.body;
		if (!username || !password || !role) {
			return res.status(400).json({ ok: false, error: 'username, password, and role are required' });
		}
		if (!allowedRoles.includes(role)) {
			return res.status(400).json({ ok: false, error: `role must be one of: ${allowedRoles.join(', ')}` });
		}
		const existing = await User.findOne({ username });
		if (existing) {
			return res.status(409).json({ ok: false, error: 'username already exists' });
		}
		const passwordHash = await User.hashPassword(password);
		const user = await User.create({ username, passwordHash, role });
		return res.status(201).json({ ok: true, id: user._id.toString(), username: user.username, role: user.role });
	} catch (err) {
		console.error('Create account error:', err);
		return res.status(500).json({ ok: false, error: 'internal_error' });
	}
});

router.post('/punishments', requireSession, async (req, res) => {
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

router.post('/settings/punishments', requireSession, async (req, res) => {
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

router.get('/settings/punishments', requireSession, async (req, res) => {
	try {
		const settings = await getOrCreateSettings(process.env.MAIN_GUILD_ID || 'default');
		return res.json({ ok: true, settings });
	} catch (error) {
		return res.status(500).json({ ok: false, error: 'failed_to_fetch' });
	}
});

router.post('/disputes', requireSession, async (req, res) => {
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

router.get('/disputes', requireSession, async (req, res) => {
	try {
		const disputes = await getActiveDisputes(process.env.MAIN_GUILD_ID || 'default');
		return res.json({ ok: true, disputes });
	} catch (error) {
		return res.status(500).json({ ok: false, error: 'failed_to_fetch' });
	}
});

router.delete('/disputes/:id', requireSession, async (req, res) => {
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

router.delete('/disputes', requireSession, async (req, res) => {
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

router.get('/settings/disputes', requireSession, async (req, res) => {
	try {
		const settings = await getOrCreateSettings(process.env.MAIN_GUILD_ID || 'default');
		return res.json({ ok: true, settings });
	} catch (error) {
		return res.status(500).json({ ok: false, error: 'failed_to_fetch' });
	}
});

router.post('/settings/disputes', requireSession, async (req, res) => {
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

router.get('/settings/verify', requireSession, async (req, res) => {
	try {
		const settings = await getOrCreateSettings(process.env.MAIN_GUILD_ID || 'default');
		return res.json({ ok: true, settings });
	} catch (error) {
		return res.status(500).json({ ok: false, error: 'failed_to_fetch' });
	}
});

router.post('/settings/verify', requireSession, async (req, res) => {
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

router.get('/bot-stats', requireSession, async (req, res) => {
	try {
		const guildId = process.env.MAIN_GUILD_ID || 'default';
		const stats = await getBotStats(guildId);
		return res.json({ ok: true, stats });
	} catch (error) {
		return res.status(500).json({ ok: false, error: 'failed_to_fetch' });
	}
});

function parseEmbed(dmEmbed) {
	if (!dmEmbed) return undefined;
	const result = {
		title: dmEmbed.title || 'Moderation Notice',
		description: dmEmbed.description || '',
		color: dmEmbed.color ? Number(dmEmbed.color) : undefined,
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

export default router;



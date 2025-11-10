import express from 'express';
import { User } from '../models/User.js';
import { getOrCreateSettings, roleAllowsPunishments, roleAllowsEmbedSettings } from '../services/punishmentService.js';
import { getBotStats, getSystemStatus } from '../services/botStatsService.js';

const router = express.Router();

function requireAuth(req, res, next) {
	if (req.session && req.session.userId) return next();
	return res.redirect('/login');
}

router.get('/', requireAuth, async (req, res) => {
	const guildId = process.env.MAIN_GUILD_ID || 'default';
	const botStats = await getBotStats(guildId);
	const systemStatus = await getSystemStatus(guildId);
	
	res.render('dashboard', { 
		username: req.session.username, 
		role: req.session.role, 
		title: 'Dashboard',
		botStats,
		systemStatus,
		mainGuildId: guildId
	});
});

router.get('/login', (req, res) => {
	res.render('login', { 
		title: 'Login', 
		layout: false,
		error: req.flash('error'),
		success: req.flash('success')
	});
});

router.post('/login', async (req, res) => {
	try {
		const { username, password } = req.body;
		if (!username || !password) {
			req.flash('error', 'Username and password are required.');
			return res.redirect('/login');
		}
		const user = await User.findOne({ username });
		if (!user) {
			req.flash('error', 'Invalid credentials.');
			return res.redirect('/login');
		}
		const ok = await user.comparePassword(password);
		if (!ok) {
			req.flash('error', 'Invalid credentials.');
			return res.redirect('/login');
		}
		req.session.userId = user._id.toString();
		req.session.username = user.username;
		req.session.role = user.role;
		req.flash('success', `Welcome back, ${user.username}!`);
		return res.redirect('/');
	} catch (err) {
		console.error(err);
		req.flash('error', 'Unexpected error. Please try again.');
		return res.redirect('/login');
	}
});

router.post('/logout', (req, res) => {
	req.session.destroy(() => {
		res.redirect('/login');
	});
});

router.get('/punshmint', requireAuth, async (req, res) => {
	const { role } = req.session;
	const guildId = process.env.MAIN_GUILD_ID || 'default';
	const settings = await getOrCreateSettings(guildId);
	const canEditPunishments = roleAllowsPunishments(role);
	const canEditEmbed = roleAllowsEmbedSettings(role);
	const isOwner = role === 'owner';
	if (!canEditPunishments && !canEditEmbed) {
		req.flash('error', 'You do not have access to this section.');
		return res.redirect('/');
	}
	// Initialize dispute embed if it doesn't exist
	if (!settings.disputeEmbed || !settings.disputeEmbed.fields || settings.disputeEmbed.fields.length === 0) {
		if (!settings.disputeEmbed) {
			settings.disputeEmbed = {};
		}
		if (!settings.disputeEmbed.fields) {
			settings.disputeEmbed.fields = [];
		}
		await settings.save();
	}
	
	res.render('punshmint', {
		title: 'Punishments',
		settings,
		canEditPunishments,
		canEditEmbed,
		isOwner,
		mainGuildId: guildId
	});
});

router.get('/dispute', requireAuth, async (req, res) => {
	const { role } = req.session;
	const guildId = process.env.MAIN_GUILD_ID || 'default';
	const settings = await getOrCreateSettings(guildId);
	const canEditPunishments = roleAllowsPunishments(role);
	const canEditEmbed = roleAllowsEmbedSettings(role);
	const isOwner = role === 'owner';
	if (!canEditPunishments && !canEditEmbed) {
		req.flash('error', 'You do not have access to this section.');
		return res.redirect('/');
	}
	// Initialize dispute embed if it doesn't exist
	if (!settings.disputeEmbed) {
		settings.disputeEmbed = {};
		await settings.save();
	}
	
	res.render('dispute', {
		title: 'Disputes',
		settings,
		canEditPunishments,
		canEditEmbed,
		isOwner,
		mainGuildId: guildId
	});
});

router.get('/verify', requireAuth, async (req, res) => {
	const { role } = req.session;
	const guildId = process.env.MAIN_GUILD_ID || 'default';
	const settings = await getOrCreateSettings(guildId);
	const canEditEmbed = roleAllowsEmbedSettings(role);
	const isOwner = role === 'owner';
	if (!canEditEmbed && !isOwner) {
		req.flash('error', 'You do not have access to this section.');
		return res.redirect('/');
	}
	// Initialize verify embed if it doesn't exist
	if (!settings.verifyEmbed) {
		settings.verifyEmbed = {};
		await settings.save();
	}
	
	res.render('verify', {
		title: 'Verification',
		settings,
		canEditEmbed,
		isOwner,
		mainGuildId: guildId
	});
});

export default router;



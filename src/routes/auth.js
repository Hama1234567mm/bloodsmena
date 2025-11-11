import express from 'express';
import { User } from '../models/User.js';
import { getOrCreateSettings, roleAllowsPunishments, roleAllowsEmbedSettings } from '../services/punishmentService.js';
import { getBotStats, getSystemStatus } from '../services/botStatsService.js';

const router = express.Router();

async function requireAuth(req, res, next) {
    if (!req.session || !req.session.userId) return res.redirect('/login');
    try {
        const user = await User.findById(req.session.userId);
        if (user?.webTimeoutUntil && user.webTimeoutUntil > new Date()) {
            const remainingMs = user.webTimeoutUntil.getTime() - Date.now();
            return res.render('usertimout', {
                title: 'Account Timeout',
                remainingMs,
                hideNav: false
            });
        }
        return next();
    } catch (err) {
        console.error('Auth timeout check error:', err);
        return res.redirect('/login');
    }
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

// Preview/Direct timeout page (for testing or direct linking)
router.get('/timeout', async (req, res) => {
    const msVal = Number(req.query.ms || 0);
    const remainingMs = msVal > 0 ? msVal : 0;
    res.render('usertimout', {
        title: 'Account Timeout',
        remainingMs
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

router.get('/logs', requireAuth, async (req, res) => {
	try {
		const { role } = req.session;
		if (role !== 'owner') {
			req.flash('error', 'You do not have access to this section.');
			return res.redirect('/');
		}
		const guildId = process.env.MAIN_GUILD_ID || 'default';
		const [{ User }] = await Promise.all([import('../models/User.js')]);
		const [{ PunishmentLog }] = await Promise.all([import('../models/PunishmentLog.js')]);
		const users = await User.find({}).sort({ username: 1 }).lean();
		const actions = await PunishmentLog.find({ guildId }).sort({ createdAt: -1 }).limit(100).lean();
		return res.render('logs', {
			title: 'Logs',
			users,
			actions
		});
	} catch (err) {
		console.error('Logs page error:', err);
		req.flash('error', 'Failed to load logs.');
		return res.redirect('/');
	}
});

router.get('/autoreply', requireAuth, async (req, res) => {
	const { role } = req.session;
	if (role !== 'owner') {
		req.flash('error', 'You do not have access to this section.');
		return res.redirect('/');
	}
	const guildId = process.env.MAIN_GUILD_ID || 'default';
	const settings = await getOrCreateSettings(guildId);
	return res.render('autoreply', {
		title: 'Auto Reply',
		replies: settings.autoReplies || []
	});
});

// Owner-only: Account Manager page
router.get('/manager', requireAuth, async (req, res) => {
  const { role } = req.session;
  if (role !== 'owner') {
    req.flash('error', 'You do not have access to this section.');
    return res.redirect('/');
  }
  return res.render('manager', {
    title: 'Account Manager'
  });
});

router.get('/tempvoice', requireAuth, async (req, res) => {
	const { role } = req.session;
	const guildId = process.env.MAIN_GUILD_ID || 'default';
	const settings = await getOrCreateSettings(guildId);
	const canView = role === 'owner' || role === 'co-owner';
	const isOwner = role === 'owner';
	if (!canView) {
		req.flash('error', 'You do not have access to this section.');
		return res.redirect('/');
	}
	res.render('tempvoice', {
		title: 'Temp Voice',
		settings,
		isOwner,
		mainGuildId: guildId
	});
});

export default router;



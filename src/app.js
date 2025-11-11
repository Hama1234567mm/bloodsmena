import express from 'express';
import path from 'path';
import mongoose from 'mongoose';
import session from 'express-session';
import flash from 'connect-flash';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import expressLayouts from 'express-ejs-layouts';
import { fileURLToPath } from 'url';

import authRouter from './routes/auth.js';
import apiRouter from './routes/api.js';
import { getDiscordClient } from './bot/client.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Settings
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

// Middleware
app.use(helmet());
app.use(morgan('dev'));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
// CORS for external UI on different port
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,PUT,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(
	session({
		secret: process.env.SESSION_SECRET ,
		resave: false,
		saveUninitialized: false,
		cookie: {
			httpOnly: true,
			secure: false
		}
	})
);
app.use(flash());
app.use((req, res, next) => {
	res.locals.success = req.flash('success');
	res.locals.error = req.flash('error');
	res.locals.username = req.session?.username || null;
	res.locals.role = req.session?.role || null;
	next();
});

app.use('/public', express.static(path.join(__dirname, 'public')));

// Routes
app.use('/', authRouter);
app.use('/api', apiRouter);

// DB
const MONGO_URI =
	process.env.MONGO_URI ||
	'mongodb+srv://hama1200kk:1known01@cluster0.qzb2k.mongodb.net/?appName=Cluster0';

mongoose
	.connect(MONGO_URI, { dbName: 'discord_bot_auth' })
	.then(async () => {
		console.log('MongoDB connected');
		
		// Initialize Discord bot
		if (process.env.BOT_TOKEN) {
			try {
				await getDiscordClient();
				console.log('Discord bot initialized and ready');
			} catch (err) {
				console.error('Discord bot initialization failed:', err.message);
			}
		} else {
			console.warn('BOT_TOKEN not set. Discord bot features will be unavailable.');
		}
		
		const port = process.env.PORT || 3000;
		app.listen(port, () => console.log(`Server running on http://localhost:${port}`));
	})
	.catch((err) => {
		console.error('MongoDB connection error:', err);
		process.exit(1);
	});

// 404 handler (must be after routes)
app.use((req, res) => {
  res.status(404).render('404', { title: 'Not Found' });
});



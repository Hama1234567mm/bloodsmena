import mongoose from 'mongoose';

const PunishmentLogSchema = new mongoose.Schema(
	{
		targetUserId: { type: String, required: true },
		targetTag: { type: String },
		action: {
			type: String,
			enum: ['warn', 'timeout', 'ban', 'kick', 'voice_mute', 'voice_deafen'],
			required: true
		},
		reason: { type: String, default: 'No reason provided' },
		durationMs: { type: Number, default: 0 },
		warnCount: { type: Number, default: 0 },
		performedById: { type: String, required: true },
		performedByName: { type: String },
		performedByRole: { type: String, required: true },
		source: { type: String, default: 'dashboard' },
		guildId: { type: String, required: true }
	},
	{ timestamps: true }
);

export const PunishmentLog = mongoose.model('PunishmentLog', PunishmentLogSchema);


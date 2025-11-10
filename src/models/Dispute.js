import mongoose from 'mongoose';

const DisputeSchema = new mongoose.Schema(
	{
		guildId: { type: String, required: true },
		user1Id: { type: String, required: true },
		user1Name: { type: String, default: '' },
		user2Id: { type: String, required: true },
		user2Name: { type: String, default: '' },
		createdBy: { type: String, required: true },
		createdByRole: { type: String },
		active: { type: Boolean, default: true },
		disconnectCount: { type: Number, default: 0 }
	},
	{ timestamps: true }
);

export const Dispute = mongoose.model('Dispute', DisputeSchema);


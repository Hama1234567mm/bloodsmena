import mongoose from 'mongoose';

const EmbedFieldSchema = new mongoose.Schema(
	{
		name: { type: String, required: true },
		value: { type: String, required: true },
		inline: { type: Boolean, default: false }
	},
	{ _id: false }
);

const DMEmbedSchema = new mongoose.Schema(
	{
		title: { type: String, default: 'Moderation Notice' },
		description: { type: String, default: 'You have received an action in <servername>.' },
		fields: { type: [EmbedFieldSchema], default: [] },
		color: { type: Number, default: 0xff3b3b }
	},
	{ _id: false }
);

const DisputeEmbedSchema = new mongoose.Schema(
	{
		title: { type: String, default: 'Dispute Notice' },
		description: { type: String, default: 'You have been disconnected due to an active dispute.' },
		fields: { type: [EmbedFieldSchema], default: [] },
		color: { type: Number, default: 0xff6b6b }
	},
	{ _id: false }
);

const VerifyEmbedSchema = new mongoose.Schema(
	{
		title: { type: String, default: 'Verification Request' },
		description: { type: String, default: '<user> wants to verify in <channel>.' },
		fields: { type: [EmbedFieldSchema], default: [] },
		color: { type: Number, default: 0x5b8cff }
	},
	{ _id: false }
);

const GuildSettingsSchema = new mongoose.Schema(
	{
		guildId: { type: String, required: true, unique: true },
		logChannelId: { type: String, default: '' },
		punishmentsEnabled: { type: Boolean, default: true },
		disputesEnabled: { type: Boolean, default: true },
		disputeLogChannelId: { type: String, default: '' },
		verifyCategoryId: { type: String, default: '' },
		verifyLogChannelId: { type: String, default: '' },
		verifyChannelId: { type: String, default: '' },
		verifyAdminRoleIds: { type: String, default: '' },
		verifyBoyRoleId: { type: String, default: '' },
		verifyGirlRoleId: { type: String, default: '' },
		verifyEnabled: { type: Boolean, default: true },
		dmEmbed: { type: DMEmbedSchema, default: () => ({}) },
		disputeEmbed: { type: DisputeEmbedSchema, default: () => ({}) },
		verifyEmbed: { type: VerifyEmbedSchema, default: () => ({}) },
		updatedBy: { type: String },
		updatedByRole: { type: String }
	},
	{ timestamps: true }
);

export const GuildSettings = mongoose.model('GuildSettings', GuildSettingsSchema);


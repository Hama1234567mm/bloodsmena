import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const roles = ['owner', 'co-owner', 'admin'];

const UserSchema = new mongoose.Schema(
	{
		username: { type: String, unique: true, required: true, trim: true, minlength: 3, maxlength: 30 },
		passwordHash: { type: String, required: true },
		role: { type: String, enum: roles, required: true }
	},
	{ timestamps: true }
);

UserSchema.methods.comparePassword = async function (password) {
	return bcrypt.compare(password, this.passwordHash);
};

UserSchema.statics.hashPassword = async function (password) {
	const salt = await bcrypt.genSalt(10);
	return bcrypt.hash(password, salt);
};

export const User = mongoose.model('User', UserSchema);
export const allowedRoles = roles;



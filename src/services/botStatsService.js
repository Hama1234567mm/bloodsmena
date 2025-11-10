import { getDiscordClient, resolveGuild } from '../bot/client.js';
import os from 'os';
import { getOrCreateSettings } from './punishmentService.js';

let botStartTime = Date.now();

export function setBotStartTime() {
	botStartTime = Date.now();
}

export async function getBotStats(guildId) {
	const client = await getDiscordClient();
	if (!client) {
		return {
			online: false,
			ping: 0,
			uptime: 0,
			cpu: 0,
			ram: 0,
			guild: null
		};
	}
	
	const ping = client.ws.ping;
	const uptime = Date.now() - botStartTime;
	
	// CPU usage (simplified - using load average)
	const cpuUsage = os.loadavg()[0] * 100;
	
	// Memory usage
	const memUsage = process.memoryUsage();
	const ramUsage = (memUsage.heapUsed / 1024 / 1024).toFixed(2); // MB
	
	// Get guild info
	const guild = await resolveGuild(client, guildId);
	
	return {
		online: client.isReady(),
		ping,
		uptime,
		cpu: cpuUsage.toFixed(2),
		ram: ramUsage,
		guild: guild ? {
			id: guild.id,
			name: guild.name,
			memberCount: guild.memberCount
		} : null
	};
}

export async function getSystemStatus(guildId) {
	const settings = await getOrCreateSettings(guildId);
	return {
		punishmentsEnabled: settings.punishmentsEnabled !== false,
		disputesEnabled: settings.disputesEnabled !== false,
		verifyEnabled: settings.verifyEnabled !== false
	};
}


import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const int = (v, fallback) => {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

export function loadConfig(env = process.env) {
    return {
        root,
        port: int(env.PORT, 3000),
        host: env.HOST || '0.0.0.0',
        production: env.NODE_ENV === 'production',
        // Number of reverse proxies in front of the app (for correct client IPs).
        trustProxy: int(env.TRUST_PROXY, 0),
        // Extra origins allowed to open socket connections (comma separated).
        allowedOrigins: (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
        dataDir: path.resolve(root, env.DATA_DIR || 'data'),
        persist: env.PERSIST !== 'false',
        maxRooms: int(env.MAX_ROOMS, 500),
        maxMaps: int(env.MAX_MAPS, 1000),
        maxMapsPerOwner: int(env.MAX_MAPS_PER_OWNER, 50),
        maxConnectionsPerIp: int(env.MAX_CONNECTIONS_PER_IP, 30),
        // Disconnected players are played automatically after this long.
        afkGraceMs: int(env.AFK_GRACE_MS, 60_000),
        botDelayMs: int(env.BOT_DELAY_MS, 700),
        // Room create/join/resume attempts allowed per IP (burst, then per minute).
        joinBurst: int(env.JOIN_BURST, 10),
        // Socket events allowed per connection (burst, then per second).
        eventBurst: int(env.EVENT_BURST, 40),
        eventPerSecond: int(env.EVENT_PER_SECOND, 15),
        joinPerMinute: int(env.JOIN_PER_MINUTE, 10),
        logLevel: env.LOG_LEVEL || 'info',
    };
}

import http from 'node:http';
import path from 'node:path';
import { Server } from 'socket.io';
import { createApp } from './app.js';
import { attachSockets } from './sockets.js';
import { RoomManager } from './rooms.js';
import { MapStore } from './mapStore.js';
import { JsonDir } from './fileStore.js';
import { createLogger } from './logger.js';

/** Reject cross-site socket connections unless explicitly allowed. */
function originAllowed(req, config) {
    const origin = req.headers.origin;
    if (!origin) return true; // non-browser clients (they could spoof it anyway)
    try {
        const url = new URL(origin);
        if (url.host === req.headers.host) return true;
    } catch {
        return false;
    }
    return config.allowedOrigins.includes(origin);
}

/**
 * Build (but do not start) the server. Returns handles used by the entry point and tests.
 */
export async function createServer(config) {
    const logger = createLogger(config.logLevel);
    const maps = new MapStore({
        dir: path.join(config.dataDir, 'maps'),
        persist: config.persist,
        maxMaps: config.maxMaps,
        maxPerOwner: config.maxMapsPerOwner,
        logger,
    });
    await maps.init();

    const rooms = new RoomManager({
        config,
        logger,
        store: config.persist ? new JsonDir(path.join(config.dataDir, 'rooms')) : null,
    });
    await rooms.init();

    const stats = () => ({ rooms: rooms.rooms.size, maps: maps.maps.size });
    const app = createApp({ config, logger, stats });
    const server = http.createServer(app);
    server.headersTimeout = 20_000;
    server.requestTimeout = 30_000;

    const io = new Server(server, {
        maxHttpBufferSize: 64 * 1024,
        pingInterval: 20_000,
        pingTimeout: 20_000,
        serveClient: true,
        allowRequest: (req, cb) => cb(null, originAllowed(req, config)),
        cors: config.allowedOrigins.length ? { origin: config.allowedOrigins } : undefined,
    });

    attachSockets({ io, rooms, maps, config, logger });
    rooms.resumeAll();

    const sweeper = setInterval(() => rooms.sweep(), 60_000);
    sweeper.unref();

    let closing = null;
    const close = () => {
        closing ??= (async () => {
            clearInterval(sweeper);
            rooms.stop();
            await rooms.flush();
            await new Promise((resolve) => io.close(() => resolve()));
            await new Promise((resolve) => server.close(() => resolve()));
        })();
        return closing;
    };

    return { app, server, io, rooms, maps, logger, close };
}

// Socket.IO event handling. Every event:
//  * is rate limited per connection,
//  * must supply an acknowledgement callback,
//  * has its payload type-checked before use,
//  * reports failures through the ack as {ok:false, error} with a safe message.
import { GameError } from '../engine/errors.js';
import { normalizeSettings, DEFAULT_SETTINGS } from '../engine/settings.js';
import { BUILTIN_MAPS } from '../../shared/templates.js';
import { RoomError, normalizeCode } from './rooms.js';
import { MapError } from './mapStore.js';
import { RateLimiter } from './rateLimit.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function clientIp(socket, config) {
    if (config.trustProxy) {
        const fwd = socket.handshake.headers['x-forwarded-for'];
        if (typeof fwd === 'string' && fwd) {
            const parts = fwd.split(',').map((s) => s.trim());
            // With N trusted proxies, the client IP is N entries from the right.
            return parts[Math.max(0, parts.length - config.trustProxy)] || socket.handshake.address;
        }
    }
    return socket.handshake.address;
}

export function attachSockets({ io, rooms, maps, config, logger }) {
    const eventLimiter = new RateLimiter({ capacity: 40, refillPerSecond: 15 });
    // Limits brute-forcing of room codes and room spam.
    const joinLimiter = new RateLimiter({ capacity: config.joinBurst, refillPerSecond: config.joinPerMinute / 60 });
    const chatLimiter = new RateLimiter({ capacity: 5, refillPerSecond: 1 });
    const mapLimiter = new RateLimiter({ capacity: 10, refillPerSecond: 10 / 60 });
    const connectionsPerIp = new Map();
    const sockets = new Map(); // socketId -> socket

    setInterval(() => {
        eventLimiter.prune();
        joinLimiter.prune();
        chatLimiter.prune();
        mapLimiter.prune();
    }, 60_000).unref();

    /** Send each connected member of a room their personal view. */
    rooms.onChange = (room) => {
        for (const m of room.members) {
            if (!m.socketId) continue;
            const s = sockets.get(m.socketId);
            if (s) s.emit('room:state', room.viewFor(m.id));
        }
    };

    function bind(socket, room, member) {
        // One live connection per player: close any previous tab.
        if (member.socketId && member.socketId !== socket.id) {
            const old = sockets.get(member.socketId);
            if (old) {
                old.emit('room:closed', { reason: 'You opened this game in another tab.' });
                old.data.roomCode = null;
                old.data.memberId = null;
            }
        }
        unbind(socket);
        member.socketId = socket.id;
        member.connected = true;
        member.disconnectedAt = null;
        socket.data.roomCode = room.code;
        socket.data.memberId = member.id;
    }

    function unbind(socket) {
        const room = socket.data.roomCode && rooms.get(socket.data.roomCode);
        if (!room) return null;
        const m = room.member(socket.data.memberId);
        if (m && m.socketId === socket.id) {
            m.socketId = null;
            m.connected = false;
            m.disconnectedAt = Date.now();
        }
        socket.data.roomCode = null;
        socket.data.memberId = null;
        return room;
    }

    function current(socket) {
        const room = socket.data.roomCode && rooms.get(socket.data.roomCode);
        if (!room) throw new RoomError('You are not in a game');
        const member = room.member(socket.data.memberId);
        if (!member) throw new RoomError('You are not in this game');
        return { room, member };
    }

    io.on('connection', (socket) => {
        const ip = clientIp(socket, config);
        const count = (connectionsPerIp.get(ip) || 0) + 1;
        if (count > config.maxConnectionsPerIp) {
            logger.warn('Too many connections from one address', { ip });
            socket.emit('room:closed', { reason: 'Too many connections from your network.' });
            socket.disconnect(true);
            return;
        }
        connectionsPerIp.set(ip, count);
        sockets.set(socket.id, socket);
        socket.data.roomCode = null;
        socket.data.memberId = null;

        const on = (event, handler, { limiter = null } = {}) => {
            socket.on(event, async (payload, ack) => {
                if (typeof ack !== 'function') return; // every event must be acknowledged
                if (!eventLimiter.take(socket.id) || (limiter && !limiter.take(ip))) {
                    ack({ ok: false, error: 'You are doing that too often. Please slow down.' });
                    return;
                }
                try {
                    const result = await handler(isObj(payload) ? payload : {});
                    ack({ ok: true, ...(result || {}) });
                } catch (err) {
                    if (err instanceof GameError || err instanceof RoomError || err instanceof MapError) {
                        ack({ ok: false, error: err.message });
                    } else {
                        logger.error(`Error handling ${event}`, err);
                        ack({ ok: false, error: 'Something went wrong on the server.' });
                    }
                }
            });
        };

        // ---------------- Rooms ----------------

        on('room:create', ({ name, settings }) => {
            const { room, member, token } = rooms.create(name, normalizeSettings(isObj(settings) ? settings : {}, DEFAULT_SETTINGS));
            bind(socket, room, member);
            logger.info('Room created', { room: room.code });
            rooms.changed(room);
            return { code: room.code, token, memberId: member.id };
        }, { limiter: joinLimiter });

        on('room:join', ({ code, name }) => {
            const room = rooms.get(normalizeCode(code));
            if (!room) throw new RoomError('No game found with that code');
            const { member, token } = room.addMember(name);
            bind(socket, room, member);
            rooms.changed(room);
            return { code: room.code, token, memberId: member.id };
        }, { limiter: joinLimiter });

        on('room:resume', ({ code, token }) => {
            const room = rooms.get(normalizeCode(code));
            const member = room && room.memberByToken(token);
            if (!room || !member || member.left) throw new RoomError('That game is no longer available');
            bind(socket, room, member);
            rooms.changed(room);
            return { code: room.code, memberId: member.id };
        }, { limiter: joinLimiter });

        on('room:leave', () => {
            const { room, member } = current(socket);
            unbind(socket);
            room.leave(member.id);
            if (!room.humans().some((m) => !m.left)) rooms.delete(room, 'empty');
            else rooms.changed(room);
        });

        on('room:settings', ({ settings }) => {
            const { room, member } = current(socket);
            if (!isObj(settings)) throw new RoomError('Invalid settings');
            room.updateSettings(member.id, settings);
            rooms.changed(room);
        });

        on('room:color', ({ color }) => {
            const { room, member } = current(socket);
            room.setColor(member.id, color);
            rooms.changed(room);
        });

        on('room:addBot', () => {
            const { room, member } = current(socket);
            room.addBot(member.id);
            rooms.changed(room);
        });

        on('room:kick', ({ memberId }) => {
            const { room, member } = current(socket);
            const kicked = room.removeMember(member.id, memberId);
            if (kicked.socketId) {
                const s = sockets.get(kicked.socketId);
                if (s) {
                    s.data.roomCode = null;
                    s.data.memberId = null;
                    s.emit('room:closed', { reason: 'You were removed from the game by the host.' });
                }
            }
            rooms.changed(room);
        });

        on('room:start', () => {
            const { room, member } = current(socket);
            room.start(member.id, (id) => maps.get(id));
            logger.info('Game started', { room: room.code, players: room.members.length });
            rooms.changed(room);
        });

        on('room:rematch', () => {
            const { room, member } = current(socket);
            room.rematch(member.id);
            rooms.changed(room);
        });

        on('room:chat', ({ text }) => {
            const { room, member } = current(socket);
            if (typeof text !== 'string') throw new RoomError('Invalid message');
            room.addChat(member.id, text);
            rooms.changed(room);
        }, { limiter: chatLimiter });

        // ---------------- Game ----------------

        on('game:action', ({ action }) => {
            const { room, member } = current(socket);
            if (!isObj(action)) throw new GameError('Invalid action');
            room.act(member.id, action);
            rooms.changed(room);
        });

        // ---------------- Maps ----------------

        on('maps:list', ({ clientKey }) => ({ builtin: BUILTIN_MAPS, maps: maps.list(clientKey) }));

        on('maps:get', ({ id }) => {
            const m = maps.get(id);
            if (!m) throw new MapError('Map not found');
            return { id: m.id, name: m.name, template: m.template };
        });

        on('maps:save', async ({ id, name, template, clientKey }) => {
            const entry = await maps.save({ id, name, template, clientKey });
            logger.info('Map saved', { id: entry.id });
            return { id: entry.id, name: entry.name };
        }, { limiter: mapLimiter });

        on('maps:delete', async ({ id, clientKey }) => {
            await maps.remove({ id, clientKey });
        }, { limiter: mapLimiter });

        socket.on('disconnect', () => {
            sockets.delete(socket.id);
            const left = (connectionsPerIp.get(ip) || 1) - 1;
            if (left <= 0) connectionsPerIp.delete(ip);
            else connectionsPerIp.set(ip, left);
            const room = unbind(socket);
            if (room) rooms.changed(room);
        });
    });

    return { sockets };
}

// Game rooms: membership, host controls, lobby settings, bots/AFK automation
// and persistence. This module knows nothing about sockets; the socket layer
// calls into it and is notified of changes through `onChange`.
import { randomBytes, randomInt, createHash, timingSafeEqual } from 'node:crypto';
import { PLAYER_COLORS, LIMITS } from '../../shared/constants.js';
import { builtinTemplate, autoMapId } from '../../shared/templates.js';
import { Game } from '../engine/game.js';
import { GameError } from '../engine/errors.js';
import { viewFor } from '../engine/view.js';
import { chooseAction, tradeResponse } from '../engine/bot.js';
import { normalizeSettings, DEFAULT_SETTINGS } from '../engine/settings.js';
import { secureRng } from '../engine/rng.js';
import { cleanName } from './mapStore.js';

export class RoomError extends Error {}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;
const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const MAX_CHAT = 60;
const BOT_NAMES = ['Ada', 'Basil', 'Clover', 'Dorian', 'Ember', 'Fern', 'Gale', 'Hazel', 'Iris', 'Juniper'];
const MAX_AUTO_ACTIONS_PER_TURN = 120;

const hash = (s) => createHash('sha256').update(s).digest('hex');
const newId = () => randomBytes(6).toString('hex');

export function normalizeCode(code) {
    if (typeof code !== 'string') return null;
    const c = code.trim().toUpperCase();
    return CODE_RE.test(c) ? c : null;
}

function generateCode(taken) {
    for (;;) {
        let code = '';
        for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
        if (!taken.has(code)) return code;
    }
}

export function cleanPlayerName(name) {
    const n = cleanName(name, LIMITS.maxNameLength);
    if (!n) throw new RoomError('Please enter a name');
    return n;
}

export class Room {
    constructor({ code, settings, now = Date.now() }) {
        this.code = code;
        this.createdAt = now;
        this.lastActivity = now;
        this.hostId = null;
        this.settings = normalizeSettings(settings);
        this.members = []; // {id, name, color, tokenHash, isBot, left, socketId, connected, disconnectedAt}
        this.chat = [];
        this.chatSeq = 0;
        this.game = null;
        this.mapName = null;
        // Automation bookkeeping (not persisted).
        this.lastActionAt = now;
        this.autoCount = { turn: -1, n: 0 };
        this.failures = 0;
    }

    get status() {
        if (!this.game) return 'lobby';
        return this.game.state.phase === 'finished' ? 'finished' : 'playing';
    }

    touch(now = Date.now()) {
        this.lastActivity = now;
    }

    member(id) {
        return this.members.find((m) => m.id === id) || null;
    }

    memberByToken(token) {
        if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
        const h = Buffer.from(hash(token), 'hex');
        return this.members.find((m) => m.tokenHash && timingSafeEqual(Buffer.from(m.tokenHash, 'hex'), h)) || null;
    }

    requireHost(memberId) {
        if (memberId !== this.hostId) throw new RoomError('Only the host can do that');
    }

    requireLobby() {
        if (this.game) throw new RoomError('The game has already started');
    }

    humans() {
        return this.members.filter((m) => !m.isBot);
    }

    connectedHumans() {
        return this.members.filter((m) => !m.isBot && m.connected && !m.left);
    }

    addMember(rawName, { isBot = false } = {}) {
        this.requireLobby();
        if (this.members.length >= this.settings.maxPlayers) throw new RoomError('This game is full');
        const name = cleanPlayerName(rawName);
        if (this.members.some((m) => m.name.toLowerCase() === name.toLowerCase())) {
            throw new RoomError('That name is already taken in this game');
        }
        const used = new Set(this.members.map((m) => m.color));
        const color = PLAYER_COLORS.find((c) => !used.has(c));
        const token = isBot ? null : randomBytes(32).toString('base64url');
        const member = {
            id: newId(),
            name,
            color,
            tokenHash: token ? hash(token) : null,
            isBot,
            left: false,
            socketId: null,
            connected: isBot,
            disconnectedAt: null,
        };
        this.members.push(member);
        if (!this.hostId && !isBot) this.hostId = member.id;
        this.touch();
        return { member, token };
    }

    addBot(hostId) {
        this.requireHost(hostId);
        const taken = new Set(this.members.map((m) => m.name.toLowerCase()));
        const name = BOT_NAMES.map((n) => `${n} (bot)`).find((n) => !taken.has(n.toLowerCase())) || `Bot ${this.members.length + 1}`;
        return this.addMember(name, { isBot: true }).member;
    }

    removeMember(hostId, memberId) {
        this.requireHost(hostId);
        this.requireLobby();
        if (memberId === hostId) throw new RoomError('You cannot remove yourself');
        const m = this.member(memberId);
        if (!m) throw new RoomError('Player not found');
        this.members = this.members.filter((x) => x !== m);
        this.touch();
        return m;
    }

    /** A member leaves. In the lobby they are removed; in a game they are replaced by automation. */
    leave(memberId) {
        const m = this.member(memberId);
        if (!m) return null;
        if (!this.game) {
            this.members = this.members.filter((x) => x !== m);
        } else {
            m.left = true;
            m.connected = false;
            m.disconnectedAt = Date.now();
            m.tokenHash = null;
        }
        if (this.hostId === memberId) {
            const next = this.members.find((x) => !x.isBot && !x.left);
            this.hostId = next ? next.id : null;
        }
        // A game with only one player still in it is over: that player wins.
        // (Bots count as players, so a human can keep playing against bots.)
        if (this.game && this.game.state.phase !== 'finished') {
            const remaining = this.members.filter((x) => !x.left);
            if (remaining.length === 1) this.game.forfeitTo(remaining[0].id);
        }
        this.touch();
        return m;
    }

    setColor(memberId, color) {
        this.requireLobby();
        if (!PLAYER_COLORS.includes(color)) throw new RoomError('Unknown color');
        const m = this.member(memberId);
        if (!m) throw new RoomError('Player not found');
        if (this.members.some((x) => x !== m && x.color === color)) throw new RoomError('That color is taken');
        m.color = color;
        this.touch();
    }

    updateSettings(memberId, raw) {
        this.requireHost(memberId);
        this.requireLobby();
        const next = normalizeSettings(raw, this.settings);
        if (next.maxPlayers < this.members.length) next.maxPlayers = this.members.length;
        this.settings = next;
        this.touch();
    }

    addChat(memberId, text) {
        const m = this.member(memberId);
        if (!m) throw new RoomError('Player not found');
        const clean = cleanName(text, LIMITS.maxChatLength);
        if (!clean) return;
        this.chat.push({ id: ++this.chatSeq, from: m.id, name: m.name, color: m.color, text: clean, at: Date.now() });
        if (this.chat.length > MAX_CHAT) this.chat.shift();
        this.touch();
    }

    /**
     * Start the game.
     * @param {(mapId:string)=>{template:object,name:string}|null} resolveMap
     */
    start(memberId, resolveMap) {
        this.requireHost(memberId);
        this.requireLobby();
        if (this.members.length < 2) throw new RoomError('At least 2 players are needed (add a bot to play solo)');
        const n = this.members.length;
        let mapId = this.settings.map;
        if (mapId === 'auto') {
            mapId = this.settings.expansions.seafarers && n <= 4 ? 'islands' : autoMapId(n);
        }
        let template;
        let mapName;
        if (mapId.startsWith('custom:')) {
            const saved = resolveMap(mapId.slice(7));
            if (!saved) throw new RoomError('The selected map no longer exists');
            template = saved.template;
            mapName = saved.name;
        } else {
            template = builtinTemplate(mapId);
            mapName = mapId;
        }
        if (!template) throw new RoomError('Unknown map');
        this.game = Game.create({
            players: this.members.map((m) => ({ id: m.id, name: m.name, color: m.color })),
            settings: this.settings,
            template,
            rng: secureRng,
        });
        this.mapName = mapName;
        this.lastActionAt = Date.now();
        this.touch();
    }

    act(memberId, action) {
        if (!this.game) throw new RoomError('The game has not started');
        const m = this.member(memberId);
        if (!m || m.left) throw new RoomError('You are not in this game');
        this.game.act(memberId, action);
        this.lastActionAt = Date.now();
        this.touch();
    }

    /** Start a new game with the same players and settings. */
    rematch(memberId) {
        this.requireHost(memberId);
        if (this.status !== 'finished') throw new RoomError('The game is still running');
        this.members = this.members.filter((m) => !m.left);
        this.game = null;
        this.mapName = null;
        this.touch();
    }

    // ------------------------------------------------------------------
    // Automation: bots and disconnected players
    // ------------------------------------------------------------------

    /**
     * Perform at most one automated action if one is due.
     * @returns {{acted: boolean, delay: number|null}} delay until the next check (null = nothing pending)
     */
    automate({ now = Date.now(), botDelayMs, afkGraceMs, logger } = {}) {
        const game = this.game;
        if (!game || game.state.phase === 'finished') return { acted: false, delay: null };
        if (!this.connectedHumans().length) return { acted: false, delay: null };

        let soonest = null;
        const consider = (due, run) => {
            if (soonest === null || due < soonest.due) soonest = { due, run };
        };

        const w = game.waitingOn();
        for (const idx of w.players) {
            const m = this.member(game.state.players[idx].id);
            if (!m) continue;
            if (m.isBot) consider(this.lastActionAt + botDelayMs, () => this.autoAct(m, idx, false, logger));
            else if (m.left) consider(now, () => this.autoAct(m, idx, true, logger));
            else if (!m.connected) consider((m.disconnectedAt || now) + afkGraceMs, () => this.autoAct(m, idx, true, logger));
        }

        // Bots answer trade offers they are eligible for.
        if (w.kind === 'main') {
            for (const trade of game.state.trades) {
                for (let idx = 0; idx < game.state.players.length; idx++) {
                    if (idx === trade.from || (trade.to !== null && trade.to !== idx)) continue;
                    if (trade.accepted.includes(idx) || trade.rejected.includes(idx)) continue;
                    if (trade.from !== game.state.current && idx !== game.state.current) continue;
                    const m = this.member(game.state.players[idx].id);
                    if (!m || !m.isBot) continue;
                    consider(this.lastActionAt + botDelayMs, () => {
                        game.act(m.id, { type: 'respondTrade', id: trade.id, accept: tradeResponse(game, idx, trade) });
                    });
                }
                // A bot that made an offer confirms the first acceptance (or withdraws after a while).
                const owner = this.member(game.state.players[trade.from].id);
                if (owner?.isBot && trade.accepted.length) {
                    consider(this.lastActionAt + botDelayMs, () => game.act(owner.id, { type: 'confirmTrade', id: trade.id, partner: trade.accepted[0] }));
                }
            }
        }

        if (!soonest) return { acted: false, delay: null };
        if (soonest.due > now) return { acted: false, delay: soonest.due - now };
        try {
            soonest.run();
            this.failures = 0;
        } catch (err) {
            this.failures++;
            logger?.error('Automation failed', { room: this.code, error: err.message, stack: err.stack });
            this.lastActionAt = now;
            return { acted: false, delay: Math.min(30_000, 1000 * 2 ** this.failures) };
        }
        this.lastActionAt = now;
        this.touch(now);
        return { acted: true, delay: 0 };
    }

    autoAct(member, idx, passive, logger) {
        const game = this.game;
        if (this.autoCount.turn !== game.state.turn) this.autoCount = { turn: game.state.turn, n: 0 };
        this.autoCount.n++;
        const forcePassive = passive || this.autoCount.n > MAX_AUTO_ACTIONS_PER_TURN;
        let action = chooseAction(game, idx, { passive: forcePassive });
        if (!action) return;
        try {
            game.act(member.id, action);
        } catch (err) {
            if (!(err instanceof GameError) || forcePassive) throw err;
            logger?.warn('Bot action rejected, falling back to passive play', { room: this.code, action: action.type, error: err.message });
            action = chooseAction(game, idx, { passive: true });
            if (action) game.act(member.id, action);
        }
    }

    // ------------------------------------------------------------------
    // Views and persistence
    // ------------------------------------------------------------------

    viewFor(memberId) {
        return {
            room: {
                code: this.code,
                status: this.status,
                hostId: this.hostId,
                you: memberId,
                settings: this.settings,
                mapName: this.mapName,
                members: this.members.map((m) => ({
                    id: m.id,
                    name: m.name,
                    color: m.color,
                    isBot: m.isBot,
                    connected: m.isBot || m.connected,
                    left: m.left,
                })),
                chat: this.chat,
            },
            game: this.game ? viewFor(this.game, memberId) : null,
        };
    }

    toJSON() {
        return {
            code: this.code,
            createdAt: this.createdAt,
            lastActivity: this.lastActivity,
            hostId: this.hostId,
            settings: this.settings,
            members: this.members.map(({ id, name, color, tokenHash, isBot, left }) => ({ id, name, color, tokenHash, isBot, left })),
            chat: this.chat,
            chatSeq: this.chatSeq,
            mapName: this.mapName,
            game: this.game ? this.game.toJSON() : null,
        };
    }

    static fromJSON(data) {
        const code = normalizeCode(data.code);
        if (!code) throw new Error('Bad room code');
        const room = new Room({ code, settings: data.settings || DEFAULT_SETTINGS, now: data.createdAt });
        room.lastActivity = data.lastActivity;
        room.hostId = data.hostId;
        room.members = data.members.map((m) => ({ ...m, socketId: null, connected: !!m.isBot, disconnectedAt: Date.now() }));
        room.chat = Array.isArray(data.chat) ? data.chat : [];
        room.chatSeq = data.chatSeq || 0;
        room.mapName = data.mapName || null;
        room.game = data.game ? Game.fromJSON(data.game, secureRng) : null;
        return room;
    }
}

export class RoomManager {
    constructor({ config, logger, store = null, onChange = () => {} }) {
        this.config = config;
        this.logger = logger;
        this.store = store; // JsonDir or null
        this.onChange = onChange;
        this.rooms = new Map();
        this.timers = new Map();
        this.saveTimers = new Map();
    }

    async init() {
        if (!this.store) return;
        await this.store.init();
        const entries = await this.store.readAll((id, err) => this.logger.warn('Skipping unreadable room', { id, error: err.message }));
        for (const { id, data } of entries) {
            try {
                const room = Room.fromJSON(data);
                if (room.code !== id) continue;
                this.rooms.set(room.code, room);
            } catch (err) {
                this.logger.warn('Skipping invalid room', { id, error: err.message });
            }
        }
        this.logger.info('Restored rooms', { count: this.rooms.size });
    }

    get(code) {
        const c = normalizeCode(code);
        return c ? this.rooms.get(c) || null : null;
    }

    create(hostName, settings) {
        if (this.rooms.size >= this.config.maxRooms) throw new RoomError('The server is full, please try again later');
        const room = new Room({ code: generateCode(this.rooms), settings });
        const { member, token } = room.addMember(hostName);
        this.rooms.set(room.code, room);
        return { room, member, token };
    }

    delete(room, reason = 'closed') {
        this.rooms.delete(room.code);
        clearTimeout(this.timers.get(room.code));
        clearTimeout(this.saveTimers.get(room.code));
        this.timers.delete(room.code);
        this.saveTimers.delete(room.code);
        if (this.store) this.store.remove(room.code).catch((err) => this.logger.warn('Failed to remove room file', { error: err.message }));
        this.logger.info('Room closed', { room: room.code, reason });
    }

    /** Called after every change to a room: notify clients, persist, and schedule automation. */
    changed(room) {
        this.onChange(room);
        this.schedulePersist(room);
        this.scheduleAutomation(room);
    }

    scheduleAutomation(room, delay = null) {
        clearTimeout(this.timers.get(room.code));
        const run = () => {
            if (!this.rooms.has(room.code)) return;
            const res = room.automate({
                botDelayMs: this.config.botDelayMs,
                afkGraceMs: this.config.afkGraceMs,
                logger: this.logger,
            });
            if (res.acted) {
                this.onChange(room);
                this.schedulePersist(room);
            }
            if (res.delay !== null) this.timers.set(room.code, setTimeout(run, res.delay));
            else this.timers.delete(room.code);
        };
        this.timers.set(room.code, setTimeout(run, delay ?? 0));
    }

    schedulePersist(room) {
        if (!this.store || this.saveTimers.has(room.code)) return;
        this.saveTimers.set(room.code, setTimeout(() => {
            this.saveTimers.delete(room.code);
            this.persist(room);
        }, 1000));
    }

    async persist(room) {
        if (!this.store || !this.rooms.has(room.code)) return;
        try {
            await this.store.write(room.code, room.toJSON());
        } catch (err) {
            this.logger.error('Failed to persist room', { room: room.code, error: err.message });
        }
    }

    async flush() {
        for (const [code, t] of this.saveTimers) {
            clearTimeout(t);
            this.saveTimers.delete(code);
        }
        await Promise.all([...this.rooms.values()].map((r) => this.persist(r)));
    }

    stop() {
        for (const t of this.timers.values()) clearTimeout(t);
        this.timers.clear();
    }

    /** Remove idle rooms. */
    sweep(now = Date.now()) {
        const MIN = 60_000;
        for (const room of [...this.rooms.values()]) {
            const idle = now - room.lastActivity;
            const anyone = room.connectedHumans().length > 0;
            let limit;
            if (room.status === 'lobby') limit = anyone ? 6 * 60 * MIN : 30 * MIN;
            else if (room.status === 'finished') limit = anyone ? 3 * 60 * MIN : 30 * MIN;
            else limit = anyone ? 24 * 60 * MIN : 12 * 60 * MIN;
            if (idle > limit || !room.humans().some((m) => !m.left)) this.delete(room, 'idle');
        }
    }

    /** Resume automation for restored rooms (e.g. after a restart). */
    resumeAll() {
        for (const room of this.rooms.values()) this.scheduleAutomation(room);
    }
}

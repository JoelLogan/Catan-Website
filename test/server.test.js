import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { io as ioClient } from 'socket.io-client';
import { createServer } from '../src/server/index.js';
import { loadConfig } from '../src/server/config.js';
import { builtinTemplate } from '../shared/templates.js';

let srv;
let url;
let dataDir;
const clients = [];
const tempDirs = [];

async function start(overrides = {}) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'catan-test-'));
    tempDirs.push(dir);
    const config = { ...loadConfig({}), dataDir: dir, logLevel: 'silent', botDelayMs: 5, afkGraceMs: 50, joinBurst: 1000, ...overrides };
    const s = await createServer(config);
    await new Promise((r) => s.server.listen(0, '127.0.0.1', r));
    return { s, url: `http://127.0.0.1:${s.server.address().port}`, dir };
}

function connect(opts = {}) {
    return new Promise((resolve, reject) => {
        const c = ioClient(url, { transports: ['websocket'], forceNew: true, reconnection: false, ...opts });
        clients.push(c);
        c.states = [];
        c.on('room:state', (st) => c.states.push(st));
        c.on('connect', () => resolve(c));
        c.on('connect_error', reject);
    });
}

const call = (c, event, payload = {}) => new Promise((resolve) => c.emit(event, payload, resolve));
const lastState = (c) => c.states[c.states.length - 1];
async function waitFor(fn, ms = 3000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        const v = fn();
        if (v) return v;
        await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('timed out');
}

before(async () => {
    ({ s: srv, url, dir: dataDir } = await start());
});

after(async () => {
    for (const c of clients) c.close();
    await srv.close();
    for (const dir of tempDirs) await fs.rm(dir, { recursive: true, force: true });
});

describe('http', () => {
    test('serves the app with security headers', async () => {
        const res = await fetch(`${url}/`);
        assert.equal(res.status, 200);
        const csp = res.headers.get('content-security-policy');
        assert.match(csp, /default-src 'self'/);
        assert.match(csp, /script-src 'self'/);
        assert.doesNotMatch(csp, /unsafe-inline/);
        assert.equal(res.headers.get('x-powered-by'), null);
        assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    });

    test('does not expose server code, config or data', async () => {
        for (const p of ['/server.js', '/src/index.js', '/src/server/rooms.js', '/package.json', '/data/', '/.env', '/../package.json', '/%2e%2e/package.json', '/.git/config']) {
            const res = await fetch(`${url}${p}`);
            assert.equal(res.status, 404, p);
        }
        assert.equal((await fetch(`${url}/shared/hex.js`)).status, 200);
        assert.equal((await fetch(`${url}/healthz`)).status, 200);
    });
});

describe('rooms', () => {
    test('create, join, resume with token only, and XSS-y names are plain data', async () => {
        const host = await connect();
        const created = await call(host, 'room:create', { name: '<b onclick=x>hi</b>', settings: { maxPlayers: 3 } });
        assert.equal(created.ok, true);
        assert.match(created.code, /^[A-Z2-9]{6}$/);
        const guest = await connect();
        const bad = await call(guest, 'room:join', { code: 'ZZZZZZ', name: 'Bob' });
        assert.equal(bad.ok, false);
        const dup = await call(guest, 'room:join', { code: created.code, name: '<B ONCLICK=X>HI</B>' });
        assert.equal(dup.ok, false, 'names are unique case-insensitively');
        const joined = await call(guest, 'room:join', { code: created.code.toLowerCase(), name: 'Bob' });
        assert.equal(joined.ok, true);
        await waitFor(() => lastState(host)?.room.members.length === 2);
        // The host's name is transmitted as data; the client renders it with textContent.
        assert.equal(lastState(host).room.members[0].name, '<b onclick=x>hi</b>');

        // Knowing the name is not enough to take over a seat.
        const thief = await connect();
        assert.equal((await call(thief, 'room:resume', { code: created.code, token: 'x'.repeat(43) })).ok, false);
        assert.equal((await call(thief, 'room:resume', { code: created.code, name: 'Bob' })).ok, false);
        // The real token works, and the old tab is told it was replaced.
        const again = await connect();
        const closed = new Promise((r) => guest.once('room:closed', r));
        assert.equal((await call(again, 'room:resume', { code: created.code, token: joined.token })).ok, true);
        await closed;
    });

    test('only the host can change settings, kick, add bots and start', async () => {
        const host = await connect();
        const { code } = await call(host, 'room:create', { name: 'Host' });
        const guest = await connect();
        await call(guest, 'room:join', { code, name: 'Guest' });
        for (const [ev, p] of [['room:settings', { settings: { victoryPoints: 3 } }], ['room:addBot', {}], ['room:start', {}], ['room:kick', { memberId: 'x' }]]) {
            const r = await call(guest, ev, p);
            assert.equal(r.ok, false, ev);
            assert.match(r.error, /host/i);
        }
        assert.equal((await call(host, 'room:settings', { settings: { victoryPoints: 1000, maxPlayers: 1, expansions: { seafarers: 'yes' } } })).ok, true);
        const st = await waitFor(() => lastState(host)?.room.settings.victoryPoints === 30 && lastState(host));
        assert.equal(st.room.settings.maxPlayers, 2, 'max players never drops below current members');
        assert.equal(st.room.settings.expansions.seafarers, false);
        const guestId = st.room.members[1].id;
        const kickedMsg = new Promise((r) => guest.once('room:closed', r));
        assert.equal((await call(host, 'room:kick', { memberId: guestId })).ok, true);
        await kickedMsg;
        assert.equal((await call(guest, 'room:chat', { text: 'hi' })).ok, false);
    });

    test('a solo host can play a full game against bots', async () => {
        // A bot-driven "human" acts far faster than people do, so use a separate server without the event limit.
        const { s, url: u } = await start({ eventBurst: 100_000, eventPerSecond: 100_000 });
        const saved = url;
        const mainSrv = srv;
        url = u;
        srv = s;
        try {
            await soloGame();
        } finally {
            url = saved;
            srv = mainSrv;
            await s.close();
        }
    });

    async function soloGame() {
        const host = await connect();
        const { code } = await call(host, 'room:create', { name: 'Solo', settings: { victoryPoints: 5 } });
        assert.ok(code);
        assert.equal((await call(host, 'room:start')).ok, false, 'needs two players');
        assert.equal((await call(host, 'room:addBot')).ok, true);
        assert.equal((await call(host, 'room:addBot')).ok, true);
        assert.equal((await call(host, 'room:start')).ok, true);
        // Drive the host with the same bot logic, one acknowledged action at a time.
        const { chooseAction } = await import('../src/engine/bot.js');
        const room = srv.rooms.get(code);
        const me = room.members[0].id;
        const deadline = Date.now() + 60_000;
        while (room.game.state.phase !== 'finished') {
            assert.ok(Date.now() < deadline, 'game did not finish in time');
            const g = room.game;
            const idx = g.playerIndex(me);
            if (g.waitingOn().players.includes(idx)) {
                const res = await call(host, 'game:action', { action: chooseAction(g, idx) });
                assert.equal(res.ok, true, res.error);
            } else {
                await new Promise((r) => setTimeout(r, 5));
            }
        }
        const st = await waitFor(() => lastState(host)?.game?.phase === 'finished' && lastState(host));
        assert.ok(st.game.winner !== null);
        const rematch = await call(host, 'room:rematch');
        assert.equal(rematch.ok, true, rematch.error);
        host.close();
    }

    test('when everyone else leaves, the last player wins', async () => {
        const host = await connect();
        const { code } = await call(host, 'room:create', { name: 'Stayer' });
        const guest = await connect();
        await call(guest, 'room:join', { code, name: 'Quitter' });
        assert.equal((await call(host, 'room:start')).ok, true);
        assert.equal((await call(guest, 'room:leave')).ok, true);
        const st = await waitFor(() => lastState(host)?.game?.phase === 'finished' && lastState(host));
        assert.equal(st.game.players[st.game.winner].name, 'Stayer');
        assert.equal(st.game.endReason, 'forfeit');
        host.close();
    });

    test('a human who leaves while bots remain does not end the game', async () => {
        const host = await connect();
        const { code } = await call(host, 'room:create', { name: 'Solo2' });
        const guest = await connect();
        await call(guest, 'room:join', { code, name: 'Leaver2' });
        await call(host, 'room:addBot');
        await call(host, 'room:start');
        await call(guest, 'room:leave');
        const room = srv.rooms.get(code);
        assert.notEqual(room.game.state.phase, 'finished');
        host.close();
    });

    test('game actions are validated and errors reported', async () => {
        const host = await connect();
        const { code } = await call(host, 'room:create', { name: 'H' });
        await call(host, 'room:addBot');
        await call(host, 'room:start');
        for (const payload of [{}, { action: null }, { action: 'rollDice' }, { action: { type: 'constructor' } }, { action: { type: 'build', piece: 'city', at: '0,0' } }]) {
            const r = await call(host, 'game:action', payload);
            assert.equal(r.ok, false);
            assert.equal(typeof r.error, 'string');
        }
        assert.ok(srv.rooms.get(code));
    });

    test('disconnected players are played automatically after the grace period', async () => {
        const host = await connect();
        const { code } = await call(host, 'room:create', { name: 'Stays' });
        const guest = await connect();
        await call(guest, 'room:join', { code, name: 'Leaves' });
        await call(host, 'room:settings', { settings: { randomizeTurnOrder: false } });
        await call(host, 'room:start');
        const room = srv.rooms.get(code);
        guest.close();
        // Host places setup pieces; when it's the guest's turn the server acts for them.
        const { chooseAction } = await import('../src/engine/bot.js');
        await waitFor(() => {
            const g = room.game;
            if (g.state.phase !== 'setup') return true;
            const idx = g.playerIndex(room.members[0].id);
            if (g.waitingOn().players.includes(idx)) host.emit('game:action', { action: chooseAction(g, idx) }, () => {});
            return false;
        }, 10_000);
        assert.equal(room.game.state.phase, 'preRoll');
    });
});

describe('maps', () => {
    const key = 'k'.repeat(40);
    const other = 'o'.repeat(40);

    test('save, list, load, overwrite protection, delete', async () => {
        const c = await connect();
        const template = builtinTemplate('standard');
        const saved = await call(c, 'maps:save', { name: '../../package', template, clientKey: key });
        assert.equal(saved.ok, true);
        assert.match(saved.id, /^[a-f0-9]{16}$/);
        // The name never becomes a path.
        await assert.rejects(fs.access(path.join(dataDir, 'package.json')));
        const files = await fs.readdir(path.join(dataDir, 'maps'));
        assert.deepEqual(files, [`${saved.id}.json`]);

        const list = await call(c, 'maps:list', { clientKey: key });
        assert.equal(list.maps[0].mine, true);
        assert.equal((await call(c, 'maps:list', { clientKey: other })).maps[0].mine, false);
        const loaded = await call(c, 'maps:get', { id: saved.id });
        assert.deepEqual(loaded.template, template);

        assert.equal((await call(c, 'maps:save', { id: saved.id, name: 'x', template, clientKey: other })).ok, false);
        assert.equal((await call(c, 'maps:delete', { id: saved.id, clientKey: other })).ok, false);
        assert.equal((await call(c, 'maps:delete', { id: saved.id, clientKey: key })).ok, true);
        assert.equal((await call(c, 'maps:get', { id: '../../etc/passwd' })).ok, false);
    });

    test('invalid templates are rejected', async () => {
        const c = await connect();
        for (const template of [null, {}, { hexes: 'x' }, { hexes: [{ q: 0, r: 0, t: 'lava' }] }, { hexes: Array.from({ length: 500 }, (_, i) => ({ q: i, r: 0, t: 'land' })) }]) {
            const r = await call(c, 'maps:save', { name: 'bad', template, clientKey: key });
            assert.equal(r.ok, false);
        }
    });
});

describe('abuse protection', () => {
    test('cross-origin socket connections are refused', async () => {
        await assert.rejects(connect({ extraHeaders: { origin: 'https://evil.example' }, transports: ['polling'] }));
    });

    test('room code guessing is rate limited per address', async () => {
        const { s, url: u } = await start({ joinBurst: 5 });
        const saved = url;
        url = u;
        const c = await connect();
        const results = [];
        for (let i = 0; i < 8; i++) results.push(await call(c, 'room:join', { code: 'ABCDEF', name: 'x' }));
        assert.ok(results.slice(0, 5).every((r) => /No game found/.test(r.error)));
        assert.ok(results.slice(5).every((r) => /too often/.test(r.error)));
        c.close();
        await s.close();
        url = saved;
    });

    test('event flooding is rate limited', async () => {
        const c = await connect();
        const results = await Promise.all(Array.from({ length: 80 }, () => call(c, 'maps:list', {})));
        assert.ok(results.some((r) => !r.ok && /too often/.test(r.error)));
    });

    test('oversized payloads disconnect the client', async () => {
        const c = await connect();
        const gone = new Promise((r) => c.once('disconnect', r));
        c.emit('maps:save', { name: 'x', template: { hexes: 'x'.repeat(200_000) } }, () => {});
        await gone;
    });
});

describe('persistence', () => {
    test('rooms survive a server restart', async () => {
        const { s, url: u } = await start();
        const saveUrl = url;
        url = u;
        const host = await connect();
        const { code, token } = await call(host, 'room:create', { name: 'Persist' });
        await call(host, 'room:addBot');
        await call(host, 'room:start');
        host.close();
        const dir = s.rooms.store.dir;
        await s.close();
        const config = { ...loadConfig({}), dataDir: path.dirname(dir), logLevel: 'silent' };
        const s2 = await createServer(config);
        await new Promise((r) => s2.server.listen(0, '127.0.0.1', r));
        url = `http://127.0.0.1:${s2.server.address().port}`;
        const back = await connect();
        const r = await call(back, 'room:resume', { code, token });
        assert.equal(r.ok, true);
        const st = await waitFor(() => lastState(back));
        assert.equal(st.room.status, 'playing');
        back.close();
        await s2.close();
        url = saveUrl;
    });
});

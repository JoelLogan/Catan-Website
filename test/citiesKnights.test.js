import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, idOf, cardTotals, checkInvariants } from './helpers.js';
import { chooseAction } from '../src/engine/bot.js';
import { viewFor } from '../src/engine/view.js';
import { GameError } from '../src/engine/errors.js';
import { PROGRESS_DECKS } from '../src/engine/ck.js';

const act = (g, i, a) => g.act(idOf(g, i), a);
const rejects = (fn, re) => assert.throws(fn, (e) => e instanceof GameError && (!re || re.test(e.message)));

function ckGame(opts = {}) {
    return newGame({ players: 3, ...opts, settings: { expansions: { citiesKnights: true }, victoryPoints: 13, ...(opts.settings || {}) } });
}

function completeSetup(g) {
    while (g.state.phase === 'setup' || g.hasPending()) {
        const me = g.waitingOn().players[0];
        act(g, me, chooseAction(g, me));
    }
}

function resolveAll(g) {
    for (let i = 0; i < 50 && g.hasPending(); i++) {
        const me = g.waitingOn().players[0];
        act(g, me, chooseAction(g, me));
    }
}

function setHand(g, idx, hand) {
    const p = g.state.players[idx];
    for (const k in p.hand) {
        g.state.bank[k] += p.hand[k];
        p.hand[k] = 0;
    }
    for (const k in hand) {
        g.state.bank[k] -= hand[k];
        p.hand[k] = hand[k];
    }
}

function rig(g, values) {
    const orig = g.rng;
    const q = [...values];
    g.rng = { int(n) { if (q.length) return q.shift(); g.rng = orig; return orig.int(n); } };
}

function toMain(g) {
    completeSetup(g);
    rig(g, [0, 2, 3]); // yellow 1, red 3 => 4, trade gate
    act(g, 0, { type: 'rollDice' });
    resolveAll(g);
    assert.equal(g.state.phase, 'main');
}

describe('cities & knights basics', () => {
    test('setup places a city in the second round; no dev cards', () => {
        const g = ckGame();
        completeSetup(g);
        for (let i = 0; i < 3; i++) {
            const types = Object.values(g.state.buildings).filter((b) => b.owner === i).map((b) => b.type).sort();
            assert.deepEqual(types, ['city', 'settlement']);
        }
        assert.equal(g.state.devDeck.length, 0);
        toMain(g);
        setHand(g, 0, { sheep: 1, wheat: 1, ore: 1 });
        rejects(() => act(g, 0, { type: 'buyDevCard' }), /no development cards/);
    });

    test('city production yields commodities', () => {
        const g = ckGame();
        completeSetup(g);
        const city = Object.keys(g.state.buildings).find((v) => g.state.buildings[v].type === 'city' && g.state.buildings[v].owner === 0);
        const hex = g.graph.vertices.get(city).hexes.find((h) => ['forest', 'pasture', 'mountains'].includes(g.state.board.hexes[h].terrain));
        if (hex === undefined) return;
        g.state.robber = null;
        const before = { ...g.state.players[0].hand };
        g.produce(g.state.board.hexes[hex].number);
        const com = { forest: 'paper', pasture: 'cloth', mountains: 'coin' }[g.state.board.hexes[hex].terrain];
        assert.ok(g.state.players[0].hand[com] > before[com]);
    });

    test('robber is inactive until the first barbarian attack', () => {
        const g = ckGame();
        completeSetup(g);
        rig(g, [2, 3, 0]); // 3 + 4 = 7, ship
        act(g, 0, { type: 'rollDice' });
        resolveAll(g);
        assert.equal(g.state.pending.robber, null);
        assert.equal(g.state.phase, 'main');
    });
});

describe('knights and barbarians', () => {
    test('active knights move along roads and displace weaker knights', () => {
        const g = ckGame();
        toMain(g);
        const s = g.state;
        // Extend one of player 0's roads so there are two empty spots in a row.
        const road = Object.keys(s.roads).find((e) => s.roads[e].owner === 0);
        const x = road.split('|').find((v) => !s.buildings[v]);
        const next = g.graph.vertices.get(x).edges.find((e) => e !== road && g.canPlaceRoad(0, e) &&
            !g.vertexOccupied(e.split('|').find((v) => v !== x)));
        s.roads[next] = { owner: 0, type: 'road', turn: 0 };
        const y = next.split('|').find((v) => v !== x);
        s.knights[x] = { owner: 0, level: 2, active: true, activatedTurn: null, actedTurn: null, promotedTurn: null };
        s.knights[y] = { owner: 1, level: 2, active: false, activatedTurn: null, actedTurn: null, promotedTurn: null };
        rejects(() => act(g, 0, { type: 'moveKnight', from: x, to: y }), /weaker/);
        s.knights[y].level = 1;
        act(g, 0, { type: 'moveKnight', from: x, to: y });
        assert.equal(s.knights[y].owner, 0);
        assert.equal(s.knights[y].active, false, 'acting deactivates the knight');
        assert.equal(s.knights[x], undefined);
        resolveAll(g);
        assert.equal(Object.values(s.knights).filter((k) => k.owner === 1).length <= 1, true);
        rejects(() => act(g, 0, { type: 'moveKnight', from: y, to: x }), /active/);
    });

    test('build, activate, promote', () => {
        const g = ckGame();
        toMain(g);
        const spots = () => viewFor(g, idOf(g, 0)).legal.knightSpots;
        setHand(g, 0, { sheep: 5, ore: 5, wheat: 3 });
        const at = spots()[0];
        act(g, 0, { type: 'buildKnight', at });
        assert.deepEqual(g.state.knights[at], { owner: 0, level: 1, active: false, activatedTurn: null, actedTurn: null, promotedTurn: null });
        act(g, 0, { type: 'activateKnight', at });
        rejects(() => act(g, 0, { type: 'activateKnight', at }), /already active/);
        act(g, 0, { type: 'promoteKnight', at });
        rejects(() => act(g, 0, { type: 'promoteKnight', at }), /once per turn/);
        assert.equal(g.state.knights[at].level, 2);
        // Activated this turn -> cannot move yet.
        const moves = viewFor(g, idOf(g, 0)).legal.knightMoves;
        assert.equal(moves[at], undefined);
        // Settlements cannot be built on a knight's spot.
        assert.equal(g.canPlaceSettlement(0, at), false);
        // Mighty requires a fortress.
        g.state.knights[at].promotedTurn = null;
        rejects(() => act(g, 0, { type: 'promoteKnight', at }), /Fortress/);
    });

    test('barbarian attack: defenders win and a defender is named', () => {
        const g = ckGame();
        toMain(g);
        g.state.ck.barbarian = 6;
        // Give player 0 a strong active knight so defense >= number of cities (3).
        const spot = viewFor(g, idOf(g, 0)).legal.knightSpots[0];
        g.state.knights[spot] = { owner: 0, level: 3, active: true, activatedTurn: null, actedTurn: null, promotedTurn: null };
        act(g, 0, { type: 'endTurn' });
        rig(g, [0, 2, 0]); // 1 + 3 = 4, ship -> attack
        act(g, 1, { type: 'rollDice' });
        resolveAll(g);
        assert.equal(g.state.ck.attacks, 1);
        assert.equal(g.state.ck.barbarian, 0);
        assert.equal(g.state.players[0].ck.defender, 1);
        assert.equal(g.state.knights[spot].active, false, 'knights are deactivated after an attack');
    });

    test('barbarian attack: barbarians win and weakest players lose a city', () => {
        const g = ckGame();
        toMain(g);
        g.state.ck.barbarian = 6;
        const spot = viewFor(g, idOf(g, 0)).legal.knightSpots[0];
        g.state.knights[spot] = { owner: 0, level: 1, active: true, activatedTurn: null, actedTurn: null, promotedTurn: null };
        act(g, 0, { type: 'endTurn' });
        rig(g, [0, 2, 0]);
        act(g, 1, { type: 'rollDice' });
        resolveAll(g);
        const citiesOf = (i) => Object.values(g.state.buildings).filter((b) => b.owner === i && b.type === 'city').length;
        assert.equal(citiesOf(0), 1, 'player with the knight keeps the city');
        assert.equal(citiesOf(1), 0);
        assert.equal(citiesOf(2), 0);
    });
});

describe('improvements and metropolis', () => {
    test('improving costs commodities, level 3 abilities, metropolis at 4', () => {
        const g = ckGame();
        toMain(g);
        setHand(g, 0, { paper: 10 });
        for (let lvl = 1; lvl <= 4; lvl++) act(g, 0, { type: 'improveCity', track: 'science' });
        assert.equal(g.state.players[0].ck.improvements.science, 4);
        assert.equal(g.state.players[0].hand.paper, 0);
        assert.equal(g.state.ck.metropolis.science.owner, 0);
        // City (2) + settlement (1) + metropolis (2)
        assert.equal(g.victoryPoints(0), 5);
        rejects(() => act(g, 0, { type: 'improveCity', track: 'science' }), /enough/);
        // Another player reaching level 5 takes the metropolis.
        g.state.players[0].ck.improvements.science = 4;
        g.state.players[1].ck.improvements.science = 4;
        act(g, 0, { type: 'endTurn' });
        rig(g, [0, 2, 3]);
        act(g, 1, { type: 'rollDice' });
        resolveAll(g);
        setHand(g, 1, { paper: 5 });
        act(g, 1, { type: 'improveCity', track: 'science' });
        assert.equal(g.state.ck.metropolis.science.owner, 1);
    });

    test('trading house gives 2:1 commodity trades; walls raise hand limit', () => {
        const g = ckGame();
        toMain(g);
        g.state.players[0].ck.improvements.trade = 3;
        assert.equal(g.portRatios(0).coin, 2);
        const city = Object.keys(g.state.buildings).find((v) => g.state.buildings[v].owner === 0 && g.state.buildings[v].type === 'city');
        setHand(g, 0, { brick: 2 });
        act(g, 0, { type: 'buildCityWall', at: city });
        assert.equal(g.handLimit(0), 9);
        rejects(() => act(g, 0, { type: 'buildCityWall', at: city }), /already has a wall/);
    });
});

describe('progress cards', () => {
    function withCard(type, setup) {
        const g = ckGame();
        toMain(g);
        const track = Object.keys(PROGRESS_DECKS).find((t) => PROGRESS_DECKS[t][type]);
        const deck = g.state.ck.decks[track];
        const i = deck.findIndex((c) => c.type === type);
        const [card] = deck.splice(i, 1);
        g.state.players[0].ck.progress.push(card);
        if (setup) setup(g);
        return g;
    }

    const cases = {
        crane: [null, { }],
        engineer: [null, (g) => ({ at: Object.keys(g.state.buildings).find((v) => g.state.buildings[v].owner === 0 && g.state.buildings[v].type === 'city') })],
        inventor: [null, (g) => {
            const idx = g.state.board.hexes.map((h, i) => (h.number && ![2, 12, 6, 8].includes(h.number) ? i : -1)).filter((i) => i >= 0);
            return { hexes: [idx[0], idx[1]] };
        }],
        irrigation: [null, {}],
        mining: [null, {}],
        medicine: [(g) => setHand(g, 0, { ore: 2, wheat: 1 }), (g) => ({ at: Object.keys(g.state.buildings).find((v) => g.state.buildings[v].owner === 0 && g.state.buildings[v].type === 'settlement') })],
        roadBuilding: [null, {}],
        smith: [(g) => {
            const spot = viewFor(g, idOf(g, 0)).legal.knightSpots[0];
            g.state.knights[spot] = { owner: 0, level: 1, active: false, activatedTurn: null, actedTurn: null, promotedTurn: null };
        }, (g) => ({ knights: Object.keys(g.state.knights) })],
        commercialHarbor: [(g) => { setHand(g, 0, { wood: 2 }); setHand(g, 1, { coin: 1 }); setHand(g, 2, {}); }, { offers: { 1: 'wood', 2: 'wood' } }],
        masterMerchant: [(g) => { g.state.players[1].ck.defender = 3; setHand(g, 1, { ore: 3 }); }, { target: 1 }],
        merchant: [null, (g) => {
            const hex = g.state.board.hexes.findIndex((h, i) => ['forest', 'hills', 'pasture', 'fields', 'mountains'].includes(h.terrain) &&
                g.hexVertices(i).some((v) => g.state.buildings[v]?.owner === 0));
            return { hex };
        }],
        merchantFleet: [null, { resource: 'wood' }],
        resourceMonopoly: [(g) => { setHand(g, 1, { ore: 3 }); setHand(g, 2, { ore: 1 }); }, { resource: 'ore' }],
        tradeMonopoly: [(g) => { setHand(g, 1, { cloth: 3 }); }, { resource: 'cloth' }],
        bishop: [(g) => { g.state.ck.attacks = 1; }, {}],
        deserter: [(g) => {
            const spot = viewFor(g, idOf(g, 1)).legal?.knightSpots?.[0] ||
                [...g.graph.vertices.keys()].find((v) => !g.vertexOccupied(v) && g.graph.vertices.get(v).edges.some((e) => g.state.roads[e]?.owner === 1));
            g.state.knights[spot] = { owner: 1, level: 2, active: true, activatedTurn: null, actedTurn: null, promotedTurn: null };
        }, { target: 1 }],
        diplomat: [null, (g) => ({ edge: Object.keys(g.state.roads).find((e) => g.state.roads[e].owner === 1) })],
        intrigue: [(g) => {
            const v = [...g.graph.vertices.keys()].find((x) => !g.vertexOccupied(x) && g.graph.vertices.get(x).edges.some((e) => g.state.roads[e]?.owner === 0));
            g.state.knights[v] = { owner: 1, level: 1, active: false, activatedTurn: null, actedTurn: null, promotedTurn: null };
        }, (g) => ({ at: Object.keys(g.state.knights).find((v) => g.state.knights[v].owner === 1) })],
        saboteur: [(g) => { setHand(g, 1, { wood: 4 }); }, {}],
        spy: [(g) => {
            const [c] = g.state.ck.decks.science.splice(g.state.ck.decks.science.findIndex((x) => x.type === 'crane'), 1);
            g.state.players[1].ck.progress.push(c);
        }, { target: 1 }],
        warlord: [(g) => {
            const spot = viewFor(g, idOf(g, 0)).legal.knightSpots[0];
            g.state.knights[spot] = { owner: 0, level: 1, active: false, activatedTurn: null, actedTurn: null, promotedTurn: null };
        }, {}],
        wedding: [(g) => { g.state.players[1].ck.defender = 3; setHand(g, 1, { wood: 1, ore: 2 }); }, {}],
    };

    for (const [type, [setup, params]] of Object.entries(cases)) {
        test(`${type} can be played and resolved`, () => {
            const g = withCard(type, setup);
            const totals = cardTotals(g);
            const extra = typeof params === 'function' ? params(g) : params;
            const before = JSON.stringify(g.state.players.map((p) => p.hand));
            act(g, 0, { type: 'playProgress', card: type, ...extra });
            assert.equal(g.state.players[0].ck.progress.some((c) => c.type === type), false, 'card leaves the hand');
            // Resolve any follow-ups (prompts, robber, free roads) with bot choices.
            for (let i = 0; i < 20 && g.waitingOn().kind !== 'main'; i++) {
                const me = g.waitingOn().players[0];
                act(g, me, chooseAction(g, me));
            }
            assert.equal(g.waitingOn().kind, 'main');
            checkInvariants(g, totals);
            void before;
        });
    }

    test('specific effects', () => {
        let g = withCard('resourceMonopoly', (x) => { setHand(x, 0, {}); setHand(x, 1, { ore: 3 }); setHand(x, 2, { ore: 1 }); });
        act(g, 0, { type: 'playProgress', card: 'resourceMonopoly', resource: 'ore' });
        assert.equal(g.state.players[0].hand.ore, 3);

        g = withCard('commercialHarbor', (x) => { setHand(x, 0, { wood: 1 }); setHand(x, 1, { coin: 1 }); });
        act(g, 0, { type: 'playProgress', card: 'commercialHarbor', offers: { 1: 'wood' } });
        const prompt = g.state.ck.prompts[0];
        rejects(() => act(g, 1, { type: 'resolvePrompt', id: prompt.id, commodity: 'paper' }));
        act(g, 1, { type: 'resolvePrompt', id: prompt.id, commodity: 'coin' });
        assert.equal(g.state.players[0].hand.coin, 1);
        assert.equal(g.state.players[1].hand.wood, 1);

        g = withCard('alchemist');
        act(g, 0, { type: 'endTurn' });
        for (const i of [1, 2]) {
            rig(g, [0, 2, 3]);
            act(g, i, { type: 'rollDice' });
            resolveAll(g);
            act(g, i, { type: 'endTurn' });
        }
        rejects(() => act(g, 0, { type: 'playProgress', card: 'alchemist', dice: [7, 1] }));
        act(g, 0, { type: 'playProgress', card: 'alchemist', dice: [2, 3] });
        assert.deepEqual(g.state.lastRoll.dice, [2, 3]);

        g = withCard('inventor');
        const six = g.state.board.hexes.findIndex((h) => h.number === 6);
        const five = g.state.board.hexes.findIndex((h) => h.number === 5);
        rejects(() => act(g, 0, { type: 'playProgress', card: 'inventor', hexes: [six, five] }), /other than/);
        assert.equal(g.state.players[0].ck.progress.length, 1, 'invalid play keeps the card');
    });

    test('prototype property names are rejected as locations', () => {
        const g = ckGame();
        toMain(g);
        for (const type of Object.keys(PROGRESS_DECKS.politics).concat(Object.keys(PROGRESS_DECKS.science), Object.keys(PROGRESS_DECKS.trade))) {
            const deck = Object.values(g.state.ck.decks).find((d) => d.some((c) => c.type === type));
            const i = deck.findIndex((c) => c.type === type);
            g.state.players[0].ck.progress.push(deck.splice(i, 1)[0]);
        }
        setHand(g, 0, { wood: 5, brick: 5, sheep: 5, wheat: 5, ore: 5, paper: 5, cloth: 5, coin: 5 });
        const snapshot = JSON.stringify(g.state);
        for (const bad of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
            for (const action of [
                { type: 'buildKnight', at: bad }, { type: 'promoteKnight', at: bad }, { type: 'activateKnight', at: bad },
                { type: 'moveKnight', from: bad, to: bad }, { type: 'chaseRobber', at: bad }, { type: 'buildCityWall', at: bad },
                { type: 'playProgress', card: 'intrigue', at: bad }, { type: 'playProgress', card: 'engineer', at: bad },
                { type: 'playProgress', card: 'medicine', at: bad }, { type: 'playProgress', card: 'smith', knights: [bad] },
                { type: 'playProgress', card: 'diplomat', edge: bad }, { type: 'build', piece: 'city', at: bad },
                { type: 'playProgress', card: bad },
            ]) {
                rejects(() => act(g, 0, action));
            }
        }
        assert.equal(JSON.stringify(g.state), snapshot);
    });

    test('progress hand limit is enforced at end of turn', () => {
        const g = ckGame();
        toMain(g);
        for (let i = 0; i < 5; i++) g.state.players[0].ck.progress.push(g.state.ck.decks.trade.pop());
        rejects(() => act(g, 0, { type: 'endTurn' }), /at most 4/);
        act(g, 0, { type: 'discardProgress', card: g.state.players[0].ck.progress[0].id });
        act(g, 0, { type: 'endTurn' });
    });

    test('other players see only card counts', () => {
        const g = ckGame();
        toMain(g);
        g.state.players[0].ck.progress.push(g.state.ck.decks.trade.pop());
        const other = viewFor(g, idOf(g, 1));
        assert.equal(other.ck.players[0].progressCount, 1);
        assert.equal(other.ck.progress.length, 0);
        assert.equal(JSON.stringify(other).includes('"decks"'), false);
    });
});


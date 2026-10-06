import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, idOf, cardTotals, checkInvariants } from './helpers.js';
import { chooseAction } from '../src/engine/bot.js';
import { viewFor } from '../src/engine/view.js';
import { GameError } from '../src/engine/errors.js';

function completeSetup(game) {
    while (game.state.phase === 'setup' || game.hasPending()) {
        const me = game.waitingOn().players[0];
        game.act(idOf(game, me), chooseAction(game, me));
    }
}

function setHand(game, idx, hand) {
    const p = game.state.players[idx];
    // Return current cards to the bank, then take the requested ones.
    for (const k in p.hand) {
        game.state.bank[k] += p.hand[k];
        p.hand[k] = 0;
    }
    for (const k in hand) {
        game.state.bank[k] -= hand[k];
        p.hand[k] = hand[k];
    }
}

const act = (game, idx, action) => game.act(idOf(game, idx), action);
const rejects = (fn, re) => assert.throws(fn, (e) => e instanceof GameError && (!re || re.test(e.message)));

/** Force the next dice roll to a given total by stubbing the rng. */
function rigDice(game, d1, d2) {
    const orig = game.rng;
    const queue = [d1 - 1, d2 - 1];
    game.rng = {
        int(n) {
            if (queue.length) return queue.shift();
            game.rng = orig;
            return orig.int(n);
        },
    };
}

describe('setup', () => {
    test('snake order and second-settlement resources', () => {
        const g = newGame({ players: 3 });
        const order = [];
        while (g.state.phase === 'setup') {
            const me = g.waitingOn().players[0];
            if (g.state.setup.step === 'settlement') order.push(me);
            act(g, me, chooseAction(g, me));
        }
        assert.deepEqual(order, [0, 1, 2, 2, 1, 0]);
        // Each player got resources only from the second settlement (at most 3 cards).
        for (const p of g.state.players) {
            const n = Object.values(p.hand).reduce((a, b) => a + b, 0);
            assert.ok(n >= 0 && n <= 3);
        }
        assert.equal(g.state.phase, 'preRoll');
        assert.equal(g.state.current, 0);
    });

    test('distance rule, road adjacency, and turn enforcement', () => {
        const g = newGame({ players: 2 });
        const v = '0,-2'; // corner of the center hex
        act(g, 0, { type: 'build', piece: 'settlement', at: v });
        rejects(() => act(g, 1, { type: 'build', piece: 'road', at: 'x' }), /not your turn/);
        rejects(() => act(g, 0, { type: 'build', piece: 'settlement', at: '1,-1' }), /road/i);
        const far = [...g.graph.edges.keys()].find((e) => !e.split('|').includes(v));
        rejects(() => act(g, 0, { type: 'build', piece: 'road', at: far }));
        const near = g.graph.vertices.get(v).edges[0];
        act(g, 0, { type: 'build', piece: 'road', at: near });
        // Neighbor of an existing settlement is illegal.
        const neighbor = g.graph.vertices.get(v).neighbors[0];
        rejects(() => act(g, 1, { type: 'build', piece: 'settlement', at: neighbor }));
        rejects(() => act(g, 1, { type: 'rollDice' }));
    });
});

describe('turn flow', () => {
    test('cannot build before rolling or end turn before rolling', () => {
        const g = newGame({ players: 2 });
        completeSetup(g);
        setHand(g, 0, { wood: 5, brick: 5, sheep: 5, wheat: 5, ore: 5 });
        const road = [...g.graph.edges.keys()].find((e) => g.canPlaceRoad(0, e));
        rejects(() => act(g, 0, { type: 'build', piece: 'road', at: road }));
        rejects(() => act(g, 0, { type: 'endTurn' }));
        rigDice(g, 3, 3);
        act(g, 0, { type: 'rollDice' });
        act(g, 0, { type: 'build', piece: 'road', at: road });
        assert.equal(g.state.roads[road].owner, 0);
        act(g, 0, { type: 'endTurn' });
        assert.equal(g.state.current, 1);
        assert.equal(g.state.phase, 'preRoll');
    });

    test('building costs are paid to the bank and require connectivity', () => {
        const g = newGame({ players: 2 });
        completeSetup(g);
        rigDice(g, 3, 3);
        act(g, 0, { type: 'rollDice' });
        setHand(g, 0, { wood: 1, brick: 1 });
        const bankWood = g.state.bank.wood;
        const unconnected = [...g.graph.edges.keys()].find((e) => !g.canPlaceRoad(0, e) && g.edgeOnLand(g.graph.edges.get(e)) && !g.state.roads[e]);
        rejects(() => act(g, 0, { type: 'build', piece: 'road', at: unconnected }));
        const road = [...g.graph.edges.keys()].find((e) => g.canPlaceRoad(0, e));
        act(g, 0, { type: 'build', piece: 'road', at: road });
        assert.equal(g.state.bank.wood, bankWood + 1);
        assert.equal(g.state.players[0].hand.wood, 0);
        const road2 = [...g.graph.edges.keys()].find((e) => g.canPlaceRoad(0, e));
        rejects(() => act(g, 0, { type: 'build', piece: 'road', at: road2 }), /enough/);
    });

    test('city upgrade only on own settlement, piece limits enforced', () => {
        const g = newGame({ players: 2, settings: { pieces: { cities: 1 } } });
        completeSetup(g);
        rigDice(g, 3, 3);
        act(g, 0, { type: 'rollDice' });
        setHand(g, 0, { wheat: 4, ore: 6 });
        const mine = Object.keys(g.state.buildings).filter((v) => g.state.buildings[v].owner === 0);
        const theirs = Object.keys(g.state.buildings).find((v) => g.state.buildings[v].owner === 1);
        rejects(() => act(g, 0, { type: 'build', piece: 'city', at: theirs }));
        act(g, 0, { type: 'build', piece: 'city', at: mine[0] });
        assert.equal(g.state.buildings[mine[0]].type, 'city');
        rejects(() => act(g, 0, { type: 'build', piece: 'city', at: mine[1] }), /no cities left/);
    });
});

describe('robber', () => {
    test('seven forces discards, robber move, and steal', () => {
        const g = newGame({ players: 3 });
        completeSetup(g);
        setHand(g, 1, { wood: 4, brick: 4 }); // 8 cards -> discard 4
        setHand(g, 2, { wood: 3, brick: 4 }); // 7 cards -> safe
        rigDice(g, 3, 4);
        act(g, 0, { type: 'rollDice' });
        assert.deepEqual(g.waitingOn(), { kind: 'discard', players: [1] });
        rejects(() => act(g, 0, { type: 'moveRobber', hex: 0 }), /discard/i);
        rejects(() => act(g, 1, { type: 'discard', cards: { wood: 3 } }), /exactly 4/);
        rejects(() => act(g, 1, { type: 'discard', cards: { ore: 4 } }), /do not have/);
        act(g, 1, { type: 'discard', cards: { wood: 2, brick: 2 } });
        assert.equal(g.waitingOn().kind, 'robber');
        rejects(() => act(g, 0, { type: 'moveRobber', hex: g.state.robber }));
        // Move robber onto a hex next to player 2's building.
        const target = g.state.board.hexes.findIndex((h, i) =>
            h.terrain !== 'sea' && i !== g.state.robber &&
            g.hexVertices(i).some((v) => g.state.buildings[v]?.owner === 2) &&
            !g.hexVertices(i).some((v) => g.state.buildings[v] && g.state.buildings[v].owner !== 2));
        assert.ok(target >= 0);
        const before = cardTotals(g);
        act(g, 0, { type: 'moveRobber', hex: target });
        assert.equal(g.state.robber, target);
        assert.equal(g.state.players[2].hand.wood + g.state.players[2].hand.brick, 6);
        assert.deepEqual(cardTotals(g), before);
        assert.equal(g.waitingOn().kind, 'main');
    });

    test('robbed hex does not produce', () => {
        const g = newGame({ players: 2 });
        completeSetup(g);
        const vid = Object.keys(g.state.buildings).find((v) => g.state.buildings[v].owner === 0);
        const hex = g.graph.vertices.get(vid).hexes.find((h) => g.state.board.hexes[h].number);
        const n = g.state.board.hexes[hex].number;
        g.state.robber = hex;
        // Remove other hexes with the same number from consideration by checking just this one's resource.
        setHand(g, 0, {});
        setHand(g, 1, {});
        const d1 = Math.min(6, n - 1);
        rigDice(g, d1, n - d1);
        act(g, 0, { type: 'rollDice' });
        const other = g.state.board.hexes.some((h, i) => i !== hex && h.number === n &&
            g.hexVertices(i).some((v) => g.state.buildings[v]?.owner === 0));
        if (!other) assert.equal(Object.values(g.state.players[0].hand).reduce((a, b) => a + b, 0), 0);
    });
});

describe('development cards', () => {
    function mainPhase(g) {
        completeSetup(g);
        rigDice(g, 3, 3);
        act(g, 0, { type: 'rollDice' });
    }

    test('cannot play a card on the turn it was bought; one per turn', () => {
        const g = newGame({ players: 2 });
        mainPhase(g);
        g.state.devDeck.push('knight', 'monopoly');
        setHand(g, 0, { sheep: 2, wheat: 2, ore: 2 });
        act(g, 0, { type: 'buyDevCard' });
        act(g, 0, { type: 'buyDevCard' });
        rejects(() => act(g, 0, { type: 'playDevCard', card: 'monopoly', resource: 'wood' }), /bought/);
        // Next own turn.
        act(g, 0, { type: 'endTurn' });
        rigDice(g, 3, 3);
        act(g, 1, { type: 'rollDice' });
        act(g, 1, { type: 'endTurn' });
        setHand(g, 1, { wood: 3 });
        act(g, 0, { type: 'playDevCard', card: 'monopoly', resource: 'wood' });
        assert.equal(g.state.players[0].hand.wood, 3);
        assert.equal(g.state.players[1].hand.wood, 0);
        rejects(() => act(g, 0, { type: 'playDevCard', card: 'knight' }), /one development card/);
    });

    test('knight before rolling, largest army at three', () => {
        const g = newGame({ players: 2 });
        completeSetup(g);
        g.state.players[0].devCards = [{ type: 'knight', turn: 0 }];
        g.state.players[0].knightsPlayed = 2;
        act(g, 0, { type: 'playDevCard', card: 'knight' });
        assert.equal(g.state.largestArmy, 0);
        assert.equal(g.waitingOn().kind, 'robber');
        const hex = g.robberTargets('robber')[0];
        act(g, 0, { type: 'moveRobber', hex });
        if (g.state.pending.steal) act(g, 0, { type: 'steal', victim: g.state.pending.steal.candidates[0] });
        assert.equal(g.state.phase, 'preRoll');
        act(g, 0, { type: 'rollDice' });
    });

    test('year of plenty and road building', () => {
        const g = newGame({ players: 2 });
        mainPhase(g);
        g.state.players[0].devCards = [{ type: 'yearOfPlenty', turn: 0 }, { type: 'roadBuilding', turn: 0 }];
        setHand(g, 0, {});
        act(g, 0, { type: 'playDevCard', card: 'yearOfPlenty', cards: { ore: 2 } });
        assert.equal(g.state.players[0].hand.ore, 2);
        g.state.turnFlags.devPlayed = false;
        const roadsBefore = g.countPieces(0, 'road');
        act(g, 0, { type: 'playDevCard', card: 'roadBuilding' });
        assert.equal(g.waitingOn().kind, 'roadBuilding');
        rejects(() => act(g, 0, { type: 'endTurn' }));
        for (let i = 0; i < 2; i++) {
            const e = [...g.graph.edges.keys()].find((x) => g.canPlaceRoad(0, x));
            act(g, 0, { type: 'build', piece: 'road', at: e });
        }
        assert.equal(g.countPieces(0, 'road'), roadsBefore + 2);
        assert.equal(g.waitingOn().kind, 'main');
    });

    test('hidden victory points win the game and are revealed', () => {
        const g = newGame({ players: 2, settings: { victoryPoints: 4 } });
        completeSetup(g);
        g.state.players[0].devCards = [{ type: 'victoryPoint', turn: 0 }];
        rigDice(g, 3, 3);
        // 2 settlements + 1 hidden VP = 3; build one more settlement to reach 4.
        act(g, 0, { type: 'rollDice' });
        const pub = viewFor(g, idOf(g, 1));
        assert.equal(pub.players[0].vp, 2);
        assert.equal(viewFor(g, idOf(g, 0)).players[0].vp, 3);
        g.state.players[0].devCards.push({ type: 'victoryPoint', turn: 0 });
        g.afterAction();
        assert.equal(g.state.phase, 'finished');
        assert.equal(g.state.winner, 0);
        assert.deepEqual(viewFor(g, idOf(g, 1)).revealed, [2, 0]);
    });
});

describe('trading', () => {
    function mainPhase(g) {
        completeSetup(g);
        rigDice(g, 3, 3);
        act(g, 0, { type: 'rollDice' });
    }

    test('bank trade uses the best harbor ratio', () => {
        const g = newGame({ players: 2 });
        mainPhase(g);
        setHand(g, 0, { wood: 4 });
        rejects(() => act(g, 0, { type: 'maritimeTrade', give: 'wood', get: 'wood' }));
        const ratio = g.portRatios(0).wood;
        act(g, 0, { type: 'maritimeTrade', give: 'wood', get: 'ore' });
        assert.equal(g.state.players[0].hand.wood, 4 - ratio);
        assert.equal(g.state.players[0].hand.ore, 1);
        // A 3:1 harbor improves the ratio.
        const port = g.state.board.ports.find((p) => p.type === '3:1');
        g.state.buildings[port.vertices[0]] = { owner: 0, type: 'settlement' };
        assert.equal(g.portRatios(0).brick, 3);
    });

    test('offer, accept, confirm; counter-offers; validation', () => {
        const g = newGame({ players: 3 });
        mainPhase(g);
        setHand(g, 0, { wood: 2 });
        setHand(g, 1, { ore: 1 });
        setHand(g, 2, { ore: 1 });
        rejects(() => act(g, 0, { type: 'offerTrade', give: { wood: 1 }, get: {} }), /both sides/);
        rejects(() => act(g, 0, { type: 'offerTrade', give: { ore: 1 }, get: { wood: 1 } }), /do not have/);
        rejects(() => act(g, 0, { type: 'offerTrade', give: { wood: -1 }, get: { ore: 1 } }));
        rejects(() => act(g, 0, { type: 'offerTrade', give: { gold: 1 }, get: { ore: 1 } }));
        act(g, 0, { type: 'offerTrade', give: { wood: 1 }, get: { ore: 1 } });
        const id = g.state.trades[0].id;
        act(g, 1, { type: 'respondTrade', id, accept: true });
        act(g, 2, { type: 'respondTrade', id, accept: false });
        rejects(() => act(g, 0, { type: 'confirmTrade', id, partner: 2 }));
        act(g, 0, { type: 'confirmTrade', id, partner: 1 });
        assert.equal(g.state.players[0].hand.ore, 1);
        assert.equal(g.state.players[1].hand.wood, 1);
        // Counter-offer from player 2 to the active player.
        act(g, 2, { type: 'offerTrade', give: { ore: 1 }, get: { wood: 1 } });
        const counter = g.state.trades[0];
        assert.equal(counter.to, 0);
        rejects(() => act(g, 1, { type: 'respondTrade', id: counter.id, accept: true }));
        act(g, 0, { type: 'respondTrade', id: counter.id, accept: true });
        assert.equal(g.state.players[0].hand.ore, 2);
        assert.equal(g.state.players[0].hand.wood, 0);
        // Non-active players cannot trade with each other.
        setHand(g, 1, { wood: 1 });
        act(g, 1, { type: 'offerTrade', give: { wood: 1 }, get: { ore: 1 } });
        assert.equal(g.state.trades[0].to, 0);
        act(g, 0, { type: 'endTurn' });
        assert.equal(g.state.trades.length, 0);
    });
});

describe('longest road', () => {
    test('awarded at 5, broken by an opponent settlement', () => {
        const g = newGame({ players: 2 });
        // Hand-build a straight-ish path of 5 roads for player 0 along the top of the center hex row.
        const s = g.state;
        s.phase = 'main';
        s.setup = null;
        s.turn = 1;
        // Walk a path using the graph: start at some land vertex and extend greedily.
        let v = '0,-2';
        const path = [];
        const seen = new Set([v]);
        for (let i = 0; i < 5; i++) {
            const next = g.graph.vertices.get(v).edges.find((e) => {
                const o = e.split('|').find((x) => x !== v);
                return !seen.has(o) && g.edgeOnLand(g.graph.edges.get(e));
            });
            const o = next.split('|').find((x) => x !== v);
            path.push(next);
            seen.add(o);
            v = o;
        }
        path.forEach((e) => { s.roads[e] = { owner: 0, type: 'road', turn: 0 }; });
        g.afterAction();
        assert.equal(s.players[0].routeLength, 5);
        assert.equal(s.longestRoad, 0);
        // Player 1 settles in the middle of the path (vertex between road 2 and 3).
        const mid = path[2].split('|').find((x) => path[1].split('|').includes(x));
        s.buildings[mid] = { owner: 1, type: 'settlement' };
        g.afterAction();
        assert.ok(s.players[0].routeLength < 5);
        assert.equal(s.longestRoad, null);
    });
});

describe('production', () => {
    test('bank shortage: nobody receives when several players are owed more than the bank has', () => {
        const g = newGame({ players: 2 });
        completeSetup(g);
        // Find a hex where both players have a building.
        const hex = g.state.board.hexes.findIndex((h, i) => h.number && h.terrain !== 'gold' &&
            new Set(g.hexVertices(i).map((v) => g.state.buildings[v]?.owner).filter((o) => o !== undefined)).size === 2);
        if (hex < 0) return; // layout-dependent; covered by simulations
        const h = g.state.board.hexes[hex];
        g.state.robber = null;
        const res = { forest: 'wood', hills: 'brick', pasture: 'sheep', fields: 'wheat', mountains: 'ore' }[h.terrain];
        setHand(g, 0, {});
        setHand(g, 1, {});
        const total = g.state.bank[res];
        g.state.bank[res] = 1;
        g.state.players[0].hand[res] = total - 1; // keep conservation
        const before = g.state.players[1].hand[res];
        g.produce(h.number);
        assert.equal(g.state.players[1].hand[res], before);
        assert.equal(g.state.bank[res], 1);
    });
});

describe('special building phase', () => {
    test('with 5 players, others may build after each turn', () => {
        const g = newGame({ players: 5, map: 'large' });
        completeSetup(g);
        rigDice(g, 3, 3);
        act(g, 0, { type: 'rollDice' });
        act(g, 0, { type: 'endTurn' });
        assert.equal(g.state.phase, 'specialBuild');
        assert.deepEqual(g.waitingOn(), { kind: 'specialBuild', players: [1] });
        rejects(() => act(g, 1, { type: 'rollDice' }));
        rejects(() => act(g, 1, { type: 'maritimeTrade', give: 'wood', get: 'ore' }));
        for (const i of [1, 2, 3, 4]) act(g, i, { type: 'endTurn' });
        assert.equal(g.state.phase, 'preRoll');
        assert.equal(g.state.current, 1);
    });
});

describe('seafarers', () => {
    test('ships connect only to ships or own buildings; moving the open end', () => {
        const g = newGame({ players: 2, map: 'islands', settings: { expansions: { seafarers: true } } });
        completeSetup(g);
        const s = g.state;
        rigDice(g, 3, 3);
        act(g, 0, { type: 'rollDice' });
        // Find a coastal settlement of player 0 or place one.
        let coast = Object.keys(s.buildings).find((v) => s.buildings[v].owner === 0 &&
            g.graph.vertices.get(v).edges.some((e) => g.canPlaceShip(0, e)));
        if (!coast) {
            coast = [...g.graph.vertices.keys()].find((v) => g.canPlaceSettlement(0, v, { setup: true }) &&
                g.graph.vertices.get(v).edges.some((e) => g.edgeOnSea(g.graph.edges.get(e))));
            s.buildings[coast] = { owner: 0, type: 'settlement' };
        }
        setHand(g, 0, { wood: 2, sheep: 2 });
        const e1 = g.graph.vertices.get(coast).edges.find((e) => g.canPlaceShip(0, e));
        act(g, 0, { type: 'build', piece: 'ship', at: e1 });
        // A road cannot extend from a ship.
        const far = e1.split('|').find((x) => x !== coast);
        const ownNear = (vid) => s.buildings[vid]?.owner === 0 ||
            g.graph.vertices.get(vid).edges.some((o) => s.roads[o]?.owner === 0 && s.roads[o].type === 'road');
        for (const e of g.graph.vertices.get(far).edges) {
            const other = e.split('|').find((x) => x !== far);
            if (e === e1 || ownNear(far) || ownNear(other) || !g.edgeOnLand(g.graph.edges.get(e))) continue;
            assert.equal(g.canPlaceRoad(0, e), false, 'a road must not attach to a ship');
        }
        // Ship built this turn cannot move.
        assert.ok(!g.movableShips(0).includes(e1));
        act(g, 0, { type: 'endTurn' });
        rigDice(g, 3, 3);
        act(g, 1, { type: 'rollDice' });
        act(g, 1, { type: 'endTurn' });
        rigDice(g, 3, 3);
        act(g, 0, { type: 'rollDice' });
        assert.ok(g.movableShips(0).includes(e1));
        const dest = g.shipDestinations(0, e1).find((e) => e !== e1);
        act(g, 0, { type: 'moveShip', from: e1, to: dest });
        assert.ok(s.roads[dest] && !s.roads[e1]);
        rejects(() => act(g, 0, { type: 'moveShip', from: dest, to: e1 }), /already moved/);
    });

    test('island bonus for the first settlement on a new island', () => {
        const g = newGame({ players: 2, map: 'islands', settings: { expansions: { seafarers: true }, islandBonus: 2 } });
        completeSetup(g);
        const s = g.state;
        const foreign = [...g.graph.vertices.keys()].find((v) => {
            const isl = g.islandsOfVertex(v);
            return isl.length === 1 && !s.homeIslands.includes(isl[0]) && g.canPlaceSettlement(0, v, { setup: true });
        });
        assert.ok(foreign, 'islands map should have outlying islands');
        const before = g.victoryPoints(0);
        const edge = g.graph.vertices.get(foreign).edges[0];
        s.roads[edge] = { owner: 0, type: g.edgeOnLand(g.graph.edges.get(edge)) ? 'road' : 'ship', turn: 0 };
        rigDice(g, 3, 3);
        act(g, 0, { type: 'rollDice' });
        setHand(g, 0, { wood: 1, brick: 1, sheep: 1, wheat: 1 });
        act(g, 0, { type: 'build', piece: 'settlement', at: foreign });
        assert.equal(g.victoryPoints(0), before + 3);
    });

    test('gold field lets the player choose', () => {
        const g = newGame({ players: 2, map: 'islands', settings: { expansions: { seafarers: true } } });
        completeSetup(g);
        const s = g.state;
        const gold = s.board.hexes.findIndex((h) => h.terrain === 'gold');
        const v = g.hexVertices(gold).find((x) => g.canPlaceSettlement(0, x, { setup: true }));
        s.buildings[v] = { owner: 0, type: 'city' };
        s.robber = null;
        g.produce(s.board.hexes[gold].number);
        assert.equal(s.pending.gold[0], 2);
        assert.equal(g.waitingOn().kind, 'gold');
        rejects(() => act(g, 0, { type: 'chooseGold', cards: { ore: 3 } }));
        const ore = s.players[0].hand.ore;
        act(g, 0, { type: 'chooseGold', cards: { ore: 2 } });
        assert.equal(s.players[0].hand.ore, ore + 2);
    });
});

describe('ending early', () => {
    test('forfeitTo ends the game in any phase and clears pending work', () => {
        const g = newGame({ players: 3 });
        g.forfeitTo(idOf(g, 2));
        assert.equal(g.state.phase, 'finished');
        assert.equal(g.state.winner, 2);
        assert.equal(g.state.endReason, 'forfeit');
        assert.equal(viewFor(g, idOf(g, 0)).endReason, 'forfeit');
        rejects(() => act(g, 0, { type: 'rollDice' }), /over/);
    });
});

describe('robustness', () => {
    test('malformed actions are rejected with GameError and do not change state', () => {
        const g = newGame({ players: 2 });
        const snapshot = JSON.stringify(g.state);
        const bad = [
            null, 42, 'x', {}, { type: 'nope' }, { type: 'build' }, { type: 'build', piece: 'castle', at: '0,0' },
            { type: 'build', piece: 'settlement', at: { toString: 1 } }, { type: 'build', piece: 'settlement', at: 'a'.repeat(1000) },
            { type: 'discard', cards: null }, { type: 'moveRobber', hex: '3' }, { type: '__proto__' }, { type: 'constructor' },
            { type: 'toString' }, { type: 'maritimeTrade', give: 'wood', get: 'ore', count: 1e9 },
        ];
        for (const a of bad) rejects(() => act(g, 0, a));
        assert.equal(JSON.stringify(g.state), snapshot);
        rejects(() => g.act('stranger', { type: 'rollDice' }), /not in this game/);
    });

    test('state survives a JSON round trip', async () => {
        const { Game } = await import('../src/engine/game.js');
        const { seededRng } = await import('../src/engine/rng.js');
        const g = newGame({ players: 3 });
        completeSetup(g);
        const copy = Game.fromJSON(JSON.parse(JSON.stringify(g.toJSON())), seededRng(5));
        assert.deepEqual(copy.state, g.state);
        assert.deepEqual(viewFor(copy, 'p0'), viewFor(g, 'p0'));
        checkInvariants(copy, cardTotals(g));
    });

    test('private log lines are only visible to their recipients', () => {
        const g = newGame({ players: 3 });
        completeSetup(g);
        setHand(g, 1, { ore: 1 });
        g.stealFrom(0, 1);
        const last = (i) => viewFor(g, idOf(g, i)).log.at(-1).msg;
        assert.match(last(0), /You steal 1 Ore/);
        assert.match(last(1), /steals 1 Ore from you/);
        assert.doesNotMatch(last(2), /Ore/);
    });
});

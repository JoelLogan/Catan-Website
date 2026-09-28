// A simple heuristic player.
//
// Used for three things:
//  * bot opponents the host can add in the lobby,
//  * acting on behalf of disconnected players so games never stall,
//  * randomized simulation tests of the engine.
//
// `chooseAction` returns the next action for a player, or null if the player
// has nothing to do right now.

import { RESOURCES, COSTS, TERRAIN_RESOURCE } from '../../shared/constants.js';
import { handSize, hasCards, handToList } from './hand.js';
import * as ck from './ck.js';

const pips = (n) => (n ? 6 - Math.abs(7 - n) : 0);

function vertexValue(game, vertexId, owner) {
    const v = game.graph.vertices.get(vertexId);
    let value = 0;
    const kinds = new Set();
    for (const h of v.hexes) {
        const hex = game.state.board.hexes[h];
        if (h === game.state.robber) continue;
        const p = pips(hex.number);
        value += hex.terrain === 'gold' ? p * 1.3 : p;
        if (TERRAIN_RESOURCE[hex.terrain]) kinds.add(TERRAIN_RESOURCE[hex.terrain]);
    }
    value += kinds.size * 0.7;
    for (const t of game.portsByVertex.get(vertexId) || []) value += t === '3:1' ? 0.8 : 0.5;
    if (owner !== undefined && game.settings.islandBonus) {
        const p = game.state.players[owner];
        if (game.islandsOfVertex(vertexId).some((i) => !game.state.homeIslands.includes(i) && !p.bonusIslands.includes(i))) {
            value += 4;
        }
    }
    return value;
}

function best(list, score) {
    let top = null;
    let topScore = -Infinity;
    for (const item of list) {
        const sc = score(item);
        if (sc > topScore) {
            topScore = sc;
            top = item;
        }
    }
    return top;
}

function pickCards(hand, count, prefer = []) {
    // Discard/give from the largest stacks first, keeping preferred cards.
    const h = { ...hand };
    const out = {};
    for (let i = 0; i < count; i++) {
        const k = best(Object.keys(h).filter((x) => h[x] > 0), (x) => h[x] - (prefer.includes(x) ? 10 : 0));
        if (!k) break;
        h[k]--;
        out[k] = (out[k] || 0) + 1;
    }
    return out;
}

/** Best road edge: one leading toward a good settlement spot. */
function bestEdge(game, owner, edges) {
    return best(edges, (e) => {
        let sc = 0;
        for (const vid of game.graph.edges.get(e).vertices) {
            if (game.canPlaceSettlement(owner, vid, { setup: true })) sc = Math.max(sc, vertexValue(game, vid, owner) + 2);
            const v = game.graph.vertices.get(vid);
            for (const n of v.neighbors) {
                if (game.canPlaceSettlement(owner, n, { setup: true })) sc = Math.max(sc, vertexValue(game, n, owner) * 0.5);
            }
        }
        return sc + (e.length % 7) * 0.001; // deterministic tie-break
    });
}

function legalEdges(game, owner, kind) {
    const out = [];
    for (const e of game.graph.edges.keys()) {
        if (kind === 'road' ? game.canPlaceRoad(owner, e) : game.canPlaceShip(owner, e)) out.push(e);
    }
    return out;
}

function robberAction(game, me) {
    const s = game.state;
    const leader = best(s.players.map((_, i) => i).filter((i) => i !== me), (i) => game.victoryPoints(i));
    const score = (h) => {
        let sc = 0;
        for (const vid of game.hexVertices(h)) {
            const b = s.buildings[vid];
            if (!b) continue;
            const weight = (b.type === 'city' ? 2 : 1) * pips(s.board.hexes[h].number);
            if (b.owner === me) sc -= weight * 3;
            else sc += weight * (b.owner === leader ? 1.5 : 1) + (handSize(s.players[b.owner].hand) > 0 ? 1 : 0);
        }
        return sc;
    };
    const targets = game.robberTargets('robber');
    if (targets.length) return { type: 'moveRobber', piece: 'robber', hex: best(targets, score) };
    const pirate = game.robberTargets('pirate');
    return { type: 'moveRobber', piece: 'pirate', hex: pirate[0] };
}

/** Try to find a maritime trade that makes `cost` affordable. */
function tradeToward(game, me, cost) {
    const s = game.state;
    const hand = s.players[me].hand;
    const missing = [];
    for (const k in cost) if ((hand[k] || 0) < cost[k]) missing.push(k);
    if (missing.length !== 1) return null;
    const need = missing[0];
    if (s.bank[need] < 1) return null;
    const ratios = game.portRatios(me);
    for (const r of game.cardTypes) {
        if (r === need) continue;
        const spare = (hand[r] || 0) - (cost[r] || 0);
        if (spare >= ratios[r]) return { type: 'maritimeTrade', give: r, get: need, count: 1 };
    }
    return null;
}

function mainPhaseAction(game, me, { passive, special }) {
    const s = game.state;
    const hand = s.players[me].hand;
    if (passive) return { type: 'endTurn' };
    const left = game.piecesLeft(me);
    const vertices = [...game.graph.vertices.keys()];

    if (game.citiesKnights && !special) {
        const a = ck.botMainAction(game, me);
        if (a) return a;
    }

    // Cities first.
    const cityCost = game.citiesKnights ? ck.cityCost(game, me) : COSTS.city;
    if (left.cities > 0) {
        const cities = vertices.filter((v) => game.canPlaceCity(me, v));
        if (cities.length) {
            if (hasCards(hand, cityCost)) return { type: 'build', piece: 'city', at: best(cities, (v) => vertexValue(game, v)) };
            const t = !special && tradeToward(game, me, cityCost);
            if (t) return t;
        }
    }
    // Settlements.
    const spots = left.settlements > 0 ? vertices.filter((v) => game.canPlaceSettlement(me, v)) : [];
    if (spots.length) {
        if (hasCards(hand, COSTS.settlement)) {
            return { type: 'build', piece: 'settlement', at: best(spots, (v) => vertexValue(game, v, me)) };
        }
        const t = !special && tradeToward(game, me, COSTS.settlement);
        if (t) return t;
    }
    // Development cards.
    if (!game.citiesKnights && s.devDeck.length && hasCards(hand, COSTS.devCard) && handSize(hand) >= 5) {
        return { type: 'buyDevCard' };
    }
    // Roads / ships toward new spots when nothing to settle.
    if (!spots.length || left.settlements === 0) {
        if (left.roads > 0 && hasCards(hand, COSTS.road)) {
            const edges = legalEdges(game, me, 'road');
            if (edges.length) return { type: 'build', piece: 'road', at: bestEdge(game, me, edges) };
        }
        if (game.seafarers && left.ships > 0 && hasCards(hand, COSTS.ship)) {
            const edges = legalEdges(game, me, 'ship');
            if (edges.length) return { type: 'build', piece: 'ship', at: bestEdge(game, me, edges) };
        }
    }
    if (special) return { type: 'endTurn' };

    // Development cards (one per turn).
    if (!game.citiesKnights && !s.turnFlags.devPlayed) {
        const playable = s.players[me].devCards.filter((c) => c.turn < s.turn).map((c) => c.type);
        if (playable.includes('monopoly')) {
            const res = best(RESOURCES, (r) => s.players.reduce((a, p, i) => a + (i === me ? 0 : p.hand[r]), 0));
            return { type: 'playDevCard', card: 'monopoly', resource: res };
        }
        if (playable.includes('yearOfPlenty')) {
            const avail = RESOURCES.filter((r) => s.bank[r] > 0);
            const total = RESOURCES.reduce((a, r) => a + s.bank[r], 0);
            if (avail.length && total >= 2) {
                const a = avail.includes('ore') ? 'ore' : avail[0];
                const cards = { [a]: 1 };
                const b = avail.find((r) => s.bank[r] >= (r === a ? 2 : 1) && r === 'wheat') || (s.bank[a] >= 2 ? a : avail.find((r) => r !== a));
                if (b) {
                    cards[b] = (cards[b] || 0) + 1;
                    return { type: 'playDevCard', card: 'yearOfPlenty', cards };
                }
            }
        }
        if (playable.includes('roadBuilding') && game.anyFreeRoadSpot(me)) return { type: 'playDevCard', card: 'roadBuilding' };
        if (playable.includes('knight')) return { type: 'playDevCard', card: 'knight' };
    }
    return { type: 'endTurn' };
}

/**
 * Choose the next action for player `me`.
 * @param {object} opts
 * @param {boolean} opts.passive only do what is required (used for disconnected humans)
 */
export function chooseAction(game, me, { passive = false } = {}) {
    const s = game.state;
    const w = game.waitingOn();
    if (!w.players.includes(me)) return null;
    const hand = s.players[me].hand;

    if (game.citiesKnights) {
        const a = ck.botPendingAction(game, me, w, { passive });
        if (a) return a;
    }

    switch (w.kind) {
        case 'gold': {
            const n = s.pending.gold[me];
            const cards = {};
            const bank = { ...s.bank };
            const order = ['ore', 'wheat', 'sheep', 'brick', 'wood'];
            for (let i = 0; i < n; i++) {
                const r = order.find((x) => bank[x] > 0);
                cards[r] = (cards[r] || 0) + 1;
                bank[r]--;
            }
            return { type: 'chooseGold', cards };
        }
        case 'discard':
            return { type: 'discard', cards: pickCards(hand, s.pending.discard[me], ['ore', 'wheat']) };
        case 'robber':
            return robberAction(game, me);
        case 'steal':
            return { type: 'steal', victim: best(s.pending.steal.candidates, (i) => handSize(s.players[i].hand)) };
        case 'roadBuilding': {
            const left = game.piecesLeft(me);
            const roads = left.roads > 0 ? legalEdges(game, me, 'road') : [];
            if (roads.length) return { type: 'build', piece: 'road', at: bestEdge(game, me, roads) };
            const ships = left.ships > 0 ? legalEdges(game, me, 'ship') : [];
            if (ships.length) return { type: 'build', piece: 'ship', at: bestEdge(game, me, ships) };
            return { type: 'skipRoadBuilding' };
        }
        case 'setup': {
            if (s.setup.step === 'road') {
                const from = s.setup.lastVertex;
                const roads = [];
                const ships = [];
                for (const e of game.graph.edges.keys()) {
                    if (game.canPlaceRoad(me, e, { fromVertex: from })) roads.push(e);
                    else if (game.canPlaceShip(me, e, { fromVertex: from })) ships.push(e);
                }
                if (roads.length) return { type: 'build', piece: 'road', at: bestEdge(game, me, roads) };
                return { type: 'build', piece: 'ship', at: bestEdge(game, me, ships) };
            }
            const spots = [...game.graph.vertices.keys()].filter((v) => game.canPlaceSettlement(me, v, { setup: true }));
            return { type: 'build', piece: s.setup.step, at: best(spots, (v) => vertexValue(game, v)) };
        }
        case 'preRoll': {
            if (!passive && !game.citiesKnights && !s.turnFlags.devPlayed) {
                const knight = s.players[me].devCards.some((c) => c.type === 'knight' && c.turn < s.turn);
                const robbed = s.robber !== null && game.hexVertices(s.robber).some((v) => s.buildings[v]?.owner === me);
                if (knight && robbed) return { type: 'playDevCard', card: 'knight' };
            }
            return { type: 'rollDice' };
        }
        case 'main':
            return mainPhaseAction(game, me, { passive, special: false });
        case 'specialBuild':
            return mainPhaseAction(game, me, { passive, special: true });
        default:
            return null;
    }
}

/** Decide how a bot responds to an open trade offer. */
export function tradeResponse(game, me, trade) {
    const s = game.state;
    const hand = s.players[me].hand;
    if (!hasCards(hand, trade.get)) return false;
    const giving = handToList(trade.get);
    const getting = handToList(trade.give);
    if (getting.length < giving.length) return false;
    // Don't give away the last copy of anything.
    return giving.every((r) => hand[r] - trade.get[r] >= 1) && game.victoryPoints(trade.from) < game.settings.victoryPoints - 2;
}

// Authoritative Catan rules engine.
//
// All state lives in `this.state`, a plain JSON-serializable object, so games
// can be persisted and restored. Derived lookup structures (the vertex/edge
// graph, harbor lookups, islands) are rebuilt from the state on construction.
//
// Players interact exclusively through `act(playerId, action)`. Every action is
// fully validated here; invalid actions throw a GameError whose message is
// safe to show to the player.

import {
    RESOURCES, COMMODITIES, COSTS, TERRAIN_RESOURCE, LIMITS, RESOURCE_LABELS,
} from '../../shared/constants.js';
import { buildGraph, hexKey, neighbor, cornerId, sideEdgeId } from '../../shared/hex.js';
import { assert } from './errors.js';
import { generateBoard } from './board.js';
import { shuffle } from './rng.js';
import { emptyHand, handSize, hasCards, addCards, transfer, parseHand, handToList } from './hand.js';
import { normalizeSettings, bankSizeFor, devDeckFor } from './settings.js';
import { longestRoute } from './longestRoad.js';
import * as ck from './ck.js';

const STATE_VERSION = 1;

const DEV_LABELS = {
    knight: 'Knight',
    victoryPoint: 'Victory Point',
    roadBuilding: 'Road Building',
    yearOfPlenty: 'Year of Plenty',
    monopoly: 'Monopoly',
};

const label = (r) => RESOURCE_LABELS[r] || r;

function describeCards(cards) {
    const parts = [];
    for (const k in cards) if (cards[k]) parts.push(`${cards[k]} ${label(k)}`);
    return parts.join(', ') || 'nothing';
}

export class Game {
    /**
     * Create a new game.
     * @param {object} opts
     * @param {Array<{id:string,name:string,color:string}>} opts.players
     * @param {object} opts.settings raw settings (normalized here)
     * @param {object} opts.template normalized map template
     * @param {{int:(n:number)=>number}} opts.rng
     */
    static create({ players, settings, template, rng }) {
        assert(players.length >= 1 && players.length <= LIMITS.maxPlayers, 'Invalid number of players');
        const s = normalizeSettings(settings);
        const n = players.length;
        const board = generateBoard(template, rng);
        const cardTypes = s.expansions.citiesKnights ? [...RESOURCES, ...COMMODITIES] : RESOURCES;
        const order = s.randomizeTurnOrder ? shuffle(rng, players) : players;
        const bankSize = bankSizeFor(n);

        const devDeck = [];
        if (!s.expansions.citiesKnights) {
            for (const [type, count] of Object.entries(devDeckFor(n))) {
                for (let i = 0; i < count; i++) devDeck.push(type);
            }
        }

        const state = {
            version: STATE_VERSION,
            seq: 0,
            settings: {
                ...s,
                specialBuildPhase: s.specialBuildPhase === 'on' || (s.specialBuildPhase === 'auto' && n >= 5),
                islandBonus: s.expansions.seafarers ? s.islandBonus : 0,
            },
            board: { hexes: board.hexes, ports: board.ports },
            robber: board.robber,
            pirate: board.pirate,
            players: order.map((p) => ({
                id: p.id,
                name: p.name,
                color: p.color,
                hand: emptyHand(cardTypes),
                devCards: [], // {type, turn}
                knightsPlayed: 0,
                bonusIslands: [],
                routeLength: 0,
            })),
            buildings: {}, // vertexId -> {owner, type: 'settlement'|'city'}
            roads: {}, // edgeId -> {owner, type: 'road'|'ship', turn}
            bank: emptyHand(cardTypes),
            devDeck: shuffle(rng, devDeck),
            turn: 0,
            current: 0,
            phase: 'setup', // setup | preRoll | main | specialBuild | finished
            setup: null,
            specialBuild: null, // {queue: number[]}
            pending: {
                gold: {}, // playerIndex -> count to choose
                discard: {}, // playerIndex -> count to discard
                robber: null, // {reason}
                steal: null, // {candidates, piece}
                roadBuilding: 0,
            },
            turnFlags: { devPlayed: false, shipMoved: false },
            longestRoad: null,
            largestArmy: null,
            lastRoll: null,
            trades: [],
            nextTradeId: 1,
            homeIslands: [],
            winner: null,
            log: [],
            logSeq: 0,
        };
        for (const r of cardTypes) state.bank[r] = RESOURCES.includes(r) ? bankSize : ck.COMMODITY_BANK_SIZE;

        const game = new Game(state, rng);
        if (s.expansions.citiesKnights) ck.initState(game);
        const order2 = [...state.players.keys()];
        state.setup = {
            order: [...order2, ...[...order2].reverse()],
            index: 0,
            step: 'settlement',
            lastVertex: null,
        };
        state.current = state.setup.order[0];
        game.log(`Turn order: ${state.players.map((p) => p.name).join(', ')}.`);
        game.log(`${state.players[state.current].name} places the first settlement.`);
        game.skipStuckSetup();
        return game;
    }

    static fromJSON(state, rng) {
        assert(state && state.version === STATE_VERSION, 'Unsupported saved game');
        return new Game(state, rng);
    }

    constructor(state, rng) {
        this.state = state;
        this.rng = rng;
        this.graph = buildGraph(state.board.hexes);
        this.portsByVertex = new Map();
        for (const port of state.board.ports) {
            for (const v of port.vertices) {
                if (!this.portsByVertex.has(v)) this.portsByVertex.set(v, []);
                this.portsByVertex.get(v).push(port.type);
            }
        }
        this.hexCorners = state.board.hexes.map((h) => [0, 1, 2, 3, 4, 5].map((c) => cornerId(h.q, h.r, c)));
        this.hexSides = state.board.hexes.map((h) => [0, 1, 2, 3, 4, 5].map((c) => sideEdgeId(h.q, h.r, c)));
        this.islandOfHex = this.computeIslands();
    }

    toJSON() {
        return this.state;
    }

    // ------------------------------------------------------------------
    // Basic queries
    // ------------------------------------------------------------------

    get settings() {
        return this.state.settings;
    }

    get seafarers() {
        return this.state.settings.expansions.seafarers;
    }

    get citiesKnights() {
        return this.state.settings.expansions.citiesKnights;
    }

    get cardTypes() {
        return this.citiesKnights ? [...RESOURCES, ...COMMODITIES] : RESOURCES;
    }

    playerIndex(playerId) {
        return this.state.players.findIndex((p) => p.id === playerId);
    }

    player(i) {
        return this.state.players[i];
    }

    isSea(hexIndex) {
        return this.state.board.hexes[hexIndex].terrain === 'sea';
    }

    vertexOnLand(v) {
        return v.hexes.some((h) => !this.isSea(h));
    }

    edgeOnLand(e) {
        return e.hexes.some((h) => !this.isSea(h));
    }

    edgeOnSea(e) {
        // Outer edges of the sea frame (only one hex, which is sea) are off-limits.
        return e.hexes.some((h) => this.isSea(h)) && (e.hexes.length === 2 || this.edgeOnLand(e));
    }

    buildingAt(vertexId) {
        return this.state.buildings[vertexId] || null;
    }

    countPieces(owner, type) {
        let n = 0;
        if (type === 'settlement' || type === 'city') {
            for (const k in this.state.buildings) {
                const b = this.state.buildings[k];
                if (b.owner === owner && b.type === type) n++;
            }
        } else {
            for (const k in this.state.roads) {
                const r = this.state.roads[k];
                if (r.owner === owner && r.type === type) n++;
            }
        }
        return n;
    }

    piecesLeft(owner) {
        const p = this.settings.pieces;
        return {
            settlements: p.settlements - this.countPieces(owner, 'settlement'),
            cities: p.cities - this.countPieces(owner, 'city'),
            roads: p.roads - this.countPieces(owner, 'road'),
            ships: this.seafarers ? p.ships - this.countPieces(owner, 'ship') : 0,
        };
    }

    /** Vertex occupied by an opponent's piece (building or knight) that blocks routes. */
    blockedFor(owner, vertexId) {
        const b = this.buildingAt(vertexId);
        if (b && b.owner !== owner) return true;
        if (this.citiesKnights) {
            const k = this.state.knights[vertexId];
            if (k && k.owner !== owner) return true;
        }
        return false;
    }

    vertexOccupied(vertexId) {
        if (this.buildingAt(vertexId)) return true;
        return this.citiesKnights && !!this.state.knights[vertexId];
    }

    computeIslands() {
        const hexes = this.state.board.hexes;
        const index = new Map(hexes.map((h, i) => [hexKey(h.q, h.r), i]));
        const island = new Array(hexes.length).fill(-1);
        let next = 0;
        hexes.forEach((h, i) => {
            if (h.terrain === 'sea' || island[i] >= 0) return;
            const stack = [i];
            island[i] = next;
            while (stack.length) {
                const j = stack.pop();
                for (let s = 0; s < 6; s++) {
                    const [nq, nr] = neighbor(hexes[j].q, hexes[j].r, s);
                    const k = index.get(hexKey(nq, nr));
                    if (k !== undefined && hexes[k].terrain !== 'sea' && island[k] < 0) {
                        island[k] = next;
                        stack.push(k);
                    }
                }
            }
            next++;
        });
        return island;
    }

    islandsOfVertex(vertexId) {
        const v = this.graph.vertices.get(vertexId);
        const set = new Set();
        for (const h of v.hexes) if (this.islandOfHex[h] >= 0) set.add(this.islandOfHex[h]);
        return [...set];
    }

    // ------------------------------------------------------------------
    // Placement legality
    // ------------------------------------------------------------------

    canPlaceSettlement(owner, vertexId, { setup = false } = {}) {
        const v = this.graph.vertices.get(vertexId);
        if (!v || !this.vertexOnLand(v)) return false;
        if (this.vertexOccupied(vertexId)) return false;
        for (const n of v.neighbors) if (this.buildingAt(n)) return false;
        if (setup) return true;
        return v.edges.some((e) => this.state.roads[e]?.owner === owner);
    }

    canPlaceCity(owner, vertexId) {
        const b = this.buildingAt(vertexId);
        return !!b && b.owner === owner && b.type === 'settlement';
    }

    canPlaceRoad(owner, edgeId, { fromVertex = null } = {}) {
        const e = this.graph.edges.get(edgeId);
        if (!e || !this.edgeOnLand(e) || this.state.roads[edgeId]) return false;
        if (fromVertex) return e.vertices.includes(fromVertex);
        return e.vertices.some((vid) => {
            const b = this.buildingAt(vid);
            if (b && b.owner === owner) return true;
            if (this.blockedFor(owner, vid)) return false;
            const v = this.graph.vertices.get(vid);
            return v.edges.some((o) => o !== edgeId && this.state.roads[o]?.owner === owner && this.state.roads[o].type === 'road');
        });
    }

    canPlaceShip(owner, edgeId, { fromVertex = null, ignoreEdge = null } = {}) {
        if (!this.seafarers) return false;
        const e = this.graph.edges.get(edgeId);
        if (!e || !this.edgeOnSea(e) || this.state.roads[edgeId]) return false;
        if (this.state.pirate !== null && e.hexes.includes(this.state.pirate)) return false;
        if (fromVertex) return e.vertices.includes(fromVertex);
        return e.vertices.some((vid) => {
            const b = this.buildingAt(vid);
            if (b && b.owner === owner) return true;
            if (this.blockedFor(owner, vid)) return false;
            const v = this.graph.vertices.get(vid);
            return v.edges.some(
                (o) => o !== edgeId && o !== ignoreEdge && this.state.roads[o]?.owner === owner && this.state.roads[o].type === 'ship',
            );
        });
    }

    /** Ships that can be moved this turn: the open end of a shipping route, not built this turn. */
    movableShips(owner) {
        if (!this.seafarers) return [];
        const out = [];
        for (const edgeId in this.state.roads) {
            const r = this.state.roads[edgeId];
            if (r.owner !== owner || r.type !== 'ship' || r.turn === this.state.turn) continue;
            const e = this.graph.edges.get(edgeId);
            if (this.state.pirate !== null && e.hexes.includes(this.state.pirate)) continue;
            const openEnd = e.vertices.some((vid) => {
                const b = this.buildingAt(vid);
                if (b && b.owner === owner) return false;
                const v = this.graph.vertices.get(vid);
                return !v.edges.some((o) => o !== edgeId && this.state.roads[o]?.owner === owner && this.state.roads[o].type === 'ship');
            });
            if (openEnd) out.push(edgeId);
        }
        return out;
    }

    shipDestinations(owner, fromEdge) {
        const ship = this.state.roads[fromEdge];
        delete this.state.roads[fromEdge];
        const out = [];
        try {
            for (const edgeId of this.graph.edges.keys()) {
                if (edgeId !== fromEdge && this.canPlaceShip(owner, edgeId)) out.push(edgeId);
            }
        } finally {
            this.state.roads[fromEdge] = ship;
        }
        return out;
    }

    portRatios(owner) {
        const ratios = Object.fromEntries(this.cardTypes.map((r) => [r, 4]));
        for (const vid in this.state.buildings) {
            if (this.state.buildings[vid].owner !== owner) continue;
            for (const type of this.portsByVertex.get(vid) || []) {
                if (type === '3:1') {
                    for (const r of this.cardTypes) ratios[r] = Math.min(ratios[r], 3);
                } else {
                    ratios[type] = Math.min(ratios[type], 2);
                }
            }
        }
        if (this.citiesKnights) ck.adjustRatios(this, owner, ratios);
        return ratios;
    }

    // ------------------------------------------------------------------
    // Victory points
    // ------------------------------------------------------------------

    victoryPoints(owner, { includeHidden = false } = {}) {
        const s = this.state;
        let vp = 0;
        for (const k in s.buildings) {
            const b = s.buildings[k];
            if (b.owner !== owner) continue;
            vp += b.type === 'city' ? 2 : 1;
        }
        if (s.longestRoad === owner) vp += 2;
        if (s.largestArmy === owner) vp += 2;
        vp += s.players[owner].bonusIslands.length * this.settings.islandBonus;
        if (this.citiesKnights) vp += ck.extraVictoryPoints(this, owner);
        if (includeHidden) vp += s.players[owner].devCards.filter((c) => c.type === 'victoryPoint').length;
        return vp;
    }

    // ------------------------------------------------------------------
    // Flow helpers
    // ------------------------------------------------------------------

    log(msg, privateMsgs = null) {
        const entry = { id: ++this.state.logSeq, msg };
        if (privateMsgs) entry.private = privateMsgs;
        this.state.log.push(entry);
        if (this.state.log.length > LIMITS.maxLogEntries) this.state.log.shift();
    }

    name(i) {
        return this.state.players[i].name;
    }

    hasPending() {
        const p = this.state.pending;
        return (
            Object.keys(p.gold).length > 0 ||
            Object.keys(p.discard).length > 0 ||
            !!p.robber ||
            !!p.steal ||
            p.roadBuilding > 0 ||
            (this.citiesKnights && ck.hasPending(this))
        );
    }

    /**
     * What the game is waiting for. Returns {kind, players:[index]}.
     * kind: gold | discard | robber | steal | roadBuilding | setup | preRoll | main | specialBuild | finished | ck:*
     */
    waitingOn() {
        const s = this.state;
        const p = s.pending;
        if (s.phase === 'finished') return { kind: 'finished', players: [] };
        if (this.citiesKnights) {
            const w = ck.waitingOn(this);
            if (w) return w;
        }
        if (Object.keys(p.gold).length) return { kind: 'gold', players: Object.keys(p.gold).map(Number) };
        if (Object.keys(p.discard).length) return { kind: 'discard', players: Object.keys(p.discard).map(Number) };
        if (p.robber) return { kind: 'robber', players: [s.current] };
        if (p.steal) return { kind: 'steal', players: [s.current] };
        if (p.roadBuilding > 0) return { kind: 'roadBuilding', players: [s.current] };
        if (s.phase === 'specialBuild') return { kind: 'specialBuild', players: [s.specialBuild.queue[0]] };
        return { kind: s.phase, players: [s.current] };
    }

    requireTurn(idx, phases) {
        const s = this.state;
        assert(s.phase !== 'finished', 'The game is over');
        assert(!this.hasPending(), 'Resolve the current action first');
        assert(phases.includes(s.phase), 'You cannot do that right now');
        if (s.phase === 'specialBuild') {
            assert(s.specialBuild.queue[0] === idx, 'It is not your turn to build');
        } else {
            assert(s.current === idx, 'It is not your turn');
        }
    }

    pay(owner, cost) {
        const hand = this.state.players[owner].hand;
        assert(hasCards(hand, cost), 'You do not have enough resources');
        transfer(hand, this.state.bank, cost);
    }

    /** Give cards from the bank to a player (caller ensures availability). */
    give(owner, cards) {
        transfer(this.state.bank, this.state.players[owner].hand, cards);
    }

    // ------------------------------------------------------------------
    // Actions
    // ------------------------------------------------------------------

    act(playerId, action) {
        const idx = this.playerIndex(playerId);
        assert(idx >= 0, 'You are not in this game');
        assert(action && typeof action === 'object' && typeof action.type === 'string', 'Invalid action');
        // Own-property lookups only: "constructor", "__proto__" etc. must never resolve.
        const handler = Object.hasOwn(ACTIONS, action.type)
            ? ACTIONS[action.type]
            : this.citiesKnights && Object.hasOwn(ck.ACTIONS, action.type) && ck.ACTIONS[action.type];
        assert(typeof handler === 'function', 'Unknown action');
        handler.call(this, idx, action);
        this.afterAction();
    }

    afterAction() {
        this.updateLongestRoad();
        this.checkWinner();
        this.state.seq++;
    }

    checkWinner() {
        const s = this.state;
        if (s.phase === 'finished' || s.phase === 'setup') return;
        const cur = s.current;
        if (this.victoryPoints(cur, { includeHidden: true }) >= this.settings.victoryPoints) {
            s.phase = 'finished';
            s.winner = cur;
            s.pending = { gold: {}, discard: {}, robber: null, steal: null, roadBuilding: 0 };
            if (this.citiesKnights) ck.clearPending(this);
            s.trades = [];
            this.log(`🏆 ${this.name(cur)} wins with ${this.victoryPoints(cur, { includeHidden: true })} victory points!`);
        }
    }

    updateLongestRoad() {
        const s = this.state;
        const lengths = s.players.map((_, owner) => {
            const len = longestRoute({
                owner,
                vertices: this.graph.vertices,
                roads: s.roads,
                isBlocked: (v) => this.blockedFor(owner, v),
                hasOwnBuilding: (v) => this.buildingAt(v)?.owner === owner,
            });
            s.players[owner].routeLength = len;
            return len;
        });
        const max = Math.max(0, ...lengths);
        const holder = s.longestRoad;
        let next = holder;
        if (!(holder !== null && lengths[holder] === max && max >= 5)) {
            const leaders = lengths.map((l, i) => (l === max ? i : -1)).filter((i) => i >= 0);
            next = max >= 5 && leaders.length === 1 ? leaders[0] : null;
        }
        if (next !== holder) {
            s.longestRoad = next;
            if (next === null) this.log('Nobody holds the Longest Road now.');
            else this.log(`🛣️ ${this.name(next)} takes the Longest Road (${max}).`);
        }
    }

    skipStuckSetup() {
        // Guard against tiny custom maps where a player has nowhere legal to build.
        const s = this.state;
        for (let guard = 0; guard < 64 && s.phase === 'setup'; guard++) {
            const idx = s.current;
            const setup = s.setup;
            if (setup.step === 'road') {
                const any = [...this.graph.edges.keys()].some(
                    (e) => this.canPlaceRoad(idx, e, { fromVertex: setup.lastVertex }) ||
                        this.canPlaceShip(idx, e, { fromVertex: setup.lastVertex }),
                );
                if (any) return;
                this.log(`${this.name(idx)} has nowhere to place a road.`);
                this.advanceSetup();
            } else {
                const any = [...this.graph.vertices.keys()].some((v) => this.canPlaceSettlement(idx, v, { setup: true }));
                if (any) return;
                this.log(`${this.name(idx)} has nowhere to build and is skipped.`);
                this.advanceSetup();
            }
        }
    }

    advanceSetup() {
        const s = this.state;
        const setup = s.setup;
        setup.index++;
        setup.lastVertex = null;
        if (setup.index >= setup.order.length) {
            s.setup = null;
            s.homeIslands = [...new Set(Object.keys(s.buildings).flatMap((v) => this.islandsOfVertex(v)))];
            this.startTurn(0, true);
            return;
        }
        s.current = setup.order[setup.index];
        const secondRound = setup.index >= s.players.length;
        setup.step = this.citiesKnights && secondRound ? 'city' : 'settlement';
    }

    startTurn(playerIndex, first = false) {
        const s = this.state;
        s.current = playerIndex;
        s.turn++;
        s.phase = 'preRoll';
        s.specialBuild = null;
        s.turnFlags = { devPlayed: false, shipMoved: false };
        s.trades = [];
        if (this.citiesKnights) ck.onTurnStart(this);
        this.log(first ? `Setup complete. ${this.name(playerIndex)} goes first.` : `— ${this.name(playerIndex)}'s turn —`);
        this.checkWinner();
    }

    /** Award island bonus for a new settlement if applicable (Seafarers). */
    checkIslandBonus(owner, vertexId) {
        if (!this.settings.islandBonus || this.state.phase === 'setup') return;
        const p = this.state.players[owner];
        for (const island of this.islandsOfVertex(vertexId)) {
            if (this.state.homeIslands.includes(island) || p.bonusIslands.includes(island)) continue;
            p.bonusIslands.push(island);
            this.log(`🏝️ ${p.name} settles a new island (+${this.settings.islandBonus} VP).`);
            return;
        }
    }

    /** Production for a dice total (not 7). */
    produce(total) {
        const s = this.state;
        const demand = {}; // resource -> {playerIndex: n}
        const gold = {};
        s.board.hexes.forEach((hex, hi) => {
            if (hex.number !== total || hi === s.robber) return;
            const v = [];
            for (const vid of this.hexVertices(hi)) {
                const b = s.buildings[vid];
                if (b) v.push(b);
            }
            for (const b of v) {
                const amount = b.type === 'city' ? 2 : 1;
                if (hex.terrain === 'gold') {
                    gold[b.owner] = (gold[b.owner] || 0) + amount;
                    continue;
                }
                const res = TERRAIN_RESOURCE[hex.terrain];
                if (!res) continue;
                if (this.citiesKnights && b.type === 'city') {
                    for (const [card, n] of Object.entries(ck.cityProduction(hex.terrain))) {
                        demand[card] ??= {};
                        demand[card][b.owner] = (demand[card][b.owner] || 0) + n;
                    }
                } else {
                    demand[res] ??= {};
                    demand[res][b.owner] = (demand[res][b.owner] || 0) + amount;
                }
            }
        });

        const received = s.players.map(() => ({}));
        for (const [res, byPlayer] of Object.entries(demand)) {
            const owners = Object.keys(byPlayer).map(Number);
            const total2 = owners.reduce((a, o) => a + byPlayer[o], 0);
            if (total2 <= s.bank[res]) {
                for (const o of owners) received[o][res] = byPlayer[o];
            } else if (owners.length === 1) {
                if (s.bank[res] > 0) received[owners[0]][res] = s.bank[res];
                this.log(`The bank is short of ${label(res)}.`);
            } else {
                this.log(`The bank is short of ${label(res)} — nobody receives any.`);
            }
        }
        received.forEach((cards, o) => {
            if (Object.keys(cards).length) {
                this.give(o, cards);
                this.log(`${this.name(o)} receives ${describeCards(cards)}.`);
            }
        });
        if (this.citiesKnights) ck.afterProduction(this, received, gold);
        this.queueGold(gold);
    }

    queueGold(gold) {
        const s = this.state;
        const bankTotal = RESOURCES.reduce((a, r) => a + s.bank[r], 0);
        let budget = bankTotal;
        for (const [o, n] of Object.entries(gold)) {
            const amount = Math.min(n, budget);
            budget -= amount;
            if (amount > 0) {
                s.pending.gold[o] = amount;
                this.log(`✨ ${this.name(Number(o))} may choose ${amount} resource${amount > 1 ? 's' : ''} from the gold field.`);
            }
        }
    }

    hexVertices(hexIndex) {
        return this.hexCorners[hexIndex];
    }

    hexEdges(hexIndex) {
        return this.hexSides[hexIndex];
    }

    handLimit(owner) {
        return this.settings.discardLimit + (this.citiesKnights ? ck.extraHandLimit(this, owner) : 0);
    }

    handleSeven() {
        const s = this.state;
        s.players.forEach((p, i) => {
            const n = handSize(p.hand);
            if (n > this.handLimit(i)) {
                s.pending.discard[i] = Math.floor(n / 2);
                this.log(`${p.name} must discard ${Math.floor(n / 2)} cards.`);
            }
        });
        if (this.citiesKnights && !ck.robberActive(this)) {
            this.log('The robber is not active until the barbarians first attack.');
            return;
        }
        s.pending.robber = { reason: 'seven' };
    }

    robberTargets(piece) {
        const s = this.state;
        const out = [];
        s.board.hexes.forEach((h, i) => {
            if (piece === 'robber' && h.terrain !== 'sea' && i !== s.robber) out.push(i);
            if (piece === 'pirate' && h.terrain === 'sea' && i !== s.pirate) out.push(i);
        });
        return out;
    }

    stealCandidates(hexIndex, piece, thief) {
        const s = this.state;
        const set = new Set();
        if (piece === 'robber') {
            for (const vid of this.hexVertices(hexIndex)) {
                const b = s.buildings[vid];
                if (b && b.owner !== thief) set.add(b.owner);
            }
        } else {
            for (const eid of this.hexEdges(hexIndex)) {
                const r = s.roads[eid];
                if (r && r.type === 'ship' && r.owner !== thief) set.add(r.owner);
            }
        }
        return [...set].filter((o) => handSize(s.players[o].hand) > 0).sort((a, b) => a - b);
    }

    stealFrom(thief, victim) {
        const s = this.state;
        const cards = handToList(s.players[victim].hand);
        if (!cards.length) return;
        const card = cards[this.rng.int(cards.length)];
        s.players[victim].hand[card]--;
        s.players[thief].hand[card]++;
        this.log(`${this.name(thief)} steals a card from ${this.name(victim)}.`, {
            [thief]: `You steal 1 ${label(card)} from ${this.name(victim)}.`,
            [victim]: `${this.name(thief)} steals 1 ${label(card)} from you.`,
        });
    }

    endTurnNow() {
        const s = this.state;
        s.trades = [];
        if (s.phase === 'main' && this.settings.specialBuildPhase && s.players.length > 1) {
            const queue = [];
            for (let k = 1; k < s.players.length; k++) queue.push((s.current + k) % s.players.length);
            s.phase = 'specialBuild';
            s.specialBuild = { queue };
            this.log(`Special building phase: ${this.name(queue[0])} may build.`);
            return;
        }
        this.startTurn((s.current + 1) % s.players.length);
    }

    advanceSpecialBuild() {
        const s = this.state;
        s.specialBuild.queue.shift();
        if (!s.specialBuild.queue.length) {
            this.startTurn((s.current + 1) % s.players.length);
        } else {
            this.log(`Special building phase: ${this.name(s.specialBuild.queue[0])} may build.`);
        }
    }

    // ------------------------------------------------------------------
    // Building (shared by setup, normal play, road building, special build)
    // ------------------------------------------------------------------

    placeBuilding(idx, piece, at) {
        const s = this.state;
        assert(typeof at === 'string' && at.length < 40, 'Invalid location');
        const left = this.piecesLeft(idx);
        if (piece === 'settlement') {
            assert(left.settlements > 0, 'You have no settlements left');
            s.buildings[at] = { owner: idx, type: 'settlement' };
        } else if (piece === 'city') {
            assert(left.cities > 0, 'You have no cities left');
            s.buildings[at] = { ...s.buildings[at], owner: idx, type: 'city' };
        } else if (piece === 'road') {
            assert(left.roads > 0, 'You have no roads left');
            s.roads[at] = { owner: idx, type: 'road', turn: s.turn };
        } else if (piece === 'ship') {
            assert(left.ships > 0, 'You have no ships left');
            s.roads[at] = { owner: idx, type: 'ship', turn: s.turn };
        }
    }
}

// ----------------------------------------------------------------------
// Action handlers (called with `this` bound to the Game)
// ----------------------------------------------------------------------

const PIECES = ['settlement', 'city', 'road', 'ship'];

function setupBuild(idx, { piece, at }) {
    const s = this.state;
    const setup = s.setup;
    assert(s.current === idx, 'It is not your turn');
    assert(!this.hasPending(), 'Resolve the current action first');
    if (setup.step === 'road') {
        assert(piece === 'road' || piece === 'ship', 'Place a road next to your new settlement');
        const ok = piece === 'road'
            ? this.canPlaceRoad(idx, at, { fromVertex: setup.lastVertex })
            : this.canPlaceShip(idx, at, { fromVertex: setup.lastVertex });
        assert(ok, `You cannot place a ${piece} there`);
        this.placeBuilding(idx, piece, at);
        this.log(`${this.name(idx)} places a ${piece}.`);
        this.advanceSetup();
        this.skipStuckSetup();
        return;
    }
    const want = setup.step; // 'settlement' or 'city'
    assert(piece === want, `Place a ${want} first`);
    assert(this.canPlaceSettlement(idx, at, { setup: true }), `You cannot place a ${want} there`);
    s.buildings[at] = { owner: idx, type: want };
    setup.lastVertex = at;
    setup.step = 'road';
    this.log(`${this.name(idx)} places a ${want}.`);

    const secondRound = setup.index >= s.players.length;
    if (secondRound) {
        const v = this.graph.vertices.get(at);
        const cards = {};
        const gold = {};
        for (const h of v.hexes) {
            const terrain = s.board.hexes[h].terrain;
            if (terrain === 'gold') gold[idx] = (gold[idx] || 0) + 1;
            const res = TERRAIN_RESOURCE[terrain];
            if (res && s.bank[res] > 0) cards[res] = (cards[res] || 0) + 1;
        }
        if (Object.keys(cards).length) {
            this.give(idx, cards);
            this.log(`${this.name(idx)} receives ${describeCards(cards)}.`);
        }
        this.queueGold(gold);
    }
    this.skipStuckSetup();
}

const ACTIONS = {
    build(idx, action) {
        const { piece, at } = action;
        assert(PIECES.includes(piece), 'Unknown piece');
        const s = this.state;
        if (s.phase === 'setup') return setupBuild.call(this, idx, action);

        // Free roads from the Road Building card.
        if (s.pending.roadBuilding > 0 && !Object.keys(s.pending.gold).length) {
            assert(s.current === idx, 'It is not your turn');
            assert(piece === 'road' || piece === 'ship', 'Place your free roads first');
            const ok = piece === 'road' ? this.canPlaceRoad(idx, at) : this.canPlaceShip(idx, at);
            assert(ok, `You cannot place a ${piece} there`);
            this.placeBuilding(idx, piece, at);
            s.pending.roadBuilding--;
            this.log(`${this.name(idx)} places a free ${piece}.`);
            if (s.pending.roadBuilding > 0 && !this.anyFreeRoadSpot(idx)) s.pending.roadBuilding = 0;
            return;
        }

        this.requireTurn(idx, ['main', 'specialBuild']);
        if (piece === 'settlement') {
            assert(this.canPlaceSettlement(idx, at), 'You cannot build a settlement there');
            assert(this.piecesLeft(idx).settlements > 0, 'You have no settlements left');
            this.pay(idx, COSTS.settlement);
            this.placeBuilding(idx, 'settlement', at);
            this.checkIslandBonus(idx, at);
        } else if (piece === 'city') {
            assert(this.canPlaceCity(idx, at), 'You can only upgrade your own settlement');
            assert(this.piecesLeft(idx).cities > 0, 'You have no cities left');
            this.pay(idx, this.citiesKnights ? ck.cityCost(this, idx) : COSTS.city);
            this.placeBuilding(idx, 'city', at);
        } else if (piece === 'road') {
            assert(this.canPlaceRoad(idx, at), 'You cannot build a road there');
            assert(this.piecesLeft(idx).roads > 0, 'You have no roads left');
            this.pay(idx, COSTS.road);
            this.placeBuilding(idx, 'road', at);
        } else {
            assert(this.seafarers, 'Ships require the Seafarers expansion');
            assert(this.canPlaceShip(idx, at), 'You cannot build a ship there');
            assert(this.piecesLeft(idx).ships > 0, 'You have no ships left');
            this.pay(idx, COSTS.ship);
            this.placeBuilding(idx, 'ship', at);
        }
        this.log(`${this.name(idx)} builds a ${piece}.`);
    },

    moveShip(idx, { from, to }) {
        const s = this.state;
        assert(this.seafarers, 'Ships require the Seafarers expansion');
        this.requireTurn(idx, ['main']);
        assert(!s.turnFlags.shipMoved, 'You already moved a ship this turn');
        assert(typeof from === 'string' && typeof to === 'string', 'Invalid location');
        assert(this.movableShips(idx).includes(from), 'That ship cannot be moved');
        assert(this.shipDestinations(idx, from).includes(to), 'The ship cannot move there');
        const ship = s.roads[from];
        delete s.roads[from];
        s.roads[to] = ship;
        s.turnFlags.shipMoved = true;
        this.log(`${this.name(idx)} moves a ship.`);
    },

    rollDice(idx) {
        const s = this.state;
        this.requireTurn(idx, ['preRoll']);
        if (this.citiesKnights) return ck.rollDice(this, idx);
        const d1 = this.rng.int(6) + 1;
        const d2 = this.rng.int(6) + 1;
        const total = d1 + d2;
        s.lastRoll = { dice: [d1, d2], total, by: idx, turn: s.turn };
        s.phase = 'main';
        this.log(`🎲 ${this.name(idx)} rolls ${total} (${d1} + ${d2}).`);
        if (total === 7) this.handleSeven();
        else this.produce(total);
    },

    discard(idx, { cards }) {
        const s = this.state;
        const need = s.pending.discard[idx];
        assert(need, 'You do not need to discard');
        assert(!Object.keys(s.pending.gold).length, 'Waiting for gold choices');
        const parsed = parseHand(cards, this.cardTypes);
        assert(handSize(parsed) === need, `Choose exactly ${need} cards to discard`);
        assert(hasCards(s.players[idx].hand, parsed), 'You do not have those cards');
        transfer(s.players[idx].hand, s.bank, parsed);
        delete s.pending.discard[idx];
        this.log(`${this.name(idx)} discards ${need} cards.`, { [idx]: `You discard ${describeCards(parsed)}.` });
    },

    moveRobber(idx, { hex, piece = 'robber' }) {
        const s = this.state;
        assert(s.pending.robber, 'You cannot move the robber now');
        assert(s.current === idx, 'It is not your turn');
        assert(!Object.keys(s.pending.discard).length, 'Waiting for players to discard');
        assert(piece === 'robber' || (piece === 'pirate' && this.seafarers), 'Invalid piece');
        assert(Number.isInteger(hex) && this.robberTargets(piece).includes(hex), `You cannot move the ${piece} there`);
        if (piece === 'robber') s.robber = hex;
        else s.pirate = hex;
        const reason = s.pending.robber.reason;
        s.pending.robber = null;
        this.log(`${this.name(idx)} moves the ${piece}.`);
        const candidates = this.stealCandidates(hex, piece, idx);
        if (this.citiesKnights && reason === 'bishop') {
            for (const v of candidates) this.stealFrom(idx, v);
            return;
        }
        if (candidates.length === 1) this.stealFrom(idx, candidates[0]);
        else if (candidates.length > 1) s.pending.steal = { candidates, piece };
    },

    steal(idx, { victim }) {
        const s = this.state;
        assert(s.pending.steal && s.current === idx, 'You cannot steal now');
        assert(s.pending.steal.candidates.includes(victim), 'Choose a valid player to steal from');
        s.pending.steal = null;
        this.stealFrom(idx, victim);
    },

    chooseGold(idx, { cards }) {
        const s = this.state;
        const need = s.pending.gold[idx];
        assert(need, 'You have no gold to spend');
        const parsed = parseHand(cards, RESOURCES);
        assert(handSize(parsed) === need, `Choose exactly ${need} resource${need > 1 ? 's' : ''}`);
        assert(hasCards(s.bank, parsed), 'The bank does not have those resources');
        this.give(idx, parsed);
        delete s.pending.gold[idx];
        this.log(`${this.name(idx)} takes ${describeCards(parsed)} from the gold field.`);
    },

    endTurn(idx) {
        const s = this.state;
        if (s.phase === 'specialBuild') {
            assert(!this.hasPending(), 'Resolve the current action first');
            assert(s.specialBuild.queue[0] === idx, 'It is not your turn to build');
            this.advanceSpecialBuild();
            return;
        }
        this.requireTurn(idx, ['main']);
        if (this.citiesKnights) ck.beforeEndTurn(this, idx);
        this.endTurnNow();
    },

    buyDevCard(idx) {
        const s = this.state;
        assert(!this.citiesKnights, 'There are no development cards in Cities & Knights');
        this.requireTurn(idx, ['main', 'specialBuild']);
        assert(s.devDeck.length > 0, 'No development cards left');
        this.pay(idx, COSTS.devCard);
        const type = s.devDeck.pop();
        s.players[idx].devCards.push({ type, turn: s.turn });
        this.log(`${this.name(idx)} buys a development card.`, { [idx]: `You buy a ${DEV_LABELS[type]} card.` });
    },

    playDevCard(idx, action) {
        const s = this.state;
        const { card } = action;
        assert(!this.citiesKnights, 'There are no development cards in Cities & Knights');
        this.requireTurn(idx, ['preRoll', 'main']);
        assert(card !== 'victoryPoint', 'Victory point cards are counted automatically');
        assert(!s.turnFlags.devPlayed, 'You can only play one development card per turn');
        const p = s.players[idx];
        const i = p.devCards.findIndex((c) => c.type === card && c.turn < s.turn);
        assert(i >= 0, 'You have no playable card of that type (cards cannot be played the turn they are bought)');

        // Validate choices before consuming the card.
        let choice;
        if (card === 'yearOfPlenty') {
            choice = parseHand(action.cards, RESOURCES);
            const n = handSize(choice);
            const available = Math.min(2, RESOURCES.reduce((a, r) => a + s.bank[r], 0));
            assert(n === available && n > 0, 'Choose 2 resources');
            assert(hasCards(s.bank, choice), 'The bank does not have those resources');
        } else if (card === 'monopoly') {
            assert(RESOURCES.includes(action.resource), 'Choose a resource');
        } else if (card === 'roadBuilding') {
            assert(this.anyFreeRoadSpot(idx), 'You have nowhere to build a road');
        } else {
            assert(card === 'knight', 'Unknown card');
        }

        p.devCards.splice(i, 1);
        s.turnFlags.devPlayed = true;
        this.log(`${p.name} plays ${DEV_LABELS[card]}.`);

        if (card === 'knight') {
            p.knightsPlayed++;
            const holder = s.largestArmy;
            if (p.knightsPlayed >= 3 && holder !== idx && (holder === null || p.knightsPlayed > s.players[holder].knightsPlayed)) {
                s.largestArmy = idx;
                this.log(`⚔️ ${p.name} takes the Largest Army (${p.knightsPlayed}).`);
            }
            s.pending.robber = { reason: 'knight' };
        } else if (card === 'yearOfPlenty') {
            this.give(idx, choice);
            this.log(`${p.name} takes ${describeCards(choice)}.`);
        } else if (card === 'monopoly') {
            const res = action.resource;
            let total = 0;
            s.players.forEach((o, oi) => {
                if (oi === idx || !o.hand[res]) return;
                total += o.hand[res];
                p.hand[res] += o.hand[res];
                o.hand[res] = 0;
            });
            this.log(`${p.name} takes all ${label(res)} (${total}).`);
        } else if (card === 'roadBuilding') {
            s.pending.roadBuilding = Math.min(2, this.piecesLeft(idx).roads + this.piecesLeft(idx).ships);
        }
    },

    skipRoadBuilding(idx) {
        const s = this.state;
        assert(s.pending.roadBuilding > 0 && s.current === idx, 'Nothing to skip');
        s.pending.roadBuilding = 0;
        this.log(`${this.name(idx)} forfeits the remaining free roads.`);
    },

    maritimeTrade(idx, { give, get, count = 1 }) {
        const s = this.state;
        this.requireTurn(idx, ['main']);
        assert(this.cardTypes.includes(give) && this.cardTypes.includes(get), 'Invalid resource');
        assert(give !== get, 'Choose two different resources');
        assert(Number.isInteger(count) && count >= 1 && count <= LIMITS.maxTradeAmount, 'Invalid amount');
        const ratio = this.portRatios(idx)[give];
        const cost = { [give]: ratio * count };
        assert(hasCards(s.players[idx].hand, cost), `You need ${ratio * count} ${label(give)}`);
        assert(s.bank[get] >= count, `The bank has only ${s.bank[get]} ${label(get)}`);
        transfer(s.players[idx].hand, s.bank, cost);
        this.give(idx, { [get]: count });
        this.log(`${this.name(idx)} trades ${ratio * count} ${label(give)} for ${count} ${label(get)} with the bank.`);
    },

    offerTrade(idx, action) {
        const s = this.state;
        assert(s.phase === 'main' && !this.hasPending(), 'You can only trade during the main phase');
        const give = parseHand(action.give, this.cardTypes, LIMITS.maxTradeAmount);
        const get = parseHand(action.get, this.cardTypes, LIMITS.maxTradeAmount);
        assert(handSize(give) > 0 && handSize(get) > 0, 'A trade must include cards on both sides');
        for (const k in give) assert(!get[k], 'You cannot trade a resource for itself');
        assert(hasCards(s.players[idx].hand, give), 'You do not have those cards');
        let to = action.to ?? null;
        if (idx !== s.current) {
            to = s.current; // counter-offers always go to the active player
        } else if (to !== null) {
            assert(Number.isInteger(to) && to >= 0 && to < s.players.length && to !== idx, 'Invalid trade partner');
        }
        const mine = s.trades.filter((t) => t.from === idx);
        assert(mine.length < 5, 'You have too many open offers');
        const trade = { id: s.nextTradeId++, from: idx, to, give, get, accepted: [], rejected: [] };
        s.trades.push(trade);
        this.log(`${this.name(idx)} offers ${describeCards(give)} for ${describeCards(get)}${to !== null ? ` to ${this.name(to)}` : ''}.`);
    },

    respondTrade(idx, { id, accept }) {
        const s = this.state;
        assert(s.phase === 'main' && !this.hasPending(), 'You can only trade during the main phase');
        const trade = s.trades.find((t) => t.id === id);
        assert(trade, 'That offer is no longer available');
        assert(trade.from !== idx, 'You cannot respond to your own offer');
        assert(trade.to === null || trade.to === idx, 'That offer is not for you');
        assert(trade.from === s.current || idx === s.current, 'Only the active player can trade');
        trade.accepted = trade.accepted.filter((p) => p !== idx);
        trade.rejected = trade.rejected.filter((p) => p !== idx);
        if (!accept) {
            trade.rejected.push(idx);
            if (trade.from !== s.current) s.trades = s.trades.filter((t) => t !== trade);
            return;
        }
        assert(hasCards(s.players[idx].hand, trade.get), 'You do not have the requested cards');
        if (idx === s.current) {
            // The active player accepting a counter-offer executes it immediately.
            executeTrade.call(this, trade, idx);
        } else {
            trade.accepted.push(idx);
        }
    },

    confirmTrade(idx, { id, partner }) {
        const s = this.state;
        assert(s.phase === 'main' && !this.hasPending(), 'You can only trade during the main phase');
        const trade = s.trades.find((t) => t.id === id);
        assert(trade && trade.from === idx, 'That offer is no longer available');
        assert(trade.accepted.includes(partner), 'That player has not accepted');
        executeTrade.call(this, trade, partner);
    },

    cancelTrade(idx, { id }) {
        const s = this.state;
        const trade = s.trades.find((t) => t.id === id);
        assert(trade && trade.from === idx, 'That offer is no longer available');
        s.trades = s.trades.filter((t) => t !== trade);
    },
};

function executeTrade(trade, partner) {
    const s = this.state;
    const a = s.players[trade.from];
    const b = s.players[partner];
    assert(hasCards(a.hand, trade.give), `${a.name} no longer has the offered cards`);
    assert(hasCards(b.hand, trade.get), `${b.name} no longer has the requested cards`);
    transfer(a.hand, b.hand, trade.give);
    transfer(b.hand, a.hand, trade.get);
    s.trades = s.trades.filter((t) => t !== trade);
    this.log(`🤝 ${a.name} trades ${describeCards(trade.give)} to ${b.name} for ${describeCards(trade.get)}.`);
}

Game.prototype.anyFreeRoadSpot = function anyFreeRoadSpot(idx) {
    const left = this.piecesLeft(idx);
    for (const e of this.graph.edges.keys()) {
        if (left.roads > 0 && this.canPlaceRoad(idx, e)) return true;
        if (left.ships > 0 && this.canPlaceShip(idx, e)) return true;
    }
    return false;
};

export { ACTIONS, describeCards, DEV_LABELS, addCards };

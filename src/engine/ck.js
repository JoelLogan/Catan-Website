// Cities & Knights expansion rules.
//
// Hooks in this module are called by the core engine (game.js) when the
// expansion is enabled. Action handlers in ACTIONS are invoked with `this`
// bound to the Game instance.
//
// Interactive effects that need input from players other than the one acting
// (barbarian losses, Wedding, Deserter, displaced knights, ...) are modelled
// as "prompts": small requests queued in state.ck.prompts that the named
// player resolves with the `resolvePrompt` action. The game waits until all
// prompts are resolved.

import { RESOURCES, COMMODITIES, COSTS, CK, TERRAIN_RESOURCE, TERRAIN_COMMODITY, RESOURCE_LABELS } from '../../shared/constants.js';
import { assert } from './errors.js';
import { shuffle } from './rng.js';
import { handSize, hasCards, transfer, parseHand, handToList } from './hand.js';

export const COMMODITY_BANK_SIZE = 12;

const TRACKS = CK.tracks; // trade (yellow), politics (blue), science (green)
const EVENT_FACES = ['ship', 'ship', 'ship', 'trade', 'politics', 'science'];

export const PROGRESS_DECKS = Object.freeze({
    science: {
        alchemist: 2, crane: 2, engineer: 1, inventor: 2, irrigation: 2,
        medicine: 2, mining: 2, printer: 1, roadBuilding: 2, smith: 2,
    },
    trade: {
        commercialHarbor: 2, masterMerchant: 2, merchant: 6, merchantFleet: 2,
        resourceMonopoly: 4, tradeMonopoly: 2,
    },
    politics: {
        bishop: 2, constitution: 1, deserter: 2, diplomat: 2, intrigue: 2,
        saboteur: 2, spy: 3, warlord: 2, wedding: 2,
    },
});

export const PROGRESS_LABELS = Object.freeze({
    alchemist: 'Alchemist', crane: 'Crane', engineer: 'Engineer', inventor: 'Inventor',
    irrigation: 'Irrigation', medicine: 'Medicine', mining: 'Mining', printer: 'Printer',
    roadBuilding: 'Road Building', smith: 'Smith', commercialHarbor: 'Commercial Harbor',
    masterMerchant: 'Master Merchant', merchant: 'Merchant', merchantFleet: 'Merchant Fleet',
    resourceMonopoly: 'Resource Monopoly', tradeMonopoly: 'Trade Monopoly', bishop: 'Bishop',
    constitution: 'Constitution', deserter: 'Deserter', diplomat: 'Diplomat', intrigue: 'Intrigue',
    saboteur: 'Saboteur', spy: 'Spy', warlord: 'Warlord', wedding: 'Wedding',
});

const VP_CARDS = ['printer', 'constitution'];
const KNIGHT_NAMES = { 1: 'basic', 2: 'strong', 3: 'mighty' };
const label = (r) => RESOURCE_LABELS[r] || r;

function describe(cards) {
    const parts = [];
    for (const k in cards) if (cards[k]) parts.push(`${cards[k]} ${label(k)}`);
    return parts.join(', ') || 'nothing';
}

// ----------------------------------------------------------------------
// State
// ----------------------------------------------------------------------

export function initState(game) {
    const s = game.state;
    let nextId = 1;
    const decks = {};
    for (const track of TRACKS) {
        const cards = [];
        for (const [type, n] of Object.entries(PROGRESS_DECKS[track])) {
            for (let i = 0; i < n; i++) cards.push({ id: nextId++, type, track });
        }
        decks[track] = shuffle(game.rng, cards);
    }
    s.knights = Object.create(null); // vertexId -> {owner, level, active, activatedTurn, actedTurn, promotedTurn}
    s.ck = {
        barbarian: 0,
        attacks: 0,
        decks,
        metropolis: { trade: null, politics: null, science: null }, // {owner, vertex}
        merchant: null, // {hex, owner}
        prompts: [],
        nextPromptId: 1,
        turn: freshTurn(),
        lastAttack: null,
    };
    for (const p of s.players) {
        p.ck = { improvements: { trade: 0, politics: 0, science: 0 }, progress: [], defender: 0, vpCards: [] };
    }
}

function freshTurn() {
    return { crane: false, merchantFleet: [], alchemist: null };
}

export function onTurnStart(game) {
    game.state.ck.turn = freshTurn();
}

export function hasPending(game) {
    return game.state.ck.prompts.length > 0;
}

export function clearPending(game) {
    game.state.ck.prompts = [];
}

export function waitingOn(game) {
    const prompts = game.state.ck.prompts;
    if (!prompts.length) return null;
    return { kind: 'prompt', players: [...new Set(prompts.map((p) => p.player))] };
}

function addPrompt(game, player, kind, data = {}) {
    const ck = game.state.ck;
    ck.prompts.push({ id: ck.nextPromptId++, player, kind, ...data });
}

// ----------------------------------------------------------------------
// Queries
// ----------------------------------------------------------------------

export function robberActive(game) {
    return game.state.ck.attacks > 0;
}

export function extraHandLimit(game, owner) {
    return 2 * wallCount(game, owner);
}

function wallCount(game, owner) {
    let n = 0;
    for (const v in game.state.buildings) {
        const b = game.state.buildings[v];
        if (b.owner === owner && b.wall) n++;
    }
    return n;
}

function cities(game, owner) {
    return Object.keys(game.state.buildings).filter((v) => {
        const b = game.state.buildings[v];
        return b.owner === owner && b.type === 'city';
    });
}

function metropolisVertices(game) {
    return new Set(Object.values(game.state.ck.metropolis).filter(Boolean).map((m) => m.vertex));
}

export function extraVictoryPoints(game, owner) {
    const s = game.state;
    let vp = 0;
    for (const m of Object.values(s.ck.metropolis)) if (m && m.owner === owner) vp += 2;
    const p = s.players[owner].ck;
    vp += p.defender + p.vpCards.length;
    if (s.ck.merchant && s.ck.merchant.owner === owner) vp += 1;
    return vp;
}

export function cityProduction(terrain) {
    const res = TERRAIN_RESOURCE[terrain];
    const com = TERRAIN_COMMODITY[terrain];
    return com ? { [res]: 1, [com]: 1 } : { [res]: 2 };
}

export function cityCost() {
    return COSTS.city;
}

export function adjustRatios(game, owner, ratios) {
    const s = game.state;
    const p = s.players[owner].ck;
    if (p.improvements.trade >= 3) for (const c of COMMODITIES) ratios[c] = Math.min(ratios[c], 2);
    if (s.ck.merchant && s.ck.merchant.owner === owner) {
        const res = TERRAIN_RESOURCE[s.board.hexes[s.ck.merchant.hex].terrain];
        if (res) ratios[res] = Math.min(ratios[res], 2);
    }
    if (owner === s.current) for (const t of s.ck.turn.merchantFleet) ratios[t] = Math.min(ratios[t], 2);
}

function knightStrength(game, owner, { activeOnly = true } = {}) {
    let n = 0;
    for (const v in game.state.knights) {
        const k = game.state.knights[v];
        if (k.owner === owner && (k.active || !activeOnly)) n += k.level;
    }
    return n;
}

function knightCount(game, owner, level) {
    return Object.values(game.state.knights).filter((k) => k.owner === owner && k.level === level).length;
}

function hasOwnRouteAt(game, owner, vertexId) {
    const v = game.graph.vertices.get(vertexId);
    return v.edges.some((e) => game.state.roads[e]?.owner === owner);
}

/** Empty vertices a knight at `from` can reach along its owner's roads. */
function knightReach(game, owner, from) {
    const s = game.state;
    const seen = new Set([from]);
    const queue = [from];
    const reach = [];
    while (queue.length) {
        const vid = queue.shift();
        const v = game.graph.vertices.get(vid);
        for (const e of v.edges) {
            if (s.roads[e]?.owner !== owner) continue;
            const next = e.split('|').find((x) => x !== vid);
            if (seen.has(next)) continue;
            seen.add(next);
            const b = s.buildings[next];
            const k = s.knights[next];
            if (b && b.owner !== owner) continue; // opponents block movement
            if (k) {
                if (k.owner !== owner) reach.push(next); // candidate for displacement, not passable
                else queue.push(next);
                continue;
            }
            if (!b) reach.push(next);
            queue.push(next);
        }
    }
    return reach;
}

function knightSpots(game, owner) {
    const out = [];
    for (const vid of game.graph.vertices.keys()) {
        if (game.vertexOccupied(vid)) continue;
        if (!game.vertexOnLand(game.graph.vertices.get(vid))) continue;
        if (hasOwnRouteAt(game, owner, vid)) out.push(vid);
    }
    return out;
}

function canAct(game, k) {
    const t = game.state.turn;
    return k.active && k.activatedTurn !== t && k.actedTurn !== t;
}

function isOpenRoad(game, edgeId) {
    const s = game.state;
    const r = s.roads[edgeId];
    if (!r || r.type !== 'road') return false;
    return edgeId.split('|').some((vid) => {
        const b = s.buildings[vid];
        if (b && b.owner === r.owner) return false;
        if (s.knights[vid]?.owner === r.owner) return false;
        const v = game.graph.vertices.get(vid);
        return !v.edges.some((o) => o !== edgeId && s.roads[o]?.owner === r.owner);
    });
}

// ----------------------------------------------------------------------
// Dice, barbarians, progress cards
// ----------------------------------------------------------------------

export function rollDice(game, idx, forced = null) {
    const s = game.state;
    const yellow = forced ? forced[0] : game.rng.int(6) + 1;
    const red = forced ? forced[1] : game.rng.int(6) + 1;
    const event = EVENT_FACES[game.rng.int(6)];
    const total = yellow + red;
    s.lastRoll = { dice: [yellow, red], total, event, by: idx, turn: s.turn };
    s.phase = 'main';
    const eventText = event === 'ship' ? 'barbarian ship' : `${event} gate`;
    game.log(`🎲 ${game.name(idx)} rolls ${total} (${yellow} + ${red}), event: ${eventText}.`);

    if (event === 'ship') {
        s.ck.barbarian++;
        if (s.ck.barbarian >= CK.barbarianTrackLength) {
            barbarianAttack(game);
            s.ck.barbarian = 0;
        } else {
            game.log(`⛵ The barbarians approach (${s.ck.barbarian}/${CK.barbarianTrackLength}).`);
        }
    } else {
        drawProgressForGate(game, event, red);
    }

    if (total === 7) game.handleSeven();
    else game.produce(total);
}

function drawProgressForGate(game, track, red) {
    const s = game.state;
    const n = s.players.length;
    for (let k = 0; k < n; k++) {
        const i = (s.current + k) % n;
        const level = s.players[i].ck.improvements[track];
        if (level >= 1 && red <= level + 1) drawProgress(game, i, track);
    }
}

function drawProgress(game, owner, track) {
    const s = game.state;
    const deck = s.ck.decks[track];
    if (!deck.length) return;
    const card = deck.pop();
    const p = s.players[owner];
    if (VP_CARDS.includes(card.type)) {
        p.ck.vpCards.push(card.type);
        game.log(`📜 ${p.name} draws ${PROGRESS_LABELS[card.type]} (+1 VP).`);
        return;
    }
    p.ck.progress.push(card);
    game.log(`${p.name} draws a ${track} progress card.`, { [owner]: `You draw ${PROGRESS_LABELS[card.type]}.` });
    if (owner !== s.current && p.ck.progress.length > CK.progressHandLimit) {
        addPrompt(game, owner, 'progressDiscard');
    }
}

function returnProgress(game, card) {
    game.state.ck.decks[card.track].unshift(card); // to the bottom
}

function barbarianAttack(game) {
    const s = game.state;
    const strength = s.players.reduce((a, _, i) => a + cities(game, i).length, 0);
    const contributions = s.players.map((_, i) => knightStrength(game, i));
    const defense = contributions.reduce((a, b) => a + b, 0);
    s.ck.attacks++;
    s.ck.lastAttack = { strength, defense, turn: s.turn };
    game.log(`⚔️ The barbarians attack! Strength ${strength} vs. defense ${defense}.`);

    if (strength > defense) {
        const metros = metropolisVertices(game);
        const exposed = s.players
            .map((_, i) => i)
            .filter((i) => cities(game, i).some((v) => !metros.has(v)));
        if (exposed.length) {
            const min = Math.min(...exposed.map((i) => contributions[i]));
            for (const i of exposed.filter((j) => contributions[j] === min)) {
                const options = cities(game, i).filter((v) => !metros.has(v));
                if (options.length === 1) loseCity(game, i, options[0]);
                else addPrompt(game, i, 'loseCity', { options });
            }
        } else {
            game.log('Every city is protected by a metropolis.');
        }
    } else {
        const max = Math.max(...contributions);
        const top = contributions.map((c, i) => (c === max ? i : -1)).filter((i) => i >= 0);
        if (max === 0) {
            game.log('The barbarians find nothing to plunder.');
        } else if (top.length === 1) {
            s.players[top[0]].ck.defender++;
            game.log(`🛡️ ${game.name(top[0])} is the Defender of Catan (+1 VP).`);
        } else {
            game.log(`The defense succeeds! ${top.map((i) => game.name(i)).join(', ')} each draw a progress card.`);
            for (const i of top) addPrompt(game, i, 'defenderDraw');
        }
    }
    for (const v in s.knights) s.knights[v].active = false;
}

function loseCity(game, owner, vertex) {
    const s = game.state;
    const b = s.buildings[vertex];
    if (game.piecesLeft(owner).settlements > 0) {
        s.buildings[vertex] = { owner, type: 'settlement' };
        game.log(`🔥 The barbarians reduce a city of ${game.name(owner)} to a settlement.`);
    } else {
        delete s.buildings[vertex];
        game.log(`🔥 The barbarians destroy a city of ${game.name(owner)}.`);
    }
    void b;
}

export function afterProduction(game, received, gold) {
    const s = game.state;
    s.players.forEach((p, i) => {
        if (p.ck.improvements.science < 3) return;
        if (Object.keys(received[i]).length || gold[i]) return;
        addPrompt(game, i, 'aqueduct');
    });
}

export function beforeEndTurn(game, idx) {
    const p = game.state.players[idx];
    assert(p.ck.progress.length <= CK.progressHandLimit, `Play or discard progress cards until you have at most ${CK.progressHandLimit}`);
}

// ----------------------------------------------------------------------
// Metropolis
// ----------------------------------------------------------------------

function awardMetropolis(game, owner, track) {
    const s = game.state;
    const level = s.players[owner].ck.improvements[track];
    const current = s.ck.metropolis[track];
    if (current && current.owner === owner) return;
    if (current) {
        const holderLevel = s.players[current.owner].ck.improvements[track];
        if (holderLevel >= level || level < CK.maxLevel) return;
    } else if (level < CK.metropolisLevel) {
        return;
    }
    const metros = metropolisVertices(game);
    const options = cities(game, owner).filter((v) => !metros.has(v));
    if (!options.length) return;
    const vertex = options[0];
    if (current) game.log(`🏰 ${game.name(owner)} takes the ${track} metropolis from ${game.name(current.owner)}.`);
    else game.log(`🏰 ${game.name(owner)} builds the ${track} metropolis (+2 VP).`);
    s.ck.metropolis[track] = { owner, vertex };
}

function canHostMetropolis(game, owner, track) {
    const s = game.state;
    const m = s.ck.metropolis[track];
    if (m && m.owner === owner) return true;
    const metros = metropolisVertices(game);
    return cities(game, owner).some((v) => !metros.has(v));
}

// ----------------------------------------------------------------------
// Action handlers
// ----------------------------------------------------------------------

function requireMain(game, idx) {
    game.requireTurn(idx, ['main']);
}

function takeProgress(game, idx, type) {
    const p = game.state.players[idx];
    const i = p.ck.progress.findIndex((c) => c.type === type);
    assert(i >= 0, 'You do not have that progress card');
    return i;
}

function consumeProgress(game, idx, i) {
    const p = game.state.players[idx];
    const [card] = p.ck.progress.splice(i, 1);
    returnProgress(game, card);
    game.log(`${p.name} plays ${PROGRESS_LABELS[card.type]}.`);
    return card;
}

function giveFromBank(game, idx, res, n) {
    const s = game.state;
    const amount = Math.min(n, s.bank[res]);
    if (amount > 0) game.give(idx, { [res]: amount });
    return amount;
}

function adjacentTerrainCount(game, owner, terrain) {
    let n = 0;
    game.state.board.hexes.forEach((h, i) => {
        if (h.terrain !== terrain) return;
        if (game.hexVertices(i).some((v) => game.state.buildings[v]?.owner === owner)) n++;
    });
    return n;
}

function promoteChecks(game, idx, vertex, { free = false } = {}) {
    const s = game.state;
    const k = s.knights[vertex];
    assert(k && k.owner === idx, 'Choose one of your knights');
    assert(k.promotedTurn !== s.turn, 'A knight can only be promoted once per turn');
    assert(k.level < 3, 'That knight is already mighty');
    if (k.level === 2) assert(s.players[idx].ck.improvements.politics >= 3, 'Mighty knights require a Fortress (politics level 3)');
    assert(knightCount(game, idx, k.level + 1) < CK.knightsPerLevel, `You have no ${KNIGHT_NAMES[k.level + 1]} knights left`);
    void free;
    return k;
}

function placeKnightChecks(game, idx, at, level) {
    assert(typeof at === 'string' && game.graph.vertices.has(at), 'Invalid location');
    assert(knightSpots(game, idx).includes(at), 'Knights must be placed on an empty spot on your road network');
    assert(knightCount(game, idx, level) < CK.knightsPerLevel, `You have no ${KNIGHT_NAMES[level]} knights left`);
}

export const ACTIONS = {
    buildKnight(idx, { at }) {
        requireMain(this, idx);
        placeKnightChecks(this, idx, at, 1);
        this.pay(idx, COSTS.knight);
        this.state.knights[at] = { owner: idx, level: 1, active: false, activatedTurn: null, actedTurn: null, promotedTurn: null };
        this.log(`${this.name(idx)} recruits a basic knight.`);
    },

    promoteKnight(idx, { at }) {
        requireMain(this, idx);
        const k = promoteChecks(this, idx, at);
        this.pay(idx, COSTS.promoteKnight);
        k.level++;
        k.promotedTurn = this.state.turn;
        this.log(`${this.name(idx)} promotes a knight to ${KNIGHT_NAMES[k.level]}.`);
    },

    activateKnight(idx, { at }) {
        requireMain(this, idx);
        const k = this.state.knights[at];
        assert(k && k.owner === idx, 'Choose one of your knights');
        assert(!k.active, 'That knight is already active');
        this.pay(idx, COSTS.activateKnight);
        k.active = true;
        k.activatedTurn = this.state.turn;
        this.log(`${this.name(idx)} activates a knight.`);
    },

    moveKnight(idx, { from, to }) {
        const s = this.state;
        requireMain(this, idx);
        const k = s.knights[from];
        assert(k && k.owner === idx, 'Choose one of your knights');
        assert(canAct(this, k), 'That knight must be active (and not activated this turn) to move');
        assert(typeof to === 'string' && knightReach(this, idx, from).includes(to), 'The knight cannot reach that spot');
        const target = s.knights[to];
        if (target) {
            assert(target.owner !== idx && target.level < k.level, 'You can only displace a weaker opposing knight');
        }
        delete s.knights[from];
        k.active = false;
        k.actedTurn = s.turn;
        s.knights[to] = k;
        if (target) {
            this.log(`⚔️ ${this.name(idx)}'s knight displaces a knight of ${this.name(target.owner)}.`);
            displaceKnight(this, target, to);
        } else {
            this.log(`${this.name(idx)} moves a knight.`);
        }
    },

    chaseRobber(idx, { at }) {
        const s = this.state;
        requireMain(this, idx);
        assert(robberActive(this), 'The robber is not active yet');
        const k = s.knights[at];
        assert(k && k.owner === idx, 'Choose one of your knights');
        assert(canAct(this, k), 'That knight must be active (and not activated this turn)');
        assert(s.robber !== null && this.hexVertices(s.robber).includes(at), 'The knight must be next to the robber');
        k.active = false;
        k.actedTurn = s.turn;
        s.pending.robber = { reason: 'knight' };
        this.log(`${this.name(idx)}'s knight chases away the robber.`);
    },

    buildCityWall(idx, { at }) {
        const s = this.state;
        requireMain(this, idx);
        const b = s.buildings[at];
        assert(b && b.owner === idx && b.type === 'city', 'City walls must be built around your cities');
        assert(!b.wall, 'That city already has a wall');
        assert(wallCount(this, idx) < CK.maxCityWalls, `You can have at most ${CK.maxCityWalls} city walls`);
        this.pay(idx, COSTS.cityWall);
        b.wall = true;
        this.log(`${this.name(idx)} builds a city wall.`);
    },

    improveCity(idx, { track }) {
        const s = this.state;
        requireMain(this, idx);
        assert(TRACKS.includes(track), 'Unknown improvement');
        const p = s.players[idx];
        assert(cities(this, idx).length > 0, 'You need a city to build improvements');
        const level = p.ck.improvements[track];
        assert(level < CK.maxLevel, 'That improvement is already complete');
        if (level + 1 >= CK.metropolisLevel) {
            assert(canHostMetropolis(this, idx, track), 'You need a city without a metropolis to go higher');
        }
        const commodity = CK.trackCommodity[track];
        const n = Math.max(0, level + 1 - (s.ck.turn.crane ? 1 : 0));
        this.pay(idx, { [commodity]: n });
        s.ck.turn.crane = false;
        p.ck.improvements[track] = level + 1;
        this.log(`${p.name} improves ${track} to level ${level + 1}.`);
        awardMetropolis(this, idx, track);
    },

    discardProgress(idx, { card }) {
        const s = this.state;
        const p = s.players[idx];
        const i = p.ck.progress.findIndex((c) => c.id === card);
        assert(i >= 0, 'You do not have that card');
        const [c] = p.ck.progress.splice(i, 1);
        returnProgress(this, c);
        this.log(`${p.name} discards a progress card.`);
        const prompt = s.ck.prompts.find((pr) => pr.player === idx && pr.kind === 'progressDiscard');
        if (prompt && p.ck.progress.length <= CK.progressHandLimit) {
            s.ck.prompts = s.ck.prompts.filter((pr) => pr !== prompt);
        }
    },

    resolvePrompt(idx, action) {
        const s = this.state;
        const prompt = s.ck.prompts.find((p) => p.id === action.id && p.player === idx);
        assert(prompt, 'Nothing to resolve');
        const handler = PROMPTS[prompt.kind];
        handler.call(this, idx, prompt, action);
        s.ck.prompts = s.ck.prompts.filter((p) => p !== prompt);
    },

    playProgress(idx, action) {
        const s = this.state;
        const { card } = action;
        assert(typeof card === 'string' && Object.hasOwn(PROGRESS_LABELS, card), 'Unknown card');
        assert(s.phase !== 'finished', 'The game is over');
        assert(!this.hasPending(), 'Resolve the current action first');
        assert(s.current === idx, 'It is not your turn');
        if (card === 'alchemist') {
            assert(s.phase === 'preRoll', 'Play the Alchemist before rolling');
        } else {
            assert(s.phase === 'main', 'Roll the dice first');
        }
        const i = takeProgress(this, idx, card);
        const effect = PROGRESS_EFFECTS[card];
        assert(effect, 'That card is played automatically');
        // Validate first (effects throw before mutating), then consume and apply.
        const apply = effect.call(this, idx, action);
        consumeProgress(this, idx, i);
        apply();
    },
};

function displaceKnight(game, knight, fromVertex) {
    const dests = knightReach(game, knight.owner, fromVertex).filter((v) => !game.state.knights[v]);
    if (!dests.length) {
        game.log(`The displaced knight of ${game.name(knight.owner)} has nowhere to go and is removed.`);
        return;
    }
    addPrompt(game, knight.owner, 'displaced', { knight: { ...knight, active: knight.active }, options: dests });
}

// ----------------------------------------------------------------------
// Prompt resolution
// ----------------------------------------------------------------------

const PROMPTS = {
    loseCity(idx, prompt, { vertex }) {
        assert(prompt.options.includes(vertex), 'Choose one of your cities');
        loseCity(this, idx, vertex);
    },

    defenderDraw(idx, prompt, { track }) {
        assert(TRACKS.includes(track), 'Choose a deck');
        drawProgress(this, idx, track);
    },

    aqueduct(idx, prompt, { resource }) {
        assert(RESOURCES.includes(resource), 'Choose a resource');
        assert(this.state.bank[resource] > 0, 'The bank has none of that resource');
        this.give(idx, { [resource]: 1 });
        this.log(`${this.name(idx)}'s aqueduct provides 1 ${label(resource)}.`);
    },

    progressDiscard(idx, prompt, { card }) {
        const p = this.state.players[idx];
        const i = p.ck.progress.findIndex((c) => c.id === card);
        assert(i >= 0, 'Choose one of your progress cards');
        const [c] = p.ck.progress.splice(i, 1);
        returnProgress(this, c);
        this.log(`${p.name} discards a progress card.`);
        if (p.ck.progress.length > CK.progressHandLimit) addPrompt(this, idx, 'progressDiscard');
    },

    displaced(idx, prompt, { vertex }) {
        assert(prompt.options.includes(vertex), 'Choose a spot on your road network');
        assert(!this.vertexOccupied(vertex), 'That spot is taken');
        const k = prompt.knight;
        this.state.knights[vertex] = { owner: idx, level: k.level, active: k.active, activatedTurn: k.activatedTurn, actedTurn: k.actedTurn, promotedTurn: k.promotedTurn };
        this.log(`${this.name(idx)} relocates the displaced knight.`);
    },

    giveCards(idx, prompt, { cards }) {
        const s = this.state;
        const parsed = parseHand(cards, this.cardTypes);
        assert(handSize(parsed) === prompt.count, `Choose ${prompt.count} card${prompt.count > 1 ? 's' : ''}`);
        assert(hasCards(s.players[idx].hand, parsed), 'You do not have those cards');
        transfer(s.players[idx].hand, s.players[prompt.to].hand, parsed);
        this.log(`${this.name(idx)} gives ${prompt.count} card${prompt.count > 1 ? 's' : ''} to ${this.name(prompt.to)}.`, {
            [idx]: `You give ${describe(parsed)} to ${this.name(prompt.to)}.`,
            [prompt.to]: `${this.name(idx)} gives you ${describe(parsed)}.`,
        });
    },

    harborReply(idx, prompt, { commodity }) {
        const s = this.state;
        if (!COMMODITIES.some((c) => s.players[idx].hand[c] > 0)) {
            this.log(`${this.name(idx)} has no commodities to trade.`);
            return;
        }
        assert(COMMODITIES.includes(commodity) && s.players[idx].hand[commodity] > 0, 'Choose a commodity you have');
        const from = s.players[prompt.to];
        transfer(s.players[idx].hand, from.hand, { [commodity]: 1 });
        // The offering player cannot act while prompts are open, so the resource is still there.
        transfer(from.hand, s.players[idx].hand, { [prompt.resource]: 1 });
        this.log(`${this.name(idx)} trades 1 ${label(commodity)} for 1 ${label(prompt.resource)} with ${from.name}.`);
    },

    takeCards(idx, prompt, { cards }) {
        const s = this.state;
        const victim = s.players[prompt.from];
        const count = Math.min(prompt.count, handSize(victim.hand));
        const parsed = parseHand(cards, this.cardTypes);
        assert(handSize(parsed) === count, `Choose ${count} cards`);
        assert(hasCards(victim.hand, parsed), 'They do not have those cards');
        transfer(victim.hand, s.players[idx].hand, parsed);
        this.log(`${this.name(idx)} takes ${count} cards from ${victim.name}.`, {
            [idx]: `You take ${describe(parsed)} from ${victim.name}.`,
            [prompt.from]: `${this.name(idx)} takes ${describe(parsed)} from you.`,
        });
    },

    spyPick(idx, prompt, { card }) {
        const s = this.state;
        const victim = s.players[prompt.from];
        const i = victim.ck.progress.findIndex((c) => c.id === card);
        if (card === null || card === undefined) {
            this.log(`${this.name(idx)} takes nothing.`);
            return;
        }
        assert(i >= 0, 'Choose one of their cards');
        const [c] = victim.ck.progress.splice(i, 1);
        s.players[idx].ck.progress.push(c);
        this.log(`${this.name(idx)} takes a progress card from ${victim.name}.`, {
            [idx]: `You take ${PROGRESS_LABELS[c.type]} from ${victim.name}.`,
            [prompt.from]: `${this.name(idx)} takes your ${PROGRESS_LABELS[c.type]}.`,
        });
    },

    removeKnight(idx, prompt, { vertex }) {
        const s = this.state;
        const k = s.knights[vertex];
        assert(k && k.owner === idx, 'Choose one of your knights');
        delete s.knights[vertex];
        this.log(`${this.name(idx)} loses a ${KNIGHT_NAMES[k.level]} knight to desertion.`);
        const spots = knightSpots(this, prompt.to);
        if (spots.length && knightCount(this, prompt.to, k.level) < CK.knightsPerLevel) {
            addPrompt(this, prompt.to, 'placeDeserter', { level: k.level, active: k.active });
        }
    },

    placeDeserter(idx, prompt, { vertex }) {
        if (vertex === null || vertex === undefined) return; // declined
        placeKnightChecks(this, idx, vertex, prompt.level);
        this.state.knights[vertex] = {
            owner: idx, level: prompt.level, active: prompt.active, activatedTurn: this.state.turn, actedTurn: null, promotedTurn: null,
        };
        this.log(`${this.name(idx)} gains a ${KNIGHT_NAMES[prompt.level]} knight.`);
    },
};

// ----------------------------------------------------------------------
// Progress card effects. Each validates and returns an `apply` closure.
// ----------------------------------------------------------------------

function opponents(game, idx) {
    return game.state.players.map((_, i) => i).filter((i) => i !== idx);
}

const PROGRESS_EFFECTS = {
    alchemist(idx, { dice }) {
        assert(Array.isArray(dice) && dice.length === 2 && dice.every((d) => Number.isInteger(d) && d >= 1 && d <= 6), 'Choose both dice (1–6)');
        return () => rollDice(this, idx, dice);
    },
    crane() {
        return () => { this.state.ck.turn.crane = true; };
    },
    engineer(idx, { at }) {
        const b = this.state.buildings[at];
        assert(b && b.owner === idx && b.type === 'city' && !b.wall, 'Choose one of your cities without a wall');
        assert(wallCount(this, idx) < CK.maxCityWalls, `You can have at most ${CK.maxCityWalls} city walls`);
        return () => {
            b.wall = true;
            this.log(`${this.name(idx)} builds a free city wall.`);
        };
    },
    inventor(idx, { hexes }) {
        const s = this.state;
        assert(Array.isArray(hexes) && hexes.length === 2 && hexes[0] !== hexes[1], 'Choose two tiles');
        const hs = hexes.map((h) => (Number.isInteger(h) ? s.board.hexes[h] : null));
        assert(hs.every((h) => h && h.number && ![2, 12, 6, 8].includes(h.number)), 'Choose two number tokens other than 2, 12, 6 and 8');
        return () => {
            [hs[0].number, hs[1].number] = [hs[1].number, hs[0].number];
            this.log(`${this.name(idx)} swaps two number tokens.`);
        };
    },
    irrigation(idx) {
        return () => {
            const n = giveFromBank(this, idx, 'wheat', 2 * adjacentTerrainCount(this, idx, 'fields'));
            this.log(`${this.name(idx)} receives ${n} ${label('wheat')}.`);
        };
    },
    mining(idx) {
        return () => {
            const n = giveFromBank(this, idx, 'ore', 2 * adjacentTerrainCount(this, idx, 'mountains'));
            this.log(`${this.name(idx)} receives ${n} ${label('ore')}.`);
        };
    },
    medicine(idx, { at }) {
        assert(this.canPlaceCity(idx, at), 'Choose one of your settlements');
        assert(this.piecesLeft(idx).cities > 0, 'You have no cities left');
        assert(hasCards(this.state.players[idx].hand, { ore: 2, wheat: 1 }), 'You need 2 ore and 1 grain');
        return () => {
            this.pay(idx, { ore: 2, wheat: 1 });
            this.placeBuilding(idx, 'city', at);
            this.log(`${this.name(idx)} builds a city.`);
        };
    },
    roadBuilding(idx) {
        assert(this.anyFreeRoadSpot(idx), 'You have nowhere to build a road');
        return () => {
            const left = this.piecesLeft(idx);
            this.state.pending.roadBuilding = Math.min(2, left.roads + left.ships);
        };
    },
    smith(idx, { knights }) {
        assert(Array.isArray(knights) && knights.length >= 1 && knights.length <= 2 && new Set(knights).size === knights.length, 'Choose one or two knights');
        const s = this.state;
        // Validate sequentially against a simulated state.
        const saved = knights.map((v) => (s.knights[v] ? { ...s.knights[v] } : null));
        try {
            for (const v of knights) {
                const k = promoteChecks(this, idx, v, { free: true });
                k.level++;
            }
        } finally {
            knights.forEach((v, i) => { if (saved[i]) s.knights[v] = saved[i]; });
        }
        return () => {
            for (const v of knights) {
                s.knights[v].level++;
                s.knights[v].promotedTurn = s.turn;
            }
            this.log(`${this.name(idx)} promotes ${knights.length} knight${knights.length > 1 ? 's' : ''}.`);
        };
    },
    commercialHarbor(idx, { offers }) {
        const s = this.state;
        assert(offers && typeof offers === 'object', 'Choose resources to offer');
        const total = {};
        const list = [];
        for (const [k, res] of Object.entries(offers)) {
            const o = Number(k);
            assert(Number.isInteger(o) && o >= 0 && o < s.players.length && o !== idx, 'Invalid player');
            assert(RESOURCES.includes(res), 'Offer a resource');
            total[res] = (total[res] || 0) + 1;
            list.push([o, res]);
        }
        assert(list.length > 0, 'Offer a resource to at least one player');
        assert(hasCards(s.players[idx].hand, total), 'You do not have those resources');
        return () => {
            for (const [o, res] of list) {
                const target = s.players[o];
                if (!COMMODITIES.some((c) => target.hand[c] > 0)) {
                    this.log(`${target.name} has no commodities to trade.`);
                    continue;
                }
                addPrompt(this, o, 'harborReply', { to: idx, resource: res });
            }
        };
    },
    masterMerchant(idx, { target }) {
        const s = this.state;
        assert(Number.isInteger(target) && target !== idx && s.players[target], 'Choose a player');
        assert(this.victoryPoints(target) > this.victoryPoints(idx), 'Choose a player with more victory points than you');
        assert(handSize(s.players[target].hand) > 0, 'That player has no cards');
        return () => addPrompt(this, idx, 'takeCards', { from: target, count: Math.min(2, handSize(s.players[target].hand)) });
    },
    merchant(idx, { hex }) {
        const s = this.state;
        const h = Number.isInteger(hex) && s.board.hexes[hex];
        assert(h && TERRAIN_RESOURCE[h.terrain], 'Choose a resource tile');
        assert(this.hexVertices(hex).some((v) => s.buildings[v]?.owner === idx), 'The merchant must be next to your settlement or city');
        return () => {
            s.ck.merchant = { hex, owner: idx };
            this.log(`${this.name(idx)} places the merchant (+1 VP).`);
        };
    },
    merchantFleet(idx, { resource }) {
        assert(this.cardTypes.includes(resource), 'Choose a resource or commodity');
        return () => {
            this.state.ck.turn.merchantFleet.push(resource);
        };
    },
    resourceMonopoly(idx, { resource }) {
        assert(RESOURCES.includes(resource), 'Choose a resource');
        return () => {
            let total = 0;
            for (const o of opponents(this, idx)) {
                const n = Math.min(2, this.state.players[o].hand[resource]);
                if (n) transfer(this.state.players[o].hand, this.state.players[idx].hand, { [resource]: n });
                total += n;
            }
            this.log(`${this.name(idx)} collects ${total} ${label(resource)}.`);
        };
    },
    tradeMonopoly(idx, { resource }) {
        assert(COMMODITIES.includes(resource), 'Choose a commodity');
        return () => {
            let total = 0;
            for (const o of opponents(this, idx)) {
                const n = Math.min(1, this.state.players[o].hand[resource]);
                if (n) transfer(this.state.players[o].hand, this.state.players[idx].hand, { [resource]: n });
                total += n;
            }
            this.log(`${this.name(idx)} collects ${total} ${label(resource)}.`);
        };
    },
    bishop() {
        assert(robberActive(this), 'The robber is not active yet');
        return () => { this.state.pending.robber = { reason: 'bishop' }; };
    },
    deserter(idx, { target }) {
        const s = this.state;
        assert(Number.isInteger(target) && target !== idx && s.players[target], 'Choose a player');
        assert(Object.values(s.knights).some((k) => k.owner === target), 'That player has no knights');
        return () => addPrompt(this, target, 'removeKnight', { to: idx });
    },
    diplomat(idx, { edge, to }) {
        const s = this.state;
        assert(typeof edge === 'string' && isOpenRoad(this, edge), 'Choose an open road');
        const owner = s.roads[edge].owner;
        if (to !== undefined && to !== null) {
            assert(owner === idx, 'You can only relocate your own road');
            const saved = s.roads[edge];
            delete s.roads[edge];
            const ok = to !== edge && this.canPlaceRoad(idx, to);
            s.roads[edge] = saved;
            assert(ok, 'You cannot place the road there');
        }
        return () => {
            const saved = s.roads[edge];
            delete s.roads[edge];
            if (to !== undefined && to !== null) {
                s.roads[to] = { ...saved, turn: s.turn };
                this.log(`${this.name(idx)} relocates a road.`);
            } else {
                this.log(`${this.name(idx)} removes a road of ${this.name(owner)}.`);
            }
        };
    },
    intrigue(idx, { at }) {
        const s = this.state;
        const k = typeof at === 'string' ? s.knights[at] : null;
        assert(k && k.owner !== idx, 'Choose an opposing knight');
        assert(hasOwnRouteAt(this, idx, at), 'The knight must be on your road network');
        return () => {
            delete s.knights[at];
            this.log(`${this.name(idx)} drives off a knight of ${this.name(k.owner)}.`);
            displaceKnight(this, k, at);
        };
    },
    saboteur(idx) {
        const s = this.state;
        const mine = this.victoryPoints(idx);
        return () => {
            s.players.forEach((p, i) => {
                if (i === idx || this.victoryPoints(i) < mine) return;
                const n = Math.floor(handSize(p.hand) / 2);
                if (n > 0) s.pending.discard[i] = n;
            });
        };
    },
    spy(idx, { target }) {
        const s = this.state;
        assert(Number.isInteger(target) && target !== idx && s.players[target], 'Choose a player');
        return () => addPrompt(this, idx, 'spyPick', { from: target });
    },
    warlord(idx) {
        return () => {
            for (const v in this.state.knights) {
                const k = this.state.knights[v];
                if (k.owner === idx && !k.active) {
                    k.active = true;
                    k.activatedTurn = this.state.turn;
                }
            }
            this.log(`${this.name(idx)} activates all knights.`);
        };
    },
    wedding(idx) {
        const s = this.state;
        const mine = this.victoryPoints(idx);
        return () => {
            s.players.forEach((p, i) => {
                if (i === idx || this.victoryPoints(i) <= mine) return;
                const count = Math.min(2, handSize(p.hand));
                if (count > 0) addPrompt(this, i, 'giveCards', { to: idx, count });
            });
        };
    },
};

// ----------------------------------------------------------------------
// Views and legal-move hints
// ----------------------------------------------------------------------

export function legalFor(game, me, w) {
    const s = game.state;
    const legal = {};
    if (w.kind === 'main') {
        const p = s.players[me];
        legal.knightSpots = knightCount(game, me, 1) < CK.knightsPerLevel ? knightSpots(game, me) : [];
        legal.knightMoves = {};
        legal.knightPromote = [];
        legal.knightActivate = [];
        legal.knightChase = [];
        for (const v in s.knights) {
            const k = s.knights[v];
            if (k.owner !== me) continue;
            if (!k.active) legal.knightActivate.push(v);
            const canPromote = k.level < 3 && k.promotedTurn !== s.turn &&
                (k.level < 2 || p.ck.improvements.politics >= 3) &&
                knightCount(game, me, k.level + 1) < CK.knightsPerLevel;
            if (canPromote) legal.knightPromote.push(v);
            if (canAct(game, k)) {
                const dests = knightReach(game, me, v).filter((t) => !s.knights[t] || s.knights[t].level < k.level);
                if (dests.length) legal.knightMoves[v] = dests;
                if (robberActive(game) && s.robber !== null && game.hexVertices(s.robber).includes(v)) legal.knightChase.push(v);
            }
        }
        legal.wallSpots = wallCount(game, me) < CK.maxCityWalls
            ? cities(game, me).filter((v) => !s.buildings[v].wall)
            : [];
    }
    if (w.kind === 'prompt') {
        const prompt = s.ck.prompts.find((pr) => pr.player === me);
        if (prompt && prompt.kind === 'placeDeserter') legal.knightSpots = knightSpots(game, me);
    }
    return legal;
}

export function view(game, me) {
    const s = game.state;
    const out = {
        barbarian: s.ck.barbarian,
        trackLength: CK.barbarianTrackLength,
        attacks: s.ck.attacks,
        lastAttack: s.ck.lastAttack,
        robberActive: robberActive(game),
        strength: s.players.reduce((a, _, i) => a + cities(game, i).length, 0),
        defense: s.players.reduce((a, _, i) => a + knightStrength(game, i), 0),
        metropolis: s.ck.metropolis,
        merchant: s.ck.merchant,
        knights: s.knights,
        deckCounts: Object.fromEntries(TRACKS.map((t) => [t, s.ck.decks[t].length])),
        players: s.players.map((p, i) => ({
            improvements: p.ck.improvements,
            progressCount: p.ck.progress.length,
            defender: p.ck.defender,
            vpCards: p.ck.vpCards,
            walls: wallCount(game, i),
            knightStrength: knightStrength(game, i),
        })),
        prompts: s.ck.prompts.map((p) => ({ player: p.player, kind: p.kind })),
        turn: { crane: s.ck.turn.crane, merchantFleet: s.ck.turn.merchantFleet },
    };
    if (me >= 0) {
        const p = s.players[me];
        out.progress = p.ck.progress.map((c) => ({ id: c.id, type: c.type, track: c.track }));
        out.myPrompts = s.ck.prompts
            .filter((pr) => pr.player === me)
            .map((pr) => {
                const data = { ...pr };
                // Reveal only what this prompt entitles the player to see.
                if (pr.kind === 'takeCards') data.hand = { ...s.players[pr.from].hand };
                if (pr.kind === 'spyPick') data.cards = s.players[pr.from].ck.progress.map((c) => ({ id: c.id, type: c.type }));
                if (pr.kind === 'removeKnight') data.options = Object.keys(s.knights).filter((v) => s.knights[v].owner === me);
                return data;
            });
    }
    return out;
}

// ----------------------------------------------------------------------
// Bot support
// ----------------------------------------------------------------------

function bestBy(list, score) {
    let top = null;
    let ts = -Infinity;
    for (const x of list) {
        const v = score(x);
        if (v > ts) {
            ts = v;
            top = x;
        }
    }
    return top;
}

function botPick(hand, count) {
    const h = { ...hand };
    const out = {};
    for (let i = 0; i < count; i++) {
        const k = bestBy(Object.keys(h).filter((x) => h[x] > 0), (x) => h[x]);
        if (!k) break;
        h[k]--;
        out[k] = (out[k] || 0) + 1;
    }
    return out;
}

export function botPendingAction(game, me, w) {
    const s = game.state;
    if (w.kind !== 'prompt') {
        // Keep the progress hand legal before ending the turn.
        const p = s.players[me];
        if ((w.kind === 'main') && s.current === me && p.ck.progress.length > CK.progressHandLimit) {
            return { type: 'discardProgress', card: p.ck.progress[0].id };
        }
        return null;
    }
    const prompt = s.ck.prompts.find((pr) => pr.player === me);
    const v = view(game, me).myPrompts.find((pr) => pr.id === prompt.id);
    const base = { type: 'resolvePrompt', id: prompt.id };
    const hand = s.players[me].hand;
    switch (prompt.kind) {
        case 'loseCity': return { ...base, vertex: prompt.options[0] };
        case 'defenderDraw': return { ...base, track: 'science' };
        case 'aqueduct': return { ...base, resource: RESOURCES.find((r) => s.bank[r] > 0) || 'ore' };
        case 'progressDiscard': return { ...base, card: s.players[me].ck.progress[0].id };
        case 'displaced': return { ...base, vertex: prompt.options[0] };
        case 'giveCards': return { ...base, cards: botPick(hand, prompt.count) };
        case 'harborReply': return { ...base, commodity: bestBy(COMMODITIES.filter((c) => hand[c] > 0), (c) => hand[c]) ?? null };
        case 'takeCards': return { ...base, cards: botPick(v.hand, prompt.count) };
        case 'spyPick': return { ...base, card: v.cards.length ? v.cards[0].id : null };
        case 'removeKnight': return { ...base, vertex: bestBy(v.options, (x) => -s.knights[x].level) };
        case 'placeDeserter': {
            const spots = knightSpots(game, me);
            return { ...base, vertex: spots.length ? spots[0] : null };
        }
        default: return null;
    }
}

export function botMainAction(game, me) {
    const s = game.state;
    const p = s.players[me];
    const hand = p.hand;
    const legal = legalFor(game, me, { kind: 'main' });

    // City improvements.
    for (const track of ['science', 'politics', 'trade']) {
        const level = p.ck.improvements[track];
        const com = CK.trackCommodity[track];
        if (level < CK.maxLevel && cities(game, me).length && hand[com] >= level + 1 &&
            (level + 1 < CK.metropolisLevel || canHostMetropolis(game, me, track))) {
            return { type: 'improveCity', track };
        }
    }
    // Defend against barbarians when they are close.
    const strength = s.players.reduce((a, _, i) => a + cities(game, i).length, 0);
    const defense = s.players.reduce((a, _, i) => a + knightStrength(game, i), 0);
    if (s.ck.barbarian >= 3 && defense < strength) {
        if (legal.knightActivate.length && hasCards(hand, COSTS.activateKnight)) {
            return { type: 'activateKnight', at: legal.knightActivate[0] };
        }
        if (legal.knightSpots.length && hasCards(hand, COSTS.knight)) {
            return { type: 'buildKnight', at: legal.knightSpots[0] };
        }
    }
    // Chase the robber off our own tiles.
    if (legal.knightChase.length && game.hexVertices(s.robber).some((v) => s.buildings[v]?.owner === me)) {
        return { type: 'chaseRobber', at: legal.knightChase[0] };
    }
    // Simple progress cards.
    const simple = ['irrigation', 'mining', 'warlord', 'wedding', 'saboteur'];
    const card = p.ck.progress.find((c) => simple.includes(c.type));
    if (card) return { type: 'playProgress', card: card.type };
    const mono = p.ck.progress.find((c) => c.type === 'resourceMonopoly');
    if (mono) return { type: 'playProgress', card: 'resourceMonopoly', resource: 'ore' };
    if (legal.wallSpots.length && hand.brick >= 4 && handSize(hand) > 7) return { type: 'buildCityWall', at: legal.wallSpots[0] };
    return null;
}

export { handToList, PROMPTS };

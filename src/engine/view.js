// Per-player views of a game. Views never leak hidden information: other
// players' hands and development cards are reduced to counts, the deck order
// is never sent, and private log lines are only shown to their recipients.
import { handSize } from './hand.js';
import * as ck from './ck.js';

const LOG_WINDOW = 80;

function legalFor(game, me) {
    const s = game.state;
    const w = game.waitingOn();
    if (!w.players.includes(me)) return null;
    const legal = {};
    const vertices = [...game.graph.vertices.keys()];
    const edges = [...game.graph.edges.keys()];

    if (w.kind === 'setup') {
        if (s.setup.step === 'road') {
            const left = game.piecesLeft(me);
            legal.roads = left.roads > 0 ? edges.filter((e) => game.canPlaceRoad(me, e, { fromVertex: s.setup.lastVertex })) : [];
            legal.ships = left.ships > 0 ? edges.filter((e) => game.canPlaceShip(me, e, { fromVertex: s.setup.lastVertex })) : [];
        } else {
            legal.settlements = vertices.filter((v) => game.canPlaceSettlement(me, v, { setup: true }));
        }
    } else if (w.kind === 'robber') {
        legal.robberHexes = game.robberTargets('robber');
        if (game.seafarers) legal.pirateHexes = game.robberTargets('pirate');
    } else if (w.kind === 'roadBuilding') {
        const left = game.piecesLeft(me);
        legal.roads = left.roads > 0 ? edges.filter((e) => game.canPlaceRoad(me, e)) : [];
        legal.ships = left.ships > 0 ? edges.filter((e) => game.canPlaceShip(me, e)) : [];
    } else if (w.kind === 'main' || w.kind === 'specialBuild') {
        const left = game.piecesLeft(me);
        legal.settlements = left.settlements > 0 ? vertices.filter((v) => game.canPlaceSettlement(me, v)) : [];
        legal.cities = left.cities > 0 ? vertices.filter((v) => game.canPlaceCity(me, v)) : [];
        legal.roads = left.roads > 0 ? edges.filter((e) => game.canPlaceRoad(me, e)) : [];
        legal.ships = left.ships > 0 ? edges.filter((e) => game.canPlaceShip(me, e)) : [];
        if (w.kind === 'main' && game.seafarers && !s.turnFlags.shipMoved) {
            legal.shipMoves = {};
            for (const from of game.movableShips(me)) {
                const dests = game.shipDestinations(me, from);
                if (dests.length) legal.shipMoves[from] = dests;
            }
        }
    }
    if (game.citiesKnights) Object.assign(legal, ck.legalFor(game, me, w));
    return legal;
}

export function viewFor(game, playerId) {
    const s = game.state;
    const me = playerId == null ? -1 : game.playerIndex(playerId);
    const settings = s.settings;

    const players = s.players.map((p, i) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        handCount: handSize(p.hand),
        devCount: p.devCards.length,
        knightsPlayed: p.knightsPlayed,
        routeLength: p.routeLength,
        vp: game.victoryPoints(i, { includeHidden: s.phase === 'finished' || i === me }),
        publicVp: game.victoryPoints(i),
        piecesLeft: game.piecesLeft(i),
        bonusIslands: p.bonusIslands.length,
    }));

    const log = s.log.slice(-LOG_WINDOW).map((e) => ({
        id: e.id,
        msg: (e.private && me >= 0 && e.private[me]) || e.msg,
    }));

    const view = {
        seq: s.seq,
        phase: s.phase,
        turn: s.turn,
        current: s.current,
        winner: s.winner,
        endReason: s.endReason || null,
        settings: {
            victoryPoints: settings.victoryPoints,
            expansions: settings.expansions,
            pieces: settings.pieces,
            discardLimit: settings.discardLimit,
            specialBuildPhase: settings.specialBuildPhase,
            islandBonus: settings.islandBonus,
        },
        board: s.board,
        robber: s.robber,
        pirate: s.pirate,
        buildings: s.buildings,
        roads: s.roads,
        players,
        bank: s.bank,
        devDeckCount: s.devDeck.length,
        longestRoad: s.longestRoad,
        largestArmy: s.largestArmy,
        lastRoll: s.lastRoll,
        waiting: game.waitingOn(),
        setupStep: s.setup ? s.setup.step : null,
        pending: {
            discard: s.pending.discard,
            gold: s.pending.gold,
            robber: !!s.pending.robber,
            steal: s.pending.steal ? s.pending.steal.candidates : null,
            roadBuilding: s.pending.roadBuilding,
        },
        specialBuildQueue: s.specialBuild ? s.specialBuild.queue : null,
        turnFlags: s.turnFlags,
        trades: s.trades,
        log,
        me,
    };

    if (me >= 0) {
        const p = s.players[me];
        view.private = {
            hand: p.hand,
            devCards: p.devCards.map((c) => ({ type: c.type, playable: c.turn < s.turn && c.type !== 'victoryPoint' })),
            ratios: game.portRatios(me),
        };
        view.legal = legalFor(game, me);
    }
    if (s.phase === 'finished') {
        view.revealed = s.players.map((p) => p.devCards.filter((c) => c.type === 'victoryPoint').length);
    }
    if (game.citiesKnights) view.ck = ck.view(game, me);
    return view;
}

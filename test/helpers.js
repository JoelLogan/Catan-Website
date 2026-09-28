import assert from 'node:assert/strict';
import { Game } from '../src/engine/game.js';
import { chooseAction, tradeResponse } from '../src/engine/bot.js';
import { viewFor } from '../src/engine/view.js';
import { seededRng } from '../src/engine/rng.js';
import { builtinTemplate } from '../shared/templates.js';
import { handSize } from '../src/engine/hand.js';

export function makePlayers(n) {
    const colors = ['red', 'blue', 'orange', 'white', 'green', 'brown', 'purple', 'teal'];
    return Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Player ${i}`, color: colors[i] }));
}

export function newGame({ players = 4, seed = 1, map = 'standard', settings = {} } = {}) {
    return Game.create({
        players: makePlayers(players),
        settings: { randomizeTurnOrder: false, ...settings },
        template: builtinTemplate(map),
        rng: seededRng(seed),
    });
}

export function idOf(game, idx) {
    return game.state.players[idx].id;
}

/** Total of each card type across bank and all hands must never change. */
export function cardTotals(game) {
    const totals = { ...game.state.bank };
    for (const p of game.state.players) for (const k in p.hand) totals[k] += p.hand[k];
    return totals;
}

export function checkInvariants(game, initialTotals) {
    const s = game.state;
    assert.deepEqual(cardTotals(game), initialTotals, 'cards were created or destroyed');
    for (const p of s.players) for (const k in p.hand) assert.ok(p.hand[k] >= 0, `negative ${k}`);
    for (const k in s.bank) assert.ok(s.bank[k] >= 0, `negative bank ${k}`);
    // Distance rule holds for every building.
    for (const vid in s.buildings) {
        for (const n of game.graph.vertices.get(vid).neighbors) {
            assert.ok(!s.buildings[n], `distance rule broken at ${vid}`);
        }
    }
    // Piece limits hold.
    s.players.forEach((_, i) => {
        const left = game.piecesLeft(i);
        for (const k in left) assert.ok(left[k] >= 0, `piece limit exceeded: ${k}`);
    });
    // Views never leak other players' hands.
    const v = viewFor(game, idOf(game, 0));
    assert.equal(JSON.stringify(v).includes('"devDeck"'), false);
    for (const p of v.players) assert.equal(p.hand, undefined);
}

/**
 * Play a full game with bots. Returns the game.
 * Every few steps a bot makes a domestic trade offer to exercise the trade flow.
 */
export function playOut(game, { maxSteps = 20000, check = true, trades = true } = {}) {
    const initial = cardTotals(game);
    let steps = 0;
    while (game.state.phase !== 'finished' && steps < maxSteps) {
        const w = game.waitingOn();
        assert.ok(w.players.length > 0, `nobody to act in ${w.kind}`);
        const me = w.players[0];
        if (trades && w.kind === 'main' && steps % 7 === 0 && game.state.trades.length === 0) {
            tryTrade(game, me);
        }
        const action = chooseAction(game, me);
        assert.ok(action, `bot had no action for ${w.kind}`);
        try {
            game.act(idOf(game, me), action);
        } catch (err) {
            throw new Error(`step ${steps} ${w.kind} ${JSON.stringify(action)}: ${err.message}`);
        }
        if (check && steps % 25 === 0) checkInvariants(game, initial);
        steps++;
    }
    if (check) checkInvariants(game, initial);
    return { game, steps };
}

function tryTrade(game, me) {
    const s = game.state;
    const hand = s.players[me].hand;
    const have = Object.keys(hand).filter((k) => hand[k] >= 2);
    const want = Object.keys(hand).filter((k) => hand[k] === 0);
    if (!have.length || !want.length) return;
    game.act(idOf(game, me), { type: 'offerTrade', give: { [have[0]]: 1 }, get: { [want[0]]: 1 } });
    const trade = s.trades[s.trades.length - 1];
    s.players.forEach((_, i) => {
        if (i === me) return;
        game.act(idOf(game, i), { type: 'respondTrade', id: trade.id, accept: tradeResponse(game, i, trade) });
    });
    if (trade.accepted.length) {
        game.act(idOf(game, me), { type: 'confirmTrade', id: trade.id, partner: trade.accepted[0] });
    } else {
        game.act(idOf(game, me), { type: 'cancelTrade', id: trade.id });
    }
}

export { handSize };

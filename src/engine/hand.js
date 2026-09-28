// Helpers for "hands": plain objects mapping card type -> non-negative integer count.
import { GameError } from './errors.js';

export function emptyHand(types) {
    return Object.fromEntries(types.map((t) => [t, 0]));
}

export function handSize(hand) {
    let n = 0;
    for (const k in hand) n += hand[k];
    return n;
}

export function hasCards(hand, cost) {
    for (const k in cost) if ((hand[k] || 0) < cost[k]) return false;
    return true;
}

export function addCards(hand, cards, factor = 1) {
    for (const k in cards) hand[k] = (hand[k] || 0) + cards[k] * factor;
}

/** Move cards from one hand to another. Caller must have validated availability. */
export function transfer(from, to, cards) {
    for (const k in cards) {
        if (!cards[k]) continue;
        from[k] -= cards[k];
        to[k] = (to[k] || 0) + cards[k];
    }
}

/**
 * Parse an untrusted hand from a client. Only `allowed` keys with integer
 * counts in [0, max] are accepted; zero entries are dropped.
 */
export function parseHand(input, allowed, max = 99) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new GameError('Invalid card selection');
    }
    const out = {};
    for (const [k, v] of Object.entries(input)) {
        if (!allowed.includes(k)) throw new GameError('Invalid card type');
        if (!Number.isInteger(v) || v < 0 || v > max) throw new GameError('Invalid card amount');
        if (v > 0) out[k] = v;
    }
    return out;
}

/** Expand a hand into a flat list of cards, e.g. {wood:2} -> ['wood','wood']. */
export function handToList(hand) {
    const list = [];
    for (const k in hand) for (let i = 0; i < hand[k]; i++) list.push(k);
    return list;
}

export function listToHand(list) {
    const hand = {};
    for (const k of list) hand[k] = (hand[k] || 0) + 1;
    return hand;
}

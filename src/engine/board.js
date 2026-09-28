// Turns a map template into a concrete, randomized board.
import { RESOURCES } from '../../shared/constants.js';
import { hexKey, neighbor, cornerId } from '../../shared/hex.js';
import { shuffle } from './rng.js';

const TERRAIN_WEIGHTS = [
    ['forest', 4],
    ['pasture', 4],
    ['fields', 4],
    ['hills', 3],
    ['mountains', 3],
];

const BASE_NUMBERS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
// Order in which extra tokens are added once full sets are used up.
const EXTRA_NUMBERS = [5, 9, 4, 10, 6, 8, 3, 11, 2, 12, 5, 9, 4, 10, 3, 11, 6, 8];

/** Terrain pool for `n` randomized land tiles, proportional to the classic mix. */
export function terrainPool(n) {
    const deserts = n >= 10 ? Math.max(1, Math.round(n / 19)) : 0;
    const m = n - deserts;
    const total = TERRAIN_WEIGHTS.reduce((s, [, w]) => s + w, 0);
    const counts = TERRAIN_WEIGHTS.map(([t, w]) => {
        const exact = (m * w) / total;
        return { t, n: Math.floor(exact), rem: exact - Math.floor(exact) };
    });
    let left = m - counts.reduce((s, c) => s + c.n, 0);
    [...counts].sort((a, b) => b.rem - a.rem).forEach((c) => {
        if (left > 0) {
            c.n++;
            left--;
        }
    });
    const pool = [];
    counts.forEach((c) => {
        for (let i = 0; i < c.n; i++) pool.push(c.t);
    });
    for (let i = 0; i < deserts; i++) pool.push('desert');
    return pool;
}

/** Number-token pool for `n` producing tiles. */
export function numberPool(n) {
    const pool = [];
    while (pool.length + BASE_NUMBERS.length <= n) pool.push(...BASE_NUMBERS);
    for (let i = 0; pool.length < n; i++) pool.push(EXTRA_NUMBERS[i % EXTRA_NUMBERS.length]);
    return pool;
}

function portTypePool(n) {
    const generic = Math.round((n * 4) / 9);
    const pool = [];
    for (let i = 0; i < generic; i++) pool.push('3:1');
    for (let i = 0; pool.length < n; i++) pool.push(RESOURCES[i % RESOURCES.length]);
    return pool;
}

const isRed = (n) => n === 6 || n === 8;

/** Count adjacent pairs of tiles that break number-placement guidelines. */
function numberPenalty(hexes, neighborsOf) {
    let penalty = 0;
    hexes.forEach((h, i) => {
        if (!h.number) return;
        for (const j of neighborsOf[i]) {
            if (j <= i) continue;
            const o = hexes[j].number;
            if (!o) continue;
            if (isRed(h.number) && isRed(o)) penalty += 100;
            else if (h.number === o) penalty += 3;
        }
    });
    return penalty;
}

/**
 * Generate a board from a normalized template.
 * @returns {{hexes: Array<{q,r,terrain,number}>, ports: Array<{q,r,side,type,vertices}>, robber: number|null, pirate: number|null}}
 */
export function generateBoard(template, rng) {
    const hexes = template.hexes.map((h) => ({
        q: h.q,
        r: h.r,
        terrain: h.t === 'land' ? null : h.t,
        number: null,
    }));

    // Terrain
    const placeholders = hexes.filter((h) => h.terrain === null);
    const terrains = shuffle(rng, terrainPool(placeholders.length));
    placeholders.forEach((h, i) => {
        h.terrain = terrains[i];
    });

    // Numbers: try several shuffles and keep the one with the fewest adjacency problems.
    const index = new Map(hexes.map((h, i) => [hexKey(h.q, h.r), i]));
    const neighborsOf = hexes.map((h) => {
        const out = [];
        for (let s = 0; s < 6; s++) {
            const [nq, nr] = neighbor(h.q, h.r, s);
            const j = index.get(hexKey(nq, nr));
            if (j !== undefined) out.push(j);
        }
        return out;
    });
    const producing = hexes.filter((h) => h.terrain !== 'sea' && h.terrain !== 'desert');
    const numbers = numberPool(producing.length);
    let best = null;
    let bestPenalty = Infinity;
    for (let attempt = 0; attempt < 300 && bestPenalty > 0; attempt++) {
        const order = shuffle(rng, numbers);
        producing.forEach((h, i) => {
            h.number = order[i];
        });
        const p = numberPenalty(hexes, neighborsOf);
        if (p < bestPenalty) {
            bestPenalty = p;
            best = order;
        }
    }
    producing.forEach((h, i) => {
        h.number = best ? best[i] : null;
    });

    // Ports
    const randomPorts = template.ports.filter((p) => p.type === 'random');
    const portTypes = shuffle(rng, portTypePool(randomPorts.length));
    let pi = 0;
    const ports = template.ports.map((p) => ({
        q: p.q,
        r: p.r,
        side: p.side,
        type: p.type === 'random' ? portTypes[pi++] : p.type,
        vertices: [cornerId(p.q, p.r, p.side), cornerId(p.q, p.r, (p.side + 1) % 6)],
    }));

    // Robber starts on a desert if there is one.
    const deserts = hexes.map((h, i) => (h.terrain === 'desert' ? i : -1)).filter((i) => i >= 0);
    const robber = deserts.length ? deserts[rng.int(deserts.length)] : null;

    return { hexes, ports, robber, pirate: null };
}

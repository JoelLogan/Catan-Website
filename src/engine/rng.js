import { randomInt } from 'node:crypto';

/** Cryptographically secure RNG used for real games. */
export const secureRng = {
    int(n) {
        return randomInt(n);
    },
};

/** Deterministic RNG (mulberry32) for tests and simulations. */
export function seededRng(seed) {
    let a = seed >>> 0;
    return {
        int(n) {
            a = (a + 0x6d2b79f5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            const x = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
            return Math.floor(x * n);
        },
    };
}

export function shuffle(rng, array) {
    const a = [...array];
    for (let i = a.length - 1; i > 0; i--) {
        const j = rng.int(i + 1);
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

export function pick(rng, array) {
    return array[rng.int(array.length)];
}

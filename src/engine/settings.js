import { LIMITS, DEFAULT_PIECES } from '../../shared/constants.js';

export const DEFAULT_SETTINGS = Object.freeze({
    maxPlayers: 4,
    victoryPoints: 10,
    expansions: Object.freeze({ seafarers: false, citiesKnights: false }),
    pieces: DEFAULT_PIECES,
    discardLimit: 7,
    specialBuildPhase: 'auto', // 'auto' (on for 5+ players) | 'on' | 'off'
    randomizeTurnOrder: true,
    islandBonus: 2, // Seafarers: VP for the first settlement on each new island
    map: 'auto',
});

const clampInt = (v, min, max, fallback) => {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (!Number.isInteger(n)) return fallback;
    return Math.min(max, Math.max(min, n));
};

const bool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);

const MAP_ID_RE = /^(auto|standard|large|huge|islands|custom:[a-f0-9]{16})$/;

/**
 * Normalize untrusted settings into a complete, valid settings object.
 * Unknown keys are dropped; out-of-range values are clamped; bad types fall back to defaults.
 */
export function normalizeSettings(raw = {}, base = DEFAULT_SETTINGS) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const exp = src.expansions && typeof src.expansions === 'object' ? src.expansions : {};
    const pcs = src.pieces && typeof src.pieces === 'object' ? src.pieces : {};
    const max = LIMITS.maxPiecesPerType;
    return {
        maxPlayers: clampInt(src.maxPlayers, LIMITS.minPlayers, LIMITS.maxPlayers, base.maxPlayers),
        victoryPoints: clampInt(src.victoryPoints, LIMITS.minVictoryPoints, LIMITS.maxVictoryPoints, base.victoryPoints),
        expansions: {
            seafarers: bool(exp.seafarers, base.expansions.seafarers),
            citiesKnights: bool(exp.citiesKnights, base.expansions.citiesKnights),
        },
        pieces: {
            settlements: clampInt(pcs.settlements, 2, max, base.pieces.settlements),
            cities: clampInt(pcs.cities, 1, max, base.pieces.cities),
            roads: clampInt(pcs.roads, 2, max, base.pieces.roads),
            ships: clampInt(pcs.ships, 0, max, base.pieces.ships),
        },
        discardLimit: clampInt(src.discardLimit, 5, 20, base.discardLimit),
        specialBuildPhase: ['auto', 'on', 'off'].includes(src.specialBuildPhase)
            ? src.specialBuildPhase
            : base.specialBuildPhase,
        randomizeTurnOrder: bool(src.randomizeTurnOrder, base.randomizeTurnOrder),
        islandBonus: clampInt(src.islandBonus, 0, 5, base.islandBonus),
        map: typeof src.map === 'string' && MAP_ID_RE.test(src.map) ? src.map : base.map,
    };
}

/** Bank size per resource, scaled for larger games. */
export function bankSizeFor(playerCount) {
    if (playerCount <= 4) return 19;
    if (playerCount <= 6) return 24;
    return 29;
}

/** Development card deck composition, scaled for larger games. */
export function devDeckFor(playerCount) {
    if (playerCount <= 4) return { knight: 14, victoryPoint: 5, roadBuilding: 2, yearOfPlenty: 2, monopoly: 2 };
    if (playerCount <= 6) return { knight: 20, victoryPoint: 5, roadBuilding: 3, yearOfPlenty: 3, monopoly: 3 };
    return { knight: 26, victoryPoint: 6, roadBuilding: 4, yearOfPlenty: 4, monopoly: 4 };
}

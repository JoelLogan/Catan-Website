// Map templates: validation/normalization and the built-in layouts.
//
// A template describes the *shape* of a map. Land tiles may be fixed terrain or
// "land" placeholders that are randomized when a game starts.
//
// Template format (version 2):
// {
//   version: 2,
//   hexes: [{ q, r, t }]                 t = 'sea' | 'land' | terrain
//   ports: [{ q, r, side, type }]        on a sea hex; side faces a land hex;
//                                        type = '3:1' | resource | 'random'
// }

import { TEMPLATE_TILE_TYPES, PORT_TYPES, LIMITS } from './constants.js';
import { hexKey, neighbor, rowsLayout, surroundingRing, hexToPixel } from './hex.js';

export class TemplateError extends Error {}

const isInt = (n) => Number.isInteger(n);

const LEGACY_TYPE = { water: 'sea', 'land-placeholder': 'land' };

function isLand(t) {
    return t !== 'sea';
}

/** Pick the side of a sea hex that best faces the land around it, or -1 if none. */
export function autoPortSide(hexMap, q, r) {
    let best = -1;
    let bestScore = -1;
    for (let side = 0; side < 6; side++) {
        const [nq, nr] = neighbor(q, r, side);
        const n = hexMap.get(hexKey(nq, nr));
        if (!n || !isLand(n.t)) continue;
        // Prefer sides whose neighbours on either side are also land (a "bay").
        let score = 1;
        for (const adj of [(side + 5) % 6, (side + 1) % 6]) {
            const [aq, ar] = neighbor(q, r, adj);
            const a = hexMap.get(hexKey(aq, ar));
            if (a && isLand(a.t)) score += 1;
        }
        if (score > bestScore) {
            bestScore = score;
            best = side;
        }
    }
    return best;
}

/** Legal port sides for a sea hex (sides that face a land hex). */
export function portSides(hexMap, q, r) {
    const sides = [];
    for (let side = 0; side < 6; side++) {
        const [nq, nr] = neighbor(q, r, side);
        const n = hexMap.get(hexKey(nq, nr));
        if (n && isLand(n.t)) sides.push(side);
    }
    return sides;
}

function convertLegacy(raw) {
    const hexes = [];
    const ports = [];
    for (const tile of raw.tiles) {
        if (!tile || typeof tile !== 'object') throw new TemplateError('Invalid tile');
        const t = LEGACY_TYPE[tile.type] || tile.type;
        hexes.push({ q: tile.x, r: tile.y, t });
        if (tile.port) {
            ports.push({ q: tile.x, r: tile.y, type: tile.port.resource || tile.port.type });
        }
    }
    for (const port of raw.ports || []) {
        if (!port || typeof port !== 'object') throw new TemplateError('Invalid port');
        ports.push({ q: port.tileX, r: port.tileY, type: port.resource || port.type });
    }
    return { version: 2, hexes, ports };
}

/**
 * Validate and normalize untrusted template input. Returns a fresh, clean object.
 * Throws TemplateError with a user-facing message if invalid.
 */
export function normalizeTemplate(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new TemplateError('Map must be an object');
    }
    let input = raw;
    if (!Array.isArray(raw.hexes) && Array.isArray(raw.tiles)) input = convertLegacy(raw);
    if (!Array.isArray(input.hexes)) throw new TemplateError('Map has no tiles');
    if (input.hexes.length > LIMITS.maxTemplateHexes) {
        throw new TemplateError(`Map is too large (max ${LIMITS.maxTemplateHexes} tiles)`);
    }

    const hexMap = new Map();
    for (const h of input.hexes) {
        if (!h || typeof h !== 'object') throw new TemplateError('Invalid tile');
        const { q, r, t } = h;
        if (!isInt(q) || !isInt(r)) throw new TemplateError('Tile coordinates must be integers');
        if (Math.abs(q) > LIMITS.maxTemplateRadius || Math.abs(r) > LIMITS.maxTemplateRadius) {
            throw new TemplateError('Tile is too far from the center');
        }
        if (!TEMPLATE_TILE_TYPES.includes(t)) throw new TemplateError(`Unknown tile type "${String(t).slice(0, 20)}"`);
        const k = hexKey(q, r);
        if (hexMap.has(k)) throw new TemplateError('Two tiles share the same position');
        hexMap.set(k, { q, r, t });
    }

    const landCount = [...hexMap.values()].filter((h) => isLand(h.t)).length;
    if (landCount < 3) throw new TemplateError('Map needs at least 3 land tiles');

    const ports = [];
    const portHexes = new Set();
    for (const p of Array.isArray(input.ports) ? input.ports : []) {
        if (!p || typeof p !== 'object') throw new TemplateError('Invalid harbor');
        const { q, r } = p;
        if (!isInt(q) || !isInt(r)) throw new TemplateError('Harbor coordinates must be integers');
        const hex = hexMap.get(hexKey(q, r));
        if (!hex || hex.t !== 'sea') throw new TemplateError('Harbors must be placed on sea tiles');
        const type = p.type === 'random' || PORT_TYPES.includes(p.type) ? p.type : null;
        if (!type) throw new TemplateError('Unknown harbor type');
        let side = p.side;
        if (side === undefined || side === null) side = autoPortSide(hexMap, q, r);
        if (!isInt(side) || side < 0 || side > 5) throw new TemplateError('Invalid harbor direction');
        const [nq, nr] = neighbor(q, r, side);
        const target = hexMap.get(hexKey(nq, nr));
        if (!target || !isLand(target.t)) throw new TemplateError('Harbors must face a land tile');
        const k = hexKey(q, r);
        if (portHexes.has(k)) throw new TemplateError('Only one harbor per sea tile');
        portHexes.add(k);
        ports.push({ q, r, side, type });
    }

    return { version: 2, hexes: [...hexMap.values()], ports };
}

// ---------------------------------------------------------------------------
// Built-in layouts
// ---------------------------------------------------------------------------

function centroid(hexes) {
    let x = 0;
    let y = 0;
    for (const h of hexes) {
        const p = hexToPixel(h.q, h.r, 1);
        x += p.x;
        y += p.y;
    }
    return { x: x / hexes.length, y: y / hexes.length };
}

/** Place `count` random-type ports evenly around the coastline of the land hexes. */
function placePortsAround(hexMap, land, count) {
    const c = centroid(land);
    const candidates = surroundingRing(land)
        .filter((h) => hexMap.get(hexKey(h.q, h.r))?.t === 'sea')
        .map((h) => {
            const p = hexToPixel(h.q, h.r, 1);
            return { ...h, angle: Math.atan2(p.y - c.y, p.x - c.x) };
        })
        .sort((a, b) => a.angle - b.angle);
    const ports = [];
    if (!candidates.length) return ports;
    const step = candidates.length / count;
    for (let i = 0; i < count && i < candidates.length; i++) {
        const h = candidates[Math.floor(i * step)];
        const side = autoPortSide(hexMap, h.q, h.r);
        if (side >= 0) ports.push({ q: h.q, r: h.r, side, type: 'random' });
    }
    return ports;
}

function framedIsland(rowWidths, portCount) {
    const land = rowsLayout(rowWidths).map((h) => ({ ...h, t: 'land' }));
    const sea = surroundingRing(land).map((h) => ({ ...h, t: 'sea' }));
    const hexMap = new Map([...land, ...sea].map((h) => [hexKey(h.q, h.r), h]));
    const ports = placePortsAround(hexMap, land, portCount);
    return { version: 2, hexes: [...land, ...sea], ports };
}

function islandsMap() {
    // A main island with several outlying islands (for Seafarers).
    const area = rowsLayout([7, 8, 9, 10, 9, 8, 7]);
    const inArea = new Set(area.map((h) => hexKey(h.q, h.r)));
    const hexMap = new Map(area.map((h) => [hexKey(h.q, h.r), { ...h, t: 'sea' }]));
    const set = (q, r, t) => {
        const k = hexKey(q, r);
        if (inArea.has(k)) hexMap.get(k).t = t;
    };
    // Main island: rows of 3,4,5,4,3 on the left side.
    const main = rowsLayout([3, 4, 5, 4, 3]).map((h) => ({ q: h.q - 2, r: h.r }));
    main.forEach((h) => set(h.q, h.r, 'land'));
    // Outlying islands (east).
    const islands = [
        [[3, -3], [4, -3], [3, -2]],
        [[4, -1], [5, -1], [4, 0], [3, 0]],
        [[2, 2], [3, 2], [2, 3]],
        [[5, 1]],
    ];
    islands.flat().forEach(([q, r]) => set(q, r, 'land'));
    set(3, -2, 'gold');
    set(2, 3, 'gold');
    const all = [...hexMap.values()];
    const frame = surroundingRing(all).map((h) => ({ ...h, t: 'sea' }));
    frame.forEach((h) => hexMap.set(hexKey(h.q, h.r), h));
    const mainHexes = main.map((h) => hexMap.get(hexKey(h.q, h.r)));
    const ports = placePortsAround(hexMap, mainHexes, 7);
    return { version: 2, hexes: [...hexMap.values()], ports };
}

const BUILTIN_FACTORIES = {
    standard: () => framedIsland([3, 4, 5, 4, 3], 9),
    large: () => framedIsland([3, 4, 5, 6, 5, 4, 3], 11),
    huge: () => framedIsland([4, 5, 6, 7, 6, 5, 4], 13),
    islands: islandsMap,
};

export const BUILTIN_MAPS = Object.freeze([
    { id: 'standard', name: 'Classic (3–4 players)', players: [2, 4] },
    { id: 'large', name: 'Large (5–6 players)', players: [5, 6] },
    { id: 'huge', name: 'Huge (7–8 players)', players: [7, 8] },
    { id: 'islands', name: 'Islands (Seafarers)', players: [2, 4], seafarers: true },
]);

export function builtinTemplate(id) {
    const factory = BUILTIN_FACTORIES[id];
    if (!factory) return null;
    return normalizeTemplate(factory());
}

/** Default built-in map for a player count. */
export function autoMapId(playerCount) {
    if (playerCount >= 7) return 'huge';
    if (playerCount >= 5) return 'large';
    return 'standard';
}

export function templateStats(template) {
    let land = 0;
    let sea = 0;
    for (const h of template.hexes) {
        if (h.t === 'sea') sea++;
        else land++;
    }
    return { land, sea, ports: template.ports.length };
}


// Decorative, randomly generated island shown behind the home screen.
import { BoardRenderer } from './board.js';
import { builtinTemplate } from '/shared/templates.js';

const TERRAINS = ['forest', 'forest', 'forest', 'forest', 'hills', 'hills', 'hills', 'pasture', 'pasture', 'pasture', 'pasture',
    'fields', 'fields', 'fields', 'fields', 'mountains', 'mountains', 'mountains', 'desert'];
const NUMBERS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

function shuffled(a) {
    const out = [...a];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

export function startHero(canvas) {
    const template = builtinTemplate('standard');
    const terrains = shuffled(TERRAINS);
    const numbers = shuffled(NUMBERS);
    let t = 0;
    let n = 0;
    const hexes = template.hexes.map((hx) => {
        if (hx.t === 'sea') return { q: hx.q, r: hx.r, terrain: 'sea', number: null };
        const terrain = terrains[t++];
        return { q: hx.q, r: hx.r, terrain, number: terrain === 'desert' ? null : numbers[n++] };
    });
    const ports = template.ports.map((p, i) => ({ ...p, type: ['3:1', 'wood', '3:1', 'brick', 'sheep', '3:1', 'wheat', 'ore', '3:1'][i % 9] }));
    const board = new BoardRenderer(canvas);
    board.setData({ hexes, ports, buildings: {}, roads: {}, robber: hexes.findIndex((hx) => hx.terrain === 'desert'), pirate: null, players: [] });
    return board;
}

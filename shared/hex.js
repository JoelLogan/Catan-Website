// Hex-grid geometry shared by server and client.
//
// Hexes are pointy-top and addressed with axial coordinates (q, r).
// Every hex center, corner and edge midpoint lies on an integer "lattice":
//   hex center:  X = 2q + r,  Y = 3r
//   pixel:       px = X * (sqrt(3) / 2) * size,  py = Y * 0.5 * size
// Using integer lattice coordinates gives exact, collision-free ids for
// vertices ("X,Y") and edges ("X1,Y1|X2,Y2"), so no floating-point
// "is this close enough" matching is ever needed.

export const SQRT3 = Math.sqrt(3);

// Corner offsets in lattice units, clockwise starting at the top corner.
// 0:N 1:NE 2:SE 3:S 4:SW 5:NW
export const CORNER_OFFSETS = Object.freeze([
    [0, -2], [1, -1], [1, 1], [0, 2], [-1, 1], [-1, -1],
]);

// Side i runs from corner i to corner i+1 and faces the neighbor in NEIGHBOR_DIRS[i].
// 0:NE 1:E 2:SE 3:SW 4:W 5:NW
export const NEIGHBOR_DIRS = Object.freeze([
    [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1],
]);

export function hexKey(q, r) {
    return `${q},${r}`;
}

export function hexCenterLattice(q, r) {
    return [2 * q + r, 3 * r];
}

export function latticeToPixel(X, Y, size) {
    return { x: X * (SQRT3 / 2) * size, y: Y * 0.5 * size };
}

export function hexToPixel(q, r, size) {
    const [X, Y] = hexCenterLattice(q, r);
    return latticeToPixel(X, Y, size);
}

export function vertexIdFromLattice(X, Y) {
    return `${X},${Y}`;
}

export function parseVertexId(id) {
    const [X, Y] = id.split(',').map(Number);
    return [X, Y];
}

export function cornerLattice(q, r, corner) {
    const [X, Y] = hexCenterLattice(q, r);
    const [dx, dy] = CORNER_OFFSETS[corner];
    return [X + dx, Y + dy];
}

export function cornerId(q, r, corner) {
    const [X, Y] = cornerLattice(q, r, corner);
    return vertexIdFromLattice(X, Y);
}

function compareVertexIds(a, b) {
    const [ax, ay] = parseVertexId(a);
    const [bx, by] = parseVertexId(b);
    return ax - bx || ay - by;
}

export function edgeIdFromVertices(a, b) {
    return compareVertexIds(a, b) <= 0 ? `${a}|${b}` : `${b}|${a}`;
}

export function sideEdgeId(q, r, side) {
    return edgeIdFromVertices(cornerId(q, r, side), cornerId(q, r, (side + 1) % 6));
}

export function edgeVertices(edgeId) {
    return edgeId.split('|');
}

export function neighbor(q, r, side) {
    const [dq, dr] = NEIGHBOR_DIRS[side];
    return [q + dq, r + dr];
}

export function hexDistance(q1, r1, q2, r2) {
    const dq = q1 - q2;
    const dr = r1 - r2;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** Convert a pixel position (relative to the lattice origin) to the axial hex that contains it. */
export function pixelToHex(px, py, size) {
    const q = ((SQRT3 / 3) * px - (1 / 3) * py) / size;
    const r = ((2 / 3) * py) / size;
    return axialRound(q, r);
}

export function axialRound(q, r) {
    const s = -q - r;
    let rq = Math.round(q);
    let rr = Math.round(r);
    const rs = Math.round(s);
    const dq = Math.abs(rq - q);
    const dr = Math.abs(rr - r);
    const ds = Math.abs(rs - s);
    if (dq > dr && dq > ds) rq = -rr - rs;
    else if (dr > ds) rr = -rq - rs;
    return [rq + 0, rr + 0]; // "+ 0" normalizes -0
}

/**
 * Build the vertex/edge graph for a set of hexes.
 * @param {Array<{q:number,r:number,terrain:string}>} hexes
 * @returns {{hexIndex: Map<string, number>, vertices: Map<string, object>, edges: Map<string, object>}}
 *   vertex: { id, X, Y, hexes: number[], edges: string[], neighbors: string[] }
 *   edge:   { id, vertices: [a, b], hexes: number[] }
 */
export function buildGraph(hexes) {
    const hexIndex = new Map();
    const vertices = new Map();
    const edges = new Map();

    hexes.forEach((hex, i) => hexIndex.set(hexKey(hex.q, hex.r), i));

    const getVertex = (id) => {
        let v = vertices.get(id);
        if (!v) {
            const [X, Y] = parseVertexId(id);
            v = { id, X, Y, hexes: [], edges: [], neighbors: [] };
            vertices.set(id, v);
        }
        return v;
    };

    hexes.forEach((hex, i) => {
        for (let c = 0; c < 6; c++) {
            getVertex(cornerId(hex.q, hex.r, c)).hexes.push(i);
        }
        for (let s = 0; s < 6; s++) {
            const a = cornerId(hex.q, hex.r, s);
            const b = cornerId(hex.q, hex.r, (s + 1) % 6);
            const id = edgeIdFromVertices(a, b);
            let e = edges.get(id);
            if (!e) {
                e = { id, vertices: id.split('|'), hexes: [] };
                edges.set(id, e);
                const va = getVertex(a);
                const vb = getVertex(b);
                va.edges.push(id);
                vb.edges.push(id);
                va.neighbors.push(b);
                vb.neighbors.push(a);
            }
            e.hexes.push(i);
        }
    });

    return { hexIndex, vertices, edges };
}

/**
 * Lay out rows of hexes, each row horizontally centered.
 * Rows must alternate in width parity (e.g. 3,4,5,4,3) for a symmetric shape.
 */
export function rowsLayout(widths) {
    const n = widths.length;
    // Pick the starting row so row parity matches width parity: (w - 1) ≡ r (mod 2).
    let rStart = -Math.floor(n / 2);
    if (((widths[0] - 1 - rStart) % 2 + 2) % 2 !== 0) rStart += 1;
    const out = [];
    widths.forEach((w, i) => {
        const r = rStart + i;
        for (let X = -(w - 1); X <= w - 1; X += 2) {
            out.push({ q: (X - r) / 2, r });
        }
    });
    return out;
}

/** All hexes adjacent to the given set but not in it (a one-hex frame). */
export function surroundingRing(hexes) {
    const inSet = new Set(hexes.map((h) => hexKey(h.q, h.r)));
    const ring = new Map();
    for (const h of hexes) {
        for (let s = 0; s < 6; s++) {
            const [nq, nr] = neighbor(h.q, h.r, s);
            const k = hexKey(nq, nr);
            if (!inSet.has(k) && !ring.has(k)) ring.set(k, { q: nq, r: nr });
        }
    }
    return [...ring.values()];
}

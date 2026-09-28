// Longest road / longest trade route computation.
//
// A route is a trail (no edge used twice) through a player's roads and ships.
// It may not pass *through* a vertex holding an opponent's building (or, in
// Cities & Knights, an opponent's knight). Roads and ships only connect at a
// vertex holding one of the player's own buildings.

/**
 * @param {object} p
 * @param {number} p.owner player index
 * @param {Map} p.edges graph edges
 * @param {Map} p.vertices graph vertices
 * @param {object} p.roads edgeId -> {owner, type}
 * @param {(vertexId:string)=>boolean} p.isBlocked vertex blocked for this owner (opponent piece)
 * @param {(vertexId:string)=>boolean} p.hasOwnBuilding
 */
export function longestRoute({ owner, vertices, roads, isBlocked, hasOwnBuilding }) {
    const own = [];
    for (const id in roads) if (roads[id].owner === owner) own.push(id);
    if (!own.length) return 0;

    const ownSet = new Set(own);
    const used = new Set();
    let best = 0;

    const dfs = (vertexId, arrivedType, length) => {
        if (length > best) best = length;
        if (length > 0 && isBlocked(vertexId)) return;
        const v = vertices.get(vertexId);
        for (const edgeId of v.edges) {
            if (!ownSet.has(edgeId) || used.has(edgeId)) continue;
            const type = roads[edgeId].type;
            if (arrivedType && type !== arrivedType && !hasOwnBuilding(vertexId)) continue;
            used.add(edgeId);
            const [a, b] = edgeId.split('|');
            dfs(a === vertexId ? b : a, type, length + 1);
            used.delete(edgeId);
        }
    };

    const starts = new Set();
    for (const id of own) for (const v of id.split('|')) starts.add(v);
    for (const v of starts) dfs(v, null, 0);
    return best;
}

// Canvas board renderer with pan/zoom and precise hit-testing.
//
// World coordinates come straight from the shared hex lattice, so pieces are
// drawn exactly on the vertices/edges the server knows about. Clicks are
// hit-tested only against the current set of legal targets.
import { SQRT3, latticeToPixel, hexToPixel, parseVertexId, edgeVertices, cornerLattice, hexKey, pixelToHex } from '/shared/hex.js';
import { COLOR_HEX, RESOURCE_ICONS } from '/shared/constants.js';

export const SIZE = 50; // hex radius in world units

const TERRAIN_IMAGE = {
    forest: 'wood', hills: 'brick', pasture: 'sheep', fields: 'wheat', mountains: 'ore',
    desert: 'desert', sea: 'water', land: 'land-placeholder', gold: 'gold',
};
export const TERRAIN_COLOR = {
    forest: '#4a7c4e', hills: '#c0643f', pasture: '#9fd48f', fields: '#ecc95c', mountains: '#8f94a3',
    desert: '#e6d3a3', sea: '#6ba8d8', land: '#c8c8c8', gold: '#f2c230',
};

const images = {};
let imagesReady = null;

function loadImages(onLoad) {
    if (imagesReady) return imagesReady;
    imagesReady = Promise.all(Object.entries(TERRAIN_IMAGE).map(([terrain, file]) => new Promise((resolve) => {
        const img = new Image();
        img.onload = () => { images[terrain] = img; onLoad(); resolve(); };
        img.onerror = () => resolve();
        img.src = `/images/tiles/${file}.svg`;
    })));
    return imagesReady;
}

export function vertexPos(id) {
    const [X, Y] = parseVertexId(id);
    return latticeToPixel(X, Y, SIZE);
}

export function edgePos(id) {
    const [a, b] = edgeVertices(id).map(vertexPos);
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, a, b, angle: Math.atan2(b.y - a.y, b.x - a.x) };
}

export function hexPos(hex) {
    return hexToPixel(hex.q, hex.r, SIZE);
}

function hexPath(ctx, cx, cy, r) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 180) * (60 * i - 90);
        const x = cx + r * Math.cos(a);
        const y = cy + r * Math.sin(a);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.closePath();
}

const pips = (n) => 6 - Math.abs(7 - n);

export class BoardRenderer {
    constructor(canvas, { builder = false } = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.builder = builder;
        this.data = { hexes: [], ports: [] };
        this.targets = null; // {vertices:Set, edges:Set, hexes:Set, onPick, preview}
        this.hover = null; // {type, id}
        this.scale = 1;
        this.offset = { x: 0, y: 0 };
        this.userMoved = false;
        this.pointers = new Map();
        this.drag = null;
        this.pending = false;
        this.onPaint = null; // builder: (hexCoords, isDrag) => void
        this.ghostRadius = 0; // builder: show empty grid positions

        loadImages(() => this.requestDraw());
        this.bindEvents();
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(canvas.parentElement);
        this.resize();
    }

    destroy() {
        this.resizeObserver.disconnect();
    }

    // ------------------------------------------------------------ data

    setData(data) {
        const firstBoard = !this.data.hexes.length && data.hexes && data.hexes.length;
        this.data = data;
        if (firstBoard || !this.userMoved) this.fit();
        this.requestDraw();
    }

    setTargets(targets) {
        this.targets = targets;
        this.hover = null;
        this.canvas.classList.toggle('picking', !!targets);
        this.requestDraw();
    }

    clearTargets() {
        this.setTargets(null);
    }

    // ------------------------------------------------------------ view

    resize() {
        const parent = this.canvas.parentElement;
        const w = parent.clientWidth;
        const h = parent.clientHeight;
        if (!w || !h) return;
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = Math.round(w * dpr);
        this.canvas.height = Math.round(h * dpr);
        this.canvas.style.width = `${w}px`;
        this.canvas.style.height = `${h}px`;
        this.dpr = dpr;
        this.cssW = w;
        this.cssH = h;
        if (!this.userMoved) this.fit();
        this.requestDraw();
    }

    bounds() {
        const hexes = this.data.hexes;
        if (!hexes.length) return { minX: -200, maxX: 200, minY: -200, maxY: 200 };
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const h of hexes) {
            const p = hexPos(h);
            minX = Math.min(minX, p.x - SIZE);
            maxX = Math.max(maxX, p.x + SIZE);
            minY = Math.min(minY, p.y - SIZE);
            maxY = Math.max(maxY, p.y + SIZE);
        }
        return { minX, maxX, minY, maxY };
    }

    fit() {
        if (!this.cssW) return;
        const b = this.bounds();
        const pad = 20;
        const s = Math.min((this.cssW - pad * 2) / (b.maxX - b.minX), (this.cssH - pad * 2) / (b.maxY - b.minY));
        this.scale = Math.max(0.2, Math.min(3, s));
        this.offset.x = this.cssW / 2 - ((b.minX + b.maxX) / 2) * this.scale;
        this.offset.y = this.cssH / 2 - ((b.minY + b.maxY) / 2) * this.scale;
        this.requestDraw();
    }

    resetView() {
        this.userMoved = false;
        this.fit();
    }

    zoomBy(factor, cx = this.cssW / 2, cy = this.cssH / 2) {
        const s = Math.max(0.2, Math.min(4, this.scale * factor));
        const wx = (cx - this.offset.x) / this.scale;
        const wy = (cy - this.offset.y) / this.scale;
        this.scale = s;
        this.offset.x = cx - wx * s;
        this.offset.y = cy - wy * s;
        this.userMoved = true;
        this.requestDraw();
    }

    toWorld(sx, sy) {
        return { x: (sx - this.offset.x) / this.scale, y: (sy - this.offset.y) / this.scale };
    }

    // ------------------------------------------------------------ input

    bindEvents() {
        const c = this.canvas;
        c.addEventListener('wheel', (e) => {
            e.preventDefault();
            const r = c.getBoundingClientRect();
            this.zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
        }, { passive: false });

        c.addEventListener('pointerdown', (e) => {
            c.setPointerCapture(e.pointerId);
            const r = c.getBoundingClientRect();
            this.pointers.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top });
            if (this.pointers.size === 1) {
                const p = this.pointers.get(e.pointerId);
                const pan = e.button === 1 || e.button === 2 || (this.builder && this.builderPan);
                this.drag = { start: { ...p }, last: { ...p }, moved: false, pan, painting: this.builder && !pan && e.button === 0 };
                if (this.drag.painting && this.onPaint) this.paintAt(p, false);
            } else if (this.pointers.size === 2) {
                const [a, b] = [...this.pointers.values()];
                this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) };
                this.drag = null;
            }
        });

        c.addEventListener('pointermove', (e) => {
            const r = c.getBoundingClientRect();
            const p = { x: e.clientX - r.left, y: e.clientY - r.top };
            if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);
            if (this.pointers.size === 2 && this.pinch) {
                const [a, b] = [...this.pointers.values()];
                const dist = Math.hypot(a.x - b.x, a.y - b.y);
                this.zoomBy(dist / this.pinch.dist, (a.x + b.x) / 2, (a.y + b.y) / 2);
                this.pinch.dist = dist;
                return;
            }
            if (this.drag) {
                const dx = p.x - this.drag.last.x;
                const dy = p.y - this.drag.last.y;
                if (Math.hypot(p.x - this.drag.start.x, p.y - this.drag.start.y) > 6) this.drag.moved = true;
                if (this.drag.painting) {
                    if (this.drag.moved && this.onPaint) this.paintAt(p, true);
                } else if (this.drag.moved) {
                    this.offset.x += dx;
                    this.offset.y += dy;
                    this.userMoved = true;
                    this.requestDraw();
                }
                this.drag.last = p;
                return;
            }
            this.updateHover(p);
        });

        const end = (e) => {
            const wasDrag = this.drag;
            this.pointers.delete(e.pointerId);
            if (this.pointers.size < 2) this.pinch = null;
            if (this.pointers.size === 0) this.drag = null;
            if (e.type === 'pointerup' && wasDrag && !wasDrag.moved && !wasDrag.pan && !wasDrag.painting) {
                const r = c.getBoundingClientRect();
                this.click({ x: e.clientX - r.left, y: e.clientY - r.top });
            }
        };
        c.addEventListener('pointerup', end);
        c.addEventListener('pointercancel', end);
        c.addEventListener('pointerleave', () => {
            if (this.hover) {
                this.hover = null;
                this.requestDraw();
            }
        });
        c.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    paintAt(p, isDrag) {
        const w = this.toWorld(p.x, p.y);
        const [q, r] = pixelToHex(w.x, w.y, SIZE);
        const key = hexKey(q, r);
        if (isDrag && key === this.lastPainted) return;
        this.lastPainted = key;
        this.onPaint({ q, r }, isDrag);
    }

    hitTest(p) {
        const t = this.targets;
        if (!t) return null;
        const w = this.toWorld(p.x, p.y);
        let best = null;
        let bestD = Infinity;
        const tol = Math.max(SIZE * 0.42, 16 / this.scale);
        const check = (type, id, pos, limit) => {
            const d = Math.hypot(pos.x - w.x, pos.y - w.y);
            if (d < limit && d < bestD) {
                bestD = d;
                best = { type, id };
            }
        };
        if (t.vertices) for (const id of t.vertices) check('vertex', id, vertexPos(id), tol);
        if (t.edges) for (const id of t.edges) check('edge', id, edgePos(id), tol);
        if (t.hexes) {
            for (const i of t.hexes) {
                const h = this.data.hexes[i];
                if (h) check('hex', i, hexPos(h), SIZE * 0.85);
            }
        }
        return best;
    }

    updateHover(p) {
        if (!this.targets) return;
        const hit = this.hitTest(p);
        const same = (hit && this.hover && hit.type === this.hover.type && hit.id === this.hover.id) || (!hit && !this.hover);
        if (!same) {
            this.hover = hit;
            this.requestDraw();
        }
    }

    click(p) {
        const hit = this.hitTest(p);
        if (hit && this.targets && this.targets.onPick) this.targets.onPick(hit.id, hit.type);
    }

    // ------------------------------------------------------------ drawing

    requestDraw() {
        if (this.pending) return;
        this.pending = true;
        requestAnimationFrame(() => {
            this.pending = false;
            this.draw();
        });
    }

    color(ownerIndex) {
        const p = this.data.players && this.data.players[ownerIndex];
        return COLOR_HEX[p?.color] || '#999';
    }

    draw() {
        const ctx = this.ctx;
        const dpr = this.dpr || 1;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.setTransform(dpr * this.scale, 0, 0, dpr * this.scale, dpr * this.offset.x, dpr * this.offset.y);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        const d = this.data;
        if (this.builder) this.drawGhostGrid();
        d.hexes.forEach((h, i) => this.drawHex(h, i));
        (d.ports || []).forEach((p) => this.drawPort(p));
        d.hexes.forEach((h, i) => {
            if (h.number) this.drawNumber(h, i);
        });
        if (d.merchant) this.drawMerchant(d.merchant);
        if (d.robber !== null && d.robber !== undefined && d.hexes[d.robber]) this.drawRobber(d.hexes[d.robber], d.robberActive !== false);
        if (d.pirate !== null && d.pirate !== undefined && d.hexes[d.pirate]) this.drawPirate(d.hexes[d.pirate]);
        for (const [id, r] of Object.entries(d.roads || {})) this.drawRoute(id, r.type, this.color(r.owner));
        for (const [id, k] of Object.entries(d.knights || {})) this.drawKnight(id, k, this.color(k.owner));
        for (const [id, b] of Object.entries(d.buildings || {})) this.drawBuilding(id, b, this.color(b.owner), d.metropolisAt?.[id]);
        this.drawTargets();
    }

    drawGhostGrid() {
        const ctx = this.ctx;
        const R = this.ghostRadius;
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1.2;
        for (let q = -R; q <= R; q++) {
            for (let r = Math.max(-R, -q - R); r <= Math.min(R, -q + R); r++) {
                const p = hexToPixel(q, r, SIZE);
                hexPath(ctx, p.x, p.y, SIZE - 1);
                ctx.stroke();
            }
        }
        ctx.restore();
    }

    drawHex(h, i) {
        const ctx = this.ctx;
        const p = hexPos(h);
        const terrain = h.terrain ?? h.t;
        ctx.save();
        hexPath(ctx, p.x, p.y, SIZE + 0.5);
        ctx.fillStyle = TERRAIN_COLOR[terrain] || '#999';
        ctx.fill();
        const img = images[terrain];
        if (img) {
            ctx.clip();
            const w = (SQRT3 * SIZE) / 0.8;
            const hh = (2 * SIZE) / 0.9;
            ctx.drawImage(img, p.x - w / 2, p.y - hh / 2, w, hh);
        }
        ctx.restore();
        hexPath(ctx, p.x, p.y, SIZE);
        ctx.strokeStyle = terrain === 'sea' ? 'rgba(40,90,140,0.35)' : 'rgba(60,45,30,0.55)';
        ctx.lineWidth = terrain === 'sea' ? 1 : 2;
        ctx.stroke();
        if (this.data.dimHexes && this.data.dimHexes.has(i)) {
            hexPath(ctx, p.x, p.y, SIZE);
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            ctx.fill();
        }
    }

    drawNumber(h, i) {
        const ctx = this.ctx;
        const p = hexPos(h);
        const red = h.number === 6 || h.number === 8;
        const robbed = this.data.robber === i;
        ctx.save();
        ctx.globalAlpha = robbed ? 0.55 : 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, SIZE * 0.3, 0, Math.PI * 2);
        ctx.fillStyle = '#fbf3dc';
        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = 4;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#8b6f47';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = red ? '#c0392b' : '#3b2f22';
        ctx.font = `700 ${SIZE * 0.3}px Nunito, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(h.number), p.x, p.y - SIZE * 0.04);
        const n = pips(h.number);
        for (let k = 0; k < n; k++) {
            ctx.beginPath();
            ctx.arc(p.x + (k - (n - 1) / 2) * 3.4, p.y + SIZE * 0.17, 1.2, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    drawPort(port) {
        const ctx = this.ctx;
        const center = hexToPixel(port.q, port.r, SIZE);
        const [ax, ay] = cornerLattice(port.q, port.r, port.side);
        const [bx, by] = cornerLattice(port.q, port.r, (port.side + 1) % 6);
        const a = latticeToPixel(ax, ay, SIZE);
        const b = latticeToPixel(bx, by, SIZE);
        const label = { x: center.x + ((a.x + b.x) / 2 - center.x) * 0.25, y: center.y + ((a.y + b.y) / 2 - center.y) * 0.25 };
        ctx.save();
        ctx.strokeStyle = '#7a5230';
        ctx.lineWidth = 4;
        for (const v of [a, b]) {
            ctx.beginPath();
            ctx.moveTo(v.x, v.y);
            ctx.lineTo(v.x + (label.x - v.x) * 0.55, v.y + (label.y - v.y) * 0.55);
            ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(label.x, label.y, SIZE * 0.34, 0, Math.PI * 2);
        ctx.fillStyle = '#fff7e0';
        ctx.fill();
        ctx.strokeStyle = '#7a5230';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#3b2f22';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const generic = port.type === '3:1';
        const random = port.type === 'random';
        ctx.font = `700 ${SIZE * 0.2}px Nunito, sans-serif`;
        ctx.fillText(random ? '?' : generic ? '3:1' : '2:1', label.x, label.y + (generic || random ? 0 : SIZE * 0.1));
        if (!generic && !random) {
            ctx.font = `${SIZE * 0.2}px sans-serif`;
            ctx.fillText(RESOURCE_ICONS[port.type] || '', label.x, label.y - SIZE * 0.12);
        }
        ctx.restore();
    }

    drawRoute(id, type, color, alpha = 1) {
        const ctx = this.ctx;
        const e = edgePos(id);
        ctx.save();
        ctx.globalAlpha = alpha;
        if (type === 'ship') {
            ctx.translate(e.x, e.y);
            ctx.rotate(e.angle);
            ctx.beginPath();
            ctx.moveTo(-14, 2);
            ctx.lineTo(14, 2);
            ctx.lineTo(9, 9);
            ctx.lineTo(-9, 9);
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.fill();
            ctx.strokeStyle = '#2b2118';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(0, 2);
            ctx.lineTo(0, -14);
            ctx.lineTo(10, 0);
            ctx.closePath();
            ctx.fillStyle = '#fffaf0';
            ctx.fill();
            ctx.stroke();
        } else {
            const sx = e.a.x + (e.b.x - e.a.x) * 0.18;
            const sy = e.a.y + (e.b.y - e.a.y) * 0.18;
            const ex = e.b.x - (e.b.x - e.a.x) * 0.18;
            const ey = e.b.y - (e.b.y - e.a.y) * 0.18;
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(ex, ey);
            ctx.strokeStyle = '#2b2118';
            ctx.lineWidth = 10;
            ctx.stroke();
            ctx.strokeStyle = color;
            ctx.lineWidth = 7;
            ctx.stroke();
        }
        ctx.restore();
    }

    drawBuilding(id, b, color, metropolis, alpha = 1) {
        const ctx = this.ctx;
        const p = vertexPos(id);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(p.x, p.y);
        ctx.strokeStyle = '#2b2118';
        ctx.lineWidth = 1.8;
        ctx.fillStyle = color;
        if (b.wall) {
            ctx.beginPath();
            ctx.arc(0, 1, 19, 0, Math.PI * 2);
            ctx.fillStyle = '#a89f91';
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = color;
        }
        ctx.beginPath();
        if (b.type === 'city') {
            ctx.moveTo(-14, 11);
            ctx.lineTo(-14, -3);
            ctx.lineTo(-7, -10);
            ctx.lineTo(0, -3);
            ctx.lineTo(0, -1);
            ctx.lineTo(14, -1);
            ctx.lineTo(14, 11);
        } else {
            ctx.moveTo(-9, 9);
            ctx.lineTo(-9, -2);
            ctx.lineTo(0, -11);
            ctx.lineTo(9, -2);
            ctx.lineTo(9, 9);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        if (metropolis) {
            ctx.beginPath();
            ctx.moveTo(-5, -10);
            ctx.lineTo(-5, -20);
            ctx.lineTo(0, -25);
            ctx.lineTo(5, -20);
            ctx.lineTo(5, -10);
            ctx.closePath();
            ctx.fillStyle = { trade: '#e8c547', politics: '#4a7fd4', science: '#4caf50' }[metropolis] || color;
            ctx.fill();
            ctx.stroke();
        }
        ctx.restore();
    }

    drawKnight(id, k, color, alpha = 1) {
        const ctx = this.ctx;
        const p = vertexPos(id);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(p.x, p.y);
        ctx.beginPath();
        ctx.arc(0, 0, 11, 0, Math.PI * 2);
        ctx.fillStyle = k.active ? color : '#f1ece2';
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = k.active ? '#2b2118' : color;
        ctx.stroke();
        ctx.fillStyle = k.active ? '#fff' : '#2b2118';
        ctx.font = `800 11px Nunito, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('I'.repeat(k.level), 0, 0.5);
        ctx.restore();
    }

    drawRobber(hex, active) {
        const ctx = this.ctx;
        const p = hexPos(hex);
        ctx.save();
        ctx.translate(p.x + SIZE * 0.42, p.y - SIZE * 0.05);
        ctx.globalAlpha = active ? 1 : 0.5;
        ctx.fillStyle = '#2d2a32';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, -12, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-8, 12);
        ctx.quadraticCurveTo(-9, -4, 0, -7);
        ctx.quadraticCurveTo(9, -4, 8, 12);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    drawPirate(hex) {
        const ctx = this.ctx;
        const p = hexPos(hex);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.fillStyle = '#1d1b20';
        ctx.beginPath();
        ctx.moveTo(-20, 4);
        ctx.lineTo(20, 4);
        ctx.lineTo(13, 14);
        ctx.lineTo(-13, 14);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(0, 4);
        ctx.lineTo(0, -20);
        ctx.lineTo(15, -3);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('☠', 5, -5);
        ctx.restore();
    }

    drawMerchant(m) {
        const ctx = this.ctx;
        const h = this.data.hexes[m.hex];
        if (!h) return;
        const p = hexPos(h);
        ctx.save();
        ctx.translate(p.x - SIZE * 0.42, p.y - SIZE * 0.05);
        ctx.fillStyle = this.color(m.owner);
        ctx.strokeStyle = '#2b2118';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, -14);
        ctx.lineTo(8, 10);
        ctx.lineTo(-8, 10);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }

    drawTargets() {
        const t = this.targets;
        if (!t) return;
        const ctx = this.ctx;
        const hov = this.hover;
        ctx.save();
        const ring = (x, y, r, on) => {
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fillStyle = on ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.45)';
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = on ? '#2b2118' : 'rgba(43,33,24,0.6)';
            ctx.stroke();
        };
        if (t.hexes) {
            for (const i of t.hexes) {
                const h = this.data.hexes[i];
                if (!h) continue;
                const p = hexPos(h);
                const on = hov && hov.type === 'hex' && hov.id === i;
                hexPath(ctx, p.x, p.y, SIZE - 4);
                ctx.lineWidth = on ? 5 : 3;
                ctx.strokeStyle = on ? '#fff' : 'rgba(255,255,255,0.7)';
                ctx.setLineDash(on ? [] : [8, 6]);
                ctx.stroke();
            }
            ctx.setLineDash([]);
        }
        if (t.edges) {
            for (const id of t.edges) {
                const on = hov && hov.type === 'edge' && hov.id === id;
                if (on && t.preview) continue;
                const e = edgePos(id);
                ring(e.x, e.y, on ? 8 : 5, on);
            }
        }
        if (t.vertices) {
            for (const id of t.vertices) {
                const on = hov && hov.type === 'vertex' && hov.id === id;
                if (on && t.preview) continue;
                const p = vertexPos(id);
                ring(p.x, p.y, on ? 10 : 6.5, on);
            }
        }
        // Ghost preview of the piece under the cursor.
        if (hov && t.preview) {
            const color = t.previewColor || '#fff';
            const kind = t.preview;
            if (kind === 'road' || kind === 'ship') this.drawRoute(hov.id, kind, color, 0.75);
            else if (kind === 'settlement' || kind === 'city') this.drawBuilding(hov.id, { type: kind }, color, null, 0.75);
            else if (kind === 'knight') this.drawKnight(hov.id, { level: t.previewLevel || 1, active: false }, color, 0.75);
        }
        ctx.restore();
    }
}

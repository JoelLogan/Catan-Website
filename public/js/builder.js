// Map builder: paint tiles, place harbors, save/load maps on the server,
// import/export JSON files. Validation uses the same code as the server.
import { h, clear, toast, modal, promptDialog, confirmDialog } from './dom.js';
import * as net from './net.js';
import * as store from './store.js';
import { BoardRenderer, TERRAIN_COLOR } from './board.js';
import { normalizeTemplate, builtinTemplate, autoPortSide, portSides, templateStats, BUILTIN_MAPS } from '/shared/templates.js';
import { hexKey, surroundingRing, hexDistance, neighbor } from '/shared/hex.js';
import { LIMITS, RESOURCES } from '/shared/constants.js';
import { resIcon, resName } from './labels.js';

const TILE_TOOLS = [
    ['sea', '🌊 Sea'],
    ['land', '❓ Random land'],
    ['forest', '🌲 Forest'],
    ['hills', '🧱 Hills'],
    ['pasture', '🐑 Pasture'],
    ['fields', '🌾 Fields'],
    ['mountains', '⛰️ Mountains'],
    ['desert', '🏜️ Desert'],
    ['gold', '✨ Gold'],
];

const DRAFT_KEY = 'builderDraft';

export class MapBuilder {
    constructor(root, { back }) {
        this.root = root;
        this.back = back;
        this.template = null;
        this.tool = { kind: 'tile', t: 'land' };
        this.savedId = null;
        this.name = '';
        this.build();
    }

    build() {
        clear(this.root);
        this.canvas = h('canvas.board.builder', { 'aria-label': 'Map editor' });
        this.statsEl = h('p.builder-stats', { role: 'status' });
        this.nameEl = h('span.builder-name');
        this.toolButtons = [];

        const toolBtn = (label, tool, title = '') => {
            const b = h('button.tool', { type: 'button', title, onclick: () => this.setTool(tool, b) }, label);
            this.toolButtons.push(b);
            return b;
        };
        const tiles = TILE_TOOLS.map(([t, label]) => {
            const b = toolBtn(label, { kind: 'tile', t });
            b.style.borderLeft = `6px solid ${TERRAIN_COLOR[t]}`;
            return b;
        });
        const harbors = [
            toolBtn('⚓ 3:1', { kind: 'port', type: '3:1' }, 'Generic harbor'),
            ...RESOURCES.map((r) => toolBtn(`⚓ 2:1 ${resIcon(r)}`, { kind: 'port', type: r }, `2:1 ${resName(r)} harbor`)),
            toolBtn('⚓ Random', { kind: 'port', type: 'random' }, 'Harbor type chosen at game start'),
        ];
        const eraser = toolBtn('🧽 Erase', { kind: 'erase' });
        const pan = toolBtn('✋ Pan', { kind: 'pan' });

        const builtinSel = h('select', { 'aria-label': 'Start from a built-in map' },
            h('option', { value: '' }, 'Start from…'),
            h('option', { value: 'blank' }, 'Blank'),
            ...BUILTIN_MAPS.map((m) => h('option', { value: m.id }, m.name)));
        builtinSel.addEventListener('change', async () => {
            const v = builtinSel.value;
            builtinSel.value = '';
            if (!v) return;
            if (!(await confirmDialog('Replace map?', 'This replaces the current map.', 'Replace'))) return;
            this.load(v === 'blank' ? { version: 2, hexes: [{ q: 0, r: 0, t: 'land' }], ports: [] } : builtinTemplate(v), null, '');
        });

        const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
        fileInput.addEventListener('change', () => this.importFile(fileInput));

        this.root.append(h('div.builder-layout',
            h('aside.side.builder-tools',
                h('h3', 'Tiles'), h('div.tool-grid', ...tiles),
                h('h3', 'Harbors'), h('p.muted.small', 'Click a sea tile next to land. Click again to turn it.'), h('div.tool-grid', ...harbors),
                h('h3', 'Other'), h('div.tool-grid', eraser, pan),
                h('p.muted.small', 'Drag to paint. Right-drag or use ✋ to pan; scroll or pinch to zoom.')),
            h('div.center',
                h('div.builder-bar',
                    h('button.ghost', { type: 'button', onclick: () => this.back() }, '← Back'),
                    this.nameEl,
                    builtinSel,
                    h('button', { type: 'button', onclick: () => this.addBorder() }, '🌊 Add sea border'),
                    h('button', { type: 'button', onclick: () => this.save(false) }, '💾 Save'),
                    h('button', { type: 'button', onclick: () => this.save(true) }, 'Save as…'),
                    h('button', { type: 'button', onclick: () => this.openSaved() }, '📂 Open'),
                    h('button', { type: 'button', onclick: () => fileInput.click() }, '⬆️ Import'),
                    h('button', { type: 'button', onclick: () => this.exportFile() }, '⬇️ Export'),
                    fileInput),
                this.statsEl,
                h('div.board-wrap', this.canvas,
                    h('div.zoom-controls',
                        h('button.icon-btn', { type: 'button', 'aria-label': 'Zoom in', onclick: () => this.board.zoomBy(1.2) }, '+'),
                        h('button.icon-btn', { type: 'button', 'aria-label': 'Zoom out', onclick: () => this.board.zoomBy(1 / 1.2) }, '−'),
                        h('button.icon-btn', { type: 'button', 'aria-label': 'Reset view', onclick: () => this.board.resetView() }, '⤢')))),
        ));

        this.board = new BoardRenderer(this.canvas, { builder: true });
        this.board.onPaint = (pos, isDrag) => this.paint(pos, isDrag);
        this.setTool(this.tool, this.toolButtons[1]);
    }

    activate() {
        if (this.template) {
            this.board.resize();
            return;
        }
        let draft;
        try {
            draft = JSON.parse(store.getPref(DRAFT_KEY, 'null'));
        } catch {
            draft = null;
        }
        try {
            if (draft && draft.template) {
                this.load(normalizeTemplate(draft.template), draft.savedId || null, draft.name || '');
                return;
            }
        } catch {
            // fall through to the default map
        }
        this.load(builtinTemplate('standard'), null, '');
    }

    setTool(tool, btn) {
        this.tool = tool;
        this.board.builderPan = tool.kind === 'pan';
        for (const b of this.toolButtons) b.classList.toggle('active', b === btn);
    }

    load(template, savedId, name) {
        this.template = { version: 2, hexes: template.hexes.map((x) => ({ ...x })), ports: template.ports.map((p) => ({ ...p })) };
        this.savedId = savedId;
        this.name = name;
        this.board.userMoved = false;
        this.changed();
        this.board.resetView();
    }

    hexMap() {
        return new Map(this.template.hexes.map((x) => [hexKey(x.q, x.r), x]));
    }

    paint({ q, r }, isDrag) {
        const tool = this.tool;
        if (tool.kind === 'pan') return;
        if (Math.abs(q) > LIMITS.maxTemplateRadius || Math.abs(r) > LIMITS.maxTemplateRadius || hexDistance(0, 0, q, r) > LIMITS.maxTemplateRadius) return;
        const map = this.hexMap();
        const k = hexKey(q, r);
        const existing = map.get(k);
        if (tool.kind === 'tile') {
            if (existing) existing.t = tool.t;
            else {
                if (this.template.hexes.length >= LIMITS.maxTemplateHexes) {
                    toast(`Maps can have at most ${LIMITS.maxTemplateHexes} tiles`, 'error');
                    return;
                }
                this.template.hexes.push({ q, r, t: tool.t });
            }
        } else if (tool.kind === 'erase') {
            if (!existing) return;
            this.template.hexes = this.template.hexes.filter((x) => x !== existing);
            this.template.ports = this.template.ports.filter((p) => !(p.q === q && p.r === r));
        } else if (tool.kind === 'port') {
            if (isDrag) return;
            if (!existing || existing.t !== 'sea') {
                toast('Harbors go on sea tiles next to land', 'error');
                return;
            }
            const sides = portSides(map, q, r);
            if (!sides.length) {
                toast('This sea tile does not touch land', 'error');
                return;
            }
            const port = this.template.ports.find((p) => p.q === q && p.r === r);
            if (port && port.type === tool.type) {
                // Rotate to the next side that faces land.
                const i = sides.indexOf(port.side);
                port.side = sides[(i + 1) % sides.length];
            } else if (port) {
                port.type = tool.type;
            } else {
                this.template.ports.push({ q, r, side: autoPortSide(map, q, r), type: tool.type });
            }
        }
        this.fixPorts();
        this.changed();
    }

    /** Drop or re-aim harbors made invalid by tile edits. */
    fixPorts() {
        const map = this.hexMap();
        this.template.ports = this.template.ports.filter((p) => {
            const hx = map.get(hexKey(p.q, p.r));
            if (!hx || hx.t !== 'sea') return false;
            const [nq, nr] = neighbor(p.q, p.r, p.side);
            const target = map.get(hexKey(nq, nr));
            if (target && target.t !== 'sea') return true;
            const side = autoPortSide(map, p.q, p.r);
            if (side < 0) return false;
            p.side = side;
            return true;
        });
    }

    addBorder() {
        const land = this.template.hexes.filter((x) => x.t !== 'sea');
        const map = this.hexMap();
        let added = 0;
        for (const ring of surroundingRing(land)) {
            if (!map.has(hexKey(ring.q, ring.r)) && this.template.hexes.length < LIMITS.maxTemplateHexes) {
                this.template.hexes.push({ q: ring.q, r: ring.r, t: 'sea' });
                added++;
            }
        }
        this.changed();
        toast(added ? `Added ${added} sea tiles` : 'The land is already surrounded by sea');
    }

    validate() {
        try {
            return { template: normalizeTemplate(this.template), error: null };
        } catch (err) {
            return { template: null, error: err.message };
        }
    }

    changed() {
        const maxD = this.template.hexes.reduce((m, x) => Math.max(m, hexDistance(0, 0, x.q, x.r)), 0);
        this.board.ghostRadius = Math.min(LIMITS.maxTemplateRadius, Math.max(4, maxD + 2));
        this.board.setData({ hexes: this.template.hexes, ports: this.template.ports });
        const { error } = this.validate();
        const st = templateStats(this.template);
        this.statsEl.textContent = `${st.land} land · ${st.sea} sea · ${st.ports} harbors${error ? ` — ⚠️ ${error}` : ' — ✓ ready to play'}`;
        this.statsEl.classList.toggle('warn', !!error);
        this.nameEl.textContent = this.name ? `Editing “${this.name}”` : 'Unsaved map';
        store.setPref(DRAFT_KEY, JSON.stringify({ template: this.template, savedId: this.savedId, name: this.name }));
    }

    async save(asNew) {
        const { template, error } = this.validate();
        if (error) {
            toast(error, 'error');
            return;
        }
        const name = await promptDialog(asNew || !this.savedId ? 'Save map' : 'Save changes', 'Map name', this.name, LIMITS.maxMapNameLength);
        if (!name) return;
        try {
            const res = await net.request('maps:save', {
                id: asNew ? undefined : this.savedId || undefined,
                name,
                template,
                clientKey: store.clientKey(),
            });
            this.savedId = res.id;
            this.name = res.name;
            this.changed();
            toast(`Saved “${res.name}”. Hosts can now pick it in the lobby.`);
        } catch (err) {
            toast(err.message, 'error');
        }
    }

    async openSaved() {
        let res;
        try {
            res = await net.request('maps:list', { clientKey: store.clientKey() });
        } catch (err) {
            toast(err.message, 'error');
            return;
        }
        const list = h('ul.map-list');
        const m = modal({ title: 'Saved maps', content: res.maps.length ? list : h('p.muted', 'No saved maps yet.'), wide: true });
        for (const map of res.maps) {
            const row = h('li',
                h('div', h('b', map.name), map.mine ? h('span.tag', 'yours') : null, h('p.muted.small', `${map.land} land · ${map.sea} sea · ${map.ports} harbors`)),
                h('div.row-btns',
                    h('button.small.primary', { type: 'button', onclick: async () => {
                        try {
                            const got = await net.request('maps:get', { id: map.id });
                            this.load(got.template, map.mine ? map.id : null, map.mine ? got.name : `${got.name} (copy)`);
                            m.close();
                        } catch (err) {
                            toast(err.message, 'error');
                        }
                    } }, 'Open'),
                    map.mine ? h('button.small', { type: 'button', onclick: async () => {
                        if (!(await confirmDialog('Delete map?', `Delete “${map.name}” for everyone?`, 'Delete'))) return;
                        try {
                            await net.request('maps:delete', { id: map.id, clientKey: store.clientKey() });
                            row.remove();
                            if (this.savedId === map.id) {
                                this.savedId = null;
                                this.changed();
                            }
                        } catch (err) {
                            toast(err.message, 'error');
                        }
                    } }, 'Delete') : null));
            list.append(row);
        }
    }

    exportFile() {
        const { template, error } = this.validate();
        const data = template || this.template;
        if (error) toast(`Exporting an incomplete map: ${error}`, 'info');
        const blob = new Blob([JSON.stringify({ name: this.name || 'catan-map', ...data }, null, 2)], { type: 'application/json' });
        const a = h('a', { href: URL.createObjectURL(blob), download: `${(this.name || 'catan-map').replace(/[^\w-]+/g, '_')}.json` });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    importFile(input) {
        const file = input.files && input.files[0];
        input.value = '';
        if (!file) return;
        if (file.size > 256 * 1024) {
            toast('That file is too large to be a map', 'error');
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const data = JSON.parse(String(reader.result));
                const template = normalizeTemplate(data);
                const name = typeof data.name === 'string' ? data.name.slice(0, LIMITS.maxMapNameLength) : '';
                this.load(template, null, name);
                toast('Map imported');
            } catch (err) {
                toast(`Could not import: ${err.message}`, 'error');
            }
        };
        reader.readAsText(file);
    }
}

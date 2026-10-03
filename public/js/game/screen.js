// In-game screen: a full-screen board with light overlays (player strip, status
// pill, bottom dock, trays and a slide-out drawer), board-picking modes, required
// dialogs, and the animations that make changes visible.
import { h, clear, toast, closeAllModals, confirmDialog, modal } from '../dom.js';
import { renderChat } from '../chat.js';
import * as net from '../net.js';
import { BoardRenderer } from '../board.js';
import { COLOR_HEX, TERRAIN_RESOURCE } from '/shared/constants.js';
import { helpContent } from '../help.js';
import * as store from '../store.js';
import * as fx from '../fx.js';
import * as panels from './panels.js';
import * as dialogs from './dialogs.js';

const PIECE_LABEL = { settlement: 'settlement', city: 'city', road: 'road', ship: 'ship' };
const DRAWER_TABS = [['log', 'Log'], ['chat', 'Chat'], ['cards', 'Cards'], ['info', 'Info']];

export class GameScreen {
    constructor(root, { leave }) {
        this.root = root;
        this.leave = leave;
        this.view = null;
        this.prevView = null;
        this.mode = null; // active board-picking mode
        this.required = null; // {key, close} of the dialog the game is waiting on
        this.tray = null; // 'build' | 'knights' | null
        this.drawerTab = null;
        this.lastLogId = 0;
        this.lastRollKey = null;
        this.winnerShown = false;
        this.build();
        this.onKey = (e) => {
            if (e.key !== 'Escape' || document.querySelector('.overlay')) return;
            if (this.tray) this.closeTray();
            else if (this.drawerTab) this.closeDrawer();
            else if (this.mode && this.mode.cancellable !== false) this.setMode(null);
        };
        document.addEventListener('keydown', this.onKey);
    }

    destroy() {
        document.removeEventListener('keydown', this.onKey);
        this.resizeObserver.disconnect();
        this.board.destroy();
        closeAllModals();
        clear(this.root);
    }

    build() {
        clear(this.root);
        this.canvas = h('canvas.board', { 'aria-label': 'Game board' });
        this.els = {
            players: h('div.players-strip', { role: 'list', 'aria-label': 'Players' }),
            status: h('div.status-pill', { role: 'status', 'aria-live': 'polite' }),
            ckMini: h('div.ck-mini', { hidden: true }),
            dice: h('button.dice-mini', { type: 'button', hidden: true, title: 'Last roll', onclick: () => this.openDrawer('log') }),
            hand: h('div.hand-dock'),
            actions: h('div.action-bar'),
            tray: h('div.tray', { hidden: true }),
            trades: h('div.offers', { hidden: true }),
            log: h('ol.log-list'),
            chat: h('div.chat'),
            cards: h('div.drawer-cards'),
            info: h('div.drawer-info'),
        };
        this.bankBtn = h('button.hud-btn.bank-btn', { type: 'button', title: 'Bank & info', 'aria-label': 'Bank and game info', onclick: () => this.toggleDrawer('info') }, '🏦');
        this.drawerBtn = h('button.hud-btn', { type: 'button', title: 'Log & chat', 'aria-label': 'Log and chat', onclick: () => this.toggleDrawer('log') }, '💬');
        const menuBtn = h('button.hud-btn', { type: 'button', title: 'Menu', 'aria-label': 'Menu', onclick: () => this.openMenu() }, '☰');

        // Drawer with tabs
        this.drawerBodies = { log: h('div.drawer-body', this.els.log), chat: h('div.drawer-body', this.els.chat), cards: h('div.drawer-body', this.els.cards), info: h('div.drawer-body', this.els.info) };
        this.drawerTabBtns = {};
        const tabs = h('div.drawer-tabs', { role: 'tablist' }, ...DRAWER_TABS.map(([id, label]) => {
            const b = h('button.tab', { type: 'button', role: 'tab', onclick: () => this.openDrawer(id) }, label);
            this.drawerTabBtns[id] = b;
            return b;
        }), h('button.icon-btn.small.drawer-close', { type: 'button', 'aria-label': 'Close panel', onclick: () => this.closeDrawer() }, '✕'));
        this.drawer = h('aside.drawer', { 'aria-label': 'Game panel' }, tabs, ...Object.values(this.drawerBodies));
        this.scrim = h('div.scrim', { onclick: () => { this.closeDrawer(); this.closeTray(); } });

        const zoom = h('div.zoom-controls',
            h('button.hud-btn', { type: 'button', 'aria-label': 'Zoom in', onclick: () => this.board.zoomBy(1.2) }, '+'),
            h('button.hud-btn', { type: 'button', 'aria-label': 'Zoom out', onclick: () => this.board.zoomBy(1 / 1.2) }, '−'),
            h('button.hud-btn', { type: 'button', 'aria-label': 'Fit board', onclick: () => this.board.resetView() }, '⤢'));

        this.hudTop = h('div.hud-top',
            this.els.players,
            h('div.hud-buttons', this.bankBtn, this.drawerBtn, menuBtn));
        this.dock = h('div.dock', this.els.hand, this.els.actions);
        this.root.append(h('div.game',
            h('div.sea'),
            h('div.board-layer', this.canvas),
            this.hudTop,
            h('div.hud-center', this.els.status, this.els.ckMini),
            this.els.trades,
            h('div.hud-side', zoom, this.els.dice),
            this.els.tray,
            this.dock,
            this.scrim,
            this.drawer,
        ));
        this.board = new BoardRenderer(this.canvas);
        // Keep the board centred in the space the overlays leave free.
        this.resizeObserver = new ResizeObserver(() => this.updateInsets());
        for (const el of [this.hudTop, this.dock, this.els.status]) this.resizeObserver.observe(el);
    }

    updateInsets() {
        const top = this.hudTop.offsetHeight + (this.els.status.offsetHeight || 0) + 16;
        this.root.style.setProperty('--top-h', `${this.hudTop.offsetHeight}px`);
        this.root.style.setProperty('--dock-h', `${this.dock.offsetHeight}px`);
        this.board.setInsets({ top, bottom: this.dock.offsetHeight + 8, left: 0, right: window.innerWidth > 700 ? 56 : 0 });
    }

    async confirmLeave() {
        const ok = await confirmDialog('Leave game?', 'A bot will play for you for the rest of this game. You cannot rejoin.', 'Leave');
        if (ok) this.leave();
    }

    openMenu() {
        const theme = document.documentElement.dataset.theme === 'dusk' ? 'dusk' : 'day';
        const m = modal({
            title: 'Menu',
            content: h('div.menu-list',
                h('button', { type: 'button', onclick: () => { m.close(); modal({ title: 'How to play', content: helpContent(), wide: true }); } }, '❓ How to play'),
                h('button', { type: 'button', onclick: () => { toggleTheme(); m.close(); } }, theme === 'dusk' ? '☀️ Day theme' : '🌙 Dusk theme'),
                document.fullscreenEnabled ? h('button', { type: 'button', onclick: () => { toggleFullscreen(); m.close(); } }, document.fullscreenElement ? '🗗 Exit full screen' : '⛶ Full screen') : null,
                h('button', { type: 'button', onclick: () => { m.close(); this.openDrawer('info'); } }, '🏦 Bank, costs & rates'),
                h('button.danger-btn', { type: 'button', onclick: () => { m.close(); this.confirmLeave(); } }, '🚪 Leave game')),
        });
    }

    showPlayer(i) {
        const p = this.game.players[i];
        modal({ title: `${p.name}${i === this.me ? ' (you)' : ''}`, content: panels.playerDetails(this, i) });
    }

    // ------------------------------------------------------------ trays & drawer

    toggleTray(name) {
        this.tray = this.tray === name ? null : name;
        if (this.tray) this.closeDrawer();
        panels.renderActions(this);
        this.scrim.classList.toggle('show', !!this.tray && window.innerWidth < 700);
    }

    closeTray() {
        if (!this.tray) return;
        this.tray = null;
        this.els.tray.hidden = true;
        this.scrim.classList.remove('show');
        if (this.view) panels.renderActions(this);
    }

    openDrawer(tab) {
        this.drawerTab = tab;
        this.closeTray();
        this.drawer.classList.add('open');
        this.scrim.classList.add('show');
        for (const [id, body] of Object.entries(this.drawerBodies)) body.hidden = id !== tab;
        for (const [id, b] of Object.entries(this.drawerTabBtns)) b.classList.toggle('active', id === tab);
        if (tab === 'chat') {
            this.drawerTabBtns.chat.classList.remove('unread');
            this.drawerBtn.classList.remove('unread');
        }
        if (tab === 'log') this.drawerBodies.log.scrollTop = this.drawerBodies.log.scrollHeight;
    }

    toggleDrawer(tab) {
        if (this.drawerTab === tab) this.closeDrawer();
        else this.openDrawer(tab);
    }

    closeDrawer() {
        this.drawerTab = null;
        this.drawer.classList.remove('open');
        this.scrim.classList.remove('show');
    }

    // ------------------------------------------------------------ helpers

    get game() {
        return this.view.game;
    }

    get me() {
        return this.game.me;
    }

    get myTurnWaiting() {
        return this.game.waiting.players.includes(this.me);
    }

    player(i) {
        return this.game.players[i];
    }

    colorOf(i) {
        return COLOR_HEX[this.game.players[i]?.color] || '#999';
    }

    async act(action) {
        try {
            await net.request('game:action', { action });
            return true;
        } catch (err) {
            toast(err.message, 'error');
            return false;
        }
    }

    // ------------------------------------------------------------ modes

    /**
     * Enter a board-picking mode.
     * mode: { label, vertices?, edges?, hexes?, preview?, previewLevel?, onPick(id, type), cancellable? }
     */
    setMode(mode) {
        this.mode = mode;
        if (!mode) {
            this.board.clearTargets();
        } else {
            this.board.setTargets({
                vertices: mode.vertices ? new Set(mode.vertices) : null,
                edges: mode.edges ? new Set(mode.edges) : null,
                hexes: mode.hexes ? new Set(mode.hexes) : null,
                preview: mode.preview,
                previewLevel: mode.previewLevel,
                previewColor: this.colorOf(this.me),
                onPick: (id, type) => mode.onPick(id, type),
            });
        }
        this.renderStatus();
    }

    startBuild(piece) {
        const legal = this.game.legal || {};
        const list = { settlement: legal.settlements, city: legal.cities, road: legal.roads, ship: legal.ships }[piece] || [];
        if (!list.length) {
            toast(`There is nowhere to build a ${PIECE_LABEL[piece]} right now`, 'error');
            return;
        }
        const isVertex = piece === 'settlement' || piece === 'city';
        this.setMode({
            label: `Choose where to build a ${PIECE_LABEL[piece]}`,
            key: `build-${piece}`,
            vertices: isVertex ? list : null,
            edges: isVertex ? null : list,
            preview: piece,
            onPick: async (at) => {
                if (await this.act({ type: 'build', piece, at })) this.setMode(null);
            },
        });
    }

    /** Modes the game forces on us (setup placement, robber, free roads). */
    autoMode() {
        const g = this.game;
        const legal = g.legal || {};
        const w = g.waiting;
        if (!this.myTurnWaiting) return null;
        if (w.kind === 'setup') {
            if (g.setupStep === 'road') {
                return this.routeMode(legal.roads || [], legal.ships || [], 'Place a road next to your new settlement', 'setup');
            }
            return {
                key: `setup-${g.setupStep}-${g.seq}`,
                label: `Place your ${g.setupStep === 'city' ? 'city' : 'settlement'}`,
                vertices: legal.settlements || [],
                preview: g.setupStep,
                cancellable: false,
                onPick: (at) => this.act({ type: 'build', piece: g.setupStep, at }),
            };
        }
        if (w.kind === 'robber') {
            const hexes = [...(legal.robberHexes || []), ...(legal.pirateHexes || [])];
            return {
                key: 'robber',
                label: g.settings.expansions.seafarers ? 'Move the robber (land) or the pirate (sea)' : 'Move the robber',
                hexes,
                cancellable: false,
                onPick: (hex) => {
                    const piece = g.board.hexes[hex].terrain === 'sea' ? 'pirate' : 'robber';
                    this.act({ type: 'moveRobber', hex, piece });
                },
            };
        }
        if (w.kind === 'roadBuilding') {
            return this.routeMode(legal.roads || [], legal.ships || [], `Place a free road (${g.pending.roadBuilding} left)`, 'free', true);
        }
        if (w.kind === 'prompt' && g.ck) {
            const prompt = (g.ck.myPrompts || [])[0];
            if (prompt && prompt.kind === 'displaced') {
                return {
                    key: `displaced-${prompt.id}`,
                    label: 'Your knight was displaced — choose where it goes',
                    vertices: prompt.options,
                    preview: 'knight',
                    previewLevel: prompt.knight.level,
                    cancellable: false,
                    onPick: (vertex) => this.act({ type: 'resolvePrompt', id: prompt.id, vertex }),
                };
            }
            if (prompt && (prompt.kind === 'loseCity' || prompt.kind === 'removeKnight')) {
                const city = prompt.kind === 'loseCity';
                return {
                    key: `${prompt.kind}-${prompt.id}`,
                    label: city ? 'The barbarians won — choose a city to lose' : 'Deserter — choose one of your knights to remove',
                    vertices: prompt.options,
                    cancellable: false,
                    onPick: (vertex) => this.act({ type: 'resolvePrompt', id: prompt.id, vertex }),
                };
            }
            if (prompt && prompt.kind === 'placeDeserter') {
                return {
                    key: `deserter-${prompt.id}`,
                    label: 'Place your new knight (or skip)',
                    vertices: legal.knightSpots || [],
                    preview: 'knight',
                    previewLevel: prompt.level,
                    cancellable: false,
                    extra: h('button.secondary.small', { type: 'button', onclick: () => this.act({ type: 'resolvePrompt', id: prompt.id, vertex: null }) }, 'Skip'),
                    onPick: (vertex) => this.act({ type: 'resolvePrompt', id: prompt.id, vertex }),
                };
            }
        }
        return null;
    }

    routeMode(roads, ships, label, key, skippable = false) {
        const both = new Set(roads.filter((e) => ships.includes(e)));
        return {
            key: `${key}-${this.game.seq}`,
            label,
            edges: [...new Set([...roads, ...ships])],
            preview: roads.length ? 'road' : 'ship',
            cancellable: false,
            extra: skippable ? h('button.secondary.small', { type: 'button', onclick: () => this.act({ type: 'skipRoadBuilding' }) }, 'Skip') : null,
            onPick: async (at) => {
                let piece = roads.includes(at) ? 'road' : 'ship';
                if (both.has(at)) {
                    piece = await dialogs.chooseRoadOrShip();
                    if (!piece) return;
                }
                this.act({ type: 'build', piece, at });
            },
        };
    }

    // ------------------------------------------------------------ update

    update(view) {
        const prev = this.view;
        this.prevView = prev;
        this.view = view;
        const g = view.game;

        const metropolisAt = {};
        if (g.ck) for (const [track, m] of Object.entries(g.ck.metropolis)) if (m) metropolisAt[m.vertex] = track;
        this.board.setData({
            hexes: g.board.hexes,
            ports: g.board.ports,
            buildings: g.buildings,
            roads: g.roads,
            robber: g.robber,
            robberActive: g.ck ? g.ck.robberActive : true,
            pirate: g.pirate,
            players: g.players,
            knights: g.ck ? g.ck.knights : null,
            merchant: g.ck ? g.ck.merchant : null,
            metropolisAt,
        });

        // Interaction mode: modes the game forces (setup, robber, ...) always win; a mode the
        // player chose (e.g. "build a road") survives updates only while it is still their move.
        const auto = this.autoMode();
        if (auto) {
            this.setMode({ ...auto, auto: true });
        } else if (this.mode && (this.mode.auto || !this.stillValid())) {
            this.setMode(null);
        }
        if (this.tray && !this.stillValid()) this.closeTray();

        this.renderStatus();
        panels.renderPlayers(this);
        panels.renderHand(this);
        panels.renderActions(this);
        panels.renderCards(this);
        panels.renderInfo(this);
        panels.renderCkMini(this);
        panels.renderTrades(this);
        this.renderLog();
        this.renderChat(prev);
        this.renderDice(prev);
        if (prev && prev.game) this.animateChanges(prev.game, g);
        this.handleRequiredDialogs();
        this.handleWinner();
        this.updateInsets();
    }

    stillValid() {
        const g = this.game;
        return g.waiting.players.includes(this.me) && ['main', 'specialBuild'].includes(g.waiting.kind);
    }

    renderStatus() {
        if (!this.view) return;
        const el = this.els.status;
        clear(el);
        const g = this.game;
        const w = g.waiting;
        const names = w.players.map((i) => this.player(i)?.name).join(', ');
        let text;
        const mine = this.myTurnWaiting;
        if (this.mode && this.mode.label) {
            text = this.mode.label;
        } else if (g.phase === 'finished') {
            text = `🏆 ${this.player(g.winner).name} wins!`;
        } else {
            const T = {
                setup: mine ? 'Place your starting pieces' : `${names} is placing starting pieces…`,
                preRoll: mine ? 'Your turn — roll the dice' : `Waiting for ${names} to roll…`,
                main: mine ? 'Your turn — build, trade, or end your turn' : `${names}'s turn`,
                specialBuild: mine ? 'Special building phase — you may build' : `Special building phase: ${names}`,
                discard: mine ? 'Choose cards to discard' : `Waiting for ${names} to discard…`,
                gold: mine ? 'Choose your gold field resources' : `Waiting for ${names} to pick gold…`,
                robber: mine ? 'Move the robber' : `${names} is moving the robber…`,
                steal: mine ? 'Choose a player to steal from' : `${names} is stealing…`,
                roadBuilding: mine ? 'Place your free roads' : `${names} is building roads…`,
                prompt: mine ? 'Your decision is needed' : `Waiting for ${names}…`,
            };
            text = T[w.kind] || '';
        }
        const who = w.players.length === 1 ? this.player(w.players[0]) : null;
        el.classList.toggle('mine', mine && g.phase !== 'finished');
        el.style.setProperty('--who', who ? COLOR_HEX[who.color] || '#999' : 'transparent');
        el.append(h('span.status-text', text));
        if (this.mode && this.mode.extra) el.append(this.mode.extra);
        if (this.mode && this.mode.cancellable !== false) {
            el.append(h('button.secondary.small', { type: 'button', onclick: () => this.setMode(null) }, 'Cancel'));
        }
    }

    renderLog() {
        const g = this.game;
        const list = this.els.log;
        const body = this.drawerBodies.log;
        const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 40;
        clear(list);
        for (const e of g.log) list.append(h('li', e.msg));
        if (atBottom || !this.drawerTab) body.scrollTop = body.scrollHeight;
        // Toast messages addressed to me.
        const fresh = g.log.filter((e) => e.id > this.lastLogId);
        if (this.lastLogId > 0) {
            for (const e of fresh.slice(-3)) if (/^You /.test(e.msg) || /from you\.$|gives you/.test(e.msg)) toast(e.msg);
        }
        if (g.log.length) this.lastLogId = g.log[g.log.length - 1].id;
    }

    renderChat(prev) {
        const room = this.view.room;
        renderChat(this.els.chat, room);
        const prevLast = prev?.room.chat.at(-1)?.id || 0;
        const last = room.chat.at(-1);
        if (last && last.id > prevLast && prev && last.from !== room.you && this.drawerTab !== 'chat') {
            this.drawerTabBtns.chat.classList.add('unread');
            this.drawerBtn.classList.add('unread');
            fx.bump(this.drawerBtn, 1.3);
        }
    }

    renderDice(prev) {
        const r = this.game.lastRoll;
        const el = this.els.dice;
        if (!r) {
            el.hidden = true;
            return;
        }
        const key = `${r.turn}-${r.total}-${r.by}`;
        if (key === this.lastRollKey) return;
        const fresh = this.lastRollKey !== null || (prev && prev.game && !prev.game.lastRoll);
        this.lastRollKey = key;
        const tones = r.event ? ['yellow', 'red'] : ['', ''];
        const show = () => {
            clear(el);
            el.hidden = false;
            el.append(fx.diceFace(r.dice[0], tones[0]), fx.diceFace(r.dice[1], tones[1]));
            if (r.event) el.append(h('span.event', { title: `Event: ${r.event}` }, { ship: '⛵', trade: '🟡', politics: '🔵', science: '🟢' }[r.event]));
            el.append(h('span.total', String(r.total)));
        };
        if (!fresh) return show();
        el.hidden = true;
        fx.rollDice(r.dice, tones, el, () => {
            show();
            fx.bump(el, 1.25);
        });
        // Light up the tiles that produce (after the dice land).
        setTimeout(() => {
            if (r.total === 7) {
                fx.splash('7!', { sub: this.game.ck && !this.game.ck.robberActive ? 'Too many cards? Discard half.' : 'The robber strikes', tone: 'red', duration: 1400 });
                return;
            }
            const hexes = this.game.board.hexes.map((hx, i) => (hx.number === r.total && i !== this.game.robber ? i : -1)).filter((i) => i >= 0);
            this.board.flashHexes(hexes);
        }, 900);
    }

    // ------------------------------------------------------------ change animations

    /** Anchor positions used by flying cards. */
    anchorFor(kind, arg) {
        if (kind === 'player') {
            if (arg === this.me && this.handEls) return null;
            return this.chipEls?.[arg]?.avatar || null;
        }
        if (kind === 'hand') return this.handEls?.[arg]?.card || this.hudTop;
        if (kind === 'bank') {
            // On phones the bank button is hidden: use the middle of the board instead.
            if (this.bankBtn.offsetParent !== null) return this.bankBtn;
            const r = this.canvas.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height * 0.42 };
        }
        return null;
    }

    animateChanges(a, b) {
        if (a.me < 0 || b.me < 0 || a.players.length !== b.players.length) return;
        const me = b.me;
        const types = Object.keys(b.private.hand);
        const gains = [];
        const losses = [];
        for (const t of types) {
            const d = (b.private.hand[t] || 0) - (a.private.hand[t] || 0);
            for (let k = 0; k < Math.abs(d); k++) (d > 0 ? gains : losses).push(t);
        }
        const others = b.players.map((p, i) => (i === me ? 0 : p.handCount - a.players[i].handCount));
        const otherLosers = others.map((d, i) => (d < 0 ? i : -1)).filter((i) => i >= 0);
        const otherGainers = others.map((d, i) => (d > 0 ? i : -1)).filter((i) => i >= 0);
        const newRoll = b.lastRoll && (!a.lastRoll || a.lastRoll.turn !== b.lastRoll.turn || a.lastRoll.by !== b.lastRoll.by || a.lastRoll.total !== b.lastRoll.total);
        const rollDelay = newRoll ? 1150 : 0;
        let n = 0;
        const stagger = () => rollDelay + Math.min(n++, 14) * 70;

        // My gains: from an opponent who lost cards, from producing hexes, or from the bank.
        for (const t of gains) {
            let from = otherLosers.length ? this.anchorFor('player', otherLosers[0]) : null;
            if (!from && newRoll && b.lastRoll.total !== 7) from = this.producingHexFor(b, t) || null;
            if (!from) from = this.anchorFor('bank');
            fx.flyCard(t, from, this.anchorFor('hand', t), { delay: stagger() });
        }
        // My losses: to an opponent who gained, otherwise to the bank.
        for (const t of losses) {
            const to = otherGainers.length ? this.anchorFor('player', otherGainers[0]) : this.anchorFor('bank');
            fx.flyCard(t, this.anchorFor('hand', t), to, { delay: stagger() });
        }
        // Everyone else: card backs between their chip and the bank / board.
        if (!gains.length && !losses.length) {
            const paired = otherGainers.length === 1 && otherLosers.length >= 1;
            others.forEach((d, i) => {
                if (!d) return;
                const count = Math.min(Math.abs(d), 6);
                for (let k = 0; k < count; k++) {
                    if (d > 0) {
                        const from = paired ? this.anchorFor('player', otherLosers[0]) : (newRoll && b.lastRoll.total !== 7 ? this.producingHexForPlayer(b, i) : null) || this.anchorFor('bank');
                        fx.flyCard('back', from, this.anchorFor('player', i), { delay: stagger() });
                    } else if (!paired) {
                        fx.flyCard('back', this.anchorFor('player', i), this.anchorFor('bank'), { delay: stagger() });
                    }
                }
            });
        }
        // Development / progress cards bought or drawn.
        b.players.forEach((p, i) => {
            const before = b.ck ? a.ck?.players[i].progressCount : a.players[i].devCount;
            const after = b.ck ? b.ck.players[i].progressCount : p.devCount;
            if (after > before) {
                const to = i === me ? this.cardsBtn : this.anchorFor('player', i);
                for (let k = 0; k < after - before; k++) fx.flyCard(b.ck ? 'progress' : 'dev', this.anchorFor('bank'), to, { delay: stagger() });
            }
        });
        // VP changes float above the chip.
        b.players.forEach((p, i) => {
            const va = i === me ? a.players[i].vp : a.players[i].publicVp;
            const vb = i === me ? p.vp : p.publicVp;
            if (vb !== va && b.phase !== 'setup') fx.floatText(`${vb > va ? '+' : ''}${vb - va} VP`, this.anchorFor('player', i) || this.chipEls?.[i]?.el, { color: vb > va ? '#ffe27a' : '#ff9a8a' });
        });
        // Whose turn
        if (b.phase !== 'finished' && b.current === me && (a.current !== me || a.phase === 'setup') && b.phase === 'preRoll') {
            fx.splash('Your turn!', { sub: 'Roll the dice', tone: 'gold' });
        }
    }

    /** Screen position of a hex that produced resource `t` for me on the latest roll. */
    producingHexFor(g, t) {
        const total = g.lastRoll.total;
        const idx = g.board.hexes.findIndex((hx, i) => hx.number === total && i !== g.robber &&
            (TERRAIN_RESOURCE[hx.terrain] === t || hx.terrain === 'gold' || COMMODITY_TERRAIN[t] === hx.terrain) &&
            Object.entries(g.buildings).some(([v, bld]) => bld.owner === g.me && hexHasCorner(hx, v)));
        return idx >= 0 ? this.board.hexScreen(idx) : null;
    }

    producingHexForPlayer(g, player) {
        const total = g.lastRoll.total;
        const idx = g.board.hexes.findIndex((hx, i) => hx.number === total && i !== g.robber &&
            Object.entries(g.buildings).some(([v, bld]) => bld.owner === player && hexHasCorner(hx, v)));
        return idx >= 0 ? this.board.hexScreen(idx) : null;
    }

    handleRequiredDialogs() {
        const key = dialogs.requiredKey(this);
        if (this.required && this.required.key !== key) {
            this.required.close();
            this.required = null;
        }
        if (key && !this.required) {
            const d = dialogs.openRequired(this, key);
            if (d) this.required = { key, close: d.close };
        }
    }

    handleWinner() {
        if (this.game.phase === 'finished' && !this.winnerShown) {
            this.winnerShown = true;
            this.setMode(null);
            if (this.game.winner === this.me) fx.confetti();
            setTimeout(() => dialogs.winner(this), this.prevView ? 900 : 0);
        }
    }
}

const COMMODITY_TERRAIN = { paper: 'forest', cloth: 'pasture', coin: 'mountains' };

function hexHasCorner(hex, vertexId) {
    const X = 2 * hex.q + hex.r;
    const Y = 3 * hex.r;
    return [[0, -2], [1, -1], [1, 1], [0, 2], [-1, 1], [-1, -1]].some(([dx, dy]) => `${X + dx},${Y + dy}` === vertexId);
}

export function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'dusk' ? 'day' : 'dusk';
    document.documentElement.dataset.theme = next;
    store.setPref('theme', next);
}

function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
}

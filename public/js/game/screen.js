// In-game screen: board, side panels, interaction modes and required dialogs.
import { h, clear, toast, closeAllModals, confirmDialog } from '../dom.js';
import { renderChat } from '../chat.js';
import * as net from '../net.js';
import { BoardRenderer } from '../board.js';
import { COLOR_HEX } from '/shared/constants.js';
import * as panels from './panels.js';
import * as dialogs from './dialogs.js';

const PIECE_LABEL = { settlement: 'settlement', city: 'city', road: 'road', ship: 'ship' };

export class GameScreen {
    constructor(root, { leave }) {
        this.root = root;
        this.leave = leave;
        this.view = null;
        this.mode = null; // active board-picking mode
        this.required = null; // {key, close} of the dialog the game is waiting on
        this.lastLogId = 0;
        this.lastRollKey = null;
        this.winnerShown = false;
        this.build();
        this.onKey = (e) => {
            if (e.key === 'Escape' && this.mode && this.mode.cancellable !== false && !document.querySelector('.overlay')) this.setMode(null);
        };
        document.addEventListener('keydown', this.onKey);
    }

    destroy() {
        document.removeEventListener('keydown', this.onKey);
        this.board.destroy();
        closeAllModals();
        clear(this.root);
    }

    build() {
        clear(this.root);
        this.canvas = h('canvas.board', { 'aria-label': 'Game board' });
        this.els = {
            players: h('div.players-panel'),
            info: h('div.info-panel'),
            ck: h('div.ck-panel'),
            status: h('div.status-banner', { role: 'status', 'aria-live': 'polite' }),
            dice: h('div.dice-tray', { 'aria-live': 'polite' }),
            hand: h('div.hand-panel'),
            actions: h('div.actions-panel'),
            cards: h('div.cards-panel'),
            trades: h('div.trades-panel'),
            log: h('ol.log-list'),
            chat: h('div.chat'),
        };
        const zoom = h('div.zoom-controls',
            h('button.icon-btn', { type: 'button', 'aria-label': 'Zoom in', onclick: () => this.board.zoomBy(1.2) }, '+'),
            h('button.icon-btn', { type: 'button', 'aria-label': 'Zoom out', onclick: () => this.board.zoomBy(1 / 1.2) }, '−'),
            h('button.icon-btn', { type: 'button', 'aria-label': 'Reset view', onclick: () => this.board.resetView() }, '⤢'));

        const tabs = h('div.tabs');
        const logTab = h('div.tab-body', this.els.log);
        const chatTab = h('div.tab-body', { hidden: true }, this.els.chat);
        const tabBtn = (label, body) => h('button.tab', {
            type: 'button',
            onclick: (e) => {
                for (const b of tabs.querySelectorAll('.tab')) b.classList.toggle('active', b === e.currentTarget);
                logTab.hidden = body !== logTab;
                chatTab.hidden = body !== chatTab;
                if (body === chatTab) e.currentTarget.classList.remove('unread');
            },
        }, label);
        this.chatTabBtn = tabBtn('Chat', chatTab);
        const logBtn = tabBtn('Log', logTab);
        logBtn.classList.add('active');
        tabs.append(logBtn, this.chatTabBtn);

        this.root.append(h('div.game-layout',
            h('aside.side.left', this.els.players, this.els.ck, this.els.info,
                h('button.ghost.small.leave-btn', { type: 'button', onclick: () => this.confirmLeave() }, 'Leave game')),
            h('div.center', this.els.status, h('div.board-wrap', this.canvas, zoom, this.els.dice)),
            h('aside.side.right', this.els.hand, this.els.actions, this.els.cards, this.els.trades,
                h('div.panel.log-panel', tabs, logTab, chatTab)),
        ));
        this.board = new BoardRenderer(this.canvas);
    }

    async confirmLeave() {
        const ok = await confirmDialog('Leave game?', 'A bot will play for you for the rest of this game. You cannot rejoin.', 'Leave');
        if (ok) this.leave();
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
        this.view = view;
        const g = view.game;

        // Board data
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

        // Interaction mode: forced modes take priority; user modes are kept if still valid.
        // Interaction mode: modes the game forces (setup, robber, ...) always win; a mode the
        // player chose (e.g. "build a road") survives updates only while it is still their move.
        const auto = this.autoMode();
        if (auto) {
            this.setMode({ ...auto, auto: true });
        } else if (this.mode && (this.mode.auto || !this.stillValid())) {
            this.setMode(null);
        }

        this.renderStatus();
        panels.renderPlayers(this);
        panels.renderInfo(this);
        panels.renderCk(this);
        panels.renderHand(this);
        panels.renderActions(this);
        panels.renderCards(this);
        panels.renderTrades(this);
        this.renderLog();
        this.renderChat(prev);
        this.renderDice();
        this.handleRequiredDialogs();
        this.handleWinner();
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
        el.classList.toggle('mine', mine && g.phase !== 'finished');
        el.append(h('span', text));
        if (this.mode && this.mode.extra) el.append(this.mode.extra);
        if (this.mode && this.mode.cancellable !== false) {
            el.append(h('button.secondary.small', { type: 'button', onclick: () => this.setMode(null) }, 'Cancel'));
        }
    }

    renderLog() {
        const g = this.game;
        const list = this.els.log;
        const atBottom = list.parentElement ? list.parentElement.scrollHeight - list.parentElement.scrollTop - list.parentElement.clientHeight < 40 : true;
        clear(list);
        for (const e of g.log) list.append(h('li', e.msg));
        if (atBottom && list.parentElement) list.parentElement.scrollTop = list.parentElement.scrollHeight;
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
        if (last && last.id > prevLast && prev && last.from !== room.you && this.els.chat.parentElement.hidden) {
            this.chatTabBtn.classList.add('unread');
        }
    }

    renderDice() {
        const r = this.game.lastRoll;
        const el = this.els.dice;
        if (!r) {
            el.hidden = true;
            return;
        }
        const key = `${r.turn}-${r.total}-${r.by}`;
        if (key === this.lastRollKey) return;
        const fresh = this.lastRollKey !== null;
        this.lastRollKey = key;
        clear(el);
        el.hidden = false;
        const faces = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
        el.append(h('span.die', { class: r.event ? 'yellow' : '' }, faces[r.dice[0]]), h('span.die', { class: r.event ? 'red' : '' }, faces[r.dice[1]]));
        if (r.event) {
            const ev = { ship: '⛵', trade: '🟡', politics: '🔵', science: '🟢' }[r.event];
            el.append(h('span.die.event', { title: `Event: ${r.event}` }, ev));
        }
        el.append(h('span.total', String(r.total)));
        if (fresh) {
            el.classList.remove('roll');
            void el.offsetWidth;
            el.classList.add('roll');
        }
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
            dialogs.winner(this);
        }
    }
}

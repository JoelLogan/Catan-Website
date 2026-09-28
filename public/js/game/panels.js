// HUD pieces of the game screen: player strip, hand dock, action bar and trays,
// drawer tabs (cards / info) and floating trade offers.
//
// Elements that animations target (player chips, hand cards, counters) are
// created once and updated in place, so flying cards and "bumps" land on the
// live element instead of one that is about to be replaced.
import { h, clear, toast } from '../dom.js';
import { COSTS, RESOURCES, COMMODITIES, CK, COLOR_HEX } from '/shared/constants.js';
import { DEV_CARDS, PROGRESS, TRACK_LABELS, resChip, resIcon, resName, cardsText, costText } from '../labels.js';
import { bump } from '../fx.js';
import * as dialogs from './dialogs.js';

const canAfford = (hand, cost) => Object.entries(cost).every(([k, n]) => (hand[k] || 0) >= n);

function setText(el, text) {
    const t = String(text);
    if (el.textContent !== t) {
        el.textContent = t;
        return true;
    }
    return false;
}

// ------------------------------------------------------------ player strip

export function renderPlayers(s) {
    const g = s.game;
    const strip = s.els.players;
    const members = new Map(s.view.room.members.map((m) => [m.id, m]));
    if (!s.chipEls || s.chipEls.length !== g.players.length) {
        clear(strip);
        s.chipEls = g.players.map((p, i) => {
            const vp = h('span.chip-vp');
            const cards = h('span.chip-cards');
            const extra = h('span.chip-extra');
            const avatar = h('span.avatar', { style: { background: COLOR_HEX[p.color] || '#999' } }, p.name.slice(0, 1).toUpperCase());
            const el = h('button.chip', { type: 'button', onclick: () => s.showPlayer(i), 'aria-label': `${p.name} details` },
                avatar, h('span.chip-body', h('span.chip-name', p.name), h('span.chip-stats', vp, cards, extra)));
            strip.append(el);
            return { el, vp, cards, extra, avatar };
        });
    }
    g.players.forEach((p, i) => {
        const c = s.chipEls[i];
        const m = members.get(p.id);
        const waiting = g.waiting.players.includes(i);
        const vp = i === g.me || g.phase === 'finished' ? p.vp : p.publicVp;
        c.el.classList.toggle('current', i === g.current && g.phase !== 'finished');
        c.el.classList.toggle('waiting', waiting && g.phase !== 'finished');
        c.el.classList.toggle('me', i === g.me);
        c.el.classList.toggle('offline', !!m && !m.isBot && (!m.connected || m.left));
        c.el.classList.toggle('winner', g.winner === i);
        if (setText(c.vp, `★ ${vp}`) && s.view && s.prevView) bump(c.vp, 1.4);
        const devish = g.ck ? g.ck.players[i].progressCount : p.devCount;
        setText(c.cards, `🂠 ${p.handCount}${devish ? ` · ${g.ck ? '📜' : '🃏'} ${devish}` : ''}`);
        const badges = [];
        if (g.longestRoad === i) badges.push('🛣️');
        if (g.largestArmy === i) badges.push('⚔️');
        if (m?.isBot) badges.push('🤖');
        if (m && !m.isBot && (!m.connected || m.left)) badges.push('💤');
        setText(c.extra, badges.join(''));
        c.el.title = `${p.name}${i === g.me ? ' (you)' : ''} — ${vp} VP, ${p.handCount} cards`;
    });
}

/** Full details for one player (shown in a small modal from the strip). */
export function playerDetails(s, i) {
    const g = s.game;
    const p = g.players[i];
    const ckp = g.ck ? g.ck.players[i] : null;
    const vp = i === g.me || g.phase === 'finished' ? p.vp : p.publicVp;
    const row = (label, value) => h('div.detail-row', h('span.muted', label), h('b', String(value)));
    return h('div.player-details',
        row('Victory points', vp),
        row('Cards in hand', p.handCount),
        g.ck ? row('Progress cards', ckp.progressCount) : row('Development cards', p.devCount),
        g.ck ? row('Active knight strength', ckp.knightStrength) : row('Knights played', p.knightsPlayed),
        row('Longest route', p.routeLength),
        row('Pieces left', `${p.piecesLeft.settlements} 🏠 · ${p.piecesLeft.cities} 🏰 · ${p.piecesLeft.roads} 🛣️${g.settings.expansions.seafarers ? ` · ${p.piecesLeft.ships} ⛵` : ''}`),
        h('div.pc-badges',
            g.longestRoad === i ? h('span.badge', '🛣️ Longest Road') : null,
            g.largestArmy === i ? h('span.badge', '⚔️ Largest Army') : null,
            p.bonusIslands ? h('span.badge', `🏝️ Islands ×${p.bonusIslands}`) : null,
            ckp && ckp.defender ? h('span.badge', `🛡️ Defender ×${ckp.defender}`) : null,
            ckp && ckp.vpCards.length ? h('span.badge', `📜 +${ckp.vpCards.length} VP`) : null,
            g.ck && g.ck.merchant && g.ck.merchant.owner === i ? h('span.badge', '🧺 Merchant') : null,
            ...(g.ck ? Object.entries(g.ck.metropolis).filter(([, mm]) => mm && mm.owner === i).map(([t]) => h('span.badge', `🏰 ${TRACK_LABELS[t].name} metropolis`)) : [])),
        ckp ? h('div.improvements-list', ...CK.tracks.map((t) => h('div.imp-row',
            h('span.imp-name', { style: { color: TRACK_LABELS[t].color } }, `${TRACK_LABELS[t].icon} ${TRACK_LABELS[t].name}`),
            h('span.levels', ...Array.from({ length: CK.maxLevel }, (_, k) => h('span.pip', { class: k < ckp.improvements[t] ? 'on' : '' })))))) : null,
    );
}

// ------------------------------------------------------------ hand dock

export function renderHand(s) {
    const g = s.game;
    const el = s.els.hand;
    if (g.me < 0) {
        el.hidden = true;
        return;
    }
    const hand = g.private.hand;
    const types = g.ck ? [...RESOURCES, ...COMMODITIES] : RESOURCES;
    if (!s.handEls) {
        clear(el);
        s.handEls = {};
        for (const k of types) {
            const n = h('span.card-count');
            const card = h('div.res-card', { class: `res-${k}`, title: resName(k) }, h('span.card-icon', resIcon(k)), h('span.card-label', resName(k)), n);
            el.append(card);
            s.handEls[k] = { card, n };
        }
        s.handTotal = h('div.hand-total');
        el.append(s.handTotal);
    }
    for (const k of types) {
        const { card, n } = s.handEls[k];
        const v = hand[k] || 0;
        setText(n, v);
        card.classList.toggle('empty', v === 0);
    }
    const total = types.reduce((a, k) => a + (hand[k] || 0), 0);
    const limit = g.settings.discardLimit + (g.ck ? 2 * g.ck.players[g.me].walls : 0);
    setText(s.handTotal, `${total}`);
    s.handTotal.classList.toggle('danger', total > limit);
    s.handTotal.title = total > limit ? `Over ${limit}: you will lose half your cards if a 7 is rolled` : `${total} cards (limit ${limit} on a 7)`;
}

// ------------------------------------------------------------ action bar & trays

function trayButton(label, cost, { disabled, title = '', onclick }) {
    return h('button.tray-btn', { type: 'button', disabled, title, onclick },
        h('span.tray-label', label), cost ? h('span.cost', costText(cost)) : null);
}

export function renderActions(s) {
    const g = s.game;
    const el = s.els.actions;
    clear(el);
    if (g.phase === 'finished') {
        el.append(h('button.primary.big', { type: 'button', onclick: () => dialogs.winner(s) }, '🏆 Show results'));
        s.closeTray();
        return;
    }
    if (g.me < 0) return;
    const w = g.waiting;
    const mine = w.players.includes(g.me);
    const hand = g.private.hand;
    const main = mine && w.kind === 'main';
    const special = mine && w.kind === 'specialBuild';

    // Primary contextual button
    let primary = null;
    if (mine && w.kind === 'preRoll') primary = h('button.primary.big.pulse', { type: 'button', onclick: () => s.act({ type: 'rollDice' }) }, '🎲 Roll');
    else if (main) primary = h('button.primary.big', { type: 'button', onclick: () => endTurn(s) }, 'End turn ➜');
    else if (special) primary = h('button.primary.big', { type: 'button', onclick: () => s.act({ type: 'endTurn' }) }, 'Done ➜');

    const setup = g.phase === 'setup';
    const building = main || special;
    const buildCount = buildOptions(s).filter((o) => !o.disabled).length;
    const buildBtn = h('button.bar-btn', {
        type: 'button', disabled: setup, class: s.tray === 'build' ? 'active' : '',
        onclick: () => s.toggleTray('build'),
    }, h('span.bar-icon', '🔨'), h('span.bar-label', 'Build'), building && buildCount ? h('span.badge-dot', String(buildCount)) : null);
    const tradeBtn = h('button.bar-btn', {
        type: 'button', disabled: !(g.phase === 'main' && w.kind === 'main'),
        onclick: () => dialogs.trade(s),
    }, h('span.bar-icon', '🤝'), h('span.bar-label', 'Trade'));
    const cardsCount = g.ck ? g.ck.progress.length : g.private.devCards.length;
    s.cardsBtn = h('button.bar-btn', { type: 'button', onclick: () => s.openDrawer('cards') },
        h('span.bar-icon', g.ck ? '📜' : '🃏'), h('span.bar-label', 'Cards'), cardsCount ? h('span.badge-dot', String(cardsCount)) : null);
    const buttons = [buildBtn];
    if (g.ck) {
        buttons.push(h('button.bar-btn', { type: 'button', disabled: setup, class: s.tray === 'knights' ? 'active' : '', onclick: () => s.toggleTray('knights') },
            h('span.bar-icon', '🛡️'), h('span.bar-label', 'Knights')));
    }
    buttons.push(tradeBtn, s.cardsBtn);
    el.append(h('div.bar-buttons', ...buttons));
    if (primary) el.append(primary);

    renderTray(s, { hand, main, building });
}

function buildOptions(s) {
    const g = s.game;
    if (g.me < 0 || g.phase === 'setup') return [];
    const w = g.waiting;
    const mine = w.players.includes(g.me);
    const main = mine && w.kind === 'main';
    const building = main || (mine && w.kind === 'specialBuild');
    const hand = g.private.hand;
    const legal = g.legal || {};
    const opt = (piece, label, cost, list) => ({
        label, cost, disabled: !building || !canAfford(hand, cost) || !(list && list.length),
        title: building && !(list && list.length) ? 'No legal spot' : !canAfford(hand, cost) ? 'Not enough resources' : '',
        onclick: () => { s.closeTray(); s.startBuild(piece); },
    });
    const out = [
        opt('road', '🛣️ Road', COSTS.road, legal.roads),
        opt('settlement', '🏠 Settlement', COSTS.settlement, legal.settlements),
        opt('city', '🏰 City', COSTS.city, legal.cities),
    ];
    if (g.settings.expansions.seafarers) {
        out.push(opt('ship', '⛵ Ship', COSTS.ship, legal.ships));
        const moves = legal.shipMoves || {};
        out.push({ label: '↪️ Move ship', disabled: !main || !Object.keys(moves).length, onclick: () => { s.closeTray(); shipMoveMode(s, moves); } });
    }
    if (g.ck) {
        out.push({
            label: '🧱 City wall', cost: COSTS.cityWall,
            disabled: !main || !canAfford(hand, COSTS.cityWall) || !legal.wallSpots?.length,
            onclick: () => { s.closeTray(); pickMode(s, 'Choose a city to wall', 'wall', legal.wallSpots, { type: 'buildCityWall' }); },
        });
    } else {
        out.push({
            label: '🃏 Dev card', cost: COSTS.devCard,
            disabled: !building || !canAfford(hand, COSTS.devCard) || g.devDeckCount === 0,
            title: g.devDeckCount === 0 ? 'No development cards left' : '',
            onclick: () => { s.closeTray(); s.act({ type: 'buyDevCard' }); },
        });
    }
    return out;
}

function renderTray(s, { hand, main }) {
    const tray = s.els.tray;
    clear(tray);
    if (!s.tray) {
        tray.hidden = true;
        return;
    }
    tray.hidden = false;
    let options;
    let title;
    if (s.tray === 'build') {
        title = 'Build';
        options = buildOptions(s);
    } else {
        title = 'Knights';
        options = knightOptions(s, main, hand, s.game.legal || {});
    }
    tray.append(h('div.tray-head', h('b', title), h('button.icon-btn.small', { type: 'button', 'aria-label': 'Close', onclick: () => s.closeTray() }, '✕')),
        h('div.tray-grid', ...options.map((o) => trayButton(o.label, o.cost, o))));
}

async function endTurn(s) {
    const g = s.game;
    if (g.ck && g.ck.progress.length > CK.progressHandLimit) {
        toast(`You hold ${g.ck.progress.length} progress cards — play or discard down to ${CK.progressHandLimit} first.`, 'error');
        s.openDrawer('cards');
        return;
    }
    s.setMode(null);
    s.closeTray();
    s.act({ type: 'endTurn' });
}

function pickMode(s, label, key, vertices, action, extra = {}) {
    s.setMode({
        label, key, vertices, ...extra,
        onPick: async (at) => {
            if (await s.act({ ...action, at })) s.setMode(null);
        },
    });
}

function shipMoveMode(s, moves) {
    s.setMode({
        label: 'Choose the ship to move',
        key: 'ship-move-1',
        edges: Object.keys(moves),
        onPick: (from) => s.setMode({
            label: 'Choose where the ship goes',
            key: 'ship-move-2',
            edges: moves[from],
            preview: 'ship',
            onPick: async (to) => {
                if (await s.act({ type: 'moveShip', from, to })) s.setMode(null);
            },
        }),
    });
}

function knightOptions(s, main, hand, legal) {
    const knights = s.game.ck.knights;
    const go = (fn) => () => { s.closeTray(); fn(); };
    return [
        {
            label: '🛡️ Recruit', cost: COSTS.knight,
            disabled: !main || !canAfford(hand, COSTS.knight) || !legal.knightSpots?.length,
            onclick: go(() => pickMode(s, 'Choose where to recruit a knight', 'knight-build', legal.knightSpots, { type: 'buildKnight' }, { preview: 'knight' })),
        },
        {
            label: '🔥 Activate', cost: COSTS.activateKnight,
            disabled: !main || !canAfford(hand, COSTS.activateKnight) || !legal.knightActivate?.length,
            onclick: go(() => pickMode(s, 'Choose a knight to activate', 'knight-activate', legal.knightActivate, { type: 'activateKnight' })),
        },
        {
            label: '⬆️ Promote', cost: COSTS.promoteKnight,
            disabled: !main || !canAfford(hand, COSTS.promoteKnight) || !legal.knightPromote?.length,
            onclick: go(() => pickMode(s, 'Choose a knight to promote', 'knight-promote', legal.knightPromote, { type: 'promoteKnight' })),
        },
        {
            label: '🐎 Move',
            disabled: !main || !Object.keys(legal.knightMoves || {}).length,
            onclick: go(() => s.setMode({
                label: 'Choose a knight to move',
                key: 'knight-move-1',
                vertices: Object.keys(legal.knightMoves),
                onPick: (from) => s.setMode({
                    label: 'Choose where the knight goes (weaker enemy knights are displaced)',
                    key: 'knight-move-2',
                    vertices: legal.knightMoves[from],
                    preview: 'knight',
                    previewLevel: knights[from]?.level,
                    onPick: async (to) => {
                        if (await s.act({ type: 'moveKnight', from, to })) s.setMode(null);
                    },
                }),
            })),
        },
        {
            label: '🏃 Chase robber',
            disabled: !main || !legal.knightChase?.length,
            onclick: go(() => pickMode(s, 'Choose a knight next to the robber', 'knight-chase', legal.knightChase, { type: 'chaseRobber' })),
        },
    ];
}

// ------------------------------------------------------------ drawer: cards

export function renderCards(s) {
    const g = s.game;
    const el = s.els.cards;
    clear(el);
    if (g.me < 0) return;
    const w = g.waiting;
    const mine = w.players.includes(g.me) && ['preRoll', 'main'].includes(w.kind) && g.current === g.me;

    if (g.ck) {
        const cards = g.ck.progress;
        const list = h('ul.card-list');
        for (const c of cards) {
            const [name, text] = PROGRESS[c.type] || [c.type, ''];
            const allowed = mine && (c.type === 'alchemist' ? w.kind === 'preRoll' : w.kind === 'main');
            list.append(h('li.dev-card', { class: `track-${c.track}` },
                h('div', h('b', name), h('p.muted', text)),
                h('div.card-btns',
                    h('button.small.primary', { type: 'button', disabled: !allowed, onclick: () => { s.closeDrawer(); dialogs.playProgress(s, c); } }, 'Play'),
                    h('button.small.ghost', { type: 'button', onclick: () => s.act({ type: 'discardProgress', card: c.id }), title: 'Discard this card' }, '🗑'))));
        }
        el.append(h('h3', `Progress cards (${cards.length}/${CK.progressHandLimit})`),
            cards.length ? list : h('p.muted', 'Improve your cities to draw progress cards when the event die shows a gate.'));
        return;
    }

    const cards = g.private.devCards;
    const groups = new Map();
    for (const c of cards) {
        const k = `${c.type}:${c.playable}`;
        groups.set(k, { ...c, n: (groups.get(k)?.n || 0) + 1 });
    }
    const list = h('ul.card-list');
    for (const c of groups.values()) {
        const info = DEV_CARDS[c.type];
        const can = mine && c.playable && !g.turnFlags.devPlayed;
        list.append(h('li.dev-card',
            h('div', h('b', `${info.icon} ${info.name}${c.n > 1 ? ` ×${c.n}` : ''}`), h('p.muted', info.text)),
            c.type === 'victoryPoint' ? h('span.tag', 'hidden +1 VP') : h('button.small.primary', {
                type: 'button',
                disabled: !can,
                title: !c.playable ? 'Cards cannot be played on the turn they are bought' : g.turnFlags.devPlayed ? 'One development card per turn' : '',
                onclick: () => { s.closeDrawer(); dialogs.playDev(s, c.type); },
            }, c.playable ? 'Play' : 'New')));
    }
    el.append(h('h3', 'Development cards'), cards.length ? list : h('p.muted', 'None yet. Buy one from the Build menu.'));
}

// ------------------------------------------------------------ drawer: info

export function renderInfo(s) {
    const g = s.game;
    const el = s.els.info;
    clear(el);
    el.append(...[
        h('h3', 'Bank'),
        h('div.bank', ...Object.entries(g.bank).map(([k, n]) => resChip(k, n))),
        !g.ck ? h('p.muted', `Development cards left: ${g.devDeckCount}`) : null,
        h('p.muted', `${g.phase === 'setup' ? 'Setup' : `Turn ${g.turn}`} · first to ${g.settings.victoryPoints} VP${s.view.room.mapName ? ` · map: ${s.view.room.mapName}` : ''}`),
        g.me >= 0 ? h('h3', 'Your trade rates') : null,
        g.me >= 0 ? h('div.bank', ...Object.entries(g.private.ratios).map(([k, r]) => h('span.res-chip', { title: resName(k) }, `${resIcon(k)} ${r}:1`))) : null,
        h('h3', 'Building costs'),
        h('table.costs', h('tbody',
            ...[['🛣️ Road', COSTS.road], ['🏠 Settlement', COSTS.settlement], ['🏰 City', COSTS.city],
                ...(g.settings.expansions.seafarers ? [['⛵ Ship', COSTS.ship]] : []),
                ...(g.ck ? [['🛡️ Knight', COSTS.knight], ['🔥 Activate', COSTS.activateKnight], ['🧱 Wall', COSTS.cityWall]] : [['🃏 Dev card', COSTS.devCard]]),
            ].map(([n, c]) => h('tr', h('td', n), h('td', costText(c)))))),
    ].filter(Boolean));
    if (g.ck) renderCkInfo(s, el);
}

function renderCkInfo(s, el) {
    const g = s.game;
    const ck = g.ck;
    el.append(h('h3', 'Barbarians'), barbarianTrack(ck),
        h('p', { class: ck.strength > ck.defense ? 'danger' : 'safe' }, `Barbarian strength ${ck.strength} vs. knights ${ck.defense}`),
        h('p.muted', ck.robberActive ? `Attacks so far: ${ck.attacks}` : 'The robber stays put until the first attack.'));
    if (g.me < 0) return;
    const mine = ck.players[g.me];
    const hand = g.private.hand;
    const myMain = g.waiting.kind === 'main' && g.waiting.players.includes(g.me);
    const hasCity = Object.values(g.buildings).some((b) => b.owner === g.me && b.type === 'city');
    const list = h('div.improvements-list');
    for (const t of CK.tracks) {
        const level = mine.improvements[t];
        const com = CK.trackCommodity[t];
        const cost = Math.max(0, level + 1 - (ck.turn.crane && myMain ? 1 : 0));
        const can = myMain && hasCity && level < CK.maxLevel && hand[com] >= cost;
        list.append(h('div.imp-row',
            h('span.imp-name', { style: { color: TRACK_LABELS[t].color } }, `${TRACK_LABELS[t].icon} ${TRACK_LABELS[t].name}`),
            h('span.levels', ...Array.from({ length: CK.maxLevel }, (_, k) => h('span.pip', { class: k < level ? 'on' : '' }))),
            level < CK.maxLevel
                ? h('button.small', { type: 'button', disabled: !can, title: level + 1 === 3 ? TRACK_LABELS[t].ability : '', onclick: () => s.act({ type: 'improveCity', track: t }) }, `${cost} ${resIcon(com)}`)
                : h('span.tag', 'max')));
    }
    el.append(h('h3', 'Your city improvements'), list);
}

function barbarianTrack(ck) {
    const track = h('div.barbarian-track', { 'aria-label': `Barbarians at ${ck.barbarian} of ${ck.trackLength}` });
    for (let i = 0; i <= ck.trackLength; i++) {
        track.append(h('span.step', { class: i === ck.barbarian ? 'ship' : i === ck.trackLength ? 'land' : '' }, i === ck.barbarian ? '⛵' : i === ck.trackLength ? '🏰' : ''));
    }
    return track;
}

/** Compact barbarian indicator in the HUD (Cities & Knights). */
export function renderCkMini(s) {
    const g = s.game;
    const el = s.els.ckMini;
    if (!g.ck) {
        el.hidden = true;
        return;
    }
    el.hidden = false;
    clear(el);
    const ck = g.ck;
    const danger = ck.strength > ck.defense;
    el.classList.toggle('danger', danger);
    el.title = `Barbarians ${ck.barbarian}/${ck.trackLength} — strength ${ck.strength} vs. knights ${ck.defense}`;
    el.append(h('span', '⛵'), h('span.mini-track', ...Array.from({ length: ck.trackLength }, (_, i) => h('span.mini-step', { class: i < ck.barbarian ? 'on' : '' }))),
        h('span.mini-vs', `${ck.strength}⚔${ck.defense}`));
}

// ------------------------------------------------------------ trade offers

export function renderTrades(s) {
    const g = s.game;
    const el = s.els.trades;
    clear(el);
    if (!g.trades.length) {
        el.hidden = true;
        return;
    }
    el.hidden = false;
    for (const t of g.trades) {
        const from = s.player(t.from);
        const to = t.to === null ? 'anyone' : s.player(t.to).name;
        const mineOffer = t.from === g.me;
        const eligible = !mineOffer && (t.to === null || t.to === g.me) && (t.from === g.current || g.me === g.current);
        const responded = t.accepted.includes(g.me) ? 'accepted' : t.rejected.includes(g.me) ? 'declined' : null;
        const hand = g.private?.hand || {};
        const canPay = canAfford(hand, t.get);
        const card = h('div.offer', { style: { borderLeftColor: COLOR_HEX[from.color] || '#999' } },
            h('div.offer-text', h('b', from.name), ` offers ${cardsText(t.give)} for ${cardsText(t.get)} `, h('span.muted', `(to ${to})`)));
        const btns = h('div.trade-btns');
        if (eligible) {
            btns.append(
                h('button.small.primary', { type: 'button', disabled: !canPay || responded === 'accepted', title: canPay ? '' : 'You do not have the cards', onclick: () => s.act({ type: 'respondTrade', id: t.id, accept: true }) }, responded === 'accepted' ? 'Accepted ✓' : 'Accept'),
                h('button.small', { type: 'button', disabled: responded === 'declined', onclick: () => s.act({ type: 'respondTrade', id: t.id, accept: false }) }, 'Decline'));
            if (g.me !== g.current) btns.append(h('button.small.ghost', { type: 'button', onclick: () => dialogs.trade(s, { give: t.get, get: t.give }) }, 'Counter'));
        }
        if (mineOffer) {
            for (const p of t.accepted) {
                btns.append(h('button.small.primary', { type: 'button', onclick: () => s.act({ type: 'confirmTrade', id: t.id, partner: p }) }, `Trade with ${s.player(p).name}`));
            }
            btns.append(h('button.small', { type: 'button', onclick: () => s.act({ type: 'cancelTrade', id: t.id }) }, 'Cancel'));
        }
        const status = [];
        if (t.accepted.length) status.push(`accepted by ${t.accepted.map((p) => s.player(p).name).join(', ')}`);
        if (t.rejected.length) status.push(`declined by ${t.rejected.map((p) => s.player(p).name).join(', ')}`);
        card.append(btns, status.length ? h('p.muted.small', status.join(' · ')) : null);
        el.append(card);
    }
}

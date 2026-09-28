// Dialogs used during a game.
import { h, modal, stepper, toast } from '../dom.js';
import * as net from '../net.js';
import { RESOURCES, COMMODITIES } from '/shared/constants.js';
import { PROGRESS, TRACK_LABELS, resIcon, resName, swatch } from '../labels.js';

const BOARD_PROMPTS = new Set(['displaced', 'placeDeserter', 'loseCity', 'removeKnight']);

// ------------------------------------------------------------ building blocks

/**
 * A card picker made of steppers.
 * @param {object} o
 * @param {string[]} o.types card types to show
 * @param {object} o.max per-type maximum (e.g. the player's hand or the bank)
 * @param {number} [o.total] exact number required (or null for free choice)
 * @param {object} [o.initial]
 */
function cardPicker({ types, max, total = null, initial = {}, onchange }) {
    const values = {};
    const counter = h('span.picker-total');
    const refresh = () => {
        const sum = Object.values(values).reduce((a, b) => a + b, 0);
        counter.textContent = total === null ? `${sum} selected` : `${sum} / ${total} selected`;
        counter.classList.toggle('ok', total === null ? sum > 0 : sum === total);
        if (onchange) onchange(sum);
    };
    const rows = types.map((t) => {
        values[t] = Math.min(initial[t] || 0, max[t] ?? 99);
        const st = stepper({ value: values[t], min: 0, max: max[t] ?? 99, onchange: (v) => { values[t] = v; refresh(); } });
        return h('div.picker-row', h('span.picker-label', `${resIcon(t)} ${resName(t)}`), max[t] !== undefined && max[t] < 99 ? h('small.muted', `(${max[t]})`) : null, st.el);
    });
    refresh();
    return {
        el: h('div.picker', ...rows, counter),
        value: () => Object.fromEntries(Object.entries(values).filter(([, v]) => v > 0)),
        sum: () => Object.values(values).reduce((a, b) => a + b, 0),
    };
}

function choiceButtons(options, onPick) {
    return h('div.choice-grid', ...options.map((o) => h('button', { type: 'button', disabled: o.disabled, onclick: () => onPick(o.value) }, o.label)));
}

function exactCardsDialog(s, { title, text, types, max, total, action, dismissable = false }) {
    const ok = h('button.primary', { type: 'button', disabled: true, onclick: async () => {
        if (await s.act(action(picker.value()))) m.close();
    } }, 'Confirm');
    const picker = cardPicker({ types, max, total, onchange: (sum) => { ok.disabled = sum !== total; } });
    const m = modal({ title, content: [text ? h('p', text) : null, picker.el], actions: [ok], dismissable });
    return m;
}

function resourceChoice(s, { title, text, types, disabledTypes = [], action, dismissable = true }) {
    const m = modal({
        title,
        content: [text ? h('p', text) : null, choiceButtons(types.map((t) => ({ value: t, label: `${resIcon(t)} ${resName(t)}`, disabled: disabledTypes.includes(t) })), async (t) => {
            if (await s.act(action(t))) m.close();
        })],
        dismissable,
    });
    return m;
}

function playerChoice(s, { title, text, players, action }) {
    const g = s.game;
    const m = modal({
        title,
        content: [text ? h('p', text) : null, players.length
            ? h('div.choice-grid', ...players.map((i) => h('button', { type: 'button', onclick: async () => { if (await s.act(action(i))) m.close(); } },
                swatch(g.players[i].color), ` ${g.players[i].name} (${g.players[i].handCount} cards)`)))
            : h('p.muted', 'No eligible players.')],
    });
    return m;
}

export function chooseRoadOrShip() {
    return new Promise((resolve) => {
        let done = false;
        const pick = (v) => { done = true; m.close(); resolve(v); };
        const m = modal({
            title: 'Road or ship?',
            content: choiceButtons([{ value: 'road', label: '🛣️ Road' }, { value: 'ship', label: '⛵ Ship' }], pick),
            onClose: () => { if (!done) resolve(null); },
        });
    });
}

// ------------------------------------------------------------ required dialogs

export function requiredKey(s) {
    const g = s.game;
    if (g.me < 0 || g.phase === 'finished') return null;
    const w = g.waiting;
    if (!w.players.includes(g.me)) return null;
    if (w.kind === 'discard') return `discard-${g.turn}-${g.pending.discard[g.me]}`;
    if (w.kind === 'gold') return `gold-${g.turn}-${g.pending.gold[g.me]}`;
    if (w.kind === 'steal') return `steal-${g.turn}`;
    if (w.kind === 'prompt' && g.ck) {
        const p = (g.ck.myPrompts || [])[0];
        if (p && !BOARD_PROMPTS.has(p.kind)) return `prompt-${p.id}`;
    }
    return null;
}

export function openRequired(s, key) {
    const g = s.game;
    const me = g.me;
    const hand = g.private.hand;
    const types = g.ck ? [...RESOURCES, ...COMMODITIES] : RESOURCES;
    if (key.startsWith('discard-')) {
        const n = g.pending.discard[me];
        return exactCardsDialog(s, {
            title: 'Discard cards',
            text: `A 7 was rolled and you hold too many cards. Choose ${n} to return to the bank.`,
            types: types.filter((t) => hand[t] > 0),
            max: hand,
            total: n,
            action: (cards) => ({ type: 'discard', cards }),
        });
    }
    if (key.startsWith('gold-')) {
        const n = g.pending.gold[me];
        return exactCardsDialog(s, {
            title: 'Gold field',
            text: `Choose ${n} resource${n > 1 ? 's' : ''} from the bank.`,
            types: RESOURCES,
            max: g.bank,
            total: n,
            action: (cards) => ({ type: 'chooseGold', cards }),
        });
    }
    if (key.startsWith('steal-')) {
        const m = modal({
            title: 'Steal a card',
            content: [h('p', 'Choose a player to steal a random card from.'), h('div.choice-grid', ...g.pending.steal.map((i) => h('button', {
                type: 'button',
                onclick: () => s.act({ type: 'steal', victim: i }),
            }, swatch(g.players[i].color), ` ${g.players[i].name} (${g.players[i].handCount} cards)`)))],
            dismissable: false,
        });
        return m;
    }
    if (key.startsWith('prompt-')) return openPrompt(s, g.ck.myPrompts[0]);
    return null;
}

function openPrompt(s, p) {
    const g = s.game;
    const hand = g.private.hand;
    const resolve = (extra) => ({ type: 'resolvePrompt', id: p.id, ...extra });
    const types = [...RESOURCES, ...COMMODITIES];
    switch (p.kind) {
        case 'defenderDraw':
            return resourceChoiceLike(s, 'Defender of Catan', 'You tied for the strongest defense! Choose a progress card deck to draw from.',
                ['trade', 'politics', 'science'].map((t) => ({ value: t, label: `${TRACK_LABELS[t].icon} ${TRACK_LABELS[t].name}` })), (track) => resolve({ track }));
        case 'aqueduct':
            return resourceChoice(s, {
                title: 'Aqueduct', text: 'You produced nothing this roll. Take any 1 resource.', types: RESOURCES,
                disabledTypes: RESOURCES.filter((r) => !g.bank[r]), action: (resource) => resolve({ resource }), dismissable: false,
            });
        case 'progressDiscard':
            return resourceChoiceLike(s, 'Too many progress cards', 'You may hold at most 4 progress cards. Choose one to discard.',
                g.ck.progress.map((c) => ({ value: c.id, label: PROGRESS[c.type][0] })), (card) => resolve({ card }));
        case 'giveCards':
            return exactCardsDialog(s, {
                title: 'Wedding', text: `Give ${p.count} card${p.count > 1 ? 's' : ''} of your choice to ${g.players[p.to].name}.`,
                types: types.filter((t) => hand[t] > 0), max: hand, total: p.count, action: (cards) => resolve({ cards }),
            });
        case 'harborReply': {
            const have = COMMODITIES.filter((c) => hand[c] > 0);
            if (!have.length) return resourceChoiceLike(s, 'Commercial Harbor', 'You have no commodities.', [{ value: null, label: 'OK' }], () => resolve({ commodity: null }));
            return resourceChoice(s, {
                title: 'Commercial Harbor',
                text: `${g.players[p.to].name} gives you 1 ${resName(p.resource)}. Choose a commodity to give in return.`,
                types: have, action: (commodity) => resolve({ commodity }), dismissable: false,
            });
        }
        case 'takeCards':
            return exactCardsDialog(s, {
                title: 'Master Merchant', text: `Take ${p.count} cards from ${g.players[p.from].name}'s hand.`,
                types: types.filter((t) => p.hand[t] > 0), max: p.hand, total: p.count, action: (cards) => resolve({ cards }),
            });
        case 'spyPick':
            return resourceChoiceLike(s, 'Spy', `${g.players[p.from].name}'s progress cards — take one.`,
                [...p.cards.map((c) => ({ value: c.id, label: PROGRESS[c.type][0] })), { value: null, label: 'Take nothing' }], (card) => resolve({ card }));
        default:
            return null;
    }
}

function resourceChoiceLike(s, title, text, options, action) {
    const m = modal({
        title,
        content: [h('p', text), choiceButtons(options, async (v) => { if (await s.act(action(v))) m.close(); })],
        dismissable: false,
    });
    return m;
}

// ------------------------------------------------------------ trading

export function trade(s, prefill = null) {
    const g = s.game;
    const hand = g.private.hand;
    const types = g.ck ? [...RESOURCES, ...COMMODITIES] : RESOURCES;
    const isCurrent = g.current === g.me;

    const give = cardPicker({ types, max: hand, initial: prefill?.give || {} });
    const get = cardPicker({ types, max: Object.fromEntries(types.map((t) => [t, 19])), initial: prefill?.get || {} });
    const partner = h('select', h('option', { value: '' }, 'Anyone'),
        ...g.players.map((p, i) => (i === g.me ? null : h('option', { value: String(i) }, p.name))));
    const offerBtn = h('button.primary', { type: 'button', onclick: async () => {
        const action = { type: 'offerTrade', give: give.value(), get: get.value() };
        if (isCurrent && partner.value !== '') action.to = Number(partner.value);
        if (await s.act(action)) {
            m.close();
            toast('Offer sent');
        }
    } }, isCurrent ? 'Make offer' : `Offer to ${g.players[g.current].name}`);
    const playerTab = h('div.trade-tab',
        h('div.trade-cols', h('div', h('h4', 'You give'), give.el), h('div', h('h4', 'You get'), get.el)),
        isCurrent ? h('label.field.inline', h('span', 'Offer to'), partner) : h('p.muted', 'You can only trade with the player whose turn it is.'),
        offerBtn);

    // Bank / harbor trades
    const ratios = g.private.ratios;
    const giveSel = h('select', ...types.map((t) => h('option', { value: t }, `${resIcon(t)} ${resName(t)} (${ratios[t]}:1, you have ${hand[t] || 0})`)));
    const getSel = h('select', ...types.map((t) => h('option', { value: t }, `${resIcon(t)} ${resName(t)} (bank ${g.bank[t]})`)));
    const best = types.find((t) => (hand[t] || 0) >= ratios[t]);
    if (best) giveSel.value = best;
    getSel.value = types.find((t) => t !== giveSel.value) || types[0];
    const count = stepper({ value: 1, min: 1, max: 10 });
    const summary = h('p.muted');
    const updateSummary = () => {
        const r = ratios[giveSel.value];
        summary.textContent = `Pay ${r * count.get()} ${resName(giveSel.value)} → get ${count.get()} ${resName(getSel.value)}`;
    };
    giveSel.addEventListener('change', updateSummary);
    getSel.addEventListener('change', updateSummary);
    count.el.addEventListener('click', updateSummary);
    updateSummary();
    const bankTab = h('div.trade-tab',
        h('label.field.inline', h('span', 'Give'), giveSel),
        h('label.field.inline', h('span', 'Get'), getSel),
        h('label.field.inline', h('span', 'Amount'), count.el),
        summary,
        h('button.primary', { type: 'button', onclick: async () => {
            if (await s.act({ type: 'maritimeTrade', give: giveSel.value, get: getSel.value, count: count.get() })) m.close();
        } }, 'Trade with bank'));

    const tabs = h('div.tabs');
    const bodies = [playerTab, bankTab];
    ['Players', 'Bank & harbors'].forEach((label, i) => {
        if (i === 1 && !isCurrent) return;
        tabs.append(h('button.tab', { type: 'button', class: i === 0 ? 'active' : '', onclick: (e) => {
            for (const b of tabs.children) b.classList.toggle('active', b === e.currentTarget);
            bodies.forEach((b, j) => { b.hidden = j !== i; });
        } }, label));
    });
    bankTab.hidden = true;
    const m = modal({ title: 'Trade', content: [tabs, playerTab, bankTab], wide: true });
    return m;
}

// ------------------------------------------------------------ cards

export function playDev(s, type) {
    const g = s.game;
    if (type === 'yearOfPlenty') {
        const totalBank = RESOURCES.reduce((a, r) => a + g.bank[r], 0);
        return exactCardsDialog(s, {
            title: 'Year of Plenty', text: 'Take 2 resources from the bank.', types: RESOURCES, max: g.bank,
            total: Math.min(2, totalBank), action: (cards) => ({ type: 'playDevCard', card: 'yearOfPlenty', cards }), dismissable: true,
        });
    }
    if (type === 'monopoly') {
        return resourceChoice(s, {
            title: 'Monopoly', text: 'Every other player gives you all their cards of this resource.', types: RESOURCES,
            action: (resource) => ({ type: 'playDevCard', card: 'monopoly', resource }),
        });
    }
    return s.act({ type: 'playDevCard', card: type });
}

function boardPick(s, label, vertices, edges, hexes, onPick, extra = {}) {
    s.setMode({ label, key: `progress-${label}`, vertices, edges, hexes, ...extra, onPick });
}

export function playProgress(s, card) {
    const g = s.game;
    const legal = g.legal || {};
    const type = card.type;
    const play = async (params = {}) => {
        const ok = await s.act({ type: 'playProgress', card: type, ...params });
        if (ok) s.setMode(null);
        return ok;
    };
    const opponents = g.players.map((_, i) => i).filter((i) => i !== g.me);
    const [name, text] = PROGRESS[type];

    switch (type) {
        case 'alchemist': {
            const d1 = h('select', ...[1, 2, 3, 4, 5, 6].map((n) => h('option', { value: n }, `Yellow die: ${n}`)));
            const d2 = h('select', ...[1, 2, 3, 4, 5, 6].map((n) => h('option', { value: n }, `Red die: ${n}`)));
            const m = modal({ title: name, content: [h('p', text), d1, d2], actions: [h('button.primary', { type: 'button', onclick: async () => {
                if (await play({ dice: [Number(d1.value), Number(d2.value)] })) m.close();
            } }, 'Play and roll')] });
            return;
        }
        case 'engineer':
            return boardPick(s, 'Choose a city for the free wall', legal.wallSpots || [], null, null, (at) => play({ at }));
        case 'medicine':
            return boardPick(s, 'Choose a settlement to upgrade', legal.cities || [], null, null, (at) => play({ at }), { preview: 'city' });
        case 'inventor': {
            const hexes = g.board.hexes.map((hx, i) => (hx.number && ![2, 12, 6, 8].includes(hx.number) ? i : -1)).filter((i) => i >= 0);
            return boardPick(s, 'Choose the first number token to swap', null, null, hexes, (a) => {
                boardPick(s, 'Choose the second number token', null, null, hexes.filter((x) => x !== a), (b) => play({ hexes: [a, b] }));
            });
        }
        case 'merchant': {
            const hexes = g.board.hexes.map((hx, i) => {
                if (!['forest', 'hills', 'pasture', 'fields', 'mountains'].includes(hx.terrain)) return -1;
                return Object.entries(g.buildings).some(([v, b]) => b.owner === g.me && hexHasVertex(hx, v)) ? i : -1;
            }).filter((i) => i >= 0);
            return boardPick(s, 'Choose a tile next to your settlement or city', null, null, hexes, (hex) => play({ hex }));
        }
        case 'smith': {
            const options = legal.knightPromote || [];
            if (!options.length) return toast('You have no knights that can be promoted', 'error');
            return boardPick(s, 'Choose a knight to promote', options, null, null, (a) => {
                const rest = options.filter((v) => v !== a);
                if (!rest.length) return play({ knights: [a] });
                boardPick(s, 'Choose a second knight (or finish)', rest, null, null, (b) => play({ knights: [a, b] }), {
                    extra: h('button.secondary.small', { type: 'button', onclick: () => play({ knights: [a] }) }, 'Just one'),
                });
            });
        }
        case 'diplomat': {
            const open = openRoads(g);
            return boardPick(s, 'Choose an open road to remove', null, open, null, async (edge) => {
                if (g.roads[edge].owner !== g.me) return play({ edge });
                const relocate = await chooseYesNo('Diplomat', 'Move your road somewhere else?', 'Move it', 'Just remove it');
                if (!relocate) return play({ edge });
                boardPick(s, 'Choose where to place the road', null, (legal.roads || []).filter((e) => e !== edge), null, (to) => play({ edge, to }), { preview: 'road' });
            });
        }
        case 'intrigue': {
            const targets = Object.entries(g.ck.knights).filter(([v, k]) => k.owner !== g.me &&
                Object.entries(g.roads).some(([e, r]) => r.owner === g.me && e.split('|').includes(v))).map(([v]) => v);
            if (!targets.length) return toast('There are no opposing knights on your roads', 'error');
            return boardPick(s, 'Choose an opposing knight to displace', targets, null, null, (at) => play({ at }));
        }
        case 'commercialHarbor': {
            const hand = g.private.hand;
            const rows = opponents.map((i) => {
                const sel = h('select', h('option', { value: '' }, '— skip —'), ...RESOURCES.filter((r) => hand[r] > 0).map((r) => h('option', { value: r }, `${resIcon(r)} ${resName(r)}`)));
                return { i, sel, el: h('label.field.inline', h('span', g.players[i].name), sel) };
            });
            const m = modal({ title: name, content: [h('p', text), ...rows.map((r) => r.el)], actions: [h('button.primary', { type: 'button', onclick: async () => {
                const offers = {};
                for (const r of rows) if (r.sel.value) offers[r.i] = r.sel.value;
                if (await play({ offers })) m.close();
            } }, 'Play')] });
            return;
        }
        case 'masterMerchant': {
            const eligible = opponents.filter((i) => g.players[i].publicVp > g.players[g.me].publicVp && g.players[i].handCount > 0);
            return playerChoice(s, { title: name, text, players: eligible, action: (target) => ({ type: 'playProgress', card: type, target }) });
        }
        case 'deserter': {
            const eligible = opponents.filter((i) => Object.values(g.ck.knights).some((k) => k.owner === i));
            return playerChoice(s, { title: name, text, players: eligible, action: (target) => ({ type: 'playProgress', card: type, target }) });
        }
        case 'spy':
            return playerChoice(s, { title: name, text, players: opponents.filter((i) => g.ck.players[i].progressCount > 0), action: (target) => ({ type: 'playProgress', card: type, target }) });
        case 'merchantFleet':
            return resourceChoice(s, { title: name, text, types: [...RESOURCES, ...COMMODITIES], action: (resource) => ({ type: 'playProgress', card: type, resource }) });
        case 'resourceMonopoly':
            return resourceChoice(s, { title: name, text, types: RESOURCES, action: (resource) => ({ type: 'playProgress', card: type, resource }) });
        case 'tradeMonopoly':
            return resourceChoice(s, { title: name, text, types: COMMODITIES, action: (resource) => ({ type: 'playProgress', card: type, resource }) });
        default: {
            const m = modal({ title: name, content: h('p', text), actions: [h('button.primary', { type: 'button', onclick: async () => {
                if (await play()) m.close();
            } }, 'Play')] });
        }
    }
}

function hexHasVertex(hex, vertexId) {
    const X = 2 * hex.q + hex.r;
    const Y = 3 * hex.r;
    return [[0, -2], [1, -1], [1, 1], [0, 2], [-1, 1], [-1, -1]].some(([dx, dy]) => `${X + dx},${Y + dy}` === vertexId);
}

function openRoads(g) {
    const out = [];
    for (const [e, r] of Object.entries(g.roads)) {
        if (r.type !== 'road') continue;
        const open = e.split('|').some((v) => {
            const b = g.buildings[v];
            if (b && b.owner === r.owner) return false;
            if (g.ck.knights[v]?.owner === r.owner) return false;
            return !Object.entries(g.roads).some(([o, rr]) => o !== e && rr.owner === r.owner && o.split('|').includes(v));
        });
        if (open) out.push(e);
    }
    return out;
}

function chooseYesNo(title, text, yes, no) {
    return new Promise((resolve) => {
        let done = false;
        const pick = (v) => { done = true; m.close(); resolve(v); };
        const m = modal({
            title,
            content: h('p', text),
            actions: [h('button.secondary', { type: 'button', onclick: () => pick(false) }, no), h('button.primary', { type: 'button', onclick: () => pick(true) }, yes)],
            onClose: () => { if (!done) resolve(false); },
        });
    });
}

// ------------------------------------------------------------ game over

export function winner(s) {
    const g = s.game;
    const room = s.view.room;
    const isHost = room.hostId === room.you;
    const rows = g.players
        .map((p, i) => ({ p, i, vp: p.vp }))
        .sort((a, b) => b.vp - a.vp)
        .map(({ p, i, vp }) => h('tr', { class: i === g.winner ? 'winner' : '' },
            h('td', swatch(p.color), ` ${p.name}`), h('td', `${vp} VP`),
            h('td.muted', g.revealed && g.revealed[i] ? `incl. ${g.revealed[i]} VP card${g.revealed[i] > 1 ? 's' : ''}` : '')));
    const w = g.players[g.winner];
    modal({
        title: '🏆 Game over',
        content: [h('p.big-text', g.winner === g.me ? 'You win! 🎉' : `${w.name} wins!`), h('table.scores', h('tbody', ...rows))],
        actions: [
            h('button.secondary', { type: 'button', onclick: () => s.leave() }, 'Leave'),
            isHost ? h('button.primary', { type: 'button', onclick: async () => {
                try {
                    await net.request('room:rematch');
                } catch (err) {
                    toast(err.message, 'error');
                }
            } }, 'Back to lobby for a rematch') : h('span.muted', 'The host can start a rematch.'),
        ],
    });
}

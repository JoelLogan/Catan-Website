// Side panels of the game screen. Each render function rebuilds its panel from the view.
import { h, clear, toast } from '../dom.js';
import { COSTS, RESOURCES, COMMODITIES, CK } from '/shared/constants.js';
import { DEV_CARDS, PROGRESS, TRACK_LABELS, resChip, resIcon, resName, cardsText, swatch, costText } from '../labels.js';
import * as dialogs from './dialogs.js';

const canAfford = (hand, cost) => Object.entries(cost).every(([k, n]) => (hand[k] || 0) >= n);

function panel(title, ...content) {
    return [title ? h('h3', title) : null, ...content].filter((x) => x !== null && x !== undefined && x !== false);
}

export function renderPlayers(s) {
    const g = s.game;
    const el = s.els.players;
    clear(el);
    const members = new Map(s.view.room.members.map((m) => [m.id, m]));
    const list = h('ul.player-cards');
    g.players.forEach((p, i) => {
        const m = members.get(p.id);
        const waiting = g.waiting.players.includes(i);
        const vp = i === g.me || g.phase === 'finished' ? p.vp : p.publicVp;
        const ckp = g.ck ? g.ck.players[i] : null;
        list.append(h('li.player-card', { class: [i === g.current ? 'current' : '', i === g.me ? 'me' : '', waiting ? 'waiting' : ''].join(' ') },
            h('div.pc-head',
                swatch(p.color),
                h('span.pc-name', p.name, i === g.me ? ' (you)' : ''),
                m?.isBot ? h('span.tag', 'bot') : null,
                m && !m.isBot && (!m.connected || m.left) ? h('span.tag.warn', m.left ? 'left' : 'offline') : null,
                waiting ? h('span.hourglass', { title: 'Waiting for this player' }, '⏳') : null,
                h('span.pc-vp', { title: 'Victory points' }, `${vp} VP`)),
            h('div.pc-stats',
                h('span', { title: 'Cards in hand' }, `🂠 ${p.handCount}`),
                g.ck ? h('span', { title: 'Progress cards' }, `📜 ${ckp.progressCount}`) : h('span', { title: 'Development cards' }, `🃏 ${p.devCount}`),
                g.ck ? h('span', { title: 'Active knight strength' }, `🛡️ ${ckp.knightStrength}`) : h('span', { title: 'Knights played' }, `⚔️ ${p.knightsPlayed}`),
                h('span', { title: 'Longest route' }, `🛣️ ${p.routeLength}`)),
            h('div.pc-badges',
                g.longestRoad === i ? h('span.badge', '🛣️ Longest Road') : null,
                g.largestArmy === i ? h('span.badge', '⚔️ Largest Army') : null,
                p.bonusIslands ? h('span.badge', `🏝️ ×${p.bonusIslands}`) : null,
                ckp && ckp.defender ? h('span.badge', `🛡️ Defender ×${ckp.defender}`) : null,
                ckp && ckp.vpCards.length ? h('span.badge', `📜 +${ckp.vpCards.length} VP`) : null,
                g.ck && g.ck.merchant && g.ck.merchant.owner === i ? h('span.badge', '🧺 Merchant') : null,
                ...(g.ck ? Object.entries(g.ck.metropolis).filter(([, mm]) => mm && mm.owner === i).map(([t]) => h('span.badge', `🏰 ${TRACK_LABELS[t].name}`)) : []),
                ckp ? h('span.improvements', ...CK.tracks.map((t) => h('span.imp', { style: { borderColor: TRACK_LABELS[t].color }, title: `${TRACK_LABELS[t].name} level` }, String(ckp.improvements[t])))) : null),
        ));
    });
    el.append(...panel('Players', list));
}

export function renderInfo(s) {
    const g = s.game;
    const el = s.els.info;
    clear(el);
    const bank = h('div.bank', ...Object.entries(g.bank).map(([k, n]) => resChip(k, n)));
    el.append(...panel('Bank', bank,
        !g.ck ? h('p.muted', `Development cards left: ${g.devDeckCount}`) : null,
        h('p.muted', `${g.phase === 'setup' ? 'Setup' : `Turn ${g.turn}`} · first to ${g.settings.victoryPoints} VP${s.view.room.mapName ? ` · map: ${s.view.room.mapName}` : ''}`)));
}

export function renderCk(s) {
    const g = s.game;
    const el = s.els.ck;
    clear(el);
    el.hidden = !g.ck;
    if (!g.ck) return;
    const ck = g.ck;
    const track = h('div.barbarian-track', { 'aria-label': `Barbarians at ${ck.barbarian} of ${ck.trackLength}` });
    for (let i = 0; i <= ck.trackLength; i++) {
        track.append(h('span.step', { class: i === ck.barbarian ? 'ship' : i === ck.trackLength ? 'land' : '' }, i === ck.barbarian ? '⛵' : i === ck.trackLength ? '🏰' : ''));
    }
    const danger = ck.strength > ck.defense;
    el.append(...panel('Barbarians', track,
        h('p', { class: danger ? 'danger' : 'safe' }, `Barbarian strength ${ck.strength} vs. knights ${ck.defense}`),
        h('p.muted', ck.robberActive ? `Attacks so far: ${ck.attacks}` : 'The robber stays put until the first attack.')));

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
                : h('span.tag', 'max'),
        ));
    }
    el.append(h('h4', 'Your city improvements'), list);
}

export function renderHand(s) {
    const g = s.game;
    const el = s.els.hand;
    clear(el);
    if (g.me < 0) return;
    const hand = g.private.hand;
    const types = g.ck ? [...RESOURCES, ...COMMODITIES] : RESOURCES;
    const total = types.reduce((a, k) => a + (hand[k] || 0), 0);
    const limit = g.settings.discardLimit + (g.ck ? 2 * g.ck.players[g.me].walls : 0);
    el.append(...panel(`Your hand (${total})`,
        h('div.hand', ...types.map((k) => h('div.card-stack', { class: `res-${k}`, title: resName(k) },
            h('span.icon', resIcon(k)), h('span.n', String(hand[k] || 0)), h('span.lbl', resName(k))))),
        total > limit ? h('p.warn', `⚠️ You will lose half your cards if a 7 is rolled (limit ${limit}).`) : null));
}

export function renderActions(s) {
    const g = s.game;
    const el = s.els.actions;
    clear(el);
    if (g.phase === 'finished') {
        el.append(...panel('Game over', h('button.primary.big', { type: 'button', onclick: () => dialogs.winner(s) }, '🏆 Show results')));
        return;
    }
    if (g.me < 0) return;
    const w = g.waiting;
    const mine = w.players.includes(g.me);
    const hand = g.private.hand;
    const legal = g.legal || {};
    const main = mine && w.kind === 'main';
    const special = mine && w.kind === 'specialBuild';
    const building = main || special;
    const buttons = [];

    if (mine && w.kind === 'preRoll') {
        buttons.push(h('button.primary.big', { type: 'button', onclick: () => s.act({ type: 'rollDice' }) }, '🎲 Roll dice'));
    }

    const buildBtn = (piece, label, cost, list) => h('button', {
        type: 'button',
        disabled: !building || !canAfford(hand, cost) || !(list && list.length),
        title: !(list && list.length) && building ? 'No legal spot' : '',
        onclick: () => s.startBuild(piece),
    }, `${label}`, h('span.cost', costText(cost)));

    if (g.phase !== 'setup') {
        buttons.push(
            buildBtn('road', '🛣️ Road', COSTS.road, legal.roads),
            buildBtn('settlement', '🏠 Settlement', COSTS.settlement, legal.settlements),
            buildBtn('city', '🏰 City', COSTS.city, legal.cities),
        );
        if (g.settings.expansions.seafarers) {
            buttons.push(buildBtn('ship', '⛵ Ship', COSTS.ship, legal.ships));
            const moves = legal.shipMoves || {};
            buttons.push(h('button', {
                type: 'button',
                disabled: !main || !Object.keys(moves).length,
                onclick: () => shipMoveMode(s, moves),
            }, '↪️ Move ship'));
        }
        if (!g.ck) {
            buttons.push(h('button', {
                type: 'button',
                disabled: !building || !canAfford(hand, COSTS.devCard) || g.devDeckCount === 0,
                onclick: () => s.act({ type: 'buyDevCard' }),
            }, '🃏 Dev card', h('span.cost', costText(COSTS.devCard))));
        } else {
            buttons.push(...knightButtons(s, main, hand, legal));
        }
        const canTrade = g.phase === 'main' && ['main'].includes(w.kind) && g.me >= 0;
        buttons.push(h('button', { type: 'button', disabled: !canTrade, onclick: () => dialogs.trade(s) }, g.current === g.me ? '🤝 Trade' : '🤝 Offer a trade'));
    }

    if (main) buttons.push(h('button.primary', { type: 'button', onclick: () => endTurn(s) }, 'End turn ➜'));
    if (special) buttons.push(h('button.primary', { type: 'button', onclick: () => s.act({ type: 'endTurn' }) }, 'Done building ➜'));

    el.append(...panel('Actions', h('div.action-grid', ...buttons)));
}

async function endTurn(s) {
    const g = s.game;
    if (g.ck && g.ck.progress.length > CK.progressHandLimit) {
        toast(`You hold ${g.ck.progress.length} progress cards — play or discard down to ${CK.progressHandLimit} first.`, 'error');
        return;
    }
    s.setMode(null);
    s.act({ type: 'endTurn' });
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

function knightButtons(s, main, hand, legal) {
    const pick = (label, key, vertices, action, extra = {}) => s.setMode({
        label, key, vertices, ...extra,
        onPick: async (at) => {
            if (await s.act({ ...action, at })) s.setMode(null);
        },
    });
    const knights = s.game.ck.knights;
    return [
        h('button', {
            type: 'button',
            disabled: !main || !canAfford(hand, COSTS.knight) || !legal.knightSpots?.length,
            onclick: () => pick('Choose where to recruit a knight', 'knight-build', legal.knightSpots, { type: 'buildKnight' }, { preview: 'knight' }),
        }, '🛡️ Knight', h('span.cost', costText(COSTS.knight))),
        h('button', {
            type: 'button',
            disabled: !main || !canAfford(hand, COSTS.activateKnight) || !legal.knightActivate?.length,
            onclick: () => pick('Choose a knight to activate', 'knight-activate', legal.knightActivate, { type: 'activateKnight' }),
        }, '🔥 Activate', h('span.cost', costText(COSTS.activateKnight))),
        h('button', {
            type: 'button',
            disabled: !main || !canAfford(hand, COSTS.promoteKnight) || !legal.knightPromote?.length,
            onclick: () => pick('Choose a knight to promote', 'knight-promote', legal.knightPromote, { type: 'promoteKnight' }),
        }, '⬆️ Promote', h('span.cost', costText(COSTS.promoteKnight))),
        h('button', {
            type: 'button',
            disabled: !main || !Object.keys(legal.knightMoves || {}).length,
            onclick: () => s.setMode({
                label: 'Choose a knight to move',
                key: 'knight-move-1',
                vertices: Object.keys(legal.knightMoves),
                onPick: (from) => s.setMode({
                    label: 'Choose where the knight goes (a weaker enemy knight will be displaced)',
                    key: 'knight-move-2',
                    vertices: legal.knightMoves[from],
                    preview: 'knight',
                    previewLevel: knights[from]?.level,
                    onPick: async (to) => {
                        if (await s.act({ type: 'moveKnight', from, to })) s.setMode(null);
                    },
                }),
            }),
        }, '🐎 Move knight'),
        h('button', {
            type: 'button',
            disabled: !main || !legal.knightChase?.length,
            onclick: () => pick('Choose a knight next to the robber', 'knight-chase', legal.knightChase, { type: 'chaseRobber' }),
        }, '🏃 Chase robber'),
        h('button', {
            type: 'button',
            disabled: !main || !canAfford(hand, COSTS.cityWall) || !legal.wallSpots?.length,
            onclick: () => pick('Choose a city to wall', 'wall', legal.wallSpots, { type: 'buildCityWall' }),
        }, '🧱 City wall', h('span.cost', costText(COSTS.cityWall))),
    ];
}

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
                    h('button.small', { type: 'button', disabled: !allowed, onclick: () => dialogs.playProgress(s, c) }, 'Play'),
                    h('button.small.ghost', { type: 'button', onclick: () => s.act({ type: 'discardProgress', card: c.id }), title: 'Discard this card' }, '🗑'))));
        }
        el.append(...panel(`Progress cards (${cards.length}/${CK.progressHandLimit})`, cards.length ? list : h('p.muted', 'Improve your cities to draw progress cards when the event die shows a gate.')));
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
            c.type === 'victoryPoint' ? h('span.tag', 'hidden +1 VP') : h('button.small', {
                type: 'button',
                disabled: !can,
                title: !c.playable ? 'Cards cannot be played on the turn they are bought' : g.turnFlags.devPlayed ? 'One development card per turn' : '',
                onclick: () => dialogs.playDev(s, c.type),
            }, c.playable ? 'Play' : 'New')));
    }
    el.append(...panel('Development cards', cards.length ? list : h('p.muted', 'None yet.')));
}

export function renderTrades(s) {
    const g = s.game;
    const el = s.els.trades;
    clear(el);
    if (!g.trades.length) {
        el.hidden = true;
        return;
    }
    el.hidden = false;
    const list = h('ul.trade-list');
    for (const t of g.trades) {
        const from = s.player(t.from);
        const to = t.to === null ? 'anyone' : s.player(t.to).name;
        const mineOffer = t.from === g.me;
        const eligible = !mineOffer && (t.to === null || t.to === g.me) && (t.from === g.current || g.me === g.current);
        const responded = t.accepted.includes(g.me) ? 'accepted' : t.rejected.includes(g.me) ? 'declined' : null;
        const hand = g.private?.hand || {};
        const canPay = canAfford(hand, t.get);
        const row = h('li.trade',
            h('div', h('b', from.name), ` offers ${cardsText(t.give)} for ${cardsText(t.get)} `, h('span.muted', `(to ${to})`)));
        const btns = h('div.trade-btns');
        if (eligible) {
            btns.append(
                h('button.small.primary', { type: 'button', disabled: !canPay || responded === 'accepted', title: canPay ? '' : 'You do not have the cards', onclick: () => s.act({ type: 'respondTrade', id: t.id, accept: true }) }, responded === 'accepted' ? 'Accepted ✓' : 'Accept'),
                h('button.small', { type: 'button', disabled: responded === 'declined', onclick: () => s.act({ type: 'respondTrade', id: t.id, accept: false }) }, 'Decline'),
            );
            if (g.me !== g.current) {
                btns.append(h('button.small.ghost', { type: 'button', onclick: () => dialogs.trade(s, { give: t.get, get: t.give }) }, 'Counter'));
            }
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
        row.append(btns, status.length ? h('p.muted.small', status.join(' · ')) : null);
        list.append(row);
    }
    el.append(...panel('Trade offers', list));
}

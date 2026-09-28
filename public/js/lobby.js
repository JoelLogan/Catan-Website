// Lobby screen: players, host-controlled settings, map choice, chat.
import { h, clear, toast } from './dom.js';
import * as net from './net.js';
import * as store from './store.js';
import { swatch } from './labels.js';
import { PLAYER_COLORS, COLOR_HEX, LIMITS } from '/shared/constants.js';
import { renderChat } from './chat.js';

let ui = null;

const MAP_LABELS = { auto: 'Automatic (by player count)' };

function numberField(label, key, min, max, hint) {
    const input = h('input', { type: 'number', min, max, step: 1, dataset: { key } });
    return { input, el: h('label.field.inline', h('span', label), input, hint ? h('small', hint) : null) };
}

function checkField(label, key) {
    const input = h('input', { type: 'checkbox', dataset: { key } });
    return { input, el: h('label.check', input, h('span', label)) };
}

function build(root, view, actions) {
    clear(root);
    const code = view.room.code;
    const inviteUrl = `${location.origin}/#${code}`;
    const copy = async (text, what) => {
        try {
            await navigator.clipboard.writeText(text);
            toast(`${what} copied`);
        } catch {
            toast(`Copy failed — ${what.toLowerCase()}: ${text}`, 'info', 8000);
        }
    };

    const f = {
        maxPlayers: numberField('Max players', 'maxPlayers', 2, 8),
        victoryPoints: numberField('Victory points to win', 'victoryPoints', LIMITS.minVictoryPoints, LIMITS.maxVictoryPoints),
        seafarers: checkField('Seafarers (ships, islands, gold fields)', 'seafarers'),
        citiesKnights: checkField('Cities & Knights (commodities, knights, barbarians)', 'citiesKnights'),
        settlements: numberField('Settlements', 'settlements', 2, 30),
        cities: numberField('Cities', 'cities', 1, 30),
        roads: numberField('Roads', 'roads', 2, 30),
        ships: numberField('Ships', 'ships', 0, 30),
        discardLimit: numberField('Discard when a 7 is rolled with more than', 'discardLimit', 5, 20, 'cards'),
        islandBonus: numberField('Island bonus (VP)', 'islandBonus', 0, 5),
        randomizeTurnOrder: checkField('Random turn order', 'randomizeTurnOrder'),
    };
    const sbp = h('select', { dataset: { key: 'specialBuildPhase' } },
        h('option', { value: 'auto' }, 'Automatic (5+ players)'),
        h('option', { value: 'on' }, 'Always'),
        h('option', { value: 'off' }, 'Never'));
    const mapSelect = h('select', { dataset: { key: 'map' } });
    const mapInfo = h('small.map-info');

    const playersList = h('ul.member-list');
    const colorRow = h('div.color-row', { 'aria-label': 'Choose your color' });
    const addBotBtn = h('button.secondary', { type: 'button', onclick: () => send('room:addBot') }, '🤖 Add bot');
    const startBtn = h('button.primary.big', { type: 'button', onclick: () => send('room:start') }, 'Start game');
    const waitingNote = h('p.muted');
    const builderBtn = h('button.ghost', { type: 'button', onclick: () => actions.openBuilder() }, '🗺️ Open map builder');
    const chatBox = h('div.chat');

    const settingsForm = h('form.settings', { onsubmit: (e) => e.preventDefault() },
        h('fieldset', h('legend', 'Game'), f.maxPlayers.el, f.victoryPoints.el,
            h('label.field.inline', h('span', 'Map'), mapSelect), mapInfo, builderBtn),
        h('fieldset', h('legend', 'Expansions'), f.seafarers.el, f.citiesKnights.el, f.islandBonus.el),
        h('fieldset', h('legend', 'Pieces per player'), h('div.grid-2', f.settlements.el, f.cities.el, f.roads.el, f.ships.el)),
        h('fieldset', h('legend', 'Rules'), f.discardLimit.el,
            h('label.field.inline', h('span', 'Special building phase'), sbp), f.randomizeTurnOrder.el),
    );

    const collect = () => ({
        maxPlayers: Number(f.maxPlayers.input.value),
        victoryPoints: Number(f.victoryPoints.input.value),
        expansions: { seafarers: f.seafarers.input.checked, citiesKnights: f.citiesKnights.input.checked },
        pieces: {
            settlements: Number(f.settlements.input.value),
            cities: Number(f.cities.input.value),
            roads: Number(f.roads.input.value),
            ships: Number(f.ships.input.value),
        },
        discardLimit: Number(f.discardLimit.input.value),
        specialBuildPhase: sbp.value,
        randomizeTurnOrder: f.randomizeTurnOrder.input.checked,
        islandBonus: Number(f.islandBonus.input.value),
        map: mapSelect.value,
    });

    settingsForm.addEventListener('change', (e) => {
        const key = e.target.dataset.key;
        // Suggest the usual victory point targets when expansions are toggled.
        if ((key === 'seafarers' || key === 'citiesKnights') && e.target.checked) {
            const vp = Number(f.victoryPoints.input.value);
            if (vp === 10 || vp === 12 || vp === 13) {
                const both = f.seafarers.input.checked && f.citiesKnights.input.checked;
                f.victoryPoints.input.value = both ? 16 : f.citiesKnights.input.checked ? 13 : 12;
            }
        }
        send('room:settings', { settings: collect() });
    });

    async function send(event, payload) {
        try {
            await net.request(event, payload);
        } catch (err) {
            toast(err.message, 'error');
            if (ui) update(ui, ui.lastView); // revert to the server's values
        }
    }

    async function loadMaps() {
        try {
            const res = await net.request('maps:list', { clientKey: store.clientKey() });
            ui.builtin = res.builtin;
            ui.saved = res.maps;
            fillMaps();
        } catch {
            // keep whatever we had
        }
    }

    function fillMaps() {
        const current = ui.lastView.room.settings.map;
        clear(mapSelect);
        mapSelect.append(h('option', { value: 'auto' }, MAP_LABELS.auto));
        const g1 = h('optgroup', { label: 'Built-in' });
        for (const m of ui.builtin || []) g1.append(h('option', { value: m.id }, m.name));
        mapSelect.append(g1);
        if (ui.saved && ui.saved.length) {
            const g2 = h('optgroup', { label: 'Saved maps' });
            for (const m of ui.saved) g2.append(h('option', { value: `custom:${m.id}` }, `${m.name} (${m.land} land)`));
            mapSelect.append(g2);
        }
        if (![...mapSelect.options].some((o) => o.value === current)) {
            mapSelect.append(h('option', { value: current }, 'Custom map'));
        }
        mapSelect.value = current;
        const saved = (ui.saved || []).find((m) => `custom:${m.id}` === current);
        mapInfo.textContent = saved ? `${saved.land} land tiles, ${saved.ports} harbors` : '';
    }
    mapSelect.addEventListener('focus', loadMaps);

    const el = h('div.lobby',
        h('div.card.lobby-main',
            h('div.lobby-head',
                h('div', h('h2', 'Game lobby'), h('p.muted', 'Share the code or invite link with your friends.')),
                h('div.code-box',
                    h('button.code', { type: 'button', title: 'Copy code', onclick: () => copy(code, 'Code') }, code),
                    h('button.ghost.small', { type: 'button', onclick: () => copy(inviteUrl, 'Invite link') }, '🔗 Copy invite link'))),
            h('h3', 'Players ', h('span.count')),
            playersList,
            h('div.your-color', h('span', 'Your color:'), colorRow),
            h('div.lobby-actions', addBotBtn, startBtn, h('button.ghost', { type: 'button', onclick: () => actions.leave() }, 'Leave')),
            waitingNote,
        ),
        h('div.card.lobby-settings', h('h3', 'Settings'), settingsForm),
        h('div.card.lobby-chat', h('h3', 'Chat'), chatBox),
    );
    root.append(el);

    const state = {
        code, el, f, sbp, mapSelect, playersList, colorRow, addBotBtn, startBtn, waitingNote, builderBtn, chatBox,
        settingsForm, lastView: view, builtin: null, saved: null, send,
    };
    ui = state;
    loadMaps();
    return state;
}

function setIfIdle(input, value) {
    if (document.activeElement === input) return;
    if (input.type === 'checkbox') input.checked = !!value;
    else input.value = value;
}

function update(u, view) {
    u.lastView = view;
    const { room } = view;
    const s = room.settings;
    const isHost = room.hostId === room.you;
    const f = u.f;
    setIfIdle(f.maxPlayers.input, s.maxPlayers);
    setIfIdle(f.victoryPoints.input, s.victoryPoints);
    setIfIdle(f.seafarers.input, s.expansions.seafarers);
    setIfIdle(f.citiesKnights.input, s.expansions.citiesKnights);
    setIfIdle(f.settlements.input, s.pieces.settlements);
    setIfIdle(f.cities.input, s.pieces.cities);
    setIfIdle(f.roads.input, s.pieces.roads);
    setIfIdle(f.ships.input, s.pieces.ships);
    setIfIdle(f.discardLimit.input, s.discardLimit);
    setIfIdle(f.islandBonus.input, s.islandBonus);
    setIfIdle(f.randomizeTurnOrder.input, s.randomizeTurnOrder);
    setIfIdle(u.sbp, s.specialBuildPhase);
    if (u.builtin) {
        if (document.activeElement !== u.mapSelect) {
            u.mapSelect.value = s.map;
            if (u.mapSelect.value !== s.map) u.mapSelect.dispatchEvent(new Event('focus'));
        }
    }
    f.islandBonus.el.hidden = !s.expansions.seafarers;
    f.ships.el.hidden = !s.expansions.seafarers;
    for (const input of u.settingsForm.querySelectorAll('input, select')) input.disabled = !isHost;
    u.builderBtn.hidden = !isHost;

    // Players
    clear(u.playersList);
    for (const m of room.members) {
        const canKick = isHost && m.id !== room.you;
        u.playersList.append(h('li.member', { class: m.id === room.you ? 'me' : '' },
            swatch(m.color),
            h('span.member-name', m.name),
            m.id === room.hostId ? h('span.tag', '👑 host') : null,
            m.isBot ? h('span.tag', 'bot') : null,
            !m.isBot && !m.connected ? h('span.tag.warn', 'offline') : null,
            canKick ? h('button.icon-btn.small', { type: 'button', 'aria-label': `Remove ${m.name}`, onclick: () => u.send('room:kick', { memberId: m.id }) }, '✕') : null,
        ));
    }
    u.el.querySelector('.count').textContent = `(${room.members.length}/${s.maxPlayers})`;

    // Colors
    clear(u.colorRow);
    const taken = new Map(room.members.map((m) => [m.color, m]));
    for (const c of PLAYER_COLORS) {
        const owner = taken.get(c);
        const mine = owner && owner.id === room.you;
        u.colorRow.append(h('button.color-btn', {
            type: 'button',
            class: mine ? 'selected' : '',
            style: { background: COLOR_HEX[c] },
            disabled: !!owner && !mine,
            'aria-label': `${c}${owner ? ` (taken by ${owner.name})` : ''}`,
            title: c,
            onclick: () => u.send('room:color', { color: c }),
        }));
    }

    u.addBotBtn.hidden = !isHost;
    u.addBotBtn.disabled = room.members.length >= s.maxPlayers;
    u.startBtn.hidden = !isHost;
    u.startBtn.disabled = room.members.length < 2;
    const host = room.members.find((m) => m.id === room.hostId);
    u.waitingNote.textContent = isHost
        ? room.members.length < 2 ? 'Invite a friend or add a bot to start.' : ''
        : `Waiting for ${host ? host.name : 'the host'} to start the game…`;

    renderChat(u.chatBox, room);
}

export function renderLobby(root, view, actions) {
    if (!ui || ui.code !== view.room.code || !root.contains(ui.el)) ui = build(root, view, actions);
    update(ui, view);
}

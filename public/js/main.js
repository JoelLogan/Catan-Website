// App entry: connection, session resume, screen routing.
import { $, toast, closeAllModals, modal } from './dom.js';
import * as net from './net.js';
import * as store from './store.js';
import { renderLobby } from './lobby.js';
import { GameScreen } from './game/screen.js';
import { MapBuilder } from './builder.js';
import { helpContent } from './help.js';

const app = {
    view: null, // latest room:state
    screen: 'home',
    game: null, // GameScreen instance
    builder: null,
};

export function showScreen(name) {
    for (const el of document.querySelectorAll('.screen')) el.classList.toggle('active', el.id === `screen-${name}`);
    document.body.dataset.screen = name;
    app.screen = name;
}

function goHome() {
    if (app.game) {
        app.game.destroy();
        app.game = null;
    }
    closeAllModals();
    app.view = null;
    showScreen('home');
    if (location.hash) history.replaceState(null, '', location.pathname);
}

function nameInput() {
    const name = $('#home-name').value.trim();
    if (!name) {
        toast('Please enter your name first', 'error');
        $('#home-name').focus();
        return null;
    }
    store.setName(name);
    return name;
}

async function createGame() {
    const name = nameInput();
    if (!name) return;
    try {
        const res = await net.request('room:create', { name });
        store.setSession({ code: res.code, token: res.token });
    } catch (err) {
        toast(err.message, 'error');
    }
}

async function joinGame(codeArg) {
    const name = nameInput();
    if (!name) return;
    const code = (codeArg || $('#join-code').value).trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) {
        toast('Enter the 6-character game code', 'error');
        return;
    }
    try {
        const res = await net.request('room:join', { code, name });
        store.setSession({ code: res.code, token: res.token });
    } catch (err) {
        toast(err.message, 'error');
    }
}

export async function leaveRoom() {
    try {
        await net.request('room:leave');
    } catch {
        // Leaving should always succeed locally.
    }
    store.setSession(null);
    goHome();
}

async function resume() {
    const session = store.getSession();
    if (!session) return;
    try {
        await net.request('room:resume', session);
    } catch (err) {
        store.setSession(null);
        if (app.screen === 'lobby' || app.screen === 'game') {
            toast(err.message, 'error');
            goHome();
        }
    }
}

function onState(view) {
    app.view = view;
    const { room, game } = view;
    if (location.hash !== `#${room.code}` && app.screen !== 'builder') history.replaceState(null, '', `#${room.code}`);
    if (!game) {
        if (app.game) {
            app.game.destroy();
            app.game = null;
        }
        if (app.screen !== 'builder') showScreen('lobby');
        renderLobby($('#screen-lobby'), view, { leave: leaveRoom, openBuilder });
        return;
    }
    if (app.screen === 'builder') return;
    if (!app.game) {
        closeAllModals();
        showScreen('game');
        app.game = new GameScreen($('#screen-game'), { leave: leaveRoom });
    }
    app.game.update(view);
}

function openBuilder() {
    showScreen('builder');
    if (!app.builder) app.builder = new MapBuilder($('#screen-builder'), { back: closeBuilder });
    app.builder.activate();
}

function closeBuilder() {
    if (!app.view) {
        showScreen('home');
        return;
    }
    showScreen(app.view.game ? 'game' : 'lobby');
    onState(app.view);
}

function setConn(text, ok) {
    const el = $('#conn-status');
    el.textContent = text;
    el.classList.toggle('ok', ok);
}

function init() {
    $('#home-name').value = store.getName();
    $('#create-btn').addEventListener('click', createGame);
    $('#join-btn').addEventListener('click', () => joinGame());
    $('#join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinGame(); });
    $('#join-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
    $('#home-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') createGame(); });
    $('#builder-btn').addEventListener('click', openBuilder);
    $('#help-btn').addEventListener('click', () => modal({ title: 'How to play', content: helpContent(), wide: true }));
    $('#brand-link').addEventListener('click', (e) => {
        e.preventDefault();
        if (app.screen === 'builder') closeBuilder();
    });

    // Invite links look like https://host/#CODE
    const hashCode = location.hash.slice(1).toUpperCase();
    if (/^[A-Z0-9]{6}$/.test(hashCode) && !store.getSession()) {
        $('#join-code').value = hashCode;
        if (!$('#home-name').value) $('#home-name').focus();
    }

    net.on('connect', () => {
        setConn('Online', true);
        resume();
    });
    net.on('disconnect', () => setConn('Reconnecting…', false));
    net.on('connect_error', () => setConn('Offline — retrying…', false));
    net.on('room:state', onState);
    net.on('room:closed', ({ reason }) => {
        store.setSession(null);
        toast(reason || 'You left the game', 'error', 6000);
        goHome();
    });
    if (typeof window.io !== 'function') {
        setConn('Offline', false);
        toast('Could not load the game client. Please refresh the page.', 'error', 10000);
        return;
    }
    net.connect();
}

// socket.io is loaded with `defer`; module scripts run after deferred scripts.
init();


// Exposed for end-to-end tests (module export, not a global).
export { app };

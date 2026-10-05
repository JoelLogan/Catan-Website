import { h, clear, toast } from './dom.js';
import * as net from './net.js';
import { COLOR_HEX, LIMITS } from '/shared/constants.js';

function renderMessageItem(m) {
    return h('li', h('b', { style: { color: COLOR_HEX[m.color] || '#333' } }, m.name), ': ', m.text);
}

/** Render (or refresh) a chat box inside `box` for the given room view. */
export function renderChat(box, room) {
    if (!box.dataset.ready) {
        const list = h('ol.chat-list', { 'aria-live': 'polite' });
        const input = h('input', { type: 'text', maxLength: LIMITS.maxChatLength, placeholder: 'Say something…', 'aria-label': 'Chat message' });
        const send = async () => {
            const text = input.value.trim();
            if (!text) return;
            input.value = '';
            try {
                await net.request('room:chat', { text });
            } catch (err) {
                toast(err.message, 'error');
                input.value = text;
            }
        };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
        box.append(list, h('div.chat-input', input, h('button.secondary.small', { type: 'button', onclick: send }, 'Send')));
        box.dataset.ready = '1';
        box.dataset.last = '0';
    }
    const list = box.querySelector('.chat-list');
    const last = Number(box.dataset.last);
    const first = room.chat.length ? room.chat[0].id : 0;
    const newest = room.chat.length ? room.chat[room.chat.length - 1].id : 0;
    if (!room.chat.length) {
        if (last !== 0 || list.childElementCount) clear(list);
        box.dataset.last = '0';
        return;
    }
    if (newest === last) return;

    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 30;
    const canAppend = last >= first && room.chat.some((m) => m.id === last);
    if (canAppend) {
        for (const m of room.chat) {
            if (m.id > last) list.append(renderMessageItem(m));
        }
    } else {
        clear(list);
        for (const m of room.chat) list.append(renderMessageItem(m));
    }
    if (atBottom || last === 0) list.scrollTop = list.scrollHeight;
    box.dataset.last = String(newest);
}

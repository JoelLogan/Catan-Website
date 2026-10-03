// Visual effects layer: flying cards, splash banners and small "bump" feedback.
// Everything is purely decorative, uses the Web Animations API and is skipped
// when the user prefers reduced motion.
import { h } from './dom.js';
import { resIcon } from './labels.js';

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let layer = null;
function fxLayer() {
    if (!layer || !layer.isConnected) {
        layer = h('div.fx-layer', { 'aria-hidden': 'true' });
        document.body.append(layer);
    }
    return layer;
}

/** Center of an element (or a {x, y} point) in viewport coordinates. */
export function centerOf(target) {
    if (!target) return null;
    if (typeof target.x === 'number' && typeof target.y === 'number' && !(target instanceof Element)) return target;
    const r = target.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** A small card element: a resource face, or a card back ('back', 'dev', 'progress'). */
export function cardFace(kind) {
    if (kind === 'back' || kind === 'dev' || kind === 'progress') {
        return h('div.fx-card.back', { class: kind }, kind === 'dev' ? '🃏' : kind === 'progress' ? '📜' : '🏝️');
    }
    return h('div.fx-card', { class: `res-card res-${kind}` }, h('span', resIcon(kind)));
}

/**
 * Fly a card from one place to another.
 * @param {string} kind resource name or a back kind
 * @param {Element|{x,y}} from
 * @param {Element|{x,y}} to
 * @param {object} [o] {delay, duration, onArrive}
 */
export function flyCard(kind, from, to, { delay = 0, duration = 650, onArrive } = {}) {
    const a = centerOf(from);
    const b = centerOf(to);
    if (!a || !b || reduced()) {
        if (onArrive) onArrive();
        return;
    }
    const el = cardFace(kind);
    fxLayer().append(el);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lift = Math.min(120, 40 + Math.hypot(dx, dy) * 0.18);
    const spin = (Math.random() - 0.5) * 40;
    el.style.left = `${a.x}px`;
    el.style.top = `${a.y}px`;
    const anim = el.animate([
        { transform: 'translate(-50%, -50%) scale(0.4) rotate(0deg)', opacity: 0 },
        { transform: `translate(calc(-50% + ${dx * 0.5}px), calc(-50% + ${dy * 0.5 - lift}px)) scale(1.15) rotate(${spin}deg)`, opacity: 1, offset: 0.5 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.7) rotate(0deg)`, opacity: 0.9 },
    ], { duration, delay, easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'both' });
    anim.onfinish = () => {
        el.remove();
        if (onArrive) onArrive();
        if (to instanceof Element) bump(to);
    };
}

/** Quick scale "bump" on an element to draw the eye to a change. */
export function bump(el, strength = 1.18) {
    if (!el || reduced() || !el.animate) return;
    el.animate([
        { transform: 'scale(1)' },
        { transform: `scale(${strength})` },
        { transform: 'scale(1)' },
    ], { duration: 360, easing: 'ease-out' });
}

/** A short-lived floating "+2" / "−1" label. */
export function floatText(text, at, { color = '#fff', delay = 0 } = {}) {
    const p = centerOf(at);
    if (!p || reduced()) return;
    const el = h('div.fx-float', { style: { left: `${p.x}px`, top: `${p.y}px`, color } }, text);
    fxLayer().append(el);
    const anim = el.animate([
        { transform: 'translate(-50%, -30%) scale(0.6)', opacity: 0 },
        { transform: 'translate(-50%, -120%) scale(1.1)', opacity: 1, offset: 0.3 },
        { transform: 'translate(-50%, -220%) scale(1)', opacity: 0 },
    ], { duration: 1300, delay, easing: 'ease-out', fill: 'both' });
    anim.onfinish = () => el.remove();
}

/** Big centered banner, e.g. "Your turn!" or "7 — the robber strikes!". */
export function splash(text, { sub = '', tone = 'gold', duration = 1500 } = {}) {
    if (reduced()) return;
    const el = h('div.fx-splash', { class: tone }, h('div.fx-splash-title', text), sub ? h('div.fx-splash-sub', sub) : null);
    fxLayer().append(el);
    const anim = el.animate([
        { transform: 'translate(-50%, -50%) scale(0.6)', opacity: 0 },
        { transform: 'translate(-50%, -50%) scale(1.05)', opacity: 1, offset: 0.18 },
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.75 },
        { transform: 'translate(-50%, -60%) scale(0.95)', opacity: 0 },
    ], { duration, easing: 'ease-out', fill: 'both' });
    anim.onfinish = () => el.remove();
}

/** Confetti burst (game won). */
export function confetti(count = 90) {
    if (reduced()) return;
    const colors = ['#f2c230', '#d64545', '#3b6fd6', '#3f9a4d', '#f08c2e', '#8e5cc4', '#fff'];
    const w = window.innerWidth;
    for (let i = 0; i < count; i++) {
        const el = h('div.fx-confetti', { style: { left: `${Math.random() * w}px`, background: colors[i % colors.length] } });
        fxLayer().append(el);
        const drift = (Math.random() - 0.5) * 200;
        const anim = el.animate([
            { transform: 'translate(0, -20px) rotate(0deg)', opacity: 1 },
            { transform: `translate(${drift}px, ${window.innerHeight + 40}px) rotate(${720 * Math.random()}deg)`, opacity: 0.9 },
        ], { duration: 2200 + Math.random() * 1800, delay: Math.random() * 600, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'both' });
        anim.onfinish = () => el.remove();
    }
}

const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

/** A die showing `n` pips. `tone`: '' | 'red' | 'yellow'. */
export function diceFace(n, tone = '') {
    const face = h('div.die-face', { class: tone, 'aria-label': String(n) });
    for (let i = 0; i < 9; i++) face.append(h('span.dot', { class: PIPS[n]?.includes(i) ? 'on' : '' }));
    return face;
}

/** Tumble big dice in the middle of the screen, then shrink them into `target`. */
export function rollDice(values, tones, target, onDone) {
    if (reduced()) {
        if (onDone) onDone();
        return;
    }
    const stage = h('div.fx-dice');
    const dice = values.map((v, i) => {
        const d = diceFace(v, tones[i] || '');
        stage.append(d);
        return d;
    });
    fxLayer().append(stage);
    dice.forEach((d, i) => {
        const dir = i % 2 ? 1 : -1;
        d.animate([
            { transform: `translate(${dir * 220}px, -160px) rotate(${dir * -540}deg) scale(0.6)`, opacity: 0 },
            { transform: `translate(${dir * 40}px, 20px) rotate(${dir * 40}deg) scale(1.15)`, opacity: 1, offset: 0.55 },
            { transform: `translate(${dir * 8}px, -8px) rotate(${dir * -8}deg) scale(1)`, offset: 0.8 },
            { transform: 'translate(0, 0) rotate(0deg) scale(1)', opacity: 1 },
        ], { duration: 850, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'both' });
    });
    const a = centerOf(stage);
    const b = centerOf(target);
    const out = stage.animate([
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
        { transform: b && a ? `translate(calc(-50% + ${b.x - a.x}px), calc(-50% + ${b.y - a.y}px)) scale(0.35)` : 'translate(-50%, -50%) scale(0.5)', opacity: 0 },
    ], { duration: 450, delay: 1250, easing: 'ease-in', fill: 'both' });
    out.onfinish = () => {
        stage.remove();
        if (onDone) onDone();
    };
}

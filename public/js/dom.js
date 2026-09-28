// Tiny DOM helpers. All text goes through text nodes, never innerHTML,
// so user-controlled strings (names, chat, map names) cannot inject markup.

/**
 * Create an element.
 *   h('button.primary', { onclick: fn, disabled: true }, 'Label', child)
 * Attribute keys starting with "on" become event listeners; `class`, `style`,
 * `dataset` are handled specially; everything else is set as an attribute/property.
 */
export function h(spec, attrs, ...children) {
    const [tag, ...classes] = spec.split('.');
    const el = document.createElement(tag || 'div');
    if (classes.length) el.classList.add(...classes);
    if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
        children.unshift(attrs);
        attrs = null;
    }
    if (attrs) {
        for (const [k, v] of Object.entries(attrs)) {
            if (v === undefined || v === null || v === false) continue;
            if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
            else if (k === 'class') el.classList.add(...String(v).split(/\s+/).filter(Boolean));
            else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
            else if (k === 'dataset') Object.assign(el.dataset, v);
            else if (k in el && typeof v !== 'string') el[k] = v;
            else if (v === true) el.setAttribute(k, '');
            else el.setAttribute(k, String(v));
        }
    }
    append(el, children);
    return el;
}

function append(el, children) {
    for (const c of children) {
        if (c === null || c === undefined || c === false) continue;
        if (Array.isArray(c)) append(el, c);
        else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
}

export function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
}

export function $(sel, root = document) {
    return root.querySelector(sel);
}

// ---------------------------------------------------------------- toasts

export function toast(message, kind = 'info', ms = 3500) {
    const box = $('#toasts');
    const el = h('div.toast', { class: kind, role: kind === 'error' ? 'alert' : 'status' }, message);
    box.append(el);
    setTimeout(() => el.classList.add('hide'), ms);
    setTimeout(() => el.remove(), ms + 400);
}

// ---------------------------------------------------------------- modals

let modalStack = [];

/**
 * Open a modal dialog. Returns { el, close }.
 * `content` is a node or array of nodes; `actions` is an array of buttons.
 */
export function modal({ title, content, actions = [], dismissable = true, onClose, wide = false }) {
    const prevFocus = document.activeElement;
    const close = () => {
        overlay.remove();
        modalStack = modalStack.filter((m) => m !== entry);
        document.removeEventListener('keydown', onKey);
        if (prevFocus && prevFocus.focus) prevFocus.focus();
        if (onClose) onClose();
    };
    const onKey = (e) => {
        if (e.key === 'Escape' && dismissable && modalStack[modalStack.length - 1] === entry) close();
    };
    const dialog = h('div.modal', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title, class: wide ? 'wide' : '' },
        h('div.modal-head', h('h2', title), dismissable ? h('button.icon-btn', { onclick: close, 'aria-label': 'Close' }, '✕') : null),
        h('div.modal-body', content),
        actions.length ? h('div.modal-actions', actions) : null,
    );
    const overlay = h('div.overlay', { onclick: (e) => { if (e.target === overlay && dismissable) close(); } }, dialog);
    document.body.append(overlay);
    document.addEventListener('keydown', onKey);
    const entry = { overlay, close };
    modalStack.push(entry);
    const focusable = dialog.querySelector('input, select, button:not(.icon-btn), textarea');
    if (focusable) focusable.focus();
    return { el: dialog, close };
}

export function closeAllModals() {
    for (const m of [...modalStack]) m.close();
}

export function confirmDialog(title, message, okLabel = 'OK') {
    return new Promise((resolve) => {
        let answered = false;
        const m = modal({
            title,
            content: h('p', message),
            actions: [
                h('button.secondary', { onclick: () => { answered = true; m.close(); resolve(false); } }, 'Cancel'),
                h('button.primary', { onclick: () => { answered = true; m.close(); resolve(true); } }, okLabel),
            ],
            onClose: () => { if (!answered) resolve(false); },
        });
    });
}

export function promptDialog(title, label, value = '', maxLength = 40) {
    return new Promise((resolve) => {
        let answered = false;
        const input = h('input', { type: 'text', value, maxLength });
        const submit = () => { answered = true; m.close(); resolve(input.value.trim()); };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
        const m = modal({
            title,
            content: h('label.field', h('span', label), input),
            actions: [
                h('button.secondary', { onclick: () => { answered = true; m.close(); resolve(null); } }, 'Cancel'),
                h('button.primary', { onclick: submit }, 'OK'),
            ],
            onClose: () => { if (!answered) resolve(null); },
        });
        input.select();
    });
}

/** A +/- number stepper. */
export function stepper({ value = 0, min = 0, max = 99, onchange }) {
    let v = value;
    const out = h('span.stepper-value', String(v));
    const set = (n) => {
        v = Math.max(min, Math.min(max, n));
        out.textContent = String(v);
        minus.disabled = v <= min;
        plus.disabled = v >= max;
        if (onchange) onchange(v);
    };
    const minus = h('button.step', { type: 'button', onclick: () => set(v - 1), 'aria-label': 'decrease' }, '−');
    const plus = h('button.step', { type: 'button', onclick: () => set(v + 1), 'aria-label': 'increase' }, '+');
    minus.disabled = v <= min;
    plus.disabled = v >= max;
    const el = h('span.stepper', minus, out, plus);
    return { el, get: () => v, set, setMax(m) { max = m; set(v); } };
}

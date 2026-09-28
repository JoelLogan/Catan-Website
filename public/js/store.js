// Browser storage helpers. Storage can be unavailable (private mode), so every
// access is guarded and failures fall back to in-memory values.
const memory = new Map();

function get(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return memory.get(key) ?? null;
    }
}

function set(key, value) {
    try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
    } catch {
        if (value === null) memory.delete(key);
        else memory.set(key, value);
    }
}

export function getName() {
    return get('catan.name') || '';
}

export function setName(name) {
    set('catan.name', name);
}

/** Secret identifying this browser as the owner of maps it saved. */
export function clientKey() {
    let key = get('catan.clientKey');
    if (!key || !/^[A-Za-z0-9_-]{32,128}$/.test(key)) {
        const bytes = new Uint8Array(32);
        crypto.getRandomValues(bytes);
        key = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        set('catan.clientKey', key);
    }
    return key;
}

export function getSession() {
    try {
        const s = JSON.parse(get('catan.session') || 'null');
        if (s && typeof s.code === 'string' && typeof s.token === 'string') return s;
    } catch {
        // ignore corrupt data
    }
    return null;
}

export function setSession(session) {
    set('catan.session', session ? JSON.stringify(session) : null);
}

export function getPref(key, fallback) {
    const v = get(`catan.pref.${key}`);
    return v === null ? fallback : v;
}

export function setPref(key, value) {
    set(`catan.pref.${key}`, String(value));
}

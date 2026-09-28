// Socket connection wrapper with promise-based requests.
// `io` is the global provided by /socket.io/socket.io.min.js.

const listeners = new Map();
let socket = null;

export function connect() {
    socket = io({ transports: ['websocket', 'polling'], reconnectionDelayMax: 5000 });
    for (const ev of ['connect', 'disconnect', 'room:state', 'room:closed', 'connect_error']) {
        socket.on(ev, (...args) => emitLocal(ev, ...args));
    }
    return socket;
}

function emitLocal(ev, ...args) {
    for (const fn of listeners.get(ev) || []) fn(...args);
}

export function on(ev, fn) {
    if (!listeners.has(ev)) listeners.set(ev, new Set());
    listeners.get(ev).add(fn);
    return () => listeners.get(ev).delete(fn);
}

export function connected() {
    return !!socket && socket.connected;
}

/** Send a request; resolves with the server's response, rejects with an Error carrying a safe message. */
export function request(event, payload = {}, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
        if (!socket || !socket.connected) {
            reject(new Error('Not connected to the server. Retrying…'));
            return;
        }
        socket.timeout(timeoutMs).emit(event, payload, (err, res) => {
            if (err) reject(new Error('The server did not respond. Please try again.'));
            else if (!res || !res.ok) reject(new Error(res?.error || 'Request failed'));
            else resolve(res);
        });
    });
}

/**
 * Token-bucket rate limiter keyed by an arbitrary string.
 * `take(key)` returns true if the event is allowed.
 */
export class RateLimiter {
    constructor({ capacity, refillPerSecond, maxKeys = 50_000 }) {
        this.capacity = capacity;
        this.refill = refillPerSecond;
        this.maxKeys = maxKeys;
        this.buckets = new Map();
    }

    take(key, cost = 1, now = Date.now()) {
        let b = this.buckets.get(key);
        if (!b) {
            if (this.buckets.size >= this.maxKeys) this.prune(now);
            b = { tokens: this.capacity, at: now };
            this.buckets.set(key, b);
        }
        b.tokens = Math.min(this.capacity, b.tokens + ((now - b.at) / 1000) * this.refill);
        b.at = now;
        if (b.tokens < cost) return false;
        b.tokens -= cost;
        return true;
    }

    prune(now = Date.now()) {
        const full = this.capacity / this.refill;
        for (const [k, b] of this.buckets) {
            if ((now - b.at) / 1000 >= full) this.buckets.delete(k);
        }
        // Still too many (e.g. under attack): drop the oldest half.
        if (this.buckets.size >= this.maxKeys) {
            const keys = [...this.buckets.keys()];
            for (const k of keys.slice(0, keys.length / 2)) this.buckets.delete(k);
        }
    }
}

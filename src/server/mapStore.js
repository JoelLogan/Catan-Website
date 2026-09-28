// Persistent store for user-created map templates.
//
// Security properties:
//  * File names are server-generated random ids, never user input.
//  * Templates are fully re-validated (normalizeTemplate) before storage.
//  * Only the creator (holder of the secret client key) can overwrite or delete a map;
//    only a SHA-256 hash of that key is stored.
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { normalizeTemplate, TemplateError, templateStats } from '../../shared/templates.js';
import { LIMITS } from '../../shared/constants.js';
import { JsonDir } from './fileStore.js';

export class MapError extends Error {}

const MAP_ID = /^[a-f0-9]{16}$/;
const CLIENT_KEY = /^[A-Za-z0-9_-]{32,128}$/;

export function cleanName(name, max) {
    if (typeof name !== 'string') return '';
    // Strip control characters and collapse whitespace.
    return name.replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

const hashKey = (key) => createHash('sha256').update(key).digest('hex');

function sameHash(a, b) {
    const x = Buffer.from(a, 'hex');
    const y = Buffer.from(b, 'hex');
    return x.length === y.length && timingSafeEqual(x, y);
}

export class MapStore {
    constructor({ dir, persist = true, maxMaps = 1000, maxPerOwner = 50, logger }) {
        this.store = persist ? new JsonDir(dir) : null;
        this.maxMaps = maxMaps;
        this.maxPerOwner = maxPerOwner;
        this.logger = logger;
        this.maps = new Map(); // id -> {id, name, owner, createdAt, updatedAt, template}
    }

    async init() {
        if (!this.store) return;
        await this.store.init();
        const entries = await this.store.readAll((id, err) => this.logger?.warn('Skipping unreadable map', { id, error: err.message }));
        for (const { id, data } of entries) {
            try {
                if (!MAP_ID.test(id)) continue;
                const template = normalizeTemplate(data.template);
                const name = cleanName(data.name, LIMITS.maxMapNameLength);
                if (!name || typeof data.owner !== 'string') continue;
                this.maps.set(id, { id, name, owner: data.owner, createdAt: data.createdAt, updatedAt: data.updatedAt, template });
            } catch (err) {
                this.logger?.warn('Skipping invalid map', { id, error: err.message });
            }
        }
        this.logger?.info('Loaded saved maps', { count: this.maps.size });
    }

    list(clientKey) {
        const owner = typeof clientKey === 'string' && CLIENT_KEY.test(clientKey) ? hashKey(clientKey) : null;
        return [...this.maps.values()]
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map((m) => ({ id: m.id, name: m.name, updatedAt: m.updatedAt, mine: owner !== null && sameHash(owner, m.owner), ...templateStats(m.template) }));
    }

    get(id) {
        if (typeof id !== 'string' || !MAP_ID.test(id)) return null;
        return this.maps.get(id) || null;
    }

    async save({ id, name, template, clientKey }) {
        if (typeof clientKey !== 'string' || !CLIENT_KEY.test(clientKey)) throw new MapError('Missing client key');
        const cleanedName = cleanName(name, LIMITS.maxMapNameLength);
        if (!cleanedName) throw new MapError('Please enter a map name');
        let normalized;
        try {
            normalized = normalizeTemplate(template);
        } catch (err) {
            if (err instanceof TemplateError) throw new MapError(err.message);
            throw err;
        }
        const owner = hashKey(clientKey);
        const now = Date.now();
        let entry;
        if (id !== undefined && id !== null) {
            entry = this.get(id);
            if (!entry) throw new MapError('Map not found');
            if (!sameHash(entry.owner, owner)) throw new MapError('You can only overwrite maps you created');
            entry = { ...entry, name: cleanedName, template: normalized, updatedAt: now };
        } else {
            if (this.maps.size >= this.maxMaps) throw new MapError('The server has too many saved maps');
            const mine = [...this.maps.values()].filter((m) => sameHash(m.owner, owner)).length;
            if (mine >= this.maxPerOwner) throw new MapError(`You can save at most ${this.maxPerOwner} maps`);
            entry = { id: randomBytes(8).toString('hex'), name: cleanedName, owner, createdAt: now, updatedAt: now, template: normalized };
        }
        if (this.store) await this.store.write(entry.id, entry);
        this.maps.set(entry.id, entry);
        return entry;
    }

    async remove({ id, clientKey }) {
        const entry = this.get(id);
        if (!entry) throw new MapError('Map not found');
        if (typeof clientKey !== 'string' || !CLIENT_KEY.test(clientKey) || !sameHash(entry.owner, hashKey(clientKey))) {
            throw new MapError('You can only delete maps you created');
        }
        if (this.store) await this.store.remove(id);
        this.maps.delete(id);
    }
}

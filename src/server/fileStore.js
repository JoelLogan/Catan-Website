// Small helpers for crash-safe JSON persistence.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function assertSafeId(id) {
    if (typeof id !== 'string' || !SAFE_ID.test(id)) throw new Error('Unsafe file id');
}

/** A directory of `<id>.json` files. Ids are validated so paths cannot escape the directory. */
export class JsonDir {
    constructor(dir) {
        this.dir = dir;
    }

    async init() {
        await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    }

    file(id) {
        assertSafeId(id);
        return path.join(this.dir, `${id}.json`);
    }

    async write(id, data) {
        const target = this.file(id);
        const tmp = `${target}.${randomBytes(6).toString('hex')}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(data), { mode: 0o600 });
        await fs.rename(tmp, target);
    }

    async remove(id) {
        await fs.rm(this.file(id), { force: true });
    }

    /** Read every valid entry; unreadable files are reported through `onError` and skipped. */
    async readAll(onError = () => {}) {
        let names;
        try {
            names = await fs.readdir(this.dir);
        } catch {
            return [];
        }
        const out = [];
        for (const name of names) {
            if (name.endsWith('.tmp')) {
                await fs.rm(path.join(this.dir, name), { force: true });
                continue;
            }
            if (!name.endsWith('.json')) continue;
            const id = name.slice(0, -5);
            if (!SAFE_ID.test(id)) continue;
            try {
                out.push({ id, data: JSON.parse(await fs.readFile(path.join(this.dir, name), 'utf8')) });
            } catch (err) {
                onError(id, err);
            }
        }
        return out;
    }
}

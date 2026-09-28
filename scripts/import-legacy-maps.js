// One-time import of maps saved by the old server (the `saved-maps/` folder).
//
//   node scripts/import-legacy-maps.js [legacyDir]
//
// Maps are converted to the current format and stored in DATA_DIR/maps. They are
// owned by a newly generated key, printed at the end: paste it into the browser
// console as  localStorage.setItem('catan.clientKey', '<key>')  to manage them.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { loadConfig } from '../src/server/config.js';
import { MapStore } from '../src/server/mapStore.js';

const config = loadConfig();
const legacyDir = path.resolve(process.argv[2] || path.join(config.root, 'saved-maps'));
const store = new MapStore({ dir: path.join(config.dataDir, 'maps'), maxMaps: config.maxMaps, maxPerOwner: 10_000 });
await store.init();
const clientKey = randomBytes(32).toString('base64url');

let imported = 0;
for (const file of await fs.readdir(legacyDir).catch(() => [])) {
    if (!file.endsWith('.json')) continue;
    try {
        const template = JSON.parse(await fs.readFile(path.join(legacyDir, file), 'utf8'));
        const entry = await store.save({ name: file.slice(0, -5), template, clientKey });
        console.log(`imported ${file} -> ${entry.id}`);
        imported++;
    } catch (err) {
        console.warn(`skipped ${file}: ${err.message}`);
    }
}
console.log(`\n${imported} map(s) imported from ${legacyDir}.`);
if (imported) console.log(`Owner key: ${clientKey}`);

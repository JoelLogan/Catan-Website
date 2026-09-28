// Browser smoke test: plays a complete game through the real UI against bots.
//
//   CHROMIUM_PATH=/path/to/chrome npm run e2e
//
// Starts an in-process server on a random port, so it needs no other setup.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createServer } from '../src/server/index.js';
import { loadConfig } from '../src/server/config.js';

const executablePath = process.env.CHROMIUM_PATH || undefined;

async function state(page) {
    return page.evaluate(async () => {
        const { app } = await import('/js/main.js');
        const g = app.game?.view?.game;
        if (!g) return null;
        return { kind: g.waiting.kind, mine: g.waiting.players.includes(g.me), phase: g.phase, mode: !!app.game.mode };
    });
}

/** Screen coordinates of a random highlighted target on the board. */
async function target(page) {
    return page.evaluate(async () => {
        const { app } = await import('/js/main.js');
        const b = await import('/js/board.js');
        const gs = app.game;
        const m = gs?.mode;
        if (!m) return null;
        const pick = (a) => a[Math.floor(Math.random() * a.length)];
        let p = null;
        if (m.vertices?.length) p = b.vertexPos(pick(m.vertices));
        else if (m.edges?.length) p = b.edgePos(pick(m.edges));
        else if (m.hexes?.length) p = b.hexPos(gs.game.board.hexes[pick(m.hexes)]);
        if (!p) return null;
        const r = gs.canvas.getBoundingClientRect();
        return { x: r.left + gs.board.offset.x + p.x * gs.board.scale, y: r.top + gs.board.offset.y + p.y * gs.board.scale };
    });
}

async function step(page) {
    const opts = { timeout: 3000 };
    if (await page.$('.overlay')) {
        if (await page.$('.overlay .picker')) {
            for (let i = 0; i < 20 && !(await page.$('.overlay .picker-total.ok')); i++) {
                const plus = await page.$('.overlay .picker .step[aria-label="increase"]:not([disabled])');
                if (!plus) break;
                await plus.click();
            }
            await page.click('.overlay .modal-actions button.primary', opts);
            return;
        }
        const choice = await page.$('.overlay .choice-grid button:not([disabled])');
        if (choice) return choice.click();
        return page.keyboard.press('Escape');
    }
    const st = await state(page);
    if (!st || !st.mine) return page.waitForTimeout(50);
    if (st.mode) {
        const p = await target(page);
        if (p) return page.mouse.click(p.x, p.y);
    }
    if (st.kind === 'preRoll') return page.click('button:has-text("Roll dice")', opts);
    if (st.kind === 'main') return page.click('.action-grid button:has-text("End turn")', opts);
    if (st.kind === 'specialBuild') return page.click('.action-grid button:has-text("Done building")', opts);
    return page.waitForTimeout(50);
}

const srv = await createServer({ ...loadConfig({}), persist: false, logLevel: 'warn', botDelayMs: 20 });
await new Promise((r) => srv.server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${srv.server.address().port}`;
const browser = await chromium.launch({ executablePath });
const errors = [];
try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
        // External fonts may be blocked in CI sandboxes; everything else is an error.
        if (m.type() === 'error' && !/fonts\.g|ERR_CERT|ERR_NAME|ERR_INTERNET/.test(m.text() + (m.location()?.url || ''))) errors.push(m.text());
    });
    await page.goto(url);
    await page.waitForSelector('#conn-status.ok');
    await page.fill('#home-name', 'Smoke');
    await page.click('#create-btn');
    await page.waitForSelector('#screen-lobby.active .code');
    await page.fill('input[data-key="victoryPoints"]', '5');
    await page.dispatchEvent('input[data-key="victoryPoints"]', 'change');
    await page.click('text=Add bot');
    await page.click('text=Add bot');
    await page.click('text=Start game');
    await page.waitForSelector('#screen-game.active canvas');

    const deadline = Date.now() + 240_000;
    while ((await state(page))?.phase !== 'finished') {
        assert.ok(Date.now() < deadline, 'game did not finish in time');
        try {
            await step(page);
        } catch (err) {
            // The UI can change between finding an element and clicking it (e.g. a dialog closes
            // because a bot acted). That is expected; just look again.
            if (!/detached|not attached|Timeout|not visible|intercepts pointer/i.test(err.message)) throw err;
        }
    }
    await page.waitForSelector('.overlay:has-text("Game over")');
    assert.deepEqual(errors, [], `browser errors:\n${errors.join('\n')}`);
    console.log('✓ smoke test passed: a full game was played through the UI');
} finally {
    await browser.close();
    await srv.close();
}

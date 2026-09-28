// Randomized full-game simulations: bots play complete games while invariants
// (card conservation, distance rule, piece limits, no info leaks) are checked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, playOut } from './helpers.js';

const configs = [
    { players: 2, map: 'standard' },
    { players: 3, map: 'standard' },
    { players: 4, map: 'standard' },
    { players: 5, map: 'large' },
    { players: 6, map: 'large' },
    { players: 7, map: 'huge' },
    { players: 8, map: 'huge' },
    { players: 4, map: 'islands', settings: { expansions: { seafarers: true }, victoryPoints: 12 } },
    { players: 3, map: 'standard', settings: { expansions: { seafarers: true } } },
    { players: 3, map: 'standard', settings: { expansions: { citiesKnights: true }, victoryPoints: 13 } },
    { players: 4, map: 'standard', settings: { expansions: { citiesKnights: true }, victoryPoints: 13 } },
    { players: 6, map: 'large', settings: { expansions: { citiesKnights: true }, victoryPoints: 13 } },
    { players: 4, map: 'islands', settings: { expansions: { citiesKnights: true, seafarers: true }, victoryPoints: 14 } },
];

for (const cfg of configs) {
    const exp = cfg.settings?.expansions || {};
    const label = `${cfg.players}p ${cfg.map}${exp.seafarers ? ' seafarers' : ''}${exp.citiesKnights ? ' C&K' : ''}`;
    test(`bots finish games: ${label}`, () => {
        for (let seed = 1; seed <= 6; seed++) {
            const game = newGame({ ...cfg, seed });
            const { steps } = playOut(game);
            assert.equal(game.state.phase, 'finished', `seed ${seed} did not finish after ${steps} steps`);
            const w = game.state.winner;
            assert.ok(game.victoryPoints(w, { includeHidden: true }) >= game.settings.victoryPoints);
        }
    });
}

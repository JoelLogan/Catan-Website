import { h } from './dom.js';
import { COSTS } from '/shared/constants.js';
import { costText } from './labels.js';

export function helpContent() {
    const row = (name, cost, note) => h('tr', h('td', name), h('td', costText(cost)), h('td.muted', note));
    return h('div.help',
        h('h3', 'Getting started'),
        h('ol',
            h('li', 'Enter your name and create a game, or join with a friend’s 6-character code or invite link.'),
            h('li', 'The host picks the map, expansions and rules in the lobby, and can add bots.'),
            h('li', 'Everyone places two settlements and roads in snake order. Your second settlement gives you starting resources.'),
            h('li', 'On your turn: roll, trade, build — then end your turn. First to the target victory points wins!')),
        h('h3', 'Building costs'),
        h('table.costs', h('tbody',
            row('🛣️ Road', COSTS.road, '—'),
            row('🏠 Settlement', COSTS.settlement, '1 VP'),
            row('🏰 City', COSTS.city, '2 VP, doubles production'),
            row('🃏 Development card', COSTS.devCard, 'base game'),
            row('⛵ Ship', COSTS.ship, 'Seafarers'),
            row('🛡️ Knight / promote', COSTS.knight, 'Cities & Knights'),
            row('🔥 Activate knight', COSTS.activateKnight, 'Cities & Knights'),
            row('🧱 City wall', COSTS.cityWall, 'Cities & Knights'))),
        h('h3', 'Good to know'),
        h('ul',
            h('li', 'Rolling a 7: everyone with more than 7 cards discards half, then the roller moves the robber and steals a card.'),
            h('li', 'Longest Road (5+) and Largest Army (3+ knights) are worth 2 VP each.'),
            h('li', 'Trade 4:1 with the bank, or better at harbors (3:1 generic, 2:1 specific).'),
            h('li', 'If you disconnect, just reopen the page — you will rejoin automatically. After a minute away, the game plays safe moves for you.'),
            h('li', 'Board: scroll or pinch to zoom, drag to pan. Highlighted spots are where you can place.')),
    );
}

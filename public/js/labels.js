import { RESOURCE_LABELS, RESOURCE_ICONS, COLOR_HEX } from '/shared/constants.js';
import { h } from './dom.js';

export const DEV_CARDS = {
    knight: { name: 'Knight', icon: '⚔️', text: 'Move the robber and steal a card. Counts toward Largest Army.' },
    victoryPoint: { name: 'Victory Point', icon: '⭐', text: 'Worth 1 victory point. Revealed when the game ends.' },
    roadBuilding: { name: 'Road Building', icon: '🛣️', text: 'Build 2 roads (or ships) for free.' },
    yearOfPlenty: { name: 'Year of Plenty', icon: '🌾', text: 'Take any 2 resources from the bank.' },
    monopoly: { name: 'Monopoly', icon: '💰', text: 'Name a resource; every player gives you all of theirs.' },
};

export const PROGRESS = {
    alchemist: ['Alchemist', 'Before rolling: choose the results of both production dice.'],
    crane: ['Crane', 'Your next city improvement this turn costs 1 fewer commodity.'],
    engineer: ['Engineer', 'Build a city wall for free.'],
    inventor: ['Inventor', 'Swap two number tokens (not 2, 12, 6 or 8).'],
    irrigation: ['Irrigation', 'Take 2 grain for each fields tile next to your buildings.'],
    medicine: ['Medicine', 'Upgrade a settlement to a city for 2 ore and 1 grain.'],
    mining: ['Mining', 'Take 2 ore for each mountains tile next to your buildings.'],
    printer: ['Printer', '+1 victory point.'],
    roadBuilding: ['Road Building', 'Build 2 roads (or ships) for free.'],
    smith: ['Smith', 'Promote up to 2 knights for free.'],
    commercialHarbor: ['Commercial Harbor', 'Offer each opponent a resource; they must give you a commodity for it.'],
    masterMerchant: ['Master Merchant', 'Look at the hand of a player with more VP and take 2 cards.'],
    merchant: ['Merchant', 'Place the merchant next to your building: 2:1 trades for that resource and +1 VP.'],
    merchantFleet: ['Merchant Fleet', 'This turn, trade one resource or commodity 2:1 with the bank.'],
    resourceMonopoly: ['Resource Monopoly', 'Name a resource; each opponent gives you up to 2.'],
    tradeMonopoly: ['Trade Monopoly', 'Name a commodity; each opponent gives you 1.'],
    bishop: ['Bishop', 'Move the robber and steal 1 card from every player next to it.'],
    constitution: ['Constitution', '+1 victory point.'],
    deserter: ['Deserter', 'An opponent removes one of their knights; you gain one of equal strength.'],
    diplomat: ['Diplomat', 'Remove an open road. If it is yours, you may place it elsewhere.'],
    intrigue: ['Intrigue', 'Displace an opposing knight on your road network.'],
    saboteur: ['Saboteur', 'Players with at least as many VP as you discard half their cards.'],
    spy: ['Spy', 'Look at an opponent’s progress cards and take one.'],
    warlord: ['Warlord', 'Activate all of your knights for free.'],
    wedding: ['Wedding', 'Each player with more VP gives you 2 cards of their choice.'],
};

export const TRACK_LABELS = {
    trade: { name: 'Trade', icon: '🧵', color: '#e8c547', ability: 'Trading House: trade commodities 2:1' },
    politics: { name: 'Politics', icon: '🪙', color: '#4a7fd4', ability: 'Fortress: promote knights to mighty' },
    science: { name: 'Science', icon: '📜', color: '#4caf50', ability: 'Aqueduct: take a resource when you produce nothing' },
};

export const resName = (r) => RESOURCE_LABELS[r] || r;
export const resIcon = (r) => RESOURCE_ICONS[r] || '';

export function resChip(r, n) {
    return h('span.res-chip', { class: `res-${r}`, title: resName(r) }, `${resIcon(r)} ${n !== undefined ? n : resName(r)}`);
}

export function cardsText(cards) {
    const parts = Object.entries(cards || {}).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${resIcon(k)} ${resName(k)}`);
    return parts.join(', ') || 'nothing';
}

export function swatch(color) {
    return h('span.swatch', { style: { background: COLOR_HEX[color] || '#999' }, 'aria-hidden': 'true' });
}

export function costText(cost) {
    return Object.entries(cost).map(([k, n]) => `${n}${resIcon(k)}`).join(' ');
}

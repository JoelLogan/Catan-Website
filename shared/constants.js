// Game constants shared by the server engine and the browser client.
// This file must stay free of Node-only APIs because it is served to browsers.

export const RESOURCES = Object.freeze(['wood', 'brick', 'sheep', 'wheat', 'ore']);
export const COMMODITIES = Object.freeze(['paper', 'cloth', 'coin']);
export const ALL_CARDS = Object.freeze([...RESOURCES, ...COMMODITIES]);

// Terrain -> resource produced.
export const TERRAIN_RESOURCE = Object.freeze({
    forest: 'wood',
    hills: 'brick',
    pasture: 'sheep',
    fields: 'wheat',
    mountains: 'ore',
});

// Cities & Knights: commodity a city produces on a given terrain.
export const TERRAIN_COMMODITY = Object.freeze({
    forest: 'paper',
    pasture: 'cloth',
    mountains: 'coin',
});

export const LAND_TERRAINS = Object.freeze(['forest', 'hills', 'pasture', 'fields', 'mountains', 'desert', 'gold']);
export const PRODUCING_TERRAINS = Object.freeze(['forest', 'hills', 'pasture', 'fields', 'mountains', 'gold']);

// Map-template tile types (what the map builder can paint).
// "land" is a placeholder that is randomized into a terrain when the game starts.
export const TEMPLATE_TILE_TYPES = Object.freeze(['sea', 'land', ...LAND_TERRAINS]);

export const PORT_TYPES = Object.freeze(['3:1', ...RESOURCES]);

export const COSTS = Object.freeze({
    road: Object.freeze({ wood: 1, brick: 1 }),
    ship: Object.freeze({ wood: 1, sheep: 1 }),
    settlement: Object.freeze({ wood: 1, brick: 1, sheep: 1, wheat: 1 }),
    city: Object.freeze({ wheat: 2, ore: 3 }),
    devCard: Object.freeze({ sheep: 1, wheat: 1, ore: 1 }),
    // Cities & Knights
    knight: Object.freeze({ sheep: 1, ore: 1 }),
    promoteKnight: Object.freeze({ sheep: 1, ore: 1 }),
    activateKnight: Object.freeze({ wheat: 1 }),
    cityWall: Object.freeze({ brick: 2 }),
});

export const DEV_CARD_TYPES = Object.freeze(['knight', 'victoryPoint', 'roadBuilding', 'yearOfPlenty', 'monopoly']);

export const PLAYER_COLORS = Object.freeze([
    'red', 'blue', 'orange', 'white', 'green', 'brown', 'purple', 'teal',
]);

export const COLOR_HEX = Object.freeze({
    red: '#d64545',
    blue: '#3b6fd6',
    orange: '#f08c2e',
    white: '#f4f1e8',
    green: '#3f9a4d',
    brown: '#8a5a33',
    purple: '#8e5cc4',
    teal: '#2aa3a0',
});

export const LIMITS = Object.freeze({
    minPlayers: 2,
    maxPlayers: 8,
    minVictoryPoints: 3,
    maxVictoryPoints: 30,
    maxNameLength: 20,
    maxMapNameLength: 40,
    maxTemplateHexes: 400,
    maxTemplateRadius: 20,
    maxPiecesPerType: 30,
    maxTradeAmount: 20,
    maxLogEntries: 200,
    maxChatLength: 200,
});

export const CK = Object.freeze({
    tracks: Object.freeze(['trade', 'politics', 'science']),
    trackCommodity: Object.freeze({ trade: 'cloth', politics: 'coin', science: 'paper' }),
    // Event-die gate colors map to tracks.
    maxLevel: 5,
    metropolisLevel: 4,
    barbarianTrackLength: 7,
    maxCityWalls: 3,
    knightsPerLevel: 2,
    progressHandLimit: 4,
});

export const DEFAULT_PIECES = Object.freeze({
    settlements: 5,
    cities: 4,
    roads: 15,
    ships: 15,
});

export const RESOURCE_LABELS = Object.freeze({
    wood: 'Lumber',
    brick: 'Brick',
    sheep: 'Wool',
    wheat: 'Grain',
    ore: 'Ore',
    paper: 'Paper',
    cloth: 'Cloth',
    coin: 'Coin',
});

export const RESOURCE_ICONS = Object.freeze({
    wood: '🌲',
    brick: '🧱',
    sheep: '🐑',
    wheat: '🌾',
    ore: '⛰️',
    paper: '📜',
    cloth: '🧵',
    coin: '🪙',
});

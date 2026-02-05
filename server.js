const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs').promises;

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;
const MAPS_DIR = path.join(__dirname, 'saved-maps');

// Serve static files
app.use(express.static(__dirname));
app.use('/public', express.static(path.join(__dirname, 'public')));

// Game state storage
const games = new Map(); // gameCode -> gameState
const players = new Map(); // socketId -> { gameCode, playerName }
const savedMaps = new Map(); // mapName -> mapData

// Ensure maps directory exists
async function ensureMapsDirectory() {
    try {
        await fs.mkdir(MAPS_DIR, { recursive: true });
    } catch (error) {
        console.error('Error creating maps directory:', error);
    }
}

// Load all saved maps from disk on startup
async function loadMapsFromDisk() {
    try {
        await ensureMapsDirectory();
        const files = await fs.readdir(MAPS_DIR);
        for (const file of files) {
            if (file.endsWith('.json')) {
                const mapName = file.replace('.json', '');
                const filePath = path.join(MAPS_DIR, file);
                const data = await fs.readFile(filePath, 'utf8');
                const mapData = JSON.parse(data);
                savedMaps.set(mapName, mapData);
                console.log(`Loaded map: ${mapName}`);
            }
        }
        console.log(`Loaded ${savedMaps.size} maps from disk`);
    } catch (error) {
        console.error('Error loading maps from disk:', error);
    }
}

// Save a map to disk
async function saveMapToDisk(mapName, mapData) {
    try {
        await ensureMapsDirectory();
        const filePath = path.join(MAPS_DIR, `${mapName}.json`);
        await fs.writeFile(filePath, JSON.stringify(mapData, null, 2), 'utf8');
        console.log(`Saved map to disk: ${mapName}`);
    } catch (error) {
        console.error(`Error saving map ${mapName} to disk:`, error);
        throw error;
    }
}

// Initialize maps on startup
loadMapsFromDisk();

// ===== GAME LOGIC =====

function generateGameCode() {
    let code;
    do {
        code = Math.floor(100000 + Math.random() * 900000).toString();
    } while (games.has(code));
    return code;
}

function getAvailableColor(game) {
    const colors = ['red', 'blue', 'green', 'yellow', 'orange', 'purple', 'white', 'brown'];
    const usedColors = game.players.map(p => p.color);
    return colors.find(c => !usedColors.includes(c)) || colors[0];
}

function randomizeMap(mapTemplate) {
    // Resource types for standard Catan
    const resourceTypes = [
        'wood', 'wood', 'wood', 'wood',
        'brick', 'brick', 'brick',
        'sheep', 'sheep', 'sheep', 'sheep',
        'wheat', 'wheat', 'wheat', 'wheat',
        'ore', 'ore', 'ore',
        'desert'
    ];

    const numbers = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

    // Better shuffling for even distribution
    const shuffleArray = (array) => {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    };

    // Shuffle multiple times to ensure better distribution
    let bestResources = shuffleArray(resourceTypes);
    let bestNumbers = shuffleArray(numbers);
    let bestScore = Infinity;

    // Try multiple shuffles and pick the one with best distribution
    for (let attempt = 0; attempt < 10; attempt++) {
        const shuffledResources = shuffleArray(resourceTypes);
        const shuffledNumbers = shuffleArray(numbers);
        
        // Calculate clustering score (lower is better)
        let score = 0;
        const landTiles = mapTemplate.tiles.filter(t => t.type === 'land-placeholder');
        
        for (let i = 0; i < landTiles.length - 1; i++) {
            const tile1 = landTiles[i];
            const resource1 = shuffledResources[i];
            
            for (let j = i + 1; j < landTiles.length; j++) {
                const tile2 = landTiles[j];
                const resource2 = shuffledResources[j];
                
                // Check if tiles are adjacent
                const dx = Math.abs(tile1.x - tile2.x);
                const dy = Math.abs(tile1.y - tile2.y);
                const isAdjacent = (dx <= 1 && dy <= 1 && (dx + dy) <= 2);
                
                // Penalize same resource types being adjacent
                if (isAdjacent && resource1 === resource2) {
                    score += 10;
                }
            }
        }
        
        if (score < bestScore) {
            bestScore = score;
            bestResources = shuffledResources;
            bestNumbers = shuffledNumbers;
        }
    }

    const randomizedTiles = [];
    let resourceIndex = 0;
    let numberIndex = 0;

    mapTemplate.tiles.forEach(tile => {
        if (tile.type === 'land-placeholder') {
            const resource = bestResources[resourceIndex++];
            randomizedTiles.push({
                ...tile,
                type: resource,
                number: resource === 'desert' ? null : bestNumbers[numberIndex++]
            });
        } else {
            randomizedTiles.push({ ...tile });
        }
    });

    return {
        tiles: randomizedTiles,
        ports: mapTemplate.ports || []
    };
}

function initializeDevelopmentCards() {
    const cards = [];
    for (let i = 0; i < 14; i++) cards.push('knight');
    for (let i = 0; i < 5; i++) cards.push('victory-point');
    for (let i = 0; i < 2; i++) cards.push('road-building');
    for (let i = 0; i < 2; i++) cards.push('year-of-plenty');
    for (let i = 0; i < 2; i++) cards.push('monopoly');

    // Shuffle
    for (let i = cards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cards[i], cards[j]] = [cards[j], cards[i]];
    }

    return cards;
}

function createGame(hostName, settings, mapTemplate) {
    const gameCode = generateGameCode();
    
    const game = {
        code: gameCode,
        host: hostName,
        players: [{
            name: hostName,
            color: 'red',
            isHost: true,
            socketId: null,
            resources: { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 },
            developmentCards: [],
            victoryPoints: 0,
            settlements: [],
            cities: [],
            roads: [],
            ships: [],
            knights: 0,
            longestRoad: false,
            largestArmy: false,
            maxPieces: settings.gamePieces
        }],
        settings,
        mapTemplate,
        board: null,
        currentPlayerIndex: 0,
        phase: 'lobby',
        started: false,
        developmentCards: [],
        bank: {
            wood: 19,
            brick: 19,
            sheep: 19,
            wheat: 19,
            ore: 19
        }
    };

    games.set(gameCode, game);
    return game;
}

// ===== SOCKET.IO HANDLERS =====

io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    socket.on('createGame', ({ playerName, settings, mapTemplate }) => {
        try {
            const game = createGame(playerName, settings, mapTemplate);
            game.players[0].socketId = socket.id;
            players.set(socket.id, { gameCode: game.code, playerName });
            
            socket.join(game.code);
            socket.emit('gameCreated', { 
                gameCode: game.code,
                game: sanitizeGameForClient(game, playerName)
            });
            
            io.to(game.code).emit('lobbyUpdate', sanitizeGameForClient(game));
            console.log(`Game created: ${game.code} by ${playerName}`);
        } catch (error) {
            console.error('Error creating game:', error);
            socket.emit('error', { message: 'Failed to create game' });
        }
    });

    socket.on('joinGame', ({ playerName, gameCode }) => {
        try {
            const game = games.get(gameCode);
            
            if (!game) {
                socket.emit('error', { message: 'Game not found' });
                return;
            }

            if (game.started) {
                socket.emit('error', { message: 'Game already started' });
                return;
            }

            if (game.players.length >= game.settings.maxPlayers) {
                socket.emit('error', { message: 'Game is full' });
                return;
            }

            const newPlayer = {
                name: playerName,
                color: getAvailableColor(game),
                isHost: false,
                socketId: socket.id,
                resources: { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 },
                developmentCards: [],
                victoryPoints: 0,
                settlements: [],
                cities: [],
                roads: [],
                ships: [],
                knights: 0,
                longestRoad: false,
                largestArmy: false,
                maxPieces: game.settings.gamePieces
            };

            game.players.push(newPlayer);
            players.set(socket.id, { gameCode, playerName });
            
            socket.join(gameCode);
            socket.emit('gameJoined', { 
                gameCode,
                game: sanitizeGameForClient(game, playerName)
            });
            
            io.to(gameCode).emit('lobbyUpdate', sanitizeGameForClient(game));
            console.log(`${playerName} joined game ${gameCode}`);
        } catch (error) {
            console.error('Error joining game:', error);
            socket.emit('error', { message: 'Failed to join game' });
        }
    });

    socket.on('rejoinGame', ({ playerName, gameCode }) => {
        try {
            const game = games.get(gameCode);
            
            if (!game) {
                socket.emit('reconnectFailed', { message: 'Game not found' });
                return;
            }

            // Find the player in the game
            const player = game.players.find(p => p.name === playerName);
            
            if (!player) {
                socket.emit('reconnectFailed', { message: 'Player not in this game' });
                return;
            }

            // Update player's socket ID and mark as connected
            player.socketId = socket.id;
            player.disconnected = false;
            players.set(socket.id, { gameCode, playerName });
            
            socket.join(gameCode);
            socket.emit('reconnected', { 
                gameCode,
                game: sanitizeGameForClient(game, playerName)
            });
            
            // Notify other players
            io.to(gameCode).emit('playerReconnected', {
                playerName,
                game: sanitizeGameForClient(game)
            });
            
            console.log(`${playerName} reconnected to game ${gameCode}`);
        } catch (error) {
            console.error('Error rejoining game:', error);
            socket.emit('reconnectFailed', { message: 'Failed to rejoin game' });
        }
    });

    socket.on('startGame', ({ gameCode }) => {
        try {
            const game = games.get(gameCode);
            const playerInfo = players.get(socket.id);

            if (!game || !playerInfo) {
                socket.emit('error', { message: 'Game not found' });
                return;
            }

            const player = game.players.find(p => p.name === playerInfo.playerName);
            if (!player || !player.isHost) {
                socket.emit('error', { message: 'Only host can start game' });
                return;
            }

            if (game.players.length < 1) {
                socket.emit('error', { message: 'Need at least 1 player' });
                return;
            }

            // Randomize the map
            game.board = randomizeMap(game.mapTemplate);
            game.developmentCards = initializeDevelopmentCards();
            game.started = true;
            game.phase = 'initial-placement';
            game.setupPhase = {
                round: 1, // Round 1 or 2
                placementType: 'settlement', // 'settlement' or 'road'
                placementsThisRound: 0,
                totalPlayers: game.players.length
            };

            io.to(gameCode).emit('gameStarted', sanitizeGameForClient(game));
            console.log(`Game ${gameCode} started`);
        } catch (error) {
            console.error('Error starting game:', error);
            socket.emit('error', { message: 'Failed to start game' });
        }
    });

    socket.on('placeInitial', ({ gameCode, type, location }) => {
        try {
            const game = games.get(gameCode);
            const playerInfo = players.get(socket.id);

            if (!game || !playerInfo) return;

            const player = game.players.find(p => p.name === playerInfo.playerName);
            const currentPlayer = game.players[game.currentPlayerIndex];

            if (currentPlayer.name !== playerInfo.playerName) {
                socket.emit('error', { message: 'Not your turn' });
                return;
            }

            if (game.phase !== 'initial-placement') {
                socket.emit('error', { message: 'Not in initial placement phase' });
                return;
            }

            // Validate and place the structure
            if (type === 'settlement') {
                const validation = validateSettlementPlacement(game, player, location.vertex, true);
                if (!validation.valid) {
                    socket.emit('error', { message: validation.reason });
                    return;
                }
                
                player.settlements.push(location);
                player.victoryPoints++;
                game.setupPhase.placementType = 'road';
                
                // Give resources for second settlement in round 2
                if (game.setupPhase.round === 2) {
                    distributeInitialResources(game, player, location);
                }
            } else if (type === 'road') {
                const validation = validateRoadPlacement(game, player, location.edge, true);
                if (!validation.valid) {
                    socket.emit('error', { message: validation.reason });
                    return;
                }
                
                player.roads.push(location);
                
                // Move to next player or next phase
                game.setupPhase.placementsThisRound++;
                
                if (game.setupPhase.round === 1) {
                    // First round: move to next player (no resources)
                    if (game.setupPhase.placementsThisRound < game.players.length) {
                        game.currentPlayerIndex++;
                        game.setupPhase.placementType = 'settlement';
                    } else {
                        // Start round 2 in reverse order (no resources yet - wait for settlement)
                        game.setupPhase.round = 2;
                        game.setupPhase.placementsThisRound = 0;
                        game.setupPhase.placementType = 'settlement';
                        // currentPlayerIndex stays at last player
                    }
                } else if (game.setupPhase.round === 2) {
                    // Second round: move backwards
                    // IMPORTANT: Resources were already given when the settlement was placed
                    // Not when the road is placed!
                    if (game.setupPhase.placementsThisRound < game.players.length) {
                        game.currentPlayerIndex--;
                        game.setupPhase.placementType = 'settlement';
                    } else {
                        // Setup complete, start normal game
                        game.phase = 'roll';
                        game.currentPlayerIndex = 0;
                        delete game.setupPhase;
                    }
                }
            }

            io.to(gameCode).emit('initialPlaced', {
                player: playerInfo.playerName,
                type,
                location,
                game: sanitizeGameForClient(game)
            });
        } catch (error) {
            console.error('Error placing initial:', error);
            socket.emit('error', { message: 'Failed to place' });
        }
    });

    socket.on('rollDice', ({ gameCode }) => {
        try {
            const game = games.get(gameCode);
            const playerInfo = players.get(socket.id);

            if (!game || !playerInfo) return;

            const currentPlayer = game.players[game.currentPlayerIndex];
            if (currentPlayer.name !== playerInfo.playerName) {
                socket.emit('error', { message: 'Not your turn' });
                return;
            }

            if (game.phase !== 'roll') {
                socket.emit('error', { message: 'Cannot roll now' });
                return;
            }

            const die1 = Math.floor(Math.random() * 6) + 1;
            const die2 = Math.floor(Math.random() * 6) + 1;
            const total = die1 + die2;

            if (total === 7) {
                game.phase = 'robber';
            } else {
                distributeResources(game, total);
                game.phase = 'build';
            }

            io.to(gameCode).emit('diceRolled', {
                die1, die2, total,
                game: sanitizeGameForClient(game)
            });
        } catch (error) {
            console.error('Error rolling dice:', error);
        }
    });

    socket.on('buildStructure', ({ gameCode, type, location }) => {
        try {
            const game = games.get(gameCode);
            const playerInfo = players.get(socket.id);

            if (!game || !playerInfo) return;

            const player = game.players.find(p => p.name === playerInfo.playerName);
            const currentPlayer = game.players[game.currentPlayerIndex];

            if (currentPlayer.name !== playerInfo.playerName) {
                socket.emit('error', { message: 'Not your turn' });
                return;
            }

            const result = buildStructure(game, player, type, location);
            if (result.success) {
                io.to(gameCode).emit('structureBuilt', {
                    player: playerInfo.playerName,
                    type,
                    location,
                    game: sanitizeGameForClient(game)
                });

                checkVictory(game, gameCode);
            } else {
                socket.emit('error', { message: result.reason || 'Cannot build there' });
            }
        } catch (error) {
            console.error('Error building structure:', error);
            socket.emit('error', { message: 'Failed to build structure' });
        }
    });

    socket.on('proposeTrade', ({ gameCode, trade }) => {
        try {
            const game = games.get(gameCode);
            if (!game) return;

            io.to(gameCode).emit('tradeProposed', {
                from: players.get(socket.id).playerName,
                trade
            });
        } catch (error) {
            console.error('Error proposing trade:', error);
        }
    });

    socket.on('acceptTrade', ({ gameCode, tradeId }) => {
        try {
            const game = games.get(gameCode);
            const playerInfo = players.get(socket.id);
            
            if (!game || !playerInfo) return;

            // Execute trade logic here
            io.to(gameCode).emit('tradeAccepted', {
                acceptedBy: playerInfo.playerName,
                game: sanitizeGameForClient(game)
            });
        } catch (error) {
            console.error('Error accepting trade:', error);
        }
    });

    socket.on('endTurn', ({ gameCode }) => {
        try {
            const game = games.get(gameCode);
            const playerInfo = players.get(socket.id);

            if (!game || !playerInfo) return;

            const currentPlayer = game.players[game.currentPlayerIndex];
            if (currentPlayer.name !== playerInfo.playerName) {
                socket.emit('error', { message: 'Not your turn' });
                return;
            }

            game.currentPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
            game.phase = 'roll';

            io.to(gameCode).emit('turnEnded', {
                nextPlayer: game.players[game.currentPlayerIndex].name,
                game: sanitizeGameForClient(game)
            });
        } catch (error) {
            console.error('Error ending turn:', error);
        }
    });

    socket.on('saveMap', async ({ mapName, mapData }) => {
        try {
            savedMaps.set(mapName, mapData);
            await saveMapToDisk(mapName, mapData);
            socket.emit('mapSaved', { mapName });
            console.log(`Map saved: ${mapName}`);
        } catch (error) {
            console.error('Error saving map:', error);
            socket.emit('error', { message: 'Failed to save map' });
        }
    });

    socket.on('loadMaps', () => {
        try {
            const maps = Array.from(savedMaps.entries()).map(([name, data]) => ({
                name, data
            }));
            socket.emit('mapsLoaded', { maps });
        } catch (error) {
            console.error('Error loading maps:', error);
        }
    });

    socket.on('loadCustomMap', ({ mapName }) => {
        try {
            const mapData = savedMaps.get(mapName);
            if (mapData) {
                socket.emit('customMapLoaded', { mapData });
            } else {
                socket.emit('error', { message: 'Map not found' });
            }
        } catch (error) {
            console.error('Error loading custom map:', error);
            socket.emit('error', { message: 'Failed to load map' });
        }
    });

    socket.on('disconnect', () => {
        const playerInfo = players.get(socket.id);
        if (playerInfo) {
            const game = games.get(playerInfo.gameCode);
            if (game) {
                // Mark player as disconnected instead of removing them
                const player = game.players.find(p => p.socketId === socket.id);
                if (player) {
                    player.disconnected = true;
                    player.socketId = null; // Clear socket ID
                    console.log(`Player ${playerInfo.playerName} disconnected from game ${playerInfo.gameCode}`);
                    
                    io.to(playerInfo.gameCode).emit('playerDisconnected', {
                        playerName: playerInfo.playerName,
                        game: sanitizeGameForClient(game)
                    });
                }
                
                // Only delete game if all players are disconnected for a long time
                // For now, keep the game alive
            }
            players.delete(socket.id);
        }
        console.log('Client disconnected:', socket.id);
    });
});

// ===== HELPER FUNCTIONS =====

function distributeInitialResources(game, player, settlementLocation) {
    // Give resources from tiles adjacent to the settlement
    game.board.tiles.forEach(tile => {
        if (tile.type !== 'water' && tile.type !== 'desert' && isVertexOnTile(settlementLocation.vertex, tile)) {
            if (player.resources[tile.type] !== undefined) {
                player.resources[tile.type]++;
                if (game.bank[tile.type] > 0) {
                    game.bank[tile.type]--;
                }
            }
        }
    });
}

function sanitizeGameForClient(game, playerName) {
    // Remove sensitive data, only send what client needs
    const sanitized = {
        code: game.code,
        host: game.host,
        players: game.players.map(p => ({
            name: p.name,
            color: p.color,
            isHost: p.isHost,
            victoryPoints: p.victoryPoints,
            resourceCount: Object.values(p.resources).reduce((a, b) => a + b, 0),
            devCardCount: p.developmentCards.length,
            settlements: p.settlements,
            cities: p.cities,
            roads: p.roads,
            ships: p.ships,
            knights: p.knights,
            longestRoad: p.longestRoad,
            largestArmy: p.largestArmy
        })),
        settings: game.settings,
        board: game.board,
        currentPlayerIndex: game.currentPlayerIndex,
        phase: game.phase,
        started: game.started,
        setupPhase: game.setupPhase
    };

    // If playerName provided, include their full data
    if (playerName) {
        const player = game.players.find(p => p.name === playerName);
        if (player) {
            sanitized.localPlayer = {
                resources: player.resources,
                developmentCards: player.developmentCards
            };
        }
    }

    return sanitized;
}

function distributeResources(game, number) {
    game.board.tiles.forEach(tile => {
        if (tile.number === number && tile.type !== 'desert' && tile.type !== 'water') {
            game.players.forEach(player => {
                player.settlements.forEach(settlement => {
                    if (isVertexOnTile(settlement.vertex, tile)) {
                        player.resources[tile.type]++;
                        game.bank[tile.type]--;
                    }
                });
                player.cities.forEach(city => {
                    if (isVertexOnTile(city.vertex, tile)) {
                        player.resources[tile.type] += 2;
                        game.bank[tile.type] -= 2;
                    }
                });
            });
        }
    });
}

function isVertexOnTile(vertex, tile) {
    const distance = Math.sqrt(
        Math.pow(vertex.x - tile.x, 2) + Math.pow(vertex.y - tile.y, 2)
    );
    return distance < 1.5;
}

// Get all vertices that are exactly 1 edge away from a given vertex
function getAdjacentVertices(vertex) {
    const adjacent = [];
    // In axial coordinates, adjacent vertices are at these offsets
    const offsets = [
        { x: 1, y: 0 }, { x: -1, y: 0 },
        { x: 0, y: 1 }, { x: 0, y: -1 },
        { x: 1, y: -1 }, { x: -1, y: 1 }
    ];
    
    offsets.forEach(offset => {
        adjacent.push({
            x: vertex.x + offset.x,
            y: vertex.y + offset.y
        });
    });
    
    return adjacent;
}

// Check if two vertices are exactly 1 edge apart
function areVerticesAdjacent(v1, v2) {
    const dx = Math.abs(v1.x - v2.x);
    const dy = Math.abs(v1.y - v2.y);
    const dist = Math.sqrt(dx * dx + dy * dy);
    return dist < 1.5 && dist > 0.1; // Adjacent vertices are ~1 unit apart
}

// Validate settlement placement according to Catan rules
function validateSettlementPlacement(game, player, vertex, isInitialPlacement = false) {
    // Check distance rule: no settlements within 2 edges
    for (const p of game.players) {
        for (const settlement of p.settlements) {
            const dist = Math.sqrt(
                Math.pow(settlement.vertex.x - vertex.x, 2) + 
                Math.pow(settlement.vertex.y - vertex.y, 2)
            );
            // Settlements must be at least 2 edges apart (distance > 1.5)
            if (dist < 1.6) {
                return { valid: false, reason: 'Too close to another settlement (must be 2+ edges away)' };
            }
        }
        
        // Check cities too
        for (const city of p.cities) {
            const dist = Math.sqrt(
                Math.pow(city.vertex.x - vertex.x, 2) + 
                Math.pow(city.vertex.y - vertex.y, 2)
            );
            if (dist < 1.6) {
                return { valid: false, reason: 'Too close to a city' };
            }
        }
    }
    
    // During normal play, settlement must connect to a road
    if (!isInitialPlacement) {
        let hasConnectedRoad = false;
        for (const road of player.roads) {
            if (areVerticesAdjacent(road.edge.start, vertex) || 
                areVerticesAdjacent(road.edge.end, vertex)) {
                hasConnectedRoad = true;
                break;
            }
        }
        if (!hasConnectedRoad) {
            return { valid: false, reason: 'Settlement must connect to your road' };
        }
    }
    
    // Check vertex is on the board (at least one tile adjacent)
    let onBoard = false;
    for (const tile of game.board.tiles) {
        if (isVertexOnTile(vertex, tile)) {
            onBoard = true;
            break;
        }
    }
    if (!onBoard) {
        return { valid: false, reason: 'Invalid location' };
    }
    
    return { valid: true };
}

// Validate road placement
function validateRoadPlacement(game, player, edge, isInitialPlacement = false) {
    // Check if road already exists at this location
    for (const p of game.players) {
        for (const road of p.roads) {
            if (edgesMatch(road.edge, edge)) {
                return { valid: false, reason: 'Road already exists here' };
            }
        }
    }
    
    if (isInitialPlacement) {
        // During setup, road must connect to the most recently placed settlement
        if (player.settlements.length === 0) {
            return { valid: false, reason: 'Place settlement first' };
        }
        const lastSettlement = player.settlements[player.settlements.length - 1];
        if (!areVerticesAdjacent(edge.start, lastSettlement.vertex) && 
            !areVerticesAdjacent(edge.end, lastSettlement.vertex)) {
            return { valid: false, reason: 'Road must connect to your settlement' };
        }
    } else {
        // During normal play, road must connect to player's existing road or settlement
        let hasConnection = false;
        
        // Check connection to settlements
        for (const settlement of player.settlements) {
            if (areVerticesAdjacent(edge.start, settlement.vertex) || 
                areVerticesAdjacent(edge.end, settlement.vertex)) {
                hasConnection = true;
                break;
            }
        }
        
        // Check connection to cities
        if (!hasConnection) {
            for (const city of player.cities) {
                if (areVerticesAdjacent(edge.start, city.vertex) || 
                    areVerticesAdjacent(edge.end, city.vertex)) {
                    hasConnection = true;
                    break;
                }
            }
        }
        
        // Check connection to roads
        if (!hasConnection) {
            for (const road of player.roads) {
                // Roads connect when they share a vertex (same location, not adjacent)
                const dist1 = Math.sqrt(
                    Math.pow(road.edge.start.x - edge.start.x, 2) + 
                    Math.pow(road.edge.start.y - edge.start.y, 2)
                );
                const dist2 = Math.sqrt(
                    Math.pow(road.edge.start.x - edge.end.x, 2) + 
                    Math.pow(road.edge.start.y - edge.end.y, 2)
                );
                const dist3 = Math.sqrt(
                    Math.pow(road.edge.end.x - edge.start.x, 2) + 
                    Math.pow(road.edge.end.y - edge.start.y, 2)
                );
                const dist4 = Math.sqrt(
                    Math.pow(road.edge.end.x - edge.end.x, 2) + 
                    Math.pow(road.edge.end.y - edge.end.y, 2)
                );
                
                if (dist1 < 0.1 || dist2 < 0.1 || dist3 < 0.1 || dist4 < 0.1) {
                    hasConnection = true;
                    break;
                }
            }
        }
        
        if (!hasConnection) {
            return { valid: false, reason: 'Road must connect to your network' };
        }
    }
    
    return { valid: true };
}

function edgesMatch(edge1, edge2) {
    const e1s = edge1.start, e1e = edge1.end;
    const e2s = edge2.start, e2e = edge2.end;
    
    const dist = (v1, v2) => Math.sqrt(Math.pow(v1.x - v2.x, 2) + Math.pow(v1.y - v2.y, 2));
    
    return (dist(e1s, e2s) < 0.1 && dist(e1e, e2e) < 0.1) ||
           (dist(e1s, e2e) < 0.1 && dist(e1e, e2s) < 0.1);
}

function buildStructure(game, player, type, location) {
    const costs = {
        settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1 },
        city: { wheat: 2, ore: 3 },
        road: { wood: 1, brick: 1 },
        ship: { wood: 1, sheep: 1 }
    };

    const cost = costs[type];
    if (!cost) return { success: false, reason: 'Invalid structure type' };

    // Check if player has resources
    for (const [resource, amount] of Object.entries(cost)) {
        if (player.resources[resource] < amount) {
            return { success: false, reason: `Not enough ${resource}` };
        }
    }

    // Validate placement
    if (type === 'settlement') {
        const validation = validateSettlementPlacement(game, player, location.vertex, false);
        if (!validation.valid) {
            return { success: false, reason: validation.reason };
        }
    } else if (type === 'city') {
        // Check if there's a settlement at this location
        const settlementIndex = player.settlements.findIndex(
            s => Math.abs(s.vertex.x - location.vertex.x) < 0.5 && 
                 Math.abs(s.vertex.y - location.vertex.y) < 0.5
        );
        if (settlementIndex < 0) {
            return { success: false, reason: 'No settlement to upgrade' };
        }
    } else if (type === 'road') {
        const validation = validateRoadPlacement(game, player, location.edge, false);
        if (!validation.valid) {
            return { success: false, reason: validation.reason };
        }
    } else if (type === 'ship') {
        // Similar validation for ships (on water edges)
        const validation = validateRoadPlacement(game, player, location.edge, false);
        if (!validation.valid) {
            return { success: false, reason: validation.reason };
        }
    }

    // Deduct resources
    for (const [resource, amount] of Object.entries(cost)) {
        player.resources[resource] -= amount;
        game.bank[resource] += amount;
    }

    // Add structure
    if (type === 'settlement') {
        player.settlements.push(location);
        player.victoryPoints++;
    } else if (type === 'city') {
        const settlementIndex = player.settlements.findIndex(
            s => Math.abs(s.vertex.x - location.vertex.x) < 0.5 && 
                 Math.abs(s.vertex.y - location.vertex.y) < 0.5
        );
        player.settlements.splice(settlementIndex, 1);
        player.cities.push(location);
        player.victoryPoints++;
    } else if (type === 'road') {
        player.roads.push(location);
    } else if (type === 'ship') {
        player.ships.push(location);
    }

    return { success: true };
}

function checkVictory(game, gameCode) {
    const winner = game.players.find(p => p.victoryPoints >= game.settings.victoryPoints);
    if (winner) {
        io.to(gameCode).emit('gameWon', {
            winner: winner.name,
            game: sanitizeGameForClient(game)
        });
    }
}

// Start server
server.listen(PORT, () => {
    console.log(`🏝️  Catan server running on port ${PORT}`);
    console.log(`Visit http://localhost:${PORT}`);
});

// ===== GAME STATE =====
let gameState = {
    currentScreen: 'main-menu',
    gameCode: null,
    isHost: false,
    localPlayer: null,
    lobby: {
        players: [],
        maxPlayers: 4,
        settings: {
            victoryPoints: 10,
            expansions: {
                seafarers: false,
                citiesKnights: false
            },
            gamePieces: {
                settlements: 5,
                cities: 4,
                roads: 15,
                ships: 15,
                knights: 3
            }
        },
        map: null
    },
    game: {
        players: [],
        currentPlayerIndex: 0,
        phase: 'setup', // setup, roll, build, trade
        board: {
            tiles: [],
            vertices: [],
            edges: []
        },
        bank: {
            wood: 19,
            brick: 19,
            sheep: 19,
            wheat: 19,
            ore: 19
        },
        developmentCards: []
    },
    buildMode: null,
    selectedTile: 'wood',
    selectedNumber: 6,
    savedMaps: []
};

// ===== UTILITY FUNCTIONS =====
function generateGameCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById(screenId).classList.add('active');
    gameState.currentScreen = screenId;
}

function showMessage(text, duration = 3000) {
    const messageBox = document.getElementById('message-box');
    messageBox.textContent = text;
    messageBox.classList.add('show');
    setTimeout(() => {
        messageBox.classList.remove('show');
    }, duration);
}

// ===== MAIN MENU FUNCTIONS =====
function createGame() {
    const hostName = document.getElementById('host-name').value.trim();
    if (!hostName) {
        showMessage('Please enter your name');
        return;
    }

    const maxPlayers = parseInt(document.getElementById('max-players').value);
    const victoryPoints = parseInt(document.getElementById('victory-points').value);
    const seafarers = document.getElementById('expansion-seafarers').checked;
    const citiesKnights = document.getElementById('expansion-cities-knights').checked;
    
    const pieces = {
        settlements: parseInt(document.getElementById('pieces-settlements').value),
        cities: parseInt(document.getElementById('pieces-cities').value),
        roads: parseInt(document.getElementById('pieces-roads').value),
        ships: parseInt(document.getElementById('pieces-ships').value),
        knights: parseInt(document.getElementById('pieces-knights').value)
    };

    gameState.gameCode = generateGameCode();
    gameState.isHost = true;
    gameState.localPlayer = {
        name: hostName,
        color: 'red',
        isHost: true
    };
    
    gameState.lobby.maxPlayers = maxPlayers;
    gameState.lobby.settings.victoryPoints = victoryPoints;
    gameState.lobby.settings.expansions = { seafarers, citiesKnights };
    gameState.lobby.settings.gamePieces = pieces;
    gameState.lobby.players = [gameState.localPlayer];

    // Select or generate map
    const mapSelect = document.getElementById('map-select').value;
    if (mapSelect === 'random') {
        gameState.lobby.map = generateRandomMap();
    } else {
        gameState.lobby.map = generateDefaultMap();
    }

    showLobby();
    showMessage('Game created! Share code: ' + gameState.gameCode);
}

function joinGame() {
    const playerName = document.getElementById('join-name').value.trim();
    const gameCode = document.getElementById('game-code').value.trim();
    
    if (!playerName) {
        showMessage('Please enter your name');
        return;
    }
    
    if (!gameCode || gameCode.length !== 6) {
        showMessage('Please enter a valid 6-digit game code');
        return;
    }

    // In a real implementation, this would connect to a server
    // For this demo, we'll simulate joining
    gameState.gameCode = gameCode;
    gameState.isHost = false;
    gameState.localPlayer = {
        name: playerName,
        color: getAvailableColor(),
        isHost: false
    };

    // Simulate joining (in real app, this would be server-side)
    if (gameState.lobby.players.length === 0) {
        showMessage('Game not found');
        return;
    }

    gameState.lobby.players.push(gameState.localPlayer);
    showLobby();
    showMessage('Joined game!');
}

function getAvailableColor() {
    const colors = ['red', 'blue', 'green', 'yellow', 'orange', 'purple', 'white', 'brown'];
    const usedColors = gameState.lobby.players.map(p => p.color);
    return colors.find(c => !usedColors.includes(c)) || colors[0];
}

// ===== LOBBY FUNCTIONS =====
function showLobby() {
    showScreen('lobby');
    updateLobbyDisplay();
}

function updateLobbyDisplay() {
    document.getElementById('lobby-code').textContent = gameState.gameCode;
    document.getElementById('lobby-host').textContent = 
        gameState.lobby.players.find(p => p.isHost)?.name || 'Host';
    document.getElementById('player-count').textContent = gameState.lobby.players.length;
    document.getElementById('max-player-count').textContent = gameState.lobby.maxPlayers;

    const playersContainer = document.getElementById('players-container');
    playersContainer.innerHTML = '';
    gameState.lobby.players.forEach(player => {
        const playerDiv = document.createElement('div');
        playerDiv.className = 'player-item' + (player.isHost ? ' host' : '');
        playerDiv.innerHTML = `
            <span style="color: ${player.color}">${player.name}</span>
            ${player.isHost ? '<span>(Host)</span>' : ''}
        `;
        playersContainer.appendChild(playerDiv);
    });

    if (gameState.isHost) {
        document.getElementById('host-controls').style.display = 'block';
    }
}

function leaveLobby() {
    gameState.lobby.players = gameState.lobby.players.filter(
        p => p.name !== gameState.localPlayer.name
    );
    showScreen('main-menu');
}

function startGame() {
    if (gameState.lobby.players.length < 2) {
        showMessage('Need at least 2 players to start');
        return;
    }

    initializeGame();
    showScreen('game-screen');
    showMessage('Game started!');
}

// ===== GAME INITIALIZATION =====
function initializeGame() {
    // Initialize players with resources and pieces
    gameState.game.players = gameState.lobby.players.map((player, index) => ({
        ...player,
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
        maxPieces: { ...gameState.lobby.settings.gamePieces }
    }));

    // Set up the board
    gameState.game.board = gameState.lobby.map || generateDefaultMap();
    
    // Initialize development cards
    initializeDevelopmentCards();
    
    // Set current player
    gameState.game.currentPlayerIndex = 0;
    gameState.game.phase = 'setup';

    // Draw the game board
    drawGameBoard();
    updateGameDisplay();

    // Show ships button if seafarers is enabled
    if (gameState.lobby.settings.expansions.seafarers) {
        document.getElementById('build-ship-btn').style.display = 'block';
    }
}

function initializeDevelopmentCards() {
    const cards = [];
    // Knights
    for (let i = 0; i < 14; i++) cards.push('knight');
    // Victory Points
    for (let i = 0; i < 5; i++) cards.push('victory-point');
    // Road Building
    for (let i = 0; i < 2; i++) cards.push('road-building');
    // Year of Plenty
    for (let i = 0; i < 2; i++) cards.push('year-of-plenty');
    // Monopoly
    for (let i = 0; i < 2; i++) cards.push('monopoly');

    // Shuffle
    for (let i = cards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cards[i], cards[j]] = [cards[j], cards[i]];
    }

    gameState.game.developmentCards = cards;
}

// ===== MAP GENERATION =====
function generateDefaultMap() {
    const tiles = [
        // Standard Catan layout
        { type: 'ore', number: 10, x: 0, y: 0 },
        { type: 'sheep', number: 2, x: 1, y: 0 },
        { type: 'wood', number: 9, x: 2, y: 0 },
        { type: 'wheat', number: 12, x: -1, y: 1 },
        { type: 'brick', number: 6, x: 0, y: 1 },
        { type: 'sheep', number: 4, x: 1, y: 1 },
        { type: 'brick', number: 10, x: 2, y: 1 },
        { type: 'wheat', number: 9, x: -2, y: 2 },
        { type: 'wood', number: 11, x: -1, y: 2 },
        { type: 'desert', number: null, x: 0, y: 2 },
        { type: 'wood', number: 3, x: 1, y: 2 },
        { type: 'ore', number: 8, x: 2, y: 2 },
        { type: 'wood', number: 8, x: -1, y: 3 },
        { type: 'ore', number: 3, x: 0, y: 3 },
        { type: 'wheat', number: 4, x: 1, y: 3 },
        { type: 'sheep', number: 5, x: 2, y: 3 },
        { type: 'brick', number: 5, x: 0, y: 4 },
        { type: 'wheat', number: 6, x: 1, y: 4 },
        { type: 'sheep', number: 11, x: 2, y: 4 }
    ];

    return { tiles, ports: generatePorts() };
}

function generateRandomMap() {
    const resourceTypes = [
        'wood', 'wood', 'wood', 'wood',
        'brick', 'brick', 'brick',
        'sheep', 'sheep', 'sheep', 'sheep',
        'wheat', 'wheat', 'wheat', 'wheat',
        'ore', 'ore', 'ore',
        'desert'
    ];

    const numbers = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

    // Shuffle
    for (let i = resourceTypes.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [resourceTypes[i], resourceTypes[j]] = [resourceTypes[j], resourceTypes[i]];
    }
    for (let i = numbers.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
    }

    const tiles = [];
    const positions = [
        { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
        { x: -1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 },
        { x: -2, y: 2 }, { x: -1, y: 2 }, { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 },
        { x: -1, y: 3 }, { x: 0, y: 3 }, { x: 1, y: 3 }, { x: 2, y: 3 },
        { x: 0, y: 4 }, { x: 1, y: 4 }, { x: 2, y: 4 }
    ];

    let numberIndex = 0;
    positions.forEach((pos, i) => {
        const type = resourceTypes[i];
        tiles.push({
            type,
            number: type === 'desert' ? null : numbers[numberIndex++],
            ...pos
        });
    });

    return { tiles, ports: generatePorts() };
}

function generatePorts() {
    return [
        { type: '3:1', position: 0 },
        { type: '3:1', position: 1 },
        { type: '3:1', position: 2 },
        { type: '3:1', position: 3 },
        { type: 'wood', position: 4 },
        { type: 'brick', position: 5 },
        { type: 'sheep', position: 6 },
        { type: 'wheat', position: 7 },
        { type: 'ore', position: 8 }
    ];
}

// ===== GAME BOARD RENDERING =====
function drawGameBoard() {
    const canvas = document.getElementById('game-canvas');
    const ctx = canvas.getContext('2d');
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const hexSize = 50;
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    // Draw tiles
    if (gameState.game.board.tiles) {
        gameState.game.board.tiles.forEach(tile => {
            drawHexTile(ctx, tile, hexSize, centerX, centerY);
        });
    }

    // Draw settlements and cities
    gameState.game.players.forEach(player => {
        player.settlements.forEach(settlement => {
            drawSettlement(ctx, settlement.vertex, player.color, centerX, centerY, hexSize);
        });
        player.cities.forEach(city => {
            drawCity(ctx, city.vertex, player.color, centerX, centerY, hexSize);
        });
        player.roads.forEach(road => {
            drawRoad(ctx, road.edge, player.color, centerX, centerY, hexSize);
        });
        if (gameState.lobby.settings.expansions.seafarers) {
            player.ships.forEach(ship => {
                drawShip(ctx, ship.edge, player.color, centerX, centerY, hexSize);
            });
        }
    });
}

function drawHexTile(ctx, tile, size, centerX, centerY) {
    const pos = hexToPixel(tile.x, tile.y, size);
    const x = centerX + pos.x;
    const y = centerY + pos.y;

    // Draw hexagon
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i;
        const hx = x + size * Math.cos(angle);
        const hy = y + size * Math.sin(angle);
        if (i === 0) ctx.moveTo(hx, hy);
        else ctx.lineTo(hx, hy);
    }
    ctx.closePath();

    // Fill with resource color
    ctx.fillStyle = getTileColor(tile.type);
    ctx.fill();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw number token
    if (tile.number) {
        ctx.fillStyle = tile.number === 6 || tile.number === 8 ? '#ff0000' : '#ffffff';
        ctx.beginPath();
        ctx.arc(x, y, 20, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = '#000';
        ctx.font = 'bold 18px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(tile.number.toString(), x, y);
    }

    // Draw robber on desert
    if (tile.type === 'desert') {
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.arc(x, y, 15, 0, Math.PI * 2);
        ctx.fill();
    }
}

function getTileColor(type) {
    const colors = {
        wood: '#228B22',
        brick: '#CD5C5C',
        sheep: '#90EE90',
        wheat: '#FFD700',
        ore: '#696969',
        desert: '#F4A460',
        water: '#4682B4',
        gold: '#FFD700'
    };
    return colors[type] || '#888';
}

function hexToPixel(q, r, size) {
    const x = size * (3/2 * q);
    const y = size * (Math.sqrt(3)/2 * q + Math.sqrt(3) * r);
    return { x, y };
}

function drawSettlement(ctx, vertex, color, centerX, centerY, hexSize) {
    const pos = vertexToPixel(vertex, hexSize);
    const x = centerX + pos.x;
    const y = centerY + pos.y;

    ctx.fillStyle = color;
    ctx.fillRect(x - 8, y - 8, 16, 16);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.strokeRect(x - 8, y - 8, 16, 16);
}

function drawCity(ctx, vertex, color, centerX, centerY, hexSize) {
    const pos = vertexToPixel(vertex, hexSize);
    const x = centerX + pos.x;
    const y = centerY + pos.y;

    ctx.fillStyle = color;
    ctx.fillRect(x - 10, y - 10, 20, 20);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.strokeRect(x - 10, y - 10, 20, 20);
    
    // Draw tower
    ctx.fillStyle = color;
    ctx.fillRect(x - 5, y - 15, 10, 10);
    ctx.strokeRect(x - 5, y - 15, 10, 10);
}

function drawRoad(ctx, edge, color, centerX, centerY, hexSize) {
    const start = vertexToPixel(edge.start, hexSize);
    const end = vertexToPixel(edge.end, hexSize);

    ctx.strokeStyle = color;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(centerX + start.x, centerY + start.y);
    ctx.lineTo(centerX + end.x, centerY + end.y);
    ctx.stroke();
}

function drawShip(ctx, edge, color, centerX, centerY, hexSize) {
    const start = vertexToPixel(edge.start, hexSize);
    const end = vertexToPixel(edge.end, hexSize);
    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(centerX + midX - 10, centerY + midY);
    ctx.lineTo(centerX + midX + 10, centerY + midY);
    ctx.lineTo(centerX + midX, centerY + midY - 15);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.stroke();
}

function vertexToPixel(vertex, hexSize) {
    // Simplified vertex calculation
    return { x: vertex.x * hexSize, y: vertex.y * hexSize };
}

// ===== GAME DISPLAY UPDATE =====
function updateGameDisplay() {
    const currentPlayer = gameState.game.players[gameState.game.currentPlayerIndex];
    document.getElementById('current-turn-player').textContent = currentPlayer.name;
    document.getElementById('game-phase').textContent = gameState.game.phase;

    // Update players list
    const playersContainer = document.getElementById('game-players');
    playersContainer.innerHTML = '';
    gameState.game.players.forEach((player, index) => {
        const playerDiv = document.createElement('div');
        playerDiv.className = 'game-player-item' + 
            (index === gameState.game.currentPlayerIndex ? ' active' : '');
        playerDiv.innerHTML = `
            <div class="player-info">
                <span style="color: ${player.color}">${player.name}</span>
                <span>VP: ${player.victoryPoints}</span>
            </div>
            <div style="font-size: 12px; color: #666;">
                Resources: ${Object.values(player.resources).reduce((a, b) => a + b, 0)}
            </div>
        `;
        playersContainer.appendChild(playerDiv);
    });

    // Update local player resources
    const localPlayerData = gameState.game.players.find(
        p => p.name === gameState.localPlayer.name
    );
    if (localPlayerData) {
        document.getElementById('wood-count').textContent = localPlayerData.resources.wood;
        document.getElementById('brick-count').textContent = localPlayerData.resources.brick;
        document.getElementById('sheep-count').textContent = localPlayerData.resources.sheep;
        document.getElementById('wheat-count').textContent = localPlayerData.resources.wheat;
        document.getElementById('ore-count').textContent = localPlayerData.resources.ore;

        // Update development cards
        const devCardsContainer = document.getElementById('dev-cards-container');
        devCardsContainer.innerHTML = '';
        localPlayerData.developmentCards.forEach((card, index) => {
            const cardDiv = document.createElement('div');
            cardDiv.className = 'dev-card';
            cardDiv.textContent = card.replace('-', ' ').toUpperCase();
            cardDiv.onclick = () => playDevelopmentCard(index);
            devCardsContainer.appendChild(cardDiv);
        });
    }

    // Update action buttons based on phase
    updateActionButtons();
}

function updateActionButtons() {
    const isCurrentPlayer = gameState.game.players[gameState.game.currentPlayerIndex].name === 
        gameState.localPlayer.name;

    document.getElementById('roll-dice-btn').disabled = 
        !isCurrentPlayer || gameState.game.phase !== 'roll';
    document.getElementById('end-turn-btn').disabled = 
        !isCurrentPlayer || gameState.game.phase === 'roll';
    document.getElementById('build-settlement-btn').disabled = !isCurrentPlayer;
    document.getElementById('build-city-btn').disabled = !isCurrentPlayer;
    document.getElementById('build-road-btn').disabled = !isCurrentPlayer;
    document.getElementById('build-ship-btn').disabled = !isCurrentPlayer;
    document.getElementById('trade-btn').disabled = !isCurrentPlayer;
    document.getElementById('dev-card-btn').disabled = !isCurrentPlayer;
}

// ===== GAME ACTIONS =====
function rollDice() {
    const die1 = Math.floor(Math.random() * 6) + 1;
    const die2 = Math.floor(Math.random() * 6) + 1;
    const total = die1 + die2;

    document.getElementById('dice1').textContent = die1;
    document.getElementById('dice2').textContent = die2;
    document.getElementById('dice-display').style.display = 'flex';

    setTimeout(() => {
        document.getElementById('dice-display').style.display = 'none';
    }, 3000);

    if (total === 7) {
        handleRobber();
    } else {
        distributeResources(total);
    }

    gameState.game.phase = 'build';
    updateGameDisplay();
    showMessage(`Rolled ${total}!`);
}

function distributeResources(number) {
    gameState.game.board.tiles.forEach(tile => {
        if (tile.number === number && tile.type !== 'desert') {
            // Find settlements and cities on this tile's vertices
            gameState.game.players.forEach(player => {
                player.settlements.forEach(settlement => {
                    if (isVertexOnTile(settlement.vertex, tile)) {
                        player.resources[tile.type]++;
                        gameState.game.bank[tile.type]--;
                    }
                });
                player.cities.forEach(city => {
                    if (isVertexOnTile(city.vertex, tile)) {
                        player.resources[tile.type] += 2;
                        gameState.game.bank[tile.type] -= 2;
                    }
                });
            });
        }
    });
    updateGameDisplay();
}

function isVertexOnTile(vertex, tile) {
    // Simplified check - in real implementation, would check hex geometry
    const distance = Math.sqrt(
        Math.pow(vertex.x - tile.x, 2) + Math.pow(vertex.y - tile.y, 2)
    );
    return distance < 1.5;
}

function handleRobber() {
    showMessage('7 rolled! Robber activated - discard half your cards if you have >7');
    // In full implementation, would handle discarding and moving robber
}

function endTurn() {
    gameState.game.currentPlayerIndex = 
        (gameState.game.currentPlayerIndex + 1) % gameState.game.players.length;
    gameState.game.phase = 'roll';
    updateGameDisplay();
    showMessage("Next player's turn");
}

function startBuildMode(type) {
    gameState.buildMode = type;
    showMessage(`Click on the board to place ${type}`);
    
    const canvas = document.getElementById('game-canvas');
    canvas.onclick = handleBoardClick;
}

function handleBoardClick(event) {
    if (!gameState.buildMode) return;

    const canvas = event.target;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const currentPlayer = gameState.game.players[gameState.game.currentPlayerIndex];

    // Simplified building logic
    if (gameState.buildMode === 'settlement') {
        if (canAffordSettlement(currentPlayer)) {
            const vertex = { x: (x - 450) / 50, y: (y - 350) / 50 };
            currentPlayer.settlements.push({ vertex });
            deductResources(currentPlayer, { wood: 1, brick: 1, sheep: 1, wheat: 1 });
            currentPlayer.victoryPoints++;
            showMessage('Settlement built!');
        } else {
            showMessage('Not enough resources!');
        }
    } else if (gameState.buildMode === 'city') {
        if (canAffordCity(currentPlayer)) {
            const vertex = { x: (x - 450) / 50, y: (y - 350) / 50 };
            // Find and remove settlement, add city
            const settlementIndex = currentPlayer.settlements.findIndex(
                s => Math.abs(s.vertex.x - vertex.x) < 0.5 && Math.abs(s.vertex.y - vertex.y) < 0.5
            );
            if (settlementIndex >= 0) {
                currentPlayer.settlements.splice(settlementIndex, 1);
                currentPlayer.cities.push({ vertex });
                deductResources(currentPlayer, { wheat: 2, ore: 3 });
                currentPlayer.victoryPoints++;
                showMessage('City built!');
            } else {
                showMessage('Must upgrade a settlement!');
            }
        } else {
            showMessage('Not enough resources!');
        }
    } else if (gameState.buildMode === 'road') {
        if (canAffordRoad(currentPlayer)) {
            const edge = { 
                start: { x: (x - 450) / 50, y: (y - 350) / 50 },
                end: { x: (x - 450) / 50 + 1, y: (y - 350) / 50 }
            };
            currentPlayer.roads.push({ edge });
            deductResources(currentPlayer, { wood: 1, brick: 1 });
            showMessage('Road built!');
        } else {
            showMessage('Not enough resources!');
        }
    } else if (gameState.buildMode === 'ship') {
        if (canAffordShip(currentPlayer)) {
            const edge = { 
                start: { x: (x - 450) / 50, y: (y - 350) / 50 },
                end: { x: (x - 450) / 50 + 1, y: (y - 350) / 50 }
            };
            currentPlayer.ships.push({ edge });
            deductResources(currentPlayer, { wood: 1, sheep: 1 });
            showMessage('Ship built!');
        } else {
            showMessage('Not enough resources!');
        }
    }

    gameState.buildMode = null;
    canvas.onclick = null;
    drawGameBoard();
    updateGameDisplay();
    checkVictory();
}

function canAffordSettlement(player) {
    return player.resources.wood >= 1 && player.resources.brick >= 1 &&
           player.resources.sheep >= 1 && player.resources.wheat >= 1;
}

function canAffordCity(player) {
    return player.resources.wheat >= 2 && player.resources.ore >= 3;
}

function canAffordRoad(player) {
    return player.resources.wood >= 1 && player.resources.brick >= 1;
}

function canAffordShip(player) {
    return player.resources.wood >= 1 && player.resources.sheep >= 1;
}

function deductResources(player, costs) {
    Object.entries(costs).forEach(([resource, amount]) => {
        player.resources[resource] -= amount;
        gameState.game.bank[resource] += amount;
    });
}

function buyDevelopmentCard() {
    const currentPlayer = gameState.game.players[gameState.game.currentPlayerIndex];
    
    if (currentPlayer.resources.sheep >= 1 && 
        currentPlayer.resources.wheat >= 1 && 
        currentPlayer.resources.ore >= 1) {
        
        if (gameState.game.developmentCards.length > 0) {
            const card = gameState.game.developmentCards.pop();
            currentPlayer.developmentCards.push(card);
            deductResources(currentPlayer, { sheep: 1, wheat: 1, ore: 1 });
            showMessage('Development card purchased!');
            updateGameDisplay();
        } else {
            showMessage('No more development cards!');
        }
    } else {
        showMessage('Not enough resources! Need: 1 sheep, 1 wheat, 1 ore');
    }
}

function playDevelopmentCard(index) {
    const currentPlayer = gameState.game.players[gameState.game.currentPlayerIndex];
    const card = currentPlayer.developmentCards[index];
    
    switch(card) {
        case 'knight':
            showMessage('Knight played! Move the robber');
            currentPlayer.knights++;
            break;
        case 'victory-point':
            currentPlayer.victoryPoints++;
            showMessage('Victory Point revealed!');
            break;
        case 'road-building':
            showMessage('Road Building! Build 2 free roads');
            break;
        case 'year-of-plenty':
            showMessage('Year of Plenty! Take 2 resources from the bank');
            break;
        case 'monopoly':
            showMessage('Monopoly! Take all of one resource from other players');
            break;
    }
    
    currentPlayer.developmentCards.splice(index, 1);
    updateGameDisplay();
    checkVictory();
}

function checkVictory() {
    const currentPlayer = gameState.game.players[gameState.game.currentPlayerIndex];
    if (currentPlayer.victoryPoints >= gameState.lobby.settings.victoryPoints) {
        showMessage(`${currentPlayer.name} wins the game!`);
        setTimeout(() => {
            showScreen('main-menu');
        }, 3000);
    }
}

// ===== TRADING FUNCTIONS =====
function openTradeDialog() {
    document.getElementById('trade-dialog').style.display = 'flex';
    initializeTradeDialog();
}

function closeTradeDialog() {
    document.getElementById('trade-dialog').style.display = 'none';
}

function initializeTradeDialog() {
    const currentPlayer = gameState.game.players[gameState.game.currentPlayerIndex];
    const resources = ['wood', 'brick', 'sheep', 'wheat', 'ore'];

    // Initialize give resources
    const giveContainer = document.getElementById('give-resources');
    giveContainer.innerHTML = '';
    resources.forEach(resource => {
        const div = document.createElement('div');
        div.className = 'resource-selector-item';
        div.innerHTML = `
            <label>${resource.charAt(0).toUpperCase() + resource.slice(1)}:</label>
            <input type="number" id="give-${resource}" min="0" max="${currentPlayer.resources[resource]}" value="0">
        `;
        giveContainer.appendChild(div);
    });

    // Initialize receive resources
    const receiveContainer = document.getElementById('receive-resources');
    receiveContainer.innerHTML = '';
    resources.forEach(resource => {
        const div = document.createElement('div');
        div.className = 'resource-selector-item';
        div.innerHTML = `
            <label>${resource.charAt(0).toUpperCase() + resource.slice(1)}:</label>
            <input type="number" id="receive-${resource}" min="0" value="0">
        `;
        receiveContainer.appendChild(div);
    });

    // Initialize player select
    const playerSelect = document.getElementById('trade-player-select');
    playerSelect.innerHTML = '';
    gameState.game.players.forEach((player, index) => {
        if (index !== gameState.game.currentPlayerIndex) {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = player.name;
            playerSelect.appendChild(option);
        }
    });

    // Initialize bank trade
    const bankGiveSelect = document.getElementById('bank-give-resource');
    const bankReceiveSelect = document.getElementById('bank-receive-resource');
    bankGiveSelect.innerHTML = '';
    bankReceiveSelect.innerHTML = '';
    resources.forEach(resource => {
        const option1 = document.createElement('option');
        option1.value = resource;
        option1.textContent = resource.charAt(0).toUpperCase() + resource.slice(1);
        bankGiveSelect.appendChild(option1);

        const option2 = document.createElement('option');
        option2.value = resource;
        option2.textContent = resource.charAt(0).toUpperCase() + resource.slice(1);
        bankReceiveSelect.appendChild(option2);
    });
}

function switchTradeTab(tab, event) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.trade-tab-content').forEach(content => content.classList.remove('active'));
    
    event.target.classList.add('active');
    document.getElementById(`${tab}-trade-tab`).classList.add('active');
}

function proposeTrade() {
    const resources = ['wood', 'brick', 'sheep', 'wheat', 'ore'];
    const give = {};
    const receive = {};
    
    resources.forEach(resource => {
        give[resource] = parseInt(document.getElementById(`give-${resource}`).value) || 0;
        receive[resource] = parseInt(document.getElementById(`receive-${resource}`).value) || 0;
    });

    const targetPlayerIndex = parseInt(document.getElementById('trade-player-select').value);
    
    // In real implementation, would send to other player
    showMessage('Trade proposed!');
    closeTradeDialog();
}

function executeBankTrade() {
    const currentPlayer = gameState.game.players[gameState.game.currentPlayerIndex];
    const giveResource = document.getElementById('bank-give-resource').value;
    const receiveResource = document.getElementById('bank-receive-resource').value;
    
    if (currentPlayer.resources[giveResource] >= 4) {
        currentPlayer.resources[giveResource] -= 4;
        currentPlayer.resources[receiveResource] += 1;
        showMessage('Bank trade completed!');
        updateGameDisplay();
        closeTradeDialog();
    } else {
        showMessage('Not enough resources!');
    }
}

function acceptTrade() {
    showMessage('Trade accepted!');
    document.getElementById('trade-proposal-dialog').style.display = 'none';
}

function declineTrade() {
    showMessage('Trade declined');
    document.getElementById('trade-proposal-dialog').style.display = 'none';
}

// ===== MAP BUILDER =====
function selectTile(type) {
    gameState.selectedTile = type;
    showMessage(`Selected: ${type}`);
}

function selectNumber(number) {
    gameState.selectedNumber = number;
    showMessage(`Selected number: ${number}`);
}

function saveMap() {
    const mapName = prompt('Enter map name:');
    if (mapName) {
        const map = {
            name: mapName,
            data: gameState.lobby.map || generateDefaultMap()
        };
        gameState.savedMaps.push(map);
        localStorage.setItem('catanMaps', JSON.stringify(gameState.savedMaps));
        showMessage('Map saved!');
    }
}

function loadMap() {
    const savedMapsJson = localStorage.getItem('catanMaps');
    if (savedMapsJson) {
        gameState.savedMaps = JSON.parse(savedMapsJson);
        if (gameState.savedMaps.length > 0) {
            const mapNames = gameState.savedMaps.map(m => m.name).join(', ');
            const mapName = prompt(`Available maps: ${mapNames}\n\nEnter map name to load:`);
            const map = gameState.savedMaps.find(m => m.name === mapName);
            if (map) {
                gameState.lobby.map = map.data;
                drawMapBuilder();
                showMessage('Map loaded!');
            } else {
                showMessage('Map not found!');
            }
        } else {
            showMessage('No saved maps!');
        }
    } else {
        showMessage('No saved maps!');
    }
}

function clearMap() {
    gameState.lobby.map = { tiles: [], ports: [] };
    drawMapBuilder();
    showMessage('Map cleared!');
}

function randomizeMap() {
    gameState.lobby.map = generateRandomMap();
    drawMapBuilder();
    showMessage('Map randomized!');
}

function drawMapBuilder() {
    const canvas = document.getElementById('builder-canvas');
    const ctx = canvas.getContext('2d');
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const hexSize = 40;
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    // Draw grid positions
    const positions = [
        { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
        { x: -1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 },
        { x: -2, y: 2 }, { x: -1, y: 2 }, { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 },
        { x: -1, y: 3 }, { x: 0, y: 3 }, { x: 1, y: 3 }, { x: 2, y: 3 },
        { x: 0, y: 4 }, { x: 1, y: 4 }, { x: 2, y: 4 }
    ];

    positions.forEach(pos => {
        const existingTile = gameState.lobby.map?.tiles?.find(
            t => t.x === pos.x && t.y === pos.y
        );
        const tile = existingTile || { type: 'water', number: null, ...pos };
        drawHexTile(ctx, tile, hexSize, centerX, centerY);
    });

    // Add click handler for builder
    canvas.onclick = handleBuilderClick;
}

function handleBuilderClick(event) {
    const canvas = event.target;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Convert pixel to hex coordinates (simplified)
    const hexSize = 40;
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    const relX = x - centerX;
    const relY = y - centerY;

    // Find closest hex
    const positions = [
        { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
        { x: -1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 },
        { x: -2, y: 2 }, { x: -1, y: 2 }, { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 },
        { x: -1, y: 3 }, { x: 0, y: 3 }, { x: 1, y: 3 }, { x: 2, y: 3 },
        { x: 0, y: 4 }, { x: 1, y: 4 }, { x: 2, y: 4 }
    ];

    let closestPos = null;
    let minDist = Infinity;

    positions.forEach(pos => {
        const pixelPos = hexToPixel(pos.x, pos.y, hexSize);
        const dist = Math.sqrt(
            Math.pow(relX - pixelPos.x, 2) + Math.pow(relY - pixelPos.y, 2)
        );
        if (dist < minDist) {
            minDist = dist;
            closestPos = pos;
        }
    });

    if (closestPos && minDist < hexSize) {
        if (!gameState.lobby.map) gameState.lobby.map = { tiles: [], ports: [] };
        
        const existingIndex = gameState.lobby.map.tiles.findIndex(
            t => t.x === closestPos.x && t.y === closestPos.y
        );

        const newTile = {
            type: gameState.selectedTile,
            number: gameState.selectedTile === 'desert' ? null : gameState.selectedNumber,
            ...closestPos
        };

        if (existingIndex >= 0) {
            gameState.lobby.map.tiles[existingIndex] = newTile;
        } else {
            gameState.lobby.map.tiles.push(newTile);
        }

        drawMapBuilder();
    }
}

// ===== INITIALIZATION =====
window.onload = function() {
    // Load saved maps
    const savedMapsJson = localStorage.getItem('catanMaps');
    if (savedMapsJson) {
        gameState.savedMaps = JSON.parse(savedMapsJson);
    }

    // Update map select with saved maps
    const mapSelect = document.getElementById('map-select');
    gameState.savedMaps.forEach(map => {
        const option = document.createElement('option');
        option.value = map.name;
        option.textContent = map.name;
        mapSelect.appendChild(option);
    });

    // Initialize map builder canvas
    const builderCanvas = document.getElementById('builder-canvas');
    if (builderCanvas) {
        drawMapBuilder();
    }

    console.log('Catan Online loaded!');
};

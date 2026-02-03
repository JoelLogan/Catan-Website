// ===== CLIENT-SIDE SOCKET.IO CONNECTION =====
const socket = io();

// ===== LOCAL STATE =====
let localState = {
    currentScreen: 'main-menu',
    gameCode: null,
    playerName: null,
    game: null,
    selectedTile: 'land-placeholder',
    selectedPort: null,
    mapTemplate: null
};

// ===== SOCKET EVENT HANDLERS =====

socket.on('connect', () => {
    console.log('🌟 Connected to Catan server!');
});

socket.on('gameCreated', ({ gameCode, game }) => {
    localState.gameCode = gameCode;
    localState.game = game;
    showLobby();
    showMessage('🎮 Game created! Share code: ' + gameCode);
});

socket.on('gameJoined', ({ gameCode, game }) => {
    localState.gameCode = gameCode;
    localState.game = game;
    showLobby();
    showMessage('✨ Joined game successfully!');
});

socket.on('lobbyUpdate', (game) => {
    localState.game = game;
    if (localState.currentScreen === 'lobby') {
        updateLobbyDisplay();
    }
});

socket.on('playerLeft', ({ playerName, game }) => {
    localState.game = game;
    showMessage(`${playerName} left the game`);
    if (localState.currentScreen === 'lobby') {
        updateLobbyDisplay();
    }
});

socket.on('gameStarted', (game) => {
    localState.game = game;
    showScreen('game-screen');
    drawGameBoard();
    updateGameDisplay();
    showMessage('🏝️ Game started! Let the adventure begin!');
});

socket.on('diceRolled', ({ die1, die2, total, game }) => {
    localState.game = game;
    showDice(die1, die2);
    updateGameDisplay();
    showMessage(`🎲 Rolled ${total}!`);
});

socket.on('structureBuilt', ({ player, type, location, game }) => {
    localState.game = game;
    drawGameBoard();
    updateGameDisplay();
    showMessage(`${player} built a ${type}!`);
});

socket.on('tradeProposed', ({ from, trade }) => {
    if (from !== localState.playerName) {
        showTradeProposal(from, trade);
    }
});

socket.on('tradeAccepted', ({ acceptedBy, game }) => {
    localState.game = game;
    updateGameDisplay();
    showMessage(`${acceptedBy} accepted the trade!`);
});

socket.on('turnEnded', ({ nextPlayer, game }) => {
    localState.game = game;
    updateGameDisplay();
    showMessage(`${nextPlayer}'s turn`);
});

socket.on('gameWon', ({ winner, game }) => {
    localState.game = game;
    updateGameDisplay();
    showMessage(`🎉 ${winner} wins the game!`, 5000);
    setTimeout(() => {
        showScreen('main-menu');
    }, 5000);
});

socket.on('mapSaved', ({ mapName }) => {
    showMessage(`💾 Map "${mapName}" saved!`);
});

socket.on('mapsLoaded', ({ maps }) => {
    displayAvailableMaps(maps);
});

socket.on('error', ({ message }) => {
    showMessage('❌ ' + message);
});

// ===== UTILITY FUNCTIONS =====

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById(screenId).classList.add('active');
    localState.currentScreen = screenId;
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
    const playerName = document.getElementById('host-name').value.trim();
    if (!playerName) {
        showMessage('❌ Please enter your name');
        return;
    }

    const settings = {
        maxPlayers: parseInt(document.getElementById('max-players').value),
        victoryPoints: parseInt(document.getElementById('victory-points').value),
        expansions: {
            seafarers: document.getElementById('expansion-seafarers').checked,
            citiesKnights: document.getElementById('expansion-cities-knights').checked
        },
        gamePieces: {
            settlements: parseInt(document.getElementById('pieces-settlements').value),
            cities: parseInt(document.getElementById('pieces-cities').value),
            roads: parseInt(document.getElementById('pieces-roads').value),
            ships: parseInt(document.getElementById('pieces-ships').value),
            knights: parseInt(document.getElementById('pieces-knights').value)
        }
    };

    const mapSelect = document.getElementById('map-select').value;
    let mapTemplate;
    if (mapSelect === 'random') {
        mapTemplate = generateDefaultMapTemplate();
    } else {
        mapTemplate = generateDefaultMapTemplate();
    }

    localState.playerName = playerName;
    localState.mapTemplate = mapTemplate;

    socket.emit('createGame', { playerName, settings, mapTemplate });
}

function joinGame() {
    const playerName = document.getElementById('join-name').value.trim();
    const gameCode = document.getElementById('game-code').value.trim();
    
    if (!playerName) {
        showMessage('❌ Please enter your name');
        return;
    }
    
    if (!gameCode || gameCode.length !== 6) {
        showMessage('❌ Please enter a valid 6-digit game code');
        return;
    }

    localState.playerName = playerName;
    socket.emit('joinGame', { playerName, gameCode });
}

// ===== LOBBY FUNCTIONS =====

function showLobby() {
    showScreen('lobby');
    updateLobbyDisplay();
}

function updateLobbyDisplay() {
    if (!localState.game) return;

    document.getElementById('lobby-code').textContent = localState.game.code;
    document.getElementById('lobby-host').textContent = localState.game.host;
    document.getElementById('player-count').textContent = localState.game.players.length;
    document.getElementById('max-player-count').textContent = localState.game.settings.maxPlayers;

    const playersContainer = document.getElementById('players-container');
    playersContainer.innerHTML = '';
    localState.game.players.forEach(player => {
        const playerDiv = document.createElement('div');
        playerDiv.className = 'player-item' + (player.isHost ? ' host' : '');
        playerDiv.innerHTML = `
            <span style="color: ${player.color}; font-weight: 600;">🎮 ${player.name}</span>
            ${player.isHost ? '<span>👑 (Host)</span>' : ''}
        `;
        playersContainer.appendChild(playerDiv);
    });

    // Show host controls if current player is host
    const currentPlayer = localState.game.players.find(p => p.name === localState.playerName);
    if (currentPlayer && currentPlayer.isHost) {
        document.getElementById('host-controls').style.display = 'block';
    }
}

function leaveLobby() {
    showScreen('main-menu');
    localState.game = null;
    localState.gameCode = null;
}

function startGame() {
    if (!localState.gameCode) return;
    socket.emit('startGame', { gameCode: localState.gameCode });
}

// ===== MAP BUILDER FUNCTIONS =====

function generateDefaultMapTemplate() {
    // Standard Catan layout with land placeholders
    const tiles = [
        { type: 'land-placeholder', x: 0, y: 0 },
        { type: 'land-placeholder', x: 1, y: 0 },
        { type: 'land-placeholder', x: 2, y: 0 },
        { type: 'land-placeholder', x: -1, y: 1 },
        { type: 'land-placeholder', x: 0, y: 1 },
        { type: 'land-placeholder', x: 1, y: 1 },
        { type: 'land-placeholder', x: 2, y: 1 },
        { type: 'land-placeholder', x: -2, y: 2 },
        { type: 'land-placeholder', x: -1, y: 2 },
        { type: 'land-placeholder', x: 0, y: 2 },
        { type: 'land-placeholder', x: 1, y: 2 },
        { type: 'land-placeholder', x: 2, y: 2 },
        { type: 'land-placeholder', x: -1, y: 3 },
        { type: 'land-placeholder', x: 0, y: 3 },
        { type: 'land-placeholder', x: 1, y: 3 },
        { type: 'land-placeholder', x: 2, y: 3 },
        { type: 'land-placeholder', x: 0, y: 4 },
        { type: 'land-placeholder', x: 1, y: 4 },
        { type: 'land-placeholder', x: 2, y: 4 }
    ];

    const ports = [
        { type: '3:1', position: 0 },
        { type: '3:1', position: 1 },
        { type: '3:1', position: 2 },
        { type: '3:1', position: 3 }
    ];

    return { tiles, ports };
}

function selectTile(type) {
    localState.selectedTile = type;
    localState.selectedPort = null;
    showMessage(`🏝️ Selected: ${type}`);
    
    // Update button styles
    document.querySelectorAll('.tile-btn').forEach(btn => btn.style.opacity = '0.7');
    document.querySelectorAll('.port-btn').forEach(btn => btn.style.opacity = '0.7');
    event.target.style.opacity = '1';
}

function selectPort(type) {
    localState.selectedPort = type;
    localState.selectedTile = null;
    showMessage(`⚓ Selected port: ${type}`);
    
    // Update button styles
    document.querySelectorAll('.tile-btn').forEach(btn => btn.style.opacity = '0.7');
    document.querySelectorAll('.port-btn').forEach(btn => btn.style.opacity = '0.7');
    event.target.style.opacity = '1';
}

function saveMap() {
    if (!localState.mapTemplate) {
        showMessage('❌ No map to save');
        return;
    }
    
    const mapName = prompt('📝 Enter map name:');
    if (mapName) {
        socket.emit('saveMap', { mapName, mapData: localState.mapTemplate });
    }
}

function loadMap() {
    socket.emit('loadMaps');
}

function displayAvailableMaps(maps) {
    if (maps.length === 0) {
        showMessage('📂 No saved maps found');
        return;
    }
    
    const mapNames = maps.map(m => m.name).join('\n');
    const mapName = prompt(`📂 Available maps:\n${mapNames}\n\nEnter map name to load:`);
    
    const map = maps.find(m => m.name === mapName);
    if (map) {
        localState.mapTemplate = map.data;
        drawMapBuilder();
        showMessage('✅ Map loaded!');
    } else {
        showMessage('❌ Map not found');
    }
}

function clearMap() {
    localState.mapTemplate = { tiles: [], ports: [] };
    drawMapBuilder();
    showMessage('🗑️ Map cleared');
}

function drawMapBuilder() {
    const canvas = document.getElementById('builder-canvas');
    if (!canvas) return;
    
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
        const existingTile = localState.mapTemplate?.tiles?.find(
            t => t.x === pos.x && t.y === pos.y
        );
        const tile = existingTile || { type: 'water', x: pos.x, y: pos.y };
        drawHexTile(ctx, tile, hexSize, centerX, centerY, true);
    });

    // Setup click handler
    canvas.onclick = handleBuilderClick;
}

function handleBuilderClick(event) {
    const canvas = event.target;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

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
        if (!localState.mapTemplate) localState.mapTemplate = { tiles: [], ports: [] };
        
        const existingIndex = localState.mapTemplate.tiles.findIndex(
            t => t.x === closestPos.x && t.y === closestPos.y
        );

        if (localState.selectedTile) {
            const newTile = {
                type: localState.selectedTile,
                x: closestPos.x,
                y: closestPos.y
            };

            if (existingIndex >= 0) {
                localState.mapTemplate.tiles[existingIndex] = newTile;
            } else {
                localState.mapTemplate.tiles.push(newTile);
            }
        }

        drawMapBuilder();
    }
}

// ===== GAME BOARD RENDERING =====

function drawGameBoard() {
    const canvas = document.getElementById('game-canvas');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const hexSize = 50;
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    // Draw tiles
    if (localState.game && localState.game.board && localState.game.board.tiles) {
        localState.game.board.tiles.forEach(tile => {
            drawHexTile(ctx, tile, hexSize, centerX, centerY, false);
        });
    }

    // Draw structures
    if (localState.game && localState.game.players) {
        localState.game.players.forEach(player => {
            if (player.settlements) {
                player.settlements.forEach(settlement => {
                    drawSettlement(ctx, settlement.vertex, player.color, centerX, centerY, hexSize);
                });
            }
            if (player.cities) {
                player.cities.forEach(city => {
                    drawCity(ctx, city.vertex, player.color, centerX, centerY, hexSize);
                });
            }
            if (player.roads) {
                player.roads.forEach(road => {
                    drawRoad(ctx, road.edge, player.color, centerX, centerY, hexSize);
                });
            }
            if (player.ships && localState.game.settings.expansions.seafarers) {
                player.ships.forEach(ship => {
                    drawShip(ctx, ship.edge, player.color, centerX, centerY, hexSize);
                });
            }
        });
    }
}

function drawHexTile(ctx, tile, size, centerX, centerY, isBuilder) {
    const pos = hexToPixel(tile.x, tile.y, size);
    const x = centerX + pos.x;
    const y = centerY + pos.y;

    // Load and draw tile image
    const img = new Image();
    img.src = `/public/images/tiles/${tile.type}.svg`;
    
    // Draw placeholder while loading
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i;
        const hx = x + size * Math.cos(angle);
        const hy = y + size * Math.sin(angle);
        if (i === 0) ctx.moveTo(hx, hy);
        else ctx.lineTo(hx, hy);
    }
    ctx.closePath();
    ctx.fillStyle = getTileColor(tile.type);
    ctx.fill();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw image when loaded
    img.onload = () => {
        ctx.save();
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 3) * i;
            const hx = x + size * Math.cos(angle);
            const hy = y + size * Math.sin(angle);
            if (i === 0) ctx.moveTo(hx, hy);
            else ctx.lineTo(hx, hy);
        }
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(img, x - size, y - size, size * 2, size * 2);
        ctx.restore();
    };

    // Draw number token (only if not builder mode and tile has a number)
    if (!isBuilder && tile.number) {
        ctx.fillStyle = tile.number === 6 || tile.number === 8 ? '#ff0000' : '#ffffff';
        ctx.beginPath();
        ctx.arc(x, y, 20, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = '#000';
        ctx.font = 'bold 18px Nunito';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(tile.number.toString(), x, y);
    }
}

function getTileColor(type) {
    const colors = {
        wood: '#4a7c4e',
        brick: '#c85a3a',
        sheep: '#9fd99f',
        wheat: '#f4d47c',
        ore: '#8a8a9a',
        desert: '#e8d4a8',
        water: '#6ba8d8',
        'land-placeholder': '#c8c8c8'
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
    return { x: vertex.x * hexSize, y: vertex.y * hexSize };
}

// ===== GAME DISPLAY UPDATE =====

function updateGameDisplay() {
    if (!localState.game || !localState.game.players) return;

    const currentPlayer = localState.game.players[localState.game.currentPlayerIndex];
    document.getElementById('current-turn-player').textContent = currentPlayer.name;
    document.getElementById('game-phase').textContent = localState.game.phase;

    // Update players list
    const playersContainer = document.getElementById('game-players');
    playersContainer.innerHTML = '';
    localState.game.players.forEach((player, index) => {
        const playerDiv = document.createElement('div');
        playerDiv.className = 'game-player-item' + 
            (index === localState.game.currentPlayerIndex ? ' active' : '');
        playerDiv.innerHTML = `
            <div class="player-info">
                <span style="color: ${player.color}; font-weight: 700;">🎮 ${player.name}</span>
                <span>🏆 ${player.victoryPoints} VP</span>
            </div>
            <div style="font-size: 12px; color: #666; margin-top: 5px;">
                📦 Resources: ${player.resourceCount || 0}
            </div>
        `;
        playersContainer.appendChild(playerDiv);
    });

    // Update local player resources
    if (localState.game.localPlayer) {
        const resources = localState.game.localPlayer.resources;
        document.getElementById('wood-count').textContent = resources.wood || 0;
        document.getElementById('brick-count').textContent = resources.brick || 0;
        document.getElementById('sheep-count').textContent = resources.sheep || 0;
        document.getElementById('wheat-count').textContent = resources.wheat || 0;
        document.getElementById('ore-count').textContent = resources.ore || 0;

        // Update development cards
        const devCardsContainer = document.getElementById('dev-cards-container');
        devCardsContainer.innerHTML = '';
        if (localState.game.localPlayer.developmentCards) {
            localState.game.localPlayer.developmentCards.forEach((card, index) => {
                const cardDiv = document.createElement('div');
                cardDiv.className = 'dev-card';
                cardDiv.textContent = card.replace(/-/g, ' ').toUpperCase();
                cardDiv.onclick = () => playDevelopmentCard(index);
                devCardsContainer.appendChild(cardDiv);
            });
        }
    }

    updateActionButtons();
}

function updateActionButtons() {
    if (!localState.game) return;
    
    const currentPlayer = localState.game.players[localState.game.currentPlayerIndex];
    const isCurrentPlayer = currentPlayer.name === localState.playerName;

    document.getElementById('roll-dice-btn').disabled = 
        !isCurrentPlayer || localState.game.phase !== 'roll';
    document.getElementById('end-turn-btn').disabled = 
        !isCurrentPlayer || localState.game.phase === 'roll';
    document.getElementById('build-settlement-btn').disabled = !isCurrentPlayer;
    document.getElementById('build-city-btn').disabled = !isCurrentPlayer;
    document.getElementById('build-road-btn').disabled = !isCurrentPlayer;
    document.getElementById('trade-btn').disabled = !isCurrentPlayer;
    document.getElementById('dev-card-btn').disabled = !isCurrentPlayer;
    
    if (localState.game.settings.expansions.seafarers) {
        document.getElementById('build-ship-btn').style.display = 'block';
        document.getElementById('build-ship-btn').disabled = !isCurrentPlayer;
    }
}

// ===== GAME ACTIONS =====

function rollDice() {
    socket.emit('rollDice', { gameCode: localState.gameCode });
}

function showDice(die1, die2) {
    document.getElementById('dice1').textContent = die1;
    document.getElementById('dice2').textContent = die2;
    document.getElementById('dice-display').style.display = 'flex';

    setTimeout(() => {
        document.getElementById('dice-display').style.display = 'none';
    }, 3000);
}

function endTurn() {
    socket.emit('endTurn', { gameCode: localState.gameCode });
}

function startBuildMode(type) {
    showMessage(`🏗️ Click on the board to place ${type}`);
    
    const canvas = document.getElementById('game-canvas');
    canvas.onclick = (event) => handleGameBoardClick(event, type);
}

function handleGameBoardClick(event, type) {
    const canvas = event.target;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Convert to game coordinates
    const location = {
        vertex: { x: (x - 450) / 50, y: (y - 350) / 50 }
    };

    if (type === 'road' || type === 'ship') {
        location.edge = {
            start: { x: (x - 450) / 50, y: (y - 350) / 50 },
            end: { x: (x - 450) / 50 + 1, y: (y - 350) / 50 }
        };
    }

    socket.emit('buildStructure', {
        gameCode: localState.gameCode,
        type,
        location
    });

    canvas.onclick = null;
}

function openTradeDialog() {
    document.getElementById('trade-dialog').style.display = 'flex';
    initializeTradeDialog();
}

function closeTradeDialog() {
    document.getElementById('trade-dialog').style.display = 'none';
}

function initializeTradeDialog() {
    const resources = ['wood', 'brick', 'sheep', 'wheat', 'ore'];

    // Initialize give resources
    const giveContainer = document.getElementById('give-resources');
    giveContainer.innerHTML = '';
    resources.forEach(resource => {
        const div = document.createElement('div');
        div.className = 'resource-selector-item';
        const maxAmount = localState.game.localPlayer?.resources[resource] || 0;
        div.innerHTML = `
            <label>${resource.charAt(0).toUpperCase() + resource.slice(1)}:</label>
            <input type="number" id="give-${resource}" min="0" max="${maxAmount}" value="0">
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
    localState.game.players.forEach((player, index) => {
        if (player.name !== localState.playerName) {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = player.name;
            playerSelect.appendChild(option);
        }
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
    
    socket.emit('proposeTrade', {
        gameCode: localState.gameCode,
        trade: { give, receive, targetPlayerIndex }
    });

    showMessage('💱 Trade proposed!');
    closeTradeDialog();
}

function executeBankTrade() {
    // Bank trade implementation
    showMessage('💰 Bank trade executed!');
    closeTradeDialog();
}

function buyDevelopmentCard() {
    showMessage('🎴 Development card purchased!');
}

function playDevelopmentCard(index) {
    showMessage('✨ Development card played!');
}

// ===== INITIALIZATION =====

window.onload = function() {
    console.log('🏝️ Catan Online - Studio Ghibli Edition loaded!');
    
    // Initialize map builder canvas if on that screen
    const builderCanvas = document.getElementById('builder-canvas');
    if (builderCanvas && localState.currentScreen === 'map-builder') {
        localState.mapTemplate = generateDefaultMapTemplate();
        drawMapBuilder();
    }
};

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
    mapTemplate: null,
    canvasOffset: { x: 0, y: 0 },
    canvasZoom: 1.0,
    isDragging: false,
    lastMousePos: { x: 0, y: 0 }
};

// ===== RECONNECTION SYSTEM =====

// Cookie helper functions
function setCookie(name, value, days) {
    const date = new Date();
    date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
    const expires = "expires=" + date.toUTCString();
    document.cookie = name + "=" + value + ";" + expires + ";path=/";
}

function getCookie(name) {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) === ' ') c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
}

function deleteCookie(name) {
    document.cookie = name + "=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
}

function saveGameSession(gameCode, playerName) {
    setCookie('catanGameCode', gameCode, 1);
    setCookie('catanPlayerName', playerName, 1);
}

function clearGameSession() {
    deleteCookie('catanGameCode');
    deleteCookie('catanPlayerName');
}

function checkForReconnection() {
    const savedGameCode = getCookie('catanGameCode');
    const savedPlayerName = getCookie('catanPlayerName');
    
    if (savedGameCode && savedPlayerName) {
        showReconnectDialog(savedGameCode, savedPlayerName);
    }
}

function showReconnectDialog(gameCode, playerName) {
    // Don't show if already in a game
    if (localState.game && localState.currentScreen !== 'main-menu') {
        return;
    }
    
    // Don't show if dialog already exists
    if (document.querySelector('.reconnect-dialog')) {
        return;
    }
    
    const dialog = document.createElement('div');
    dialog.className = 'modal reconnect-dialog';
    dialog.style.display = 'flex';
    dialog.innerHTML = `
        <div class="modal-content" style="max-width: 400px;">
            <h2>🎮 Rejoin Game?</h2>
            <p>We found a previous game session:</p>
            <p><strong>Player:</strong> ${playerName}</p>
            <p><strong>Game Code:</strong> ${gameCode}</p>
            <div class="modal-buttons">
                <button id="rejoin-yes" style="background: linear-gradient(135deg, #5fa86f 0%, #4a7c59 100%);">
                    ✓ Rejoin
                </button>
                <button id="rejoin-no" style="background: linear-gradient(135deg, #999 0%, #666 100%);">
                    ✗ New Game
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(dialog);
    
    document.getElementById('rejoin-yes').onclick = () => {
        localState.playerName = playerName;
        socket.emit('rejoinGame', { playerName, gameCode });
        dialog.remove();
    };
    
    document.getElementById('rejoin-no').onclick = () => {
        clearGameSession();
        dialog.remove();
    };
}

// ===== SOCKET EVENT HANDLERS =====

let hasCheckedReconnection = false;

socket.on('connect', () => {
    console.log('🌟 Connected to Catan server!');
    // Only check for reconnection once on initial load
    if (!hasCheckedReconnection) {
        hasCheckedReconnection = true;
        setTimeout(checkForReconnection, 500);
    }
});

socket.on('gameCreated', ({ gameCode, game }) => {
    localState.gameCode = gameCode;
    localState.game = game;
    saveGameSession(gameCode, localState.playerName);
    showLobby();
    showMessage('🎮 Game created! Share code: ' + gameCode);
});

socket.on('gameJoined', ({ gameCode, game }) => {
    localState.gameCode = gameCode;
    localState.game = game;
    saveGameSession(gameCode, localState.playerName);
    showLobby();
    showMessage('✨ Joined game successfully!');
});

socket.on('reconnected', ({ gameCode, game }) => {
    localState.gameCode = gameCode;
    localState.game = game;
    saveGameSession(gameCode, localState.playerName);
    
    if (game.started) {
        showScreen('game-screen');
        drawGameBoard();
        updateGameDisplay();
        showMessage('🎮 Reconnected to game!');
    } else {
        showLobby();
        showMessage('🎮 Reconnected to lobby!');
    }
});

socket.on('reconnectFailed', ({ message }) => {
    clearGameSession();
    showMessage('❌ Could not reconnect: ' + message);
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
    initGameCanvas();
    drawGameBoard();
    updateGameDisplay();
    if (game.phase === 'initial-placement') {
        showMessage('🏠 Initial placement: Each player places a settlement and road');
    } else {
        showMessage('🏝️ Game started! Let the adventure begin!');
    }
});

socket.on('initialPlaced', ({ player, type, location, game }) => {
    localState.game = game;
    drawGameBoard();
    updateGameDisplay();
    showMessage(`${player} placed a ${type}!`);
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
    populateMapDropdown(maps);
    // Don't show prompt here - only populate dropdown silently
});

socket.on('error', ({ message }) => {
    showMessage('❌ ' + message);
});

socket.on('customMapLoaded', ({ mapData }) => {
    if (localState.pendingGameSettings) {
        const { playerName, settings } = localState.pendingGameSettings;
        localState.playerName = playerName;
        localState.mapTemplate = mapData;
        socket.emit('createGame', { playerName, settings, mapTemplate: mapData });
        delete localState.pendingGameSettings;
    }
});

// ===== UTILITY FUNCTIONS =====

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    document.getElementById(screenId).classList.add('active');
    localState.currentScreen = screenId;
    
    // Load custom maps when showing create game screen
    if (screenId === 'create-game') {
        loadCustomMapsForDropdown();
    }
    
    // Initialize canvases when screens are shown
    if (screenId === 'map-builder') {
        // Reset zoom/pan for builder
        localState.canvasOffset = { x: 0, y: 0 };
        localState.canvasZoom = 1.0;
        initMapBuilderCanvas();
        drawMapBuilder();
    }
}

function loadCustomMapsForDropdown() {
    socket.emit('loadMaps');
}

function populateMapDropdown(maps) {
    const mapSelect = document.getElementById('map-select');
    // Clear existing options except default ones
    mapSelect.innerHTML = `
        <option value="default">Default Map</option>
        <option value="random">Random Map</option>
    `;
    
    // Add custom maps
    maps.forEach(map => {
        const option = document.createElement('option');
        option.value = `custom:${map.name}`;
        option.textContent = map.name;
        mapSelect.appendChild(option);
    });
}

function showMessage(text, duration = 3000) {
    const messageBox = document.getElementById('message-box');
    messageBox.textContent = text;
    messageBox.classList.add('show');
    setTimeout(() => {
        messageBox.classList.remove('show');
    }, duration);
}

// ===== LOCALSTORAGE HELPERS =====

function savePlayerName(name) {
    localStorage.setItem('catanPlayerName', name);
}

function loadPlayerName() {
    return localStorage.getItem('catanPlayerName') || '';
}

function loadPlayerNameIntoForms() {
    const savedName = loadPlayerName();
    if (savedName) {
        const hostNameInput = document.getElementById('host-name');
        const joinNameInput = document.getElementById('join-name');
        if (hostNameInput) hostNameInput.value = savedName;
        if (joinNameInput) joinNameInput.value = savedName;
    }
}

// ===== MAIN MENU FUNCTIONS =====

function createGame() {
    const playerName = document.getElementById('host-name').value.trim();
    if (!playerName) {
        showMessage('❌ Please enter your name');
        return;
    }

    // Save player name to localStorage
    savePlayerName(playerName);

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
    
    if (mapSelect.startsWith('custom:')) {
        // Load custom map from server
        const mapName = mapSelect.substring(7); // Remove "custom:" prefix
        socket.emit('loadCustomMap', { mapName });
        // Will continue in socket handler
        localState.pendingGameSettings = { playerName, settings };
        return;
    } else if (mapSelect === 'random') {
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
    
    // Save player name to localStorage
    savePlayerName(playerName);

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

    const codeElement = document.getElementById('lobby-code');
    codeElement.textContent = localState.game.code;
    codeElement.style.cursor = 'pointer';
    codeElement.title = 'Click to copy';
    codeElement.onclick = () => {
        navigator.clipboard.writeText(localState.game.code).then(() => {
            showMessage('📋 Game code copied to clipboard!');
        }).catch(() => {
            // Fallback for older browsers (document.execCommand is deprecated but kept for legacy support)
            const textarea = document.createElement('textarea');
            textarea.value = localState.game.code;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            showMessage('📋 Game code copied to clipboard!');
        });
    };
    
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
    // Standard Catan layout - 19 hexes in classic pattern
    // Using proper axial coordinates for a centered hexagon
    const tiles = [
        // Top row (3 tiles)
        { type: 'land-placeholder', x: 0, y: -2 },
        { type: 'land-placeholder', x: 1, y: -2 },
        { type: 'land-placeholder', x: 2, y: -2 },
        
        // Second row (4 tiles)
        { type: 'land-placeholder', x: -1, y: -1 },
        { type: 'land-placeholder', x: 0, y: -1 },
        { type: 'land-placeholder', x: 1, y: -1 },
        { type: 'land-placeholder', x: 2, y: -1 },
        
        // Middle row (5 tiles)
        { type: 'land-placeholder', x: -2, y: 0 },
        { type: 'land-placeholder', x: -1, y: 0 },
        { type: 'land-placeholder', x: 0, y: 0 },
        { type: 'land-placeholder', x: 1, y: 0 },
        { type: 'land-placeholder', x: 2, y: 0 },
        
        // Fourth row (4 tiles)
        { type: 'land-placeholder', x: -2, y: 1 },
        { type: 'land-placeholder', x: -1, y: 1 },
        { type: 'land-placeholder', x: 0, y: 1 },
        { type: 'land-placeholder', x: 1, y: 1 },
        
        // Bottom row (3 tiles)
        { type: 'land-placeholder', x: -2, y: 2 },
        { type: 'land-placeholder', x: -1, y: 2 },
        { type: 'land-placeholder', x: 0, y: 2 }
    ];

    // Add water tiles around the border for classic look
    const waterTiles = [
        // Top border (5 tiles)
        { type: 'water', x: -1, y: -3 }, { type: 'water', x: 0, y: -3 }, 
        { type: 'water', x: 1, y: -3 }, { type: 'water', x: 2, y: -3 }, { type: 'water', x: 3, y: -3 },
        
        // Upper right (2 tiles)
        { type: 'water', x: 3, y: -2 }, { type: 'water', x: 3, y: -1 },
        
        // Right border (1 tile)
        { type: 'water', x: 3, y: 0 },
        
        // Lower right (2 tiles)
        { type: 'water', x: 2, y: 1 }, { type: 'water', x: 1, y: 2 },
        
        // Bottom border (4 tiles)
        { type: 'water', x: 0, y: 3 }, { type: 'water', x: -1, y: 3 }, 
        { type: 'water', x: -2, y: 3 }, { type: 'water', x: -3, y: 3 },
        
        // Left border (4 tiles)
        { type: 'water', x: -3, y: 2 }, { type: 'water', x: -3, y: 1 },
        { type: 'water', x: -3, y: 0 }, { type: 'water', x: -2, y: -1 },
        { type: 'water', x: -1, y: -2 }
    ];

    // Add ports to some water tiles (classic Catan has 9 ports total)
    // Total waterTiles: 19 elements (0-18)
    if (waterTiles.length > 2) waterTiles[2].port = { type: '3:1' }; // Top
    if (waterTiles.length > 5) waterTiles[5].port = { type: '2:1' }; // Top right
    if (waterTiles.length > 7) waterTiles[7].port = { type: '3:1' }; // Right
    if (waterTiles.length > 9) waterTiles[9].port = { type: '2:1' }; // Bottom right
    if (waterTiles.length > 12) waterTiles[12].port = { type: '3:1' }; // Bottom
    if (waterTiles.length > 15) waterTiles[15].port = { type: '2:1' }; // Bottom left
    if (waterTiles.length > 17) waterTiles[17].port = { type: '3:1' }; // Left

    return { tiles: [...tiles, ...waterTiles], ports: [] };
}

function selectTile(type) {
    localState.selectedTile = type;
    localState.selectedPort = null;
    localState.deleteMode = false;
    showMessage(`🏝️ Selected: ${type}`);
    
    // Update button styles
    document.querySelectorAll('.tile-btn').forEach(btn => btn.style.opacity = '0.7');
    document.querySelectorAll('.port-btn').forEach(btn => btn.style.opacity = '0.7');
    if (event && event.target) event.target.style.opacity = '1';
}

function selectPort(type) {
    localState.selectedPort = type;
    localState.selectedTile = null;
    localState.deleteMode = false;
    showMessage(`⚓ Selected port: ${type}`);
    
    // Update button styles
    document.querySelectorAll('.tile-btn').forEach(btn => btn.style.opacity = '0.7');
    document.querySelectorAll('.port-btn').forEach(btn => btn.style.opacity = '0.7');
    if (event && event.target) event.target.style.opacity = '1';
}

function enableDeleteMode() {
    localState.deleteMode = true;
    localState.selectedTile = null;
    localState.selectedPort = null;
    showMessage('🗑️ Delete mode: Click tiles to remove them');
    
    // Update button styles
    document.querySelectorAll('.tile-btn').forEach(btn => btn.style.opacity = '0.7');
    document.querySelectorAll('.port-btn').forEach(btn => btn.style.opacity = '0.7');
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

function initMapBuilderCanvas() {
    const canvas = document.getElementById('builder-canvas');
    if (!canvas) return;
    
    // Mouse wheel zoom
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        localState.canvasZoom = Math.max(0.3, Math.min(3, localState.canvasZoom * delta));
        drawMapBuilder();
    });
    
    // Note: We'll keep the builder simpler - pan with right-click
    let isPanning = false;
    
    canvas.addEventListener('mousedown', (e) => {
        if (e.button === 2) { // Right click
            e.preventDefault();
            isPanning = true;
            localState.lastMousePos = { x: e.clientX, y: e.clientY };
            canvas.style.cursor = 'grabbing';
        }
    });
    
    canvas.addEventListener('mousemove', (e) => {
        if (isPanning) {
            const dx = e.clientX - localState.lastMousePos.x;
            const dy = e.clientY - localState.lastMousePos.y;
            localState.canvasOffset.x += dx;
            localState.canvasOffset.y += dy;
            localState.lastMousePos = { x: e.clientX, y: e.clientY };
            drawMapBuilder();
        }
    });
    
    canvas.addEventListener('mouseup', () => {
        isPanning = false;
        canvas.style.cursor = 'default';
    });
    
    canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault(); // Prevent context menu
    });
}

function drawMapBuilder() {
    const canvas = document.getElementById('builder-canvas');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const hexSize = 40;
    // Calculate center in screen space BEFORE transformation
    const centerX = canvas.width / 2 / localState.canvasZoom;
    const centerY = canvas.height / 2 / localState.canvasZoom;

    ctx.save();
    ctx.translate(localState.canvasOffset.x, localState.canvasOffset.y);
    ctx.scale(localState.canvasZoom, localState.canvasZoom);

    // Draw all tiles in map template
    if (localState.mapTemplate && localState.mapTemplate.tiles) {
        localState.mapTemplate.tiles.forEach(tile => {
            drawHexTile(ctx, tile, hexSize, centerX, centerY, true);
        });
    }

    // Draw ports on tiles
    if (localState.mapTemplate && localState.mapTemplate.ports) {
        localState.mapTemplate.ports.forEach(port => {
            const tile = localState.mapTemplate.tiles.find(t => 
                t.x === port.tileX && t.y === port.tileY
            );
            if (tile) {
                drawPort(ctx, tile, port, hexSize, centerX, centerY);
            }
        });
    }

    ctx.restore();

    // Setup click handler
    canvas.onclick = handleBuilderClick;
}

function handleBuilderClick(event) {
    const canvas = event.target;
    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    const hexSize = 40;
    // Use same center calculation as in drawMapBuilder
    const centerX = canvas.width / 2 / localState.canvasZoom;
    const centerY = canvas.height / 2 / localState.canvasZoom;

    // Account for zoom and pan - correct transformation order
    const relX = ((mouseX - localState.canvasOffset.x) / localState.canvasZoom) - centerX;
    const relY = ((mouseY - localState.canvasOffset.y) / localState.canvasZoom) - centerY;

    // Calculate hex coordinates from pixel position
    // Using axial coordinates
    const q = (2/3 * relX) / hexSize;
    const r = (-1/3 * relX + Math.sqrt(3)/3 * relY) / hexSize;
    
    // Round to nearest hex
    let ax = Math.round(q);
    let ay = Math.round(r);
    let az = Math.round(-q - r);
    
    // Handle rounding errors
    const x_diff = Math.abs(ax - q);
    const y_diff = Math.abs(ay - r);
    const z_diff = Math.abs(az - (-q - r));
    
    if (x_diff > y_diff && x_diff > z_diff) {
        ax = -ay - az;
    } else if (y_diff > z_diff) {
        ay = -ax - az;
    }
    
    const closestPos = { x: ax, y: ay };

    if (!localState.mapTemplate) localState.mapTemplate = { tiles: [], ports: [] };
    
    const existingIndex = localState.mapTemplate.tiles.findIndex(
        t => t.x === closestPos.x && t.y === closestPos.y
    );

    if (localState.deleteMode) {
        // Delete tile
        if (existingIndex >= 0) {
            localState.mapTemplate.tiles.splice(existingIndex, 1);
            showMessage('🗑️ Tile deleted');
        }
        // Also delete any port on this tile
        const portIndex = localState.mapTemplate.ports.findIndex(
            p => p.tileX === closestPos.x && p.tileY === closestPos.y
        );
        if (portIndex >= 0) {
            localState.mapTemplate.ports.splice(portIndex, 1);
            showMessage('🗑️ Port deleted');
        }
    } else if (localState.selectedPort) {
        // Add or update port on tile
        if (existingIndex >= 0) {
            const portIndex = localState.mapTemplate.ports.findIndex(
                p => p.tileX === closestPos.x && p.tileY === closestPos.y
            );
            const newPort = {
                type: localState.selectedPort,
                tileX: closestPos.x,
                tileY: closestPos.y
            };
            
            if (portIndex >= 0) {
                localState.mapTemplate.ports[portIndex] = newPort;
                showMessage(`⚓ Port updated to ${localState.selectedPort}`);
            } else {
                localState.mapTemplate.ports.push(newPort);
                showMessage(`⚓ Port ${localState.selectedPort} placed`);
            }
        } else {
            showMessage('⚠️ Place a tile first before adding a port');
        }
    } else if (localState.selectedTile) {
        // Add or update tile
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

// ===== GAME BOARD RENDERING =====

function initGameCanvas() {
    const canvas = document.getElementById('game-canvas');
    if (!canvas) return;
    
    // Mouse wheel zoom
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        localState.canvasZoom = Math.max(0.3, Math.min(3, localState.canvasZoom * delta));
        drawGameBoard();
    });
    
    // Mouse drag for panning (only when not in build mode)
    canvas.addEventListener('mousedown', (e) => {
        if (!buildModeState && e.button === 0) { // Left click only
            localState.isDragging = true;
            localState.lastMousePos = { x: e.clientX, y: e.clientY };
            canvas.style.cursor = 'grabbing';
        }
    });
    
    canvas.addEventListener('mousemove', (e) => {
        if (localState.isDragging && !buildModeState) {
            const dx = e.clientX - localState.lastMousePos.x;
            const dy = e.clientY - localState.lastMousePos.y;
            localState.canvasOffset.x += dx;
            localState.canvasOffset.y += dy;
            localState.lastMousePos = { x: e.clientX, y: e.clientY };
            drawGameBoard();
        }
    });
    
    canvas.addEventListener('mouseup', () => {
        if (localState.isDragging) {
            localState.isDragging = false;
            if (!buildModeState) {
                canvas.style.cursor = 'default';
            }
        }
    });
    
    canvas.addEventListener('mouseleave', () => {
        if (localState.isDragging) {
            localState.isDragging = false;
            if (!buildModeState) {
                canvas.style.cursor = 'default';
            }
        }
    });
    
    // Touch support for mobile
    let lastTouchDist = null;
    
    canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            e.preventDefault();
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            lastTouchDist = Math.sqrt(dx * dx + dy * dy);
        } else if (e.touches.length === 1 && !buildModeState) {
            localState.isDragging = true;
            localState.lastMousePos = { 
                x: e.touches[0].clientX, 
                y: e.touches[0].clientY 
            };
        }
    });
    
    canvas.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2) {
            e.preventDefault();
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            if (lastTouchDist) {
                const delta = dist / lastTouchDist;
                localState.canvasZoom = Math.max(0.3, Math.min(3, localState.canvasZoom * delta));
                drawGameBoard();
            }
            lastTouchDist = dist;
        } else if (e.touches.length === 1 && localState.isDragging && !buildModeState) {
            e.preventDefault();
            const dx = e.touches[0].clientX - localState.lastMousePos.x;
            const dy = e.touches[0].clientY - localState.lastMousePos.y;
            localState.canvasOffset.x += dx;
            localState.canvasOffset.y += dy;
            localState.lastMousePos = { 
                x: e.touches[0].clientX, 
                y: e.touches[0].clientY 
            };
            drawGameBoard();
        }
    });
    
    canvas.addEventListener('touchend', () => {
        localState.isDragging = false;
        lastTouchDist = null;
    });
}

// Add window resize handler for responsive canvas
window.addEventListener('resize', handleWindowResize);

function handleWindowResize() {
    const canvas = document.getElementById('game-canvas');
    if (canvas && localState.currentScreen === 'game-screen') {
        // Adjust canvas size based on available space
        const gameLayout = document.querySelector('.game-layout');
        if (gameLayout) {
            const rect = gameLayout.getBoundingClientRect();
            // Set canvas to fill available space while maintaining aspect ratio
            const maxWidth = Math.min(rect.width * 0.6, 900);
            const maxHeight = Math.min(rect.height, 700);
            canvas.width = maxWidth;
            canvas.height = maxHeight;
            drawGameBoard();
        }
    }
    
    const builderCanvas = document.getElementById('map-builder-canvas');
    if (builderCanvas && localState.currentScreen === 'map-builder') {
        initMapBuilderCanvas();
        drawMapBuilder();
    }
}

function drawGameBoard() {
    const canvas = document.getElementById('game-canvas');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const hexSize = 50;
    // Calculate center in screen space BEFORE transformation
    const centerX = canvas.width / 2 / localState.canvasZoom;
    const centerY = canvas.height / 2 / localState.canvasZoom;

    ctx.save();
    ctx.translate(localState.canvasOffset.x, localState.canvasOffset.y);
    ctx.scale(localState.canvasZoom, localState.canvasZoom);

    // Draw tiles
    if (localState.game && localState.game.board && localState.game.board.tiles) {
        localState.game.board.tiles.forEach(tile => {
            drawHexTile(ctx, tile, hexSize, centerX, centerY, false);
        });
    }

    // Draw roads first (under settlements)
    if (localState.game && localState.game.players) {
        localState.game.players.forEach(player => {
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

    // Draw settlements and cities on top
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
        });
    }
    
    // Draw preview if in build mode
    if (buildModeState && buildModeState.previewLocation) {
        const localPlayer = localState.game.players.find(p => p.name === localState.playerName);
        const color = localPlayer ? localPlayer.color : 'white';
        
        if (buildModeState.type === 'settlement') {
            drawSettlementPreview(ctx, buildModeState.previewLocation.vertex, color, centerX, centerY, hexSize);
        } else if (buildModeState.type === 'city') {
            drawCityPreview(ctx, buildModeState.previewLocation.vertex, color, centerX, centerY, hexSize);
        } else if (buildModeState.type === 'road') {
            drawRoadPreview(ctx, buildModeState.previewLocation.edge, color, centerX, centerY, hexSize);
        } else if (buildModeState.type === 'ship') {
            drawShipPreview(ctx, buildModeState.previewLocation.edge, color, centerX, centerY, hexSize);
        }
    }
    
    ctx.restore();
}

function drawHexTile(ctx, tile, size, centerX, centerY, isBuilder) {
    const pos = hexToPixel(tile.x, tile.y, size);
    const x = centerX + pos.x;
    const y = centerY + pos.y;

    // Draw hex outline
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i;
        const hx = x + size * Math.cos(angle);
        const hy = y + size * Math.sin(angle);
        if (i === 0) ctx.moveTo(hx, hy);
        else ctx.lineTo(hx, hy);
    }
    ctx.closePath();
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Load and draw tile image with clipping
    const img = new Image();
    img.src = `/public/images/tiles/${tile.type}.svg`;
    
    // Check if image already cached/loaded
    if (img.complete) {
        drawTileImage(ctx, img, x, y, size, tile, isBuilder);
    } else {
        // Draw background color while loading
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
        ctx.fillStyle = getTileColor(tile.type);
        ctx.fill();
        ctx.restore();
        
        // Draw when image loads
        img.onload = () => {
            drawTileImage(ctx, img, x, y, size, tile, isBuilder);
        };
    }
}

function drawTileImage(ctx, img, x, y, size, tile, isBuilder) {
    ctx.save();
    // Clip to hex shape
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
    
    // Draw image to fill hex
    ctx.drawImage(img, x - size, y - size, size * 2, size * 2);
    ctx.restore();
    
    // Draw number token on top if needed
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
    
    // Draw port if present (after tile image)
    if (!isBuilder && tile.port) {
        drawPort(ctx, tile, tile.port, size, 0, 0, x, y);
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

function drawPort(ctx, tile, port, size, centerX, centerY, tileX, tileY) {
    // If tileX/tileY provided, use them directly, otherwise calculate from tile
    let x, y;
    if (tileX !== undefined && tileY !== undefined) {
        x = tileX;
        y = tileY;
    } else {
        const pos = hexToPixel(tile.x, tile.y, size);
        x = centerX + pos.x;
        y = centerY + pos.y;
    }
    
    // Draw port indicator
    ctx.save();
    ctx.fillStyle = 'rgba(255, 215, 0, 0.8)';
    ctx.strokeStyle = '#8B4513';
    ctx.lineWidth = 3;
    
    // Draw a larger circle/marker for the port on top of tile
    ctx.beginPath();
    ctx.arc(x, y - size * 0.5, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    
    // Draw port text
    ctx.fillStyle = '#000';
    ctx.font = 'bold 12px Nunito';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(port.type, x, y - size * 0.5);
    
    ctx.restore();
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

    // Load and draw settlement SVG
    const img = new Image();
    img.src = '/public/images/settlement.svg';
    
    // Draw immediately or when loaded
    if (img.complete) {
        drawColoredSVG(ctx, img, x - 15, y - 15, 30, 30, color);
    } else {
        img.onload = () => {
            drawColoredSVG(ctx, img, x - 15, y - 15, 30, 30, color);
        };
    }
}

function drawCity(ctx, vertex, color, centerX, centerY, hexSize) {
    const pos = vertexToPixel(vertex, hexSize);
    const x = centerX + pos.x;
    const y = centerY + pos.y;

    // Load and draw city SVG
    const img = new Image();
    img.src = '/public/images/city.svg';
    
    if (img.complete) {
        drawColoredSVG(ctx, img, x - 20, y - 20, 40, 40, color);
    } else {
        img.onload = () => {
            drawColoredSVG(ctx, img, x - 20, y - 20, 40, 40, color);
        };
    }
}

function drawColoredSVG(ctx, img, x, y, width, height, color) {
    // Create a temporary canvas to colorize the SVG
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d');
    
    // Draw the image
    tempCtx.drawImage(img, 0, 0, width, height);
    
    // Apply color overlay
    tempCtx.globalCompositeOperation = 'source-in';
    tempCtx.fillStyle = color;
    tempCtx.fillRect(0, 0, width, height);
    
    // Draw to main canvas
    ctx.drawImage(tempCanvas, x, y);
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

// Preview drawing functions
function drawSettlementPreview(ctx, vertex, color, centerX, centerY, hexSize) {
    if (!vertex) return;
    const pos = vertexToPixel(vertex, hexSize);
    const x = centerX + pos.x;
    const y = centerY + pos.y;

    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = color;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    
    // Draw house shape
    ctx.beginPath();
    ctx.rect(x - 10, y - 5, 20, 15);
    ctx.fill();
    ctx.stroke();
    
    // Draw roof
    ctx.beginPath();
    ctx.moveTo(x - 12, y - 5);
    ctx.lineTo(x, y - 15);
    ctx.lineTo(x + 12, y - 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    
    ctx.restore();
}

function drawCityPreview(ctx, vertex, color, centerX, centerY, hexSize) {
    if (!vertex) return;
    const pos = vertexToPixel(vertex, hexSize);
    const x = centerX + pos.x;
    const y = centerY + pos.y;

    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = color;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    
    // Draw larger building with towers
    ctx.beginPath();
    ctx.rect(x - 15, y - 10, 30, 20);
    ctx.fill();
    ctx.stroke();
    
    ctx.beginPath();
    ctx.rect(x - 18, y - 15, 10, 10);
    ctx.fill();
    ctx.stroke();
    
    ctx.beginPath();
    ctx.rect(x + 8, y - 15, 10, 10);
    ctx.fill();
    ctx.stroke();
    
    ctx.restore();
}

function drawRoadPreview(ctx, edge, color, centerX, centerY, hexSize) {
    if (!edge) return;
    const start = vertexToPixel(edge.start, hexSize);
    const end = vertexToPixel(edge.end, hexSize);

    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = color;
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(centerX + start.x, centerY + start.y);
    ctx.lineTo(centerX + end.x, centerY + end.y);
    ctx.stroke();
    
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
}

function drawShipPreview(ctx, edge, color, centerX, centerY, hexSize) {
    if (!edge) return;
    const start = vertexToPixel(edge.start, hexSize);
    const end = vertexToPixel(edge.end, hexSize);
    const midX = (start.x + end.x) / 2;
    const midY = (start.y + end.y) / 2;

    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = color;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    
    ctx.beginPath();
    ctx.moveTo(centerX + midX - 12, centerY + midY);
    ctx.lineTo(centerX + midX + 12, centerY + midY);
    ctx.lineTo(centerX + midX, centerY + midY - 18);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
}

function vertexToPixel(vertex, hexSize) {
    return { x: vertex.x * hexSize, y: vertex.y * hexSize };
}

// ===== GAME DISPLAY UPDATE =====

function updateGameDisplay() {
    if (!localState.game || !localState.game.players) return;

    const currentPlayer = localState.game.players[localState.game.currentPlayerIndex];
    document.getElementById('current-turn-player').textContent = currentPlayer.name;
    
    // Display setup phase information
    if (localState.game.phase === 'initial-placement' && localState.game.setupPhase) {
        const setupInfo = localState.game.setupPhase;
        const action = setupInfo.placementType === 'settlement' ? 'settlement' : 'road';
        const round = setupInfo.round === 1 ? '1st' : '2nd';
        document.getElementById('game-phase').textContent = 
            `Setup Round ${round}: Place ${action}`;
    } else {
        document.getElementById('game-phase').textContent = localState.game.phase;
    }

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

    // Update local player resources - auto-find player if not cached
    const myPlayer = localState.game.localPlayer || 
                     localState.game.players.find(p => p.name === localState.playerName);
    
    if (myPlayer) {
        // Cache for next time
        if (!localState.game.localPlayer) {
            localState.game.localPlayer = myPlayer;
        }
        
        const resources = myPlayer.resources || {};
        document.getElementById('wood-count').textContent = resources.wood || 0;
        document.getElementById('brick-count').textContent = resources.brick || 0;
        document.getElementById('sheep-count').textContent = resources.sheep || 0;
        document.getElementById('wheat-count').textContent = resources.wheat || 0;
        document.getElementById('ore-count').textContent = resources.ore || 0;

        // Update development cards
        const devCardsContainer = document.getElementById('dev-cards-container');
        devCardsContainer.innerHTML = '';
        const devCards = myPlayer.developmentCards || [];
        devCards.forEach((card, index) => {
            const cardDiv = document.createElement('div');
            cardDiv.className = 'dev-card';
            cardDiv.textContent = card.replace(/-/g, ' ').toUpperCase();
            cardDiv.onclick = () => playDevelopmentCard(index);
            devCardsContainer.appendChild(cardDiv);
        });
    }

    updateActionButtons();
}

function updateActionButtons() {
    if (!localState.game) return;
    
    const currentPlayer = localState.game.players[localState.game.currentPlayerIndex];
    const isCurrentPlayer = currentPlayer.name === localState.playerName;
    const isSetup = localState.game.phase === 'initial-placement';
    
    // Get player resources - auto-find if needed
    const myPlayer = localState.game.localPlayer || 
                     localState.game.players.find(p => p.name === localState.playerName);
    const resources = myPlayer ? myPlayer.resources : null;

    // Disable dice rolling during setup
    document.getElementById('roll-dice-btn').disabled = 
        !isCurrentPlayer || localState.game.phase !== 'roll';
    
    // Disable end turn during setup
    document.getElementById('end-turn-btn').disabled = 
        !isCurrentPlayer || localState.game.phase === 'roll' || isSetup;
    
    // Enable settlement/road building for current player during setup
    if (isSetup && localState.game.setupPhase) {
        const needsSettlement = localState.game.setupPhase.placementType === 'settlement';
        const needsRoad = localState.game.setupPhase.placementType === 'road';
        
        document.getElementById('build-settlement-btn').disabled = !isCurrentPlayer || !needsSettlement;
        document.getElementById('build-road-btn').disabled = !isCurrentPlayer || !needsRoad;
        document.getElementById('build-city-btn').disabled = true; // No cities during setup
        document.getElementById('trade-btn').disabled = true; // No trading during setup
        document.getElementById('dev-card-btn').disabled = true; // No dev cards during setup
    } else {
        // Check resource requirements for each action
        const canBuildSettlement = resources && 
            resources.wood >= 1 && resources.brick >= 1 && 
            resources.sheep >= 1 && resources.wheat >= 1;
        const canBuildCity = resources && 
            resources.wheat >= 2 && resources.ore >= 3;
        const canBuildRoad = resources && 
            resources.wood >= 1 && resources.brick >= 1;
        const canBuildShip = resources && 
            resources.wood >= 1 && resources.sheep >= 1;
        const canBuyDevCard = resources && 
            resources.sheep >= 1 && resources.wheat >= 1 && resources.ore >= 1;
        
        document.getElementById('build-settlement-btn').disabled = 
            !isCurrentPlayer || !canBuildSettlement;
        document.getElementById('build-city-btn').disabled = 
            !isCurrentPlayer || !canBuildCity;
        document.getElementById('build-road-btn').disabled = 
            !isCurrentPlayer || !canBuildRoad;
        document.getElementById('trade-btn').disabled = !isCurrentPlayer;
        document.getElementById('dev-card-btn').disabled = 
            !isCurrentPlayer || !canBuyDevCard;
            
        if (localState.game.settings.expansions.seafarers) {
            document.getElementById('build-ship-btn').style.display = 'block';
            document.getElementById('build-ship-btn').disabled = 
                !isCurrentPlayer || !canBuildShip;
        }
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

let buildModeState = null;

function startBuildMode(type) {
    showMessage(`🏗️ Click on the board to place ${type}`);
    
    const canvas = document.getElementById('game-canvas');
    buildModeState = { type, previewLocation: null };
    
    // Remove old handlers
    canvas.onmousemove = (event) => handleBuildModeMouseMove(event, type);
    canvas.onclick = (event) => handleGameBoardClick(event, type);
    canvas.onmouseleave = () => {
        buildModeState.previewLocation = null;
        drawGameBoard();
    };
}

function handleBuildModeMouseMove(event, type) {
    const canvas = event.target;
    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    
    const hexSize = 50;
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    
    // Account for zoom and pan - correct transformation order
    const x = ((mouseX - localState.canvasOffset.x) / localState.canvasZoom);
    const y = ((mouseY - localState.canvasOffset.y) / localState.canvasZoom);
    
    if (type === 'settlement' || type === 'city') {
        const vertex = pixelToNearestVertex(x, y, centerX, centerY, hexSize);
        buildModeState.previewLocation = { vertex };
    } else if (type === 'road' || type === 'ship') {
        const edge = pixelToNearestEdge(x, y, centerX, centerY, hexSize);
        buildModeState.previewLocation = { edge };
    }
    
    drawGameBoard();
}

function pixelToNearestVertex(px, py, centerX, centerY, hexSize) {
    const relX = px - centerX;
    const relY = py - centerY;
    
    // Get all potential vertices from nearby tiles
    const tiles = localState.game.board.tiles;
    let closestVertex = null;
    let minDist = Infinity;
    
    tiles.forEach(tile => {
        const vertices = getHexVertices(tile.x, tile.y, hexSize);
        vertices.forEach(v => {
            const vPixel = vertexToPixel(v, hexSize);
            const dist = Math.sqrt(
                Math.pow(vPixel.x - relX, 2) + 
                Math.pow(vPixel.y - relY, 2)
            );
            if (dist < minDist && dist < hexSize * 0.5) {
                minDist = dist;
                closestVertex = v;
            }
        });
    });
    
    return closestVertex;
}

function pixelToNearestEdge(px, py, centerX, centerY, hexSize) {
    const relX = px - centerX;
    const relY = py - centerY;
    
    const tiles = localState.game.board.tiles;
    let closestEdge = null;
    let minDist = Infinity;
    
    tiles.forEach(tile => {
        const edges = getHexEdges(tile.x, tile.y, hexSize);
        edges.forEach(edge => {
            // Find midpoint of edge
            const start = vertexToPixel(edge.start, hexSize);
            const end = vertexToPixel(edge.end, hexSize);
            const midX = (start.x + end.x) / 2;
            const midY = (start.y + end.y) / 2;
            
            const dist = Math.sqrt(
                Math.pow(midX - relX, 2) + 
                Math.pow(midY - relY, 2)
            );
            if (dist < minDist && dist < hexSize * 0.4) {
                minDist = dist;
                closestEdge = edge;
            }
        });
    });
    
    return closestEdge;
}

function getHexVertices(q, r, hexSize) {
    const vertices = [];
    for (let i = 0; i < 6; i++) {
        const angleDeg = 60 * i;
        const angleRad = Math.PI / 180 * angleDeg;
        vertices.push({
            x: q + Math.cos(angleRad),
            y: r + Math.sin(angleRad)
        });
    }
    return vertices;
}

function getHexEdges(q, r, hexSize) {
    const vertices = getHexVertices(q, r, hexSize);
    const edges = [];
    for (let i = 0; i < 6; i++) {
        edges.push({
            start: vertices[i],
            end: vertices[(i + 1) % 6]
        });
    }
    return edges;
}

function handleGameBoardClick(event, type) {
    if (!buildModeState || !buildModeState.previewLocation) {
        showMessage('⚠️ Invalid location');
        return;
    }
    
    const location = buildModeState.previewLocation;

    // Client-side validation for settlements
    if (type === 'settlement') {
        const validation = validateSettlementPlacementClient(location.vertex);
        if (!validation.valid) {
            showMessage(`❌ ${validation.reason}`);
            return;
        }
    }

    // Check if we're in initial placement phase
    if (localState.game.phase === 'initial-placement') {
        socket.emit('placeInitial', {
            gameCode: localState.gameCode,
            type,
            location
        });
    } else {
        socket.emit('buildStructure', {
            gameCode: localState.gameCode,
            type,
            location
        });
    }

    // Clean up
    const canvas = event.target;
    canvas.onclick = null;
    canvas.onmousemove = null;
    canvas.onmouseleave = null;
    buildModeState = null;
    drawGameBoard();
}

function validateSettlementPlacementClient(vertex) {
    if (!vertex) {
        return { valid: false, reason: 'No valid vertex selected' };
    }

    // Check distance rule: no settlement within 2 edges
    const allSettlements = [];
    localState.game.players.forEach(player => {
        if (player.settlements) {
            allSettlements.push(...player.settlements.map(s => s.vertex));
        }
    });

    for (const existingVertex of allSettlements) {
        const distance = calculateVertexDistance(vertex, existingVertex);
        if (distance < 0.1) {
            return { valid: false, reason: 'Vertex already occupied' };
        }
        // Check if vertices share an edge (are adjacent)
        if (distance < 1.5) {
            return { valid: false, reason: 'Too close to another settlement (must be 2 edges away)' };
        }
    }

    return { valid: true };
}

function calculateVertexDistance(v1, v2) {
    return Math.sqrt(Math.pow(v1.x - v2.x, 2) + Math.pow(v1.y - v2.y, 2));
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

function acceptTrade() {
    showMessage('✅ Trade accepted!');
    closeTradeDialog();
}

function declineTrade() {
    showMessage('❌ Trade declined!');
    closeTradeDialog();
}

function buyDevelopmentCard() {
    showMessage('🎴 Development card purchased!');
}

function playDevelopmentCard(index) {
    showMessage('✨ Development card played!');
}

// ===== INITIALIZATION =====

// Expose functions globally for HTML onclick handlers
window.showScreen = showScreen;
window.createGame = createGame;
window.joinGame = joinGame;
window.startGame = startGame;
window.leaveLobby = leaveLobby;
window.selectTile = selectTile;
window.selectPort = selectPort;
window.enableDeleteMode = enableDeleteMode;
window.saveMap = saveMap;
window.loadMap = loadMap;
window.clearMap = clearMap;
window.loadDefaultLayout = function() {
    localState.mapTemplate = generateDefaultMapTemplate();
    drawMapBuilder();
    showMessage('✨ Default layout loaded!');
};
window.rollDice = rollDice;
window.endTurn = endTurn;
window.startBuildMode = startBuildMode;
window.openTradeDialog = openTradeDialog;
window.closeTradeDialog = closeTradeDialog;
window.switchTradeTab = switchTradeTab;
window.proposeTrade = proposeTrade;
window.executeBankTrade = executeBankTrade;
window.acceptTrade = acceptTrade;
window.declineTrade = declineTrade;
window.buyDevelopmentCard = buyDevelopmentCard;

window.onload = function() {
    console.log('🏝️ Catan Online - Studio Ghibli Edition loaded!');
    
    // Load saved player name into forms
    loadPlayerNameIntoForms();
    
    // Initialize map builder canvas if on that screen
    const builderCanvas = document.getElementById('builder-canvas');
    if (builderCanvas && localState.currentScreen === 'map-builder') {
        localState.mapTemplate = generateDefaultMapTemplate();
        drawMapBuilder();
    }
};

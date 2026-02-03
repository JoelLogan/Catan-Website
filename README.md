# Catan Online - Web-Based Board Game

A fully-featured, browser-based implementation of the popular board game Catan, supporting 2-8 players with customizable settings, expansions, and a map builder.

## Features

### 🎮 Core Gameplay
- **2-8 Player Support**: Flexible player count from 2 to 8 players
- **Hexagonal Board**: Beautiful HTML5 Canvas rendering of the game board
- **Resource Management**: Full implementation of all 5 resource types (Wood, Brick, Sheep, Wheat, Ore)
- **Building System**: Place settlements, cities, roads, and ships
- **Dice Rolling**: Dynamic dice rolling with automatic resource distribution
- **Development Cards**: Complete card system including Knights, Victory Points, Road Building, Year of Plenty, and Monopoly
- **Victory Tracking**: Customizable victory point requirements (5-20 points)

### 🌊 Expansions
- **Seafarers**: Build ships, explore water tiles, and discover new territories
- **Cities & Knights**: Enhanced gameplay with knight pieces and additional mechanics

### 🎯 Lobby System
- **Join Codes**: Share 6-digit codes to invite friends
- **Host Controls**: Complete control over game settings before starting
- **Player Management**: See all players in the lobby with color coding

### 🗺️ Map Builder
- **Custom Maps**: Create your own board layouts
- **Save/Load**: Persistent map storage using browser localStorage
- **Randomizer**: Generate random maps on demand
- **Tile Selection**: Choose from Wood, Brick, Sheep, Wheat, Ore, Desert, Water, and Gold tiles
- **Number Placement**: Assign production numbers to tiles

### 🤝 Trading System
- **Player Trading**: Propose trades with other players
- **Bank Trading**: Standard 4:1 trades with the bank
- **Port Trading**: Special 2:1 or 3:1 trades when you control ports

### ⚙️ Customization
- **Game Pieces**: Configure the number of each piece type per player:
  - Settlements (1-10)
  - Cities (1-10)
  - Roads (1-30)
  - Ships (0-30)
  - Knights (0-10)

## How to Play

### Starting a Game

1. **Open the Game**
   - Open `index.html` in any modern web browser
   - No server or installation required!

2. **Create a Game**
   - Click "Create Game"
   - Enter your player name
   - Configure settings:
     - Max players (2-8)
     - Victory points to win (5-20)
     - Expansions (Seafarers, Cities & Knights)
     - Game pieces per player
     - Map selection
   - Click "Create Game" to generate a 6-digit join code

3. **Join a Game**
   - Click "Join Game"
   - Enter your player name
   - Enter the 6-digit game code
   - Click "Join Game"

4. **Start Playing**
   - Host clicks "Start Game" when all players have joined (minimum 2 players)
   - Game begins in setup phase

### Gameplay

1. **Setup Phase**
   - Players place initial settlements and roads
   - Click "Build Settlement" and click on the board

2. **Main Game**
   - **Roll Dice**: Click to roll and distribute resources
   - **Build**: Place settlements, cities, roads, or ships
   - **Trade**: Open trade dialog to trade with players, bank, or ports
   - **Buy Dev Card**: Purchase development cards with resources
   - **End Turn**: Pass to the next player

3. **Winning**
   - First player to reach the victory point target wins!

## Building Costs

- **Settlement**: 1 Wood, 1 Brick, 1 Sheep, 1 Wheat
- **City**: 2 Wheat, 3 Ore (upgrades a settlement)
- **Road**: 1 Wood, 1 Brick
- **Ship**: 1 Wood, 1 Sheep (Seafarers only)
- **Development Card**: 1 Sheep, 1 Wheat, 1 Ore

## Map Builder

1. Click "Map Builder" from the main menu
2. Select a tile type (Wood, Brick, Sheep, etc.)
3. Select a production number (2-12, excluding 7)
4. Click on hexagons to place tiles
5. Click "Save Map" to save your creation
6. Click "Load Map" to load previously saved maps
7. Click "Randomize" to generate a random map
8. Click "Clear Map" to start over

## Technical Details

- **Technologies**: HTML5, CSS3, JavaScript (ES6+)
- **Canvas API**: For rendering the hexagonal game board
- **LocalStorage**: For saving custom maps
- **No Backend Required**: Fully client-side implementation

## Browser Compatibility

Works in all modern browsers:
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Future Enhancements

Potential additions for multiplayer support:
- WebSocket integration for real-time multiplayer
- Online matchmaking
- Player statistics and leaderboards
- Additional expansions
- Mobile-responsive design improvements

## Credits

Inspired by the classic board game Settlers of Catan by Klaus Teuber.

## License

This is a fan-made project for educational purposes.
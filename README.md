# Catan Online - Studio Ghibli Edition 🏝️

A beautiful, server-based multiplayer implementation of the board game Catan, featuring a whimsical Studio Ghibli-inspired aesthetic and real-time multiplayer gameplay.

## ✨ Features

### 🎮 True Multiplayer Experience
- **Real-time multiplayer** via Socket.IO
- **Working join codes** - Share 6-digit codes to invite friends
- **2-8 player support** with live lobby updates
- **Server-side validation** - No cheating possible!
- **Synchronized game state** across all connected players

### 🎨 Studio Ghibli Aesthetic
- **Hand-drawn tile images** - Beautiful SVG artwork for all resources
- **Whimsical UI design** - Soft pastels, floating clouds, glowing sun
- **Smooth animations** - Button ripples, dice rolls, screen transitions
- **Custom fonts** - Patrick Hand for headers, Nunito for body
- **Nature-inspired palette** - Sky blues, forest greens, golden yellows

### 🗺️ Server-Side Map Builder
- **Restricted tile placement** - Only water, land placeholders, and ports
- **Server randomization** - Resources assigned when game starts
- **Save/Load functionality** - Store custom map templates on server
- **Default layouts** - Quick start with standard Catan setup

### 🏗️ Complete Game Features
- Hexagonal board with resource tiles
- Dice rolling with resource distribution
- Building settlements, cities, roads, and ships
- Development cards system
- Three-way trading (player, bank, port)
- Victory points tracking
- Expansions: Seafarers & Cities & Knights
- Customizable game pieces per player
- Host-controlled match settings

## 🚀 Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/JoelLogan/Catan-Website.git
cd Catan-Website

# Install dependencies
npm install

# Start the server
npm start
```

The server will start on port 3000. Visit `http://localhost:3000` in your browser.

### Playing the Game

1. **Host Creates Game**
   - Click "Create Game"
   - Enter your name and configure settings
   - Select expansions and customize game pieces
   - Click "Create Game" to get a 6-digit join code

2. **Players Join**
   - Click "Join Game"
   - Enter name and the host's 6-digit code
   - Click "Join Game"

3. **Start Playing**
   - Host clicks "Start Game" when ready
   - Map is randomized server-side
   - Take turns building and trading to victory!

## 🏗️ Architecture

### Server-Side (`server.js`)
- **Express.js** web server
- **Socket.IO** for real-time communication
- Game session management
- Map randomization algorithm
- Turn validation and enforcement
- Resource distribution logic
- Building and trading validation

### Client-Side (`client.js`)
- Socket.IO client
- Real-time event handling
- Canvas-based board rendering
- Local UI state management
- Optimistic updates with server confirmation

### Visual Assets (`public/images/tiles/`)
- Hand-drawn SVG tiles for each resource type:
  - 🌲 Wood (forest)
  - 🧱 Brick (clay)
  - 🐑 Sheep (pasture)
  - 🌾 Wheat (fields)
  - ⛰️ Ore (mountains)
  - 🏜️ Desert (sand)
  - 🌊 Water (ocean)
  - ❓ Land Placeholder (for randomization)

## 🎯 Map Builder Usage

The map builder is designed for creating island layouts:

1. **Place Tiles**
   - 🌊 **Water** - Ocean tiles around the island
   - 🏞️ **Land Placeholder** - Will become random resources when game starts

2. **Add Ports** ⚓
   - 3:1 Generic ports
   - 2:1 Resource-specific ports (Wood, Brick, Sheep, Wheat, Ore)

3. **Save Your Map** 💾
   - Maps are stored server-side
   - Load them for future games

**Note:** You cannot place specific resources in the builder. All land tiles are randomized by the server when the game starts, ensuring fair gameplay!

## 🎨 Design Philosophy

Inspired by Studio Ghibli films, the game features:
- **Natural color gradients** - Sky to field transitions
- **Soft, rounded shapes** - Friendly and inviting
- **Whimsical details** - Floating clouds, glowing sun, hand-drawn tiles
- **Smooth animations** - Everything feels alive and responsive
- **Pastel palette** - Easy on the eyes, magical atmosphere

## 🔧 Technical Details

### Dependencies
- `express` ^4.18.2 - Web server framework
- `socket.io` ^4.6.1 - Real-time bidirectional communication

### Port Configuration
Default port: 3000 (configurable via PORT environment variable)

### Game State Storage
- In-memory game sessions (resets on server restart)
- Map templates stored server-side
- Player connections tracked per session

### Security Features
- All game actions validated server-side
- Turn enforcement
- Resource count verification
- Building placement validation
- No client-side game state manipulation

## 🎮 Game Rules Implemented

### Building Costs
- **Settlement**: 1 Wood, 1 Brick, 1 Sheep, 1 Wheat
- **City**: 2 Wheat, 3 Ore (upgrades settlement)
- **Road**: 1 Wood, 1 Brick
- **Ship**: 1 Wood, 1 Sheep (Seafarers expansion)
- **Development Card**: 1 Sheep, 1 Wheat, 1 Ore

### Victory Points
- Settlement: 1 VP
- City: 2 VP (1 additional from settlement)
- Victory Point cards
- Longest Road (2 VP)
- Largest Army (2 VP)

### Trading
- **Player-to-Player**: Propose any trade
- **Bank Trade**: 4:1 ratio (4 of one resource for 1 of another)
- **Port Trade**: 3:1 or 2:1 (depends on port type)

## 🌟 What's Different from Standard Catan?

This implementation is fully digital with several enhancements:
- **Server-side fairness** - No manual shuffling or cheating
- **Instant resource distribution** - No counting needed
- **Automatic validation** - Can't build where you shouldn't
- **Real-time multiplayer** - Play with friends anywhere
- **Custom map templates** - Create unique island layouts
- **Flexible player counts** - 2-8 players supported

## 📱 Browser Compatibility

Tested and working on:
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

Requires modern browser with:
- HTML5 Canvas support
- WebSocket support
- ES6 JavaScript

## 🐛 Known Limitations

- Game state resets on server restart (no persistence)
- Single server instance (no horizontal scaling)
- No spectator mode
- No game replay feature
- No AI players

## 🤝 Contributing

This is a fan-made educational project. Catan is a trademark of Catan GmbH.

## 📜 License

MIT License - See LICENSE file for details

## 🎭 Credits

- Original board game by Klaus Teuber
- Inspired by Studio Ghibli's art style
- Built with love for board games and beautiful design

---

**Enjoy building your island empire!** 🏝️🎮✨
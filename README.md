# Catan Online 🏝️

A real-time multiplayer implementation of *The Settlers of Catan* that runs in the browser: 2–8 players, the **Seafarers** and **Cities & Knights** expansions, bot opponents, and a map builder, all with a storybook, Studio-Ghibli-inspired look.

> A fan-made, non-commercial project. Catan is a trademark of Catan GmbH.

## Features

- **Join codes & invite links.** The host creates a game and shares a 6-character code (or a `https://…/#CODE` link).
- **Host-controlled lobby.** Players, victory points, map, expansions, pieces per player (settlements, cities, roads, ships), discard limit, special building phase, turn order and island bonus. Everyone sees the settings update live.
- **Bots.** Add AI players to fill seats or play solo.
- **Complete base rules.** Snake-order setup; production with the bank-shortage rule; the robber and discarding on 7; development cards (Knight, Road Building, Year of Plenty, Monopoly, hidden Victory Points); Longest Road and Largest Army; 4:1 bank trades plus 3:1/2:1 harbors; player trades with counter-offers; and the 5–6 player special building phase.
- **Seafarers.** Ships (build, and move open ships), the pirate, gold fields, an island bonus, and longest trade routes that combine roads and ships.
- **Cities & Knights.** Commodities, three city-improvement tracks with the Trading House, Fortress and Aqueduct, metropolises, knights (recruit, promote, activate, move, displace, chase the robber), barbarian attacks, the Defender of Catan, city walls, the event die, and all 54 progress cards.
- **Map builder.** Paint sea, random land or fixed terrain (including gold); place and rotate harbors; add a sea border. Save maps to the server, open saved maps, or import/export JSON files. Built-in maps are provided for 3–4, 5–6 and 7–8 players, plus an islands map for Seafarers.
- **Resilient sessions.** A reload or dropped connection resumes the game automatically. Players who stay away longer than the grace period are played safely by the server, so a game never stalls. Games survive server restarts.
- **Full-screen board.** The board fills the screen. Light overlays hold everything else: a player strip, a status pill, a bottom dock with your cards and actions, pop-up build trays, and a slide-out drawer for the log, chat, cards and game info. On phones the board gets the whole screen: pinch to zoom, drag to pan, and legal spots are highlighted.
- **Animations.** Tiles reveal at the start, pieces drop onto the board with a ripple in their owner's color, and the robber and pirate slide between hexes. Dice tumble and the producing tiles glow. Cards fly between the board, the bank and players' hands for production, trades, steals, discards and dev-card purchases. All motion is disabled when the system asks for reduced motion.
- **Day and dusk themes**, switchable from the top bar or the in-game menu.

## Quick start

Requires **Node.js 22 or newer**.

```bash
npm install
npm start          # http://localhost:3000
```

For development, `npm run dev` restarts the server on file changes.

### Docker

```bash
docker build -t catan-online .
docker run -p 3000:3000 -v catan-data:/app/data catan-online
```

## Configuration

All settings are optional environment variables.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Listen address |
| `NODE_ENV` | – | Set to `production` for HSTS, `upgrade-insecure-requests` and static caching |
| `DATA_DIR` | `./data` | Where saved maps and in-progress games are stored |
| `PERSIST` | `true` | Set `false` to keep everything in memory |
| `TRUST_PROXY` | `0` | Number of reverse proxies in front of the app (for correct client IPs in rate limiting) |
| `ALLOWED_ORIGINS` | – | Extra comma-separated origins allowed to open socket connections |
| `MAX_ROOMS` | `500` | Maximum concurrent games |
| `MAX_MAPS` / `MAX_MAPS_PER_OWNER` | `1000` / `50` | Saved-map limits |
| `MAX_CONNECTIONS_PER_IP` | `30` | Concurrent socket connections per address |
| `JOIN_BURST` / `JOIN_PER_MINUTE` | `10` / `10` | Create/join/resume attempts per address (limits code guessing) |
| `EVENT_BURST` / `EVENT_PER_SECOND` | `40` / `15` | Socket events per connection |
| `AFK_GRACE_MS` | `60000` | How long a disconnected player's turn waits before the server plays for them |
| `BOT_DELAY_MS` | `700` | Pause between bot moves |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` or `silent` (logs are JSON lines) |

`GET /healthz` returns `{ ok, uptime, rooms, maps }` for load balancers and container health checks.

Behind a reverse proxy, forward WebSocket upgrades (`Upgrade`/`Connection` headers) for `/socket.io/`, and set `TRUST_PROXY=1`.

## Architecture

```
shared/        Code used by both server and browser
  hex.js         Integer hex lattice: exact vertex/edge ids, pixel mapping
  templates.js   Map template validation + built-in maps
  constants.js   Resources, costs, limits
src/
  engine/        Pure, deterministic rules engine (no I/O)
    game.js        State machine and base/Seafarers rules
    ck.js          Cities & Knights
    board.js       Randomized board generation (balanced number placement)
    view.js        Per-player views that hide private information
    bot.js         Heuristic player (bots, AFK play, simulations)
  server/        Express + Socket.IO
    app.js         HTTP, security headers, static files
    sockets.js     Event validation, rate limiting, room binding
    rooms.js       Lobby, host controls, automation, persistence
    mapStore.js    Saved maps with owner keys
public/        Browser client (ES modules, no build step)
test/          Unit, rules, simulation and server integration tests
e2e/           Browser smoke test
scripts/       Maintenance scripts
```

The server is **authoritative**. Clients send intents (`{type: 'build', piece: 'road', at: '<edge id>'}`); the engine validates every action and sends each player a personal view. The view includes the legal spots for that player's next move, which the client highlights.

## Security

- Only `public/` and `shared/` are served over HTTP; source, data and configuration are not reachable.
- A strict Content-Security-Policy with no inline scripts or event handlers. The client renders all user-provided text (names, chat, map names) through text nodes, never `innerHTML`.
- Seats are protected by random 256-bit resume tokens, stored hashed on the server. Knowing someone's name or the room code does not let you take their seat.
- Every socket payload is type-checked and every game action is validated by the engine. Payloads are size-limited, events are rate-limited per connection and per address, and cross-origin socket connections are refused.
- Saved maps get server-generated ids, so user input never becomes a file path. Only the creator can overwrite or delete a map (by holding a secret browser key; only its hash is stored). Files are written atomically.
- Dependencies are kept current; CI runs `npm audit`.

## Testing

```bash
npm run lint
npm test       # engine rules, full bot games (2–8 players, all expansions), server integration
npm run e2e    # plays a whole game in a real browser (set CHROMIUM_PATH if Chromium is not installed via Playwright)
```

The simulation tests play dozens of complete games with bots in every configuration while checking invariants: cards are never created or destroyed, the distance rule and piece limits hold, and no view leaks hidden information.

## Migrating maps from the old version

Maps saved by the previous version (the `saved-maps/` folder) can be imported once:

```bash
node scripts/import-legacy-maps.js ./saved-maps
```

## Known limitations

- Games are hosted on a single server process (no horizontal scaling).
- Progress cards whose physical version needs table talk use prompts; a few rare timing subtleties of Cities & Knights are simplified. For example, the current player may hold more than 4 progress cards during their own turn and must discard down to 4 before ending it.
- There is no spectator mode.

## License

MIT

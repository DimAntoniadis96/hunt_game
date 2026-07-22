# MimicHunt 🎭

A polished, **browser-based multiplayer prop-hunt** game. Props disguise as
warehouse objects; hunters track them down. Runs from a URL in a modern desktop
browser — no install. **Authoritative server**, original name/art/audio/maps.

> Status: **Phase 1 (architecture) + Phase 2 (minimum playable prototype)** are
> complete and verified end-to-end (server integration test + headless browser
> test both green). See `docs/ARCHITECTURE.md` for the full design.

---

## What works right now

- Lobby → **create private room** / **quick play (public)** / **join by 5-char code**
- Ready-up → automatic **team assignment** (Props vs Hunters), team **role swap** each round
- Round state machine: **Lobby → Countdown → Prep (30s) → Hunt → Round End → Match End**
- **First-person movement** (WASD + mouse look, pointer lock, jump, collisions)
- **Props:** disguise as nearby objects (`E`), lock rotation (`R`), taunt (`T`)
- **Hunters:** shoot (`left-click`), reload (`R`), limited ammo, **penalty for shooting real furniture**
- **Server-authoritative** hitscan, damage, elimination, fire-rate, movement validation (anti speed-hack / teleport)
- HUD (phase, timer, props-alive, health, ammo, crosshair, killfeed, ping), **scoreboard** (`Tab`), spectate on death
- Placeholder **procedural audio** (zero copyrighted assets), reconnection window, disconnect handling

---

## Requirements

- **Node.js ≥ 18** (18/20/22 all fine)
- A modern desktop browser with **WebGL2** + **Pointer Lock** (Chrome, Edge, Firefox)

## Install

```bash
npm install
```

This installs all three workspaces (`shared`, `server`, `client`).

## Run (development)

```bash
npm run dev
```

This builds the shared package, then runs **in parallel**: the shared watcher,
the game server (`ws://localhost:2567`), and the Vite client (`http://localhost:5173`).

Open **two browser tabs/windows** at <http://localhost:5173>:

1. Tab 1: enter a name → **Create private room** → copy the 5-char code.
2. Tab 2: enter a name → paste the code → **Join**.
3. Both tabs: **Ready up**. After a short countdown the match starts.
4. Click **Enter game** to lock the mouse. Play. `Esc` releases the mouse.

> Tip: to test alone, open two tabs (or a normal + incognito window). `MIN_PLAYERS_TO_START`
> is 2 for easy local testing — raise it in `packages/shared/src/constants.ts` for production.

## Build (production)

```bash
npm run build        # builds shared, client (dist/), and server (dist/)
npm start            # runs the compiled server (packages/server/dist)
```

The static client is `packages/client/dist/` — deploy it to any static host/CDN.
Set `VITE_SERVER_URL` before building the client to point at your `wss://` server.

## Environment variables

Copy the examples and adjust:

```bash
cp packages/server/.env.example packages/server/.env
cp packages/client/.env.example packages/client/.env
```

| Var | Where | Meaning |
| --- | --- | --- |
| `PORT` | server | Port to listen on (default 2567) |
| `NODE_ENV` | server | `development` / `production` |
| `CORS_ORIGIN` | server | Comma-separated allowed browser origins (your site). `*` for local dev only. |
| `VITE_SERVER_URL` | client (build-time) | `ws://localhost:2567` locally, `wss://game.yourdomain.com` in prod |

**Never** put secrets in the client — only `VITE_`-prefixed vars are exposed, and
those are public by definition.

## Test

```bash
# 1) Server integration test (2 headless clients, no browser). Server auto-uses :2567.
npm start &                       # or: npm run dev
node tests/smoke.mjs

# 2) Full browser end-to-end (2 tabs play a match). Needs Playwright once:
npm i -D playwright && npx playwright install chromium
#   then serve the built client and run:
npm run build && npx vite preview --port 5173 --outDir packages/client/dist &
node tests/e2e.mjs
```

Both tests assert room creation, join-by-code, team assignment, the round state
machine, movement validation, and (for e2e) live WebGL rendering.

## Docker (server)

```bash
docker compose up --build         # server on :2567 (+ optional redis, commented)
```

## Deploying

Short version: **client = static files on a CDN** (Cloudflare/Netlify/Vercel),
**server = a persistent Node process with a TLS/`wss://` front** (Fly.io / Railway
/ Render web-service / VPS). They scale differently. Full walkthrough — DNS, SSL,
env, scaling, monitoring — is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §8.

## Controls

| Key | Action |
| --- | --- |
| `W A S D` | Move |
| Mouse | Look |
| `Space` | Jump |
| `E` | Disguise as nearby object (Props) |
| `R` | Reload (Hunters) / Lock rotation (Props) |
| `T` | Taunt (Props) |
| Left-click | Shoot (Hunters) |
| `Tab` | Scoreboard (hold) |
| `Esc` | Release mouse |

## Replacing placeholder assets

All audio is procedural WebAudio and all props are procedural meshes, so the repo
ships with **no copyrighted assets**. See [`docs/ASSETS.md`](docs/ASSETS.md) for
exactly where to drop royalty-free audio and glTF models.

## License / originality

Original work. Inspired by the general prop-hunt _genre_; contains no Call of Duty
(or other) code, maps, models, sounds, or branding.

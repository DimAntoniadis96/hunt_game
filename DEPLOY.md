# Deploying Hunting Saga so you can play with friends

Your game has **two parts** that get hosted in **two different places**:

| Part | What it is | Where it goes | Cost |
|------|------------|---------------|------|
| **Client** | The Babylon.js game that runs in the browser (static files) | **Vercel** | Free |
| **Server** | The Colyseus authoritative game server (a always-running Node process with live WebSocket connections) | **Render** | Free |

> **Why not "just upload everything to Vercel"?** Vercel is perfect for the
> client (static files), but it can't run the game server. The server has to
> stay running and hold open a live WebSocket connection for every player —
> Vercel's functions are short-lived and stateless, so they can't host a
> Colyseus room. That's why the server goes on Render instead.

I've already added three files to your project to make this almost push-button:
`vercel.json` (client build config), `render.yaml` (server blueprint), and this
guide. Your server code already reads `PORT` and `CORS_ORIGIN` and has a
`/health` check, and your client already reads its server address from
`VITE_SERVER_URL`, so there's **no code to change** — only configuration.

---

## Step 0 — Put the code on GitHub (one time)

Both Vercel and Render deploy straight from a GitHub repo. If your project is
already on GitHub, skip to Step 1.

If it isn't, create a repo at https://github.com/new (name it e.g.
`hunt_game`, keep it **private** if you like — both platforms work with private
repos), then from your project folder in a terminal:

```bash
cd "/Users/boldakouz/Desktop/CODING/MY PROJECTS/hunt_game"
git add -A
git commit -m "Prepare for deployment"
git branch -M main
git remote add origin https://github.com/<your-username>/hunt_game.git
git push -u origin main
```

(If `git remote add origin` says it already exists, you're already connected —
just run `git push`.)

---

## Step 1 — Deploy the SERVER on Render

1. Go to https://render.com and sign up / log in (you can use "Sign in with
   GitHub" — it makes the next step easier).
2. Click **New → Web Service**, then connect and pick your `hunt_game` repo.
   (Render may auto-detect `render.yaml`; if it offers **"New → Blueprint"**,
   that works too and reads all the settings automatically.)
3. If you're configuring it manually, use these settings:
   - **Language / Runtime:** Docker
   - **Dockerfile Path:** `./packages/server/Dockerfile`
   - **Docker Build Context Directory:** `.` (the repo root)
   - **Instance Type:** **Free**
   - **Health Check Path:** `/health`
4. Under **Environment Variables**, add:
   - `NODE_ENV` = `production`
   - **Do not** add `PORT` — Render sets that automatically and the server
     already uses it.
   - Leave `CORS_ORIGIN` out for now (we'll add it in Step 3, once you know your
     client's address).
5. Click **Create Web Service** and wait for the build to finish (a few
   minutes the first time).
6. When it's live, copy your server URL from the top of the page. It looks like:
   ```
   https://hunting-saga-server.onrender.com
   ```
   Quick check: open `https://hunting-saga-server.onrender.com/health` in a
   browser — you should see `{"ok":true,...}`.

> **Note about the free tier:** the server "goes to sleep" after ~15 minutes
> with no players. The next person to join wakes it up, which takes about a
> minute — so the first join after a quiet spell is slow, then it's instant.
> That's the tradeoff for $0. (If that annoys you, see "Always-on alternative"
> at the bottom.)

---

## Step 2 — Deploy the CLIENT on Vercel

1. Go to https://vercel.com and sign up / log in (again, "Continue with GitHub"
   is easiest).
2. Click **Add New… → Project** and import your `hunt_game` repo.
3. Vercel will read `vercel.json` for the build settings automatically. Leave
   **Root Directory** as the repo root (do **not** set it to `packages/client`
   — the build needs the whole workspace). You should see:
   - **Build Command:** `npm run build:shared && npm run build --workspace @mimic/client`
   - **Output Directory:** `packages/client/dist`
4. Before deploying, open **Environment Variables** and add one:
   - **Name:** `VITE_SERVER_URL`
   - **Value:** your Render URL from Step 1, but with `wss://` instead of
     `https://`:
     ```
     wss://hunting-saga-server.onrender.com
     ```
     (`wss` = secure WebSocket. This is important — `https` won't work here.)
5. Click **Deploy** and wait for it to finish. Your game URL will look like:
   ```
   https://hunt-game-xxxx.vercel.app
   ```

---

## Step 3 — Connect the two (CORS) and redeploy the server

Right now the server doesn't yet trust your Vercel site, so browsers would block
the connection. Fix that:

1. Back in **Render → your service → Environment**, add:
   - `CORS_ORIGIN` = your full Vercel URL, e.g. `https://hunt-game-xxxx.vercel.app`
   (No trailing slash. If you later add more sites or a custom domain, list them
   comma-separated: `https://a.vercel.app,https://b.com`.)
2. Save — Render redeploys automatically. Wait for it to go live again.

That's it. Open your Vercel URL, create a game, and share the link.

---

## Step 4 — Play with friends

- Send friends your **Vercel URL** (the `https://…vercel.app` one).
- Everyone opens it in a browser, types a name, and either joins the **public**
  match or uses **Create / Join with a code** to play in the same private room.
- Reminder: if nobody's played for a while, the very first person to join waits
  ~1 minute for the server to wake up. Tell your friends to hang tight on that
  first load.

---

## Updating the game later

Because both platforms auto-deploy from GitHub, shipping a change is just:

```bash
git add -A && git commit -m "your change" && git push
```

Vercel rebuilds the client and Render rebuilds the server automatically. (If you
only changed client code, only Vercel needs to rebuild; if only server code,
only Render.)

---

## Always-on alternative (no cold-start wait) — Railway, ~$5/month

If the ~1-minute wake-up is annoying, host the **server** on Railway instead of
Render (the client stays on Vercel exactly as above):

1. Go to https://railway.app, **New Project → Deploy from GitHub repo**, pick
   `hunt_game`.
2. Railway detects the Dockerfile. In the service **Settings**, set the
   **Dockerfile Path** to `packages/server/Dockerfile` and the build context to
   the repo root if asked.
3. Add the same env vars: `NODE_ENV=production` and (after Step 2)
   `CORS_ORIGIN=https://your-vercel-url`.
4. Under **Settings → Networking**, click **Generate Domain** to get a public
   `https://…up.railway.app` URL, and use its `wss://…` form for the client's
   `VITE_SERVER_URL`.

Railway keeps the server awake 24/7, so there's no cold start — you pay for the
uptime (roughly $5/month for a small server).

---

## Troubleshooting

- **"Could not reach the server" when joining:** the server may still be waking
  up (wait a minute and retry), or `VITE_SERVER_URL` is wrong. It must be the
  `wss://` form of your server URL, with no trailing slash.
- **Connection blocked / CORS error in the browser console:** `CORS_ORIGIN` on
  the server doesn't exactly match your Vercel URL. Copy it exactly, no trailing
  slash, then let Render/Railway redeploy.
- **Vercel build fails:** open the build log. If it's a TypeScript error, it'll
  point at the file — the same error would show locally with
  `npm run build`. Fix, commit, push.
- **Everything works but the game resets when you come back later (free
  Render):** that's the sleep/wake behavior — the server restarts fresh, so any
  in-progress room is gone. Start a new game. The always-on option avoids this.

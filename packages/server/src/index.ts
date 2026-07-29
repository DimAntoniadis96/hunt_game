import { createServer } from "node:http";
import express from "express";
import cors from "cors";
import { Server, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { GameRoom } from "./rooms/GameRoom.js";

const PORT = Number(process.env.PORT ?? 2567);
const NODE_ENV = process.env.NODE_ENV ?? "development";

// Allowed browser origins. In prod set CORS_ORIGIN to your real domain(s).
const DEFAULT_ALLOWED_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173", "http://[::1]:5173"];
const allowedOrigins = (process.env.CORS_ORIGIN ?? DEFAULT_ALLOWED_ORIGINS.join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function isAllowedOrigin(origin?: string | null): boolean {
  return !origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin);
}

function corsOriginFor(origin?: string | null): string {
  if (!origin) return "*";
  if (allowedOrigins.includes("*")) return origin;
  return allowedOrigins.includes(origin) ? origin : "null";
}

matchMaker.controller.getCorsHeaders = (headers: Headers) => ({
  "Access-Control-Allow-Origin": corsOriginFor(headers.get("origin")),
});

const app = express();
app.use(
  cors({
    origin(origin, cb) {
      // Allow same-origin / curl (no origin) and any explicitly allowed origin.
      cb(null, isAllowedOrigin(origin));
    },
  }),
);
app.use(express.json({ limit: "16kb" }));

// Liveness/readiness probe for hosting platforms & monitoring.
app.get("/health", (_req, res) => {
  res.json({ ok: true, env: NODE_ENV, uptime: process.uptime() });
});

/**
 * Resolve a shareable room CODE -> internal roomId so the client can joinById.
 * Works for private rooms too (they're hidden from public matchmaking but still
 * discoverable by code). Single-process for the prototype; add the Redis driver
 * to make this cluster-wide.
 */
app.get("/api/rooms/:code", async (req, res) => {
  const code = String(req.params.code || "").toUpperCase().trim();
  if (!/^[A-Z0-9]{4,8}$/.test(code)) {
    return res.status(400).json({ error: "invalid_code" });
  }
  try {
    const rooms = await matchMaker.query({ name: "game" });
    const match = rooms.find((r) => (r.metadata as any)?.roomCode === code);
    if (!match) return res.status(404).json({ error: "not_found" });
    return res.json({ roomId: match.roomId, roomCode: code, clients: match.clients });
  } catch (err) {
    console.error("[api] room lookup failed", err);
    return res.status(500).json({ error: "server_error" });
  }
});

const httpServer = createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({
    server: httpServer,
    verifyClient: (info: { origin?: string | null }) => isAllowedOrigin(info.origin),
  }),
});

// One room type. filterBy(["mode"]) keeps public matchmaking from mixing modes.
gameServer.define("game", GameRoom).filterBy(["mode"]);

gameServer
  .listen(PORT)
  .then(() => {
    console.log(`[server] Hunting Saga listening on :${PORT} (${NODE_ENV})`);
    console.log(`[server] allowed origins: ${allowedOrigins.join(", ")}`);
  })
  .catch((err) => {
    console.error("[server] failed to start", err);
    process.exit(1);
  });

// Graceful shutdown so in-flight matches drain instead of hard-killing sockets.
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    console.log(`[server] ${sig} received, shutting down…`);
    await gameServer.gracefullyShutdown();
    process.exit(0);
  });
}

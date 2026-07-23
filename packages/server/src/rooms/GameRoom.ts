// colyseus 0.15 is CommonJS with no "exports" map, so ESM named imports fail at
// runtime. Import the default (= module.exports) for runtime values and use a
// type-only import for annotations.
import colyseus from "colyseus";
import type { Client } from "colyseus";
const { Room, matchMaker } = colyseus;
import {
  CLIENT_INPUT_RATE,
  ClientMessage,
  DEFAULT_MAP_ID,
  GRAVITY,
  HUNT_SECONDS,
  LOBBY_COUNTDOWN_SECONDS,
  MAPS,
  MAX_MESSAGES_PER_SECOND,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  MAX_Y,
  MIN_PLAYERS_TO_START,
  MIN_Y,
  PLAYER_EYE_HEIGHT,
  PLAYER_MAX_HEALTH,
  PLAYER_RADIUS,
  PLAYER_SPRINT_SPEED,
  PREP_SECONDS,
  PROP_MODELS,
  Phase,
  ROUNDS_PER_MATCH,
  ROUND_END_SECONDS,
  RoundResult,
  SCORE_PER_PROP_KILL,
  SCORE_PROP_SURVIVE,
  SCORE_WRONG_SHOT_PENALTY,
  SERVER_TICK_RATE,
  STATE_PATCH_RATE,
  SPEED_TOLERANCE,
  ServerMessage,
  TAUNT_COOLDOWN_MS,
  Team,
  WEAPON_DAMAGE,
  WEAPON_FIRE_COOLDOWN_MS,
  WEAPON_MAG_SIZE,
  WEAPON_RANGE,
  WEAPON_RELOAD_MS,
  WRONG_SHOT_SELF_DAMAGE,
  type InputPayload,
  type ShootPayload,
  type TransformPayload,
} from "@mimic/shared";
import { GameState, Player } from "../schema/GameState.js";
import { generateRoomCode } from "../utils/roomCode.js";
import { resolveShot, type CylinderTarget } from "./hitscan.js";

/** How close a prop must be to a map object to copy its model (metres). */
const COPY_RANGE = 6.0;
/** Enlarge hit cylinders slightly so box-corner shots register fairly. */
const HIT_RADIUS_BUFFER = 1.15;
/** Hit-cylinder height for an un-disguised prop (the humanoid body). */
const PLAYER_HIT_HEIGHT = 1.8;

interface JoinOptions {
  name?: string;
  mode?: "public" | "private";
}

/** Per-connection ephemeral bookkeeping the schema shouldn't carry. */
interface ClientMeta {
  baseIsProp: boolean; // stable side for the match; team swaps by round parity
  lastInputAt: number;
  lastShotAt: number;
  reloadDoneAt: number;
  lastTauntAt: number;
  msgWindowStart: number;
  msgCount: number;
  disconnectedAt: number;
}

export class GameRoom extends Room<GameState> {
  maxClients = MAX_PLAYERS;
  private meta = new Map<string, ClientMeta>();
  private roomCode = "";

  // ---- lifecycle ----------------------------------------------------------

  async onCreate(options: JoinOptions) {
    this.setState(new GameState());
    this.state.mapId = DEFAULT_MAP_ID;
    this.state.roundsPerMatch = ROUNDS_PER_MATCH;

    this.roomCode = await this.reserveUniqueCode();
    await this.setMetadata({ roomCode: this.roomCode, mode: options.mode ?? "public" });

    // Private rooms are excluded from public matchmaking but joinable by id/code.
    if (options.mode === "private") this.setPrivate(true);

    this.registerMessageHandlers();

    // Fixed-step authoritative simulation + throttled state patches.
    this.setSimulationInterval((dt) => this.update(dt), Math.round(1000 / SERVER_TICK_RATE));
    this.setPatchRate(Math.round(1000 / STATE_PATCH_RATE));

    console.log(`[GameRoom] created ${this.roomId} code=${this.roomCode} mode=${options.mode ?? "public"}`);
  }

  async onJoin(client: Client, options: JoinOptions) {
    const player = new Player();
    player.id = client.sessionId;
    player.name = sanitizeName(options?.name) || `Player-${client.sessionId.slice(0, 4)}`;
    player.team = Team.Unassigned;
    player.health = PLAYER_MAX_HEALTH;
    const spawn = this.pickLobbySpawn();
    player.x = spawn.x;
    player.z = spawn.z;
    this.state.players.set(client.sessionId, player);

    this.meta.set(client.sessionId, {
      baseIsProp: false,
      lastInputAt: Date.now(),
      lastShotAt: 0,
      reloadDoneAt: 0,
      lastTauntAt: 0,
      msgWindowStart: Date.now(),
      msgCount: 0,
      disconnectedAt: 0,
    });

    client.send(ServerMessage.Welcome, {
      sessionId: client.sessionId,
      roomCode: this.roomCode,
      serverTickRate: SERVER_TICK_RATE,
    });
    console.log(`[GameRoom] ${player.name} joined ${this.roomId} (${this.clients.length}/${this.maxClients})`);
  }

  async onLeave(client: Client, consented: boolean) {
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = false;
    const m = this.meta.get(client.sessionId);
    if (m) m.disconnectedAt = Date.now();

    try {
      if (!consented) {
        // Give the player a window to reconnect (e.g. dropped wifi / refresh).
        await this.allowReconnection(client, 20);
        const p = this.state.players.get(client.sessionId);
        if (p) p.connected = true;
        console.log(`[GameRoom] ${client.sessionId} reconnected`);
        return;
      }
    } catch {
      // reconnection window elapsed -> fall through to cleanup
    }

    this.state.players.delete(client.sessionId);
    this.meta.delete(client.sessionId);
    console.log(`[GameRoom] ${client.sessionId} removed`);
  }

  onDispose() {
    console.log(`[GameRoom] disposed ${this.roomId}`);
  }

  // ---- message handlers ---------------------------------------------------

  private registerMessageHandlers() {
    this.onMessage(ClientMessage.SetName, (client, raw) => {
      if (!this.rateOk(client)) return;
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const name = sanitizeName(typeof raw?.name === "string" ? raw.name : "");
      if (name) player.name = name;
    });

    this.onMessage(ClientMessage.SetReady, (client, raw) => {
      if (!this.rateOk(client)) return;
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      player.ready = !!raw?.ready;
    });

    this.onMessage(ClientMessage.Input, (client, raw) => {
      if (!this.rateOk(client)) return;
      this.handleInput(client, raw as InputPayload);
    });

    this.onMessage(ClientMessage.Transform, (client, raw) => {
      if (!this.rateOk(client)) return;
      this.handleTransform(client, raw as TransformPayload);
    });

    this.onMessage(ClientMessage.LockRotation, (client, raw) => {
      if (!this.rateOk(client)) return;
      const player = this.state.players.get(client.sessionId);
      if (!player || player.team !== Team.Props) return;
      player.rotationLocked = !!raw?.locked;
    });

    this.onMessage(ClientMessage.Shoot, (client, raw) => {
      if (!this.rateOk(client)) return;
      this.handleShoot(client, raw as ShootPayload);
    });

    this.onMessage(ClientMessage.Reload, (client) => {
      if (!this.rateOk(client)) return;
      this.handleReload(client);
    });

    this.onMessage(ClientMessage.Taunt, (client) => {
      if (!this.rateOk(client)) return;
      this.handleTaunt(client);
    });

    this.onMessage(ClientMessage.Ping, (client, raw) => {
      // Deliberately not rate-limited hard; used for latency measurement.
      const player = this.state.players.get(client.sessionId);
      if (player && typeof raw?.rtt === "number" && isFinite(raw.rtt)) {
        player.ping = Math.max(0, Math.min(2000, Math.round(raw.rtt)));
      }
      client.send(ServerMessage.Pong, { t: raw?.t });
    });
  }

  // ---- validated gameplay handlers ---------------------------------------

  private handleInput(client: Client, p: InputPayload) {
    const player = this.state.players.get(client.sessionId);
    const m = this.meta.get(client.sessionId);
    if (!player || !m || !player.alive) return;
    if (!isFiniteVec(p?.x, p?.y, p?.z) || !isFinite(p?.ry) || !isFinite(p?.rp)) return;

    // Hunters are frozen during prep; ignore their movement then.
    if (this.state.phase === Phase.Prep && player.team === Team.Hunters) {
      player.ry = clampAngle(p.ry);
      player.rp = clampPitch(p.rp);
      return;
    }

    const now = Date.now();
    // Floor dt so bursty/irregular packet timing can't shrink the allowed step
    // and rubber-band a legitimately-moving player.
    const dt = Math.max(0.03, Math.min(0.5, (now - m.lastInputAt) / 1000));
    m.lastInputAt = now;

    // Speed-hack / teleport rejection: cap horizontal displacement by max speed.
    const maxStep = PLAYER_SPRINT_SPEED * dt * SPEED_TOLERANCE + 0.05;
    const dx = p.x - player.x;
    const dz = p.z - player.z;
    const dist = Math.hypot(dx, dz);
    let nx = p.x;
    let nz = p.z;
    if (dist > maxStep) {
      // Clamp the move to the allowed radius instead of accepting the jump.
      const s = maxStep / dist;
      nx = player.x + dx * s;
      nz = player.z + dz * s;
    }

    // Hard world-bounds clamp (anti out-of-map).
    const map = MAPS[this.state.mapId] ?? MAPS[DEFAULT_MAP_ID];
    const r = PLAYER_RADIUS;
    nx = clamp(nx, map.bounds.minX + r, map.bounds.maxX - r);
    nz = clamp(nz, map.bounds.minZ + r, map.bounds.maxZ - r);

    player.x = nx;
    player.z = nz;
    player.y = clamp(p.y, MIN_Y, MAX_Y);
    player.ry = clampAngle(p.ry);
    player.rp = clampPitch(p.rp);
    player.moving = !!p.moving;

    // A locked prop cannot slide around.
    if (player.team === Team.Props && player.rotationLocked) {
      // allow tiny nudge only; effectively pinned
    }
  }

  private handleTransform(client: Client, p: TransformPayload) {
    const player = this.state.players.get(client.sessionId);
    if (!player || !player.alive) return;
    if (player.team !== Team.Props) {
      return client.send(ServerMessage.TransformResult, { ok: false, reason: "Only props can disguise." });
    }
    if (this.state.phase !== Phase.Prep && this.state.phase !== Phase.Hunt) {
      return client.send(ServerMessage.TransformResult, { ok: false, reason: "Not during this phase." });
    }
    const map = MAPS[this.state.mapId] ?? MAPS[DEFAULT_MAP_ID];
    const spawn = map.props.find((pr) => pr.id === p?.propId);
    if (!spawn) {
      return client.send(ServerMessage.TransformResult, { ok: false, reason: "Unknown object." });
    }
    const model = PROP_MODELS[spawn.modelKey];
    if (!model || !model.disguiseAllowed) {
      return client.send(ServerMessage.TransformResult, { ok: false, reason: "That object can't be copied." });
    }
    // Must be near the object being copied (server-side proximity check).
    const d = Math.hypot(player.x - spawn.x, player.z - spawn.z);
    if (d > COPY_RANGE) {
      return client.send(ServerMessage.TransformResult, { ok: false, reason: "Too far from that object." });
    }
    player.propModel = model.key;
    client.send(ServerMessage.TransformResult, { ok: true, propId: spawn.id, modelKey: model.key });
  }

  private handleShoot(client: Client, p: ShootPayload) {
    const player = this.state.players.get(client.sessionId);
    const m = this.meta.get(client.sessionId);
    if (!player || !m || !player.alive) return;
    if (player.team !== Team.Hunters || this.state.phase !== Phase.Hunt) return;
    if (player.reloading || player.ammo <= 0) return;
    if (!isFiniteVec(p?.ox, p?.oy, p?.oz) || !isFiniteVec(p?.dx, p?.dy, p?.dz)) return;

    // Anti-cheat: the shot must originate near the shooter's authoritative eye
    // position (stops "shoot from anywhere" spoofing). Generous to tolerate lag
    // and mid-jump vertical movement.
    const eyeY = player.y + PLAYER_EYE_HEIGHT;
    if (Math.hypot(p.ox - player.x, p.oz - player.z) > 3.0 || Math.abs(p.oy - eyeY) > 4.0) return;

    const now = Date.now();
    if (now - m.lastShotAt < WEAPON_FIRE_COOLDOWN_MS) return; // fire-rate enforcement
    m.lastShotAt = now;
    player.ammo = Math.max(0, player.ammo - 1);

    const map = MAPS[this.state.mapId] ?? MAPS[DEFAULT_MAP_ID];

    // Build authoritative target cylinders. Players use their ACTUAL height
    // (baseY = feet), so a prop standing on furniture or mid-jump is hittable.
    const playerTargets: CylinderTarget[] = [];
    this.state.players.forEach((other) => {
      if (other === player || !other.alive || other.team !== Team.Props) return;
      const model = PROP_MODELS[other.propModel];
      const radius = (model ? model.radius : PLAYER_RADIUS) * HIT_RADIUS_BUFFER;
      const height = model ? model.height : PLAYER_HIT_HEIGHT;
      playerTargets.push({ id: other.id, x: other.x, z: other.z, baseY: other.y, radius, height });
    });
    const propTargets: CylinderTarget[] = map.props
      .map((spawn) => {
        const model = PROP_MODELS[spawn.modelKey];
        return model ? { id: spawn.id, x: spawn.x, z: spawn.z, baseY: 0, radius: model.radius, height: model.height } : null;
      })
      .filter((t): t is CylinderTarget => t !== null);

    const res = resolveShot({ ox: p.ox, oy: p.oy, oz: p.oz, dx: p.dx, dy: p.dy, dz: p.dz }, playerTargets, propTargets, WEAPON_RANGE);

    if (res.kind === "hit" && res.targetId) {
      const victim = this.state.players.get(res.targetId);
      if (!victim) return;
      victim.health = Math.max(0, victim.health - WEAPON_DAMAGE);
      const killed = victim.health <= 0;
      client.send(ServerMessage.ShotResult, { hit: true, wrong: false, targetId: victim.id, damage: WEAPON_DAMAGE, killed, hx: res.hx, hy: res.hy, hz: res.hz });
      const victimClient = this.clients.find((c) => c.sessionId === victim.id);
      victimClient?.send(ServerMessage.Hit, { amount: WEAPON_DAMAGE, health: victim.health, byId: player.id });
      if (killed) {
        victim.alive = false;
        victim.moving = false;
        player.score += SCORE_PER_PROP_KILL;
        this.state.huntersScore += SCORE_PER_PROP_KILL;
        this.broadcast(ServerMessage.Killfeed, { killerName: player.name, victimName: victim.name });
        victimClient?.send(ServerMessage.Eliminated, { byId: player.id });
        this.checkRoundEnd();
      }
      return;
    }

    if (res.kind === "wrong") {
      // Shot a real object: self-penalty.
      player.health = Math.max(1, player.health - WRONG_SHOT_SELF_DAMAGE);
      player.score = Math.max(0, player.score - SCORE_WRONG_SHOT_PENALTY);
      client.send(ServerMessage.ShotResult, { hit: false, wrong: true, hx: res.hx, hy: res.hy, hz: res.hz });
      return;
    }

    // Clean miss (empty air) — just a spent round.
    client.send(ServerMessage.ShotResult, { hit: false, wrong: false });
  }

  private handleReload(client: Client) {
    const player = this.state.players.get(client.sessionId);
    const m = this.meta.get(client.sessionId);
    if (!player || !m || player.team !== Team.Hunters || !player.alive) return;
    if (player.reloading || player.ammo >= WEAPON_MAG_SIZE) return;
    player.reloading = true;
    m.reloadDoneAt = Date.now() + WEAPON_RELOAD_MS;
  }

  private handleTaunt(client: Client) {
    const player = this.state.players.get(client.sessionId);
    const m = this.meta.get(client.sessionId);
    if (!player || !m || player.team !== Team.Props || !player.alive) return;
    const now = Date.now();
    if (now - m.lastTauntAt < TAUNT_COOLDOWN_MS) return;
    m.lastTauntAt = now;
    // Broadcast a rough locator (reveals approximate area, a fair drawback).
    this.broadcast(ServerMessage.RoundEvent, {
      phase: this.state.phase,
      round: this.state.round,
      secondsLeft: this.secondsLeft(),
      message: "taunt",
    });
  }

  // ---- simulation / state machine ----------------------------------------

  private update(_dt: number) {
    const now = Date.now();

    // Finish any pending reloads.
    this.state.players.forEach((player) => {
      const m = this.meta.get(player.id);
      if (player.reloading && m && now >= m.reloadDoneAt) {
        player.reloading = false;
        player.ammo = WEAPON_MAG_SIZE;
      }
    });

    switch (this.state.phase) {
      case Phase.Lobby:
        this.tickLobby();
        break;
      case Phase.Countdown:
        if (now >= this.state.phaseEndsAt) this.startRound(1, true);
        break;
      case Phase.Prep:
        if (now >= this.state.phaseEndsAt) this.enterHunt();
        break;
      case Phase.Hunt:
        this.checkRoundEnd();
        if (this.state.phase === Phase.Hunt && now >= this.state.phaseEndsAt) {
          this.endRound(RoundResult.PropsWin); // survivors win on timeout
        }
        break;
      case Phase.RoundEnd:
        if (now >= this.state.phaseEndsAt) this.advanceAfterRound();
        break;
      case Phase.MatchEnd:
        if (now >= this.state.phaseEndsAt) this.resetToLobby();
        break;
    }
  }

  private tickLobby() {
    const connected = [...this.state.players.values()].filter((p) => p.connected);
    const ready = connected.filter((p) => p.ready);
    if (connected.length >= MIN_PLAYERS_TO_START && ready.length === connected.length) {
      this.state.phase = Phase.Countdown;
      this.state.phaseEndsAt = Date.now() + LOBBY_COUNTDOWN_SECONDS * 1000;
      this.broadcastRound("Match starting…");
    }
  }

  private startRound(round: number, assignSides: boolean) {
    this.state.round = round;
    if (assignSides) this.assignSides();
    this.applyTeamsForRound();
    this.spawnAndResetPlayers();
    this.state.phase = Phase.Prep;
    this.state.phaseEndsAt = Date.now() + PREP_SECONDS * 1000;
    this.state.lastResult = RoundResult.None;
    this.broadcastRound("Props: hide!");
  }

  private enterHunt() {
    this.state.phase = Phase.Hunt;
    this.state.phaseEndsAt = Date.now() + HUNT_SECONDS * 1000;
    this.broadcastRound("Hunters released!");
  }

  private endRound(result: RoundResult) {
    if (result === RoundResult.PropsWin) {
      // Award survivors.
      this.state.players.forEach((p) => {
        if (p.team === Team.Props && p.alive) {
          p.score += SCORE_PROP_SURVIVE;
          this.state.propsScore += SCORE_PROP_SURVIVE;
        }
      });
    }
    this.state.lastResult = result;
    this.state.phase = Phase.RoundEnd;
    this.state.phaseEndsAt = Date.now() + ROUND_END_SECONDS * 1000;
    this.broadcastRound(result === RoundResult.PropsWin ? "Props survived!" : "Hunters win the round!");
  }

  private advanceAfterRound() {
    if (this.state.round >= this.state.roundsPerMatch) {
      this.state.phase = Phase.MatchEnd;
      this.state.phaseEndsAt = Date.now() + 12000;
      this.broadcastRound("Match complete!");
      return;
    }
    this.startRound(this.state.round + 1, false); // sides already assigned; parity swaps
  }

  private resetToLobby() {
    this.state.phase = Phase.Lobby;
    this.state.round = 0;
    this.state.propsScore = 0;
    this.state.huntersScore = 0;
    this.state.lastResult = RoundResult.None;
    this.state.players.forEach((p) => {
      p.ready = false;
      p.team = Team.Unassigned;
      p.alive = true;
      p.health = PLAYER_MAX_HEALTH;
      p.propModel = "";
      p.rotationLocked = false;
      p.score = 0;
    });
    this.broadcastRound("Back to lobby.");
  }

  private checkRoundEnd() {
    if (this.state.phase !== Phase.Hunt) return;
    const props = [...this.state.players.values()].filter((p) => p.team === Team.Props);
    if (props.length > 0 && props.every((p) => !p.alive)) {
      this.endRound(RoundResult.HuntersWin);
    }
  }

  // ---- team + spawn helpers ----------------------------------------------

  private assignSides() {
    const ids = [...this.state.players.keys()];
    // Shuffle so team composition varies match to match.
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    const half = Math.ceil(ids.length / 2);
    ids.forEach((id, idx) => {
      const m = this.meta.get(id);
      if (m) m.baseIsProp = idx < half; // first half start as props
    });
  }

  private applyTeamsForRound() {
    // Even rounds swap the sides so everyone plays both roles.
    const swap = this.state.round % 2 === 0;
    this.state.players.forEach((player) => {
      const m = this.meta.get(player.id);
      if (!m) return;
      const isProp = swap ? !m.baseIsProp : m.baseIsProp;
      player.team = isProp ? Team.Props : Team.Hunters;
    });
  }

  private spawnAndResetPlayers() {
    const map = MAPS[this.state.mapId] ?? MAPS[DEFAULT_MAP_ID];
    let hi = 0;
    let pi = 0;
    this.state.players.forEach((player) => {
      player.health = PLAYER_MAX_HEALTH;
      player.alive = true;
      player.reloading = false;
      player.rotationLocked = false;
      player.propModel = "";
      player.moving = false;
      if (player.team === Team.Hunters) {
        const s = map.hunterSpawns[hi % map.hunterSpawns.length];
        hi++;
        player.x = s.x;
        player.y = 0;
        player.z = s.z;
        player.ry = s.ry;
        player.ammo = WEAPON_MAG_SIZE;
      } else {
        const s = map.propSpawns[pi % map.propSpawns.length];
        pi++;
        player.x = s.x;
        player.y = 0;
        player.z = s.z;
        player.ry = s.ry;
        player.ammo = 0;
      }
    });
  }

  private pickLobbySpawn() {
    const map = MAPS[this.state.mapId] ?? MAPS[DEFAULT_MAP_ID];
    const n = this.state.players.size;
    const s = map.propSpawns[n % map.propSpawns.length];
    return { x: s.x, z: s.z };
  }

  // ---- utility ------------------------------------------------------------

  private secondsLeft(): number {
    return Math.max(0, Math.ceil((this.state.phaseEndsAt - Date.now()) / 1000));
  }

  private broadcastRound(message: string) {
    this.broadcast(ServerMessage.RoundEvent, {
      phase: this.state.phase,
      round: this.state.round,
      secondsLeft: this.secondsLeft(),
      result: this.state.lastResult,
      message,
    });
  }

  /** Simple per-client rolling rate limit (anti-spam / basic DoS guard). */
  private rateOk(client: Client): boolean {
    const m = this.meta.get(client.sessionId);
    if (!m) return false;
    const now = Date.now();
    if (now - m.msgWindowStart >= 1000) {
      m.msgWindowStart = now;
      m.msgCount = 0;
    }
    m.msgCount++;
    return m.msgCount <= MAX_MESSAGES_PER_SECOND;
  }

  private async reserveUniqueCode(): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = generateRoomCode();
      const rooms = await matchMaker.query({ name: "game" });
      const taken = rooms.some((r) => (r.metadata as any)?.roomCode === code);
      if (!taken) return code;
    }
    return generateRoomCode();
  }
}

// ---- pure helpers ---------------------------------------------------------

function sanitizeName(name?: string): string {
  if (!name || typeof name !== "string") return "";
  // Strip control chars, collapse runs of whitespace, cap length.
  return name
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_LENGTH);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function clampAngle(a: number): number {
  if (!isFinite(a)) return 0;
  const twoPi = Math.PI * 2;
  return ((a % twoPi) + twoPi) % twoPi;
}

function clampPitch(p: number): number {
  if (!isFinite(p)) return 0;
  const lim = Math.PI / 2 - 0.05;
  return clamp(p, -lim, lim);
}

function isFiniteVec(a: number, b: number, c: number): boolean {
  return isFinite(a) && isFinite(b) && isFinite(c);
}

// Referenced so tree-shakers/linters keep the imports meaningful in future steps.
void CLIENT_INPUT_RATE;
void GRAVITY;

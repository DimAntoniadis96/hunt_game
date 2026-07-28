import { Room, matchMaker, type Client } from "@colyseus/core";
import {
  CLIENT_INPUT_RATE,
  ClientMessage,
  DECOY_COOLDOWN_MS,
  FLASHBANG_BLIND_MS,
  FLASHBANG_COOLDOWN_MS,
  FLASHBANG_RANGE,
  DEFAULT_MAP_ID,
  GRAVITY,
  MAX_DECOYS_PER_PLAYER,
  HUNT_SECONDS,
  LOBBY_COUNTDOWN_SECONDS,
  REBUILD_SECONDS,
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
  TRANSFORM_COOLDOWN_MS,
  WHISTLE_INTERVAL_MS,
  WHISTLE_FAST_MS,
  WHISTLE_FAST_UNDER_SECONDS,
  Team,
  WEAPON_DAMAGE,
  WEAPON_FIRE_COOLDOWN_MS,
  WEAPON_MAG_SIZE,
  WEAPON_RANGE,
  WEAPON_RELOAD_MS,
  WEAPON_RESERVE_AMMO,
  DECOY_AMMO_REWARD,
  MELEE_RANGE,
  MELEE_DAMAGE,
  MELEE_COOLDOWN_MS,
  type InputPayload,
  type ShootPayload,
  type TransformPayload,
} from "@mimic/shared";
import { Decoy, GameState, Player } from "../schema/GameState.js";
import { generateRoomCode } from "../utils/roomCode.js";
import { resolveShot, type CylinderTarget } from "./hitscan.js";
import { selectMeleeTarget, type MeleeTarget } from "./melee.js";
import { canFlashbangBlind, type FlashbangActor } from "./flashbang.js";
import { rosterAction } from "./roster.js";
import { PLAYER_HIT_HEIGHT, playerHitCylinder, propModelHitCylinder } from "./targetGeometry.js";

/** How close a prop must be to a map object to copy its model (metres). */
const COPY_RANGE = 6.0;

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
  lastFlashbangAt: number;
  lastDecoyAt: number;
  lastTransformAt: number;
  lastMeleeAt: number;
  lastWhistleAt: number;
  whistleSound: number; // which of the 5 whistle sounds this hider uses this round
  msgWindowStart: number;
  msgCount: number;
  disconnectedAt: number;
}

export class GameRoom extends Room<{ state: GameState }> {
  maxClients = MAX_PLAYERS;
  private meta = new Map<string, ClientMeta>();
  private roomCode = "";
  private decoySeq = 0;

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
      lastFlashbangAt: 0,
      lastDecoyAt: 0,
      lastTransformAt: 0,
      lastMeleeAt: 0,
      lastWhistleAt: 0,
      whistleSound: 1,
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

  async onDrop(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = false;
    const m = this.meta.get(client.sessionId);
    if (m) m.disconnectedAt = Date.now();

    try {
      // Give the player a window to reconnect (e.g. dropped wifi / refresh).
      await this.allowReconnection(client, 20);
      const p = this.state.players.get(client.sessionId);
      if (p) p.connected = true;
      console.log(`[GameRoom] ${client.sessionId} reconnected`);
      return;
    } catch {
      // Reconnection window elapsed -> onLeave performs final cleanup.
    }
  }

  async onLeave(client: Client) {
    const player = this.state.players.get(client.sessionId);
    const name = player?.name || "A player";
    const midGame = this.state.phase !== Phase.Lobby;
    this.state.players.delete(client.sessionId);
    this.meta.delete(client.sessionId);
    console.log(`[GameRoom] ${client.sessionId} removed`);
    // Announce departures as a small corner feed line (not a center banner), the
    // same place kills show up. Only mid-game — the lobby list updates itself.
    if (midGame) this.broadcast(ServerMessage.Killfeed, { text: `${name} left`, death: false });
    // React to the new roster: a match needs both teams populated to continue.
    this.handleRosterChange();
  }

  /**
   * Called whenever the player roster changes mid-match (someone left). Keeps the
   * game fair and unstuck:
   *   • fewer than 2 players → the match can't field two teams, so return to the
   *     lobby (the lone player waits for someone to join).
   *   • an active round where a whole side has emptied out (all props or all
   *     hunters gone) → end it early, reshuffle everyone into fresh teams, and
   *     restart from round 1 rather than leaving the survivors with nothing to do.
   *   • both teams still populated → keep playing as normal.
   */
  private handleRosterChange() {
    const players = [...this.state.players.values()];
    switch (rosterAction(this.state.phase, players, MIN_PLAYERS_TO_START)) {
      case "lobby":
        this.resetToLobby("Not enough players — back to the lobby.");
        break;
      case "rebuild":
        this.restartWithNewTeams();
        break;
      // "none" → both sides still populated (or a transient phase); keep playing.
    }
  }

  /**
   * A whole side emptied out. Rather than snapping straight into a new round,
   * show everyone a short "teams rebuilding" countdown, THEN reshuffle roles and
   * restart. We reuse the Countdown phase (its timer already fires startRound at
   * the end); `rebuilding` tells the client to show the rebuild screen instead of
   * the normal "starting" one.
   */
  private restartWithNewTeams() {
    this.state.propsScore = 0;
    this.state.huntersScore = 0;
    this.state.players.forEach((p) => (p.score = 0));
    this.state.rebuilding = true;
    this.state.phase = Phase.Countdown;
    this.state.phaseEndsAt = Date.now() + REBUILD_SECONDS * 1000;
    this.state.lastResult = RoundResult.None;
    this.broadcast(ServerMessage.Killfeed, { text: "A team left — rebuilding teams", death: false });
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

    this.onMessage(ClientMessage.Melee, (client, raw) => {
      if (!this.rateOk(client)) return;
      this.handleMelee(client, raw as ShootPayload);
    });

    this.onMessage(ClientMessage.Reload, (client) => {
      if (!this.rateOk(client)) return;
      this.handleReload(client);
    });

    this.onMessage(ClientMessage.Flashbang, (client) => {
      if (!this.rateOk(client)) return;
      this.handleFlashbang(client);
    });

    this.onMessage(ClientMessage.Decoy, (client) => {
      if (!this.rateOk(client)) return;
      this.handleDecoy(client);
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

    // A locked prop is pinned server-side. Keep the input timestamp fresh so
    // unlocking does not earn an oversized first movement step.
    if (player.team === Team.Props && player.rotationLocked) {
      player.rp = clampPitch(p.rp);
      player.moving = false;
      return;
    }

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
  }

  private handleTransform(client: Client, p: TransformPayload) {
    const player = this.state.players.get(client.sessionId);
    const m = this.meta.get(client.sessionId);
    if (!player || !m || !player.alive) return;
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
    // Cooldown between disguise changes (server-authoritative). The first disguise
    // of a life is free; changing again is gated so props can't flicker models to
    // dodge a hunter's aim. Re-copying the SAME model is a no-op and not penalised.
    const now = Date.now();
    if (player.propModel !== model.key) {
      const since = now - m.lastTransformAt;
      if (m.lastTransformAt > 0 && since < TRANSFORM_COOLDOWN_MS) {
        const wait = Math.ceil((TRANSFORM_COOLDOWN_MS - since) / 1000);
        return client.send(ServerMessage.TransformResult, { ok: false, reason: `Changing again in ${wait}s`, cooldownMs: TRANSFORM_COOLDOWN_MS - since });
      }
    }
    // Must be near the object being copied (server-side proximity check).
    const d = Math.hypot(player.x - spawn.x, player.z - spawn.z);
    if (d > COPY_RANGE) {
      return client.send(ServerMessage.TransformResult, { ok: false, reason: "Too far from that object." });
    }
    const changed = player.propModel !== model.key;
    player.propModel = model.key;
    if (changed) m.lastTransformAt = now;
    client.send(ServerMessage.TransformResult, { ok: true, propId: spawn.id, modelKey: model.key, cooldownMs: TRANSFORM_COOLDOWN_MS });
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
    const playerTargets = this.propPlayerTargets(player);
    const propTargets: CylinderTarget[] = map.props
      .map((spawn) => propModelHitCylinder(spawn.id, spawn.modelKey, spawn.x, spawn.y, spawn.z))
      .filter((t): t is CylinderTarget => t !== null);
    // Decoys are shootable furniture: shooting one is a "wrong" shot (penalty)
    // and the decoy is destroyed — hunters can clear bait, but it costs them.
    this.state.decoys.forEach((dd) => {
      const target = propModelHitCylinder(`decoy:${dd.id}`, dd.modelKey, dd.x, dd.y, dd.z);
      if (target) propTargets.push(target);
    });

    const res = resolveShot({ ox: p.ox, oy: p.oy, oz: p.oz, dx: p.dx, dy: p.dy, dz: p.dz }, playerTargets, propTargets, WEAPON_RANGE, map.occluders);

    if (res.kind === "hit" && res.targetId) {
      const victim = this.state.players.get(res.targetId);
      if (!victim) return;
      this.applyHit(player, client, victim, WEAPON_DAMAGE, false, res.hx, res.hy, res.hz);
      return;
    }

    if (res.kind === "wrong") {
      // Decoy clone: destroy it and REWARD the hunter with reserve ammo for
      // clearing bait (no health loss, no score penalty — it's a good play).
      if (res.targetId && res.targetId.startsWith("decoy:")) {
        const decoyId = res.targetId.slice("decoy:".length);
        const idx = this.state.decoys.findIndex((dd) => dd.id === decoyId);
        if (idx >= 0) this.state.decoys.splice(idx, 1);
        player.reserve += DECOY_AMMO_REWARD;
        client.send(ServerMessage.ShotResult, { hit: false, wrong: false, decoy: true, hx: res.hx, hy: res.hy, hz: res.hz });
        return;
      }
      // Shot real scenery: no health loss anymore — just a small score ding and
      // the wasted round (ammo is now a finite resource, which is the real cost).
      player.score = Math.max(0, player.score - SCORE_WRONG_SHOT_PENALTY);
      client.send(ServerMessage.ShotResult, { hit: false, wrong: true, hx: res.hx, hy: res.hy, hz: res.hz });
      return;
    }

    // Clean miss (empty air) — just a spent round.
    client.send(ServerMessage.ShotResult, { hit: false, wrong: false });
  }

  /** Axe swing (F). A forgiving forward-cone at the crosshair centre so the swing
   * connects with whatever the hunter is facing — a prop OR a decoy clone — at
   * short range. Not a thin ray, so it doesn't feel like it "misses to the side". */
  private handleMelee(client: Client, p: ShootPayload) {
    const player = this.state.players.get(client.sessionId);
    const m = this.meta.get(client.sessionId);
    if (!player || !m || !player.alive) return;
    if (player.team !== Team.Hunters || this.state.phase !== Phase.Hunt) return;
    if (!isFiniteVec(p?.ox, p?.oy, p?.oz) || !isFiniteVec(p?.dx, p?.dy, p?.dz)) return;

    // Same origin anti-cheat as shooting.
    const eyeY = player.y + PLAYER_EYE_HEIGHT;
    if (Math.hypot(p.ox - player.x, p.oz - player.z) > 3.0 || Math.abs(p.oy - eyeY) > 4.0) return;

    const now = Date.now();
    if (now - m.lastMeleeAt < MELEE_COOLDOWN_MS) return;
    m.lastMeleeAt = now;

    // Collect every candidate (prop players + decoys) and let the pure selector
    // pick the nearest one actually reached by the short aim-aligned swing.
    const targets: MeleeTarget[] = [];
    this.state.players.forEach((o) => {
      if (o === player || !o.alive || o.team !== Team.Props) return;
      const model = PROP_MODELS[o.propModel];
      const h = model ? model.height : PLAYER_HIT_HEIGHT;
      const r = model ? model.radius : PLAYER_RADIUS;
      targets.push({ kind: "player", id: o.id, x: o.x, baseY: o.y, z: o.z, height: h, radius: r });
    });
    this.state.decoys.forEach((dd) => {
      const model = PROP_MODELS[dd.modelKey];
      const h = model ? model.height : 1;
      const r = model ? model.radius : 0.5;
      targets.push({ kind: "decoy", id: dd.id, x: dd.x, baseY: dd.y, z: dd.z, height: h, radius: r });
    });

    const map = MAPS[this.state.mapId] ?? MAPS[DEFAULT_MAP_ID];
    const hit = selectMeleeTarget({ x: p.ox, y: p.oy, z: p.oz }, { x: p.dx, y: p.dy, z: p.dz }, targets, MELEE_RANGE, map.occluders);
    if (hit?.kind === "player") {
      const victim = this.state.players.get(hit.id);
      if (victim) this.applyHit(player, client, victim, MELEE_DAMAGE, true);
      return;
    }
    if (hit?.kind === "decoy") {
      // Axe smashes the clone — destroy it and reward ammo, same as shooting one.
      const idx = this.state.decoys.findIndex((dd) => dd.id === hit.id);
      if (idx >= 0) this.state.decoys.splice(idx, 1);
      player.reserve += DECOY_AMMO_REWARD;
      client.send(ServerMessage.ShotResult, { hit: false, wrong: false, decoy: true, melee: true });
      return;
    }
    client.send(ServerMessage.ShotResult, { hit: false, wrong: false, melee: true });
  }

  /** Authoritative target cylinders for the props a shooter can hit. */
  private propPlayerTargets(shooter: Player): CylinderTarget[] {
    const targets: CylinderTarget[] = [];
    this.state.players.forEach((other) => {
      if (other === shooter || !other.alive || other.team !== Team.Props) return;
      targets.push(playerHitCylinder(other.id, other.x, other.y, other.z, other.propModel));
    });
    return targets;
  }

  /** Apply damage from a shot or melee to a victim prop and resolve a kill. */
  private applyHit(attacker: Player, attackerClient: Client, victim: Player, amount: number, melee: boolean, hx?: number, hy?: number, hz?: number) {
    victim.health = Math.max(0, victim.health - amount);
    const killed = victim.health <= 0;
    attackerClient.send(ServerMessage.ShotResult, { hit: true, wrong: false, melee, targetId: victim.id, damage: amount, killed, hx, hy, hz });
    const victimClient = this.clients.find((c) => c.sessionId === victim.id);
    victimClient?.send(ServerMessage.Hit, { amount, health: victim.health, byId: attacker.id });
    if (killed) {
      victim.alive = false;
      victim.moving = false;
      attacker.score += SCORE_PER_PROP_KILL;
      this.state.huntersScore += SCORE_PER_PROP_KILL;
      // Everyone else sees "X killed Y"; the killer gets a guaranteed "You
      // eliminated Y" from their own ShotResult, so exclude them here (no dupe).
      this.broadcast(
        ServerMessage.Killfeed,
        { text: `${attacker.name} killed ${victim.name}`, death: true, killerName: attacker.name, victimName: victim.name, method: melee ? "axe" : "gun" },
        { except: attackerClient },
      );
      victimClient?.send(ServerMessage.Eliminated, { byId: attacker.id });
      this.checkRoundEnd();
    }
  }

  private handleReload(client: Client) {
    const player = this.state.players.get(client.sessionId);
    const m = this.meta.get(client.sessionId);
    if (!player || !m || player.team !== Team.Hunters || !player.alive) return;
    if (player.reloading || player.ammo >= WEAPON_MAG_SIZE || player.reserve <= 0) return;
    player.reloading = true;
    m.reloadDoneAt = Date.now() + WEAPON_RELOAD_MS;
  }

  private handleFlashbang(client: Client) {
    const player = this.state.players.get(client.sessionId);
    const m = this.meta.get(client.sessionId);
    if (!player || !m || player.team !== Team.Props || !player.alive) return;
    if (this.state.phase !== Phase.Hunt) {
      client.send(ServerMessage.Flashbang, { ok: false, reason: "Flash is available when hunters are released." });
      return;
    }
    if (!player.propModel || !PROP_MODELS[player.propModel]) {
      client.send(ServerMessage.Flashbang, { ok: false, reason: "Disguise before using flash." });
      return;
    }
    const now = Date.now();
    if (m.lastFlashbangAt > 0 && now - m.lastFlashbangAt < FLASHBANG_COOLDOWN_MS) {
      const cooldownMs = FLASHBANG_COOLDOWN_MS - (now - m.lastFlashbangAt);
      client.send(ServerMessage.Flashbang, { ok: false, reason: `Flash ready in ${Math.ceil(cooldownMs / 1000)}s`, cooldownMs });
      return;
    }
    m.lastFlashbangAt = now;

    const source: FlashbangActor = {
      id: player.id,
      team: player.team,
      alive: player.alive,
      x: player.x,
      y: player.y,
      z: player.z,
    };
    const model = PROP_MODELS[player.propModel];
    const fx = {
      sourceId: player.id,
      x: player.x,
      y: player.y + model.height * 0.55,
      z: player.z,
      range: FLASHBANG_RANGE,
      durationMs: FLASHBANG_BLIND_MS,
    };

    let affectedCount = 0;
    this.clients.forEach((targetClient) => {
      const target = this.state.players.get(targetClient.sessionId);
      if (!target) return;
      const actor: FlashbangActor = {
        id: target.id,
        team: target.team,
        alive: target.alive,
        x: target.x,
        y: target.y,
        z: target.z,
      };
      if (!canFlashbangBlind(source, actor, FLASHBANG_RANGE)) return;
      affectedCount++;
      targetClient.send(ServerMessage.Flashbang, { ok: true, ...fx, blinded: true });
    });
    client.send(ServerMessage.Flashbang, { ok: true, ...fx, blinded: false, affectedCount, cooldownMs: FLASHBANG_COOLDOWN_MS });
  }

  /** Drop a fake clone of the prop's current disguise where they stand. */
  private handleDecoy(client: Client) {
    const player = this.state.players.get(client.sessionId);
    const m = this.meta.get(client.sessionId);
    if (!player || !m || player.team !== Team.Props || !player.alive) return;
    if (!player.propModel || !PROP_MODELS[player.propModel]) return; // must be disguised
    if (this.state.phase !== Phase.Prep && this.state.phase !== Phase.Hunt) return;
    const now = Date.now();
    if (now - m.lastDecoyAt < DECOY_COOLDOWN_MS) return;
    const owned = this.state.decoys.filter((dd) => dd.ownerId === player.id).length;
    if (owned >= MAX_DECOYS_PER_PLAYER) {
      // Replace the oldest decoy from this player instead of exceeding the cap.
      const idx = this.state.decoys.findIndex((dd) => dd.ownerId === player.id);
      if (idx >= 0) this.state.decoys.splice(idx, 1);
    }
    m.lastDecoyAt = now;
    const d = new Decoy();
    d.id = `d${this.decoySeq++}`;
    d.ownerId = player.id;
    d.modelKey = player.propModel;
    d.x = player.x;
    d.y = player.y;
    d.z = player.z;
    d.ry = player.ry;
    this.state.decoys.push(d);
  }

  // ---- simulation / state machine ----------------------------------------

  private update(_dt: number) {
    const now = Date.now();

    // Finish any pending reloads.
    this.state.players.forEach((player) => {
      const m = this.meta.get(player.id);
      if (player.reloading && m && now >= m.reloadDoneAt) {
        player.reloading = false;
        const take = Math.min(WEAPON_MAG_SIZE - player.ammo, player.reserve);
        player.ammo += take;
        player.reserve -= take;
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
        } else if (this.state.phase === Phase.Hunt) {
          this.tickWhistles(now);
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
    this.state.rebuilding = false; // the rebuild countdown (if any) is over
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
    // Give each hider a distinct whistle sound (1-5) for the round, and stagger
    // their first whistle so they don't all sound at once.
    const props = [...this.state.players.values()].filter((p) => p.team === Team.Props && p.alive);
    const sounds = [1, 2, 3, 4, 5];
    for (let i = sounds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [sounds[i], sounds[j]] = [sounds[j], sounds[i]];
    }
    const now = Date.now();
    props.forEach((p, i) => {
      const m = this.meta.get(p.id);
      if (!m) return;
      m.whistleSound = sounds[i % sounds.length]; // ≤5 hiders → all unique
      m.lastWhistleAt = now - Math.floor((WHISTLE_INTERVAL_MS * i) / Math.max(1, props.length));
    });
    this.broadcastRound("Hunters released!");
  }

  /** Auto-whistle: every alive prop emits a positional locator on a cadence that
   * quickens in the final seconds, so seekers can hunt them down. */
  private tickWhistles(now: number) {
    const interval = this.secondsLeft() <= WHISTLE_FAST_UNDER_SECONDS ? WHISTLE_FAST_MS : WHISTLE_INTERVAL_MS;
    this.state.players.forEach((p) => {
      if (p.team !== Team.Props || !p.alive) return;
      const m = this.meta.get(p.id);
      if (!m || now - m.lastWhistleAt < interval) return;
      m.lastWhistleAt = now;
      this.broadcast(ServerMessage.Whistle, { id: p.id, x: p.x, y: p.y, z: p.z, sound: m.whistleSound });
    });
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

  private resetToLobby(message = "Back to lobby.") {
    this.state.phase = Phase.Lobby;
    this.state.round = 0;
    this.state.rebuilding = false;
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
    this.broadcastRound(message);
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
    this.state.decoys.splice(0, this.state.decoys.length); // clear last round's decoys
    let hi = 0;
    let pi = 0;
    this.state.players.forEach((player) => {
      player.health = PLAYER_MAX_HEALTH;
      player.alive = true;
      player.reloading = false;
      player.rotationLocked = false;
      player.propModel = "";
      player.moving = false;
      const m = this.meta.get(player.id);
      if (m) m.lastFlashbangAt = 0;
      if (player.team === Team.Hunters) {
        const s = map.hunterSpawns[hi % map.hunterSpawns.length];
        hi++;
        player.x = s.x;
        player.y = 0;
        player.z = s.z;
        player.ry = s.ry;
        player.ammo = WEAPON_MAG_SIZE;
        player.reserve = WEAPON_RESERVE_AMMO;
      } else {
        const s = map.propSpawns[pi % map.propSpawns.length];
        pi++;
        player.x = s.x;
        player.y = 0;
        player.z = s.z;
        player.ry = s.ry;
        player.ammo = 0;
        player.reserve = 0;
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

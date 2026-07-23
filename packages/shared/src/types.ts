/**
 * Enums, network message names, and payload/state *shapes* shared by both sides.
 * The server's Colyseus schema classes implement these read-shapes; the client
 * consumes them as plain objects.
 */

export enum Team {
  Unassigned = "unassigned",
  Props = "props",
  Hunters = "hunters",
  Spectator = "spectator",
}

/** Round/match lifecycle. The server is the sole authority over transitions. */
export enum Phase {
  Lobby = "lobby",
  Countdown = "countdown",
  Prep = "prep", // props hide, hunters frozen
  Hunt = "hunt", // hunters released
  RoundEnd = "round_end",
  MatchEnd = "match_end",
}

/** Which team won the most-recently-finished round. */
export enum RoundResult {
  None = "none",
  PropsWin = "props_win",
  HuntersWin = "hunters_win",
}

/**
 * Client -> Server message names. Keep them short; validated server-side.
 */
export const ClientMessage = {
  SetName: "set_name",
  SetReady: "set_ready",
  Input: "input", // movement + look snapshot
  Transform: "transform", // prop wants to disguise as a map object
  LockRotation: "lock_rotation",
  Shoot: "shoot", // hunter fires
  Reload: "reload",
  Taunt: "taunt",
  Decoy: "decoy", // prop drops a fake clone of its current disguise
  Ping: "ping",
} as const;
export type ClientMessageName =
  (typeof ClientMessage)[keyof typeof ClientMessage];

/**
 * Server -> Client message names (one-off events; continuous state comes via the
 * Colyseus schema patch stream, not these).
 */
export const ServerMessage = {
  Welcome: "welcome",
  Pong: "pong",
  ShotResult: "shot_result", // feedback to the shooter (hit/miss/wrong)
  Hit: "hit", // you took damage
  Eliminated: "eliminated",
  Killfeed: "killfeed",
  TransformResult: "transform_result",
  RoundEvent: "round_event", // countdown ticks, phase changes, taunts
  Error: "error",
} as const;
export type ServerMessageName =
  (typeof ServerMessage)[keyof typeof ServerMessage];

// ---- Client -> Server payloads --------------------------------------------

export interface InputPayload {
  /** Authoritative-ish position the client believes it is at (server validates). */
  x: number;
  y: number;
  z: number;
  /** Yaw (look direction around Y) and pitch, radians. */
  ry: number;
  rp: number;
  /** Movement intent flags, for animation/state on other clients. */
  moving: boolean;
  grounded: boolean;
  /** Monotonic client sequence number for reconciliation. */
  seq: number;
}

export interface TransformPayload {
  /** Id of the map prop-spawn the player is looking at / wants to copy. */
  propId: string;
}

export interface ShootPayload {
  /** Ray origin (camera/eye) and normalized direction, in world space. */
  ox: number;
  oy: number;
  oz: number;
  dx: number;
  dy: number;
  dz: number;
  seq: number;
}

// ---- Server -> Client payloads --------------------------------------------

export interface WelcomePayload {
  sessionId: string;
  roomCode: string;
  serverTickRate: number;
}

export interface ShotResultPayload {
  hit: boolean;
  wrong: boolean; // shot a non-prop world object -> penalty
  targetId?: string;
  damage?: number;
  killed?: boolean;
  hx?: number; // impact point (for tracer/decal)
  hy?: number;
  hz?: number;
}

export interface HitPayload {
  amount: number;
  health: number;
  byId: string;
}

export interface KillfeedPayload {
  killerName: string;
  victimName: string;
  wrong?: boolean;
}

export interface TransformResultPayload {
  ok: boolean;
  propId?: string;
  modelKey?: string;
  reason?: string;
}

export interface RoundEventPayload {
  phase: Phase;
  round: number;
  secondsLeft: number;
  result?: RoundResult;
  message?: string;
}

// ---- State read-shapes (mirror the server schema) --------------------------

export interface PlayerView {
  id: string;
  name: string;
  team: Team;
  ready: boolean;
  connected: boolean;
  x: number;
  y: number;
  z: number;
  ry: number;
  rp: number;
  moving: boolean;
  health: number;
  alive: boolean;
  ammo: number;
  reloading: boolean;
  /** "" when a hunter or an untransformed prop; otherwise the prop model key. */
  propModel: string;
  rotationLocked: boolean;
  score: number;
  ping: number;
}

export interface DecoyView {
  id: string;
  modelKey: string;
  x: number;
  y: number;
  z: number;
  ry: number;
}

export interface GameStateView {
  phase: Phase;
  round: number;
  roundsPerMatch: number;
  phaseEndsAt: number; // server epoch ms
  mapId: string;
  propsScore: number;
  huntersScore: number;
  lastResult: RoundResult;
}

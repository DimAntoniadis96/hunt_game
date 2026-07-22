import { Schema, MapSchema, type } from "@colyseus/schema";
import { Phase, RoundResult, Team } from "@mimic/shared";

/**
 * Authoritative per-player state. Every field here is replicated to clients via
 * Colyseus' delta patches. The client NEVER writes these directly — it sends
 * messages, the server mutates the schema, Colyseus syncs the diff.
 */
export class Player extends Schema {
  @type("string") id = "";
  @type("string") name = "Player";
  @type("string") team: Team = Team.Unassigned;
  @type("boolean") ready = false;
  @type("boolean") connected = true;

  // Transform (authoritative). Position in metres, rotations in radians.
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") z = 0;
  @type("number") ry = 0; // yaw
  @type("number") rp = 0; // pitch
  @type("boolean") moving = false;

  // Combat / life.
  @type("number") health = 100;
  @type("boolean") alive = true;
  @type("number") ammo = 8;
  @type("boolean") reloading = false;

  // Prop disguise. "" = not disguised (or is a hunter).
  @type("string") propModel = "";
  @type("boolean") rotationLocked = false;

  @type("number") score = 0;
  @type("number") ping = 0;
}

/**
 * Authoritative room/match state.
 */
export class GameState extends Schema {
  @type("string") phase: Phase = Phase.Lobby;
  @type("number") round = 0;
  @type("number") roundsPerMatch = 4;
  /** Server epoch-ms when the current phase ends (client renders countdown). */
  @type("number") phaseEndsAt = 0;
  @type("string") mapId = "depot7";
  @type("number") propsScore = 0;
  @type("number") huntersScore = 0;
  @type("string") lastResult: RoundResult = RoundResult.None;
  @type({ map: Player }) players = new MapSchema<Player>();
}

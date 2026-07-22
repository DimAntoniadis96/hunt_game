/**
 * Gameplay + network tuning constants. Shared verbatim by client & server so the
 * client can predict/interpolate with the exact same numbers the server uses to
 * validate. Change a value here and BOTH sides stay in agreement.
 */

/** Fixed simulation rate the server runs its game loop at (Hz). */
export const SERVER_TICK_RATE = 20;
/** Colyseus patch/broadcast rate (Hz). Lower than tick to save bandwidth. */
export const STATE_PATCH_RATE = 15;
/** How often the client sends its input/movement snapshot to the server (Hz). */
export const CLIENT_INPUT_RATE = 20;

/** Room sizing. */
export const MIN_PLAYERS_TO_START = 2; // low for easy local testing; raise for prod
export const MAX_PLAYERS = 16;

/** Round timing (seconds). */
export const PREP_SECONDS = 30; // props hide while hunters are frozen/blind
export const HUNT_SECONDS = 150; // main hunt phase
export const ROUND_END_SECONDS = 6; // scoreboard / transition
export const LOBBY_COUNTDOWN_SECONDS = 5; // once enough players are ready
export const ROUNDS_PER_MATCH = 4; // teams swap each round

/** Movement (units = metres). Server rejects motion faster than this. */
export const PLAYER_WALK_SPEED = 5.0; // m/s
export const PLAYER_SPRINT_SPEED = 7.5; // m/s
export const PLAYER_JUMP_SPEED = 6.0; // m/s initial vertical velocity
export const GRAVITY = -18.0; // m/s^2 (game-y, snappier than real gravity)
/** Extra slack multiplier before the server flags a move as a speed-hack. */
export const SPEED_TOLERANCE = 1.35;
/** Max vertical position sanity bound (metres) — catches teleport-to-sky hacks. */
export const MAX_Y = 30;
export const MIN_Y = -5;

/** Player physical defaults. */
export const PLAYER_EYE_HEIGHT = 1.7;
export const PLAYER_RADIUS = 0.4;
export const PLAYER_MAX_HEALTH = 100;

/** Hunter weapon. */
export const WEAPON_DAMAGE = 34; // 3 shots to kill a full-health prop
export const WEAPON_MAG_SIZE = 8;
export const WEAPON_RELOAD_MS = 1600;
export const WEAPON_FIRE_COOLDOWN_MS = 220; // server-enforced min gap between shots
export const WEAPON_RANGE = 60; // metres — hitscan max distance
/** Penalty when a hunter shoots the world / a non-prop (discourages spraying). */
export const WRONG_SHOT_SELF_DAMAGE = 8;

/** Prop scoring. */
export const SCORE_PER_PROP_KILL = 100; // hunter killing a prop
export const SCORE_PROP_SURVIVE = 150; // prop alive at round end
export const SCORE_WRONG_SHOT_PENALTY = 25;

/** Taunt: props are periodically forced/allowed to emit a locator sound. */
export const TAUNT_COOLDOWN_MS = 12000;

/** Network safety. */
export const MAX_NAME_LENGTH = 16;
export const ROOM_CODE_LENGTH = 5;
/** Reject clients sending more than this many messages per second (anti-spam). */
export const MAX_MESSAGES_PER_SECOND = 40;

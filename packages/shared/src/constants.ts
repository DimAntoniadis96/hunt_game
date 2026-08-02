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
export const REBUILD_SECONDS = 8; // grace countdown when a team empties, before reshuffling roles
export const ROUNDS_PER_MATCH = 4; // teams swap each round

/** Movement (units = metres). Server rejects motion faster than this. */
export const PLAYER_WALK_SPEED = 5.0; // m/s (fallback)
/** Props (hiders) move at full speed — mobility is their advantage. */
export const PROP_WALK_SPEED = 6.1; // m/s
/** Hunters (seekers) move at 80% of the hiders' speed, so props stay faster. */
export const HUNTER_WALK_SPEED = PROP_WALK_SPEED * 0.8; // m/s (≈4.88)
export const PLAYER_SPRINT_SPEED = 7.5; // m/s
export const PLAYER_JUMP_SPEED = 7.2; // m/s initial vertical velocity (~1.4m hop)
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
export const WEAPON_MAG_SIZE = 8; // rounds per magazine
export const WEAPON_RESERVE_AMMO = 120; // total spare rounds a hunter starts a round with
export const WEAPON_RELOAD_MS = 1600;
export const WEAPON_FIRE_COOLDOWN_MS = 220; // server-enforced min gap between shots
export const WEAPON_RANGE = 60; // metres — hitscan max distance
/** Ammo refunded to a hunter's reserve for destroying a prop's decoy clone. */
export const DECOY_AMMO_REWARD = 5;
/** @deprecated Wrong shots no longer cost the hunter health. Kept for compatibility. */
export const WRONG_SHOT_SELF_DAMAGE = 0;

/** Melee (pistol-whip) — the fallback attack when a hunter is out of ammo. */
export const MELEE_RANGE = 2.5; // metres — genuinely close reach (forward cone)
export const MELEE_DAMAGE = 55; // two swings down a full-health prop
export const MELEE_COOLDOWN_MS = 600; // min gap between swings

/** Prop scoring. */
export const SCORE_PER_PROP_KILL = 100; // hunter killing a prop
export const SCORE_PROP_SURVIVE = 150; // prop alive at round end
export const SCORE_WRONG_SHOT_PENALTY = 25;

/** Flashbang: a close-range prop escape tool that briefly blinds nearby hunters. */
export const FLASHBANG_RANGE = 7.0; // metres (3D). Close-range panic tool, but 4m
// measured in 3D (incl. eye-height gap) almost never triggered in a real chase;
// 7m reliably blinds a pursuer who's closing in without being a ranged stun.
export const FLASHBANG_BLIND_MS = 2000; // seekers are blinded for 2 seconds (fair escape window)
export const FLASHBANG_COOLDOWN_MS = 18000; // prevents repeated chain-blinding

/**
 * Auto-whistle: during the hunt, every alive prop automatically emits a locator
 * whistle on this cadence (COD-style), so seekers can triangulate them. The
 * interval shortens in the final seconds to force a finish.
 */
export const WHISTLE_INTERVAL_MS = 32000; // base gap between a hider's whistles
export const WHISTLE_FAST_MS = 15000; // used when little hunt time remains
export const WHISTLE_FAST_UNDER_SECONDS = 30;
/**
 * How far a locator whistle carries, in metres, before it fades to the floor
 * below.
 *
 * This used to be 46m, which was fine on depot7 (35x35m) but left most of the
 * backyard map silent — that map is 92x74m, a 118m diagonal, so a seeker more
 * than ~40m away heard nothing at all. Since a hider only whistles every 32
 * seconds, a hunter could go a whole round without a single audible cue.
 */
export const WHISTLE_AUDIBLE_RANGE = 95;
/**
 * The faintest a whistle is ever played. Guarantees a hunter ALWAYS hears it,
 * however far away they are, while distance still comes through clearly in the
 * volume. Must stay above AudioManager's "too quiet to bother" cutoff (0.02).
 */
export const WHISTLE_MIN_VOLUME = 0.06;
/**
 * Range over which a victim's cry is attenuated for the hunter who shot them,
 * and the floor it is played at, so a connecting hit always reads as a hit.
 */
export const VICTIM_CRY_RANGE = 60;
export const VICTIM_CRY_MIN_VOLUME = 0.45;
export const KILL_CRY_MIN_VOLUME = 0.6;

/** Cooldown between disguise changes (ms). Stops instant model-flicker to dodge. */
export const TRANSFORM_COOLDOWN_MS = 5000;

/** Decoy clones: props drop fake copies of their current disguise to mislead. */
export const MAX_DECOYS_PER_PLAYER = 2;
export const DECOY_COOLDOWN_MS = 3500;

/** Network safety. */
/** Display-name bounds. 3-16 mirrors PSN / Minecraft / Fortnite / Riot IDs. */
export const MIN_NAME_LENGTH = 3;
export const MAX_NAME_LENGTH = 16;
export const ROOM_CODE_LENGTH = 5;
/** Reject clients sending more than this many messages per second (anti-spam). */
export const MAX_MESSAGES_PER_SECOND = 40;

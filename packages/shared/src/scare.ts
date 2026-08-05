/**
 * Jumpscares: ambient horror events the server fires at fixed places on a map
 * during the hunt.
 *
 * DESIGN RULE, and it is the whole reason this file has so many constants in it:
 * a scare may frighten you, it may NEVER take a round off you. Concretely —
 *
 *   * it never blinds, deafens, slows or moves a player. The flashbang is a
 *     weapon and has a cost; a scare is scenery.
 *   * it never sounds like a real cue. Nothing here may be mistaken for a
 *     whistle, a gunshot or a footstep, because a hunter who walks 30m toward a
 *     fake whistle has been robbed, not spooked.
 *   * it never spawns anything a player can hide behind or be blocked by. The
 *     visuals are non-collidable, non-pickable and gone in about a second.
 *   * it fires from a LANDMARK (see a map's `scarePoints`), never from open
 *     ground, so when you spin round there is something there to have made it.
 *
 * The thunder flash is the one that looks like an exception and is not: it
 * lights the whole map for ~120ms, which helps hunters and hurts hiders. That
 * is a real, symmetric, telegraphed swing that both sides can play around — a
 * hider who hears the thunder roll knows to stop moving. That is a mechanic,
 * not a gotcha.
 */

export type ScareKind = "bats" | "crow" | "whisper" | "groan" | "thunder";

/** What the client draws, if anything. */
export type ScareVisual = "bats" | "crow" | "flash" | "none";

export interface ScareSpec {
  /** Metres over which the sound falls from full volume to its floor. */
  range: number;
  /** Never quieter than this, so a map-wide event is never silently dropped. */
  floor: number;
  visual: ScareVisual;
  /** Relative likelihood of being picked. */
  weight: number;
  /**
   * True for events that belong to the sky rather than to a place — played at
   * full volume everywhere and not positioned.
   */
  global?: boolean;
}

export const SCARES: Record<ScareKind, ScareSpec> = {
  // A tomb disgorges a cloud of bats. The loudest and most startling, so it is
  // also the rarest.
  bats: { range: 60, floor: 0.05, visual: "bats", weight: 3 },
  // A raven takes off, cawing. Frequent and cheap — this is the map's heartbeat.
  crow: { range: 55, floor: 0.04, visual: "crow", weight: 5 },
  // Something breathes right where you are not looking. No visual at all, which
  // is what makes it the worst one.
  whisper: { range: 22, floor: 0, visual: "none", weight: 5 },
  // A long moan from inside the stonework.
  groan: { range: 34, floor: 0, visual: "none", weight: 4 },
  // Sheet lightning and a roll of thunder, over the whole map.
  thunder: { range: 999, floor: 0.5, visual: "flash", weight: 2, global: true },
};

export const SCARE_KINDS = Object.keys(SCARES) as ScareKind[];

/**
 * Gap between scares. The lower bound is what stops a scare from ever landing
 * on top of the previous one, and the spread is what stops players learning the
 * rhythm — a scare you can time is not a scare.
 */
export const SCARE_MIN_GAP_MS = 9_000;
export const SCARE_MAX_GAP_MS = 24_000;

/**
 * Quiet window at the start of the hunt. Seekers are released, everyone is
 * finding their feet, and a scare in the first seconds just reads as a bug.
 */
export const SCARE_WARMUP_MS = 6_000;

/** How long the client's visual for a scare lives, per kind (ms). */
export const SCARE_VISUAL_MS: Record<ScareVisual, number> = {
  bats: 1500,
  crow: 1200,
  flash: 900,
  none: 0,
};

/** How loud `kind` is for a listener `dist` metres away. */
export function scareVolume(kind: ScareKind, dist: number): number {
  const spec = SCARES[kind];
  if (!spec) return 0;
  if (spec.global) return 1;
  const t = Math.min(1, Math.max(0, dist) / spec.range);
  return Math.max(spec.floor, (1 - t) * (1 - t));
}

/**
 * Pick a scare by weight. `roll` is a 0..1 random supplied by the caller so the
 * choice stays testable and the server keeps its single source of randomness.
 */
export function pickScare(roll: number): ScareKind {
  const total = SCARE_KINDS.reduce((sum, k) => sum + SCARES[k].weight, 0);
  let acc = clamp01(roll, 0) * 0.999999 * total;
  for (const k of SCARE_KINDS) {
    acc -= SCARES[k].weight;
    if (acc < 0) return k;
  }
  return SCARE_KINDS[SCARE_KINDS.length - 1];
}

/**
 * Clamp to 0..1, mapping a non-finite input to `fallback` rather than letting it
 * through. Math.min/Math.max propagate NaN, so an arithmetic-only clamp turns a
 * single bad roll into a NaN deadline — and a NaN deadline compares false
 * against every `now`, which would silently switch scares off for the rest of
 * the match instead of failing loudly.
 */
function clamp01(v: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Milliseconds until the next scare, from a 0..1 roll. */
export function nextScareDelay(roll: number): number {
  const t = clamp01(roll, 0.5);
  return Math.round(SCARE_MIN_GAP_MS + t * (SCARE_MAX_GAP_MS - SCARE_MIN_GAP_MS));
}

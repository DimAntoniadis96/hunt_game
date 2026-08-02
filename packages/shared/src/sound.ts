/**
 * World sound: one channel for everything that happens at a PLACE on the map.
 *
 * The rule is simple and applies to every diegetic event: the server tells every
 * client where the sound happened, and each client plays it attenuated by that
 * listener's own distance from it. Nobody is excluded from an event just because
 * they were not involved in it — if you are standing in the map, you hear what
 * happens in the map.
 *
 * This replaces a pile of special cases where a sound only ever reached the one
 * player who caused it: a gunshot was audible only to the shooter, a reload only
 * to the reloader, a flashbang only to whoever it blinded.
 *
 * Non-diegetic audio — menu clicks, the round countdown, phase stings — is NOT
 * routed through here. Those belong to the interface, not the world, and are
 * deliberately played flat and local.
 */

/** Everything that makes a noise somewhere in the world. */
export type WorldSoundKind =
  | "shoot"
  | "reload"
  | "melee_swing"
  | "melee_hit"
  | "hit"
  | "hurt"
  | "death"
  | "transform"
  | "flash";

export interface WorldSoundSpec {
  /** Distance in metres over which the sound falls from full volume to silence. */
  range: number;
  /**
   * Volume this sound is never quieter than, so a loud event stays audible
   * anywhere on the map. Left at 0 for quiet, close-range noises — a magazine
   * change 90m away should genuinely be inaudible, or the mix becomes mush.
   */
  floor: number;
}

/**
 * Ranges are chosen so loud events (a gunshot, a scream, a flashbang) carry
 * across the whole map — the largest map's diagonal is ~118m — while small
 * mechanical noises fade naturally.
 */
export const WORLD_SOUNDS: Record<WorldSoundKind, WorldSoundSpec> = {
  shoot: { range: 150, floor: 0.05 },
  flash: { range: 130, floor: 0.05 },
  death: { range: 110, floor: 0.06 },
  hurt: { range: 80, floor: 0.04 },
  hit: { range: 60, floor: 0 },
  melee_hit: { range: 50, floor: 0 },
  transform: { range: 45, floor: 0 },
  reload: { range: 34, floor: 0 },
  melee_swing: { range: 26, floor: 0 },
};

/**
 * How loud `kind` is for a listener `dist` metres away.
 *
 * Inverse-square-ish falloff: it drops quickly up close (so direction and
 * proximity read clearly) and flattens out far away, which is how distance
 * actually sounds. Shared so the client's mixing and the tests agree.
 */
export function worldSoundVolume(kind: WorldSoundKind, dist: number): number {
  const spec = WORLD_SOUNDS[kind];
  if (!spec) return 0;
  const t = Math.min(1, Math.max(0, dist) / spec.range);
  const falloff = (1 - t) * (1 - t);
  return Math.max(spec.floor, falloff);
}

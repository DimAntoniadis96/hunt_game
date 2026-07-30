/**
 * Spawn placement.
 *
 * `propSpawns` / `hunterSpawns` are hand-authored points, so as the map gains
 * props they can end up sitting inside one. On the backyard map two of the
 * eight prop spawns were blocked — one overlapping a tree stump, one inside the
 * low garden wall — and because spawns are handed out round-robin, real players
 * landed in them every round.
 *
 * Rather than nudging those two points by hand (which silently rots again the
 * next time the map changes), the server resolves every spawn at runtime to the
 * nearest genuinely free spot. Everything here is pure and deterministic: the
 * same inputs always produce the same position, which matters because the
 * server is authoritative.
 */
import { PLAYER_RADIUS } from "./constants.js";
import { PROP_MODELS, type MapDefinition, type SpawnPoint } from "./maps.js";

/** Occluders shorter than this are steps/kerbs, not obstacles worth avoiding. */
const STEP_OVER_HEIGHT = 0.25;

/** How far out we are willing to move a spawn before giving up (metres). */
const MAX_SEARCH_RADIUS = 8;
/** Distance between search rings. */
const RING_STEP = 0.5;
/** Candidate directions tested on each ring. */
const RING_SAMPLES = 16;

export interface BlockerInfo {
  kind: "prop" | "occluder" | "player" | "bounds";
  /** Prop id / occluder index, for diagnostics and tests. */
  ref: string;
}

/** A spot already taken this round — used so players don't stack on each other. */
export interface OccupiedPoint {
  x: number;
  z: number;
  radius: number;
}

/**
 * What (if anything) prevents a player of `radius` from standing at (x, z).
 * Returns null when the spot is clear.
 */
export function spawnBlockedBy(
  map: MapDefinition,
  x: number,
  z: number,
  radius: number = PLAYER_RADIUS,
  occupied: readonly OccupiedPoint[] = [],
): BlockerInfo | null {
  const b = map.bounds;
  if (x - radius < b.minX || x + radius > b.maxX || z - radius < b.minZ || z + radius > b.maxZ) {
    return { kind: "bounds", ref: "map" };
  }

  // Static props: cylinder vs cylinder in the XZ plane.
  for (const p of map.props) {
    const model = PROP_MODELS[p.modelKey];
    if (!model) continue;
    const dx = x - p.x;
    const dz = z - p.z;
    const need = model.radius + radius;
    if (dx * dx + dz * dz < need * need) return { kind: "prop", ref: `${p.id}/${p.modelKey}` };
  }

  // Structural geometry: point vs AABB expanded by the player radius.
  for (let i = 0; i < map.occluders.length; i++) {
    const o = map.occluders[i];
    if (o.maxY - o.minY < STEP_OVER_HEIGHT) continue;
    if (x > o.minX - radius && x < o.maxX + radius && z > o.minZ - radius && z < o.maxZ + radius) {
      return { kind: "occluder", ref: `#${i}` };
    }
  }

  // Other players already placed this round.
  for (let i = 0; i < occupied.length; i++) {
    const q = occupied[i];
    const dx = x - q.x;
    const dz = z - q.z;
    const need = q.radius + radius;
    if (dx * dx + dz * dz < need * need) return { kind: "player", ref: `#${i}` };
  }

  return null;
}

/** Convenience predicate. */
export function isSpawnClear(
  map: MapDefinition,
  x: number,
  z: number,
  radius: number = PLAYER_RADIUS,
  occupied: readonly OccupiedPoint[] = [],
): boolean {
  return spawnBlockedBy(map, x, z, radius, occupied) === null;
}

/**
 * Return the authored spawn if it is clear, otherwise the closest free spot to
 * it. Searches outward in rings so the player still starts as near as possible
 * to where the level author intended.
 *
 * If nothing within MAX_SEARCH_RADIUS is free the authored point is returned
 * unchanged — an overlapping spawn is bad, but silently teleporting someone
 * across the map (or off it) would be worse.
 */
export function resolveSpawnPoint(
  map: MapDefinition,
  desired: SpawnPoint,
  radius: number = PLAYER_RADIUS,
  occupied: readonly OccupiedPoint[] = [],
): SpawnPoint {
  if (isSpawnClear(map, desired.x, desired.z, radius, occupied)) return { ...desired };

  for (let r = RING_STEP; r <= MAX_SEARCH_RADIUS + 1e-9; r += RING_STEP) {
    for (let i = 0; i < RING_SAMPLES; i++) {
      // Rotate each ring slightly so successive rings don't all probe the same
      // spokes — a spawn wedged against a wall would otherwise never escape.
      const angle = (i / RING_SAMPLES) * Math.PI * 2 + (r / RING_STEP) * 0.19634954;
      const x = desired.x + Math.cos(angle) * r;
      const z = desired.z + Math.sin(angle) * r;
      if (isSpawnClear(map, x, z, radius, occupied)) return { x, y: desired.y, z, ry: desired.ry };
    }
  }

  return { ...desired };
}

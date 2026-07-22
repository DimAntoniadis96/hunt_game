/**
 * Pure server-side hitscan geometry — no Colyseus/room state, so it can be unit
 * tested directly. The authoritative `GameRoom` builds targets from the current
 * state and calls `resolveShot`; it never trusts the client to decide a hit.
 */

export interface ShotRay {
  ox: number;
  oy: number;
  oz: number;
  dx: number;
  dy: number;
  dz: number;
}

/** A vertical cylinder in world space (a player disguise, or map furniture). */
export interface CylinderTarget {
  id: string;
  x: number;
  z: number;
  /** World Y of the BASE (feet). Players standing on props have baseY > 0. */
  baseY: number;
  radius: number;
  height: number;
}

export type ShotKind = "hit" | "wrong" | "miss";

export interface ShotResolution {
  kind: ShotKind;
  targetId?: string;
  t?: number; // distance along the (unit) ray
  hx?: number;
  hy?: number;
  hz?: number;
}

/**
 * Ray vs a clamped vertical cylinder. Returns the nearest positive distance `t`
 * (metres, dir must be unit length) where the ray enters the cylinder between
 * baseY..baseY+height, or null on a miss. Handles the ray originating INSIDE the
 * cylinder (near root used, else far root).
 */
export function rayCylinder(
  ox: number,
  oy: number,
  oz: number,
  dir: { x: number; y: number; z: number },
  cx: number,
  cz: number,
  radius: number,
  y0: number,
  y1: number,
): number | null {
  const a = dir.x * dir.x + dir.z * dir.z;
  const ox2 = ox - cx;
  const oz2 = oz - cz;

  // Purely-vertical ray: hit only if the origin is within the disc footprint.
  if (a < 1e-8) {
    if (ox2 * ox2 + oz2 * oz2 > radius * radius) return null;
    if (dir.y > 0) {
      const t = (y1 - oy) / dir.y;
      return t >= 0 ? t : null;
    } else if (dir.y < 0) {
      const t = (y0 - oy) / dir.y;
      return t >= 0 ? t : null;
    }
    return null;
  }

  const b = 2 * (ox2 * dir.x + oz2 * dir.z);
  const c = ox2 * ox2 + oz2 * oz2 - radius * radius;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const tNear = (-b - sq) / (2 * a);
  const tFar = (-b + sq) / (2 * a);

  // Try the near intersection first, then the far (origin inside the cylinder).
  for (const t of [tNear, tFar]) {
    if (t < 0) continue;
    const hy = oy + dir.y * t;
    if (hy >= y0 && hy <= y1) return t;
  }
  return null;
}

function normalize(dx: number, dy: number, dz: number) {
  const len = Math.hypot(dx, dy, dz) || 1;
  return { x: dx / len, y: dy / len, z: dz / len };
}

/**
 * Resolve a shot against disguised players and static furniture.
 * - Nearest player hit within range and not occluded by nearer furniture -> "hit".
 * - Otherwise nearest furniture within range -> "wrong" (penalty for shooting props).
 * - Nothing -> "miss".
 */
export function resolveShot(
  ray: ShotRay,
  players: CylinderTarget[],
  props: CylinderTarget[],
  range: number,
): ShotResolution {
  const dir = normalize(ray.dx, ray.dy, ray.dz);

  let bestPlayerT = Infinity;
  let victimId: string | undefined;
  for (const pl of players) {
    const t = rayCylinder(ray.ox, ray.oy, ray.oz, dir, pl.x, pl.z, pl.radius, pl.baseY, pl.baseY + pl.height);
    if (t !== null && t <= range && t < bestPlayerT) {
      bestPlayerT = t;
      victimId = pl.id;
    }
  }

  let bestPropT = Infinity;
  for (const pr of props) {
    const t = rayCylinder(ray.ox, ray.oy, ray.oz, dir, pr.x, pr.z, pr.radius, pr.baseY, pr.baseY + pr.height);
    if (t !== null && t <= range && t < bestPropT) bestPropT = t;
  }

  if (victimId && bestPlayerT <= bestPropT) {
    return { kind: "hit", targetId: victimId, t: bestPlayerT, hx: ray.ox + dir.x * bestPlayerT, hy: ray.oy + dir.y * bestPlayerT, hz: ray.oz + dir.z * bestPlayerT };
  }
  if (isFinite(bestPropT) && bestPropT <= range) {
    return { kind: "wrong", t: bestPropT, hx: ray.ox + dir.x * bestPropT, hy: ray.oy + dir.y * bestPropT, hz: ray.oz + dir.z * bestPropT };
  }
  return { kind: "miss" };
}

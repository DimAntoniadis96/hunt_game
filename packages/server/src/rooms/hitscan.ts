/**
 * Pure server-side hitscan geometry — no Colyseus/room state, so it can be unit
 * tested directly. The authoritative `GameRoom` builds targets from the current
 * state and calls `resolveShot`; it never trusts the client to decide a hit.
 */

import type { Occluder } from "@mimic/shared";

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
 * Ray vs a clamped vertical cylinder. Returns the nearest non-negative distance
 * `t` (metres, dir must be unit length) where the ray first touches the finite
 * cylinder, including its top/bottom caps, or null on a miss. If the ray starts
 * inside the cylinder, the target is already hit and 0 is returned.
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
  const EPS = 1e-8;
  const ox2 = ox - cx;
  const oz2 = oz - cz;
  const r2 = radius * radius;
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);
  const insideFootprint = ox2 * ox2 + oz2 * oz2 <= r2 + EPS;
  if (insideFootprint && oy >= minY - EPS && oy <= maxY + EPS) return 0;

  let best: number | null = null;
  const consider = (t: number) => {
    if (t < -EPS) return;
    const clampedT = Math.max(0, t);
    if (best === null || clampedT < best) best = clampedT;
  };

  // Side wall intersections.
  const a = dir.x * dir.x + dir.z * dir.z;
  if (a >= EPS) {
    const b = 2 * (ox2 * dir.x + oz2 * dir.z);
    const c = ox2 * ox2 + oz2 * oz2 - r2;
    const disc = b * b - 4 * a * c;
    if (disc >= -EPS) {
      const sq = Math.sqrt(Math.max(0, disc));
      const tNear = (-b - sq) / (2 * a);
      const tFar = (-b + sq) / (2 * a);
      for (const t of [tNear, tFar]) {
        if (t < -EPS) continue;
        const hy = oy + dir.y * t;
        if (hy >= minY - EPS && hy <= maxY + EPS) consider(t);
      }
    }
  }

  // Top/bottom caps. This is what makes shots from above or below reliable.
  if (Math.abs(dir.y) >= EPS) {
    for (const capY of [minY, maxY]) {
      const t = (capY - oy) / dir.y;
      if (t < -EPS) continue;
      const hx = ox2 + dir.x * t;
      const hz = oz2 + dir.z * t;
      if (hx * hx + hz * hz <= r2 + EPS) consider(t);
    }
  }

  return best;
}

function normalize(dx: number, dy: number, dz: number) {
  const len = Math.hypot(dx, dy, dz) || 1;
  return { x: dx / len, y: dy / len, z: dz / len };
}

/**
 * Ray vs axis-aligned box (slab method). `dir` must be unit length. Returns the
 * nearest ENTRY distance t within (0, maxT], or null if the ray misses the box
 * (or only touches it behind the origin). If the origin is inside the box, 0 is
 * returned (immediately blocked).
 */
export function rayBoxEntry(
  o: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  box: Occluder,
  maxT: number,
): number | null {
  let tmin = -Infinity;
  let tmax = Infinity;
  const axes: Array<[number, number, number, number]> = [
    [o.x, dir.x, box.minX, box.maxX],
    [o.y, dir.y, box.minY, box.maxY],
    [o.z, dir.z, box.minZ, box.maxZ],
  ];
  for (const [oo, dd, lo, hi] of axes) {
    if (Math.abs(dd) < 1e-9) {
      if (oo < lo || oo > hi) return null; // parallel to slab and outside it
    } else {
      let t1 = (lo - oo) / dd;
      let t2 = (hi - oo) / dd;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
  }
  if (tmax < 0) return null; // box entirely behind the origin
  const tEntry = tmin > 0 ? tmin : 0; // origin inside -> 0
  return tEntry <= maxT ? tEntry : null;
}

/**
 * Nearest distance at which any occluder blocks the ray, or Infinity if clear.
 * A tiny floor ignores occluders essentially at the origin (touching a wall).
 */
export function firstOccluderDistance(
  o: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  occluders: Occluder[],
  maxT: number,
): number {
  let best = Infinity;
  for (const b of occluders) {
    const t = rayBoxEntry(o, dir, b, maxT);
    if (t !== null && t > 0.02 && t < best) best = t;
  }
  return best;
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
  occluders: Occluder[] = [],
): ShotResolution {
  const dir = normalize(ray.dx, ray.dy, ray.dz);
  const o = { x: ray.ox, y: ray.oy, z: ray.oz };

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
  let propId: string | undefined;
  for (const pr of props) {
    const t = rayCylinder(ray.ox, ray.oy, ray.oz, dir, pr.x, pr.z, pr.radius, pr.baseY, pr.baseY + pr.height);
    if (t !== null && t <= range && t < bestPropT) {
      bestPropT = t;
      propId = pr.id;
    }
  }

  // A wall/house/hedge in the way stops the bullet before it reaches anything.
  const occT = firstOccluderDistance(o, dir, occluders, range);

  if (victimId && bestPlayerT <= bestPropT && bestPlayerT < occT) {
    return { kind: "hit", targetId: victimId, t: bestPlayerT, hx: ray.ox + dir.x * bestPlayerT, hy: ray.oy + dir.y * bestPlayerT, hz: ray.oz + dir.z * bestPlayerT };
  }
  if (isFinite(bestPropT) && bestPropT <= range && bestPropT < occT) {
    return { kind: "wrong", targetId: propId, t: bestPropT, hx: ray.ox + dir.x * bestPropT, hy: ray.oy + dir.y * bestPropT, hz: ray.oz + dir.z * bestPropT };
  }
  return { kind: "miss" }; // clear air, or the shot was blocked by a wall
}

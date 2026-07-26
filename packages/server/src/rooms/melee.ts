/**
 * Pure melee target selection — no Colyseus/Babylon deps so it can be unit
 * tested. The axe connects with whatever the hunter's aim line actually reaches
 * in a short, slightly-thickened volume (nearest wins). Works for both prop
 * players and decoy clones, and is blocked by walls (can't axe someone through
 * a hedge).
 */

import type { Occluder } from "@mimic/shared";
import { firstOccluderDistance } from "./hitscan.js";

export interface MeleeTarget {
  kind: "player" | "decoy";
  id: string;
  /** Target cylinder centre in the horizontal plane. */
  x: number;
  z: number;
  /** World Y of the target base. */
  baseY: number;
  /** Target cylinder height. */
  height: number;
  radius: number;
}

export interface MeleeHit {
  kind: "player" | "decoy";
  id: string;
  dist: number;
}

const MELEE_AIM_RADIUS = 0.25;
const MELEE_VERTICAL_SLOP = 0.2;

function rayMeleeCylinder(
  o: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  target: MeleeTarget,
  maxT: number,
): number | null {
  const radius = target.radius + MELEE_AIM_RADIUS;
  const y0 = target.baseY - MELEE_VERTICAL_SLOP;
  const y1 = target.baseY + target.height + MELEE_VERTICAL_SLOP;
  const ox = o.x - target.x;
  const oz = o.z - target.z;
  const candidates: number[] = [];

  const insideY = o.y >= y0 && o.y <= y1;
  if (insideY && ox * ox + oz * oz <= radius * radius) candidates.push(0);

  const a = dir.x * dir.x + dir.z * dir.z;
  if (a >= 1e-8) {
    const b = 2 * (ox * dir.x + oz * dir.z);
    const c = ox * ox + oz * oz - radius * radius;
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      candidates.push((-b - sq) / (2 * a), (-b + sq) / (2 * a));
    }
  }

  if (Math.abs(dir.y) >= 1e-8) {
    candidates.push((y0 - o.y) / dir.y, (y1 - o.y) / dir.y);
  }

  let best = Infinity;
  for (const t of candidates) {
    if (t < 0 || t > maxT || t >= best) continue;
    const hy = o.y + dir.y * t;
    if (hy < y0 || hy > y1) continue;
    const hx = o.x + dir.x * t - target.x;
    const hz = o.z + dir.z * t - target.z;
    if (hx * hx + hz * hz > radius * radius) continue;
    best = t;
  }

  return Number.isFinite(best) ? best : null;
}

/**
 * @param o        ray origin (the hunter's eye)
 * @param dir      aim direction (need not be normalised)
 * @param range    max reach in metres
 * @param occluders walls that block the swing (can't hit through geometry)
 */
export function selectMeleeTarget(
  o: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  targets: MeleeTarget[],
  range: number,
  occluders: Occluder[] = [],
): MeleeHit | null {
  const dl = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const dx = dir.x / dl;
  const dy = dir.y / dl;
  const dz = dir.z / dl;

  let best: MeleeHit | null = null;
  for (const t of targets) {
    const dist = rayMeleeCylinder(o, { x: dx, y: dy, z: dz }, t, range);
    if (dist === null) continue;
    // A wall between the hunter and the target blocks the swing.
    if (occluders.length && dist > 0.001) {
      const occT = firstOccluderDistance(o, { x: dx, y: dy, z: dz }, occluders, dist);
      if (occT < dist - 0.05) continue;
    }
    if (!best || dist < best.dist) best = { kind: t.kind, id: t.id, dist };
  }
  return best;
}

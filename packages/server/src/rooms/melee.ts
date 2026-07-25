/**
 * Pure melee target selection — no Colyseus/Babylon deps so it can be unit
 * tested. The axe connects with whatever sits inside a short forward cone at the
 * crosshair centre (nearest wins), so it feels centred instead of a thin ray that
 * "misses to the side". Works for both prop players and decoy clones.
 */

export interface MeleeTarget {
  kind: "player" | "decoy";
  id: string;
  /** Target CENTRE in world space (feet + height/2). */
  x: number;
  y: number;
  z: number;
  radius: number;
}

export interface MeleeHit {
  kind: "player" | "decoy";
  id: string;
  dist: number;
}

/**
 * @param o      ray origin (the hunter's eye)
 * @param dir    aim direction (need not be normalised)
 * @param range  max reach in metres
 * @param minFacing cosine of the half-cone angle (0.35 ≈ 70° half-angle)
 */
export function selectMeleeTarget(
  o: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  targets: MeleeTarget[],
  range: number,
  minFacing = 0.35,
): MeleeHit | null {
  const dl = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const dx = dir.x / dl;
  const dy = dir.y / dl;
  const dz = dir.z / dl;

  let best: MeleeHit | null = null;
  for (const t of targets) {
    const vx = t.x - o.x;
    const vy = t.y - o.y;
    const vz = t.z - o.z;
    const dist = Math.hypot(vx, vy, vz);
    if (dist > range + t.radius) continue;
    const facing = dist > 0.001 ? (vx * dx + vy * dy + vz * dz) / dist : 1;
    if (facing < minFacing) continue;
    if (!best || dist < best.dist) best = { kind: t.kind, id: t.id, dist };
  }
  return best;
}

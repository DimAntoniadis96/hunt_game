// Unit test for wall occlusion: ray-vs-box, nearest occluder, and that shots
// are blocked by walls (the "shoot through the wall" bug).
import { rayBoxEntry, firstOccluderDistance, resolveShot } from "../packages/server/dist/rooms/hitscan.js";

let pass = 0, fail = 0;
const check = (cond, label) => { if (cond) pass++; else { fail++; console.log(`  FAIL — ${label}`); } };
const near = (a, b, eps = 0.05) => Math.abs(a - b) <= eps;

const box = (cx, cz, W, D, H = 2, y0 = 0) => ({ minX: cx - W / 2, maxX: cx + W / 2, minY: y0, maxY: y0 + H, minZ: cz - D / 2, maxZ: cz + D / 2 });

// ---- rayBoxEntry ----
let t = rayBoxEntry({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, box(0, 3, 2, 1), 100);
check(t !== null && near(t, 2.5), "ray enters box in front at correct distance");

t = rayBoxEntry({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, box(5, 3, 1, 1), 100);
check(t === null, "ray misses box off to the side");

t = rayBoxEntry({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, box(0, -3, 2, 1), 100);
check(t === null, "box behind the origin is not hit");

t = rayBoxEntry({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, box(0, 0, 4, 4), 100);
check(t === 0, "origin inside box returns 0 (blocked)");

t = rayBoxEntry({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, box(0, 3, 2, 1), 2.0);
check(t === null, "box beyond maxT is ignored");

// ---- firstOccluderDistance ----
const walls = [box(0, 6, 2, 1), box(0, 3, 2, 1)];
check(near(firstOccluderDistance({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, walls, 100), 2.5), "nearest of two walls chosen");
check(firstOccluderDistance({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, walls, 100) === Infinity, "no wall in that direction → Infinity");

// ---- resolveShot occlusion ----
// A prop-player standing at (0,0,5); shooter eye at (0,1.7,0) aiming at its centre.
const victim = { id: "v", x: 0, z: 5, baseY: 0, radius: 0.5, height: 1.8 };
const shot = { ox: 0, oy: 1.7, oz: 0, dx: 0, dy: (0.9 - 1.7), dz: 5 };

let r = resolveShot(shot, [victim], [], 60, []);
check(r.kind === "hit", "no wall → player is hit");

r = resolveShot(shot, [victim], [], 60, [box(0, 2.5, 3, 0.6, 3)]);
check(r.kind === "miss", "wall between shooter and player BLOCKS the shot");

r = resolveShot(shot, [victim], [], 60, [box(0, 6.5, 3, 0.6, 3)]);
check(r.kind === "hit", "wall BEHIND the player does not block");

r = resolveShot(shot, [victim], [], 60, [box(3, 2.5, 0.6, 3, 3)]);
check(r.kind === "hit", "wall off to the side does not block");

// Furniture (decoy/object) behind a wall is also protected.
const furniture = { id: "f", x: 0, z: 4, baseY: 0, radius: 0.5, height: 1.0 };
r = resolveShot(shot, [], [furniture], 60, [box(0, 2.5, 3, 0.6, 3)]);
check(r.kind === "miss", "wall blocks a shot at furniture/decoy too");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// Unit test for the axe melee cone selection (range, cone, occlusion).
import { selectMeleeTarget } from "../packages/server/dist/rooms/melee.js";

const RANGE = 2.5;
const eye = { x: 0, y: 1.7, z: 0 };
const fwd = { x: 0, y: 0, z: 1 }; // looking straight down +Z (crosshair centre)

let pass = 0, fail = 0;
const check = (cond, label) => { if (cond) pass++; else { fail++; console.log(`  FAIL — ${label}`); } };

const player = (id, x, y, z, r = 0.5) => ({ kind: "player", id, x, y, z, radius: r });
const decoy = (id, x, y, z, r = 0.5) => ({ kind: "decoy", id, x, y, z, radius: r });
// Wall box helper (footprint centre, size, height).
const wall = (cx, cz, W, D, H = 2) => ({ minX: cx - W / 2, maxX: cx + W / 2, minY: 0, maxY: H, minZ: cz - D / 2, maxZ: cz + D / 2 });

// 1) A prop centred straight ahead within reach is hit.
let h = selectMeleeTarget(eye, fwd, [player("centre", 0, 0.9, 2.0)], RANGE);
check(h && h.id === "centre" && h.kind === "player", "centred prop in reach is hit");

// 2) A prop off to the SIDE is NOT hit when aiming centre.
h = selectMeleeTarget(eye, fwd, [player("side", 2.0, 0.9, 0.4)], RANGE);
check(h === null, "prop to the side is ignored");

// 3) A DECOY centred ahead is hit.
h = selectMeleeTarget(eye, fwd, [decoy("clone", 0, 0.5, 1.8)], RANGE);
check(h && h.id === "clone" && h.kind === "decoy", "centred decoy clone is hit");

// 4) Nearest of two candidates wins.
h = selectMeleeTarget(eye, fwd, [player("far", 0, 0.9, 2.4), decoy("near", 0, 0.5, 1.6)], RANGE);
check(h && h.id === "near", "nearest candidate wins");

// 5) A target just beyond reach is NOT hit (fixes 'hitting from too far').
h = selectMeleeTarget(eye, fwd, [player("toofar", 0, 0.9, 3.4)], RANGE);
check(h === null, "target beyond melee range ignored");

// 6) Behind the hunter → nothing.
h = selectMeleeTarget(eye, fwd, [player("behind", 0, 0.9, -2)], RANGE);
check(h === null, "target behind ignored");

// 7) A target's radius extends reach a little.
h = selectMeleeTarget(eye, fwd, [player("edge", 0, 1.7, 2.8, 0.5)], RANGE);
check(h && h.id === "edge", "radius extends reach slightly past bare range");

// 8) Slightly off-centre still connects (forgiving cone).
h = selectMeleeTarget(eye, fwd, [player("offset", 0.5, 0.9, 2.0)], RANGE);
check(h && h.id === "offset", "slightly off-centre still connects");

// 9) A wall BETWEEN the hunter and a centred target blocks the swing.
h = selectMeleeTarget(eye, fwd, [player("hidden", 0, 0.9, 2.2)], RANGE, [wall(0, 1.1, 3, 0.4)]);
check(h === null, "wall between blocks the axe");

// 10) A wall BEHIND the target does not block it.
h = selectMeleeTarget(eye, fwd, [player("front", 0, 0.9, 2.0)], RANGE, [wall(0, 2.4, 3, 0.4)]);
check(h && h.id === "front", "wall behind target does not block");

// 11) A wall to the SIDE does not block a centred hit.
h = selectMeleeTarget(eye, fwd, [player("clear", 0, 0.9, 2.0)], RANGE, [wall(2.5, 1.0, 0.4, 3)]);
check(h && h.id === "clear", "wall to the side does not block");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

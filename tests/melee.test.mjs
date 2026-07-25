// Unit test for the axe melee cone selection. No browser/server needed.
import { selectMeleeTarget } from "../packages/server/dist/rooms/melee.js";

const RANGE = 3.6;
const eye = { x: 0, y: 1.7, z: 0 };
const fwd = { x: 0, y: 0, z: 1 }; // looking straight down +Z (crosshair centre)

let pass = 0, fail = 0;
const check = (cond, label) => { if (cond) pass++; else { fail++; console.log(`  FAIL — ${label}`); } };

const player = (id, x, y, z, r = 0.5) => ({ kind: "player", id, x, y, z, radius: r });
const decoy = (id, x, y, z, r = 0.5) => ({ kind: "decoy", id, x, y, z, radius: r });

// 1) A prop centred straight ahead is hit.
let h = selectMeleeTarget(eye, fwd, [player("centre", 0, 0.9, 3.0)], RANGE);
check(h && h.id === "centre" && h.kind === "player", "centred prop is hit");

// 2) A prop off to the SIDE (what felt like 'hitting lefter') is NOT hit when aiming centre.
h = selectMeleeTarget(eye, fwd, [player("side", 3.0, 0.9, 0.5)], RANGE);
check(h === null, "prop to the side is ignored (must aim at crosshair)");

// 3) A DECOY centred ahead is hit (the reported bug: axe didn't kill clones).
h = selectMeleeTarget(eye, fwd, [decoy("clone", 0, 0.5, 2.5)], RANGE);
check(h && h.id === "clone" && h.kind === "decoy", "centred decoy clone is hit");

// 4) With a prop AND a decoy both ahead, the nearer one wins.
h = selectMeleeTarget(eye, fwd, [player("far", 0, 0.9, 3.2), decoy("near", 0, 0.5, 2.2)], RANGE);
check(h && h.id === "near" && h.kind === "decoy", "nearest of two candidates wins");

// 5) Out of range → nothing.
h = selectMeleeTarget(eye, fwd, [player("faraway", 0, 0.9, 10)], RANGE);
check(h === null, "out-of-range target ignored");

// 6) Behind the hunter → nothing.
h = selectMeleeTarget(eye, fwd, [player("behind", 0, 0.9, -3)], RANGE);
check(h === null, "target behind ignored");

// 7) Target's radius extends the effective reach a little.
h = selectMeleeTarget(eye, fwd, [player("edge", 0, 1.7, 3.9, 0.5)], RANGE);
check(h && h.id === "edge", "radius extends reach past bare range");

// 8) Slightly off-centre but within the generous cone still connects.
h = selectMeleeTarget(eye, fwd, [player("offset", 0.6, 0.9, 2.6)], RANGE);
check(h && h.id === "offset", "slightly off-centre still connects (forgiving cone)");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

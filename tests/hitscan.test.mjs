// Unit test for the authoritative hitscan across EVERY prop shape, at ground
// level and elevated (the bug from the screenshot). No browser/server needed.
import { resolveShot, rayCylinder } from "../packages/server/dist/rooms/hitscan.js";
import { HIT_RADIUS_BUFFER } from "../packages/server/dist/rooms/targetGeometry.js";
import { PROP_MODELS } from "../packages/shared/dist/index.js";

const HIT_BUFFER = HIT_RADIUS_BUFFER;
let pass = 0, fail = 0;
const check = (cond, label) => { if (cond) { pass++; } else { fail++; console.log(`  FAIL — ${label}`); } };

const approx = (actual, expected, eps = 0.01) => actual !== null && Math.abs(actual - expected) <= eps;
const unit = (x, y, z) => {
  const len = Math.hypot(x, y, z) || 1;
  return { x: x / len, y: y / len, z: z / len };
};

// Build a target for a prop model at a given feet/base height.
const target = (model, baseY, id = "victim") => ({ id, x: 0, z: 0, baseY, radius: model.radius * HIT_BUFFER, height: model.height });

// A shot from a hunter's eye ~5m away aiming at the cylinder's centre.
function shotAt(cx, cy, cz, eye = { x: 0, y: 1.7, z: -5 }) {
  return { ox: eye.x, oy: eye.y, oz: eye.z, dx: cx - eye.x, dy: cy - eye.y, dz: cz - eye.z };
}

console.log("Testing hitscan for every prop shape at ground + elevation + overhead angles:\n");
for (const key of Object.keys(PROP_MODELS)) {
  const model = PROP_MODELS[key];
  for (const baseY of [0, 1.15, 1.4, 2.5]) {
    const tgt = target(model, baseY);
    const centerY = baseY + model.height / 2;
    let res = resolveShot(shotAt(0, centerY, 0), [tgt], [], 60);
    check(res.kind === "hit" && res.targetId === "victim", `${key} @ baseY=${baseY}: front centre HIT (got ${res.kind})`);

    const topEye = { x: 0, y: baseY + model.height + 1.7, z: 0 };
    res = resolveShot(shotAt(0, centerY, 0, topEye), [tgt], [], 60);
    check(res.kind === "hit" && res.targetId === "victim", `${key} @ baseY=${baseY}: straight-down player HIT (got ${res.kind})`);

    const decoy = target(model, baseY, "decoy:d1");
    res = resolveShot(shotAt(0, centerY, 0, topEye), [], [decoy], 60);
    check(res.kind === "wrong" && res.targetId === "decoy:d1", `${key} @ baseY=${baseY}: straight-down decoy HIT as furniture (got ${res.kind})`);

    const diagonalEye = { x: model.radius * 0.55, y: baseY + model.height + 2.2, z: -model.radius * 0.55 };
    res = resolveShot(shotAt(0, centerY, 0, diagonalEye), [], [decoy], 60);
    check(res.kind === "wrong" && res.targetId === "decoy:d1", `${key} @ baseY=${baseY}: diagonal-above decoy HIT as furniture (got ${res.kind})`);

    const edgeRay = shotAt(model.radius * 0.98, centerY, 0);
    res = resolveShot(edgeRay, [tgt], [], 60);
    check(res.kind === "hit", `${key} @ baseY=${baseY}: visible radius edge is targetable (got ${res.kind})`);
  }
}

// REGRESSION: an elevated target must MISS when (incorrectly) tested at ground
// level, and HIT when tested at its true height. This is exactly the screenshot bug.
{
  const model = PROP_MODELS.barrel;
  const baseY = 1.15; // standing on another barrel
  const centerY = baseY + model.height / 2;
  const ray = shotAt(0, centerY, 0);
  const groundCyl = { id: "v", x: 0, z: 0, baseY: 0, radius: model.radius * HIT_BUFFER, height: model.height };
  const trueCyl = { id: "v", x: 0, z: 0, baseY, radius: model.radius * HIT_BUFFER, height: model.height };
  check(resolveShot(ray, [groundCyl], [], 60).kind === "miss", "regression: elevated barrel vs GROUND cylinder = miss (old bug)");
  check(resolveShot(ray, [trueCyl], [], 60).kind === "hit", "regression: elevated barrel vs TRUE-height cylinder = hit (fixed)");
}

// Aiming clearly ABOVE / BELOW a grounded prop should miss it.
{
  const model = PROP_MODELS.crate_small;
  const tgt = target(model, 0);
  check(resolveShot(shotAt(0, 3.5, 0), [tgt], [], 60).kind === "miss", "aim well above small crate = miss");
  check(resolveShot(shotAt(model.radius * HIT_BUFFER + 0.25, model.height / 2, 0), [tgt], [], 60).kind === "miss", "aim outside small crate target radius = miss");
}

// Occlusion: a solid prop directly in front of the player -> "wrong", not "hit".
{
  const model = PROP_MODELS.crate_large;
  const victim = target(model, 0);                              // at z=0
  const blocker = { id: "wall", x: 0, z: -2, baseY: 0, radius: 1.0, height: 2.5 }; // between eye(-5) and victim(0)
  const ray = shotAt(0, model.height / 2, 0);
  const res = resolveShot(ray, [victim], [blocker], 60);
  check(res.kind === "wrong", `furniture between hunter and prop shields it (got ${res.kind})`);
}

// Empty air -> miss. Out of range -> miss.
check(resolveShot(shotAt(0, 1, 0), [], [], 60).kind === "miss", "empty air = miss");
{
  const far = { id: "v", x: 0, z: 100, baseY: 0, radius: 0.5, height: 1 };
  check(resolveShot({ ox: 0, oy: 1, oz: -5, dx: 0, dy: 0, dz: 1 }, [far], [], 60).kind === "miss", "target beyond WEAPON_RANGE = miss");
}

// Direct rayCylinder sanity: unit dir, horizontal shot through centre.
{
  const t = rayCylinder(0, 0.5, -5, { x: 0, y: 0, z: 1 }, 0, 0, 0.5, 0, 1);
  check(t !== null && Math.abs(t - 4.5) < 0.01, `rayCylinder returns correct distance (got ${t?.toFixed(2)}, want 4.50)`);
}

// Direct rayCylinder cap coverage: top-down, bottom-up, diagonal cap, and origin
// inside. These are the cases that broke shooting clones from above.
{
  const topDown = rayCylinder(0, 2, 0, { x: 0, y: -1, z: 0 }, 0, 0, 0.5, 0, 1);
  check(approx(topDown, 1), `rayCylinder top cap from above (got ${topDown?.toFixed(2)}, want 1.00)`);

  const bottomUp = rayCylinder(0, -1, 0, { x: 0, y: 1, z: 0 }, 0, 0, 0.5, 0, 1);
  check(approx(bottomUp, 1), `rayCylinder bottom cap from below (got ${bottomUp?.toFixed(2)}, want 1.00)`);

  const dir = unit(0, -1, 0.25);
  const diagonalCap = rayCylinder(0, 2, -0.2, dir, 0, 0, 0.5, 0, 1);
  check(approx(diagonalCap, 1 / Math.abs(dir.y)), `rayCylinder diagonal top cap (got ${diagonalCap?.toFixed(2)}, want ${(1 / Math.abs(dir.y)).toFixed(2)})`);

  const inside = rayCylinder(0, 0.5, 0, { x: 1, y: 0, z: 0 }, 0, 0, 0.5, 0, 1);
  check(inside === 0, `rayCylinder origin inside returns 0 (got ${inside})`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

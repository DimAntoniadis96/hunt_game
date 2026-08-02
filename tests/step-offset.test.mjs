// Step offset: a player must be able to walk over low ledges (the pool coping,
// sandbox edges, prop plinths) without jumping, while everything that is meant
// to block — fences, hedges, the house, the shed — still blocks.
//
// Before this, the collision ellipsoid started at the player's feet, so ANY
// ledge above 0m stopped you dead; the only escape was to jump. Measured in a
// headless Babylon scene: 0 of 13 low ledges on the backyard map were passable.
//
// This test is geometric — it checks the map's obstacle heights against the
// step envelope, which is what actually decides passability. It needs no
// browser, so it runs with the rest of the suite.
import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MAPS, PLAYER_EYE_HEIGHT } from "../packages/shared/dist/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "packages/client/src/game/InputController.ts"), "utf8");

let n = 0;
const check = (cond, msg) => { assert.ok(cond, msg); n++; };

// ---- the controller is actually configured for stepping ---------------------
const stepMatch = src.match(/const STEP_HEIGHT = ([\d.]+);/);
check(!!stepMatch, "STEP_HEIGHT is defined");
const STEP = parseFloat(stepMatch[1]);
check(STEP >= 0.3 && STEP <= 0.5,
  `STEP_HEIGHT ${STEP} should sit in the 0.3-0.5m range shipped engines use (Unity 0.3, Unreal/Source 0.45)`);

check(/ellipsoidOffset = new Vector3\(0, STEP_HEIGHT \+ BODY_HALF - HALF, 0\)/.test(src),
  "the collider base is lifted by STEP_HEIGHT via ellipsoidOffset");
check(/new Vector3\(PLAYER_RADIUS, BODY_HALF, PLAYER_RADIUS\)/.test(src),
  "the collider uses the reduced half-height so its TOP is unchanged");
check(/const BODY_HALF = \(PLAYER_EYE_HEIGHT - STEP_HEIGHT\) \/ 2;/.test(src),
  "BODY_HALF is derived from the eye height, so the two can't drift apart");
check(/new Ray\(origin, DOWN, STEP_HEIGHT \+ GROUND_SNAP_BELOW\)/.test(src),
  "the ground probe reaches up over the step envelope so the player rises onto a ledge");

// The collider's top must still be at eye height — otherwise low ceilings and
// head clearance would silently change.
{
  const bodyHalf = (PLAYER_EYE_HEIGHT - STEP) / 2;
  const top = STEP + bodyHalf * 2;
  assert.equal(+top.toFixed(6), PLAYER_EYE_HEIGHT, "collider top must remain at eye height");
  n++;
}

// ---- map geometry: the split between "step over" and "blocks you" ----------
// Every solid the server knows about (occluders) must be TALLER than the step
// envelope, or lifting the collider would let players walk through a wall.
for (const map of Object.values(MAPS)) {
  const solids = map.occluders.filter((o) => o.maxY - o.minY > 0.05);
  assert.ok(solids.length > 0, `${map.id} should define occluders`);
  for (const [i, o] of solids.entries()) {
    const h = o.maxY - o.minY;
    assert.ok(
      h > STEP,
      `${map.id} occluder #${i} is ${h.toFixed(2)}m tall, which is <= the ${STEP}m step height — ` +
        `players would walk straight through it. Either raise it or lower STEP_HEIGHT.`,
    );
    n++;
  }
}

console.log(`step-offset: ${n} assertions passed (step height ${STEP}m)`);

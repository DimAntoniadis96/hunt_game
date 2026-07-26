// Regression tests for authoritative gun target sizes. Real transformed props,
// map props, and decoy clones must use identical model radius/height math so a
// hunter cannot identify the real hider by different hit or collision behavior.
import { PLAYER_RADIUS, PROP_MODELS } from "../packages/shared/dist/index.js";
import {
  HIT_RADIUS_BUFFER,
  PLAYER_HIT_HEIGHT,
  bufferedPropRadius,
  playerHitCylinder,
  propModelHitCylinder,
} from "../packages/server/dist/rooms/targetGeometry.js";

let pass = 0, fail = 0;
const check = (cond, label) => { if (cond) pass++; else { fail++; console.log(`  FAIL — ${label}`); } };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

for (const key of Object.keys(PROP_MODELS)) {
  const model = PROP_MODELS[key];
  const expectedRadius = model.radius * HIT_RADIUS_BUFFER;

  const real = playerHitCylinder("player", 3, 1.25, -2, key);
  const scenery = propModelHitCylinder("static", key, 3, 1.25, -2);
  const decoy = propModelHitCylinder("decoy:d1", key, 3, 1.25, -2);

  check(scenery !== null && decoy !== null, `${key}: static and decoy target created`);
  check(near(bufferedPropRadius(model), expectedRadius), `${key}: buffered radius helper matches model radius`);
  check(near(real.radius, expectedRadius), `${key}: real transformed player target radius matches model`);
  check(near(scenery.radius, expectedRadius), `${key}: scenery target radius matches model`);
  check(near(decoy.radius, expectedRadius), `${key}: decoy target radius matches model`);
  check(real.height === model.height && scenery.height === model.height && decoy.height === model.height, `${key}: every target uses model height`);
  check(real.baseY === 1.25 && scenery.baseY === 1.25 && decoy.baseY === 1.25, `${key}: every target preserves elevated baseY`);
}

const fallback = playerHitCylinder("player", 0, 0.5, 0, "");
check(near(fallback.radius, PLAYER_RADIUS * HIT_RADIUS_BUFFER), "undisguised fallback radius uses the same buffer");
check(fallback.height === PLAYER_HIT_HEIGHT, "undisguised fallback height is stable");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

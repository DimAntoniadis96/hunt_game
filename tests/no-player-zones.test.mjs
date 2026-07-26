import { strict as assert } from "node:assert";
import { BACKYARD, BACKYARD_TREE_POSITIONS, DECOY_MAX_PLACE_Y, DEPOT_7, MAX_PLAYABLE_Y, resolveNoPlayerZones } from "../packages/shared/dist/index.js";

assert.equal(DEPOT_7.noPlayerZones.length, 0, "warehouse should not unexpectedly block playable volumes");
assert.ok(BACKYARD.noPlayerZones.length >= BACKYARD_TREE_POSITIONS.length + 2, "backyard should define roof and tree no-player zones");
assert.ok(DECOY_MAX_PLACE_Y <= 0.5, "decoy placement must stay floor-level to prevent clone staircases");
assert.ok(MAX_PLAYABLE_Y <= 2.2, "playable height ceiling must prevent roof/tree/sky climbing");

const houseRoof = resolveNoPlayerZones({ x: 0, y: 6.5, z: 29.5 }, BACKYARD.noPlayerZones);
assert.equal(houseRoof.blocked, true, "house roof position should be rejected");
assert.equal(houseRoof.y, 0, "house roof ejection should return the player to ground level");
assert.ok(houseRoof.z <= 25.05, "house roof ejection should push the player to the visible patio side");

const shedRoof = resolveNoPlayerZones({ x: -30, y: 2.9, z: -28 }, BACKYARD.noPlayerZones);
assert.equal(shedRoof.blocked, true, "shed roof position should be rejected");
assert.equal(shedRoof.y, 0, "shed roof ejection should return the player to ground level");
assert.ok(shedRoof.z >= -23.85, "shed roof ejection should push the player outside the shed cap");

for (const [i, [x, z]] of BACKYARD_TREE_POSITIONS.entries()) {
  const highLeaf = resolveNoPlayerZones({ x, y: 3.1, z }, BACKYARD.noPlayerZones);
  assert.equal(highLeaf.blocked, true, `tree ${i} crown should reject elevated hiding`);
  assert.equal(highLeaf.y, 0, `tree ${i} crown should send the player back to the ground`);
  assert.ok(Math.hypot(highLeaf.x - x, highLeaf.z - z) >= 3.3, `tree ${i} crown should eject outside the leaves/trunk`);

  const groundCover = resolveNoPlayerZones({ x, y: 0.2, z }, BACKYARD.noPlayerZones);
  assert.equal(groundCover.blocked, false, `tree ${i} ground cover should remain playable`);
}

const normalLawn = resolveNoPlayerZones({ x: 7, y: 0, z: -8 }, BACKYARD.noPlayerZones);
assert.equal(normalLawn.blocked, false, "ordinary lawn space should remain playable");

console.log("Backyard no-player zones reject roof/tree exploits without blocking normal ground play.");

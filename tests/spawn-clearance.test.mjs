// Spawn points must not put a player inside a prop, a wall, or another player.
//
// Regression: on the backyard map two of the eight authored propSpawns were
// blocked — one overlapping tree stump b73, one inside the low garden wall —
// and since spawns are handed out round-robin, real players landed in them
// every round. The server now runs every spawn through resolveSpawnPoint().
// Pure geometry, no server needed.
import { strict as assert } from "node:assert";
import { MAPS, PLAYER_RADIUS, isSpawnClear, resolveSpawnPoint, spawnBlockedBy } from "../packages/shared/dist/index.js";

let checks = 0;
const maps = Object.values(MAPS);
assert.ok(maps.length > 0, "expected at least one map");

for (const map of maps) {
  for (const [label, list] of [
    ["propSpawns", map.propSpawns],
    ["hunterSpawns", map.hunterSpawns],
  ]) {
    assert.ok(list.length > 0, `${map.id}.${label} must not be empty`);

    list.forEach((desired, i) => {
      const s = resolveSpawnPoint(map, desired, PLAYER_RADIUS);
      const blocker = spawnBlockedBy(map, s.x, s.z, PLAYER_RADIUS);
      assert.equal(
        blocker,
        null,
        `${map.id}.${label}[${i}] (${desired.x}, ${desired.z}) resolved to (${s.x.toFixed(2)}, ${s.z.toFixed(2)}) ` +
          `which is still blocked by ${blocker?.kind} ${blocker?.ref}`,
      );

      // The resolver must stay near the authored intent, not fling the player
      // across the level.
      const moved = Math.hypot(s.x - desired.x, s.z - desired.z);
      assert.ok(moved <= 8.001, `${map.id}.${label}[${i}] moved ${moved.toFixed(2)}m — too far from the authored point`);

      // Resolution must be deterministic: the server is authoritative.
      const again = resolveSpawnPoint(map, desired, PLAYER_RADIUS);
      assert.equal(again.x, s.x, `${map.id}.${label}[${i}] resolver is not deterministic in x`);
      assert.equal(again.z, s.z, `${map.id}.${label}[${i}] resolver is not deterministic in z`);

      // y/ry are preserved so facing and floor height are untouched.
      assert.equal(s.y, desired.y, `${map.id}.${label}[${i}] y changed`);
      assert.equal(s.ry, desired.ry, `${map.id}.${label}[${i}] ry changed`);
      checks++;
    });
  }

  // A full round's worth of players must all get distinct, clear spots — this
  // is what stops two players spawning inside each other when there are more
  // players than authored spawn points.
  const taken = [];
  for (let i = 0; i < 16; i++) {
    const desired = map.propSpawns[i % map.propSpawns.length];
    const s = resolveSpawnPoint(map, desired, PLAYER_RADIUS, taken);
    const blocker = spawnBlockedBy(map, s.x, s.z, PLAYER_RADIUS, taken);
    assert.equal(blocker, null, `${map.id}: player ${i} spawned into ${blocker?.kind} ${blocker?.ref}`);
    taken.push({ x: s.x, z: s.z, radius: PLAYER_RADIUS });
    checks++;
  }
}

// Sanity-check the detector itself: a point at a known prop must read blocked,
// otherwise the assertions above could pass vacuously.
{
  const map = MAPS.backyard ?? maps[0];
  const p = map.props[0];
  assert.ok(p, "expected the map to define props");
  assert.equal(isSpawnClear(map, p.x, p.z, PLAYER_RADIUS), false, "a point centred on a prop must be reported blocked");
  const far = spawnBlockedBy(map, 1e6, 1e6, PLAYER_RADIUS);
  assert.equal(far?.kind, "bounds", "a point outside the map must be reported out of bounds");
  checks += 2;
}

console.log(`spawn-clearance: ${checks} assertions passed across ${maps.length} map(s)`);

// Static map layout sanity: decorative prop spawns should not overlap by their
// declared collision radii. Overlaps make props appear embedded in each other
// and can expose inner decoration when the camera moves.
import { MAPS, PROP_MODELS } from "../packages/shared/dist/maps.js";

const EPS = 0.01;
const failures = [];

for (const map of Object.values(MAPS)) {
  for (let i = 0; i < map.props.length; i++) {
    for (let j = i + 1; j < map.props.length; j++) {
      const a = map.props[i];
      const b = map.props[j];
      const ma = PROP_MODELS[a.modelKey];
      const mb = PROP_MODELS[b.modelKey];
      const dist = Math.hypot(a.x - b.x, a.z - b.z);
      const minDist = ma.radius + mb.radius;

      if (dist + EPS < minDist) {
        failures.push(
          `${map.id}: ${a.id}:${a.modelKey} overlaps ${b.id}:${b.modelKey} ` +
            `(distance ${dist.toFixed(2)}m, needs ${minDist.toFixed(2)}m)`,
        );
      }
    }
  }
}

if (failures.length) {
  console.log(failures.join("\n"));
  process.exit(1);
}

console.log("All static map prop spawns have non-overlapping collision radii.");

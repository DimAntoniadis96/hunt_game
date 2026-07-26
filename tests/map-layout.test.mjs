// Static map layout sanity. Overlaps make props/hedges appear embedded in each
// other and can expose flickering inner faces when the camera moves.
import { BACKYARD_HEDGES, MAPS, PROP_MODELS } from "../packages/shared/dist/maps.js";

const EPS = 0.01;
const failures = [];

function boxOverlap(a, b) {
  return {
    x: Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX),
    y: Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY),
    z: Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ),
  };
}

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

for (let i = 0; i < BACKYARD_HEDGES.length; i++) {
  for (let j = i + 1; j < BACKYARD_HEDGES.length; j++) {
    const overlap = boxOverlap(BACKYARD_HEDGES[i], BACKYARD_HEDGES[j]);
    if (overlap.x > EPS && overlap.y > EPS && overlap.z > EPS) {
      failures.push(
        `backyard hedges ${i}/${j} overlap ` +
          `(${overlap.x.toFixed(2)}m x ${overlap.y.toFixed(2)}m x ${overlap.z.toFixed(2)}m)`,
      );
    }
  }
}

if (failures.length) {
  console.log(failures.join("\n"));
  process.exit(1);
}

console.log("All static prop spawns and backyard hedge boxes are non-overlapping.");

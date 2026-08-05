// Z-FIGHTING: the ground crawling and shimmering as you turn the camera.
//
// Flush paving is drawn at the same height as the ground and wins the depth
// test with a negative zOffset, rather than being physically raised — a raised
// plane slices the bottoms off every prop standing on it. The cost of that
// trick is that two COPLANAR quads with the SAME bias tie in the depth buffer,
// and the tie breaks differently per pixel per frame. The result is a surface
// that visibly boils when the camera moves, and no renderer setting fixes it:
// the layout has to not produce it.
//
// The cemetery did exactly this. `lane_ns` (8 x 50m) and `lane_ew` (60 x 8m)
// were both drawn full length at zOffset -1, so they overlapped in an 8x8m
// square dead centre on the crossing — the piece of ground players cross most.
//
// This file guards both maps: the cemetery from its shared data, and the
// backyard by reading the decal calls out of the builder, since those are still
// written inline.
import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CEMETERY_FLOORS, MAPS } from "../packages/shared/dist/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "packages/client/src/game/mapBuilder.ts"), "utf8");

let n = 0;
const check = (cond, msg) => { assert.ok(cond, msg); n++; };

/** Overlap of two axis-aligned rectangles, in metres on each axis. */
function overlap(a, b) {
  const ox = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
  const oz = Math.min(a.z + a.d / 2, b.z + b.d / 2) - Math.max(a.z - a.d / 2, b.z - b.d / 2);
  return { ox, oz, area: Math.max(0, ox) * Math.max(0, oz) };
}

/** The shared rule, applied to any list of {x,z,w,d,zPri,label} surfaces. */
function assertNoTies(surfaces, label) {
  for (let i = 0; i < surfaces.length; i++) {
    for (let j = i + 1; j < surfaces.length; j++) {
      const a = surfaces[i], b = surfaces[j];
      const { ox, oz } = overlap(a, b);
      if (ox > 0.001 && oz > 0.001) {
        assert.ok(
          a.zPri !== b.zPri,
          `${label}: "${a.label}" and "${b.label}" overlap by ${ox.toFixed(2)}x${oz.toFixed(2)}m ` +
            `at the same depth bias (${a.zPri}). Coplanar quads with equal bias z-fight — ` +
            `the ground will crawl here as the camera moves.`,
        );
        n++;
      }
    }
  }
}

// ---- 1. the cemetery, from shared data --------------------------------------
check(Array.isArray(CEMETERY_FLOORS) && CEMETERY_FLOORS.length >= 4,
  `the cemetery publishes its ground surfaces as data (${CEMETERY_FLOORS.length} of them)`);
const cem = CEMETERY_FLOORS.map((f, i) => ({ ...f, label: `floor#${i}` }));
assertNoTies(cem, "hollow_row");

// Every surface must have a sane footprint and sit inside the map.
const b = MAPS.hollow_row.bounds;
for (const [i, f] of CEMETERY_FLOORS.entries()) {
  check(f.w > 0 && f.d > 0, `floor#${i} has a positive footprint`);
  check(Number.isFinite(f.zPri) && f.zPri <= 0, `floor#${i} has a depth bias that pulls it forward (${f.zPri})`);
  check(
    f.x - f.w / 2 >= b.minX - 0.01 && f.x + f.w / 2 <= b.maxX + 0.01 &&
    f.z - f.d / 2 >= b.minZ - 0.01 && f.z + f.d / 2 <= b.maxZ + 0.01,
    `floor#${i} stays inside the map bounds`,
  );
}

// The crossing specifically: this is the exact spot that used to boil, so it
// gets its own named assertion rather than relying on the sweep above.
const atOrigin = CEMETERY_FLOORS.filter((f) =>
  Math.abs(f.x) < f.w / 2 - 0.01 && Math.abs(f.z) < f.d / 2 - 0.01);
check(atOrigin.length <= 1,
  `at most one ground surface covers the crossing at (0,0) — found ${atOrigin.length}`);

// ---- 2. the backyard, read out of the builder -------------------------------
// Its decals are still written inline as flat(name, W, D, x, z, hex, kind, zPri),
// and several position arguments are expressions rather than literals. Rather
// than refactor a map that works, resolve the handful of locals the builder uses
// and evaluate `ident`, `number` and `ident ± number` forms.
const by = MAPS.backyard.bounds;
const SYMS = {
  minX: by.minX, maxX: by.maxX, minZ: by.minZ, maxZ: by.maxZ,
  cz: (by.minZ + by.maxZ) / 2,
  w: by.maxX - by.minX, d: by.maxZ - by.minZ,
  sbX: 32, sbZ: -30, sbS: 5,
};
function evalArg(text) {
  const t = text.trim();
  if (/^-?[\d.]+$/.test(t)) return +t;
  if (t in SYMS) return SYMS[t];
  const m = t.match(/^([A-Za-z]\w*)\s*([+-])\s*([\d.]+)$/);
  if (m && m[1] in SYMS) return SYMS[m[1]] + (m[2] === "-" ? -1 : 1) * +m[3];
  return null; // unresolvable — surfaced as a failure below, never skipped
}

const backyard = src.slice(src.indexOf("function buildBackyard"), src.indexOf("function buildCemetery"));
check(backyard.length > 1000, "the backyard builder was located");
// The default zPri baked into the helper's signature, for calls that omit it.
const defaultZPri = +(backyard.match(/kind: TexKind = "concrete", zPri = (-?[\d.]+)/) ?? src.match(/zPri = (-?[\d.]+)/))[1];

const decals = [];
const calls = [...backyard.matchAll(/\bflat\(\s*"([a-z_0-9]+)"\s*,([^;]*?)\);/gi)];
check(calls.length >= 5, `found ${calls.length} flush decal calls in the backyard`);
for (const c of calls) {
  const args = c[2].split(",").map((a) => a.trim());
  const [W, D, X, Z] = args.slice(0, 4).map(evalArg);
  const zArg = args.find((a) => /^-?[\d.]+$/.test(a) && args.indexOf(a) >= 6);
  const vals = { label: c[1], w: W, d: D, x: X, z: Z, zPri: zArg === undefined ? defaultZPri : +zArg };
  for (const k of ["w", "d", "x", "z"]) {
    assert.ok(vals[k] !== null && Number.isFinite(vals[k]),
      `could not resolve "${k}" for backyard decal "${c[1]}" — add the symbol to SYMS rather than letting it go unchecked`);
    n++;
  }
  decals.push(vals);
}
assertNoTies(decals, "backyard");

// ---- 3. the trick itself is still intact ------------------------------------
// If someone "fixes" a z-fight by raising a plane instead, props start getting
// sliced off at the ankles — the bug this whole approach exists to avoid.
const cemBuilder = src.slice(src.indexOf("function buildCemetery"));
const yPositions = [...cemBuilder.matchAll(/m\.position\.set\(f\.x,\s*([\d.]+),\s*f\.z\)/g)].map((m) => +m[1]);
check(yPositions.length >= 1, "the cemetery floor loop sets an explicit height");
for (const y of yPositions) {
  check(y < 0.02, `flush paving stays at ground level (found y=${y}) rather than being raised`);
}
check(/zOffset/.test(src) || /zPri/.test(cemBuilder), "the depth-bias approach is still in use");

console.log(`ground-overlap: ${n} assertions passed (${CEMETERY_FLOORS.length} cemetery surfaces, ${decals.length} backyard decals)`);

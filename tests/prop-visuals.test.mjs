// createPropVisual() is one big switch on modelKey, and the crate family
// deliberately falls through to `default:` for its plain-box geometry.
//
// Adding the cemetery models directly above `default:` silently hijacked that
// fall-through: pallet_stack, toolbox, crate_small and crate_large all started
// rendering as HEADSTONES, on every map, including Depot 7 and Sunnyside Yard.
// Nothing failed — it typechecked, it ran, and a crate in a warehouse just
// quietly became a grave marker.
//
// These assertions make that class of mistake fail the build instead.
import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MAPS, PROP_MODELS } from "../packages/shared/dist/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "packages/client/src/game/mapBuilder.ts"), "utf8");

let n = 0;
const check = (cond, msg) => { assert.ok(cond, msg); n++; };

// Isolate the switch inside createPropVisual.
const fnStart = src.indexOf("export function createPropVisual");
check(fnStart > 0, "createPropVisual exists");
const fnEnd = src.indexOf("\n}", src.indexOf("  return root;", fnStart));
const fn = src.slice(fnStart, fnEnd);

// Walk the case labels in source order, recording which ones have no body of
// their own (i.e. fall through to whatever comes next).
const labels = [];
for (const m of fn.matchAll(/^ {4}(?:case "([a-z_]+)":|default:)(.*)$/gm)) {
  labels.push({ key: m[1] ?? "default", opensBlock: m[2].trim().startsWith("{") });
}
check(labels.length > 10, `the switch has ${labels.length} labels`);
check(labels[labels.length - 1].key === "default", "`default:` is the last label — a case after it would be unreachable-looking and easy to misread");

// ---- 1. every fall-through lands where it is supposed to --------------------
// A label with no block of its own inherits the next label's body. Two groups
// do that deliberately; anything else is an accident. Declaring them here means
// inserting a case into the middle of one fails loudly instead of silently
// changing what a prop looks like.
const INTENDED_FALLTHROUGH = {
  // round things -> the cylinder body under `tire`
  tire: ["barrel", "bucket", "bin"],
  // box things -> the plain box under `default`
  default: ["pallet_stack", "toolbox", "crate_small", "crate_large"],
};
const actual = {};
for (const [i, l] of labels.entries()) {
  if (l.opensBlock) continue;
  const target = labels.slice(i + 1).find((x) => x.opensBlock);
  check(!!target, `"${l.key}" falls through to a label that has a body`);
  (actual[target.key] ??= []).push(l.key);
}
check(
  Object.keys(actual).sort().join(",") === Object.keys(INTENDED_FALLTHROUGH).sort().join(","),
  `fall-through groups end at [${Object.keys(actual).sort()}], expected [${Object.keys(INTENDED_FALLTHROUGH).sort()}] — ` +
    `a new group means something was inserted mid-group and is now drawing the wrong shape`,
);
for (const [target, members] of Object.entries(INTENDED_FALLTHROUGH)) {
  check(
    (actual[target] ?? []).join(",") === members.join(","),
    `the group falling through to "${target}" is [${actual[target] ?? []}], expected [${members}]`,
  );
}

// ---- 2. no duplicate case labels -------------------------------------------
// A second `case "barrel"` is dead code, and TypeScript will not tell you.
const seen = new Set();
for (const l of labels) {
  check(!seen.has(l.key), `"${l.key}" appears only once in the switch`);
  seen.add(l.key);
}

// ---- 3. every model a map actually places is drawable -----------------------
// Either it has its own case, or it falls into the default box on purpose.
const used = new Set(Object.values(MAPS).flatMap((m) => m.props.map((p) => p.modelKey)));
check(used.size > 20, `maps place ${used.size} distinct models between them`);
for (const key of used) {
  check(key in PROP_MODELS, `"${key}" is placed on a map and defined in PROP_MODELS`);
}

// The models that carry a room's identity must have real geometry — falling
// back to a grey box would make a headstone indistinguishable from a crate,
// which is the whole disguise mechanic gone.
// `barrel` counts as distinct even though it falls through: its target is the
// cylinder body, not the default box.
const MUST_BE_DISTINCT = ["headstone", "grave_cross", "urn", "angel_statue", "coffin", "bench", "lantern", "barrel"];
const fallsToDefault = new Set(INTENDED_FALLTHROUGH.default);
for (const key of MUST_BE_DISTINCT) {
  const l = labels.find((x) => x.key === key);
  check(!!l, `"${key}" has a case in the switch`);
  check(!fallsToDefault.has(key), `"${key}" draws real geometry rather than the plain fallback box`);
}

// ---- 4. the guard comment is still there ------------------------------------
// It is the thing that tells the next person not to repeat this.
check(
  /Add new cases ABOVE this comment, never between here and `default:`/.test(fn),
  "the fall-through hazard is documented at the point where it bites",
);

console.log(`prop-visuals: ${n} assertions passed (${labels.length} switch labels, ${used.size} models placed across ${Object.keys(MAPS).length} maps)`);

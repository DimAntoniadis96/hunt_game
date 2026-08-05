// Jumpscares are the one feature here that is allowed to be unfair-feeling and
// must not actually BE unfair. These assertions encode that line.
//
// A scare may frighten you. It may never take a round off you: no blinding, no
// slowing, no fake cues that send a hunter walking 30m the wrong way, nothing
// spawned that can block a shot or be mistaken for a hider. If any of that ever
// creeps in, it fails here rather than in someone's match.
import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAPS,
  SCARES,
  SCARE_KINDS,
  SCARE_MAX_GAP_MS,
  SCARE_MIN_GAP_MS,
  SCARE_VISUAL_MS,
  SCARE_WARMUP_MS,
  ServerMessage,
  nextScareDelay,
  pickScare,
  scareVolume,
} from "../packages/shared/dist/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const server = read("packages/server/src/rooms/GameRoom.ts");
const scene = read("packages/client/src/game/GameScene.ts");
const audio = read("packages/client/src/audio/AudioManager.ts");

let n = 0;
const check = (cond, msg) => { assert.ok(cond, msg); n++; };

// ---- 1. the spec is coherent -------------------------------------------------
check(SCARE_KINDS.length >= 4, `there are ${SCARE_KINDS.length} kinds of scare`);
for (const kind of SCARE_KINDS) {
  const spec = SCARES[kind];
  check(spec.weight > 0, `"${kind}" can actually be picked`);
  check(spec.range > 0, `"${kind}" has a range`);
  check(spec.floor >= 0 && spec.floor < 1, `"${kind}" has a sane volume floor`);
  check(spec.visual in SCARE_VISUAL_MS, `"${kind}" has a known visual`);
  // Nothing may linger. A scare that outstays ~2s stops being a scare and
  // starts being scenery a hider can use.
  check(SCARE_VISUAL_MS[spec.visual] <= 2000, `"${kind}"'s visual is brief (${SCARE_VISUAL_MS[spec.visual]}ms)`);
  // Distance has to mean something, except for the deliberately map-wide ones.
  if (!spec.global) {
    check(scareVolume(kind, 1) > scareVolume(kind, spec.range * 0.6),
      `"${kind}" gets quieter with distance`);
  } else {
    check(scareVolume(kind, 999) === 1, `"${kind}" is global and plays at full volume everywhere`);
  }
}

// ---- 2. a scare can never be mistaken for a real cue --------------------------
// This is the important one. The hunt is driven by whistles, gunshots and
// footsteps; if a scare shares a voice with any of them it is not atmosphere,
// it is misinformation.
const REAL_CUES = ["whistle", "shoot", "step", "reload", "flash", "hit", "transform",
  "damage1", "damage2", "death1", "death2", "axe1", "axe2", "axe_miss"];
const scareSfx = [...scene.matchAll(/^\s*(\w+): "(scare_\w+)",$/gm)].map((m) => ({ kind: m[1], sfx: m[2] }));
check(scareSfx.length === SCARE_KINDS.length,
  `the client maps all ${SCARE_KINDS.length} scares to a voice (found ${scareSfx.length})`);
for (const { kind, sfx } of scareSfx) {
  check(SCARE_KINDS.includes(kind), `"${kind}" is a real scare kind`);
  check(!REAL_CUES.includes(sfx), `"${kind}" does not reuse the "${sfx}" cue`);
  check(sfx.startsWith("scare_"), `"${kind}" uses a dedicated scare voice`);
  // Each voice must be synthesised, not sampled — a dropped-in sample could be
  // anything, including a recording of a whistle.
  check(new RegExp(`case "${sfx}":`).test(audio), `"${sfx}" has its own synthesis case`);
}

// ---- 3. pacing ---------------------------------------------------------------
check(SCARE_MIN_GAP_MS >= 5000, "scares cannot stack on top of each other");
check(SCARE_MAX_GAP_MS > SCARE_MIN_GAP_MS * 1.5,
  "the gap varies enough that players cannot learn the rhythm — a scare you can time is not a scare");
check(SCARE_WARMUP_MS > 0, "the hunt gets a quiet moment before the first scare");
for (const roll of [0, 0.25, 0.5, 0.75, 1]) {
  const d = nextScareDelay(roll);
  check(d >= SCARE_MIN_GAP_MS && d <= SCARE_MAX_GAP_MS, `delay for roll ${roll} is inside the window (${d}ms)`);
}
// Out-of-range rolls must clamp rather than produce a negative delay.
for (const roll of [-5, 1.5, NaN]) {
  const d = nextScareDelay(roll);
  check(Number.isFinite(d) && d >= SCARE_MIN_GAP_MS, `a roll of ${roll} still yields a sane delay`);
}

// Weighted picking must cover every kind and never fall off the end.
const seen = new Set();
for (let i = 0; i < 2000; i++) seen.add(pickScare(i / 2000));
check(seen.size === SCARE_KINDS.length, `every scare kind is reachable (${seen.size}/${SCARE_KINDS.length})`);
for (const roll of [0, 0.999999, 1, -1, 2]) {
  check(SCARE_KINDS.includes(pickScare(roll)), `pickScare(${roll}) returns a real kind`);
}

// ---- 4. scares come from landmarks, and only on maps that opted in -----------
const withScares = Object.values(MAPS).filter((m) => (m.scarePoints ?? []).length > 0);
check(withScares.length >= 1, "at least one map has scares");
for (const map of Object.values(MAPS)) {
  const pts = map.scarePoints ?? [];
  if (pts.length === 0) continue;
  check(pts.length >= 5, `${map.id} has enough anchors (${pts.length}) that they do not repeat obviously`);
  for (const p of pts) {
    const b = map.bounds;
    check(p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ,
      `${map.id}: scare anchor (${p.x},${p.z}) is inside the map`);
    check(p.y >= 0.5 && p.y <= 8, `${map.id}: scare anchor (${p.x},${p.z}) is at a plausible height`);
  }
}
// Opt-in, not opt-out: a map that never asked for scares must not get them.
check((MAPS.depot7.scarePoints ?? []).length === 0, "Depot 7 has no scares — it is not a horror map");

// ---- 5. the server treats them as scenery ------------------------------------
check(/Scare: "scare"/.test(read("packages/shared/src/types.ts")), "there is a Scare message");
check(ServerMessage.Scare === "scare", "the message name is stable");
check(/this\.broadcast\(ServerMessage\.Scare/.test(server), "scares are broadcast to everyone");
check(/map\.scarePoints \?\? \[\]/.test(server), "the server reads anchors from the map, not from a hardcoded list");
check(/if \(points\.length === 0\) \{\s*this\.nextScareAt = 0;/.test(server),
  "a map with no anchors disables the whole system rather than firing at the origin");
check(/this\.scheduleScare\(SCARE_WARMUP_MS\)/.test(server), "the first scare waits out the warm-up");

// The scare tick must not touch player state. Anything that reads or writes a
// player here would be a gameplay effect wearing a costume.
const tick = server.slice(server.indexOf("private tickScares("), server.indexOf("private tickWhistles("));
check(tick.length > 50, "the scare tick was located");
for (const pat of [
  /\.health/, /\.alive/, /\.ammo/, /\.score/, /\.x =/, /\.y =/, /\.z =/,
  /players\.(get|forEach|set|delete)/, /eliminate/i, /damage/i, /flash/i,
]) {
  check(!pat.test(tick), `the scare tick does not touch ${pat} — a scare is scenery, not a mechanic`);
}

// ---- 6. the client's visuals cannot become cover ------------------------------
const fx = scene.slice(scene.indexOf("private spawnScareVisual("), scene.indexOf("private spawnMuzzleFlash("));
check(fx.length > 200, "the scare visual builder was located");
check(/isPickable = false/.test(fx), "scare visuals cannot be shot");
check(/checkCollisions = false/.test(fx), "scare visuals cannot block a player");
check(!/addGlow/.test(fx), "scare visuals are not registered with the glow layer");
check(/dispose\(\)/.test(fx), "scare visuals dispose their meshes");
check(/mat\.dispose\(\)/.test(fx), "scare visuals dispose their material too, not just the meshes");
check(/renderQuality === "low"/.test(fx), "the swarm is cheaper on low quality");
// And they must be torn down with the scene, or they outlive the WebGL context.
check(/for \(const fx of this\.scareFx\) fx\.kill\(\);/.test(scene),
  "live scare visuals are killed when the scene is disposed");

console.log(`scares: ${n} assertions passed (${SCARE_KINDS.length} kinds, ${withScares.length} map(s) opted in, gap ${SCARE_MIN_GAP_MS / 1000}-${SCARE_MAX_GAP_MS / 1000}s)`);

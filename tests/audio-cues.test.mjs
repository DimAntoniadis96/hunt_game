// World sound: the map is a shared acoustic space.
//
// Every noise that happens at a place is broadcast to EVERY client and mixed by
// that listener's own distance. Before this, most sounds only ever reached the
// player who caused them: a gunshot was audible only to the shooter, a reload
// only to the reloader, a flashbang only to whoever it blinded, and a wounded
// prop's cry only to the prop itself.
//
// These assertions guard the rule and the reach.
import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MAPS, WHISTLE_AUDIBLE_RANGE, WHISTLE_MIN_VOLUME, WORLD_SOUNDS, worldSoundVolume } from "../packages/shared/dist/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const scene = read("packages/client/src/game/GameScene.ts");
const server = read("packages/server/src/rooms/GameRoom.ts");
const audioMgr = read("packages/client/src/audio/AudioManager.ts");

let n = 0;
const check = (cond, msg) => { assert.ok(cond, msg); n++; };

// AudioManager drops anything quieter than this, so a "floor" below it is a lie.
const CUTOFF = parseFloat(audioMgr.match(/if \(vol < ([\d.]+)\) return;/)[1]);

// Longest possible listener-to-source distance in the game.
const worstCase = Math.max(
  ...Object.values(MAPS).map((m) => Math.hypot(m.bounds.maxX - m.bounds.minX, m.bounds.maxZ - m.bounds.minZ)),
);
check(worstCase > 50, `sanity: largest map diagonal is ${worstCase.toFixed(0)}m`);

// ---- 1. loud events reach the whole map ------------------------------------
// If any of these can go silent, a player can be shot at, flashed, or hear
// someone die nearby and get no audio at all.
for (const kind of ["shoot", "flash", "death"]) {
  const far = worldSoundVolume(kind, worstCase);
  assert.ok(
    far > CUTOFF,
    `"${kind}" plays at ${far.toFixed(3)} from ${worstCase.toFixed(0)}m — at or under the ${CUTOFF} cutoff, so it would be silent across the map`,
  );
  n++;
  check(WORLD_SOUNDS[kind].floor > CUTOFF, `"${kind}" has a floor above the cutoff so it can never be dropped`);
}

// ---- 2. distance still means something -------------------------------------
// A world where everything is equally loud everywhere is as useless as silence.
for (const [kind, spec] of Object.entries(WORLD_SOUNDS)) {
  const near = worldSoundVolume(kind, 2);
  const mid = worldSoundVolume(kind, spec.range / 2);
  check(near > mid, `"${kind}" must get quieter with distance (2m ${near.toFixed(2)} vs ${(spec.range / 2).toFixed(0)}m ${mid.toFixed(2)})`);
  check(near >= 0.8, `"${kind}" should be near full volume up close`);
  check(spec.range > 0 && spec.floor >= 0 && spec.floor < 1, `"${kind}" has a sane range/floor`);
}

// Quiet mechanical noises must NOT be audible map-wide, or the mix turns to mush.
for (const kind of ["reload", "melee_swing"]) {
  check(worldSoundVolume(kind, worstCase) <= CUTOFF, `"${kind}" should fade to nothing across the map`);
}

// ---- 3. the server actually emits them -------------------------------------
check(/private emitWorldSound\(/.test(server), "the server has a world-sound emitter");
check(/this\.broadcast\(ServerMessage\.WorldSound/.test(server), "world sounds are BROADCAST, not sent to one client");
for (const kind of ["shoot", "reload", "flash", "transform", "melee_swing"]) {
  check(new RegExp(`emitWorldSound\\("${kind}"`).test(server), `the server emits "${kind}"`);
}
check(/emitWorldSound\(\s*melee \? "melee_hit" : "hit"/.test(server), "the server emits the bullet/axe impact");
check(/emitWorldSound\(killed \? "death" : "hurt"/.test(server), "the server emits the victim's cry, fatal or not");

// The gunshot in particular: it must be emitted in the shot handler, right where
// the round is actually spent.
const shotBlock = server.slice(server.indexOf("m.lastShotAt = now;"), server.indexOf("m.lastShotAt = now;") + 400);
check(/emitWorldSound\("shoot"/.test(shotBlock), "the gunshot is emitted when the shot is fired");

// ---- 4. the client plays every kind, positioned -----------------------------
check(/room\.onMessage\(ServerMessage\.WorldSound/.test(scene), "the client handles world sounds");
check(/worldSoundVolume\(kind, dist\)/.test(scene), "the client mixes by the shared distance curve");
check(/playSpatial\(/.test(scene), "world sounds are played positioned, not flat");
check(/if \(m\.id && m\.id === this\.net\.sessionId\) return;/.test(scene),
  "a player skips the broadcast copy of a sound they already played locally");
for (const kind of Object.keys(WORLD_SOUNDS)) {
  check(new RegExp(`^\\s*${kind}: `, "m").test(scene), `the client maps "${kind}" to a sample`);
}

// ---- 5. interface audio stays out of the world -----------------------------
// Menu blips and phase stings are not things that happen in the map.
for (const uiKind of ["ui", "countdown", "round_start", "round_end"]) {
  check(!(uiKind in WORLD_SOUNDS), `"${uiKind}" is interface audio and must not be a world sound`);
}

// ---- 6. whistles still reach across every map ------------------------------
check(WHISTLE_MIN_VOLUME > CUTOFF, "the whistle floor clears the audible cutoff");
{
  const t = Math.min(1, worstCase / WHISTLE_AUDIBLE_RANGE);
  const far = Math.max(WHISTLE_MIN_VOLUME, (1 - t) * (1 - t));
  check(far > CUTOFF, `a whistle from ${worstCase.toFixed(0)}m plays at ${far.toFixed(3)}, above the cutoff`);
}

console.log(`world-sound: ${n} assertions passed (${Object.keys(WORLD_SOUNDS).length} sound kinds, worst-case distance ${worstCase.toFixed(0)}m)`);

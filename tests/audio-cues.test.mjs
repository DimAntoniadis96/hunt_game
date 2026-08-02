// The two audio cues the game's whole hunt loop depends on:
//   1. a hider's locator whistle must be audible to a seeker ANYWHERE on the map
//   2. a seeker who connects a shot must hear the victim cry out
//
// Both were broken. The whistle faded to silence past ~39.5m on a map with a
// 118m diagonal, and ServerMessage.Hit — which triggers the pain sound — is sent
// only to the victim, so the shooter heard an abstract hitmarker and nothing
// else. These assertions are the guard rails.
import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAPS,
  VICTIM_CRY_MIN_VOLUME,
  VICTIM_CRY_RANGE,
  KILL_CRY_MIN_VOLUME,
  WHISTLE_AUDIBLE_RANGE,
  WHISTLE_MIN_VOLUME,
} from "../packages/shared/dist/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scene = fs.readFileSync(path.join(root, "packages/client/src/game/GameScene.ts"), "utf8");
const audioMgr = fs.readFileSync(path.join(root, "packages/client/src/audio/AudioManager.ts"), "utf8");

let n = 0;
const check = (cond, msg) => { assert.ok(cond, msg); n++; };

// AudioManager silently drops anything quieter than this, so every floor below
// has to clear it or the sound is simply never played.
const cutoffMatch = audioMgr.match(/if \(vol < ([\d.]+)\) return;/);
check(!!cutoffMatch, "AudioManager has an audible-volume cutoff we can read");
const CUTOFF = parseFloat(cutoffMatch[1]);

/** The client's attenuation curve, mirrored from GameScene.spatialParams(). */
const volumeAt = (dist, maxDist) => {
  const t = Math.min(1, dist / maxDist);
  return (1 - t) * (1 - t);
};

// ---- 1. whistles reach across every map -----------------------------------
check(WHISTLE_MIN_VOLUME > CUTOFF,
  `WHISTLE_MIN_VOLUME ${WHISTLE_MIN_VOLUME} must exceed the ${CUTOFF} cutoff, or distant whistles are dropped entirely`);

for (const map of Object.values(MAPS)) {
  const b = map.bounds;
  const diagonal = Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ);
  // Worst case: seeker and hider in opposite corners.
  const worst = Math.max(WHISTLE_MIN_VOLUME, volumeAt(diagonal, WHISTLE_AUDIBLE_RANGE));
  assert.ok(
    worst > CUTOFF,
    `${map.id}: a whistle from ${diagonal.toFixed(0)}m away plays at ${worst.toFixed(3)}, at or below the ${CUTOFF} cutoff — ` +
      `a seeker on the far side of the map would hear nothing`,
  );
  n++;
  // ...and distance must still be meaningful: close should be clearly louder than far.
  const near = Math.max(WHISTLE_MIN_VOLUME, volumeAt(5, WHISTLE_AUDIBLE_RANGE));
  assert.ok(near > worst * 3, `${map.id}: whistle volume should fall off usefully with distance (near ${near.toFixed(2)} vs far ${worst.toFixed(2)})`);
  n++;
}

check(/spatialParams\(m\.x, m\.y \?\? 0, m\.z, WHISTLE_AUDIBLE_RANGE\)/.test(scene),
  "the whistle handler uses WHISTLE_AUDIBLE_RANGE rather than a hardcoded number");
check(/playWhistle\(m\.sound \?\? 1, Math\.max\(WHISTLE_MIN_VOLUME, vol\), pan\)/.test(scene),
  "the whistle is floored so it is never inaudible");

// ---- 2. the shooter hears the victim ---------------------------------------
check(VICTIM_CRY_MIN_VOLUME > CUTOFF, "the hurt-cry floor clears the audible cutoff");
check(KILL_CRY_MIN_VOLUME > CUTOFF, "the kill-cry floor clears the audible cutoff");
check(KILL_CRY_MIN_VOLUME >= VICTIM_CRY_MIN_VOLUME, "a kill should be at least as loud as a wound");
check(VICTIM_CRY_RANGE > 0, "VICTIM_CRY_RANGE is set");

// A non-fatal hit must play a pain sound for the shooter. This is the exact gap
// that existed: there was no `else` branch at all, so wounding a prop was silent.
// Bound the slice on the actual handler REGISTRATIONS, not on bare message
// names — those also appear in comments and would truncate the block.
const hitBlock = scene.slice(
  scene.indexOf("room.onMessage(ServerMessage.ShotResult"),
  scene.indexOf("room.onMessage(ServerMessage.Hit"),
);
check(hitBlock.length > 200, "located the ShotResult handler body");
check(/damage1.*damage2|damage2.*damage1/s.test(hitBlock),
  "the ShotResult handler plays a hurt cry (damage1/damage2) for the shooter");
check(/death1.*death2|death2.*death1/s.test(hitBlock),
  "the ShotResult handler plays a death cry for the shooter");
check(/playSpatial\(/.test(hitBlock),
  "the victim's cry is positioned, so the shooter can hear WHERE they connected");
check(/VICTIM_CRY_MIN_VOLUME/.test(hitBlock) && /KILL_CRY_MIN_VOLUME/.test(hitBlock),
  "both cries use their floors, so a long-range hit still reads as a hit");

// The impact point the cry is positioned at must actually be sent by the server.
const server = fs.readFileSync(path.join(root, "packages/server/src/rooms/GameRoom.ts"), "utf8");
check(/ShotResult, \{ hit: true[^}]*hx, hy, hz \}/.test(server),
  "the server sends the impact point (hx, hy, hz) on a hit, which the cry is positioned at");

console.log(`audio-cues: ${n} assertions passed (whistle range ${WHISTLE_AUDIBLE_RANGE}m, floor ${WHISTLE_MIN_VOLUME}, cutoff ${CUTOFF})`);

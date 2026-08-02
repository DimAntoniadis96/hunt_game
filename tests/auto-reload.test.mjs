// Auto-reload: firing the last round in the magazine starts a reload without
// the player pressing R. Manual R still works for a partial mag.
//
// The rule lives in GameRoom.beginReload(), shared by the R handler and the
// empty-mag trigger. This test models that rule and asserts the behaviour;
// it also reads GameRoom.ts to confirm the wiring is actually present, so the
// test fails if someone removes the auto-trigger later.
import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WEAPON_MAG_SIZE, WEAPON_RELOAD_MS } from "../packages/shared/dist/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "packages/server/src/rooms/GameRoom.ts"), "utf8");

let n = 0;
const check = (cond, msg) => { assert.ok(cond, msg); n++; };

// ---- wiring is present -----------------------------------------------------
check(/private beginReload\(/.test(src), "beginReload() helper exists");
check(/if \(player\.ammo === 0\) this\.beginReload\(player, m\);/.test(src),
  "the shot handler starts a reload when the magazine hits 0");
check((src.match(/this\.beginReload\(/g) || []).length === 2,
  "both the manual R handler and the auto trigger go through beginReload");
// The guard must live in ONE place, or manual and auto reload can diverge.
check((src.match(/player\.ammo >= WEAPON_MAG_SIZE \|\| player\.reserve <= 0/g) || []).length === 1,
  "the reload precondition is defined exactly once");

// ---- the rule itself -------------------------------------------------------
const TEAM_HUNTERS = "hunters";
function beginReload(p) {
  if (p.team !== TEAM_HUNTERS || !p.alive) return false;
  if (p.reloading || p.ammo >= WEAPON_MAG_SIZE || p.reserve <= 0) return false;
  p.reloading = true;
  p.reloadDoneAt = 1000 + WEAPON_RELOAD_MS;
  return true;
}
function shoot(p) {
  if (p.reloading || p.ammo <= 0) return false;   // can't fire mid-reload or dry
  p.ammo = Math.max(0, p.ammo - 1);
  if (p.ammo === 0) beginReload(p);               // <- the new behaviour
  return true;
}
const hunter = (over = {}) => ({ team: TEAM_HUNTERS, alive: true, ammo: WEAPON_MAG_SIZE, reserve: 120, reloading: false, reloadDoneAt: 0, ...over });

// Emptying the magazine reloads on its own.
{
  const p = hunter();
  for (let i = 0; i < WEAPON_MAG_SIZE; i++) shoot(p);
  check(p.ammo === 0, "magazine is empty after firing every round");
  check(p.reloading === true, "reload started automatically — no R press needed");
  check(p.reloadDoneAt === 1000 + WEAPON_RELOAD_MS, "reload finishes after the normal reload time");
}

// It does NOT fire early — only on the last round.
{
  const p = hunter();
  for (let i = 0; i < WEAPON_MAG_SIZE - 1; i++) shoot(p);
  check(p.ammo === 1, "one round left");
  check(p.reloading === false, "no auto-reload while rounds remain");
}

// With no spare ammo the hunter falls through to the axe rather than
// locking into a reload that can never complete.
{
  const p = hunter({ reserve: 0 });
  for (let i = 0; i < WEAPON_MAG_SIZE; i++) shoot(p);
  check(p.ammo === 0 && p.reloading === false, "empty reserve: no auto-reload, axe fallback stays available");
}

// A dead hunter never auto-reloads.
{
  const p = hunter({ ammo: 1 });
  p.alive = false;
  shoot(p);
  check(p.reloading === false, "dead players do not auto-reload");
}

// Manual reload still works with a partial magazine.
{
  const p = hunter({ ammo: 3 });
  check(beginReload(p) === true, "R reloads a partial magazine");
  check(beginReload(p) === false, "reloading again mid-reload is rejected");
}

// A full magazine cannot be reloaded (guards against wasting reserve).
{
  const p = hunter();
  check(beginReload(p) === false, "a full magazine cannot be reloaded");
}

// You cannot shoot during the auto-reload — the mag refills only on completion.
{
  const p = hunter({ ammo: 1 });
  shoot(p);
  check(p.reloading === true, "auto-reload running");
  check(shoot(p) === false, "cannot fire while reloading");
  check(p.ammo === 0, "ammo stays empty until the reload completes");
}

console.log(`auto-reload: ${n} assertions passed`);

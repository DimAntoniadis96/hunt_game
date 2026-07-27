// Static wiring checks for the messaging + rebuild-countdown changes, so a
// refactor can't silently drop them. No live server needed — it reads source.
//  • kills → small feed "X killed Y" (death sting); leaves → "X left" (no sting)
//  • a team emptying → a "teams rebuilding" countdown, then reshuffle
//  • the killfeed still works if the server hasn't restarted (payload fallback)
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

let pass = 0, fail = 0;
const check = (cond, label) => { if (cond) pass++; else { fail++; console.log(`  FAIL — ${label}`); } };
const has = (src, re, label) => check(re.test(src), label);

const gameRoom = read("packages/server/src/rooms/GameRoom.ts");
const gameScene = read("packages/client/src/game/GameScene.ts");
const hud = read("packages/client/src/ui/HUD.ts");
const constants = read("packages/shared/src/constants.ts");
const schema = read("packages/server/src/schema/GameState.ts");

// ---- Server: kill + leave feed lines --------------------------------------
has(gameRoom, /killed \$\{victim\.name\}/, "server broadcasts 'X killed Y' on a kill");
has(gameRoom, /Killfeed,\s*\{\s*text:\s*`\$\{attacker\.name\} killed \$\{victim\.name\}`,\s*death:\s*true/, "kill feed uses text + death:true");
has(gameRoom, /Killfeed,\s*\{\s*text:\s*`\$\{name\} left`,\s*death:\s*false/, "leave broadcasts 'X left' as a feed line (death:false)");

// ---- Server: rebuild countdown before reshuffle ---------------------------
has(gameRoom, /rosterAction\(/, "handleRosterChange delegates to the pure rosterAction()");
has(gameRoom, /rebuilding\s*=\s*true/, "restartWithNewTeams sets rebuilding = true");
has(gameRoom, /phase\s*=\s*Phase\.Countdown/, "rebuild uses the Countdown phase for its timer");
has(gameRoom, /REBUILD_SECONDS/, "rebuild uses REBUILD_SECONDS for the countdown length");
has(constants, /REBUILD_SECONDS\s*=\s*\d+/, "REBUILD_SECONDS is defined in shared constants");
has(schema, /rebuilding\s*=\s*false/, "GameState schema exposes the synced `rebuilding` flag");

// ---- Client: killfeed handler (small corner, all users, payload fallback) --
has(gameScene, /this\.hud\.killfeed\(/, "client renders feed lines via hud.killfeed()");
has(gameScene, /m\.text\s*\?\?/, "killfeed prefers the new `text` payload");
has(gameScene, /killerName/, "killfeed falls back to killerName/victimName if server not restarted");
has(gameScene, /m\.death\s*\?\?/, "death sting is gated on the kill flag (with fallback)");

// ---- Client: rebuild UX ----------------------------------------------------
has(gameScene, /Phase\.Countdown\s*&&\s*!!state\.rebuilding/, "players are frozen during the rebuild countdown");
has(gameScene, /lastRoundEventPhase/, "round stings only replay on a real phase change (not on notices)");
has(hud, /class="rebuild-screen"/, "HUD has the teams-rebuilding overlay");
has(hud, /data-r="rebuildnum"/, "rebuild overlay has a live countdown number");
has(hud, /phase === Phase\.Countdown\s*&&\s*!!state\.rebuilding/, "HUD shows the rebuild overlay during the rebuild countdown");
has(hud, /"REBUILDING"/, "HUD relabels the phase to REBUILDING during a rebuild");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

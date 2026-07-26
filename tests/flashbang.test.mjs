import { FLASHBANG_RANGE, Team } from "../packages/shared/dist/index.js";
import { canFlashbangBlind, flashbangDistance } from "../packages/server/dist/rooms/flashbang.js";

let pass = 0, fail = 0;
const check = (cond, label) => { if (cond) pass++; else { fail++; console.log(`  FAIL — ${label}`); } };

const prop = (x = 0, y = 0, z = 0) => ({ id: "prop", team: Team.Props, alive: true, x, y, z });
const hunter = (x = 0, y = 0, z = 0) => ({ id: "hunter", team: Team.Hunters, alive: true, x, y, z });

check(flashbangDistance(prop(), hunter(3, 0, 0)) === 3, "distance uses world coordinates");
check(canFlashbangBlind(prop(), hunter(FLASHBANG_RANGE - 0.05, 0, 0), FLASHBANG_RANGE), "hunter just inside range is blinded");
check(!canFlashbangBlind(prop(), hunter(FLASHBANG_RANGE + 0.05, 0, 0), FLASHBANG_RANGE), "hunter just outside range is not blinded");
check(!canFlashbangBlind(prop(), { ...hunter(2, 0, 0), alive: false }, FLASHBANG_RANGE), "dead hunter is ignored");
check(!canFlashbangBlind(prop(), { id: "other-prop", team: Team.Props, alive: true, x: 1, y: 0, z: 0 }, FLASHBANG_RANGE), "other props are not blinded");
check(!canFlashbangBlind({ ...prop(), alive: false }, hunter(1, 0, 0), FLASHBANG_RANGE), "dead hider cannot blind");
check(canFlashbangBlind(prop(0, 1.3, 0), hunter(0, 0, 0), FLASHBANG_RANGE), "close vertical offset is still blinded");
check(!canFlashbangBlind(prop(0, FLASHBANG_RANGE + 0.2, 0), hunter(0, 0, 0), FLASHBANG_RANGE), "large vertical separation is not blinded");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

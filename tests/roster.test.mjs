// Unit test for the "someone left" decision logic (defensive steps): when a
// team empties out we rebuild, when too few players remain we go to lobby, and
// otherwise we keep playing. Pure — no live server needed.
import { rosterAction } from "../packages/server/dist/rooms/roster.js";
import { Phase, Team } from "../packages/shared/dist/index.js";

let pass = 0, fail = 0;
const check = (cond, label) => { if (cond) pass++; else { fail++; console.log(`  FAIL — ${label}`); } };

const MIN = 2;
const team = (t, n) => Array.from({ length: n }, () => ({ team: t }));
const mix = (p, h) => [...team(Team.Props, p), ...team(Team.Hunters, h)];

// Active round, both sides populated → keep playing.
check(rosterAction(Phase.Hunt, mix(1, 1), MIN) === "none", "hunt 1 prop + 1 hunter → none");
check(rosterAction(Phase.Hunt, mix(3, 1), MIN) === "none", "hunt 3 props + 1 hunter → none");
check(rosterAction(Phase.Prep, mix(2, 2), MIN) === "none", "prep 2v2 → none");

// Active round, a whole side gone but 2+ players remain → rebuild teams.
check(rosterAction(Phase.Hunt, mix(2, 0), MIN) === "rebuild", "hunt with 0 hunters (2 props) → rebuild");
check(rosterAction(Phase.Hunt, mix(0, 2), MIN) === "rebuild", "hunt with 0 props (2 hunters) → rebuild");
check(rosterAction(Phase.Prep, mix(0, 3), MIN) === "rebuild", "prep with 0 props (3 hunters) → rebuild");

// Fewer than 2 players → can't field two teams → lobby (never rebuild).
check(rosterAction(Phase.Hunt, mix(1, 0), MIN) === "lobby", "only 1 player left in hunt → lobby");
check(rosterAction(Phase.Prep, mix(0, 1), MIN) === "lobby", "only 1 player left in prep → lobby");
check(rosterAction(Phase.Countdown, mix(1, 0), MIN) === "lobby", "countdown drops below 2 → lobby");

// Transient phases don't intervene when enough players remain.
check(rosterAction(Phase.Countdown, mix(2, 0), MIN) === "none", "countdown w/ enough players → none (let it finish)");
check(rosterAction(Phase.RoundEnd, mix(2, 0), MIN) === "none", "round-end scoreboard → none");
check(rosterAction(Phase.Lobby, mix(0, 0), MIN) === "none", "lobby phase → none");
check(rosterAction(Phase.MatchEnd, mix(1, 0), MIN) === "none", "match-end → none (its own timer resets)");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

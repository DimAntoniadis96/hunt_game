// Verifies the "someone left" defensive flow:
//  • 3 players → a round starts (2 props, 1 hunter). The sole hunter leaves →
//    all remaining players enter a "teams rebuilding" countdown, then a fresh
//    round begins with reshuffled roles (one prop + one hunter).
//  • Then one of the 2 survivors leaves → the match returns to the lobby.
import { Client } from "colyseus.js";
import { ClientMessage, ServerMessage, Team } from "../packages/shared/dist/index.js";

const URL = process.env.SMOKE_WS_URL ?? "ws://localhost:2567";
const HTTP = process.env.SMOKE_HTTP_URL ?? URL.replace(/^ws/, "http").replace(/\/$/, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CompatClient extends Client {
  consumeSeatReservation(response, rootSchema, reuseRoomInstance) {
    if (response && !response.room && response.name && response.roomId) {
      response = { ...response, room: { name: response.name, roomId: response.roomId, processId: response.processId, publicAddress: response.publicAddress } };
    }
    return super.consumeSeatReservation(response, rootSchema, reuseRoomInstance);
  }
}

let pass = 0, fail = 0;
const check = (cond, label) => { if (cond) pass++; else { fail++; console.log(`  FAIL - ${label}`); } };
async function waitFor(label, fn, timeoutMs = 9000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) { if (fn()) return true; await sleep(100); }
  check(false, `timed out waiting for ${label}`);
  return false;
}
const teamOf = (room) => room.state.players.get(room.sessionId)?.team;
const counts = (room) => {
  const ps = [...room.state.players.values()];
  return { total: ps.length, props: ps.filter((p) => p.team === Team.Props).length, hunters: ps.filter((p) => p.team === Team.Hunters).length };
};

const c1 = new CompatClient(URL), c2 = new CompatClient(URL), c3 = new CompatClient(URL);
const room1 = await c1.create("game", { mode: "private", name: "Alice" });
let code = "";
room1.onMessage(ServerMessage.Welcome, (m) => (code = m.roomCode));
await sleep(300);
const lookup = await fetch(`${HTTP}/api/rooms/${code}`).then((r) => r.json());
const room2 = await c2.joinById(lookup.roomId, { name: "Bob" });
const room3 = await c3.joinById(lookup.roomId, { name: "Carol" });
await sleep(300);

room1.send(ClientMessage.SetReady, { ready: true });
room2.send(ClientMessage.SetReady, { ready: true });
room3.send(ClientMessage.SetReady, { ready: true });
await waitFor("first round prep", () => room1.state.phase === "prep");

const c0 = counts(room1);
check(c0.total === 3, `3 players in the round (got ${c0.total})`);
check(c0.props >= 1 && c0.hunters >= 1, `both sides populated at start (props ${c0.props}, hunters ${c0.hunters})`);

// The sole hunter leaves — its whole side empties out.
const rooms = [room1, room2, room3];
const hunterRoom = rooms.find((r) => teamOf(r) === Team.Hunters);
const remaining = rooms.filter((r) => r !== hunterRoom);
const watch = remaining[1]; // a survivor that stays to the end, used to read state
check(!!hunterRoom && !!watch, "found the hunter + an observer");
await hunterRoom.leave(true);

// Remaining players see a "teams rebuilding" countdown (still 2 players).
await waitFor("teams-rebuilding countdown", () => watch.state.phase === "countdown" && watch.state.rebuilding === true && counts(watch).total === 2, 9000);
check(watch.state.rebuilding === true, "teams-rebuilding flag is set for everyone left");

// After the countdown, a fresh round begins with reshuffled roles.
await waitFor("fresh reshuffled round", () => {
  const c = counts(watch);
  return watch.state.phase === "prep" && !watch.state.rebuilding && c.total === 2 && c.props === 1 && c.hunters === 1;
}, 14000);
const cc = counts(watch);
check(cc.props === 1 && cc.hunters === 1, `reshuffled into 1 prop + 1 hunter (props ${cc.props}, hunters ${cc.hunters})`);
check(watch.state.round === 1, `restarted from round 1 (got ${watch.state.round})`);

// Now one of the last two leaves → can't field two teams → back to lobby.
await remaining[0].leave(true);
await waitFor("lone player back to lobby", () => watch.state.phase === "lobby", 9000);
check(watch.state.phase === "lobby", `lone survivor sent back to lobby (phase ${watch.state.phase})`);

for (const r of rooms) { try { await r.leave(true); } catch {} }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

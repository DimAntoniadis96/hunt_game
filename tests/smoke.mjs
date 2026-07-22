// End-to-end smoke test of the authoritative room lifecycle using two headless
// colyseus.js clients (no browser). Run against a server on :2567.
import { Client } from "colyseus.js";

const URL = "ws://localhost:2567";
const HTTP = "http://localhost:2567";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function summarize(state) {
  const players = [];
  state.players.forEach((p, id) => players.push(`${p.name}:${p.team}${p.alive ? "" : "(dead)"}@(${p.x.toFixed(1)},${p.z.toFixed(1)})`));
  return `phase=${state.phase} round=${state.round} players=[${players.join(", ")}]`;
}

const results = [];
const assert = (cond, label) => {
  results.push(`${cond ? "PASS" : "FAIL"} — ${label}`);
  if (!cond) process.exitCode = 1;
};

const c1 = new Client(URL);
const c2 = new Client(URL);

// --- create private room ---
const room1 = await c1.create("game", { mode: "private", name: "Alice" });
let roomCode = "";
room1.onMessage("welcome", (m) => (roomCode = m.roomCode));
await sleep(300);
assert(!!roomCode, `room created, code received: ${roomCode}`);

// --- resolve code -> roomId and join ---
const lookup = await fetch(`${HTTP}/api/rooms/${roomCode}`).then((r) => r.json());
assert(lookup.roomId === room1.roomId, `code lookup resolves to same room (${lookup.roomId})`);
const room2 = await c2.joinById(lookup.roomId, { name: "Bob" });
await sleep(300);
assert(room1.state.players.size === 2, `two players in room (size=${room1.state.players.size})`);

// --- both ready -> countdown -> prep ---
room1.send("set_ready", { ready: true });
room2.send("set_ready", { ready: true });

let sawCountdown = false;
let sawPrep = false;
room1.onStateChange((s) => {
  if (s.phase === "countdown") sawCountdown = true;
  if (s.phase === "prep") sawPrep = true;
});

// countdown is 5s, so wait ~7s to reach prep
for (let i = 0; i < 16; i++) {
  await sleep(500);
  if (sawPrep) break;
}
assert(sawCountdown, "reached COUNTDOWN after both ready");
assert(sawPrep, "reached PREP (round started)");

const teams = [...room1.state.players.values()].map((p) => p.team);
assert(teams.includes("props") && teams.includes("hunters"), `teams assigned: ${teams.join("/")}`);
assert(room1.state.round === 1, `round == 1 (got ${room1.state.round})`);

// --- movement validation: a legal step is accepted ---
const me = [...room2.state.players.values()].find((p) => p.name === "Bob");
const startX = me.x;
// A prop can move in prep; a hunter is frozen. Move whoever Bob is if prop,
// else just confirm hunter is frozen.
room2.send("input", { x: me.x + 0.2, y: 0, z: me.z, ry: 0, rp: 0, moving: true, grounded: true, seq: 1 });
await sleep(400);
const meAfter = [...room2.state.players.values()].find((p) => p.name === "Bob");
if (me.team === "props") {
  assert(Math.abs(meAfter.x - (startX + 0.2)) < 0.05, `prop legal move accepted (${startX}->${meAfter.x})`);
} else {
  assert(Math.abs(meAfter.x - startX) < 0.01, `hunter frozen during prep (stayed at ${meAfter.x})`);
}

// --- anti-teleport: an absurd jump is rejected/clamped ---
const hunter = [...room1.state.players.values()].find((p) => p.team === "props");
const hClient = hunter.name === "Alice" ? room1 : room2;
const hx = hunter.x;
hClient.send("input", { x: hunter.x + 999, y: 0, z: hunter.z + 999, ry: 0, rp: 0, moving: true, grounded: true, seq: 2 });
await sleep(400);
const hunterAfter = [...room1.state.players.values()].find((p) => p.id === hunter.id);
assert(Math.hypot(hunterAfter.x - hx, hunterAfter.z - hunter.z) < 5, `teleport clamped (moved ${Math.hypot(hunterAfter.x - hx, hunterAfter.z - hunter.z).toFixed(2)}m, not 1400m)`);

console.log("\nFinal state:", summarize(room1.state));
console.log("\n--- RESULTS ---");
console.log(results.join("\n"));

await room1.leave();
await room2.leave();
await sleep(300);
process.exit(process.exitCode ?? 0);

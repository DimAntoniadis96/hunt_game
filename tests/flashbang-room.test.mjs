import { Client } from "colyseus.js";
import { ClientMessage, FLASHBANG_BLIND_MS, FLASHBANG_COOLDOWN_MS, FLASHBANG_RANGE, ServerMessage, Team } from "../packages/shared/dist/index.js";

const URL = process.env.SMOKE_WS_URL ?? "ws://localhost:2567";
const HTTP = process.env.SMOKE_HTTP_URL ?? URL.replace(/^ws/, "http").replace(/\/$/, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CompatClient extends Client {
  consumeSeatReservation(response, rootSchema, reuseRoomInstance) {
    if (response && !response.room && response.name && response.roomId) {
      response = {
        ...response,
        room: {
          name: response.name,
          roomId: response.roomId,
          processId: response.processId,
          publicAddress: response.publicAddress,
        },
      };
    }
    return super.consumeSeatReservation(response, rootSchema, reuseRoomInstance);
  }
}

let pass = 0;
let fail = 0;
const check = (cond, label) => {
  if (cond) pass++;
  else {
    fail++;
    console.log(`  FAIL - ${label}`);
  }
};

async function waitFor(label, fn, timeoutMs = 9000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return true;
    await sleep(100);
  }
  check(false, `timed out waiting for ${label}`);
  return false;
}

function playerById(room, id) {
  return [...room.state.players.values()].find((p) => p.id === id);
}

async function movePlayer(room, playerId, tx, tz, seqStart = 1) {
  let seq = seqStart;
  for (let i = 0; i < 360; i++) {
    const p = playerById(room, playerId);
    const dx = tx - p.x;
    const dz = tz - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.2) return seq;
    const step = Math.min(0.24, dist);
    room.send(ClientMessage.Input, {
      x: p.x + (dx / dist) * step,
      y: p.y,
      z: p.z + (dz / dist) * step,
      ry: 0,
      rp: 0,
      moving: true,
      grounded: true,
      seq: seq++,
    });
    await sleep(45);
  }
  return seq;
}

const c1 = new CompatClient(URL);
const c2 = new CompatClient(URL);
const room1 = await c1.create("game", { mode: "private", name: "Alice" });
let roomCode = "";
room1.onMessage(ServerMessage.Welcome, (m) => (roomCode = m.roomCode));
await sleep(250);
const lookup = await fetch(`${HTTP}/api/rooms/${roomCode}`).then((r) => r.json());
const room2 = await c2.joinById(lookup.roomId, { name: "Bob" });
await sleep(250);

room1.send(ClientMessage.SetReady, { ready: true });
room2.send(ClientMessage.SetReady, { ready: true });
await waitFor("prep", () => room1.state.phase === "prep", 8000);

const prop = [...room1.state.players.values()].find((p) => p.team === Team.Props);
const hunter = [...room1.state.players.values()].find((p) => p.team === Team.Hunters);
const propRoom = prop.name === "Alice" ? room1 : room2;
const hunterRoom = hunter.name === "Alice" ? room1 : room2;

propRoom.send(ClientMessage.Transform, { propId: "b82" });
await waitFor("prop disguise", () => playerById(room1, prop.id)?.propModel === "lantern", 3000);
check(playerById(room1, prop.id)?.propModel === "lantern", "prop is disguised before flashing");

await movePlayer(propRoom, prop.id, hunter.x + Math.min(FLASHBANG_RANGE - 0.6, 2.4), hunter.z);
const closeProp = playerById(room1, prop.id);
const closeHunter = playerById(room1, hunter.id);
check(Math.hypot(closeProp.x - closeHunter.x, closeProp.y - closeHunter.y, closeProp.z - closeHunter.z) < FLASHBANG_RANGE, "prop moved within flashbang range");

await waitFor("hunt", () => room1.state.phase === "hunt", 36000);

const hunterEvents = [];
const propEvents = [];
hunterRoom.onMessage(ServerMessage.Flashbang, (m) => hunterEvents.push(m));
propRoom.onMessage(ServerMessage.Flashbang, (m) => propEvents.push(m));
propRoom.send(ClientMessage.Flashbang, {});
await sleep(600);

const blind = hunterEvents.find((m) => m.ok && m.blinded);
const sourceAck = propEvents.find((m) => m.ok && !m.blinded);
check(!!blind, "near hunter receives blinded flashbang event");
check(blind?.durationMs === FLASHBANG_BLIND_MS, `blind duration is ${FLASHBANG_BLIND_MS}ms`);
check(sourceAck?.affectedCount === 1, "prop confirmation reports one blinded hunter");
check(sourceAck?.cooldownMs === FLASHBANG_COOLDOWN_MS, `prop confirmation reports ${FLASHBANG_COOLDOWN_MS}ms cooldown`);

console.log(`\n${pass} passed, ${fail} failed`);

await room1.leave();
await room2.leave();
await sleep(250);
process.exit(fail ? 1 : 0);

// Choosing a map has to survive the trip from the menu to the room, and a
// client must never be able to talk the server onto a map that does not exist.
//
// Two things broke before this existed: the room hardcoded DEFAULT_MAP_ID, so a
// second map was unreachable no matter what the client asked for; and public
// matchmaking filtered only on `mode`, which meant picking Hollow Row could
// still drop you into somebody else's Depot 7 game.
import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_MAP_ID, MAPS, MAP_ORDER, isMapId } from "../packages/shared/dist/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const room = read("packages/server/src/rooms/GameRoom.ts");
const serverIndex = read("packages/server/src/index.ts");
const screens = read("packages/client/src/ui/Screens.ts");
const net = read("packages/client/src/net/NetworkClient.ts");

let n = 0;
const check = (cond, msg) => { assert.ok(cond, msg); n++; };

// ---- 1. the registry and the offer list agree -------------------------------
// A map in MAPS but missing from MAP_ORDER is built, tested and invisible.
for (const id of MAP_ORDER) check(id in MAPS, `MAP_ORDER lists "${id}" and MAPS defines it`);
for (const id of Object.keys(MAPS)) {
  check(MAP_ORDER.includes(id), `"${id}" is in MAPS, so it must appear in MAP_ORDER or no one can pick it`);
}
check(MAP_ORDER.includes(DEFAULT_MAP_ID), "the default map is offered like any other");
check(MAP_ORDER.length >= 2, `there is more than one map to choose between (${MAP_ORDER.length})`);

// Every offered map needs the copy the picker renders.
for (const id of MAP_ORDER) {
  const m = MAPS[id];
  check(!!m.displayName && m.displayName !== m.id, `"${id}" has a human display name`);
  check(typeof m.tagline === "string" && m.tagline.length > 10, `"${id}" has a tagline for the picker`);
  check(m.props.length > 0 && m.hunterSpawns.length > 0 && m.propSpawns.length > 0, `"${id}" is actually playable`);
}

// ---- 2. isMapId is a real gate ----------------------------------------------
// It is the only thing standing between a hand-crafted join payload and a room
// with no geometry, so it has to reject more than just the empty string.
for (const bad of [undefined, null, "", "nope", 7, {}, [], "__proto__", "constructor", "toString", "hasOwnProperty"]) {
  check(!isMapId(bad), `isMapId rejects ${JSON.stringify(bad) ?? String(bad)}`);
}
for (const id of MAP_ORDER) check(isMapId(id), `isMapId accepts "${id}"`);

// ---- 3. the server decides, not the client ----------------------------------
check(/mapId\?: string;/.test(room), "JoinOptions carries the requested mapId");
check(
  /this\.state\.mapId = isMapId\(options\?\.mapId\) \? options\.mapId : DEFAULT_MAP_ID;/.test(room),
  "the room validates the requested map and falls back to the default — never assigns it raw",
);
check(/setMetadata\(\{[^}]*mapId: this\.state\.mapId/.test(room), "the room advertises its map in metadata");

// ---- 4. matchmaking pairs players by map ------------------------------------
const filterBy = serverIndex.match(/gameServer\.define\([^)]*\)\.filterBy\(\[([^\]]*)\]\)/);
check(!!filterBy, "the game room defines a matchmaking filter");
check(/"mapId"/.test(filterBy[1]), "public matchmaking filters on mapId, so a pick cannot be silently ignored");
check(/"mode"/.test(filterBy[1]), "the existing public/private split is still filtered");

// ---- 5. the client sends the pick on both create paths ----------------------
check(/kind: "public"; name: string; mapId: string/.test(net), "public connect carries a mapId");
check(/kind: "create"; name: string; mapId: string/.test(net), "private create carries a mapId");
check(!/kind: "join";[^|]*mapId/.test(net), "joining by code does NOT send a map — that room already has one");
check(/joinOrCreate\("game", \{[^}]*mapId: mode\.mapId/.test(net), "quick play passes the chosen map through");
check(/create\("game", \{[^}]*mapId: mode\.mapId/.test(net), "create-private passes the chosen map through");

// ---- 6. the picker is generated, not hardcoded ------------------------------
// If someone lists three maps by hand in the markup, map four silently
// never appears. This is the assertion that catches that.
check(/MAP_ORDER\.map\(/.test(screens), "the picker is built from MAP_ORDER");
for (const id of MAP_ORDER) {
  check(!new RegExp(`data-map="${id}"`).test(screens), `"${id}" is not hardcoded into the menu markup`);
}
check(/saveMapId|loadMapId/.test(screens), "the chosen map is remembered between visits");
check(/isMapId\(id\)/.test(screens), "the client re-validates a stored/clicked id before using it");

// ---- 7. the lobby tells you where you are -----------------------------------
// Someone who joined by room code never saw the picker.
check(/setLobbyMap\(/.test(screens), "the lobby can display the room's map");
check(/lobby-map-name/.test(screens), "the lobby renders the map name");
check(/setLobbyMap\(state\.mapId\)/.test(read("packages/client/src/main.ts")),
  "the lobby map is driven by server state, not by what this client picked");

console.log(`map-select: ${n} assertions passed (${MAP_ORDER.length} maps offered: ${MAP_ORDER.join(", ")})`);

import { chromium } from "playwright";
import { Client } from "colyseus.js";
import {
  ClientMessage,
  FLASHBANG_BLIND_MS,
  FLASHBANG_RANGE,
  ServerMessage,
  Team,
} from "../packages/shared/dist/index.js";

const APP_URL = process.env.E2E_URL ?? "http://localhost:5173/";
const WS_URL = process.env.SMOKE_WS_URL ?? "ws://localhost:2567";
const HTTP_URL = process.env.SMOKE_HTTP_URL ?? WS_URL.replace(/^ws/, "http").replace(/\/$/, "");
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

const results = [];
const errors = [];
function check(cond, label) {
  results.push(`${cond ? "PASS" : "FAIL"} - ${label}`);
  if (!cond) process.exitCode = 1;
}

async function waitFor(label, fn, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${label}`);
}

function playerByName(room, name) {
  return [...room.state.players.values()].find((p) => p.name === name);
}

async function movePlayer(room, playerId, tx, tz) {
  let seq = 1;
  for (let i = 0; i < 650; i++) {
    const p = [...room.state.players.values()].find((q) => q.id === playerId);
    const dx = tx - p.x;
    const dz = tz - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.3) return true;
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
  return false;
}

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1000, height: 640 } });

let verified = false;

for (let attempt = 1; attempt <= 8 && !verified; attempt++) {
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`[attempt ${attempt}] pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") {
      const text = m.text();
      if (!text.includes("onMessage() not registered") && !text.includes("favicon") && !text.includes("status of 404")) {
        errors.push(`[attempt ${attempt}] console.error: ${text}`);
      }
    }
  });

  const client = new CompatClient(WS_URL);
  let room;
  try {
    await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#name", { timeout: 10000 });
    await page.fill("#name", `BrowserSeeker${attempt}`);
    await page.click('[data-a="create"]');
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-r="code"]');
      return el && el.textContent && el.textContent.trim() !== "—" && el.textContent.trim().length >= 4;
    }, { timeout: 10000 });

    const code = (await page.textContent('[data-r="code"]')).trim();
    const lookup = await fetch(`${HTTP_URL}/api/rooms/${code}`).then((r) => r.json());
    room = await client.joinById(lookup.roomId, { name: `ScriptProp${attempt}` });

    await page.waitForFunction(() => document.querySelector('[data-r="players"]')?.children.length >= 2, {
      timeout: 10000,
    });
    await page.click('[data-a="ready"]');
    room.send(ClientMessage.SetReady, { ready: true });

    await page.waitForFunction(
      () => ["PROP", "HUNTER"].includes(document.querySelector('[data-r="teamlabel"]')?.textContent?.trim()),
      { timeout: 16000 },
    );
    await waitFor("server prep phase", () => room.state.phase === "prep", 16000);

    const browserTeam = (await page.textContent('[data-r="teamlabel"]'))?.trim();
    const scripted = playerByName(room, `ScriptProp${attempt}`);
    if (browserTeam !== "HUNTER" || scripted?.team !== Team.Props) {
      await room.leave();
      await page.close();
      continue;
    }

    const propEvents = [];
    room.onMessage(ServerMessage.Flashbang, (m) => propEvents.push(m));
    room.send(ClientMessage.Transform, { propId: "b82" });
    await waitFor("scripted prop disguise", () => playerByName(room, `ScriptProp${attempt}`)?.propModel === "lantern", 4000);

    const hunter = playerByName(room, `BrowserSeeker${attempt}`);
    const prop = playerByName(room, `ScriptProp${attempt}`);
    await movePlayer(room, prop.id, hunter.x + Math.min(FLASHBANG_RANGE - 0.7, 2.2), hunter.z);

    const closeHunter = playerByName(room, `BrowserSeeker${attempt}`);
    const closeProp = playerByName(room, `ScriptProp${attempt}`);
    const distance = Math.hypot(closeHunter.x - closeProp.x, closeHunter.y - closeProp.y, closeHunter.z - closeProp.z);
    check(distance < FLASHBANG_RANGE, `scripted prop is within flash range (${distance.toFixed(2)}m)`);

    await waitFor("server hunt phase", () => room.state.phase === "hunt", 38000);
    await page.waitForFunction(() => document.querySelector('[data-r="phase"]')?.textContent?.trim() === "HUNT", {
      timeout: 5000,
    });

    await page.evaluate(() => {
      const f = document.querySelector('[data-r="flashblind"]');
      window.__flashTimeline = [];
      const startedAt = performance.now();
      const sample = () => {
        const cs = getComputedStyle(f);
        window.__flashTimeline.push({
          t: Math.round(performance.now() - startedAt),
          className: f.className,
          opacity: cs.opacity,
          visibility: cs.visibility,
          ariaHidden: f.getAttribute("aria-hidden"),
        });
      };
      sample();
      window.__flashInterval = setInterval(sample, 100);
    });

    room.send(ClientMessage.Flashbang, {});
    await page.waitForFunction(() => {
      const f = document.querySelector('[data-r="flashblind"]');
      if (!f || !f.classList.contains("show")) return false;
      const cs = getComputedStyle(f);
      return cs.visibility === "visible" && Number(cs.opacity) >= 0.99;
    }, { timeout: 3000 });

    const immediate = await page.evaluate(() => {
      const f = document.querySelector('[data-r="flashblind"]');
      const cs = getComputedStyle(f);
      const rect = f.getBoundingClientRect();
      return {
        className: f.className,
        opacity: Number(cs.opacity),
        visibility: cs.visibility,
        zIndex: Number(cs.zIndex),
        backgroundColor: cs.backgroundColor,
        coversViewport: Math.round(rect.width) === window.innerWidth && Math.round(rect.height) === window.innerHeight,
        text: f.textContent.trim(),
      };
    });
    await page.screenshot({ path: "/tmp/flashbang-real-seeker.png" });

    await sleep(FLASHBANG_BLIND_MS + 450);
    const timeline = await page.evaluate(() => {
      clearInterval(window.__flashInterval);
      return window.__flashTimeline;
    });
    const latestBeforeEnd = [...timeline]
      .reverse()
      .find((entry) => entry.t <= FLASHBANG_BLIND_MS - 250);
    const latestAfterEnd = [...timeline]
      .reverse()
      .find((entry) => entry.t >= FLASHBANG_BLIND_MS + 250);
    const sourceAck = propEvents.find((m) => m.ok && !m.blinded);

    check(immediate.className.includes("show"), "hunter flash overlay is shown by the real flashbang event");
    check(immediate.opacity >= 0.99 && immediate.visibility === "visible", "hunter flash overlay is fully opaque and visible");
    check(immediate.coversViewport, "hunter flash overlay covers the whole viewport");
    check(immediate.backgroundColor === "rgb(255, 255, 255)", "hunter flash overlay has a solid white base");
    check(latestBeforeEnd?.className.includes("show") && Number(latestBeforeEnd.opacity) >= 0.99, "hunter remains fully blinded through the blind window");
    check(latestAfterEnd && !latestAfterEnd.className.includes("show") && latestAfterEnd.visibility === "hidden", "hunter flash overlay clears after the blind window");
    check(sourceAck?.affectedCount === 1, "prop receives confirmation that one hunter was blinded");

    verified = true;
    await room.leave();
    await page.close();
  } catch (err) {
    try {
      if (room) await room.leave();
    } catch {
      /* ignore */
    }
    try {
      await page.close();
    } catch {
      /* ignore */
    }
    throw err;
  }
}

await browser.close();
check(verified, "found browser hunter / scripted prop split and completed visual flashbang verification");

console.log("\n--- RESULTS ---");
console.log(results.join("\n"));
console.log("\n--- ERRORS CAPTURED (" + errors.length + ") ---");
console.log(errors.slice(0, 20).join("\n") || "(none)");
process.exit(process.exitCode ?? 0);

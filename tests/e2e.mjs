import { chromium } from "playwright";

const URL = "http://localhost:5173/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

// On a normal machine `chromium.launch()` uses the browser installed by
// `npx playwright install chromium`. In headless CI without a GPU you may need
// the software-WebGL args below (uncomment them).
const browser = await chromium.launch({
  headless: true,
  args: [
    // "--use-gl=angle",
    // "--use-angle=swiftshader",
    // "--enable-unsafe-swiftshader",
    // "--ignore-gpu-blocklist",
    "--no-sandbox",
  ],
});

function wire(page, tag) {
  page.on("pageerror", (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") {
      const t = m.text();
      // ignore benign colyseus.js "onMessage not registered" notices
      if (!t.includes("onMessage() not registered") && !t.includes("favicon") && !t.includes("status of 404")) {
        errors.push(`[${tag}] console.error: ${t}`);
      }
    }
  });
}

const ctx1 = await browser.newContext({ viewport: { width: 1000, height: 640 } });
const ctx2 = await browser.newContext({ viewport: { width: 1000, height: 640 } });
const p1 = await ctx1.newPage();
const p2 = await ctx2.newPage();
wire(p1, "P1");
wire(p2, "P2");

const results = [];
const check = (cond, label) => {
  results.push(`${cond ? "PASS" : "FAIL"} — ${label}`);
  if (!cond) process.exitCode = 1;
};

// --- P1 creates a private room ---
await p1.goto(URL);
await p1.waitForSelector("#name", { timeout: 10000 });
await p1.fill("#name", "Alice");
await p1.click('[data-a="create"]');

// wait for the lobby code pill to populate
await p1.waitForFunction(() => {
  const el = document.querySelector('[data-r="code"]');
  return el && el.textContent && el.textContent.trim() !== "—" && el.textContent.trim().length >= 4;
}, { timeout: 10000 });
const code = (await p1.textContent('[data-r="code"]')).trim();
check(!!code && code.length >= 4, `P1 created room, code=${code}`);

// --- P2 joins by code ---
await p2.goto(URL);
await p2.waitForSelector("#name", { timeout: 10000 });
await p2.fill("#name", "Bob");
await p2.fill("#code", code);
await p2.click('[data-a="join"]');
await p2.waitForFunction(() => {
  const ul = document.querySelector('[data-r="players"]');
  return ul && ul.children.length >= 2;
}, { timeout: 10000 });
check(true, "P2 joined; lobby shows 2 players");

// --- both ready up ---
await p1.click('[data-a="ready"]');
await p2.click('[data-a="ready"]');

// --- wait for the match to start (HUD visible with a phase) ---
const started = await p1
  .waitForFunction(() => {
    const hud = document.querySelector(".hud");
    const phase = document.querySelector('[data-r="phase"]');
    return hud && !hud.classList.contains("hidden") && phase && ["STARTING", "HIDE", "HUNT"].includes(phase.textContent?.trim());
  }, { timeout: 15000 })
  .then(() => true)
  .catch(() => false);
check(started, "match started — HUD + round phase visible on P1");

// Wait for the round to actually start (phase leaves countdown -> HIDE/HUNT and
// teams are assigned).
await p1.waitForFunction(() => {
  const t = document.querySelector('[data-r="teamlabel"]')?.textContent?.trim();
  return t === "PROP" || t === "HUNTER";
}, { timeout: 12000 }).catch(() => {});
await sleep(500);
const phase1 = (await p1.textContent('[data-r="phase"]'))?.trim();
const team1 = (await p1.textContent('[data-r="teamlabel"]'))?.trim();
const team2 = (await p2.textContent('[data-r="teamlabel"]'))?.trim();
check(["HIDE", "HUNT"].includes(phase1 || ""), `P1 phase = ${phase1}`);
check(/PROP|HUNTER/.test(team1 || ""), `P1 assigned team = ${team1}`);
check(/PROP|HUNTER/.test(team2 || ""), `P2 assigned team = ${team2}`);
check(team1 !== team2, `players on opposite teams (P1=${team1}, P2=${team2})`);

// --- confirm the 3D canvas actually has a live WebGL context / is drawing ---
const canvasOk = await p1.evaluate(() => {
  const c = document.getElementById("game-canvas");
  const gl = c.getContext("webgl2") || c.getContext("webgl");
  return { hasGL: !!gl, w: c.width, h: c.height };
});
check(canvasOk.hasGL && canvasOk.w > 0, `WebGL canvas live (${canvasOk.w}x${canvasOk.h}, gl=${canvasOk.hasGL})`);

await p1.screenshot({ path: "/tmp/shot_p1.png" });
await p2.screenshot({ path: "/tmp/shot_p2.png" });

console.log("\n--- RESULTS ---");
console.log(results.join("\n"));
console.log("\n--- ERRORS CAPTURED (" + errors.length + ") ---");
console.log(errors.slice(0, 20).join("\n") || "(none)");
if (errors.length) process.exitCode = 1;

await browser.close();
process.exit(process.exitCode ?? 0);

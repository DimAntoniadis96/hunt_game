import {
  DEFAULT_MAP_ID,
  MAPS,
  MAP_ORDER,
  MAX_NAME_LENGTH,
  MIN_NAME_LENGTH,
  MIN_PLAYERS_TO_START,
  Team,
  isMapId,
  nameError,
  nameLength,
  sanitizeName,
  type PlayerView,
} from "@mimic/shared";
import type { ConnectMode } from "../net/NetworkClient";

interface LobbyState {
  players: { forEach: (cb: (p: PlayerView, key: string) => void) => void; size: number };
}

function loadName(): string {
  try {
    return localStorage.getItem("mimic:name") || "";
  } catch {
    return "";
  }
}
function saveName(n: string) {
  try {
    localStorage.setItem("mimic:name", n);
  } catch {
    /* ignore */
  }
}

/** Last map the player chose. Validated on read: a stored id can outlive the
 *  map it names if a map is ever renamed or removed. */
function loadMapId(): string {
  try {
    const id = localStorage.getItem("mimic:mapId");
    if (isMapId(id)) return id;
  } catch {
    /* ignore */
  }
  return DEFAULT_MAP_ID;
}
function saveMapId(id: string) {
  try {
    localStorage.setItem("mimic:mapId", id);
  } catch {
    /* ignore */
  }
}

export class Screens {
  private root: HTMLElement;
  private menu: HTMLElement;
  private lobby: HTMLElement;
  private overlay: HTMLElement;
  private tutorial!: HTMLElement;
  private tutStep = 0;
  private tutAutoShown = false;
  private roomCode = "";
  /** Map the player has selected in the menu; persisted between visits. */
  private mapId = loadMapId();
  private copyHintTimer = 0;

  onConnect?: (mode: ConnectMode) => void;
  onReady?: (ready: boolean) => void;
  onLeave?: () => void;
  onSettings?: () => void;
  onPlayClick?: () => void; // used to unlock audio + request pointer lock

  constructor(root: HTMLElement) {
    this.root = root;

    this.menu = document.createElement("div");
    this.menu.className = "screen";
    this.menu.innerHTML = `
      <div class="card menu-card">
        <div class="brand"><h1>Hunting <span class="dot">Saga</span></h1></div>
        <p class="tagline">Hide as furniture, or hunt the impostors — a fast browser prop-hunt.</p>

        <div class="step"><span class="step-num">1</span><label for="name">Choose your name</label></div>
        <div class="name-field">
          <input id="name" type="text" maxlength="${MAX_NAME_LENGTH}" placeholder="e.g. NightCrate" autocomplete="off"
                 spellcheck="false" aria-describedby="name-hint" />
          <span class="name-count" data-r="namecount" aria-hidden="true">0/${MAX_NAME_LENGTH}</span>
        </div>
        <p class="name-hint" id="name-hint" data-r="namehint">${MIN_NAME_LENGTH}-${MAX_NAME_LENGTH} characters.</p>

        <div class="step"><span class="step-num">2</span><label>Pick a map</label></div>
        <div class="map-picker" data-r="maps" role="radiogroup" aria-label="Map"></div>

        <div class="step"><span class="step-num">3</span><label>Jump in and play</label></div>
        <button class="cta" data-a="public">
          <span class="cta-icon" aria-hidden="true">▶</span>
          <span class="cta-text">Quick Play<small>Start a public game right now</small></span>
        </button>

        <div class="or-sep"><span>or play with friends</span></div>
        <div class="row">
          <button class="secondary" data-a="create">Create private room</button>
          <button class="ghost" data-a="settings">Settings</button>
        </div>

        <label>Have a room code?</label>
        <div class="row">
          <input id="code" type="text" maxlength="8" placeholder="ABCDE" style="text-transform:uppercase" autocomplete="off" spellcheck="false" />
          <button class="secondary" data-a="join" style="flex:0 0 96px">Join</button>
        </div>

        <div class="error" data-r="err"></div>

        <button class="howto-btn" data-a="howto">
          <span class="howto-badge" aria-hidden="true">?</span>
          <span class="howto-text">How to Play<small>New here? A 30-second guide</small></span>
        </button>
      </div>`;

    this.lobby = document.createElement("div");
    this.lobby.className = "screen hidden";
    this.lobby.innerHTML = `
      <div class="card lobby-card">
        <div class="brand"><h1>Lobby</h1></div>
        <div class="lobby-map" data-r="lobbymap"></div>
        <div data-r="codewrap">
          <label>Room code — share to invite friends</label>
          <button class="code-pill" data-r="code" data-a="copycode" type="button" title="Click to copy the invite link">
            <span data-r="codetext">—</span>
            <span class="code-copy" aria-hidden="true">Copy link</span>
          </button>
          <p class="code-hint" data-r="codehint">Click the code to copy an invite link.</p>
        </div>
        <label class="mt">Players</label>
        <ul class="lobby-players" data-r="players"></ul>

        <button class="cta ready-cta" data-a="ready" data-ready="0">
          <span class="cta-icon" aria-hidden="true">✓</span>
          <span class="cta-text"><span data-r="readylabel">Ready up</span><small data-r="readysub">Tap when you're set to start</small></span>
        </button>
        <div class="row mt">
          <button class="secondary" data-a="settings">Settings</button>
          <button class="ghost" data-a="leave" style="flex:0 0 96px">Leave</button>
        </div>
        <p class="hint" data-r="lobbyhint">The match starts when everyone is ready (min ${MIN_PLAYERS_TO_START} players).</p>
      </div>`;

    this.overlay = document.createElement("div");
    this.overlay.className = "overlay hidden";

    this.tutorial = document.createElement("div");
    this.tutorial.className = "tutorial hidden";

    root.appendChild(this.menu);
    root.appendChild(this.lobby);
    root.appendChild(this.overlay);
    root.appendChild(this.tutorial);
    this.buildTutorial();

    const nameInput = this.menu.querySelector<HTMLInputElement>("#name")!;
    nameInput.value = loadName();
    const codeInput = this.menu.querySelector<HTMLInputElement>("#code")!;

    const countEl = this.menu.querySelector<HTMLElement>('[data-r="namecount"]')!;
    const hintEl = this.menu.querySelector<HTMLElement>('[data-r="namehint"]')!;

    // Live feedback as they type. The server re-runs the exact same rules from
    // @mimic/shared, so this is guidance, not the gate — a maxlength attribute
    // stops nobody.
    const refreshName = () => {
      const raw = nameInput.value;
      const len = nameLength(raw.trim());
      countEl.textContent = `${len}/${MAX_NAME_LENGTH}`;
      countEl.classList.toggle("over", len > MAX_NAME_LENGTH);
      const err = raw.trim() ? nameError(raw.trim()) : null;
      hintEl.textContent = err ?? `${MIN_NAME_LENGTH}-${MAX_NAME_LENGTH} characters.`;
      hintEl.classList.toggle("bad", !!err);
      nameInput.classList.toggle("invalid", !!err);
    };
    nameInput.addEventListener("input", refreshName);
    refreshName();

    const getName = () => {
      // sanitizeName is the same function the server uses: it strips control and
      // zero-width characters, collapses whitespace and caps the length by code
      // point, so an emoji can never be cut in half.
      const n = sanitizeName(nameInput.value);
      const err = n ? null : nameError(nameInput.value.trim());
      if (!n) {
        this.error(err ?? "Enter a display name first.");
        nameInput.focus();
        refreshName();
        return null;
      }
      // Show them what actually got sent, so a trimmed/cleaned name is not a
      // surprise when it appears in the killfeed.
      if (n !== nameInput.value) {
        nameInput.value = n;
        refreshName();
      }
      saveName(n);
      return n;
    };

    // ---- map picker ----------------------------------------------------
    // Built from MAP_ORDER rather than hardcoded, so adding a map to
    // @mimic/shared puts it in this list with no UI change.
    const mapsEl = this.menu.querySelector<HTMLElement>('[data-r="maps"]')!;
    mapsEl.innerHTML = MAP_ORDER.map((id) => {
      const m = MAPS[id];
      return `<button type="button" class="map-card" role="radio" data-map="${id}" aria-checked="false">
          <span class="map-name">${m.displayName}</span>
          <span class="map-tag">${m.tagline}</span>
          <span class="map-size">${Math.round(m.width)}x${Math.round(m.depth)}m &middot; ${m.props.length} props</span>
        </button>`;
    }).join("");

    const paintMap = () => {
      for (const el of mapsEl.querySelectorAll<HTMLElement>(".map-card")) {
        const on = el.dataset.map === this.mapId;
        el.classList.toggle("selected", on);
        el.setAttribute("aria-checked", on ? "true" : "false");
      }
    };
    mapsEl.addEventListener("click", (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>(".map-card");
      const id = card?.dataset.map;
      if (!isMapId(id)) return;
      this.mapId = id;
      saveMapId(id);
      paintMap();
    });
    paintMap();

    this.menu.querySelector('[data-a="public"]')!.addEventListener("click", () => {
      const n = getName();
      if (n) this.onConnect?.({ kind: "public", name: n, mapId: this.mapId });
    });
    this.menu.querySelector('[data-a="create"]')!.addEventListener("click", () => {
      const n = getName();
      if (n) this.onConnect?.({ kind: "create", name: n, mapId: this.mapId });
    });
    this.menu.querySelector('[data-a="join"]')!.addEventListener("click", () => {
      const n = getName();
      const code = codeInput.value.trim().toUpperCase();
      if (!code) return this.error("Enter a room code to join.");
      if (n) this.onConnect?.({ kind: "join", name: n, code });
    });
    this.menu.querySelector('[data-a="settings"]')!.addEventListener("click", () => this.onSettings?.());
    this.menu.querySelector('[data-a="howto"]')!.addEventListener("click", () => this.openTutorial());

    const readyBtn = this.lobby.querySelector<HTMLButtonElement>('[data-a="ready"]')!;
    readyBtn.addEventListener("click", () => {
      const next = readyBtn.dataset.ready === "1" ? 0 : 1;
      this.setReadyButton(next === 1);
      this.onReady?.(next === 1);
    });
    this.lobby.querySelector('[data-a="settings"]')!.addEventListener("click", () => this.onSettings?.());
    this.lobby.querySelector('[data-a="leave"]')!.addEventListener("click", () => this.onLeave?.());
    this.lobby.querySelector('[data-a="copycode"]')!.addEventListener("click", () => void this.copyInvite());
  }

  /** The shareable URL for the current room (picked up by the ?room= handler). */
  private inviteUrl(): string {
    try {
      const u = new URL(window.location.href);
      u.searchParams.set("room", this.roomCode);
      u.hash = "";
      return u.toString();
    } catch {
      return this.roomCode;
    }
  }

  /**
   * Copy an invite link to the clipboard. navigator.clipboard needs a secure
   * context, so fall back to a hidden textarea + execCommand on plain http
   * (e.g. a LAN dev server), and to selecting the code if even that fails.
   */
  private async copyInvite() {
    if (!this.roomCode) return;
    const text = this.inviteUrl();
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        ta.remove();
      } catch {
        ok = false;
      }
    }
    this.flashCopyHint(ok ? "Invite link copied — paste it to a friend." : `Copy failed. Share this code: ${this.roomCode}`, ok);
  }

  private flashCopyHint(msg: string, ok: boolean) {
    const hint = this.lobby.querySelector<HTMLElement>('[data-r="codehint"]');
    const pill = this.lobby.querySelector<HTMLElement>('[data-r="code"]');
    if (!hint || !pill) return;
    hint.textContent = msg;
    hint.classList.toggle("ok", ok);
    pill.classList.toggle("copied", ok);
    window.clearTimeout(this.copyHintTimer);
    this.copyHintTimer = window.setTimeout(() => {
      hint.textContent = "Click the code to copy an invite link.";
      hint.classList.remove("ok");
      pill.classList.remove("copied");
    }, 2400);
  }

  /** Pre-fill the "Have a room code?" field (used by ?room= invite links). */
  prefillRoomCode(code: string) {
    const input = this.menu.querySelector<HTMLInputElement>("#code");
    if (!input) return;
    input.value = code;
    const nameInput = this.menu.querySelector<HTMLInputElement>("#name");
    // If they already have a saved name, the only thing left is to press Join.
    if (nameInput && !nameInput.value.trim()) nameInput.focus();
  }

  error(msg: string) {
    const e = this.menu.querySelector<HTMLElement>('[data-r="err"]')!;
    e.textContent = msg;
  }

  /** Reflect ready state on the lobby's primary button (pulsing green → calm). */
  private setReadyButton(ready: boolean) {
    const btn = this.lobby.querySelector<HTMLButtonElement>('[data-a="ready"]')!;
    btn.dataset.ready = ready ? "1" : "0";
    btn.classList.toggle("is-ready", ready);
    this.lobby.querySelector<HTMLElement>('[data-r="readylabel"]')!.textContent = ready ? "Cancel ready" : "Ready up";
    this.lobby.querySelector<HTMLElement>('[data-r="readysub"]')!.textContent = ready
      ? "Waiting for the other players…"
      : "Tap when you're set to start";
  }

  showMenu() {
    this.menu.classList.remove("hidden");
    this.lobby.classList.add("hidden");
    this.overlay.classList.add("hidden");
    this.error("");
    this.maybeAutoTutorial();
  }

  // ---- New-player tutorial ------------------------------------------------

  private buildTutorial() {
    this.tutorial.innerHTML = `
      <div class="tut-card" role="dialog" aria-modal="true" aria-label="How to play Hunting Saga">
        <button class="tut-close" data-a="tclose" aria-label="Close tutorial">✕</button>
        <div class="tut-eyebrow" data-r="tlabel">Step 1</div>
        <h2 class="tut-title" data-r="ttitle"></h2>
        <div class="tut-body" data-r="tbody"></div>
        <div class="tut-foot">
          <div class="tut-dots" data-r="tdots"></div>
          <div class="tut-actions">
            <button class="ghost" data-a="tback">Back</button>
            <button class="tut-next" data-a="tnext"><span data-r="tnextlabel">Next</span></button>
          </div>
        </div>
      </div>`;
    this.tutorial.querySelector('[data-a="tclose"]')!.addEventListener("click", () => this.closeTutorial());
    this.tutorial.querySelector('[data-a="tback"]')!.addEventListener("click", () => {
      if (this.tutStep > 0) {
        this.tutStep--;
        this.renderTutorial();
      }
    });
    this.tutorial.querySelector('[data-a="tnext"]')!.addEventListener("click", () => {
      if (this.tutStep >= TUTORIAL_STEPS.length - 1) this.closeTutorial();
      else {
        this.tutStep++;
        this.renderTutorial();
      }
    });
    // Clicking the dimmed backdrop (outside the card) dismisses it.
    this.tutorial.addEventListener("click", (e) => {
      if (e.target === this.tutorial) this.closeTutorial();
    });
  }

  private renderTutorial() {
    const step = TUTORIAL_STEPS[this.tutStep];
    const total = TUTORIAL_STEPS.length;
    this.tutorial.querySelector<HTMLElement>('[data-r="tlabel"]')!.textContent = `Step ${this.tutStep + 1} of ${total}`;
    this.tutorial.querySelector<HTMLElement>('[data-r="ttitle"]')!.textContent = step.title;
    this.tutorial.querySelector<HTMLElement>('[data-r="tbody"]')!.innerHTML = step.body;
    this.tutorial.querySelector<HTMLElement>('[data-r="tdots"]')!.innerHTML = TUTORIAL_STEPS.map(
      (_, i) => `<span class="tut-dot${i === this.tutStep ? " on" : ""}"></span>`,
    ).join("");
    const back = this.tutorial.querySelector<HTMLButtonElement>('[data-a="tback"]')!;
    back.style.visibility = this.tutStep === 0 ? "hidden" : "visible";
    this.tutorial.querySelector<HTMLElement>('[data-r="tnextlabel"]')!.textContent =
      this.tutStep >= total - 1 ? "Got it — let's play!" : "Next";
  }

  openTutorial(step = 0) {
    this.tutStep = step;
    this.renderTutorial();
    this.tutorial.classList.remove("hidden");
  }

  private closeTutorial() {
    this.tutorial.classList.add("hidden");
    markTutorialSeen();
  }

  /** Auto-open the tutorial the very first time a new player reaches the menu. */
  private maybeAutoTutorial() {
    if (this.tutAutoShown) return;
    this.tutAutoShown = true;
    if (!hasSeenTutorial()) this.openTutorial();
  }

  showConnecting(text = "Connecting…") {
    this.overlay.classList.remove("hidden");
    this.overlay.innerHTML = `<div class="msg"><div class="spinner"></div><div>${text}</div></div>`;
  }

  hideOverlay() {
    this.overlay.classList.add("hidden");
  }

  /** A blocking overlay for unrecoverable feature/browser problems. */
  fatal(title: string, detail: string) {
    // Hide the menu too — otherwise the message floats over a fully-rendered,
    // apparently-clickable main menu (clicks are absorbed by the overlay).
    this.menu.classList.add("hidden");
    this.lobby.classList.add("hidden");
    this.tutorial.classList.add("hidden");
    this.overlay.classList.remove("hidden");
    this.overlay.innerHTML = `<div class="msg"><h2>${title}</h2><p class="hint">${detail}</p></div>`;
  }

  /** "Click to play" — the required user gesture for pointer lock + audio. */
  clickToPlay(onClick: () => void, note?: string) {
    this.overlay.classList.remove("hidden");
    const noteHtml = note ? `<p class="play-note">${escapeHtml(note)}</p>` : "";
    this.overlay.innerHTML = `<div class="msg play-prompt"><h2>Click to play</h2>${noteHtml}<p class="hint">Locks your mouse for aiming and enables sound.<br/>Press <kbd>Esc</kbd> to release the mouse.</p><button>Enter game</button></div>`;
    const go = () => {
      this.hideOverlay();
      onClick();
    };
    this.overlay.querySelector("button")!.addEventListener("click", go);
  }

  gameMenu(onResume: () => void, onSettings: () => void, onLeave: () => void) {
    this.overlay.classList.remove("hidden");
    this.overlay.innerHTML = `
      <div class="msg game-menu">
        <h2>Game Menu</h2>
        <div class="menu-actions">
          <button data-a="resume">Resume</button>
          <button class="secondary" data-a="settings">Settings</button>
          <button class="ghost" data-a="leave">Leave match</button>
        </div>
      </div>`;
    this.overlay.querySelector('[data-a="resume"]')!.addEventListener("click", onResume);
    this.overlay.querySelector('[data-a="settings"]')!.addEventListener("click", onSettings);
    this.overlay.querySelector('[data-a="leave"]')!.addEventListener("click", onLeave);
  }

  showLobby(code: string, isPrivate: boolean) {
    this.menu.classList.add("hidden");
    this.lobby.classList.remove("hidden");
    this.hideOverlay();
    const wrap = this.lobby.querySelector<HTMLElement>('[data-r="codewrap"]')!;
    wrap.style.display = isPrivate ? "block" : "none";
    this.lobby.querySelector<HTMLElement>('[data-r="codetext"]')!.textContent = code || "—";
    this.roomCode = code;
    this.setReadyButton(false); // fresh lobby: primary action is "Ready up" again
  }

  /** Show which map this room is playing. Players who joined by room code did
   *  not pick it, so without this they walk in blind. */
  setLobbyMap(mapId: string) {
    const el = this.lobby.querySelector<HTMLElement>('[data-r="lobbymap"]')!;
    const m = isMapId(mapId) ? MAPS[mapId] : MAPS[DEFAULT_MAP_ID];
    el.innerHTML = `<span class="lobby-map-label">Map</span>
      <span class="lobby-map-name">${m.displayName}</span>
      <span class="lobby-map-tag">${m.tagline}</span>`;
  }

  updateLobby(state: LobbyState) {
    const ul = this.lobby.querySelector<HTMLElement>('[data-r="players"]')!;
    const items: string[] = [];
    state.players.forEach((p) => {
      const badge = p.ready
        ? `<span class="badge ready">READY</span>`
        : `<span class="badge waiting">WAITING</span>`;
      const conn = p.connected ? "" : " (disconnected)";
      items.push(`<li><span>${escapeHtml(p.name)}${conn}</span>${badge}</li>`);
    });
    ul.innerHTML = items.join("") || `<li><span class="hint">Waiting for players…</span></li>`;
  }

  hideLobby() {
    this.lobby.classList.add("hidden");
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

function hasSeenTutorial(): boolean {
  try {
    return localStorage.getItem("mimic:tutorialSeen") === "1";
  } catch {
    return false;
  }
}
function markTutorialSeen() {
  try {
    localStorage.setItem("mimic:tutorialSeen", "1");
  } catch {
    /* ignore */
  }
}

/** New-player walkthrough. All content is static & author-controlled (safe to
 *  render as HTML). Keys mirror the real bindings in the game. */
const TUTORIAL_STEPS: { title: string; body: string }[] = [
  {
    title: "Welcome to Hunting Saga",
    body: `
      <p class="tut-lead">It's hide-and-seek with weapons. Every round you're randomly put on one of two teams:</p>
      <div class="tut-roles">
        <div class="tut-role role-props"><b>Props</b><span>Disguise as furniture and survive until the timer runs out.</span></div>
        <div class="tut-role role-hunters"><b>Hunters</b><span>Track down and eliminate every prop before time's up.</span></div>
      </div>
      <p class="tut-note">Teams flip between rounds, so you'll get to play both sides.</p>`,
  },
  {
    title: "Hiding as a Prop",
    body: `
      <p class="tut-lead">Blend into the room and don't get caught.</p>
      <div class="keygrid tut-keys">
        <div class="keychip"><kbd>E</kbd><span>Disguise as the object you're looking at</span></div>
        <div class="keychip"><kbd>R</kbd><span>Lock your rotation so you sit still &amp; natural</span></div>
        <div class="keychip"><kbd>F</kbd><span>Drop a decoy — a fake clone to bait hunters</span></div>
        <div class="keychip"><kbd>T</kbd><span>Flash — briefly blind nearby hunters</span></div>
      </div>
      <p class="tut-note">Tip: pick a spot near objects like your disguise, hold still, and save your decoy for when a hunter closes in.</p>`,
  },
  {
    title: "Hunting as a Hunter",
    body: `
      <p class="tut-lead">Find the hidden props before the clock hits zero.</p>
      <div class="keygrid tut-keys">
        <div class="keychip"><kbd>Click</kbd><span>Shoot the object you suspect is a prop</span></div>
        <div class="keychip"><kbd>R</kbd><span>Reload your weapon</span></div>
        <div class="keychip"><kbd>F</kbd><span>Swing your axe when you're out of ammo</span></div>
      </div>
      <p class="tut-note">Tip: shooting the wrong object wastes ammo — look for things that seem out of place, and listen for prop whistles.</p>`,
  },
  {
    title: "Controls & Getting Started",
    body: `
      <div class="keygrid tut-keys">
        <div class="keychip"><kbd>W A S D</kbd><span>Move</span></div>
        <div class="keychip"><kbd>Mouse</kbd><span>Look around</span></div>
        <div class="keychip"><kbd>Space</kbd><span>Jump</span></div>
        <div class="keychip"><kbd>Tab</kbd><span>Scoreboard</span></div>
        <div class="keychip"><kbd>Esc</kbd><span>Menu / free the mouse</span></div>
      </div>
      <p class="tut-lead" style="margin-top:14px">Ready to jump in?</p>
      <p class="tut-note"><b>Quick Play</b> drops you into a public match. To play with friends, hit <b>Create private room</b> and share the room code. A round needs at least ${MIN_PLAYERS_TO_START} players to start.</p>`,
  },
];

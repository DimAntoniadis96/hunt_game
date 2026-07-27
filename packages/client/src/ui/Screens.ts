import { MAX_NAME_LENGTH, MIN_PLAYERS_TO_START, Team, type PlayerView } from "@mimic/shared";
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

export class Screens {
  private root: HTMLElement;
  private menu: HTMLElement;
  private lobby: HTMLElement;
  private overlay: HTMLElement;

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
        <div class="brand"><h1>Mimic<span class="dot">Hunt</span></h1></div>
        <p class="tagline">Hide as furniture, or hunt the impostors — a fast browser prop-hunt.</p>

        <div class="step"><span class="step-num">1</span><label for="name">Choose your name</label></div>
        <input id="name" type="text" maxlength="${MAX_NAME_LENGTH}" placeholder="e.g. NightCrate" autocomplete="off" spellcheck="false" />

        <div class="step"><span class="step-num">2</span><label>Jump in and play</label></div>
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

        <details class="controls">
          <summary>How to play &amp; controls</summary>
          <div class="keygrid">
            <div class="keychip"><kbd>W A S D</kbd><span>Move</span></div>
            <div class="keychip"><kbd>Mouse</kbd><span>Look around</span></div>
            <div class="keychip"><kbd>Space</kbd><span>Jump</span></div>
            <div class="keychip"><kbd>E</kbd><span>Disguise · props</span></div>
            <div class="keychip"><kbd>F</kbd><span>Decoy · props</span></div>
            <div class="keychip"><kbd>T</kbd><span>Flash · props</span></div>
            <div class="keychip"><kbd>R</kbd><span>Reload / Lock</span></div>
            <div class="keychip"><kbd>Click</kbd><span>Shoot · hunters</span></div>
            <div class="keychip"><kbd>Tab</kbd><span>Scores</span></div>
          </div>
        </details>
      </div>`;

    this.lobby = document.createElement("div");
    this.lobby.className = "screen hidden";
    this.lobby.innerHTML = `
      <div class="card lobby-card">
        <div class="brand"><h1>Lobby</h1></div>
        <div data-r="codewrap">
          <label>Room code — share to invite friends</label>
          <div class="code-pill" data-r="code">—</div>
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

    root.appendChild(this.menu);
    root.appendChild(this.lobby);
    root.appendChild(this.overlay);

    const nameInput = this.menu.querySelector<HTMLInputElement>("#name")!;
    nameInput.value = loadName();
    const codeInput = this.menu.querySelector<HTMLInputElement>("#code")!;

    const getName = () => {
      const n = nameInput.value.trim();
      if (!n) {
        this.error("Enter a display name first.");
        nameInput.focus();
        return null;
      }
      saveName(n);
      return n;
    };

    this.menu.querySelector('[data-a="public"]')!.addEventListener("click", () => {
      const n = getName();
      if (n) this.onConnect?.({ kind: "public", name: n });
    });
    this.menu.querySelector('[data-a="create"]')!.addEventListener("click", () => {
      const n = getName();
      if (n) this.onConnect?.({ kind: "create", name: n });
    });
    this.menu.querySelector('[data-a="join"]')!.addEventListener("click", () => {
      const n = getName();
      const code = codeInput.value.trim().toUpperCase();
      if (!code) return this.error("Enter a room code to join.");
      if (n) this.onConnect?.({ kind: "join", name: n, code });
    });
    this.menu.querySelector('[data-a="settings"]')!.addEventListener("click", () => this.onSettings?.());

    const readyBtn = this.lobby.querySelector<HTMLButtonElement>('[data-a="ready"]')!;
    readyBtn.addEventListener("click", () => {
      const next = readyBtn.dataset.ready === "1" ? 0 : 1;
      this.setReadyButton(next === 1);
      this.onReady?.(next === 1);
    });
    this.lobby.querySelector('[data-a="settings"]')!.addEventListener("click", () => this.onSettings?.());
    this.lobby.querySelector('[data-a="leave"]')!.addEventListener("click", () => this.onLeave?.());
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
    this.overlay.classList.remove("hidden");
    this.overlay.innerHTML = `<div class="msg"><h2>${title}</h2><p class="hint">${detail}</p></div>`;
  }

  /** "Click to play" — the required user gesture for pointer lock + audio. */
  clickToPlay(onClick: () => void) {
    this.overlay.classList.remove("hidden");
    this.overlay.innerHTML = `<div class="msg play-prompt"><h2>Click to play</h2><p class="hint">Locks your mouse for aiming and enables sound.<br/>Press <kbd>Esc</kbd> to release the mouse.</p><button>Enter game</button></div>`;
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
    this.lobby.querySelector<HTMLElement>('[data-r="code"]')!.textContent = code || "—";
    this.setReadyButton(false); // fresh lobby: primary action is "Ready up" again
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

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
  onPlayClick?: () => void; // used to unlock audio + request pointer lock

  constructor(root: HTMLElement) {
    this.root = root;

    this.menu = document.createElement("div");
    this.menu.className = "screen";
    this.menu.innerHTML = `
      <div class="card">
        <div class="brand"><h1>Mimic<span class="dot">Hunt</span></h1></div>
        <p class="tagline">Hide as furniture. Or hunt the impostors. A browser prop-hunt.</p>
        <label for="name">Display name</label>
        <input id="name" type="text" maxlength="${MAX_NAME_LENGTH}" placeholder="e.g. CrateGoblin" />
        <button class="mt" data-a="public" style="width:100%">Quick Play (public)</button>
        <div class="row mt">
          <button class="secondary" data-a="create">Create private room</button>
        </div>
        <label>Join with a code</label>
        <div class="row">
          <input id="code" type="text" maxlength="8" placeholder="ABCDE" style="text-transform:uppercase" />
          <button class="ghost" data-a="join" style="flex:0 0 90px">Join</button>
        </div>
        <div class="error" data-r="err"></div>
        <p class="hint">Controls: <b>WASD</b> move · <b>Mouse</b> look · <b>Space</b> jump · <b>E</b> disguise (props) ·
        <b>R</b> reload/lock · <b>T</b> taunt · <b>Left-click</b> shoot (hunters) · <b>Tab</b> scores.</p>
      </div>`;

    this.lobby = document.createElement("div");
    this.lobby.className = "screen hidden";
    this.lobby.innerHTML = `
      <div class="card">
        <div class="brand"><h1>Lobby</h1></div>
        <div data-r="codewrap">
          <label>Room code — share to invite</label>
          <div class="code-pill" data-r="code">—</div>
        </div>
        <label class="mt">Players</label>
        <ul class="lobby-players" data-r="players"></ul>
        <div class="row mt">
          <button data-a="ready" data-ready="0">Ready up</button>
          <button class="ghost" data-a="leave" style="flex:0 0 90px">Leave</button>
        </div>
        <p class="hint" data-r="lobbyhint">Match starts when everyone is ready (min ${MIN_PLAYERS_TO_START} players).</p>
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

    const readyBtn = this.lobby.querySelector<HTMLButtonElement>('[data-a="ready"]')!;
    readyBtn.addEventListener("click", () => {
      const next = readyBtn.dataset.ready === "1" ? 0 : 1;
      readyBtn.dataset.ready = String(next);
      readyBtn.textContent = next ? "Cancel ready" : "Ready up";
      readyBtn.className = next ? "secondary" : "";
      this.onReady?.(next === 1);
    });
    this.lobby.querySelector('[data-a="leave"]')!.addEventListener("click", () => this.onLeave?.());
  }

  error(msg: string) {
    const e = this.menu.querySelector<HTMLElement>('[data-r="err"]')!;
    e.textContent = msg;
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
    this.overlay.innerHTML = `<div class="msg"><h2>Click to play</h2><p class="hint">Locks your mouse for aiming and enables sound.<br/>Press <kbd>Esc</kbd> to release the mouse.</p><button style="margin-top:14px">Enter game</button></div>`;
    const go = () => {
      this.hideOverlay();
      onClick();
    };
    this.overlay.querySelector("button")!.addEventListener("click", go);
  }

  showLobby(code: string, isPrivate: boolean) {
    this.menu.classList.add("hidden");
    this.lobby.classList.remove("hidden");
    this.hideOverlay();
    const wrap = this.lobby.querySelector<HTMLElement>('[data-r="codewrap"]')!;
    wrap.style.display = isPrivate ? "block" : "none";
    this.lobby.querySelector<HTMLElement>('[data-r="code"]')!.textContent = code || "—";
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

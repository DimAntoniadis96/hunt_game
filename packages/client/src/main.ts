import "./style.css";
import { Phase } from "@mimic/shared";
import { NetworkClient, type ConnectMode } from "./net/NetworkClient";
import { AudioManager } from "./audio/AudioManager";
import { HUD } from "./ui/HUD";
import { Screens } from "./ui/Screens";
import { SettingsMenu } from "./ui/SettingsMenu";
import { loadSettings, type GameSettings } from "./settings/GameSettings";
import { GameScene } from "./game/GameScene";
import { ServerMessage } from "@mimic/shared";

/**
 * Default to a same-origin socket whose scheme matches the page. A hardcoded
 * "ws://" default is blocked as mixed content on any HTTPS deployment, and the
 * failure surfaces as the misleading "Is the server running?" message.
 */
function defaultServerUrl(): string {
  try {
    if (location.protocol === "https:" || location.protocol === "http:") {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      // Vite dev serves the client on :5173 while the game server is on :2567.
      const host = location.port === "5173" ? `${location.hostname}:2567` : location.host;
      return `${proto}://${host}`;
    }
  } catch {
    /* non-browser context */
  }
  return "ws://localhost:2567";
}

const SERVER_URL = (import.meta.env.VITE_SERVER_URL as string) || defaultServerUrl();

const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
const uiRoot = document.getElementById("ui-root") as HTMLElement;

const screens = new Screens(uiRoot);
const hud = new HUD(uiRoot);
const audio = new AudioManager();
const settingsMenu = new SettingsMenu(uiRoot, loadSettings());

let net: NetworkClient | null = null;
let scene: GameScene | null = null;
let currentPhase: Phase | null = null;
let joinedPrivate = false;
let settings: GameSettings = settingsMenu.value;
let pauseOpen = false;
let returnToGameMenuAfterSettings = false;

applySettings(settings);

// ---- feature detection ----------------------------------------------------

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || (c.getContext("webgl") as WebGLRenderingContext | null);
    if (!gl) return false;
    // Release the probe context. Safari caps how many live WebGL contexts a page
    // may hold and evicts the OLDEST when the cap is hit — leaking this one
    // makes the real game engine a candidate for eviction.
    (gl.getExtension("WEBGL_lose_context") as { loseContext?: () => void } | null)?.loseContext?.();
    return true;
  } catch {
    return false;
  }
}

/** True on phones/tablets — where pointer lock either does not exist or is useless. */
function isTouchPrimary(): boolean {
  try {
    return window.matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
  } catch {
    return false;
  }
}

if (!hasWebGL()) {
  screens.fatal("WebGL not available", "This game needs a browser with WebGL enabled. Try a recent Chrome, Edge, or Firefox on desktop, and make sure hardware acceleration is on.");
} else if (isTouchPrimary()) {
  // Firefox Android, Samsung Internet and Chrome Android >= 144 all expose
  // requestPointerLock, so the API check alone let phone users through into a
  // real match they physically cannot play: there is no touch input anywhere,
  // so they stood frozen until the round ended (which spoils it for everyone
  // else too). Gate on the input device, not on the API.
  screens.fatal("Desktop only", "Hunting Saga needs a mouse and a keyboard. Open this page on a desktop or laptop to play.");
} else if (!("requestPointerLock" in HTMLElement.prototype)) {
  screens.fatal("Pointer Lock unsupported", "Your browser doesn't support Pointer Lock, which is required for mouse aiming. Please use a modern desktop browser.");
} else {
  screens.showMenu();
}

// ---- connection flow ------------------------------------------------------

screens.onConnect = async (mode: ConnectMode) => {
  joinedPrivate = mode.kind === "create";
  // The connect button click is a user gesture — warm up audio here so the
  // lobby ("preload") music is allowed to start while players wait to ready up.
  audio.unlock();
  screens.showConnecting();
  try {
    net = new NetworkClient(SERVER_URL);
    const room = await net.connect(mode);

    room.onMessage(ServerMessage.Welcome, () => {
      // Room code arrives here; refresh the lobby pill.
      screens.showLobby(net!.roomCode, true);
    });
    room.onError((code: number, message?: string) => {
      teardown(`Server error${message ? `: ${message}` : ` (${code})`}`);
    });
    room.onLeave((code: number) => {
      // 1000 = normal close; anything else is unexpected.
      teardown(code === 1000 ? "You left the match." : "Disconnected from the server.");
    });
    room.onStateChange((state: any) => onState(state));

    screens.showLobby(net.roomCode, true);
  } catch (err: any) {
    net = null;
    screens.showMenu();
    screens.error(err?.message || "Could not connect. Is the server running?");
  }
};

screens.onReady = (ready) => {
  audio.unlock(); // first gesture — safe place to warm up audio
  audio.play("ui");
  net?.setReady(ready);
};

screens.onLeave = () => teardown("You left the match.");
screens.onSettings = () => openSettings(currentPhase === Phase.Lobby || currentPhase === Phase.Countdown ? "lobby" : "menu");

settingsMenu.onChange = applySettings;
settingsMenu.onPreviewSfx = () => {
  audio.unlock();
  audio.play("ui");
};
settingsMenu.onFullscreen = () => {
  void toggleFullscreen();
};
settingsMenu.onClose = (context) => {
  if (context === "game" && returnToGameMenuAfterSettings && scene) {
    returnToGameMenuAfterSettings = false;
    showGameMenu();
  }
};

// ---- state / lifecycle ----------------------------------------------------

function onState(state: any) {
  const phase: Phase = state.phase;

  // Lobby list stays fresh while the lobby screen is up.
  if (phase === Phase.Lobby || phase === Phase.Countdown) {
    screens.updateLobby(state);
    screens.setLobbyMap(state.mapId);
  }

  if (phase !== Phase.Lobby && !scene) enterGame();
  if (phase === Phase.Lobby && scene) {
    exitGame();
    screens.showLobby(net?.roomCode ?? "", true);
  }

  // Drive the looping background music off the round phase. setMusic() is a
  // no-op when the track is already current, so calling it every patch is fine.
  if (phase !== currentPhase) updateMusic(phase);

  currentPhase = phase;
}

/** Map a round phase to its looping background track. */
function updateMusic(phase: Phase) {
  switch (phase) {
    case Phase.Lobby:
    case Phase.Countdown:
      audio.setMusic("music_lobby"); // waiting on queue for everyone to ready up
      break;
    case Phase.Prep:
      audio.setMusic("music_hide"); // props hiding, hunters frozen
      break;
    case Phase.Hunt:
      audio.setMusic("music_hunt"); // hunters released, main game
      break;
    case Phase.RoundEnd:
    case Phase.MatchEnd:
      audio.setMusic(null); // scoreboard / transition — silence
      break;
  }
}

function enterGame() {
  if (!net || !net.room) return;
  screens.hideLobby();
  screens.hideOverlay();
  pauseOpen = false;
  try {
    scene = new GameScene(canvas, net, audio, hud, settings);
  } catch (err: any) {
    // Engine/scene construction can fail (WebGL context refused, GPU process
    // crash, driver blocklist). We have already hidden the lobby and the
    // overlay at this point, and hud.show() below never runs — so without this
    // the player is left staring at a black page with no error and no way out.
    scene = null;
    void teardown(err?.message ? `Graphics failed to start: ${err.message}` : "Graphics failed to start on this device.");
    return;
  }
  scene.onLockLost = () => {
    if (settingsMenu.open || pauseOpen) return;
    // Only nudge to re-lock while a round is actually in progress.
    if (currentPhase === Phase.Prep || currentPhase === Phase.Hunt || currentPhase === Phase.Countdown) {
      showGameMenu();
    }
  };
  scene.onLockDenied = () => {
    if (settingsMenu.open || pauseOpen) return;
    // Put the click-to-play prompt back rather than leaving the player standing
    // in the world with a mouse that does nothing.
    showClickToPlay("Your browser blocked mouse capture. Click below to try again.");
  };
  hud.show();
  showClickToPlay();
}

function showClickToPlay(note?: string) {
  screens.clickToPlay(() => {
    audio.unlock();
    scene?.requestLock();
  }, note);
}

function exitGame() {
  pauseOpen = false;
  returnToGameMenuAfterSettings = false;
  scene?.dispose();
  scene = null;
  hud.hide();
}

async function teardown(message: string) {
  audio.stopMusic();
  exitGame();
  try {
    await net?.leave();
  } catch {
    /* ignore */
  }
  net = null;
  currentPhase = null;
  screens.showMenu();
  screens.error(message);
}

function applySettings(next: GameSettings) {
  settings = { ...next };
  audio.setMasterVolume(settings.masterVolume);
  audio.setSfxVolume(settings.sfxVolume);
  audio.setMusicVolume(settings.musicVolume);
  document.body.classList.toggle("reduce-motion", settings.reduceMotion);
  scene?.applySettings(settings);
}

function openSettings(context: "menu" | "lobby" | "game") {
  audio.unlock();
  if (context === "game") {
    pauseOpen = true;
    returnToGameMenuAfterSettings = true;
    scene?.setMenuOpen(true);
    screens.hideOverlay();
  }
  settingsMenu.show(context);
}

function showGameMenu() {
  if (!scene) return;
  pauseOpen = true;
  scene.setMenuOpen(true);
  screens.gameMenu(
    () => resumeGame(),
    () => openSettings("game"),
    () => teardown("You left the match."),
  );
}

function resumeGame() {
  if (!scene) return;
  pauseOpen = false;
  returnToGameMenuAfterSettings = false;
  screens.hideOverlay();
  scene.setMenuOpen(false);
  audio.unlock();
  scene.requestLock();
}

/**
 * Fullscreen with the WebKit fallback. The unprefixed API only landed in Safari
 * 16.4; before that the button threw a TypeError that the catch swallowed, so it
 * just looked broken.
 */
async function toggleFullscreen() {
  const doc = document as Document & {
    webkitFullscreenElement?: Element | null;
    webkitExitFullscreen?: () => Promise<void> | void;
  };
  const root = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
  };
  try {
    const active = document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
    if (active) {
      const exit = doc.exitFullscreen ?? doc.webkitExitFullscreen;
      if (exit) await exit.call(doc);
    } else {
      const req = root.requestFullscreen ?? root.webkitRequestFullscreen;
      if (req) await req.call(root);
    }
  } catch {
    audio.play("ui");
  }
}

window.addEventListener(
  "keydown",
  (e) => {
    if (e.code !== "Escape") return;
    if (settingsMenu.open) {
      e.preventDefault();
      e.stopPropagation();
      settingsMenu.hide();
      return;
    }
    if (!scene || !(currentPhase === Phase.Prep || currentPhase === Phase.Hunt || currentPhase === Phase.Countdown)) return;
    e.preventDefault();
    e.stopPropagation();
    if (pauseOpen) resumeGame();
    else showGameMenu();
  },
  true,
);

/**
 * Invite links: ?room=ABCDE pre-fills the join field so a friend only has to
 * enter a name and press Join. The param is stripped from the URL afterwards so
 * a refresh doesn't keep re-applying a stale code.
 */
function applyInviteFromUrl() {
  try {
    const url = new URL(window.location.href);
    const code = (url.searchParams.get("room") || "").trim().toUpperCase();
    if (!code) return;
    screens.prefillRoomCode(code);
    url.searchParams.delete("room");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  } catch {
    /* ignore malformed URLs */
  }
}
applyInviteFromUrl();

// Keep the canvas crisp on DPR/size changes even before a scene exists.
window.addEventListener("resize", () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
});
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

void currentPhase;
void joinedPrivate;

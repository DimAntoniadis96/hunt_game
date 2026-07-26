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

const SERVER_URL = (import.meta.env.VITE_SERVER_URL as string) || "ws://localhost:2567";

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
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

if (!hasWebGL()) {
  screens.fatal("WebGL not available", "This game needs a browser with WebGL enabled. Try a recent Chrome, Edge, or Firefox on desktop, and make sure hardware acceleration is on.");
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
  if (phase === Phase.Lobby || phase === Phase.Countdown) screens.updateLobby(state);

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
  scene = new GameScene(canvas, net, audio, hud, settings);
  scene.onLockLost = () => {
    if (settingsMenu.open || pauseOpen) return;
    // Only nudge to re-lock while a round is actually in progress.
    if (currentPhase === Phase.Prep || currentPhase === Phase.Hunt || currentPhase === Phase.Countdown) {
      showGameMenu();
    }
  };
  hud.show();
  screens.clickToPlay(() => {
    audio.unlock();
    scene?.requestLock();
  });
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

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
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

// Keep the canvas crisp on DPR/size changes even before a scene exists.
window.addEventListener("resize", () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
});
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

void currentPhase;
void joinedPrivate;

import "./style.css";
import { Phase } from "@mimic/shared";
import { NetworkClient, type ConnectMode } from "./net/NetworkClient";
import { AudioManager } from "./audio/AudioManager";
import { HUD } from "./ui/HUD";
import { Screens } from "./ui/Screens";
import { GameScene } from "./game/GameScene";
import { ServerMessage } from "@mimic/shared";

const SERVER_URL = (import.meta.env.VITE_SERVER_URL as string) || "ws://localhost:2567";

const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
const uiRoot = document.getElementById("ui-root") as HTMLElement;

const screens = new Screens(uiRoot);
const hud = new HUD(uiRoot);
const audio = new AudioManager();

let net: NetworkClient | null = null;
let scene: GameScene | null = null;
let currentPhase: Phase | null = null;
let joinedPrivate = false;

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
  currentPhase = phase;
}

function enterGame() {
  if (!net || !net.room) return;
  screens.hideLobby();
  screens.hideOverlay();
  scene = new GameScene(canvas, net, audio, hud);
  scene.onLockLost = () => {
    // Only nudge to re-lock while a round is actually in progress.
    if (currentPhase === Phase.Prep || currentPhase === Phase.Hunt || currentPhase === Phase.Countdown) {
      screens.clickToPlay(() => {
        audio.unlock();
        scene?.requestLock();
      });
    }
  };
  hud.show();
  screens.clickToPlay(() => {
    audio.unlock();
    scene?.requestLock();
  });
}

function exitGame() {
  scene?.dispose();
  scene = null;
  hud.hide();
}

async function teardown(message: string) {
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

// Keep the canvas crisp on DPR/size changes even before a scene exists.
window.addEventListener("resize", () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
});
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

void currentPhase;
void joinedPrivate;

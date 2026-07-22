import {
  Engine,
  Scene,
  Vector3,
  Color3,
  MeshBuilder,
  TransformNode,
  LinesMesh,
} from "@babylonjs/core";
import {
  CLIENT_INPUT_RATE,
  DEFAULT_MAP_ID,
  MAPS,
  PROP_MODELS,
  Phase,
  ServerMessage,
  Team,
  type PlayerView,
} from "@mimic/shared";
import type { Room } from "colyseus.js";
import type { NetworkClient } from "../net/NetworkClient";
import type { AudioManager } from "../audio/AudioManager";
import type { HUD } from "../ui/HUD";
import { buildEnvironment, buildStaticProps, createHunterVisual, createPropVisual } from "./mapBuilder";
import { InputController } from "./InputController";

const COPY_RANGE = 4.5;

interface Visual {
  node: TransformNode;
  key: string; // "hunter" or prop modelKey
}

export class GameScene {
  private engine: Engine;
  private scene: Scene;
  private input: InputController;
  private net: NetworkClient;
  private audio: AudioManager;
  private hud: HUD;
  private room: Room;
  private canvas: HTMLCanvasElement;

  private visuals = new Map<string, Visual>();
  private sendAccum = 0;
  private prevPhase: Phase | null = null;
  private prevAlive = true;
  private scoreboardOpen = false;
  private mapId: string;

  onLockLost?: () => void;

  constructor(canvas: HTMLCanvasElement, net: NetworkClient, audio: AudioManager, hud: HUD) {
    this.canvas = canvas;
    this.net = net;
    this.audio = audio;
    this.hud = hud;
    this.room = net.room!;
    this.mapId = (this.room.state as any).mapId || DEFAULT_MAP_ID;

    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: false });
    this.scene = new Scene(this.engine);

    const map = MAPS[this.mapId] ?? MAPS[DEFAULT_MAP_ID];
    buildEnvironment(this.scene, map);
    buildStaticProps(this.scene, map);

    const me = this.me();
    const spawn = me ? { x: me.x, z: me.z, ry: me.ry } : { x: 0, z: 0, ry: 0 };
    this.input = new InputController(this.scene, canvas, spawn);
    this.input.onJump = () => this.audio.play("jump");

    this.registerActionInput();
    this.registerServerEvents();

    this.engine.runRenderLoop(() => this.frame());
    window.addEventListener("resize", this.onResize);
    document.addEventListener("pointerlockchange", this.onLockChange);
  }

  private me(): PlayerView | undefined {
    return (this.room.state as any).players.get(this.net.sessionId) as PlayerView | undefined;
  }

  requestLock() {
    this.input.requestLock();
  }

  private onResize = () => this.engine.resize();

  private onLockChange = () => {
    if (document.pointerLockElement !== this.canvas) this.onLockLost?.();
  };

  // ---- per-frame loop -----------------------------------------------------

  private frame() {
    const dt = Math.min(0.05, this.engine.getDeltaTime() / 1000);
    const state = this.room.state as any;
    const me = this.me();
    const phase: Phase = state.phase;

    // Round-start teleport to authoritative spawn.
    if (phase === Phase.Prep && this.prevPhase !== Phase.Prep && me) {
      this.input.teleport(me.x, me.y, me.z, me.ry);
    }
    if (me && me.alive !== this.prevAlive && !me.alive) {
      this.input.teleport(me.x, me.y, me.z);
      this.hud.banner("You were eliminated — spectating", 3000);
    }
    this.prevPhase = phase;
    if (me) this.prevAlive = me.alive;

    // Freeze rules: dead spectators & hunters during prep can't move.
    const frozen = !me || !me.alive || (phase === Phase.Prep && me.team === Team.Hunters);
    this.input.setFrozen(frozen);

    const moving = this.input.update(dt);

    // Send input snapshot at a fixed rate (server re-validates).
    this.sendAccum += dt;
    if (this.sendAccum >= 1 / CLIENT_INPUT_RATE) {
      this.sendAccum = 0;
      if (me && me.alive) this.net.sendInput(this.input.snapshot(moving));
    }

    // Reconcile local player against authoritative position.
    if (me && me.alive && !frozen) this.input.reconcile(me.x, me.y, me.z);

    this.syncVisuals(state, dt);
    this.updatePrompts(me, phase);
    this.hud.update(state, me, this.net.ping);
    this.scene.render();
  }

  private syncVisuals(state: any, dt: number) {
    const seen = new Set<string>();
    state.players.forEach((p: PlayerView, id: string) => {
      seen.add(id);
      if (id === this.net.sessionId) return; // don't render our own body (first person)
      const desiredKey = p.alive ? (p.propModel ? p.propModel : "hunter") : "dead";
      let v = this.visuals.get(id);
      if (!v || v.key !== desiredKey) {
        v?.node.dispose();
        if (!p.alive) {
          this.visuals.delete(id);
          return; // eliminated players vanish
        }
        const node = p.propModel
          ? createPropVisual(this.scene, p.propModel, `p_${id}`)
          : createHunterVisual(this.scene, `p_${id}`);
        v = { node, key: desiredKey };
        this.visuals.set(id, v);
      }
      // Smooth toward the authoritative transform.
      const target = new Vector3(p.x, 0, p.z);
      v.node.position = Vector3.Lerp(v.node.position, target, Math.min(1, dt * 12));
      v.node.rotation.y = p.ry;
    });
    // Remove players who left.
    for (const [id, v] of this.visuals) {
      if (!seen.has(id)) {
        v.node.dispose();
        this.visuals.delete(id);
      }
    }
  }

  private updatePrompts(me: PlayerView | undefined, phase: Phase) {
    if (!me || !me.alive) return this.hud.prompt(null);
    if (me.team === Team.Props && (phase === Phase.Prep || phase === Phase.Hunt)) {
      const near = this.nearestProp();
      if (near) {
        this.hud.prompt(`<kbd>E</kbd> disguise as ${PROP_MODELS[near.modelKey]?.label ?? near.modelKey} · <kbd>R</kbd> lock · <kbd>T</kbd> taunt`);
      } else {
        this.hud.prompt(`Find an object, then press <kbd>E</kbd> to disguise · <kbd>R</kbd> lock`);
      }
    } else {
      this.hud.prompt(null);
    }
  }

  private nearestProp(): { id: string; modelKey: string; d: number } | null {
    const map = MAPS[this.mapId] ?? MAPS[DEFAULT_MAP_ID];
    const cam = this.input.camera.position;
    let best: { id: string; modelKey: string; d: number } | null = null;
    for (const s of map.props) {
      if (!PROP_MODELS[s.modelKey]?.disguiseAllowed) continue;
      const d = Math.hypot(cam.x - s.x, cam.z - s.z);
      if (d <= COPY_RANGE && (!best || d < best.d)) best = { id: s.id, modelKey: s.modelKey, d };
    }
    return best;
  }

  // ---- input actions ------------------------------------------------------

  private registerActionInput() {
    this.canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      if (!this.input.locked) {
        this.input.requestLock();
        return;
      }
      this.tryShoot();
    });

    window.addEventListener("keydown", (e) => {
      const me = this.me();
      if (!me) return;
      switch (e.code) {
        case "KeyE":
          if (me.team === Team.Props && me.alive) this.tryDisguise();
          break;
        case "KeyR":
          if (me.team === Team.Hunters) this.net.reload();
          else if (me.team === Team.Props) this.net.lockRotation(!me.rotationLocked);
          break;
        case "KeyT":
          if (me.team === Team.Props && me.alive) this.net.taunt();
          break;
        case "Tab":
          e.preventDefault();
          if (!this.scoreboardOpen) {
            this.scoreboardOpen = true;
            this.hud.scoreboard(true, this.room.state as any);
          }
          break;
      }
    });
    window.addEventListener("keyup", (e) => {
      if (e.code === "Tab") {
        this.scoreboardOpen = false;
        this.hud.scoreboard(false);
      }
    });
  }

  private tryShoot() {
    const me = this.me();
    const state = this.room.state as any;
    if (!me || me.team !== Team.Hunters || !me.alive) return;
    if (state.phase !== Phase.Hunt) return;
    if (me.reloading || me.ammo <= 0) {
      this.audio.play("ui");
      return;
    }
    const cam = this.input.camera;
    const o = cam.position;
    const d = cam.getDirection(Vector3.Forward());
    this.net.shoot({ ox: o.x, oy: o.y, oz: o.z, dx: d.x, dy: d.y, dz: d.z, seq: this.input.seq });
    this.audio.play("shoot");
    this.spawnTracer(o, d);
  }

  private tryDisguise() {
    const near = this.nearestProp();
    if (!near) {
      this.hud.banner("No object close enough to copy", 1200);
      return;
    }
    this.net.transform(near.id);
  }

  private spawnTracer(origin: Vector3, dir: Vector3) {
    const end = origin.add(dir.scale(40));
    const line = MeshBuilder.CreateLines("tracer", { points: [origin.clone(), end] }, this.scene) as LinesMesh;
    line.color = new Color3(1, 0.8, 0.3);
    line.isPickable = false;
    window.setTimeout(() => line.dispose(), 60);
  }

  // ---- server-driven effects ---------------------------------------------

  private registerServerEvents() {
    const room = this.room;
    room.onMessage(ServerMessage.ShotResult, (m: any) => {
      if (m.hit) {
        this.hud.setCrosshairHit(true, false);
        this.audio.play("hit");
      } else if (m.wrong) {
        this.hud.setCrosshairHit(false, true);
        this.hud.banner("Wrong target! Health penalty", 1200);
        this.audio.play("hit");
      }
    });
    room.onMessage(ServerMessage.Hit, (_m: any) => {
      this.audio.play("hit");
      document.body.animate([{ filter: "brightness(1.6) saturate(0.5)" }, { filter: "none" }], { duration: 180 });
    });
    room.onMessage(ServerMessage.Eliminated, () => {
      this.audio.play("eliminate");
    });
    room.onMessage(ServerMessage.Killfeed, (m: any) => {
      this.hud.killfeed(`${m.killerName} ▶ ${m.victimName}`);
      this.audio.play("eliminate");
    });
    room.onMessage(ServerMessage.TransformResult, (m: any) => {
      if (m.ok) {
        this.hud.banner(`Disguised as ${PROP_MODELS[m.modelKey]?.label ?? m.modelKey}`, 1200);
        this.audio.play("transform");
      } else {
        this.hud.banner(m.reason || "Can't disguise here", 1400);
        this.audio.play("ui");
      }
    });
    room.onMessage(ServerMessage.RoundEvent, (m: any) => {
      if (m.message === "taunt") {
        this.audio.play("taunt");
        return;
      }
      if (m.message) this.hud.banner(m.message, 2200);
      if (m.phase === Phase.Prep) this.audio.play("round_start");
      else if (m.phase === Phase.Hunt) this.audio.play("round_start");
      else if (m.phase === Phase.RoundEnd || m.phase === Phase.MatchEnd) this.audio.play("round_end");
    });
  }

  dispose() {
    window.removeEventListener("resize", this.onResize);
    document.removeEventListener("pointerlockchange", this.onLockChange);
    this.input.dispose();
    this.engine.stopRenderLoop();
    this.scene.dispose();
    this.engine.dispose();
  }
}

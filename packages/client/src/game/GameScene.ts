import {
  Engine,
  Scene,
  Vector3,
  Color3,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  GlowLayer,
} from "@babylonjs/core";
import {
  CLIENT_INPUT_RATE,
  DEFAULT_MAP_ID,
  MAPS,
  PROP_MODELS,
  Phase,
  ServerMessage,
  Team,
  WEAPON_RELOAD_MS,
  type PlayerView,
} from "@mimic/shared";
import type { Room } from "colyseus.js";
import type { NetworkClient } from "../net/NetworkClient";
import type { AudioManager } from "../audio/AudioManager";
import type { HUD } from "../ui/HUD";
import { buildEnvironment, buildStaticProps, createHunterVisual, createPropVisual } from "./mapBuilder";
import { InputController, type CameraMode } from "./InputController";

const COPY_RANGE = 4.5;

interface Visual {
  node: TransformNode;
  key: string;
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
  private currentMode: CameraMode = "fp";

  private gunRoot: TransformNode | null = null;
  private gunMuzzle: TransformNode | null = null;
  private lastShotTime = -9999;
  private reloadStart = 0;
  private prevReloading = false;
  private prevLocked = false;

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

    const glow = new GlowLayer("glow", this.scene);
    glow.intensity = 0.55;

    const me = this.me();
    const spawn = me ? { x: me.x, z: me.z, ry: me.ry } : { x: 0, z: 0, ry: 0 };
    this.input = new InputController(this.scene, canvas, spawn);
    this.input.onJump = () => this.audio.play("jump");

    this.buildGunViewmodel();

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

  // ---- gun viewmodel (hunter, first-person) -------------------------------

  private buildGunViewmodel() {
    const mat = new StandardMaterial("gunMat", this.scene);
    mat.diffuseColor = new Color3(0.28, 0.3, 0.36);
    mat.emissiveColor = new Color3(0.18, 0.2, 0.26); // readable even in dark corners
    mat.specularColor = new Color3(0.5, 0.5, 0.55);

    const root = new TransformNode("gunvm", this.scene);
    root.parent = this.input.camera; // rides with the view
    root.position.set(0.34, -0.32, 0.9);

    const body = MeshBuilder.CreateBox("gunBody", { width: 0.12, height: 0.16, depth: 0.5 }, this.scene);
    const barrel = MeshBuilder.CreateCylinder("gunBarrel", { diameter: 0.055, height: 0.5, tessellation: 8 }, this.scene);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.03, 0.42);
    const grip = MeshBuilder.CreateBox("gunGrip", { width: 0.09, height: 0.2, depth: 0.13 }, this.scene);
    grip.position.set(0, -0.17, -0.12);
    for (const m of [body, barrel, grip]) {
      m.parent = root;
      m.material = mat;
      m.isPickable = false;
      m.renderingGroupId = 1; // draw on top so it doesn't clip into walls
    }

    const muzzle = new TransformNode("muzzle", this.scene);
    muzzle.parent = root;
    muzzle.position.set(0, 0.03, 0.7);

    this.gunRoot = root;
    this.gunMuzzle = muzzle;
    root.setEnabled(false);
  }

  /** Animates the first-person gun: recoil on fire + a visible reload motion. */
  private animateGun(me: PlayerView) {
    if (!this.gunRoot) return;
    const now = performance.now();

    // Detect the start of a reload to seed the animation + play the sound once.
    if (me.reloading && !this.prevReloading) {
      this.reloadStart = now;
      this.audio.play("reload");
    }
    this.prevReloading = me.reloading;

    // Base rest pose.
    let x = 0.34;
    let y = -0.32;
    let z = 0.9;
    let rotX = 0;

    // Recoil kick (short).
    const rt = (now - this.lastShotTime) / 90;
    if (rt >= 0 && rt < 1) z = 0.9 - 0.14 * (1 - rt);

    // Reload: dip the gun down and tilt it, over the full reload duration.
    if (me.reloading) {
      const p = Math.min(1, (now - this.reloadStart) / WEAPON_RELOAD_MS);
      const s = Math.sin(p * Math.PI); // 0 -> 1 -> 0 arc
      y = -0.32 - 0.2 * s;
      x = 0.34 - 0.06 * s;
      z = 0.9 - 0.05 * s;
      rotX = 0.85 * s;
    }

    this.gunRoot.position.set(x, y, z);
    this.gunRoot.rotation.set(rotX, 0, 0);
  }

  // ---- per-frame loop -----------------------------------------------------

  private frame() {
    const dt = Math.min(0.05, this.engine.getDeltaTime() / 1000);
    const state = this.room.state as any;
    const me = this.me();
    const phase: Phase = state.phase;

    if (phase === Phase.Prep && this.prevPhase !== Phase.Prep && me) {
      this.input.teleport(me.x, me.y, me.z, me.ry);
    }
    if (me && me.alive !== this.prevAlive && !me.alive) {
      this.input.teleport(me.x, me.y, me.z);
      this.hud.banner("You were eliminated — spectating", 3000);
    }
    this.prevPhase = phase;
    if (me) this.prevAlive = me.alive;

    // Camera mode: props see themselves (3rd person); hunters aim (1st person).
    const desiredMode: CameraMode = me && me.team === Team.Props ? "tp" : "fp";
    if (desiredMode !== this.currentMode) {
      this.currentMode = desiredMode;
      this.input.setMode(desiredMode);
    }
    const showGun = !!me && me.team === Team.Hunters && me.alive && this.currentMode === "fp";
    this.gunRoot?.setEnabled(showGun);
    if (showGun && me) this.animateGun(me);

    const frozen = !me || !me.alive || (phase === Phase.Prep && me.team === Team.Hunters);
    this.input.setFrozen(frozen);
    // Jump is allowed for any alive player (even a frozen hunter during Prep).
    this.input.setJumpAllowed(!!me && me.alive);
    // Rotation lock: freeze the prop's facing so mouse-look stops spinning it.
    const wantLock = !!me && me.team === Team.Props && me.rotationLocked;
    this.input.setRotationLocked(wantLock);
    if (me && me.team === Team.Props && me.rotationLocked !== this.prevLocked) {
      this.hud.banner(me.rotationLocked ? "Rotation locked 🔒" : "Rotation unlocked 🔓", 1000);
      this.audio.play("ui");
    }
    this.prevLocked = me?.rotationLocked ?? false;

    const moving = this.input.update(dt);

    this.sendAccum += dt;
    if (this.sendAccum >= 1 / CLIENT_INPUT_RATE) {
      this.sendAccum = 0;
      if (me && me.alive) this.net.sendInput(this.input.snapshot(moving));
    }
    if (me && me.alive && !frozen) this.input.reconcile(me.x, me.y, me.z);

    this.syncVisuals(state, dt, this.currentMode === "tp");
    this.updatePrompts(me, phase);
    this.hud.update(state, me, this.net.ping);
    this.scene.render();
  }

  private syncVisuals(state: any, dt: number, renderLocalBody: boolean) {
    const seen = new Set<string>();
    state.players.forEach((p: PlayerView, id: string) => {
      seen.add(id);

      if (id === this.net.sessionId) {
        // Local body: only rendered in third-person (props) and while alive.
        if (!renderLocalBody || !p.alive) {
          const ex = this.visuals.get(id);
          if (ex) {
            ex.node.dispose();
            this.visuals.delete(id);
          }
          return;
        }
        const desiredKey = p.propModel ? p.propModel : "self_body";
        let v = this.visuals.get(id);
        if (!v || v.key !== desiredKey) {
          v?.node.dispose();
          const node = p.propModel
            ? createPropVisual(this.scene, p.propModel, `self_${id}`)
            : createHunterVisual(this.scene, `self_${id}`, "#37d9a0");
          v = { node, key: desiredKey };
          this.visuals.set(id, v);
        }
        // Follow the client-predicted position/height for responsiveness.
        const feet = this.input.getFeet();
        v.node.position.set(feet.x, feet.y, feet.z);
        v.node.rotation.y = this.input.bodyYaw;
        return;
      }

      const desiredKey = p.alive ? (p.propModel ? p.propModel : "hunter") : "dead";
      let v = this.visuals.get(id);
      if (!v || v.key !== desiredKey) {
        v?.node.dispose();
        if (!p.alive) {
          this.visuals.delete(id);
          return;
        }
        const node = p.propModel
          ? createPropVisual(this.scene, p.propModel, `p_${id}`)
          : createHunterVisual(this.scene, `p_${id}`);
        // Make OTHER players solid so a hunter bumps into / stands on a hiding
        // prop just like a real object (no more sinking through it). The local
        // player's own body is never collidable (would trap its own collider).
        node.getChildMeshes().forEach((m) => (m.checkCollisions = true));
        v = { node, key: desiredKey };
        this.visuals.set(id, v);
      }
      const target = new Vector3(p.x, p.y, p.z);
      v.node.position = Vector3.Lerp(v.node.position, target, Math.min(1, dt * 12));
      v.node.rotation.y = p.ry;
    });

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
        this.hud.prompt(`Walk up to an object, then press <kbd>E</kbd> to disguise · <kbd>R</kbd> lock`);
      }
    } else {
      this.hud.prompt(null);
    }
  }

  private nearestProp(): { id: string; modelKey: string; d: number } | null {
    const map = MAPS[this.mapId] ?? MAPS[DEFAULT_MAP_ID];
    const feet = this.input.getFeet();
    let best: { id: string; modelKey: string; d: number } | null = null;
    for (const s of map.props) {
      if (!PROP_MODELS[s.modelKey]?.disguiseAllowed) continue;
      const d = Math.hypot(feet.x - s.x, feet.z - s.z);
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

    // Visible bullet: muzzle flash + tracer from the gun tip toward the crosshair.
    let from = o.clone();
    if (this.gunRoot && this.gunMuzzle && this.gunRoot.isEnabled()) {
      this.gunMuzzle.computeWorldMatrix(true);
      from = this.gunMuzzle.getAbsolutePosition().clone();
      this.spawnMuzzleFlash(from);
    }
    this.lastShotTime = performance.now(); // recoil handled in animateGun()
    this.spawnTracer(from, o.add(d.scale(45)));
  }

  private tryDisguise() {
    const near = this.nearestProp();
    if (!near) {
      this.hud.banner("No object close enough to copy", 1200);
      return;
    }
    this.net.transform(near.id);
  }

  private spawnTracer(from: Vector3, to: Vector3) {
    const tube = MeshBuilder.CreateTube("tracer", { path: [from, to], radius: 0.02, tessellation: 5 }, this.scene);
    const m = new StandardMaterial("tracerMat", this.scene);
    m.emissiveColor = new Color3(1, 0.85, 0.35);
    m.disableLighting = true;
    tube.material = m;
    tube.isPickable = false;
    tube.renderingGroupId = 1;
    window.setTimeout(() => tube.dispose(), 70);
  }

  private spawnMuzzleFlash(pos: Vector3) {
    const s = MeshBuilder.CreateSphere("mflash", { diameter: 0.28, segments: 6 }, this.scene);
    s.position = pos;
    const m = new StandardMaterial("mflashMat", this.scene);
    m.emissiveColor = new Color3(1, 0.8, 0.4);
    m.disableLighting = true;
    s.material = m;
    s.isPickable = false;
    s.renderingGroupId = 1;
    window.setTimeout(() => s.dispose(), 50);
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
    room.onMessage(ServerMessage.Hit, () => {
      this.audio.play("hit");
      document.body.animate([{ filter: "brightness(1.6) saturate(0.5)" }, { filter: "none" }], { duration: 180 });
    });
    room.onMessage(ServerMessage.Eliminated, () => this.audio.play("eliminate"));
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
      if (m.phase === Phase.Prep || m.phase === Phase.Hunt) this.audio.play("round_start");
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

import {
  Engine,
  Scene,
  Vector3,
  Color3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  GlowLayer,
} from "@babylonjs/core";
import {
  CLIENT_INPUT_RATE,
  DECOY_COOLDOWN_MS,
  DEFAULT_MAP_ID,
  HUNTER_WALK_SPEED,
  MAPS,
  MELEE_COOLDOWN_MS,
  PROP_MODELS,
  PROP_WALK_SPEED,
  Phase,
  ServerMessage,
  Team,
  TRANSFORM_COOLDOWN_MS,
  WEAPON_RELOAD_MS,
  type DecoyView,
  type PlayerView,
} from "@mimic/shared";
import type { Room } from "colyseus.js";
import type { NetworkClient } from "../net/NetworkClient";
import type { AudioManager } from "../audio/AudioManager";
import type { HUD } from "../ui/HUD";
import { buildEnvironment, buildStaticProps, createHunterVisual, createPropVisual } from "./mapBuilder";
import { InputController, type CameraMode } from "./InputController";

const COPY_RANGE = 6.0;

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
  private decoyNodes = new Map<string, TransformNode>();
  private stepAccum = new Map<string, number>(); // per-hunter footstep timers
  private sendAccum = 0;
  private prevPhase: Phase | null = null;
  private prevAlive = true;
  private scoreboardOpen = false;
  private mapId: string;
  private currentMode: CameraMode = "fp";

  private gunRoot: TransformNode | null = null;
  private gunMuzzle: TransformNode | null = null;
  private axeRoot: TransformNode | null = null;
  private transformReadyAt = 0; // performance.now() when a disguise change is next allowed
  private decoyReadyAt = 0; // performance.now() when the next decoy (F) is allowed
  private lastDisguiseModel = "";
  private lastShotTime = -9999;
  private lastMeleeTime = -9999;
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
    this.input.setBounds(map.bounds);
    this.input.onJump = () => this.audio.play("jump");

    this.buildGunViewmodel();
    this.buildAxeViewmodel();

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
    // A chunky, colourful cartoon "tag blaster": teal body, dark funnel muzzle,
    // a round drum mag, and a glowing orange energy tip (blooms via the GlowLayer).
    const bodyMat = new StandardMaterial("gunBody", this.scene);
    bodyMat.diffuseColor = new Color3(0.2, 0.79, 0.62);
    bodyMat.emissiveColor = new Color3(0.08, 0.32, 0.25);
    bodyMat.specularColor = new Color3(0.5, 0.6, 0.55);
    const darkMat = new StandardMaterial("gunDark", this.scene);
    darkMat.diffuseColor = new Color3(0.15, 0.17, 0.22);
    darkMat.emissiveColor = new Color3(0.07, 0.08, 0.11);
    const glowMat = new StandardMaterial("gunGlow", this.scene);
    glowMat.emissiveColor = new Color3(1, 0.5, 0.2);
    glowMat.disableLighting = true;

    const root = new TransformNode("gunvm", this.scene);
    root.parent = this.input.camera; // rides with the view
    root.position.set(0.34, -0.34, 0.86);

    const part = (m: Mesh, mt: StandardMaterial) => {
      m.parent = root;
      m.material = mt;
      m.isPickable = false;
      m.renderingGroupId = 1; // draw on top so it doesn't clip into walls
      return m;
    };
    part(MeshBuilder.CreateBox("gunBody", { width: 0.15, height: 0.2, depth: 0.44 }, this.scene), bodyMat);
    part(MeshBuilder.CreateBox("gunFin", { width: 0.05, height: 0.09, depth: 0.3 }, this.scene), darkMat).position.set(0, 0.14, 0.02);
    const funnel = part(MeshBuilder.CreateCylinder("gunFunnel", { diameterTop: 0.2, diameterBottom: 0.1, height: 0.2, tessellation: 16 }, this.scene), darkMat);
    funnel.rotation.x = Math.PI / 2;
    funnel.position.set(0, 0.02, 0.36);
    part(MeshBuilder.CreateSphere("gunTip", { diameter: 0.13, segments: 12 }, this.scene), glowMat).position.set(0, 0.02, 0.46);
    const drum = part(MeshBuilder.CreateCylinder("gunDrum", { diameter: 0.23, height: 0.09, tessellation: 18 }, this.scene), bodyMat);
    drum.rotation.z = Math.PI / 2;
    drum.position.set(0, -0.12, -0.05);
    const hub = part(MeshBuilder.CreateCylinder("gunHub", { diameter: 0.08, height: 0.11, tessellation: 12 }, this.scene), glowMat);
    hub.rotation.z = Math.PI / 2;
    hub.position.set(0, -0.12, -0.05);
    const grip = part(MeshBuilder.CreateBox("gunGrip", { width: 0.1, height: 0.22, depth: 0.14 }, this.scene), darkMat);
    grip.position.set(0, -0.2, -0.16);
    grip.rotation.x = -0.22;

    const muzzle = new TransformNode("muzzle", this.scene);
    muzzle.parent = root;
    muzzle.position.set(0, 0.02, 0.5);

    this.gunRoot = root;
    this.gunMuzzle = muzzle;
    root.setEnabled(false);
  }

  /** A hand axe held in the LEFT hand — the hunter's melee, swung with F. */
  private buildAxeViewmodel() {
    const wood = new StandardMaterial("axeWood", this.scene);
    wood.diffuseColor = new Color3(0.36, 0.24, 0.13);
    wood.emissiveColor = new Color3(0.12, 0.08, 0.05);
    wood.specularColor = new Color3(0.1, 0.1, 0.1);
    const metal = new StandardMaterial("axeMetal", this.scene);
    metal.diffuseColor = new Color3(0.5, 0.53, 0.58);
    metal.emissiveColor = new Color3(0.13, 0.14, 0.17); // readable but not blinding
    metal.specularColor = new Color3(0.5, 0.5, 0.55);

    const dark = new StandardMaterial("axeGrip", this.scene);
    dark.diffuseColor = new Color3(0.1, 0.1, 0.12);
    dark.emissiveColor = new Color3(0.04, 0.04, 0.05);
    const glow = new StandardMaterial("axeRune", this.scene);
    glow.emissiveColor = new Color3(1, 0.45, 0.15);
    glow.disableLighting = true;

    const root = new TransformNode("axevm", this.scene);
    root.parent = this.input.camera; // rides with the view, left side
    root.position.set(-0.5, -0.52, 0.82);
    root.rotation.set(-0.25, 0, 0.5); // held up-and-inward at rest
    root.scaling.setAll(1.02); // a big, chunky axe

    const part = (m: Mesh, mt: StandardMaterial) => {
      m.parent = root;
      m.material = mt;
      m.isPickable = false;
      m.renderingGroupId = 1;
      return m;
    };
    part(MeshBuilder.CreateCylinder("axeHandle", { diameter: 0.06, height: 0.66, tessellation: 8 }, this.scene), wood);
    // Leather grip wraps near the bottom.
    for (const gy of [-0.2, -0.13, -0.06]) {
      part(MeshBuilder.CreateCylinder("axeWrap", { diameter: 0.075, height: 0.03, tessellation: 8 }, this.scene), dark).position.set(0, gy, 0);
    }
    // Chunky head: a metal block, a wide cutting bevel, and a back poll.
    part(MeshBuilder.CreateBox("axeHead", { width: 0.07, height: 0.22, depth: 0.2 }, this.scene), metal).position.set(0, 0.27, 0.03);
    const blade = part(MeshBuilder.CreateCylinder("axeBlade", { diameterTop: 0.0, diameterBottom: 0.28, height: 0.2, tessellation: 3 }, this.scene), metal);
    blade.rotation.set(Math.PI / 2, 0, 0);
    blade.position.set(0, 0.27, 0.22);
    part(MeshBuilder.CreateBox("axePoll", { width: 0.09, height: 0.15, depth: 0.11 }, this.scene), metal).position.set(0, 0.27, -0.1);
    // A glowing rune on the cheek of the blade (a little flair).
    part(MeshBuilder.CreateSphere("axeRune", { diameter: 0.06, segments: 8 }, this.scene), glow).position.set(0.04, 0.29, 0.12);

    this.axeRoot = root;
    root.setEnabled(false);
  }

  /** Rest pose + an overhead chop that sweeps down through screen centre. */
  private animateAxe() {
    if (!this.axeRoot) return;
    const now = performance.now();
    // Pose keyframes: [x, y, z, rotX, rotZ].
    const rest = [-0.5, -0.52, 0.82, -0.25, 0.5];
    const wind = [-0.58, -0.26, 0.7, -1.0, 0.72]; // raised up-left, blade back
    const strike = [-0.1, -0.5, 1.06, 1.4, 0.02]; // down through the crosshair, reaching forward
    let pose = rest;
    const p = (now - this.lastMeleeTime) / 360; // ~360ms whole swing
    if (p >= 0 && p < 1) {
      const lerp = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
      if (p < 0.26) pose = lerp(rest, wind, p / 0.26); // quick wind-up
      else if (p < 0.54) pose = lerp(wind, strike, (p - 0.26) / 0.28); // fast chop down
      else pose = lerp(strike, rest, (p - 0.54) / 0.46); // recover
    }
    this.axeRoot.position.set(pose[0], pose[1], pose[2]);
    this.axeRoot.rotation.set(pose[3], 0, pose[4]);
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
      this.input.setRotationLocked(false); // fresh round starts unlocked
      this.transformReadyAt = 0; // disguise cooldown resets each round
      this.decoyReadyAt = 0;
      this.lastDisguiseModel = "";
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
    this.axeRoot?.setEnabled(showGun);
    if (showGun && me) {
      this.animateGun(me);
      this.animateAxe();
    }

    const frozen = !me || !me.alive || (phase === Phase.Prep && me.team === Team.Hunters);
    this.input.setFrozen(frozen);
    // Jump is allowed for any alive player (even a frozen hunter during Prep).
    this.input.setJumpAllowed(!!me && me.alive);
    // Lock (freeze in place, incl. mid-air) is driven locally for instant feel
    // by the R key. Force-unlock whenever the local player can't be a locked prop.
    if (!me || me.team !== Team.Props || !me.alive || phase === Phase.RoundEnd || phase === Phase.MatchEnd) {
      this.input.setRotationLocked(false);
    }

    // Props move a little faster than hunters — mobility is their edge.
    const speed = me && me.team === Team.Props ? PROP_WALK_SPEED : HUNTER_WALK_SPEED;
    const moving = this.input.update(dt, speed);

    this.sendAccum += dt;
    if (this.sendAccum >= 1 / CLIENT_INPUT_RATE) {
      this.sendAccum = 0;
      if (me && me.alive) this.net.sendInput(this.input.snapshot(moving));
    }
    // Don't reconcile while frozen or locked (a locked prop holds its exact spot).
    if (me && me.alive && !frozen && !this.input.isRotationLocked()) this.input.reconcile(me.x, me.y, me.z);

    this.syncVisuals(state, dt, this.currentMode === "tp");
    this.syncDecoys(state);
    if (phase === Phase.Hunt) this.updateFootsteps(state, moving, dt);
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

      const isHunter = p.team === Team.Hunters;
      const desiredKey = p.alive ? (p.propModel ? p.propModel : isHunter ? "hunter" : "person") : "dead";
      let v = this.visuals.get(id);
      if (!v || v.key !== desiredKey) {
        v?.node.dispose();
        if (!p.alive) {
          this.visuals.delete(id);
          return;
        }
        const node = p.propModel
          ? createPropVisual(this.scene, p.propModel, `p_${id}`)
          : createHunterVisual(this.scene, `p_${id}`, isHunter ? "#ff7043" : "#8e7cc3", isHunter);
        // Make OTHER players solid so a hunter bumps into / stands on a hiding
        // prop just like a real object. A disguised prop is fully solid; an
        // undisguised character only blocks via its torso (so we don't create
        // dozens of tiny colliders for eyes/hat/weapons).
        node.getChildMeshes().forEach((m) => (m.checkCollisions = p.propModel ? true : m.name.includes("_torso")));
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

  /** Render decoy clones from server state (created/removed as the list changes). */
  private syncDecoys(state: any) {
    const seen = new Set<string>();
    state.decoys.forEach((d: DecoyView) => {
      seen.add(d.id);
      if (!this.decoyNodes.has(d.id)) {
        const node = createPropVisual(this.scene, d.modelKey, `decoy_${d.id}`);
        node.position.set(d.x, d.y, d.z);
        node.rotation.y = d.ry;
        // Faint shimmer so the owner can tell their own decoys apart (subtle).
        this.decoyNodes.set(d.id, node);
      }
    });
    for (const [id, node] of this.decoyNodes) {
      if (!seen.has(id)) {
        node.dispose();
        this.decoyNodes.delete(id);
      }
    }
  }

  /**
   * Volume + stereo pan for a world-space sound relative to the listener. Volume
   * is loud up close and fades to ZERO at `maxDist` (quadratic), so a far seeker
   * barely hears a whistle and a close one hears it clearly. Pan is left/right by
   * direction relative to where the listener is facing.
   */
  private spatialParams(px: number, py: number, pz: number, maxDist: number): { vol: number; pan: number } {
    const cam = this.input.camera;
    const dx = px - cam.position.x;
    const dy = py - cam.position.y;
    const dz = pz - cam.position.z;
    const dist = Math.hypot(dx, dy, dz);
    const t = Math.min(1, dist / maxDist);
    const vol = (1 - t) * (1 - t);
    const right = cam.getDirection(Vector3.Right());
    const hlen = Math.hypot(dx, dz) || 1;
    const pan = Math.max(-1, Math.min(1, (dx * right.x + dz * right.z) / hlen));
    return { vol, pan };
  }

  /** Footsteps for moving hunters (own + nearby others), positional so props can
   * hear a seeker approaching. */
  private updateFootsteps(state: any, localMoving: boolean, dt: number) {
    const STEP = 0.34; // seconds between footfalls
    const MAX_DIST = 22; // metres — a step fades to silence at this range
    state.players.forEach((p: PlayerView, id: string) => {
      if (p.team !== Team.Hunters || !p.alive) {
        this.stepAccum.delete(id);
        return;
      }
      const isSelf = id === this.net.sessionId;
      const movingNow = isSelf ? localMoving : p.moving;
      if (!movingNow) {
        this.stepAccum.set(id, STEP); // primed so the first step lands promptly
        return;
      }
      let acc = (this.stepAccum.get(id) ?? STEP) + dt;
      if (acc >= STEP) {
        acc -= STEP;
        const pos = isSelf ? this.input.getFeet() : { x: p.x, y: p.y, z: p.z };
        const { vol, pan } = this.spatialParams(pos.x, pos.y, pos.z, MAX_DIST);
        this.audio.playSpatial("step", Math.min(0.85, vol), pan);
      }
      this.stepAccum.set(id, acc);
    });
  }

  private updatePrompts(me: PlayerView | undefined, phase: Phase) {
    if (!me || !me.alive) return this.hud.prompt(null);
    if (me.team !== Team.Props || (phase !== Phase.Prep && phase !== Phase.Hunt)) {
      return this.hud.prompt(null);
    }

    // Static hint — no per-frame proximity scan (the actual nearest object is only
    // resolved on the E press). Keeps the render loop cheap and stops the label
    // flickering the name of every object you walk past.
    const disguised = !!me.propModel;
    const now = performance.now();
    const segs: string[] = [];

    if (!disguised) {
      segs.push(`<kbd class="key-primary">E</kbd> disguise`);
      segs.push(`<kbd>R</kbd> lock`);
    } else {
      const changeCd = Math.ceil(Math.max(0, this.transformReadyAt - now) / 1000);
      segs.push(changeCd > 0 ? `<kbd>E</kbd> change <span class="cd">${changeCd}s</span>` : `<kbd class="key-primary">E</kbd> change`);
      segs.push(`<kbd>R</kbd> lock`);
      const decoyCd = Math.ceil(Math.max(0, this.decoyReadyAt - now) / 1000);
      segs.push(decoyCd > 0 ? `<kbd>F</kbd> decoy <span class="cd">${decoyCd}s</span>` : `<kbd>F</kbd> decoy`);
      segs.push(`<kbd>T</kbd> taunt`);
    }

    this.hud.prompt(segs.join(`<span class="sep">·</span>`));
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
          else if (me.team === Team.Props && me.alive) {
            const nl = !this.input.isRotationLocked();
            this.input.setRotationLocked(nl); // instant local freeze (incl. mid-air)
            this.net.lockRotation(nl); // so other players see the frozen facing
            this.audio.play("ui"); // no center banner — the frozen model + sound are the cue
          }
          break;
        case "KeyF":
          if (me.team === Team.Hunters && me.alive) {
            this.tryMelee(); // axe swing — always available, independent of ammo
          } else if (me.team === Team.Props && me.alive && me.propModel) {
            const now = performance.now();
            if (now < this.decoyReadyAt) {
              this.hud.banner(`Decoy ready in ${Math.ceil((this.decoyReadyAt - now) / 1000)}s`, 900);
              this.audio.play("ui");
            } else {
              this.net.decoy();
              this.decoyReadyAt = now + DECOY_COOLDOWN_MS;
              this.audio.play("transform"); // no center banner — the clone + sound are the cue
            }
          }
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
      // Empty / reloading: just an empty click. Melee is the axe (F), not the gun.
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

  /** Axe swing (F) — a short-range melee, usable any time regardless of ammo. */
  private tryMelee() {
    const me = this.me();
    const state = this.room.state as any;
    if (!me || me.team !== Team.Hunters || !me.alive || state.phase !== Phase.Hunt) return;
    const now = performance.now();
    if (now - this.lastMeleeTime < MELEE_COOLDOWN_MS) return;
    this.lastMeleeTime = now; // drives the axe swing arc in animateAxe()
    const cam = this.input.camera;
    const o = cam.position;
    const d = cam.getDirection(Vector3.Forward());
    this.net.melee({ ox: o.x, oy: o.y, oz: o.z, dx: d.x, dy: d.y, dz: d.z, seq: this.input.seq });
    this.audio.play("jump"); // a swing whoosh (swap for a real axe sample later)
  }

  private tryDisguise() {
    const near = this.nearestProp();
    if (!near) {
      this.hud.banner("No object close enough to copy", 1200);
      return;
    }
    const me = this.me();
    // Client-side cooldown guard (server also enforces): block only a real CHANGE
    // to a different model — re-copying your current disguise is a harmless no-op.
    const cdMs = this.transformReadyAt - performance.now();
    if (me?.propModel && near.modelKey !== me.propModel && cdMs > 0) {
      this.hud.banner(`Can change disguise in ${Math.ceil(cdMs / 1000)}s`, 1200);
      this.audio.play("ui");
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
        // Axe hits use one of two impact sounds at random; gun hits use "hit".
        this.audio.play(m.melee ? (Math.random() < 0.5 ? "axe1" : "axe2") : "hit");
      } else if (m.decoy) {
        // Destroyed a decoy clone → ammo reward. Positive cue, no penalty.
        // An axe hitting a clone sounds exactly like hitting a real hider, so the
        // seeker can't tell decoy from prop by ear; gun kills keep the pop cue.
        this.hud.setCrosshairHit(true, false);
        this.audio.play(m.melee ? (Math.random() < 0.5 ? "axe1" : "axe2") : "transform");
      } else if (m.melee) {
        // Axe swung through empty air (no prop, no clone) — a whiffing miss.
        this.audio.play("axe_miss");
      } else if (m.wrong) {
        this.hud.setCrosshairHit(false, true); // red crosshair flash is the only cue now
        this.audio.play("hit");
      }
    });
    room.onMessage(ServerMessage.Hit, () => {
      // Local player took damage from a seeker — random pain sting + red flash.
      this.audio.playOneOf(["damage1", "damage2"]);
      document.body.animate([{ filter: "brightness(1.6) saturate(0.5)" }, { filter: "none" }], { duration: 180 });
    });
    // The death sound is emitted once, globally, from the killfeed below (every
    // kill in prop hunt is a hider dying), so the local-victim Eliminated event
    // stays sound-free to avoid a doubled sting.
    room.onMessage(ServerMessage.Eliminated, () => {
      /* HUD/state handled elsewhere; death sound comes from Killfeed */
    });
    room.onMessage(ServerMessage.Killfeed, (m: any) => {
      this.hud.killfeed(`${m.killerName} ▶ ${m.victimName}`);
      this.audio.playOneOf(["death1", "death2"]); // a hider died
    });
    room.onMessage(ServerMessage.TransformResult, (m: any) => {
      if (m.ok) {
        // Only (re)start the cooldown when the disguise actually changed.
        if (m.modelKey !== this.lastDisguiseModel) {
          this.transformReadyAt = performance.now() + (m.cooldownMs ?? TRANSFORM_COOLDOWN_MS);
          this.lastDisguiseModel = m.modelKey;
        }
        this.audio.play("transform"); // no center banner — the new model + sound are the cue
      } else {
        this.hud.banner(m.reason || "Can't disguise here", 1400);
        this.audio.play("ui");
      }
    });
    room.onMessage(ServerMessage.Whistle, (m: any) => {
      // A prop's auto-whistle — play their assigned sound positionally so seekers
      // can locate them (loud when close, fading to silence when far).
      const { vol, pan } = this.spatialParams(m.x, m.y ?? 0, m.z, 46);
      this.audio.playWhistle(m.sound ?? 1, vol, pan);
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

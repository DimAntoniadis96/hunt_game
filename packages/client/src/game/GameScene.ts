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
  FLASHBANG_BLIND_MS,
  FLASHBANG_COOLDOWN_MS,
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
import type { GameSettings } from "../settings/GameSettings";
import { renderScaleForQuality } from "../settings/GameSettings";
import { buildEnvironment, buildStaticProps, createHunterVisual, createPropVisual, resetMapCaches, setPropVisualCollisions } from "./mapBuilder";
import { InputController, type CameraMode } from "./InputController";

const COPY_RANGE = 6.0;

interface Visual {
  node: TransformNode;
  key: string;
}

export class GameScene {
  private engine: Engine;
  private scene: Scene;
  private glow: GlowLayer | null = null;
  private input: InputController;
  private net: NetworkClient;
  private audio: AudioManager;
  private hud: HUD;
  private room: Room;
  private canvas: HTMLCanvasElement;

  private visuals = new Map<string, Visual>();
  private decoyNodes = new Map<string, TransformNode>();
  private pendingOwnerDecoys = new Set<string>(); // owner's decoys not yet solid to them (still standing on them)
  private stepAccum = new Map<string, number>(); // per-hunter footstep timers
  private sendAccum = 0;
  private prevPhase: Phase | null = null;
  private prevAlive = true;
  private scoreboardOpen = false;
  private mapId: string;
  private currentMode: CameraMode = "fp";
  private menuOpen = false;
  private settings: GameSettings;

  private gunRoot: TransformNode | null = null;
  private gunMuzzle: TransformNode | null = null;
  private axeRoot: TransformNode | null = null;
  private transformReadyAt = 0; // performance.now() when a disguise change is next allowed
  private decoyReadyAt = 0; // performance.now() when the next decoy (F) is allowed
  private flashbangReadyAt = 0; // performance.now() when the next flashbang (T) is allowed
  private blindEl: HTMLDivElement | null = null; // top-level flashbang blind overlay
  private blindRaf = 0;
  private blindUntil = 0;
  private lastFinaleSec = -1; // tracks the finale countdown second so the beep fires once each
  private lastRoundEventPhase: string | null = null; // so mid-phase notices don't replay round stings
  private lastDisguiseModel = "";
  private lastShotTime = -9999;
  private lastMeleeTime = -9999;
  private reloadStart = 0;
  private prevReloading = false;
  private prevLocked = false;

  onLockLost?: () => void;
  /** The browser refused a pointer-lock request (no lock was ever taken). */
  onLockDenied?: () => void;

  constructor(canvas: HTMLCanvasElement, net: NetworkClient, audio: AudioManager, hud: HUD, settings: GameSettings) {
    this.canvas = canvas;
    this.net = net;
    this.audio = audio;
    this.hud = hud;
    this.room = net.room!;
    this.settings = { ...settings };
    this.mapId = (this.room.state as any).mapId || DEFAULT_MAP_ID;

    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: false });
    this.scene = new Scene(this.engine);

    const map = MAPS[this.mapId] ?? MAPS[DEFAULT_MAP_ID];
    buildEnvironment(this.scene, map);
    buildStaticProps(this.scene, map);

    // The glow layer re-renders every mesh it "owns" into an offscreen target.
    // With no include-list Babylon owns the WHOLE scene (~500 meshes), which
    // roughly doubles the frame cost for the sake of ~10 glowing bits. So we
    // build it with an explicit include-list and register only bright-emissive
    // meshes via addGlow(). On "low" we skip the layer entirely.
    if (this.settings.renderQuality !== "low") {
      this.glow = new GlowLayer("glow", this.scene);
      this.glow.intensity = 0.55;
    }
    // Static scenery: the sun disc and any lamp glass built above.
    for (const m of this.scene.meshes) this.addGlowMesh(m as Mesh);

    const me = this.me();
    const spawn = me ? { x: me.x, z: me.z, ry: me.ry } : { x: 0, z: 0, ry: 0 };
    this.input = new InputController(this.scene, canvas, spawn);
    this.input.setBounds(map.bounds);
    this.input.onJump = () => this.audio.play("jump");
    this.input.onLockDenied = () => this.onLockDenied?.();
    this.applySettings(this.settings);

    this.buildGunViewmodel();
    this.buildAxeViewmodel();
    this.addGlowTree(this.gunRoot);
    this.addGlowTree(this.axeRoot);

    this.registerActionInput();
    this.registerServerEvents();

    this.engine.runRenderLoop(() => this.frame());
    window.addEventListener("resize", this.onResize);
    document.addEventListener("pointerlockchange", this.onLockChange);
  }

  private me(): PlayerView | undefined {
    return (this.room.state as any).players.get(this.net.sessionId) as PlayerView | undefined;
  }

  /**
   * Register a single mesh with the glow layer, but only if its material is
   * genuinely bright-emissive. Ordinary scenery sits at emissive <= 0.2 (mat()
   * defaults to 0.16); the things meant to bloom — gun tip, axe rune, sun disc,
   * lamp glass, tracers, muzzle flash — are all >= 0.85 on their strongest
   * channel. 0.6 sits safely in that gap.
   */
  private addGlowMesh(m: Mesh | null | undefined) {
    if (!this.glow || !m) return;
    const mat = m.material as StandardMaterial | null;
    const e = mat?.emissiveColor;
    if (!e) return;
    if (Math.max(e.r, e.g, e.b) >= 0.6) this.glow.addIncludedOnlyMesh(m);
  }

  /** Same, for every mesh under a freshly-built player/prop/decoy visual. */
  private addGlowTree(node: TransformNode | null | undefined) {
    if (!this.glow || !node) return;
    for (const m of node.getChildMeshes(false)) this.addGlowMesh(m as Mesh);
  }

  /**
   * Dispose a player/decoy visual, un-registering its meshes from the glow
   * layer first. Babylon stores included meshes by uniqueId and does NOT drop
   * them when the mesh is disposed, and hasMesh() does a linear indexOf over
   * that list every frame — so without this, disguise changes would slowly
   * grow a list of dead ids that costs us on every frame.
   */
  private disposeVisual(node: TransformNode | null | undefined) {
    if (!node) return;
    if (this.glow) {
      for (const m of node.getChildMeshes(false)) this.glow.removeIncludedOnlyMesh(m as Mesh);
    }
    node.dispose();
  }

  requestLock() {
    this.menuOpen = false;
    this.input.requestLock();
  }

  releaseLock() {
    this.input.releaseLock();
  }

  setMenuOpen(open: boolean) {
    this.menuOpen = open;
    if (open) {
      this.scoreboardOpen = false;
      this.hud.scoreboard(false);
      this.input.releaseLock();
    }
  }

  applySettings(settings: GameSettings) {
    this.settings = { ...settings };
    this.input.setSensitivity(settings.mouseSensitivity);
    this.input.setInvertMouseY(settings.invertMouseY);
    this.input.setFov(settings.fov);
    this.input.setThirdPersonDistance(settings.cameraDistance);
    this.engine.setHardwareScalingLevel(renderScaleForQuality(settings.renderQuality));
    document.body.classList.toggle("reduce-motion", settings.reduceMotion);
  }

  private onResize = () => this.engine.resize();
  private onLockChange = () => {
    if (document.pointerLockElement !== this.canvas && !this.menuOpen) this.onLockLost?.();
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
      this.flashbangReadyAt = 0;
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

    const frozen =
      !me || !me.alive || (phase === Phase.Prep && me.team === Team.Hunters) || (phase === Phase.Countdown && !!state.rebuilding);
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
    this.updateFinale(me, phase, state);
    this.hud.update(state, me, this.net.ping);
    this.hud.fps(this.settings.showFps, this.engine.getFps());
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
            this.disposeVisual(ex.node);
            this.visuals.delete(id);
          }
          return;
        }
        const desiredKey = p.propModel ? p.propModel : "self_body";
        let v = this.visuals.get(id);
        if (!v || v.key !== desiredKey) {
          this.disposeVisual(v?.node);
          const node = p.propModel
            ? createPropVisual(this.scene, p.propModel, `self_${id}`)
            : createHunterVisual(this.scene, `self_${id}`, "#37d9a0");
          this.addGlowTree(node);
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
        this.disposeVisual(v?.node);
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
        if (p.propModel) setPropVisualCollisions(node, true);
        else node.getChildMeshes().forEach((m) => (m.checkCollisions = m.name.includes("_torso")));
        this.addGlowTree(node);
        v = { node, key: desiredKey };
        this.visuals.set(id, v);
      }
      const target = new Vector3(p.x, p.y, p.z);
      v.node.position = Vector3.Lerp(v.node.position, target, Math.min(1, dt * 12));
      v.node.rotation.y = p.ry;
    });

    for (const [id, v] of this.visuals) {
      if (!seen.has(id)) {
        this.disposeVisual(v.node);
        this.visuals.delete(id);
      }
    }
  }

  /** Render decoy clones from server state (created/removed as the list changes). */
  private syncDecoys(state: any) {
    const seen = new Set<string>();
    const feet = this.input.getFeet();
    state.decoys.forEach((d: DecoyView) => {
      seen.add(d.id);
      const mine = d.ownerId === this.net.sessionId;
      if (!this.decoyNodes.has(d.id)) {
        const node = createPropVisual(this.scene, d.modelKey, `decoy_${d.id}`);
        this.addGlowTree(node);
        node.position.set(d.x, d.y, d.z);
        node.rotation.y = d.ry;
        // A decoy spawns on the dropper's exact spot, so making it solid to the
        // owner immediately would trap them inside their own clone. Others
        // (hunters/props) collide at once so it's real bait; the owner's own
        // decoy stays pass-through until they step clear (see below).
        setPropVisualCollisions(node, d.ownerId !== this.net.sessionId);
        this.decoyNodes.set(d.id, node);
        if (mine) this.pendingOwnerDecoys.add(d.id);
      }
      // Grace period: once the owner has walked off their fresh decoy, solidify
      // it for them too — so afterwards they collide with / can stand on it just
      // like everyone else. No lingering asymmetry, and never stuck at spawn.
      if (mine && this.pendingOwnerDecoys.has(d.id)) {
        const clearance = (PROP_MODELS[d.modelKey]?.radius ?? 0.5) + 0.55;
        if (Math.hypot(feet.x - d.x, feet.z - d.z) > clearance) {
          const node = this.decoyNodes.get(d.id);
          if (node) setPropVisualCollisions(node, true);
          this.pendingOwnerDecoys.delete(d.id);
        }
      }
    });
    for (const [id, node] of this.decoyNodes) {
      if (!seen.has(id)) {
        this.disposeVisual(node);
        this.decoyNodes.delete(id);
        this.pendingOwnerDecoys.delete(id);
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
    const locked = this.input.isRotationLocked();
    const now = performance.now();
    const segs: string[] = [];

    // The R segment doubles as the lock indicator: neutral "lock" when free, and
    // a bold red "LOCKED" (press R to move) while frozen in place.
    const lockSeg = locked
      ? `<kbd class="key-locked">R</kbd> <span class="locked-label">LOCKED</span> <span class="locked-hint">— press R to move</span>`
      : `<kbd>R</kbd> lock`;

    if (!disguised) {
      segs.push(`<kbd class="key-primary">E</kbd> disguise`);
      segs.push(lockSeg);
    } else {
      const changeCd = Math.ceil(Math.max(0, this.transformReadyAt - now) / 1000);
      segs.push(changeCd > 0 ? `<kbd>E</kbd> change <span class="cd">${changeCd}s</span>` : `<kbd class="key-primary">E</kbd> change`);
      segs.push(lockSeg);
      const decoyCd = Math.ceil(Math.max(0, this.decoyReadyAt - now) / 1000);
      segs.push(decoyCd > 0 ? `<kbd>F</kbd> decoy <span class="cd">${decoyCd}s</span>` : `<kbd>F</kbd> decoy`);
      if (phase === Phase.Hunt) {
        const flashCd = Math.ceil(Math.max(0, this.flashbangReadyAt - now) / 1000);
        segs.push(flashCd > 0 ? `<kbd>T</kbd> flash <span class="cd">${flashCd}s</span>` : `<kbd class="key-flash">T</kbd> flash`);
      }
    }

    this.hud.prompt(segs.join(`<span class="sep">·</span>`), locked);
  }

  /**
   * A shared, simple final-seconds countdown (just a number + beep, no screen
   * tint):
   *   • Prep — the last 5s, shown only to living props, as a "hide!" warning.
   *   • Hunt — the last 3s, shown to EVERYONE, but only while at least one prop
   *     is still alive (i.e. the seeker hasn't found them all and the round is
   *     about to end on the clock).
   */
  private updateFinale(me: PlayerView | undefined, phase: Phase, state: any) {
    const sec = Math.max(0, Math.ceil((state.phaseEndsAt - Date.now()) / 1000));
    let n: number | null = null;
    let label = "";

    let tone: "hide" | "hunt" = "hunt";
    if (phase === Phase.Prep && me && me.alive && me.team === Team.Props) {
      if (sec >= 1 && sec <= 5) {
        n = sec;
        label = "Hide";
        tone = "hide";
      }
    } else if (phase === Phase.Hunt) {
      let propsAlive = 0;
      state.players.forEach((p: PlayerView) => {
        if (p.team === Team.Props && p.alive) propsAlive++;
      });
      if (propsAlive > 0 && sec >= 1 && sec <= 3) {
        n = sec; // same for everyone
        label = "Time";
        tone = "hunt";
      }
    }

    this.hud.finale(n, label, tone);
    if (n !== null) {
      if (n !== this.lastFinaleSec) {
        this.lastFinaleSec = n;
        this.audio.play("countdown"); // one beep per remaining second
      }
    } else {
      this.lastFinaleSec = -1;
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

  private onPointerDown = (e: PointerEvent) => {
    if (this.menuOpen) return;
    if (e.button !== 0) return;
    if (!this.input.locked) {
      this.input.requestLock();
      return;
    }
    this.tryShoot();
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.menuOpen || e.defaultPrevented) return;
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
        if (me.team === Team.Props && me.alive && me.propModel) this.tryFlashbang();
        break;
      case "Tab":
        e.preventDefault();
        if (!this.scoreboardOpen) {
          this.scoreboardOpen = true;
          this.hud.scoreboard(true, this.room.state as any);
        }
        break;
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (this.menuOpen || e.defaultPrevented) return;
    if (e.code === "Tab") {
      this.scoreboardOpen = false;
      this.hud.scoreboard(false);
    }
  };

  private registerActionInput() {
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
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

  private tryFlashbang() {
    const state = this.room.state as any;
    if (state.phase !== Phase.Hunt) {
      this.hud.banner("Flash is available when hunters are released.", 1200);
      this.audio.play("ui");
      return;
    }
    const now = performance.now();
    if (now < this.flashbangReadyAt) {
      this.hud.banner(`Flash ready in ${Math.ceil((this.flashbangReadyAt - now) / 1000)}s`, 900);
      this.audio.play("ui");
      return;
    }
    this.net.flashbang();
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
    this.addGlowMesh(tube);
    window.setTimeout(() => {
      // Unregister before disposing: the glow include-list is scanned per frame,
      // so leaving ~4 dead entries per second in it would grow unbounded.
      this.glow?.removeIncludedOnlyMesh(tube);
      tube.dispose();
      m.dispose(); // was leaked: only the mesh used to be disposed
    }, 70);
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
    this.addGlowMesh(s);
    window.setTimeout(() => {
      this.glow?.removeIncludedOnlyMesh(s);
      s.dispose();
      m.dispose(); // was leaked
    }, 50);
  }

  private spawnFlashbangBurst(pos: Vector3) {
    const s = MeshBuilder.CreateSphere("flashbangBurst", { diameter: 1.2, segments: 18 }, this.scene);
    s.position.copyFrom(pos);
    const m = new StandardMaterial("flashbangBurstMat", this.scene);
    m.emissiveColor = new Color3(1, 0.98, 0.78);
    m.diffuseColor = new Color3(1, 0.95, 0.78);
    m.alpha = 0.85;
    m.disableLighting = true;
    s.material = m;
    s.isPickable = false;
    s.renderingGroupId = 1;
    this.addGlowMesh(s);

    const started = performance.now();
    const tick = () => {
      const t = Math.min(1, (performance.now() - started) / 260);
      const scale = 1 + t * 3.8;
      s.scaling.setAll(scale);
      m.alpha = 0.85 * (1 - t);
      if (t >= 1) {
        this.glow?.removeIncludedOnlyMesh(s);
        s.dispose();
        m.dispose();
        return;
      }
      window.requestAnimationFrame(tick);
    };
    tick();
  }

  /**
   * Flashbang blind: a full white-out over the WHOLE screen for `ms`, then a
   * short fade. Deliberately a top-level <body> element with the maximum
   * z-index and inline styles — it does NOT live inside the HUD/#ui-root, so no
   * stacking context or CSS rule can let the 3D canvas paint over it (the bug
   * that made the old overlay invisible). Re-triggering just extends the timer.
   */
  private blindScreen(ms: number) {
    const dur = Math.max(300, ms);
    if (!this.blindEl) {
      const el = document.createElement("div");
      el.setAttribute("aria-hidden", "true");
      el.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;pointer-events:none;background:#ffffff;" +
        "display:flex;align-items:center;justify-content:center;opacity:0;" +
        "transition:none;will-change:opacity;";
      const label = document.createElement("div");
      label.textContent = "BLINDED";
      label.style.cssText =
        "font-family:ui-monospace,'Cascadia Code',monospace;font-weight:900;" +
        "font-size:clamp(22px,5vw,54px);letter-spacing:2px;color:rgba(6,14,22,0.55);";
      el.appendChild(label);
      document.body.appendChild(el);
      this.blindEl = el;
    }
    const el = this.blindEl;
    const start = performance.now();
    this.blindUntil = start + dur;
    const fadeMs = 450; // fade out over the last part of the blind
    if (this.blindRaf) cancelAnimationFrame(this.blindRaf);
    const tick = () => {
      const now = performance.now();
      const remaining = this.blindUntil - now;
      if (remaining <= 0) {
        el.style.opacity = "0";
        this.blindRaf = 0;
        return;
      }
      el.style.opacity = remaining > fadeMs ? "1" : String(Math.max(0, remaining / fadeMs));
      this.blindRaf = window.requestAnimationFrame(tick);
    };
    el.style.opacity = "1";
    this.blindRaf = window.requestAnimationFrame(tick);
  }

  // ---- server-driven effects ---------------------------------------------

  private registerServerEvents() {
    const room = this.room;
    room.onMessage(ServerMessage.ShotResult, (m: any) => {
      if (m.hit) {
        this.hud.setCrosshairHit(true, false);
        // Axe hits use one of two impact sounds at random; gun hits use "hit".
        this.audio.play(m.melee ? (Math.random() < 0.5 ? "axe1" : "axe2") : "hit");
        // A killing blow: confirm it straight from THIS direct result (always
        // arrives — same message as the hitmarker), so the killer can never miss
        // their own kill even if the broadcast feed hiccups.
        if (m.killed) {
          const players = (this.room.state as any).players;
          const victimName = players?.get?.(m.targetId)?.name || "a hider";
          const myName = players?.get?.(this.net.sessionId)?.name || "You";
          // The reliable path: this direct result always reaches the shooter,
          // so render the prominent kill banner right here — it can't be missed
          // even if the broadcast feed hiccups.
          this.hud.killEntry(myName, victimName, m.melee ? "axe" : "gun", true);
          this.audio.playOneOf(["death1", "death2"]);
        }
      } else if (m.decoy) {
        // Destroyed a decoy clone → ammo reward. Positive cue, no penalty. Tell
        // the shooter it was a fake so it doesn't feel like a "no-message kill".
        this.hud.setCrosshairHit(true, false);
        this.audio.play(m.melee ? (Math.random() < 0.5 ? "axe1" : "axe2") : "transform");
        this.hud.killfeed("Decoy destroyed");
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
      // Small corner feed line for everyone — kills ("X killed Y"), leaves
      // ("X left"), and notices. Only an actual kill plays a death sting.
      // Falls back to the older {killerName, victimName} payload so the feed
      // still works if the server hasn't been restarted yet.
      if (m.killerName && m.victimName) {
        // A real kill from someone else → the prominent CS-style banner.
        this.hud.killEntry(m.killerName, m.victimName, m.method === "axe" ? "axe" : "gun", false);
      } else if (m.leaverName) {
        // A player bailed mid-round → same prominent banner, framed as a self-out.
        this.hud.leaveEntry(m.leaverName);
      } else {
        // A system notice (rebuild) or an older server → plain corner line.
        const text = m.text ?? "";
        if (text) this.hud.killfeed(text);
      }
      const isKill = m.death ?? !!m.killerName;
      if (isKill) this.audio.playOneOf(["death1", "death2"]);
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
    room.onMessage(ServerMessage.Flashbang, (m: any) => {
      if (!m.ok) {
        if (typeof m.cooldownMs === "number") this.flashbangReadyAt = performance.now() + m.cooldownMs;
        this.hud.banner(m.reason || "Flash unavailable", 1200);
        this.audio.play("ui");
        return;
      }
      // Apply the outcome FIRST so a VFX/audio hiccup can never pre-empt the
      // blind — the blind is the whole point of the ability.
      if (m.blinded) {
        this.blindScreen(m.durationMs ?? FLASHBANG_BLIND_MS);
      } else {
        this.flashbangReadyAt = performance.now() + (m.cooldownMs ?? FLASHBANG_COOLDOWN_MS);
        this.hud.banner((m.affectedCount ?? 0) > 0 ? "Flashbang hit!" : "No seeker close enough", 1000);
      }
      // Cosmetic burst + spatial pop, isolated so any failure can't affect the blind.
      try {
        const pos = new Vector3(m.x ?? 0, m.y ?? 0, m.z ?? 0);
        this.spawnFlashbangBurst(pos);
        const { vol, pan } = this.spatialParams(pos.x, pos.y, pos.z, 12);
        this.audio.playSpatial("flash", Math.max(0.35, vol), pan);
      } catch {
        /* VFX/audio are non-essential — never let them block the blind */
      }
    });
    room.onMessage(ServerMessage.RoundEvent, (m: any) => {
      if (m.message) this.hud.banner(m.message, 2200);
      // Round stings only fire on an actual phase change — otherwise mid-phase
      // notices (a player leaving, a team reshuffle) would replay them.
      if (m.phase !== this.lastRoundEventPhase) {
        this.lastRoundEventPhase = m.phase;
        if (m.phase === Phase.Prep || m.phase === Phase.Hunt) this.audio.play("round_start");
        else if (m.phase === Phase.RoundEnd || m.phase === Phase.MatchEnd) this.audio.play("round_end");
      }
    });
  }

  dispose() {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("resize", this.onResize);
    document.removeEventListener("pointerlockchange", this.onLockChange);
    if (this.blindRaf) cancelAnimationFrame(this.blindRaf);
    this.blindEl?.remove();
    this.blindEl = null;
    this.input.dispose();
    this.engine.stopRenderLoop();
    this.scene.dispose();
    this.engine.dispose();
    // The engine is gone, so every cached material/texture in mapBuilder now
    // points at a dead WebGL context. Must be cleared or the NEXT match throws
    // on its first render. (Phase returns to Lobby between matches, which
    // disposes this scene, so this runs in normal play — not just on Leave.)
    resetMapCaches();
  }
}

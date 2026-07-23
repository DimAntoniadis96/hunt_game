import { UniversalCamera, Vector3, Scene, Mesh, MeshBuilder, Ray, AbstractMesh } from "@babylonjs/core";
import {
  GRAVITY,
  PLAYER_EYE_HEIGHT,
  PLAYER_JUMP_SPEED,
  PLAYER_RADIUS,
  PLAYER_WALK_SPEED,
  type InputPayload,
} from "@mimic/shared";

const HALF = PLAYER_EYE_HEIGHT / 2;
const DOWN = new Vector3(0, -1, 0);
/** How far below the feet we still count as "standing on a surface" (metres). */
const GROUND_PROBE = 0.3;
/** Max fall speed (m/s) so a long drop doesn't tunnel through geometry. */
const TERMINAL_VY = -32;

export type CameraMode = "fp" | "tp";

/**
 * Owns the first/third-person camera + an invisible collider capsule that does
 * Babylon's ellipsoid collisions (cameras can't moveWithCollisions). Hunters use
 * first-person (with a gun viewmodel); props use third-person so they can see
 * their disguise and how it fits amongst the real objects.
 */
export class InputController {
  readonly camera: UniversalCamera;
  private collider: Mesh;
  private scene: Scene;
  private canvas: HTMLCanvasElement;
  private keys = new Set<string>();
  private yaw = 0;
  private pitch = 0;
  private vy = 0;
  private grounded = true;
  private frozen = false; // blocks walking (WASD)
  private jumpAllowed = true; // decoupled: every alive player can hop
  private rotationLocked = false; // prop: freeze body facing (still can look/move)
  private lockedYaw = 0;
  /** Hard play-area clamp — a belt-and-suspenders guard against clipping the fence. */
  private bounds: { minX: number; maxX: number; minZ: number; maxZ: number } | null = null;
  private sensitivity = 0.0022;
  private mode: CameraMode = "fp";
  private tpDistance = 5.0;
  seq = 0;

  onJump?: () => void;

  constructor(scene: Scene, canvas: HTMLCanvasElement, spawn: { x: number; z: number; ry: number }) {
    this.canvas = canvas;
    this.scene = scene;

    this.collider = MeshBuilder.CreateCapsule("playerCollider", { radius: PLAYER_RADIUS, height: PLAYER_EYE_HEIGHT }, scene);
    this.collider.isVisible = false;
    this.collider.checkCollisions = true;
    this.collider.ellipsoid = new Vector3(PLAYER_RADIUS, HALF, PLAYER_RADIUS);
    this.collider.position.set(spawn.x, HALF, spawn.z);

    this.camera = new UniversalCamera("fps", new Vector3(spawn.x, PLAYER_EYE_HEIGHT, spawn.z), scene);
    this.camera.minZ = 0.1;
    this.camera.fov = 1.15;
    this.camera.inertia = 0;
    this.camera.speed = 0;
    this.camera.inputs.clear(); // we drive look/movement ourselves
    this.yaw = spawn.ry;

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    document.addEventListener("pointerlockchange", this.onLockChange);
    document.addEventListener("mousemove", this.onMouseMove);
    this.updateCamera();
  }

  dispose() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    document.removeEventListener("pointerlockchange", this.onLockChange);
    document.removeEventListener("mousemove", this.onMouseMove);
    this.collider.dispose();
  }

  get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  /**
   * The orientation the player's BODY faces (what other players see and what the
   * local prop model uses). When rotation is locked the body stays frozen while
   * the camera can still look around — so a disguised prop stops spinning with
   * the mouse and sits like a real object.
   */
  get bodyYaw(): number {
    return this.rotationLocked ? this.lockedYaw : this.yaw;
  }

  isRotationLocked(): boolean {
    return this.rotationLocked;
  }

  setRotationLocked(v: boolean) {
    if (v && !this.rotationLocked) this.lockedYaw = this.yaw; // freeze at current facing
    this.rotationLocked = v;
  }

  requestLock() {
    if (!this.locked) this.canvas.requestPointerLock();
  }

  setMode(mode: CameraMode) {
    if (this.mode !== mode) {
      this.mode = mode;
      this.updateCamera();
    }
  }

  setFrozen(v: boolean) {
    this.frozen = v;
  }

  /** Whether the player may jump (true for any alive player, even if frozen). */
  setJumpAllowed(v: boolean) {
    this.jumpAllowed = v;
  }

  /** Set the play-area bounds so the player can never leave the map. */
  setBounds(b: { minX: number; maxX: number; minZ: number; maxZ: number }) {
    this.bounds = b;
  }

  /** Feet position (y = 0 on the floor) — used to place the local player body. */
  getFeet(): { x: number; y: number; z: number } {
    return { x: this.collider.position.x, y: this.collider.position.y - HALF, z: this.collider.position.z };
  }

  teleport(x: number, y: number, z: number, ry?: number) {
    this.collider.position.set(x, Math.max(HALF, y + HALF), z);
    this.vy = 0;
    if (ry !== undefined) this.yaw = ry;
    this.updateCamera();
  }

  /** Gentle server reconciliation: snap only when clearly diverged (anti-cheat). */
  reconcile(sx: number, sy: number, sz: number) {
    const dx = this.collider.position.x - sx;
    const dz = this.collider.position.z - sz;
    if (Math.hypot(dx, dz) > 3.0) {
      this.collider.position.set(sx, Math.max(HALF, sy + HALF), sz);
      this.vy = 0;
      this.updateCamera();
    }
  }

  private onKeyDown = (e: KeyboardEvent) => this.keys.add(e.code);
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private onLockChange = () => {
    if (!this.locked) this.keys.clear();
  };
  private onMouseMove = (e: MouseEvent) => {
    if (!this.locked) return;
    this.yaw += e.movementX * this.sensitivity;
    this.pitch += e.movementY * this.sensitivity;
    const lim = Math.PI / 2 - 0.05;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  };

  /** Places the camera each frame according to the current mode. */
  private updateCamera() {
    const c = this.collider.position;
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    if (this.mode === "fp") {
      this.camera.position.set(c.x, c.y + HALF, c.z);
      this.camera.rotation.set(this.pitch, this.yaw, 0);
    } else {
      // Third-person: orbit behind the body, look at it.
      const anchor = new Vector3(c.x, c.y - HALF + 1.1, c.z);
      const cp = Math.cos(this.pitch);
      const dist = this.tpDistance;
      let camX = anchor.x - sy * cp * dist;
      let camZ = anchor.z - cy * cp * dist;
      let camY = anchor.y + Math.sin(this.pitch) * dist + 1.2;
      camY = Math.max(0.4, camY); // never dip under the floor
      this.camera.position.set(camX, camY, camZ);
      this.camera.setTarget(anchor);
    }
  }

  update(dt: number, speed = PLAYER_WALK_SPEED): boolean {
    // Rotation-locked = fully frozen in place, INCLUDING mid-air. A prop can jump
    // up against a wall/ledge, lock, and stay suspended there. Gravity + movement
    // are suspended; you can still orbit the camera to watch for hunters.
    if (this.rotationLocked) {
      this.vy = 0;
      this.updateCamera();
      return false;
    }

    // Movement is derived from yaw (independent of camera mode) so it feels the
    // same in first- and third-person.
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    const forward = new Vector3(sy, 0, cy);
    const right = new Vector3(cy, 0, -sy);

    let ix = 0;
    let iz = 0;
    if (!this.frozen) {
      if (this.keys.has("KeyW")) iz += 1;
      if (this.keys.has("KeyS")) iz -= 1;
      if (this.keys.has("KeyD")) ix += 1;
      if (this.keys.has("KeyA")) ix -= 1;
    }
    const moving = ix !== 0 || iz !== 0;

    const move = forward.scale(iz).add(right.scale(ix));
    if (move.lengthSquared() > 1) move.normalize();
    move.scaleInPlace(speed * dt);

    // Jump + gravity — available to every alive player, even a frozen hunter
    // during Prep (they can hop in place but not walk).
    if (this.jumpAllowed && this.keys.has("Space") && this.grounded) {
      this.vy = PLAYER_JUMP_SPEED;
      this.grounded = false;
      this.onJump?.();
    }
    this.vy += GRAVITY * dt;
    if (this.vy < TERMINAL_VY) this.vy = TERMINAL_VY;

    // Horizontal collide-and-slide (walls + prop sides) is done by the ellipsoid.
    this.collider.moveWithCollisions(new Vector3(move.x, this.vy * dt, move.z));

    // Ground detection by a short downward raycast so the player stands ON the
    // real surface beneath them — the floor OR the top of a prop — instead of
    // being snapped to floor level (which used to clip props into objects).
    const surfaceY = this.probeGround();
    if (this.vy <= 0 && surfaceY !== null) {
      this.collider.position.y = surfaceY + HALF; // feet exactly on the surface
      this.vy = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    // Safety net: never fall through the world floor.
    if (this.collider.position.y < HALF) {
      this.collider.position.y = HALF;
      this.vy = 0;
      this.grounded = true;
    }

    // Hard clamp to the play area — guarantees you can never tunnel out past a
    // (thin) fence and get stuck outside, regardless of collision hiccups.
    if (this.bounds) {
      this.collider.position.x = Math.max(this.bounds.minX + PLAYER_RADIUS, Math.min(this.bounds.maxX - PLAYER_RADIUS, this.collider.position.x));
      this.collider.position.z = Math.max(this.bounds.minZ + PLAYER_RADIUS, Math.min(this.bounds.maxZ - PLAYER_RADIUS, this.collider.position.z));
    }

    this.updateCamera();
    return moving;
  }

  /**
   * Casts a short ray straight down from the feet. Returns the Y of the nearest
   * collidable surface (floor/wall/prop) within reach, or null if airborne.
   */
  private probeGround(): number | null {
    const origin = new Vector3(this.collider.position.x, this.collider.position.y - HALF + 0.15, this.collider.position.z);
    const ray = new Ray(origin, DOWN, GROUND_PROBE);
    const pick = this.scene.pickWithRay(ray, (m: AbstractMesh) => m.checkCollisions && m !== this.collider && m.isPickable);
    return pick && pick.hit && pick.pickedPoint ? pick.pickedPoint.y : null;
  }

  snapshot(moving: boolean): InputPayload {
    this.seq++;
    return {
      x: this.collider.position.x,
      y: this.collider.position.y - HALF,
      z: this.collider.position.z,
      ry: this.bodyYaw, // send locked facing so others see the frozen disguise
      rp: this.pitch,
      moving,
      grounded: this.grounded,
      seq: this.seq,
    };
  }
}

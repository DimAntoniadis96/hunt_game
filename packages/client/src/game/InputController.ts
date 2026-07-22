import { UniversalCamera, Vector3, Scene, Mesh, MeshBuilder } from "@babylonjs/core";
import {
  GRAVITY,
  PLAYER_EYE_HEIGHT,
  PLAYER_JUMP_SPEED,
  PLAYER_RADIUS,
  PLAYER_WALK_SPEED,
  type InputPayload,
} from "@mimic/shared";

const HALF = PLAYER_EYE_HEIGHT / 2;

/**
 * Owns the first-person camera + an invisible collider capsule that actually
 * performs Babylon's ellipsoid collisions (cameras can't moveWithCollisions).
 * The camera is snapped to the collider each frame. Produces movement snapshots
 * the client sends to the authoritative server, which re-validates them.
 */
export class InputController {
  readonly camera: UniversalCamera;
  private collider: Mesh;
  private canvas: HTMLCanvasElement;
  private keys = new Set<string>();
  private yaw = 0;
  private pitch = 0;
  private vy = 0;
  private grounded = true;
  private frozen = false;
  private sensitivity = 0.0022;
  seq = 0;

  onJump?: () => void;

  constructor(scene: Scene, canvas: HTMLCanvasElement, spawn: { x: number; z: number; ry: number }) {
    this.canvas = canvas;

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
    this.applyRotation();

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    document.addEventListener("pointerlockchange", this.onLockChange);
    document.addEventListener("mousemove", this.onMouseMove);
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

  requestLock() {
    if (!this.locked) this.canvas.requestPointerLock();
  }

  setFrozen(v: boolean) {
    this.frozen = v;
    if (v) this.keys.clear();
  }

  teleport(x: number, y: number, z: number, ry?: number) {
    this.collider.position.set(x, Math.max(HALF, y + HALF), z);
    this.vy = 0;
    if (ry !== undefined) {
      this.yaw = ry;
      this.applyRotation();
    }
    this.syncCamera();
  }

  /** Gentle server reconciliation: snap only when clearly diverged (anti-cheat). */
  reconcile(sx: number, sy: number, sz: number) {
    const dx = this.collider.position.x - sx;
    const dz = this.collider.position.z - sz;
    if (Math.hypot(dx, dz) > 2.0) {
      this.collider.position.set(sx, Math.max(HALF, sy + HALF), sz);
      this.vy = 0;
      this.syncCamera();
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
    this.applyRotation();
  };

  private applyRotation() {
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  private syncCamera() {
    this.camera.position.set(this.collider.position.x, this.collider.position.y + HALF, this.collider.position.z);
  }

  update(dt: number, speed = PLAYER_WALK_SPEED): boolean {
    const forward = this.camera.getDirection(Vector3.Forward());
    forward.y = 0;
    forward.normalize();
    const right = this.camera.getDirection(Vector3.Right());
    right.y = 0;
    right.normalize();

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

    if (!this.frozen && this.keys.has("Space") && this.grounded) {
      this.vy = PLAYER_JUMP_SPEED;
      this.grounded = false;
      this.onJump?.();
    }
    this.vy += GRAVITY * dt;

    this.collider.moveWithCollisions(new Vector3(move.x, this.vy * dt, move.z));

    if (this.collider.position.y <= HALF) {
      this.collider.position.y = HALF;
      this.vy = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    this.syncCamera();
    return moving;
  }

  snapshot(moving: boolean): InputPayload {
    this.seq++;
    return {
      x: this.collider.position.x,
      y: this.collider.position.y - HALF, // feet height (0 = floor)
      z: this.collider.position.z,
      ry: this.yaw,
      rp: this.pitch,
      moving,
      grounded: this.grounded,
      seq: this.seq,
    };
  }
}

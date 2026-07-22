import {
  Scene,
  Vector3,
  Color3,
  Color4,
  MeshBuilder,
  StandardMaterial,
  Mesh,
  TransformNode,
  HemisphericLight,
  DirectionalLight,
} from "@babylonjs/core";
import { MapDefinition, PROP_MODELS } from "@mimic/shared";

const matCache = new Map<string, StandardMaterial>();

function mat(scene: Scene, hex: string, emissive = 0.08): StandardMaterial {
  const key = `${hex}:${emissive}`;
  const cached = matCache.get(key);
  if (cached) return cached;
  const m = new StandardMaterial(`mat_${key}`, scene);
  const c = Color3.FromHexString(hex);
  m.diffuseColor = c;
  m.emissiveColor = c.scale(emissive);
  m.specularColor = new Color3(0.15, 0.15, 0.15);
  matCache.set(key, m);
  return m;
}

/** Floor, walls, lights, ambient. Enables the built-in collision system. */
export function buildEnvironment(scene: Scene, map: MapDefinition): Mesh[] {
  scene.clearColor = new Color4(0.05, 0.07, 0.1, 1);
  scene.collisionsEnabled = true;
  scene.gravity = new Vector3(0, -0.6, 0);

  const hemi = new HemisphericLight("hemi", new Vector3(0.2, 1, 0.1), scene);
  hemi.intensity = 0.75;
  hemi.groundColor = new Color3(0.2, 0.22, 0.26);

  const dir = new DirectionalLight("dir", new Vector3(-0.5, -1, -0.3), scene);
  dir.position = new Vector3(20, 30, 20);
  dir.intensity = 0.6;

  const colliders: Mesh[] = [];

  const floor = MeshBuilder.CreateGround("floor", { width: map.width, height: map.depth }, scene);
  floor.material = mat(scene, "#2b3440", 0.02);
  floor.checkCollisions = true;
  colliders.push(floor);

  // Subtle floor grid for readability.
  const grid = MeshBuilder.CreateGround("grid", { width: map.width, height: map.depth, subdivisions: 1 }, scene);
  grid.position.y = 0.002;
  const gm = new StandardMaterial("gridMat", scene);
  gm.wireframe = true;
  gm.emissiveColor = new Color3(0.12, 0.16, 0.2);
  gm.alpha = 0.25;
  grid.material = gm;
  grid.isPickable = false;

  const half = map.wallHeight / 2;
  const wallMat = mat(scene, "#1c2530", 0.03);
  const walls: Array<[number, number, number, number]> = [
    // [x, z, width(x), depth(z)]
    [0, map.bounds.minZ, map.width, 0.5],
    [0, map.bounds.maxZ, map.width, 0.5],
    [map.bounds.minX, 0, 0.5, map.depth],
    [map.bounds.maxX, 0, 0.5, map.depth],
  ];
  for (const [x, z, w, d] of walls) {
    const wall = MeshBuilder.CreateBox("wall", { width: w, height: map.wallHeight, depth: d }, scene);
    wall.position.set(x, half, z);
    wall.material = wallMat;
    wall.checkCollisions = true;
    colliders.push(wall);
  }

  return colliders;
}

/** Build a visual for a prop model. Root origin sits on the floor (base y=0). */
export function createPropVisual(scene: Scene, modelKey: string, name: string): TransformNode {
  const model = PROP_MODELS[modelKey] ?? PROP_MODELS.crate_small;
  const root = new TransformNode(name, scene);
  const r = model.radius;
  const h = model.height;
  const material = mat(scene, model.color);

  const addMesh = (m: Mesh, y: number) => {
    m.parent = root;
    m.position.y = y;
    m.material = material;
    m.checkCollisions = false; // remote visuals; collisions handled per-context
    return m;
  };

  switch (modelKey) {
    case "barrel":
    case "bucket":
    case "bin":
    case "tire": {
      const cyl = MeshBuilder.CreateCylinder(name + "_c", { diameter: r * 2, height: h, tessellation: 16 }, scene);
      addMesh(cyl, h / 2);
      break;
    }
    case "traffic_cone": {
      const cone = MeshBuilder.CreateCylinder(name + "_c", { diameterTop: 0.02, diameterBottom: r * 2, height: h, tessellation: 14 }, scene);
      addMesh(cone, h / 2);
      const base = MeshBuilder.CreateBox(name + "_b", { width: r * 2.2, height: 0.06, depth: r * 2.2 }, scene);
      addMesh(base, 0.03);
      break;
    }
    case "plant": {
      const pot = MeshBuilder.CreateCylinder(name + "_p", { diameterTop: r * 1.8, diameterBottom: r * 1.4, height: h * 0.35, tessellation: 14 }, scene);
      addMesh(pot, h * 0.175);
      const foliage = MeshBuilder.CreateSphere(name + "_f", { diameter: r * 2.4, segments: 8 }, scene);
      const fol = addMesh(foliage, h * 0.7);
      fol.material = mat(scene, "#3f8f4f");
      break;
    }
    case "pallet_stack":
    case "toolbox":
    case "crate_small":
    case "crate_large":
    default: {
      const box = MeshBuilder.CreateBox(name + "_x", { width: r * 2, height: h, depth: r * 2 }, scene);
      addMesh(box, h / 2);
      break;
    }
  }
  return root;
}

/** A simple stylized humanoid for hunters / undisguised players. */
export function createHunterVisual(scene: Scene, name: string, hex = "#ff7043"): TransformNode {
  const root = new TransformNode(name, scene);
  const body = MeshBuilder.CreateCapsule(name + "_body", { radius: 0.35, height: 1.7 }, scene);
  body.parent = root;
  body.position.y = 0.85;
  body.material = mat(scene, hex, 0.12);
  const head = MeshBuilder.CreateSphere(name + "_head", { diameter: 0.42, segments: 10 }, scene);
  head.parent = root;
  head.position.y = 1.55;
  head.material = mat(scene, "#f2c9a0", 0.1);
  // A small "muzzle" nub so you can read facing direction.
  const gun = MeshBuilder.CreateBox(name + "_gun", { width: 0.12, height: 0.12, depth: 0.6 }, scene);
  gun.parent = root;
  gun.position.set(0.25, 1.15, 0.4);
  gun.material = mat(scene, "#20262e", 0.05);
  return root;
}

export function buildStaticProps(scene: Scene, map: MapDefinition): void {
  for (const spawn of map.props) {
    const node = createPropVisual(scene, spawn.modelKey, `static_${spawn.id}`);
    node.position.set(spawn.x, 0, spawn.z);
    node.rotation.y = spawn.ry;
    // Give static furniture collisions so players can't walk through them.
    node.getChildMeshes().forEach((m) => (m.checkCollisions = true));
  }
}

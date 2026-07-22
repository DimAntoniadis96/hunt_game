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

function mat(scene: Scene, hex: string, emissive = 0.16): StandardMaterial {
  const key = `${hex}:${emissive}`;
  const cached = matCache.get(key);
  if (cached) return cached;
  const m = new StandardMaterial(`mat_${key}`, scene);
  const c = Color3.FromHexString(hex);
  m.diffuseColor = c;
  m.emissiveColor = c.scale(emissive);
  m.ambientColor = c;
  m.specularColor = new Color3(0.12, 0.12, 0.12);
  matCache.set(key, m);
  return m;
}

/** Dispatch to the right environment for the map's theme. Enables collisions. */
export function buildEnvironment(scene: Scene, map: MapDefinition): Mesh[] {
  scene.collisionsEnabled = true;
  scene.gravity = new Vector3(0, -0.6, 0);
  return map.theme === "backyard" ? buildBackyard(scene, map) : buildWarehouse(scene, map);
}

// ---------------------------------------------------------------------------
// Warehouse (Depot 7)
// ---------------------------------------------------------------------------

function buildWarehouse(scene: Scene, map: MapDefinition): Mesh[] {
  scene.clearColor = new Color4(0.09, 0.11, 0.15, 1);
  scene.ambientColor = new Color3(0.35, 0.37, 0.42);
  scene.fogMode = Scene.FOGMODE_NONE;

  const hemi = new HemisphericLight("hemi", new Vector3(0.2, 1, 0.1), scene);
  hemi.intensity = 1.15;
  hemi.groundColor = new Color3(0.32, 0.34, 0.4);
  const dir = new DirectionalLight("dir", new Vector3(-0.5, -1, -0.3), scene);
  dir.position = new Vector3(20, 30, 20);
  dir.intensity = 0.9;

  const colliders: Mesh[] = [];
  const floor = MeshBuilder.CreateGround("floor", { width: map.width, height: map.depth }, scene);
  floor.material = mat(scene, "#3a4655", 0.05);
  floor.checkCollisions = true;
  colliders.push(floor);

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

// ---------------------------------------------------------------------------
// Backyard (Sunnyside Yard)
// ---------------------------------------------------------------------------

function buildBackyard(scene: Scene, map: MapDefinition): Mesh[] {
  scene.clearColor = new Color4(0.51, 0.76, 0.92, 1); // sky blue
  scene.ambientColor = new Color3(0.42, 0.44, 0.42);
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogColor = new Color3(0.62, 0.78, 0.9);
  scene.fogDensity = 0.004;

  const sky = new HemisphericLight("sky", new Vector3(0.3, 1, 0.2), scene);
  sky.intensity = 0.88;
  sky.diffuse = new Color3(1, 1, 1);
  sky.groundColor = new Color3(0.3, 0.38, 0.26);
  const sun = new DirectionalLight("sun", new Vector3(-0.5, -1.05, -0.35), scene);
  sun.position = new Vector3(30, 45, 25);
  sun.intensity = 0.95;
  sun.diffuse = new Color3(1, 0.97, 0.88);

  const colliders: Mesh[] = [];

  // Distant horizon grass (non-collidable, hides the map edge under the fog).
  const far = MeshBuilder.CreateGround("far", { width: 300, height: 300 }, scene);
  far.position.y = -0.06;
  far.material = mat(scene, "#3f7d2e", 0.06);
  far.isPickable = false;

  // Playable lawn (collidable + pickable so the ground probe works).
  const lawn = MeshBuilder.CreateGround("lawn", { width: map.width + 4, height: map.depth + 4 }, scene);
  lawn.material = mat(scene, "#4f9e3a", 0.07);
  lawn.checkCollisions = true;
  colliders.push(lawn);

  // Decorative (non-collidable, flush) patio + path so they don't disturb the probe.
  const patio = MeshBuilder.CreateGround("patio", { width: 20, height: 8 }, scene);
  patio.position.set(0, 0.02, 13.5);
  patio.material = mat(scene, "#9a927f", 0.05);
  patio.isPickable = false;
  const path = MeshBuilder.CreateGround("path", { width: 3.2, height: 24 }, scene);
  path.position.set(0, 0.02, 0);
  path.material = mat(scene, "#b0a892", 0.05);
  path.isPickable = false;

  // Wooden fence around the perimeter (posts + panels).
  const fenceMat = mat(scene, "#8a6a3f", 0.08);
  const postMat = mat(scene, "#6f5330", 0.08);
  const fenceH = 1.9;
  const edges: Array<[number, number, number, number]> = [
    [0, map.bounds.minZ, map.width, 0.18], // south
    [map.bounds.minX, 0, 0.18, map.depth], // west
    [map.bounds.maxX, 0, 0.18, map.depth], // east
  ];
  for (const [x, z, w, d] of edges) {
    const panel = MeshBuilder.CreateBox("fence", { width: w, height: fenceH, depth: d }, scene);
    panel.position.set(x, fenceH / 2, z);
    panel.material = fenceMat;
    panel.checkCollisions = true;
    colliders.push(panel);
  }
  // Fence posts for detail along south + sides.
  for (let x = map.bounds.minX; x <= map.bounds.maxX; x += 3) {
    for (const z of [map.bounds.minZ]) {
      const post = MeshBuilder.CreateBox("post", { width: 0.28, height: fenceH + 0.25, depth: 0.28 }, scene);
      post.position.set(x, (fenceH + 0.25) / 2, z);
      post.material = postMat;
      post.isPickable = false;
    }
  }

  // The house on the north edge: facade + roof + door + windows.
  const houseZ = map.bounds.maxZ + 1.6;
  const houseW = 30;
  const houseH = 6;
  const houseD = 5;
  const house = MeshBuilder.CreateBox("house", { width: houseW, height: houseH, depth: houseD }, scene);
  house.position.set(0, houseH / 2, houseZ);
  house.material = mat(scene, "#d9cbb2", 0.12);
  house.checkCollisions = true;
  colliders.push(house);
  // Flat roof slab with a small overhang + a chimney (reliable, clean silhouette).
  const roof = MeshBuilder.CreateBox("roof", { width: houseW + 1.2, height: 0.7, depth: houseD + 1.2 }, scene);
  roof.position.set(0, houseH + 0.35, houseZ);
  roof.material = mat(scene, "#5f4636", 0.06);
  roof.isPickable = false;
  const chimney = MeshBuilder.CreateBox("chimney", { width: 1.1, height: 1.8, depth: 1.1 }, scene);
  chimney.position.set(houseW * 0.32, houseH + 1.2, houseZ);
  chimney.material = mat(scene, "#8a5a44", 0.06);
  chimney.isPickable = false;
  const front = houseZ - houseD / 2 - 0.01;
  const door = MeshBuilder.CreateBox("door", { width: 1.5, height: 2.6, depth: 0.1 }, scene);
  door.position.set(0, 1.3, front);
  door.material = mat(scene, "#5b3b22", 0.08);
  door.isPickable = false;
  for (const wx of [-9, -5, 5, 9]) {
    const win = MeshBuilder.CreateBox("win", { width: 1.6, height: 1.6, depth: 0.1 }, scene);
    win.position.set(wx, 3.3, front);
    win.material = mat(scene, "#8fd3e8", 0.35);
    win.isPickable = false;
  }

  // A little shed in the south-west corner.
  const shed = MeshBuilder.CreateBox("shed", { width: 4.5, height: 2.8, depth: 4 }, scene);
  shed.position.set(-17.5, 1.4, -16);
  shed.material = mat(scene, "#9c7b4e", 0.1);
  shed.checkCollisions = true;
  colliders.push(shed);
  const shedRoof = MeshBuilder.CreateCylinder("shedRoof", { diameterTop: 0, diameterBottom: 6.4, height: 1.6, tessellation: 4 }, scene);
  shedRoof.rotation.y = Math.PI / 4;
  shedRoof.position.set(-17.5, 3.4, -16);
  shedRoof.material = mat(scene, "#7a3b2e", 0.1);
  shedRoof.isPickable = false;

  // Trees (trunk collides; foliage is decorative).
  for (const [tx, tz] of [
    [18, 15],
    [-19, 13],
    [15, -17],
  ] as Array<[number, number]>) {
    const trunk = MeshBuilder.CreateCylinder("trunk", { diameterTop: 0.5, diameterBottom: 0.7, height: 3, tessellation: 8 }, scene);
    trunk.position.set(tx, 1.5, tz);
    trunk.material = mat(scene, "#6b4a2a", 0.06);
    trunk.checkCollisions = true;
    colliders.push(trunk);
    for (const [ox, oy, oz, d] of [
      [0, 3.6, 0, 3.4],
      [1.1, 3.2, 0.4, 2.6],
      [-0.9, 3.3, -0.5, 2.6],
      [0.2, 4.4, 0.2, 2.4],
    ] as Array<[number, number, number, number]>) {
      const leaf = MeshBuilder.CreateSphere("leaf", { diameter: d, segments: 8 }, scene);
      leaf.position.set(tx + ox, oy, tz + oz);
      leaf.material = mat(scene, "#3f7d34", 0.1);
      leaf.isPickable = false;
    }
  }

  // A warm sun disc in the sky (decorative).
  const sunDisc = MeshBuilder.CreateSphere("sunDisc", { diameter: 6, segments: 12 }, scene);
  sunDisc.position.set(40, 55, 40);
  const sm = new StandardMaterial("sunMat", scene);
  sm.emissiveColor = new Color3(1, 0.93, 0.7);
  sm.disableLighting = true;
  sunDisc.material = sm;
  sunDisc.isPickable = false;

  return colliders;
}

// ---------------------------------------------------------------------------
// Prop + player visuals
// ---------------------------------------------------------------------------

/** Build a visual for a prop model. Root origin sits on the floor (base y=0). */
export function createPropVisual(scene: Scene, modelKey: string, name: string): TransformNode {
  const model = PROP_MODELS[modelKey] ?? PROP_MODELS.crate_small;
  const root = new TransformNode(name, scene);
  const r = model.radius;
  const h = model.height;
  const material = mat(scene, model.color);

  const add = (m: Mesh, y: number, x = 0, z = 0) => {
    m.parent = root;
    m.position.set(x, y, z);
    m.material = material;
    m.checkCollisions = false;
    return m;
  };

  switch (modelKey) {
    case "barrel":
    case "bucket":
    case "bin":
    case "tire": {
      add(MeshBuilder.CreateCylinder(name + "_c", { diameter: r * 2, height: h, tessellation: 16 }, scene), h / 2);
      break;
    }
    case "traffic_cone": {
      add(MeshBuilder.CreateCylinder(name + "_c", { diameterTop: 0.02, diameterBottom: r * 2, height: h, tessellation: 14 }, scene), h / 2);
      add(MeshBuilder.CreateBox(name + "_b", { width: r * 2.2, height: 0.06, depth: r * 2.2 }, scene), 0.03);
      break;
    }
    case "plant": {
      add(MeshBuilder.CreateCylinder(name + "_p", { diameterTop: r * 1.8, diameterBottom: r * 1.4, height: h * 0.35, tessellation: 14 }, scene), h * 0.175);
      add(MeshBuilder.CreateSphere(name + "_f", { diameter: r * 2.4, segments: 8 }, scene), h * 0.7).material = mat(scene, "#3f8f4f");
      break;
    }
    case "bush": {
      for (const [x, y, z, d] of [
        [0, 0.45, 0, r * 2],
        [0.35, 0.5, 0.2, r * 1.4],
        [-0.3, 0.5, -0.2, r * 1.4],
        [0.1, 0.78, 0.1, r * 1.2],
      ] as Array<[number, number, number, number]>) {
        add(MeshBuilder.CreateSphere(name + "_b", { diameter: d, segments: 8 }, scene), y, x, z);
      }
      break;
    }
    case "rock": {
      const s = add(MeshBuilder.CreateSphere(name + "_r", { diameter: r * 2, segments: 6 }, scene), r * 0.5);
      s.scaling.set(1, 0.7, 0.85);
      break;
    }
    case "trash_can": {
      add(MeshBuilder.CreateCylinder(name + "_c", { diameterTop: r * 1.9, diameterBottom: r * 2, height: h * 0.9, tessellation: 14 }, scene), h * 0.45);
      add(MeshBuilder.CreateCylinder(name + "_l", { diameter: r * 2.15, height: h * 0.12, tessellation: 14 }, scene), h * 0.92);
      break;
    }
    case "mailbox": {
      add(MeshBuilder.CreateBox(name + "_p", { width: 0.12, height: h * 0.75, depth: 0.12 }, scene), h * 0.38);
      add(MeshBuilder.CreateBox(name + "_m", { width: r * 1.8, height: 0.34, depth: 0.55 }, scene), h * 0.88);
      break;
    }
    case "fire_hydrant": {
      add(MeshBuilder.CreateCylinder(name + "_b", { diameter: r * 1.6, height: h * 0.7, tessellation: 12 }, scene), h * 0.38);
      add(MeshBuilder.CreateSphere(name + "_d", { diameter: r * 1.6, segments: 10 }, scene), h * 0.78);
      const capL = add(MeshBuilder.CreateCylinder(name + "_cl", { diameter: r * 0.7, height: 0.18, tessellation: 8 }, scene), h * 0.45, r * 0.75);
      capL.rotation.z = Math.PI / 2;
      const capR = add(MeshBuilder.CreateCylinder(name + "_cr", { diameter: r * 0.7, height: 0.18, tessellation: 8 }, scene), h * 0.45, -r * 0.75);
      capR.rotation.z = Math.PI / 2;
      break;
    }
    case "propane_tank": {
      add(MeshBuilder.CreateCylinder(name + "_b", { diameter: r * 2, height: h * 0.78, tessellation: 14 }, scene), h * 0.45);
      add(MeshBuilder.CreateSphere(name + "_t", { diameter: r * 2, segments: 10 }, scene), h * 0.8).scaling.y = 0.5;
      break;
    }
    case "cooler": {
      add(MeshBuilder.CreateBox(name + "_b", { width: r * 2, height: h * 0.7, depth: r * 1.3 }, scene), h * 0.35);
      add(MeshBuilder.CreateBox(name + "_l", { width: r * 2.05, height: h * 0.22, depth: r * 1.35 }, scene), h * 0.8).material = mat(scene, "#5dade2");
      break;
    }
    case "flower_pot": {
      add(MeshBuilder.CreateCylinder(name + "_p", { diameterTop: r * 2, diameterBottom: r * 1.5, height: h * 0.6, tessellation: 12 }, scene), h * 0.3);
      for (const [x, z, c] of [
        [0.12, 0, "#e74c3c"],
        [-0.12, 0.1, "#f1c40f"],
        [0, -0.12, "#e84393"],
      ] as Array<[number, number, string]>) {
        add(MeshBuilder.CreateSphere(name + "_fl", { diameter: r * 0.75, segments: 6 }, scene), h * 0.78, x, z).material = mat(scene, c);
      }
      break;
    }
    case "garden_gnome": {
      add(MeshBuilder.CreateCylinder(name + "_r", { diameterTop: r * 0.7, diameterBottom: r * 1.7, height: h * 0.55, tessellation: 10 }, scene), h * 0.28);
      add(MeshBuilder.CreateSphere(name + "_f", { diameter: r * 1.1, segments: 8 }, scene), h * 0.62).material = mat(scene, "#f2c9a0");
      add(MeshBuilder.CreateCylinder(name + "_h", { diameterTop: 0, diameterBottom: r * 1.2, height: h * 0.42, tessellation: 10 }, scene), h * 0.88).material = mat(scene, "#c0392b");
      break;
    }
    case "bench": {
      add(MeshBuilder.CreateBox(name + "_s", { width: r * 2, height: 0.12, depth: 0.5 }, scene), h * 0.5);
      add(MeshBuilder.CreateBox(name + "_bk", { width: r * 2, height: h * 0.45, depth: 0.1 }, scene), h * 0.72, 0, -0.22);
      for (const x of [-r * 0.8, r * 0.8]) {
        for (const z of [-0.18, 0.18]) {
          add(MeshBuilder.CreateBox(name + "_lg", { width: 0.1, height: h * 0.5, depth: 0.1 }, scene), h * 0.25, x, z);
        }
      }
      break;
    }
    case "dog_house": {
      add(MeshBuilder.CreateBox(name + "_b", { width: r * 2, height: h * 0.6, depth: r * 2 }, scene), h * 0.3);
      add(MeshBuilder.CreateCylinder(name + "_rf", { diameterTop: 0, diameterBottom: r * 2.9, height: h * 0.55, tessellation: 4 }, scene), h * 0.85).rotation.y = Math.PI / 4;
      add(MeshBuilder.CreateBox(name + "_ho", { width: r * 0.85, height: h * 0.42, depth: 0.12 }, scene), h * 0.23, 0, r).material = mat(scene, "#20140a");
      break;
    }
    case "bird_bath": {
      add(MeshBuilder.CreateCylinder(name + "_pd", { diameterTop: r * 0.8, diameterBottom: r * 1.2, height: h * 0.7, tessellation: 12 }, scene), h * 0.35);
      add(MeshBuilder.CreateCylinder(name + "_bs", { diameterTop: r * 2, diameterBottom: r * 1.2, height: h * 0.2, tessellation: 14 }, scene), h * 0.8);
      add(MeshBuilder.CreateCylinder(name + "_w", { diameter: r * 1.7, height: 0.04, tessellation: 14 }, scene), h * 0.85).material = mat(scene, "#3a7ca5");
      break;
    }
    case "ac_unit": {
      add(MeshBuilder.CreateBox(name + "_b", { width: r * 2, height: h, depth: r * 1.6 }, scene), h * 0.5);
      const fan = add(MeshBuilder.CreateCylinder(name + "_fn", { diameter: r * 1.4, height: 0.06, tessellation: 16 }, scene), h * 0.5, 0, r * 0.82);
      fan.rotation.x = Math.PI / 2;
      fan.material = mat(scene, "#3a3f45");
      break;
    }
    case "planter": {
      add(MeshBuilder.CreateBox(name + "_b", { width: r * 2, height: h * 0.7, depth: r * 1.2 }, scene), h * 0.35);
      for (const x of [-r * 0.7, 0, r * 0.7]) {
        add(MeshBuilder.CreateSphere(name + "_f", { diameter: r * 0.95, segments: 6 }, scene), h * 0.85, x).material = mat(scene, "#4a7c3a");
      }
      break;
    }
    case "pallet_stack":
    case "toolbox":
    case "crate_small":
    case "crate_large":
    default: {
      add(MeshBuilder.CreateBox(name + "_x", { width: r * 2, height: h, depth: r * 2 }, scene), h / 2);
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
    node.getChildMeshes().forEach((m) => (m.checkCollisions = true));
  }
}

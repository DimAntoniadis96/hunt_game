import {
  Scene,
  Vector3,
  Color3,
  Color4,
  MeshBuilder,
  StandardMaterial,
  DynamicTexture,
  Texture,
  Mesh,
  TransformNode,
  HemisphericLight,
  DirectionalLight,
} from "@babylonjs/core";
import { BACKYARD_HEDGES, CEMETERY_BLOCKS, CEMETERY_FLOORS, CEMETERY_TREES, PROP_MODELS, type MapDefinition, type Occluder } from "@mimic/shared";

const matCache = new Map<string, StandardMaterial>();

/**
 * Drop every cached material/texture.
 *
 * These caches are module-scoped so one map build can share ~100 materials
 * across ~500 meshes. But a cached material belongs to the Scene (and the WebGL
 * context) it was created in, and `GameScene.dispose()` tears down BOTH the
 * scene and the engine. If the caches survived that, the next match would hand
 * out materials whose compiled shader program belongs to a destroyed context —
 * which throws "Cannot read properties of null (reading 'program')" inside
 * Engine.bindSamplers the first time the new scene renders.
 *
 * Must be called whenever the scene that populated these caches is disposed.
 */
export function resetMapCaches(): void {
  matCache.clear();
  texCache.clear();
  texMatCache.clear();
}

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

// ---- Lightweight procedural textures --------------------------------------
// Painted once into a tiny 256² canvas on the CPU, then tiled across surfaces
// via uScale/vScale. No image downloads, a handful of small textures per map —
// cheap, but it kills the flat, washed-out look of the plain-colour floors.
// The bitmaps are grayscale (centred near white) and the material's diffuseColor
// tints them, so one texture serves every colour of that surface type.
type TexKind = "concrete" | "grass" | "grain" | "sand";
const texCache = new Map<string, DynamicTexture>();

function makeTex(scene: Scene, kind: TexKind, uScale: number, vScale: number): DynamicTexture {
  const key = `${kind}:${uScale.toFixed(2)}:${vScale.toFixed(2)}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  const S = 256;
  const t = new DynamicTexture(`tex_${key}`, { width: S, height: S }, scene, true);
  const ctx = t.getContext() as unknown as CanvasRenderingContext2D;
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const put = (i: number, v: number) => {
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  };
  const blotch = (n: number, alpha: number, maxR: number) => {
    for (let b = 0; b < n; b++) {
      const x = Math.random() * S;
      const y = Math.random() * S;
      const r = 6 + Math.random() * maxR;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(0,0,0,${alpha})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  if (kind === "grain") {
    // Very subtle near-white speckle — scale-tolerant, safe on any box face.
    for (let i = 0; i < d.length; i += 4) put(i, 224 + ((Math.random() * 31) | 0));
    ctx.putImageData(img, 0, 0);
  } else if (kind === "sand") {
    for (let i = 0; i < d.length; i += 4) put(i, 206 + ((Math.random() * 49) | 0));
    ctx.putImageData(img, 0, 0);
    blotch(18, 0.05, 22);
  } else if (kind === "grass") {
    // Coarser mottle + darker clumps so the lawn reads as grass, not felt.
    for (let i = 0; i < d.length; i += 4) put(i, 150 + ((Math.random() * 105) | 0));
    ctx.putImageData(img, 0, 0);
    blotch(44, 0.14, 20);
  } else {
    // concrete: mottled grey, soft dark blotches, and a faint slab seam at the
    // tile edge so repeated tiles read as poured concrete panels.
    for (let i = 0; i < d.length; i += 4) put(i, 205 + ((Math.random() * 50) | 0));
    ctx.putImageData(img, 0, 0);
    blotch(24, 0.06, 26);
    ctx.strokeStyle = "rgba(0,0,0,0.20)";
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, S - 3, S - 3);
  }

  t.update(false);
  t.wrapU = Texture.WRAP_ADDRESSMODE;
  t.wrapV = Texture.WRAP_ADDRESSMODE;
  t.uScale = uScale;
  t.vScale = vScale;
  texCache.set(key, t);
  return t;
}

const texMatCache = new Map<string, StandardMaterial>();

/** A `mat()`-style material whose colour is modulated by a tiled procedural
 * texture. `uScale/vScale` control how many times the bitmap repeats. */
function texMat(scene: Scene, hex: string, kind: TexKind, uScale: number, vScale: number, emissive = 0.1, zoff = 0): StandardMaterial {
  const key = `${hex}:${kind}:${uScale.toFixed(2)}:${vScale.toFixed(2)}:${emissive}:${zoff}`;
  const hit = texMatCache.get(key);
  if (hit) return hit;
  const m = new StandardMaterial(`tm_${key}`, scene);
  const c = Color3.FromHexString(hex);
  m.diffuseColor = c; // tints the grayscale bitmap
  m.diffuseTexture = makeTex(scene, kind, uScale, vScale);
  m.emissiveColor = c.scale(emissive);
  m.ambientColor = c;
  m.specularColor = new Color3(0.1, 0.1, 0.1);
  // Depth bias for flush ground decals: a negative zOffset pulls the polygon
  // slightly toward the camera in the depth buffer so it wins over the lawn
  // *without* being physically raised — which is what used to cut through the
  // bottoms of props standing on it and cause the shimmering Z-fight.
  m.zOffset = zoff;
  texMatCache.set(key, m);
  return m;
}

/** Grain material for static structural items (walls, boxes, cylinders). Fixed
 * subtle tiling so the speckle looks consistent regardless of the mesh size. */
const grainMat = (scene: Scene, hex: string, em = 0.09) => texMat(scene, hex, "grain", 3, 3, em);

/** Dispatch to the right environment for the map's theme. Enables collisions. */
export function buildEnvironment(scene: Scene, map: MapDefinition): Mesh[] {
  scene.collisionsEnabled = true;
  scene.gravity = new Vector3(0, -0.6, 0);
  if (map.theme === "cemetery") return buildCemetery(scene, map);
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
  // Poured-concrete slab: a tiled panel every ~4 m so the floor no longer reads
  // as a single flat plane.
  floor.material = texMat(scene, "#3a4655", "concrete", map.width / 4, map.depth / 4, 0.05);
  floor.checkCollisions = true;
  colliders.push(floor);

  // (The old wireframe grid overlay was removed: the concrete texture already
  // draws panel seams, and a separate plane hovering above the floor only added
  // Z-fighting with props standing on it.)

  const half = map.wallHeight / 2;
  const wallMat = grainMat(scene, "#1c2530", 0.03);
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
// Backyard (Sunnyside Yard) — big, zoned suburban yard
// ---------------------------------------------------------------------------

function buildBackyard(scene: Scene, map: MapDefinition): Mesh[] {
  scene.clearColor = new Color4(0.51, 0.76, 0.92, 1);
  scene.ambientColor = new Color3(0.42, 0.44, 0.42);
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogColor = new Color3(0.62, 0.78, 0.9);
  scene.fogDensity = 0.0032;

  const sky = new HemisphericLight("sky", new Vector3(0.3, 1, 0.2), scene);
  sky.intensity = 0.9;
  sky.diffuse = new Color3(1, 1, 1);
  sky.groundColor = new Color3(0.3, 0.38, 0.26);
  const sun = new DirectionalLight("sun", new Vector3(-0.5, -1.05, -0.35), scene);
  sun.position = new Vector3(40, 60, 30);
  sun.intensity = 0.95;
  sun.diffuse = new Color3(1, 0.97, 0.88);

  const colliders: Mesh[] = [];
  const { minX, maxX, minZ, maxZ } = map.bounds;
  const w = maxX - minX;
  const d = maxZ - minZ;
  const cz = (minZ + maxZ) / 2;

  // Local mesh helpers. `solid=true` => collidable + pickable (walkable/blocking).
  const box = (name: string, W: number, H: number, D: number, x: number, y: number, z: number, hex: string, solid = false, em = 0.09) => {
    const m = MeshBuilder.CreateBox(name, { width: W, height: H, depth: D }, scene);
    m.position.set(x, y, z);
    m.material = grainMat(scene, hex, em); // subtle grain on static structures
    m.checkCollisions = solid;
    m.isPickable = solid;
    if (solid) colliders.push(m);
    return m;
  };
  const cyl = (name: string, dia: number, H: number, x: number, y: number, z: number, hex: string, solid = false, tess = 12, em = 0.09) => {
    const m = MeshBuilder.CreateCylinder(name, { diameter: dia, height: H, tessellation: tess }, scene);
    m.position.set(x, y, z);
    m.material = grainMat(scene, hex, em);
    m.checkCollisions = solid;
    m.isPickable = solid;
    if (solid) colliders.push(m);
    return m;
  };
  // Flush ground decals (driveway, path, sand …). They sit dead flat on the lawn
  // (y≈0) and win the depth test via a negative zOffset instead of being raised,
  // so props standing on them are no longer sliced by a raised plane. `zPri`
  // orders overlapping decals (more-negative draws in front). `kind` picks the
  // surface look; tiling is derived from the patch size for a constant grain.
  const flat = (name: string, W: number, D: number, x: number, z: number, hex: string, kind: TexKind = "concrete", zPri = -2) => {
    const g = MeshBuilder.CreateGround(name, { width: W, height: D }, scene);
    g.position.set(x, 0.001, z);
    const tile = kind === "grass" ? 4 : kind === "sand" ? 3 : 4;
    g.material = texMat(scene, hex, kind, Math.max(1, W / tile), Math.max(1, D / tile), 0.05, zPri);
    g.isPickable = false;
    return g;
  };

  // Horizon + lawn.
  const far = MeshBuilder.CreateGround("far", { width: 400, height: 400 }, scene);
  far.position.y = -0.06;
  far.material = texMat(scene, "#3f7d2e", "grass", 50, 50, 0.06);
  far.isPickable = false;
  const lawn = MeshBuilder.CreateGround("lawn", { width: w + 8, height: d + 8 }, scene);
  lawn.position.set((minX + maxX) / 2, 0, cz);
  lawn.material = texMat(scene, "#4f9e3a", "grass", (w + 8) / 4, (d + 8) / 4, 0.07);
  lawn.checkCollisions = true;
  colliders.push(lawn);

  // Ground textures (flush, decorative). The path crosses the driveway/patio, so
  // it gets a more-forward zPriority to layer cleanly over them.
  flat("driveway", 34, 12, 0, minZ + 6, "#8f8a82", "concrete", -2);
  flat("path", 3.4, 46, 0, cz - 4, "#9a9184", "concrete", -3);
  flat("patio", 26, 10, 4, 24, "#9a927f", "concrete", -2);
  flat("gardenBedW", 12, 12, -30, 1, "#6b4a2e", "sand", -2);
  flat("gardenBedNE", 10, 10, 30, 15, "#6b4a2e", "sand", -2);

  // Full perimeter fence. The wall slabs are pushed OUTWARD by half their
  // thickness so each inner face sits exactly on the bounds line (minX/maxX/…).
  // That makes the collision stop (bound + player radius) line up perfectly with
  // the server/client hard clamp (also bound + player radius) — so a player who
  // walks into the wall stops cleanly instead of being clamped to one spot and
  // then ejected to another (the "stuck / drops me back" rubber-band). Spans are
  // extended by fenceT so the corners still overlap.
  const fenceH = 1.9;
  const fenceMat = "#8a6a3f";
  const postMat = "#6f5330";
  const fenceT = 0.6; // thick enough that fast movement can't tunnel through it
  const ht = fenceT / 2;
  const edges: Array<[number, number, number, number]> = [
    [(minX + maxX) / 2, minZ - ht, w + fenceT, fenceT], // south
    [(minX + maxX) / 2, maxZ + ht, w + fenceT, fenceT], // north
    [minX - ht, cz, fenceT, d + fenceT], // west
    [maxX + ht, cz, fenceT, d + fenceT], // east
  ];
  for (const [x, z, W, D] of edges) box("fence", W, fenceH, D, x, fenceH / 2, z, fenceMat, true, 0.08);
  const postH = fenceH + 0.25;
  for (let x = minX; x <= maxX; x += 4) {
    box("post", 0.28, postH, 0.28, x, postH / 2, minZ - ht, postMat, false, 0.08);
    box("post", 0.28, postH, 0.28, x, postH / 2, maxZ + ht, postMat, false, 0.08);
  }
  for (let z = minZ; z <= maxZ; z += 4) {
    box("post", 0.28, postH, 0.28, minX - ht, postH / 2, z, postMat, false, 0.08);
    box("post", 0.28, postH, 0.28, maxX + ht, postH / 2, z, postMat, false, 0.08);
  }

  // ---- House (north) ----
  const houseW = 40, houseH = 6.5, houseD = 7, houseZ = maxZ - 0.5;
  box("house", houseW, houseH, houseD, 0, houseH / 2, houseZ, "#d9cbb2", true, 0.12);
  box("roof", houseW + 1.2, 0.7, houseD + 1.2, 0, houseH + 0.35, houseZ, "#5f4636", false, 0.06);
  box("chimney", 1.1, 1.8, 1.1, houseW * 0.32, houseH + 1.2, houseZ, "#8a5a44", false, 0.06);
  const hFront = houseZ - houseD / 2 - 0.01;
  box("door", 1.6, 2.7, 0.1, 0, 1.35, hFront, "#5b3b22", false, 0.08);
  for (const wx of [-16, -11, -6, 6, 11, 16]) box("win", 1.7, 1.7, 0.1, wx, 3.4, hFront, "#8fd3e8", false, 0.35);

  // ---- Shed (south-west) ----
  box("shed", 5, 2.8, 4.5, -30, 1.4, -28, "#9c7b4e", true, 0.1);
  const shedRoof = MeshBuilder.CreateCylinder("shedRoof", { diameterTop: 0, diameterBottom: 7, height: 1.6, tessellation: 4 }, scene);
  shedRoof.rotation.y = Math.PI / 4;
  shedRoof.position.set(-30, 3.5, -28);
  // The pyramid roof is a hollow shell — a prop that gets on the shed can tuck
  // under it and vanish at the apex. Make it translucent (like the tree leaves)
  // so anyone under/inside the roof is always visible to the hunter.
  const shedRoofMat = mat(scene, "#7a3b2e", 0.1);
  shedRoofMat.alpha = 0.5;
  shedRoof.material = shedRoofMat;
  shedRoof.isPickable = false;

  // ---- Pool (east) ----
  const poolX = 29, poolZ = 0, poolW = 11, poolD = 15;
  const water = MeshBuilder.CreateGround("water", { width: poolW, height: poolD }, scene);
  water.position.set(poolX, 0.06, poolZ);
  water.material = mat(scene, "#3aa6dd", 0.25);
  water.isPickable = false;
  // Coping (low walls around the pool).
  box("cope", poolW + 1, 0.4, 0.6, poolX, 0.2, poolZ - poolD / 2, "#c9c2b3", true, 0.05);
  box("cope", poolW + 1, 0.4, 0.6, poolX, 0.2, poolZ + poolD / 2, "#c9c2b3", true, 0.05);
  box("cope", 0.6, 0.4, poolD + 1, poolX - poolW / 2, 0.2, poolZ, "#c9c2b3", true, 0.05);
  box("cope", 0.6, 0.4, poolD + 1, poolX + poolW / 2, 0.2, poolZ, "#c9c2b3", true, 0.05);
  // Umbrella by the pool.
  cyl("umbPole", 0.14, 3, poolX - 7, 1.5, poolZ - 4, "#8a8a8a", true, 8, 0.05);
  const canopy = MeshBuilder.CreateCylinder("canopy", { diameterTop: 0, diameterBottom: 4.5, height: 1, tessellation: 10 }, scene);
  canopy.position.set(poolX - 7, 3.2, poolZ - 4);
  canopy.material = mat(scene, "#e74c3c", 0.12);
  canopy.isPickable = false;

  // ---- Swing set (south-east) ----
  const swX = 26, swZ = -24;
  for (const dx of [-2.4, 2.4]) {
    cyl("swLeg", 0.16, 3, swX + dx, 1.5, swZ - 1, "#c0563a", true, 8, 0.06);
    cyl("swLeg", 0.16, 3, swX + dx, 1.5, swZ + 1, "#c0563a", true, 8, 0.06);
  }
  box("swBar", 5.4, 0.18, 0.18, swX, 3, swZ, "#c0563a", false, 0.06);
  for (const sx of [-1.2, 1.2]) {
    box("swSeat", 0.7, 0.1, 0.35, swX + sx, 1.1, swZ, "#334", false, 0.04);
    box("swRope", 0.05, 1.8, 0.05, swX + sx, 2.05, swZ, "#555", false, 0.04);
  }

  // ---- Slide (south-east) ----
  const slX = 17, slZ = -29;
  box("slPlat", 1.6, 0.2, 1.6, slX, 1.6, slZ, "#e0b23a", true, 0.08);
  for (const dx of [-0.6, 0.6]) for (const dz of [-0.6, 0.6]) cyl("slLeg", 0.14, 1.6, slX + dx, 0.8, slZ + dz, "#b0862a", true, 8, 0.06);
  const slide = box("slide", 1.0, 0.12, 3.2, slX, 0.9, slZ - 2.2, "#e74c3c", true, 0.1);
  slide.rotation.x = 0.5;

  // ---- Sandbox (south-east) ----
  const sbX = 32, sbZ = -30, sbS = 5;
  flat("sand", sbS, sbS, sbX, sbZ, "#e0c98a", "sand", -2);
  box("sbEdge", sbS + 0.4, 0.3, 0.3, sbX, 0.15, sbZ - sbS / 2, "#8a6a3f", true, 0.06);
  box("sbEdge", sbS + 0.4, 0.3, 0.3, sbX, 0.15, sbZ + sbS / 2, "#8a6a3f", true, 0.06);
  box("sbEdge", 0.3, 0.3, sbS, sbX - sbS / 2, 0.15, sbZ, "#8a6a3f", true, 0.06);
  box("sbEdge", 0.3, 0.3, sbS, sbX + sbS / 2, 0.15, sbZ, "#8a6a3f", true, 0.06);

  // ---- Picnic table (center) ----
  const ptX = -6, ptZ = -6;
  box("ptTop", 2.6, 0.14, 1.2, ptX, 0.85, ptZ, "#a9814d", true, 0.08);
  for (const dz of [-0.75, 0.75]) box("ptBench", 2.6, 0.12, 0.4, ptX, 0.5, ptZ + dz, "#8a6a3f", true, 0.08);
  for (const dx of [-1.1, 1.1]) box("ptLeg", 0.16, 0.85, 1.4, ptX + dx, 0.42, ptZ, "#6f5330", true, 0.06);

  // ---- Cars in the driveway (south) ----
  const car = (x: number, hex: string) => {
    box("carBody", 4.2, 1.0, 1.9, x, 0.7, minZ + 6, hex, true, 0.08);
    box("carCab", 2.4, 0.9, 1.7, x, 1.5, minZ + 6, hex, true, 0.08);
    for (const dx of [-1.4, 1.4]) for (const dz of [-0.95, 0.95]) cyl("wheel", 0.7, 0.3, x + dx, 0.35, minZ + 6 + dz, "#1c1c1c", false, 12, 0.03).rotation.x = Math.PI / 2;
  };
  car(-14, "#c0392b");
  car(14, "#2e6da4");

  // ---- Trees ----
  // The canopy is deliberately SEE-THROUGH: an opaque leaf-ball let a prop tuck
  // inside/behind it and stay invisible, which is unfair to the hunter. The
  // leaves keep their mottled foliage look but are translucent, so a hider under
  // or within the tree shows through as a clear silhouette. Nothing about the
  // props changes — the tree just stops being a blind spot.
  const leafMat = texMat(scene, "#3f7d34", "grass", 2.2, 2.2, 0.12);
  leafMat.alpha = 0.55; // translucent foliage — you can see what's inside
  const tree = (tx: number, tz: number) => {
    cyl("trunk", 0.7, 3, tx, 1.5, tz, "#6b4a2a", true, 8, 0.06);
    for (const [ox, oy, oz, dia] of [
      [0, 3.7, 0, 3.6],
      [1.2, 3.3, 0.5, 2.8],
      [-1.0, 3.4, -0.6, 2.8],
      [0.2, 4.6, 0.2, 2.6],
    ] as Array<[number, number, number, number]>) {
      const leaf = MeshBuilder.CreateSphere("leaf", { diameter: dia, segments: 8 }, scene);
      leaf.position.set(tx + ox, oy, tz + oz);
      leaf.material = leafMat;
      leaf.isPickable = false;
    }
  };
  for (const [tx, tz] of [
    [10, 12],
    [-10, 12],
    [0, -14],
    [-34, 20],
    [34, 26],
    [13, -22],
  ] as Array<[number, number]>) tree(tx, tz);

  // ---- Hedges & cover (interior obstacles) ----
  // Chest/head-high hedges break the hunters' line of sight and give a spotted
  // prop something to dodge behind and lose their pursuer. Layered as a lighter
  // canopy box on a darker trunk box so they read as foliage, not walls.
  const hedge = (b: Occluder) => {
    const W = b.maxX - b.minX;
    const H = b.maxY - b.minY;
    const D = b.maxZ - b.minZ;
    const x = (b.minX + b.maxX) / 2;
    const y = b.minY + H / 2;
    const z = (b.minZ + b.maxZ) / 2;
    // Foliage texture (not the structural grain) so hedges read as leafy.
    box("hedge", W, H, D, x, y, z, "#3f7d34", true, 0.09).material = texMat(scene, "#3f7d34", "grass", 2.5, 2.5, 0.09);
    // Lighter top layer (decorative, non-colliding) sits on top instead of
    // intersecting the base or adjacent L-corner boxes.
    const topH = 0.42;
    box("hedgeTop", W, topH, D, x, b.maxY + topH / 2, z, "#4f9e3a", false, 0.11).material = texMat(scene, "#4f9e3a", "grass", 2.5, 2.5, 0.11);
  };
  BACKYARD_HEDGES.forEach(hedge);
  // A low brick garden wall as partial (crouch-height) cover near the patio.
  const lowWall = (x: number, z: number, W: number, D: number) => {
    box("gardenWall", W, 0.9, D, x, 0.45, z, "#b07a55", true, 0.07);
    box("gardenWallCap", W + 0.15, 0.14, D + 0.15, x, 0.95, z, "#caa07a", false, 0.06);
  };
  lowWall(-14, 20, 11, 0.6);
  lowWall(24, -33, 8, 0.6);

  // Sun disc.
  const sunDisc = MeshBuilder.CreateSphere("sunDisc", { diameter: 8, segments: 12 }, scene);
  sunDisc.position.set(60, 80, 60);
  const sm = new StandardMaterial("sunMat", scene);
  sm.emissiveColor = new Color3(1, 0.93, 0.7);
  sm.disableLighting = true;
  sunDisc.material = sm;
  sunDisc.isPickable = false;

  return colliders;
}

// ---------------------------------------------------------------------------
// Hollow Row (cemetery) — four walled rooms around a crossing
// ---------------------------------------------------------------------------

/**
 * Every solid on this map is drawn from CEMETERY_BLOCKS, the same array the
 * server turns into occluders. Nothing here invents its own geometry, so a
 * wall you can see is always a wall that stops a bullet, and moving one is a
 * single-line edit in tools/gen_cemetery.py rather than a change in two files
 * that have to be kept in sync by hand.
 */
function buildCemetery(scene: Scene, map: MapDefinition): Mesh[] {
  // Moonlit night. The fog is dense enough that the far wall dissolves, which
  // is what makes the map feel closed-in and gives hiders cover at range.
  scene.clearColor = new Color4(0.05, 0.062, 0.085, 1);
  scene.ambientColor = new Color3(0.1, 0.11, 0.16);
  scene.fogEnabled = true;
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogColor = new Color3(0.05, 0.062, 0.085); // matches clearColor so the
  // horizon dissolves instead of ending on a hard line.
  scene.fogDensity = 0.022;

  // Kept deliberately dim: props are drawn with a self-lit material, so a
  // bright key light stacks on top and clips pale stone to flat white — which
  // is exactly what stops a night map from reading as night.
  const sky = new HemisphericLight("sky", new Vector3(0.1, 1, -0.2), scene);
  sky.intensity = 0.34;
  sky.diffuse = new Color3(0.46, 0.55, 0.8);
  sky.groundColor = new Color3(0.11, 0.12, 0.16);
  const moon = new DirectionalLight("moon", new Vector3(-0.45, -0.85, -0.5), scene);
  moon.position = new Vector3(34, 46, 36);
  moon.intensity = 0.34;
  moon.diffuse = new Color3(0.6, 0.68, 0.9);
  moon.specular = new Color3(0.1, 0.11, 0.14);
  // A very weak fill from the opposite side. Without it the shaded face of a
  // tomb or a room wall is pure black, and a hunter standing against one cannot
  // tell a prop from the masonry — atmospheric, but unplayable.
  const fill = new DirectionalLight("moonFill", new Vector3(0.6, -0.35, 0.7), scene);
  fill.position = new Vector3(-36, 24, -40);
  fill.intensity = 0.16;
  fill.diffuse = new Color3(0.4, 0.46, 0.62);
  fill.specular = new Color3(0, 0, 0);

  const colliders: Mesh[] = [];
  const { minX, maxX, minZ, maxZ } = map.bounds;
  const w = maxX - minX;
  const d = maxZ - minZ;

  const solidBox = (name: string, W: number, H: number, D: number, x: number, y: number, z: number, hex: string, solid: boolean, em = 0.07) => {
    const m = MeshBuilder.CreateBox(name, { width: W, height: H, depth: D }, scene);
    m.position.set(x, y, z);
    m.material = grainMat(scene, hex, em);
    m.checkCollisions = solid;
    m.isPickable = solid;
    if (solid) colliders.push(m);
    return m;
  };

  // ---- ground ---------------------------------------------------------------
  const ground = MeshBuilder.CreateGround("graveground", { width: w, height: d }, scene);
  ground.material = texMat(scene, "#2c3529", "grass", w / 3.2, d / 3.2, 0.05);
  ground.checkCollisions = true;
  ground.isPickable = true;
  colliders.push(ground);

  // Flush paving, drawn straight from CEMETERY_FLOORS.
  //
  // These sit at ground level and win the depth test with a negative zOffset
  // rather than being physically raised — a raised plane slices the bottoms off
  // every prop standing on it. The catch is that two coplanar quads with the
  // SAME bias z-fight: the depth test ties, breaks differently per pixel per
  // frame, and the ground visibly crawls as you turn. The crossing used to do
  // exactly that, because the north-south and east-west lanes were each drawn
  // full length and overlapped in the middle.
  //
  // The fix is in the data, not here: the generator emits surfaces that never
  // overlap at the same bias and refuses to emit ones that do. This loop just
  // draws what it is given.
  //
  // The offset goes through texMat so it is part of the material cache key —
  // mutating a shared cached material here would leak the offset onto unrelated
  // surfaces.
  for (const [i, f] of CEMETERY_FLOORS.entries()) {
    const m = MeshBuilder.CreateGround(`floor${i}`, { width: f.w, height: f.d }, scene);
    m.position.set(f.x, 0.002, f.z);
    m.material = texMat(scene, f.hex, f.kind, Math.max(1, f.w / 3), Math.max(1, f.d / 3), 0.05, f.zPri);
    m.isPickable = false;
  }

  // ---- solids ---------------------------------------------------------------
  // Drawn straight from the shared block list. Trees are listed there too (for
  // collision) but drawn round below, so they are skipped here.
  const KIND_HEX: Record<string, string> = {
    // Lighter than feels right on paper. Room walls are what you navigate by
    // here, and at 0.34 key light a "correct" dark stone renders as a flat
    // black silhouette you cannot read a doorway in.
    wall: "#565e69",
    pillar: "#6b655c",
    altar: "#6e6860",
    gable: "#5f6671",
    tomb: "#6a635c",
    plot: "#5b626c",
    shed: "#4c453c",
    obelisk: "#756e64",
  };
  for (const [i, b] of CEMETERY_BLOCKS.entries()) {
    if (b.kind === "tree") continue;
    const hex = KIND_HEX[b.kind] ?? "#4a4f56";
    solidBox(`${b.kind}${i}`, b.w, b.h, b.d, b.x, b.h / 2, b.z, hex, true);

    // Non-collidable detailing on top. It all sits at or above the block's own
    // height, so it can never change where a player can walk.
    if (b.kind === "wall" || b.kind === "plot") {
      // A lighter cap course. On a dark wall this is the only thing that tells
      // you where the top edge is, which is what makes a doorway readable.
      solidBox(`cap${i}`, b.w + 0.18, 0.16, b.d + 0.18, b.x, b.h + 0.08, b.z, b.kind === "plot" ? "#767e89" : "#727b87", false, 0.1);
    } else if (b.kind === "tomb") {
      solidBox(`cornice${i}`, b.w + 0.5, 0.3, b.d + 0.5, b.x, b.h + 0.15, b.z, hex, false, 0.09);
      const cap = MeshBuilder.CreateCylinder(`tombCap${i}`, { diameterTop: 0, diameterBottom: Math.max(b.w, b.d) * 1.4, height: 1.6, tessellation: 4 }, scene);
      cap.position.set(b.x, b.h + 1.1, b.z);
      cap.rotation.y = Math.PI / 4;
      cap.material = grainMat(scene, hex, 0.05);
      cap.isPickable = false;
      // Doorway on the south face, where the alley runs.
      solidBox(`tombFrame${i}`, 1.7, b.h * 0.72, 0.14, b.x, b.h * 0.36, b.z - b.d / 2 - 0.02, hex, false, 0.1);
      solidBox(`tombDoor${i}`, 1.2, b.h * 0.62, 0.22, b.x, b.h * 0.31, b.z - b.d / 2 - 0.02, "#1c1e23", false, 0.02);
    } else if (b.kind === "pillar") {
      // Snapped off at the top — a clean cylinder would read as scaffolding.
      const nub = MeshBuilder.CreateCylinder(`colTop${i}`, { diameter: b.w * 1.25, height: 0.5, tessellation: 6 }, scene);
      nub.position.set(b.x, b.h + 0.18, b.z);
      nub.rotation.z = 0.12;
      nub.material = grainMat(scene, hex, 0.06);
      nub.isPickable = false;
    } else if (b.kind === "shed") {
      solidBox(`shedRoof${i}`, b.w + 0.7, 0.28, b.d + 0.7, b.x, b.h + 0.14, b.z, "#2e2a25", false, 0.04);
    } else if (b.kind === "altar") {
      solidBox(`altarTop${i}`, b.w + 0.4, 0.22, b.d + 0.4, b.x, b.h + 0.11, b.z, "#777065", false, 0.11);
    } else if (b.kind === "gable") {
      // A cornice course plus a pediment, so the surviving end reads as a
      // building rather than a billboard.
      solidBox(`gableCap${i}`, b.w + 0.3, 0.2, b.d + 0.3, b.x, b.h + 0.1, b.z, "#727b87", false, 0.1);
      // Two sloped slabs meeting at an apex. A cone with three sides looks like
      // a spike from the nave floor; this actually reads as a roofline.
      const run = b.w * 0.3;
      const rise = 2.3;
      const pitch = Math.atan2(rise, run);
      for (const sx of [-1, 1]) {
        const rafter = MeshBuilder.CreateBox(`gableTop${i}${sx}`, { width: Math.hypot(run, rise) + 0.3, height: 0.45, depth: b.d + 0.25 }, scene);
        rafter.position.set(b.x + sx * (run / 2), b.h + rise / 2, b.z);
        rafter.rotation.z = -sx * pitch;
        rafter.material = grainMat(scene, hex, 0.07);
        rafter.isPickable = false;
      }
      for (const sx of [-1, 1]) {
        solidBox(`gableBtr${i}${sx}`, 1.1, b.h * 0.78, 1.1, b.x + sx * (b.w / 2 - 0.8), b.h * 0.39, b.z - 0.8, hex, false, 0.08);
      }
    } else if (b.kind === "obelisk") {
      const spire = MeshBuilder.CreateCylinder("obeliskTip", { diameterTop: 0, diameterBottom: b.w * 1.05, height: 2.4, tessellation: 4 }, scene);
      spire.position.set(b.x, b.h + 1.2, b.z);
      spire.rotation.y = Math.PI / 4;
      spire.material = grainMat(scene, hex, 0.06);
      spire.isPickable = false;
      solidBox("obeliskBase", b.w + 1.4, 0.6, b.d + 1.4, b.x, 0.3, b.z, "#565049", false, 0.08);
    }
  }

  // ---- the chapel's rose window ---------------------------------------------
  // Set in the surviving gable end, 5.4m up: the one warm light on the map and
  // the only thing tall enough to see over the room walls from the crossing.
  // Bright enough that the glow layer picks it up (>= 0.6 on a channel), which
  // also keeps the include-list non-empty on this map.
  const glassMat = new StandardMaterial("chapelGlass", scene);
  glassMat.emissiveColor = new Color3(1, 0.72, 0.3);
  glassMat.disableLighting = true;
  const rose = MeshBuilder.CreateCylinder("chapelRose", { diameter: 2.4, height: 0.2, tessellation: 16 }, scene);
  rose.position.set(-16.5, 5.4, 23.4);
  rose.rotation.x = Math.PI / 2;
  rose.material = glassMat;
  rose.isPickable = false;

  // ---- dead trees -----------------------------------------------------------
  // Bare, clawing branches — no canopy, so they break a sightline without
  // blanketing a whole lane the way the backyard's foliage does.
  for (const [i, [tx, tz]] of CEMETERY_TREES.entries()) {
    const trunk = MeshBuilder.CreateCylinder(`deadTrunk${i}`, { diameter: 1.1, height: 5.5, tessellation: 8 }, scene);
    trunk.position.set(tx, 2.75, tz);
    trunk.material = grainMat(scene, "#332b25", 0.07);
    trunk.checkCollisions = true;
    trunk.isPickable = true;
    colliders.push(trunk);
    for (let b = 0; b < 5; b++) {
      const a = (b / 5) * Math.PI * 2 + i;
      const limb = MeshBuilder.CreateCylinder(`limb${i}_${b}`, { diameterTop: 0.05, diameterBottom: 0.22, height: 2.6, tessellation: 5 }, scene);
      limb.position.set(tx + Math.cos(a) * 0.9, 4.4 + (b % 2) * 0.7, tz + Math.sin(a) * 0.9);
      limb.rotation.set(Math.cos(a) * 0.85, -a, Math.sin(a) * 0.85);
      limb.material = grainMat(scene, "#332b25", 0.05);
      limb.isPickable = false;
    }
  }

  // ---- moon -----------------------------------------------------------------
  const moonDisc = MeshBuilder.CreateSphere("moonDisc", { diameter: 6, segments: 14 }, scene);
  moonDisc.position.set(-42, 36, 48);
  const mm = new StandardMaterial("moonMat", scene);
  mm.emissiveColor = new Color3(0.86, 0.9, 1);
  mm.disableLighting = true;
  moonDisc.material = mm;
  moonDisc.isPickable = false;

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
      for (const [x, y, z, dia] of [
        [0, 0.45, 0, r * 2],
        [0.35, 0.5, 0.2, r * 1.4],
        [-0.3, 0.5, -0.2, r * 1.4],
        [0.1, 0.78, 0.1, r * 1.2],
      ] as Array<[number, number, number, number]>) {
        add(MeshBuilder.CreateSphere(name + "_b", { diameter: dia, segments: 8 }, scene), y, x, z);
      }
      break;
    }
    case "rock": {
      add(MeshBuilder.CreateSphere(name + "_r", { diameter: r * 2, segments: 6 }, scene), r * 0.5).scaling.set(1, 0.7, 0.85);
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
      add(MeshBuilder.CreateCylinder(name + "_cl", { diameter: r * 0.7, height: 0.18, tessellation: 8 }, scene), h * 0.45, r * 0.75).rotation.z = Math.PI / 2;
      add(MeshBuilder.CreateCylinder(name + "_cr", { diameter: r * 0.7, height: 0.18, tessellation: 8 }, scene), h * 0.45, -r * 0.75).rotation.z = Math.PI / 2;
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
      for (const x of [-r * 0.8, r * 0.8]) for (const z of [-0.18, 0.18]) add(MeshBuilder.CreateBox(name + "_lg", { width: 0.1, height: h * 0.5, depth: 0.1 }, scene), h * 0.25, x, z);
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
      add(MeshBuilder.CreateCylinder(name + "_fn", { diameter: r * 1.4, height: 0.06, tessellation: 16 }, scene), h * 0.5, 0, r * 0.82).rotation.x = Math.PI / 2;
      break;
    }
    case "planter": {
      add(MeshBuilder.CreateBox(name + "_b", { width: r * 2, height: h * 0.7, depth: r * 1.2 }, scene), h * 0.35);
      for (const x of [-r * 0.7, 0, r * 0.7]) add(MeshBuilder.CreateSphere(name + "_f", { diameter: r * 0.95, segments: 6 }, scene), h * 0.85, x).material = mat(scene, "#4a7c3a");
      break;
    }
    // ---- Whimsical ----
    case "flamingo": {
      for (const x of [-0.12, 0.12]) add(MeshBuilder.CreateCylinder(name + "_lg", { diameter: 0.07, height: h * 0.5, tessellation: 6 }, scene), h * 0.25, x).material = mat(scene, "#e2a03a");
      add(MeshBuilder.CreateSphere(name + "_bd", { diameter: r * 1.8, segments: 10 }, scene), h * 0.62).scaling.set(1, 0.85, 1.3);
      add(MeshBuilder.CreateCylinder(name + "_nk", { diameter: 0.12, height: h * 0.4, tessellation: 6 }, scene), h * 0.82, 0.05, 0.2);
      add(MeshBuilder.CreateSphere(name + "_hd", { diameter: r * 0.7, segments: 8 }, scene), h * 0.98, 0.05, 0.3);
      add(MeshBuilder.CreateCylinder(name + "_bk", { diameterTop: 0, diameterBottom: 0.12, height: 0.22, tessellation: 6 }, scene), h * 0.95, 0.05, 0.45).material = mat(scene, "#1c1c1c");
      break;
    }
    case "rubber_duck": {
      add(MeshBuilder.CreateSphere(name + "_bd", { diameter: r * 2, segments: 12 }, scene), r * 0.75).scaling.set(1, 0.8, 1.25);
      add(MeshBuilder.CreateSphere(name + "_hd", { diameter: r * 1.15, segments: 10 }, scene), h * 0.72, 0, r * 0.55);
      add(MeshBuilder.CreateCylinder(name + "_bk", { diameter: 0.28, height: 0.3, tessellation: 6 }, scene), h * 0.7, 0, r * 1.05).rotation.x = Math.PI / 2;
      (root.getChildMeshes().slice(-1)[0] as Mesh).material = mat(scene, "#e8912b");
      break;
    }
    case "beach_ball": {
      add(MeshBuilder.CreateSphere(name + "_b", { diameter: r * 2, segments: 12 }, scene), r);
      for (const [c, rot] of [["#ecf0f1", 0], ["#3498db", 1], ["#f1c40f", 2]] as Array<[string, number]>) {
        const stripe = MeshBuilder.CreateSphere(name + "_s", { diameter: r * 2.02, segments: 12, slice: 0.16 }, scene);
        add(stripe, r).rotation.y = rot * 1.1;
        stripe.material = mat(scene, c);
      }
      break;
    }
    case "bbq_grill": {
      add(MeshBuilder.CreateSphere(name + "_bowl", { diameter: r * 1.8, segments: 12 }, scene), h * 0.5).scaling.y = 0.7;
      add(MeshBuilder.CreateSphere(name + "_lid", { diameter: r * 1.8, segments: 12, slice: 0.5 }, scene), h * 0.62);
      for (const a of [0, 2.09, 4.18]) add(MeshBuilder.CreateCylinder(name + "_lg", { diameter: 0.08, height: h * 0.45, tessellation: 6 }, scene), h * 0.22, Math.cos(a) * r * 0.7, Math.sin(a) * r * 0.7).material = mat(scene, "#444");
      break;
    }
    case "watering_can": {
      add(MeshBuilder.CreateCylinder(name + "_b", { diameter: r * 1.6, height: h * 0.7, tessellation: 12 }, scene), h * 0.4);
      add(MeshBuilder.CreateCylinder(name + "_sp", { diameter: 0.12, height: h * 0.7, tessellation: 6 }, scene), h * 0.55, r * 0.9, 0).rotation.z = 1.0;
      add(MeshBuilder.CreateBox(name + "_hd", { width: 0.1, height: 0.1, depth: r * 1.2 }, scene), h * 0.82);
      break;
    }
    case "wheelbarrow": {
      add(MeshBuilder.CreateBox(name + "_tr", { width: r * 1.8, height: h * 0.5, depth: r * 1.3 }, scene), h * 0.55).scaling.set(1, 1, 1);
      add(MeshBuilder.CreateCylinder(name + "_wh", { diameter: r * 0.9, height: 0.16, tessellation: 12 }, scene), h * 0.35, 0, r * 0.9).rotation.x = Math.PI / 2;
      (root.getChildMeshes().slice(-1)[0] as Mesh).material = mat(scene, "#1c1c1c");
      for (const x of [-r * 0.6, r * 0.6]) add(MeshBuilder.CreateCylinder(name + "_lg", { diameter: 0.08, height: h * 0.4, tessellation: 6 }, scene), h * 0.2, x, -r * 0.6).material = mat(scene, "#555");
      break;
    }
    case "pumpkin": {
      add(MeshBuilder.CreateSphere(name + "_b", { diameter: r * 2, segments: 12 }, scene), r * 0.85).scaling.set(1.1, 0.82, 1.1);
      add(MeshBuilder.CreateCylinder(name + "_st", { diameterTop: 0.08, diameterBottom: 0.16, height: 0.28, tessellation: 6 }, scene), h * 0.95).material = mat(scene, "#4a7c3a");
      break;
    }
    case "soccer_ball": {
      add(MeshBuilder.CreateSphere(name + "_b", { diameter: r * 2, segments: 12 }, scene), r);
      for (const [x, y, z] of [
        [0, r * 1.9, 0],
        [r * 0.9, r, r * 0.5],
        [-r * 0.9, r, -r * 0.5],
      ] as Array<[number, number, number]>) {
        add(MeshBuilder.CreateDisc(name + "_p", { radius: r * 0.35, tessellation: 5 }, scene), y, x, z).material = mat(scene, "#222");
      }
      break;
    }
    case "snowman": {
      add(MeshBuilder.CreateSphere(name + "_b1", { diameter: r * 2, segments: 12 }, scene), r * 0.9);
      add(MeshBuilder.CreateSphere(name + "_b2", { diameter: r * 1.5, segments: 12 }, scene), h * 0.6);
      add(MeshBuilder.CreateSphere(name + "_b3", { diameter: r * 1.05, segments: 12 }, scene), h * 0.86);
      add(MeshBuilder.CreateCylinder(name + "_no", { diameterTop: 0, diameterBottom: 0.12, height: 0.3, tessellation: 6 }, scene), h * 0.86, 0, r * 0.5).rotation.x = -Math.PI / 2;
      (root.getChildMeshes().slice(-1)[0] as Mesh).material = mat(scene, "#e8791f");
      add(MeshBuilder.CreateCylinder(name + "_hat", { diameter: r * 1.0, height: 0.32, tessellation: 12 }, scene), h * 0.98).material = mat(scene, "#222");
      break;
    }
    case "cactus": {
      add(MeshBuilder.CreateCylinder(name + "_pot", { diameterTop: r * 1.8, diameterBottom: r * 1.4, height: h * 0.3, tessellation: 12 }, scene), h * 0.15).material = mat(scene, "#b5651d");
      add(MeshBuilder.CreateCylinder(name + "_st", { diameter: r * 1.2, height: h * 0.75, tessellation: 12 }, scene), h * 0.6);
      add(MeshBuilder.CreateCylinder(name + "_a1", { diameter: r * 0.6, height: h * 0.35, tessellation: 8 }, scene), h * 0.6, r * 0.7).rotation.z = Math.PI / 2;
      add(MeshBuilder.CreateCylinder(name + "_a2", { diameter: r * 0.6, height: h * 0.35, tessellation: 8 }, scene), h * 0.68, -r * 0.7).rotation.z = Math.PI / 2;
      break;
    }
    case "lawn_chair": {
      add(MeshBuilder.CreateBox(name + "_seat", { width: r * 1.6, height: 0.1, depth: r * 1.3 }, scene), h * 0.42);
      add(MeshBuilder.CreateBox(name + "_back", { width: r * 1.6, height: h * 0.55, depth: 0.1 }, scene), h * 0.7, 0, -r * 0.6).rotation.x = -0.3;
      for (const x of [-r * 0.7, r * 0.7]) for (const z of [-r * 0.55, r * 0.55]) add(MeshBuilder.CreateBox(name + "_lg", { width: 0.08, height: h * 0.42, depth: 0.08 }, scene), h * 0.21, x, z);
      break;
    }
    case "dog_bowl": {
      add(MeshBuilder.CreateCylinder(name + "_b", { diameterTop: r * 2, diameterBottom: r * 1.6, height: h, tessellation: 14 }, scene), h * 0.5);
      add(MeshBuilder.CreateCylinder(name + "_w", { diameter: r * 1.5, height: 0.03, tessellation: 14 }, scene), h * 0.85).material = mat(scene, "#7a4a2a");
      break;
    }
    // ---- Small / detail items ----
    case "tree_stump": {
      add(MeshBuilder.CreateCylinder(name + "_s", { diameterTop: r * 1.9, diameterBottom: r * 2, height: h, tessellation: 14 }, scene), h / 2);
      add(MeshBuilder.CreateCylinder(name + "_t", { diameter: r * 1.85, height: 0.05, tessellation: 14 }, scene), h + 0.02).material = mat(scene, "#a67c48");
      break;
    }
    case "portrait": {
      add(MeshBuilder.CreateBox(name + "_fr", { width: r * 1.8, height: h, depth: 0.12 }, scene), h / 2); // gold frame
      add(MeshBuilder.CreateBox(name + "_cv", { width: r * 1.45, height: h * 0.78, depth: 0.06 }, scene), h / 2, 0, 0.06).material = mat(scene, "#6a8fb0"); // "painting"
      add(MeshBuilder.CreateBox(name + "_st", { width: 0.1, height: h * 0.5, depth: 0.1 }, scene), h * 0.25, 0, -0.25).material = mat(scene, "#5b3b22"); // easel leg
      break;
    }
    case "watermelon": {
      add(MeshBuilder.CreateSphere(name + "_w", { diameter: r * 2, segments: 12 }, scene), r * 0.72).scaling.set(1.3, 0.82, 1);
      break;
    }
    case "teapot": {
      add(MeshBuilder.CreateSphere(name + "_b", { diameter: r * 1.9, segments: 12 }, scene), h * 0.42).scaling.set(1, 0.85, 1);
      add(MeshBuilder.CreateSphere(name + "_l", { diameter: r * 0.9, segments: 10 }, scene), h * 0.82);
      add(MeshBuilder.CreateCylinder(name + "_sp", { diameterTop: 0.06, diameterBottom: 0.14, height: h * 0.6, tessellation: 8 }, scene), h * 0.5, r * 0.85).rotation.z = -0.9;
      add(MeshBuilder.CreateTorus(name + "_h", { diameter: r * 0.9, thickness: 0.08, tessellation: 10 }, scene), h * 0.5, -r * 0.95).rotation.y = Math.PI / 2;
      break;
    }
    case "lantern": {
      add(MeshBuilder.CreateBox(name + "_b", { width: r * 1.4, height: h * 0.55, depth: r * 1.4 }, scene), h * 0.42);
      add(MeshBuilder.CreateBox(name + "_g", { width: r * 1.0, height: h * 0.4, depth: r * 1.0 }, scene), h * 0.42).material = mat(scene, "#ffd479", 0.85);
      add(MeshBuilder.CreateCylinder(name + "_c", { diameterTop: 0, diameterBottom: r * 1.6, height: h * 0.25, tessellation: 4 }, scene), h * 0.82).rotation.y = Math.PI / 4;
      add(MeshBuilder.CreateTorus(name + "_r", { diameter: r * 0.7, thickness: 0.05, tessellation: 8 }, scene), h * 0.98);
      break;
    }
    case "mushroom": {
      add(MeshBuilder.CreateCylinder(name + "_s", { diameterTop: r * 0.9, diameterBottom: r * 1.1, height: h * 0.6, tessellation: 10 }, scene), h * 0.3).material = mat(scene, "#f3efe6");
      add(MeshBuilder.CreateSphere(name + "_c", { diameter: r * 2, segments: 12, slice: 0.55 }, scene), h * 0.6);
      break;
    }
    case "birdhouse": {
      add(MeshBuilder.CreateBox(name + "_h", { width: r * 1.6, height: h * 0.4, depth: r * 1.6 }, scene), h * 0.55);
      add(MeshBuilder.CreateCylinder(name + "_rf", { diameterTop: 0, diameterBottom: r * 2.4, height: h * 0.3, tessellation: 4 }, scene), h * 0.85).rotation.y = Math.PI / 4;
      add(MeshBuilder.CreateCylinder(name + "_o", { diameter: r * 0.5, height: 0.06, tessellation: 10 }, scene), h * 0.58, 0, r * 0.8).rotation.x = Math.PI / 2;
      (root.getChildMeshes().slice(-1)[0] as Mesh).material = mat(scene, "#20140a");
      add(MeshBuilder.CreateCylinder(name + "_p", { diameter: 0.1, height: h * 0.35, tessellation: 6 }, scene), h * 0.17).material = mat(scene, "#5b3b22");
      break;
    }
    case "picnic_basket": {
      add(MeshBuilder.CreateBox(name + "_bk", { width: r * 2, height: h * 0.7, depth: r * 1.5 }, scene), h * 0.35);
      add(MeshBuilder.CreateTorus(name + "_hd", { diameter: r * 1.5, thickness: 0.07, tessellation: 12 }, scene), h * 0.85).rotation.x = Math.PI / 2;
      break;
    }
    case "headstone": {
      // Slab with a rounded top on a wider plinth.
      add(MeshBuilder.CreateBox(name + "_base", { width: r * 2.1, height: 0.14, depth: r * 1.15 }, scene), 0.07);
      add(MeshBuilder.CreateBox(name + "_slab", { width: r * 1.75, height: h - 0.14, depth: r * 0.62 }, scene), (h + 0.14) / 2 - 0.07);
      add(MeshBuilder.CreateCylinder(name + "_top", { diameter: r * 1.75, height: r * 0.62, tessellation: 14 }, scene), h - 0.02).rotation.x = Math.PI / 2;
      break;
    }
    case "grave_cross": {
      add(MeshBuilder.CreateBox(name + "_base", { width: r * 2, height: 0.16, depth: r * 1.3 }, scene), 0.08);
      add(MeshBuilder.CreateBox(name + "_up", { width: r * 0.5, height: h - 0.16, depth: r * 0.42 }, scene), (h + 0.16) / 2 - 0.08);
      add(MeshBuilder.CreateBox(name + "_arm", { width: r * 1.9, height: r * 0.46, depth: r * 0.42 }, scene), h * 0.72);
      break;
    }
    case "urn": {
      add(MeshBuilder.CreateBox(name + "_p", { width: r * 2, height: 0.16, depth: r * 2 }, scene), 0.08);
      add(MeshBuilder.CreateCylinder(name + "_st", { diameterTop: r * 1.1, diameterBottom: r * 0.7, height: h * 0.28, tessellation: 12 }, scene), h * 0.28);
      add(MeshBuilder.CreateSphere(name + "_b", { diameter: r * 1.9, segments: 12 }, scene), h * 0.62).scaling.set(1, 0.9, 1);
      add(MeshBuilder.CreateCylinder(name + "_r", { diameter: r * 1.35, height: 0.09, tessellation: 12 }, scene), h * 0.94);
      break;
    }
    case "angel_statue": {
      // Plinth, robed body, bowed head, and wings that actually clear the
      // silhouette. Tucked inside the robe they were invisible past 5m, which
      // made the map's signature statue read as a traffic cone.
      add(MeshBuilder.CreateBox(name + "_p", { width: r * 2.2, height: h * 0.16, depth: r * 2.2 }, scene), h * 0.08);
      add(MeshBuilder.CreateBox(name + "_p2", { width: r * 1.8, height: h * 0.08, depth: r * 1.8 }, scene), h * 0.2);
      add(MeshBuilder.CreateCylinder(name + "_body", { diameterTop: r * 0.9, diameterBottom: r * 1.7, height: h * 0.52, tessellation: 14 }, scene), h * 0.5);
      // Arms folded across the front.
      for (const side of [-1, 1]) {
        const arm = add(MeshBuilder.CreateCylinder(name + "_arm", { diameter: r * 0.28, height: h * 0.3, tessellation: 8 }, scene), h * 0.6, side * r * 0.42, r * 0.28);
        arm.rotation.set(0.5, 0, side * 0.5);
      }
      add(MeshBuilder.CreateCylinder(name + "_neck", { diameter: r * 0.3, height: h * 0.06, tessellation: 8 }, scene), h * 0.79);
      const head = add(MeshBuilder.CreateSphere(name + "_head", { diameter: r * 0.66, segments: 12 }, scene), h * 0.86, 0, r * 0.06);
      head.scaling.set(1, 1.1, 1);
      for (const side of [-1, 1]) {
        // Main pinion: a tall swept slab standing proud of the back.
        const wing = add(MeshBuilder.CreateBox(name + "_w", { width: r * 0.16, height: h * 0.62, depth: r * 0.7 }, scene), h * 0.66, side * r * 0.66, -r * 0.3);
        wing.rotation.set(-0.24, side * 0.5, side * 0.3);
        // Feathered tip, angled up and out.
        const tip = add(MeshBuilder.CreateCylinder(name + "_wt", { diameterTop: 0, diameterBottom: r * 0.52, height: h * 0.4, tessellation: 3 }, scene), h * 1.02, side * r * 0.86, -r * 0.42);
        tip.rotation.set(-0.2, side * 0.5, side * 0.42);
      }
      break;
    }
    case "coffin": {
      // Tapered lid: a wide shoulder box and a narrower foot box.
      add(MeshBuilder.CreateBox(name + "_sh", { width: r * 1.25, height: h * 0.82, depth: r * 1.05 }, scene), h * 0.41, 0, r * 0.5);
      add(MeshBuilder.CreateBox(name + "_ft", { width: r * 0.92, height: h * 0.82, depth: r * 1.05 }, scene), h * 0.41, 0, -r * 0.55);
      add(MeshBuilder.CreateBox(name + "_lid", { width: r * 1.3, height: 0.08, depth: r * 2.1 }, scene), h * 0.86).material = mat(scene, "#3f2f22");
      break;
    }
    case "skull": {
      const dark = mat(scene, "#141416");
      add(MeshBuilder.CreateSphere(name + "_cr", { diameter: r * 1.6, segments: 10 }, scene), h * 0.62).scaling.set(1, 0.92, 1.08);
      add(MeshBuilder.CreateBox(name + "_jaw", { width: r * 1.15, height: h * 0.2, depth: r * 1.2 }, scene), h * 0.16, 0, r * 0.1);
      for (const s of [-1, 1]) {
        add(MeshBuilder.CreateSphere(name + "_eye", { diameter: r * 0.5, segments: 6 }, scene), h * 0.68, s * r * 0.34, r * 0.62).material = dark;
      }
      add(MeshBuilder.CreateBox(name + "_nose", { width: r * 0.22, height: h * 0.16, depth: r * 0.2 }, scene), h * 0.46, 0, r * 0.72).material = dark;
      break;
    }
    case "bone_pile": {
      // Long bones crossed at angles with a skull resting on top. The knobbly
      // ends are what make it read as bone rather than as dropped sticks.
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + 0.4;
        const y = 0.09 + (i % 2) * 0.11;
        const shaft = add(MeshBuilder.CreateCylinder(name + "_b" + i, { diameter: 0.09, height: r * 1.9 }, scene), y, Math.cos(a) * r * 0.2, Math.sin(a) * r * 0.2);
        shaft.rotation.set(Math.PI / 2, a, 0);
        for (const e of [-1, 1]) {
          add(MeshBuilder.CreateSphere(name + "_k" + i + e, { diameter: 0.16, segments: 6 }, scene),
            y, Math.cos(a) * (r * 0.2 + e * r * 0.92), Math.sin(a) * (r * 0.2 + e * r * 0.92));
        }
      }
      add(MeshBuilder.CreateSphere(name + "_sk", { diameter: r * 0.85, segments: 8 }, scene), h * 0.72).scaling.set(1, 0.9, 1.1);
      break;
    }
    case "skeleton": {
      const dark = mat(scene, "#141416");
      for (const s of [-1, 1]) {
        add(MeshBuilder.CreateCylinder(name + "_leg", { diameter: 0.11, height: h * 0.46, tessellation: 8 }, scene), h * 0.23, s * r * 0.3);
        add(MeshBuilder.CreateSphere(name + "_ft", { diameter: 0.17, segments: 6 }, scene), 0.07, s * r * 0.3, r * 0.2);
      }
      add(MeshBuilder.CreateBox(name + "_pel", { width: r * 1.0, height: h * 0.08, depth: r * 0.55 }, scene), h * 0.49);
      add(MeshBuilder.CreateCylinder(name + "_spine", { diameter: 0.1, height: h * 0.3, tessellation: 6 }, scene), h * 0.66);
      // Ribcage: three hoops, tapering upward.
      for (let i = 0; i < 3; i++) {
        const rib = add(MeshBuilder.CreateTorus(name + "_rib" + i, { diameter: r * 1.3 - i * 0.14, thickness: 0.055, tessellation: 12 }, scene), h * 0.56 + i * 0.09);
        rib.rotation.x = Math.PI / 2;
      }
      for (const s of [-1, 1]) {
        const arm = add(MeshBuilder.CreateCylinder(name + "_arm", { diameter: 0.085, height: h * 0.36, tessellation: 6 }, scene), h * 0.6, s * r * 0.62);
        arm.rotation.z = s * 0.16;
      }
      add(MeshBuilder.CreateCylinder(name + "_neck", { diameter: 0.09, height: h * 0.06, tessellation: 6 }, scene), h * 0.81);
      add(MeshBuilder.CreateSphere(name + "_sk", { diameter: r * 0.82, segments: 10 }, scene), h * 0.91).scaling.set(1, 0.94, 1.08);
      add(MeshBuilder.CreateBox(name + "_jaw", { width: r * 0.55, height: h * 0.04, depth: r * 0.6 }, scene), h * 0.845, 0, r * 0.06);
      for (const s of [-1, 1]) {
        add(MeshBuilder.CreateSphere(name + "_eye", { diameter: 0.11, segments: 6 }, scene), h * 0.93, s * 0.1, r * 0.32).material = dark;
      }
      break;
    }
    case "sarcophagus": {
      // A stone chest with a tapered lid and a carved figure on top: unmistakably
      // not a crate, which is the whole point of it existing.
      add(MeshBuilder.CreateBox(name + "_plinth", { width: r * 2.05, height: h * 0.14, depth: r * 1.2 }, scene), h * 0.07);
      add(MeshBuilder.CreateBox(name + "_chest", { width: r * 1.85, height: h * 0.6, depth: r * 1.0 }, scene), h * 0.44);
      const lid = add(MeshBuilder.CreateBox(name + "_lid", { width: r * 2.0, height: h * 0.16, depth: r * 1.12 }, scene), h * 0.82);
      lid.material = mat(scene, "#8d8578");
      // Effigy: a body and a head carved in relief.
      add(MeshBuilder.CreateSphere(name + "_eff", { diameter: r * 0.75, segments: 8 }, scene), h * 0.92, -r * 0.5).scaling.set(1, 0.55, 1);
      const body = add(MeshBuilder.CreateBox(name + "_effb", { width: r * 0.95, height: h * 0.1, depth: r * 0.5 }, scene), h * 0.9, r * 0.25);
      body.material = mat(scene, "#8d8578");
      break;
    }
    case "gargoyle": {
      // Crouched on a plinth with folded wings and horns — a silhouette you can
      // pick out of a wall of headstones at 20m.
      const dark = mat(scene, "#191b1e");
      add(MeshBuilder.CreateBox(name + "_p", { width: r * 1.8, height: h * 0.24, depth: r * 1.8 }, scene), h * 0.12);
      add(MeshBuilder.CreateSphere(name + "_body", { diameter: r * 1.35, segments: 10 }, scene), h * 0.5).scaling.set(1, 0.85, 1.15);
      for (const s of [-1, 1]) {
        add(MeshBuilder.CreateCylinder(name + "_leg", { diameterTop: 0.13, diameterBottom: 0.2, height: h * 0.22, tessellation: 6 }, scene), h * 0.33, s * r * 0.45, r * 0.25);
        // Folded wing: a thin swept slab standing off the back.
        const wing = add(MeshBuilder.CreateBox(name + "_wing", { width: r * 0.16, height: h * 0.52, depth: r * 1.0 }, scene), h * 0.62, s * r * 0.72, -r * 0.15);
        wing.rotation.set(0.18, 0, s * 0.22);
        const tip = add(MeshBuilder.CreateCylinder(name + "_wt", { diameterTop: 0, diameterBottom: r * 0.34, height: h * 0.3, tessellation: 3 }, scene), h * 0.92, s * r * 0.78, -r * 0.2);
        tip.rotation.z = s * 0.3;
      }
      add(MeshBuilder.CreateSphere(name + "_head", { diameter: r * 0.8, segments: 8 }, scene), h * 0.8, 0, r * 0.2);
      add(MeshBuilder.CreateBox(name + "_snout", { width: r * 0.36, height: h * 0.1, depth: r * 0.45 }, scene), h * 0.76, 0, r * 0.62);
      for (const s of [-1, 1]) {
        const horn = add(MeshBuilder.CreateCylinder(name + "_horn", { diameterTop: 0, diameterBottom: 0.13, height: h * 0.2, tessellation: 5 }, scene), h * 0.95, s * r * 0.26, 0);
        horn.rotation.z = s * 0.4;
        add(MeshBuilder.CreateSphere(name + "_eye", { diameter: 0.1, segments: 6 }, scene), h * 0.83, s * r * 0.22, r * 0.5).material = dark;
      }
      break;
    }
    case "candelabra": {
      const wax = mat(scene, "#e8e0c8");
      const flame = mat(scene, "#ffd479", 0.85);
      add(MeshBuilder.CreateCylinder(name + "_ft", { diameter: r * 1.7, height: h * 0.07, tessellation: 12 }, scene), h * 0.035);
      add(MeshBuilder.CreateCylinder(name + "_stem", { diameter: 0.09, height: h * 0.72, tessellation: 8 }, scene), h * 0.4);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const dx = Math.cos(a) * r * 0.66, dz = Math.sin(a) * r * 0.66;
        const armY = h * 0.7;
        const arm = add(MeshBuilder.CreateCylinder(name + "_arm" + i, { diameter: 0.06, height: r * 1.4, tessellation: 6 }, scene), armY, dx * 0.5, dz * 0.5);
        arm.rotation.set(Math.PI / 2, -a, 0.55);
        add(MeshBuilder.CreateCylinder(name + "_cup" + i, { diameter: r * 0.4, height: 0.06, tessellation: 8 }, scene), h * 0.79, dx, dz);
        add(MeshBuilder.CreateCylinder(name + "_wax" + i, { diameter: 0.13, height: h * 0.16, tessellation: 8 }, scene), h * 0.9, dx, dz).material = wax;
        add(MeshBuilder.CreateSphere(name + "_fl" + i, { diameter: 0.12, segments: 6 }, scene), h * 1.0, dx, dz).material = flame;
      }
      // The tall centre candle.
      add(MeshBuilder.CreateCylinder(name + "_waxc", { diameter: 0.15, height: h * 0.2, tessellation: 8 }, scene), h * 0.86).material = wax;
      add(MeshBuilder.CreateSphere(name + "_flc", { diameter: 0.14, segments: 6 }, scene), h * 0.99).material = flame;
      break;
    }
    case "cauldron": {
      const ember = mat(scene, "#ff7a3c", 0.7);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.5;
        const leg = add(MeshBuilder.CreateCylinder(name + "_lg" + i, { diameter: 0.1, height: h * 0.34, tessellation: 6 }, scene), h * 0.16, Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5);
        leg.rotation.set(Math.cos(a) * 0.2, 0, -Math.sin(a) * 0.2);
      }
      add(MeshBuilder.CreateSphere(name + "_belly", { diameter: r * 1.95, segments: 12 }, scene), h * 0.6).scaling.set(1, 0.72, 1);
      const rim = add(MeshBuilder.CreateTorus(name + "_rim", { diameter: r * 1.75, thickness: 0.08, tessellation: 14 }, scene), h * 0.86);
      rim.rotation.x = 0;
      add(MeshBuilder.CreateCylinder(name + "_brew", { diameter: r * 1.6, height: 0.05, tessellation: 14 }, scene), h * 0.85).material = ember;
      break;
    }
    case "brazier": {
      const ember = mat(scene, "#ff8a3a", 0.75);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const leg = add(MeshBuilder.CreateCylinder(name + "_lg" + i, { diameter: 0.09, height: h * 0.66, tessellation: 6 }, scene), h * 0.33, Math.cos(a) * r * 0.42, Math.sin(a) * r * 0.42);
        leg.rotation.set(Math.cos(a) * 0.24, 0, -Math.sin(a) * 0.24);
      }
      add(MeshBuilder.CreateCylinder(name + "_bowl", { diameterTop: r * 2.0, diameterBottom: r * 1.1, height: h * 0.3, tessellation: 14 }, scene), h * 0.8);
      add(MeshBuilder.CreateCylinder(name + "_coal", { diameter: r * 1.75, height: 0.06, tessellation: 14 }, scene), h * 0.93).material = ember;
      for (let i = 0; i < 3; i++) {
        add(MeshBuilder.CreateSphere(name + "_em" + i, { diameter: 0.11, segments: 6 }, scene), h * 0.97, (i - 1) * r * 0.45, (i % 2 ? 1 : -1) * r * 0.3).material = ember;
      }
      break;
    }
    case "scarecrow": {
      const sack = mat(scene, "#c9b487");
      const rag = mat(scene, "#4d4235");
      const dark = mat(scene, "#141416");
      add(MeshBuilder.CreateCylinder(name + "_post", { diameter: 0.15, height: h * 0.94, tessellation: 8 }, scene), h * 0.47);
      const bar = add(MeshBuilder.CreateCylinder(name + "_bar", { diameter: 0.11, height: r * 3.1, tessellation: 6 }, scene), h * 0.7);
      bar.rotation.z = Math.PI / 2;
      // Sagging coat over the crossbar.
      add(MeshBuilder.CreateBox(name + "_coat", { width: r * 1.7, height: h * 0.3, depth: r * 0.5 }, scene), h * 0.56).material = rag;
      for (const s of [-1, 1]) {
        add(MeshBuilder.CreateBox(name + "_cuff", { width: r * 0.5, height: h * 0.08, depth: r * 0.42 }, scene), h * 0.68, s * r * 1.3).material = rag;
        // Straw poking out of the sleeves.
        const straw = add(MeshBuilder.CreateCylinder(name + "_str", { diameterTop: 0.02, diameterBottom: 0.07, height: h * 0.1, tessellation: 5 }, scene), h * 0.63, s * r * 1.5);
        straw.rotation.z = s * 0.7;
      }
      add(MeshBuilder.CreateSphere(name + "_head", { diameter: r * 1.0, segments: 10 }, scene), h * 0.86).material = sack;
      for (const s of [-1, 1]) {
        add(MeshBuilder.CreateBox(name + "_eye", { width: 0.1, height: 0.1, depth: 0.06 }, scene), h * 0.88, s * r * 0.24, r * 0.42).material = dark;
      }
      add(MeshBuilder.CreateBox(name + "_mouth", { width: r * 0.5, height: 0.05, depth: 0.05 }, scene), h * 0.81, 0, r * 0.45).material = dark;
      add(MeshBuilder.CreateCylinder(name + "_brim", { diameter: r * 1.9, height: 0.05, tessellation: 12 }, scene), h * 0.93).material = rag;
      add(MeshBuilder.CreateCylinder(name + "_crown", { diameterTop: r * 0.7, diameterBottom: r * 0.85, height: h * 0.09, tessellation: 12 }, scene), h * 0.98).material = rag;
      break;
    }
    case "raven": {
      const stone = mat(scene, "#6a6760");
      const beak = mat(scene, "#c9a227");
      add(MeshBuilder.CreateCylinder(name + "_perch", { diameter: r * 1.5, height: h * 0.25, tessellation: 10 }, scene), h * 0.125).material = stone;
      add(MeshBuilder.CreateSphere(name + "_body", { diameter: r * 1.2, segments: 10 }, scene), h * 0.55).scaling.set(0.85, 1, 1.25);
      add(MeshBuilder.CreateSphere(name + "_head", { diameter: r * 0.62, segments: 8 }, scene), h * 0.83, 0, r * 0.24);
      const bk = add(MeshBuilder.CreateCylinder(name + "_beak", { diameterTop: 0, diameterBottom: 0.11, height: r * 0.55, tessellation: 6 }, scene), h * 0.81, 0, r * 0.62);
      bk.rotation.x = Math.PI / 2;
      bk.material = beak;
      const tail = add(MeshBuilder.CreateBox(name + "_tail", { width: r * 0.42, height: 0.06, depth: r * 1.0 }, scene), h * 0.5, 0, -r * 0.75);
      tail.rotation.x = -0.28;
      for (const s of [-1, 1]) {
        const wing = add(MeshBuilder.CreateBox(name + "_wing", { width: 0.06, height: r * 0.75, depth: r * 1.0 }, scene), h * 0.56, s * r * 0.5);
        wing.rotation.z = s * 0.16;
      }
      break;
    }
    case "bat": {
      // Roosting: hanging body, folded wings, ears. Small, so it hides in the
      // places nothing else fits.
      const stone = mat(scene, "#6a6760");
      const dark = mat(scene, "#141416");
      add(MeshBuilder.CreateCylinder(name + "_perch", { diameter: r * 1.6, height: h * 0.16, tessellation: 10 }, scene), h * 0.08).material = stone;
      add(MeshBuilder.CreateSphere(name + "_body", { diameter: r * 1.05, segments: 10 }, scene), h * 0.5).scaling.set(0.85, 1.15, 0.85);
      add(MeshBuilder.CreateSphere(name + "_head", { diameter: r * 0.72, segments: 8 }, scene), h * 0.84);
      for (const s of [-1, 1]) {
        const ear = add(MeshBuilder.CreateCylinder(name + "_ear", { diameterTop: 0, diameterBottom: r * 0.34, height: h * 0.28, tessellation: 5 }, scene), h * 0.99, s * r * 0.26);
        ear.rotation.z = s * 0.32;
        // Folded wing: a membrane hanging DOWN the flank, the way a roosting
        // bat wraps itself. Held out sideways it read as a collar.
        const wing = add(MeshBuilder.CreateBox(name + "_wing", { width: 0.06, height: h * 0.78, depth: r * 1.0 }, scene), h * 0.44, s * r * 0.52, -r * 0.02);
        wing.rotation.set(0, 0, s * 0.1);
        // Thumb claw hooked over the top of the wing.
        const claw = add(MeshBuilder.CreateCylinder(name + "_claw", { diameterTop: 0, diameterBottom: 0.08, height: h * 0.24, tessellation: 5 }, scene), h * 0.78, s * r * 0.58, -r * 0.1);
        claw.rotation.z = s * 0.75;
        add(MeshBuilder.CreateSphere(name + "_eye", { diameter: 0.08, segments: 6 }, scene), h * 0.86, s * r * 0.16, r * 0.3).material = dark;
      }
      break;
    }
    case "grave_sword": {
      // Driven into the earth up to the guard, the way a marker sword is.
      const earth = mat(scene, "#463a2c");
      const grip = mat(scene, "#3b2b1e");
      const gold = mat(scene, "#b08d3f");
      add(MeshBuilder.CreateCylinder(name + "_mound", { diameterTop: r * 1.5, diameterBottom: r * 2.1, height: h * 0.1, tessellation: 12 }, scene), h * 0.05).material = earth;
      add(MeshBuilder.CreateBox(name + "_blade", { width: r * 0.42, height: h * 0.62, depth: 0.07 }, scene), h * 0.4);
      add(MeshBuilder.CreateCylinder(name + "_tip", { diameterTop: 0, diameterBottom: r * 0.42, height: h * 0.12, tessellation: 4 }, scene), h * 0.77).scaling.set(1, 1, 0.18);
      const guard = add(MeshBuilder.CreateBox(name + "_guard", { width: r * 1.5, height: h * 0.05, depth: 0.11 }, scene), h * 0.72);
      guard.material = gold;
      add(MeshBuilder.CreateCylinder(name + "_grip", { diameter: 0.11, height: h * 0.18, tessellation: 8 }, scene), h * 0.82).material = grip;
      add(MeshBuilder.CreateSphere(name + "_pom", { diameter: 0.17, segments: 8 }, scene), h * 0.93).material = gold;
      break;
    }
    case "shield": {
      // Propped against nothing in particular, rotting where it was dropped.
      const boss = mat(scene, "#8b8f96");
      const face = add(MeshBuilder.CreateCylinder(name + "_face", { diameter: r * 2.0, height: 0.11, tessellation: 14 }, scene), h * 0.5);
      face.rotation.set(Math.PI / 2 - 0.22, 0, 0);
      face.scaling.set(1, 1, 1.12);
      const rim = add(MeshBuilder.CreateTorus(name + "_rim", { diameter: r * 2.0, thickness: 0.09, tessellation: 16 }, scene), h * 0.5);
      rim.rotation.set(Math.PI / 2 - 0.22, 0, 0);
      rim.scaling.set(1, 1, 1.12);
      rim.material = boss;
      const b = add(MeshBuilder.CreateSphere(name + "_boss", { diameter: r * 0.6, segments: 8 }, scene), h * 0.52, 0, r * 0.22);
      b.scaling.set(1, 1, 0.6);
      b.material = boss;
      // Two plank ribs so the face is not a blank disc.
      for (const s of [-1, 1]) {
        const plank = add(MeshBuilder.CreateBox(name + "_pl", { width: r * 0.24, height: r * 1.7, depth: 0.05 }, scene), h * 0.5, s * r * 0.55, r * 0.16);
        plank.rotation.x = -0.22;
        plank.material = boss;
      }
      break;
    }
    case "jack_o_lantern": {
      // The only warm thing in the yard. The cut face is emissive but kept under
      // the glow threshold, so it lights up without blooming across the screen.
      const cut = mat(scene, "#ffb03a", 0.55);
      const stem = mat(scene, "#4e5b28");
      add(MeshBuilder.CreateSphere(name + "_body", { diameter: r * 2.0, segments: 12 }, scene), h * 0.5).scaling.set(1, 0.6, 1);
      add(MeshBuilder.CreateCylinder(name + "_stem", { diameterTop: 0.08, diameterBottom: 0.14, height: h * 0.28, tessellation: 6 }, scene), h * 0.98).material = stem;
      // The face has to sit on the widest part of the shell. Placed lower it
      // ends up on the underside curve and reads as a smear of yellow rather
      // than as eyes.
      for (const s of [-1, 1]) {
        const eye = add(MeshBuilder.CreateCylinder(name + "_eye", { diameterTop: 0, diameterBottom: r * 0.72, height: 0.14, tessellation: 3 }, scene), h * 0.66, s * r * 0.42, r * 0.78);
        eye.rotation.set(Math.PI / 2, 0, Math.PI);
        eye.material = cut;
      }
      const nose = add(MeshBuilder.CreateCylinder(name + "_nose", { diameterTop: 0, diameterBottom: r * 0.4, height: 0.14, tessellation: 3 }, scene), h * 0.5, 0, r * 0.86);
      nose.rotation.x = Math.PI / 2;
      nose.material = cut;
      // A jagged grin: three teeth-gaps rather than one slot.
      for (const dx of [-0.42, 0, 0.42]) {
        add(MeshBuilder.CreateBox(name + "_tooth", { width: r * 0.34, height: h * 0.2, depth: 0.14 }, scene), h * 0.34, dx * r * 1.05, r * 0.8).material = cut;
      }
      add(MeshBuilder.CreateBox(name + "_grin", { width: r * 1.5, height: h * 0.08, depth: 0.14 }, scene), h * 0.28, 0, r * 0.8).material = cut;
      break;
    }
    case "grave_mound": {
      // A filled-in grave: heaped earth, a plank marker, and the spade still in it.
      const wood = mat(scene, "#5a4530");
      const steel = mat(scene, "#7d838b");
      add(MeshBuilder.CreateSphere(name + "_mound", { diameter: r * 2.0, segments: 12 }, scene), h * 0.12).scaling.set(1, 0.42, 1.35);
      // Plank cross at the head of the grave.
      add(MeshBuilder.CreateBox(name + "_mk", { width: r * 0.24, height: h * 1.7, depth: 0.09 }, scene), h * 0.85, 0, -r * 0.9).material = wood;
      add(MeshBuilder.CreateBox(name + "_mkx", { width: r * 0.9, height: 0.13, depth: 0.09 }, scene), h * 1.35, 0, -r * 0.9).material = wood;
      // The spade left standing in the heap: long handle, wide blade, clear lean.
      const shaft = add(MeshBuilder.CreateCylinder(name + "_sh", { diameter: 0.09, height: h * 2.2, tessellation: 6 }, scene), h * 1.15, r * 0.85, r * 0.35);
      shaft.rotation.z = 0.3;
      shaft.material = wood;
      add(MeshBuilder.CreateBox(name + "_grip", { width: r * 0.34, height: 0.1, depth: 0.09 }, scene), h * 2.2, r * 0.5, r * 0.35).material = wood;
      const blade = add(MeshBuilder.CreateBox(name + "_bl", { width: r * 0.55, height: h * 0.75, depth: 0.07 }, scene), h * 0.32, r * 1.1, r * 0.35);
      blade.rotation.z = 0.3;
      blade.material = steel;
      break;
    }
    case "stone_well": {
      const wood = mat(scene, "#4b3927");
      const dark = mat(scene, "#0d0f12");
      add(MeshBuilder.CreateCylinder(name + "_ring", { diameter: r * 2.0, height: h * 0.62, tessellation: 14 }, scene), h * 0.31);
      add(MeshBuilder.CreateTorus(name + "_cap", { diameter: r * 2.0, thickness: 0.14, tessellation: 16 }, scene), h * 0.62);
      add(MeshBuilder.CreateCylinder(name + "_hole", { diameter: r * 1.55, height: 0.05, tessellation: 14 }, scene), h * 0.61).material = dark;
      for (const s of [-1, 1]) {
        add(MeshBuilder.CreateBox(name + "_post", { width: 0.13, height: h * 0.42, depth: 0.13 }, scene), h * 0.83, s * r * 0.8).material = wood;
      }
      const beam = add(MeshBuilder.CreateCylinder(name + "_beam", { diameter: 0.13, height: r * 1.9, tessellation: 6 }, scene), h * 1.02);
      beam.rotation.z = Math.PI / 2;
      beam.material = wood;
      // Roof over the shaft, so the silhouette is not just a tube.
      const roof = add(MeshBuilder.CreateCylinder(name + "_roof", { diameterTop: 0, diameterBottom: r * 2.4, height: h * 0.22, tessellation: 4 }, scene), h * 1.1);
      roof.rotation.y = Math.PI / 4;
      roof.material = wood;
      break;
    }
    case "broken_pillar": {
      add(MeshBuilder.CreateBox(name + "_p", { width: r * 2.0, height: h * 0.13, depth: r * 2.0 }, scene), h * 0.065);
      add(MeshBuilder.CreateCylinder(name + "_shaft", { diameterTop: r * 1.35, diameterBottom: r * 1.5, height: h * 0.8, tessellation: 12 }, scene), h * 0.52);
      // Snapped at an angle, with a chunk fallen at the base.
      // A visibly diagonal break plus a spur of stone still standing, so the
      // silhouette says "snapped" and not "bollard".
      const top = add(MeshBuilder.CreateCylinder(name + "_snap", { diameter: r * 1.4, height: h * 0.2, tessellation: 12 }, scene), h * 0.93);
      top.rotation.z = 0.42;
      const spur = add(MeshBuilder.CreateCylinder(name + "_spur", { diameterTop: 0, diameterBottom: r * 0.75, height: h * 0.3, tessellation: 5 }, scene), h * 1.05, -r * 0.4);
      spur.rotation.z = 0.3;
      const chunk = add(MeshBuilder.CreateBox(name + "_chunk", { width: r * 0.8, height: h * 0.22, depth: r * 0.6 }, scene), h * 0.17, r * 1.15, r * 0.4);
      chunk.rotation.set(0.2, 0.6, 0.35);
      break;
    }
    case "coffin_open": {
      // Stood on end with the lid ajar. The tallest prop on the map and the one
      // hiders will fight over.
      const dark = mat(scene, "#0e1013");
      const lidMat = mat(scene, "#3d2d20");
      add(MeshBuilder.CreateBox(name + "_sh", { width: r * 1.55, height: h * 0.56, depth: r * 0.7 }, scene), h * 0.68);
      add(MeshBuilder.CreateBox(name + "_ft", { width: r * 1.1, height: h * 0.42, depth: r * 0.7 }, scene), h * 0.21);
      add(MeshBuilder.CreateBox(name + "_hd", { width: r * 1.25, height: h * 0.16, depth: r * 0.7 }, scene), h * 0.94);
      // The hollow.
      add(MeshBuilder.CreateBox(name + "_in", { width: r * 1.15, height: h * 0.82, depth: 0.1 }, scene), h * 0.55, 0, r * 0.33).material = dark;
      // Lid swung open on the left.
      const lid = add(MeshBuilder.CreateBox(name + "_lid", { width: r * 1.5, height: h * 0.9, depth: 0.09 }, scene), h * 0.55, -r * 1.15, r * 0.55);
      lid.rotation.y = -0.85;
      lid.material = lidMat;
      break;
    }
    // NOTE: everything below falls through to `default:` for a plain box.
    // Add new cases ABOVE this comment, never between here and `default:`.
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

/**
 * A goofy little cartoon character for hunters / undisguised players: a big
 * round head with googly eyes and a grin, a chubby team-coloured body, stubby
 * arms and legs, and a spinning-look propeller beanie. Faces +Z (its forward).
 */
export function createHunterVisual(scene: Scene, name: string, hex = "#ff7043", armed = false): TransformNode {
  const root = new TransformNode(name, scene);
  const skin = "#f4cfa4";
  const dark = "#2b2f38";
  const capHex = hex === "#37d9a0" ? "#ff7043" : "#37d9a0"; // contrasting beanie
  const add = (m: Mesh, hexColor: string, em = 0.1) => {
    m.parent = root;
    m.material = mat(scene, hexColor, em);
    m.checkCollisions = false;
    return m;
  };

  // Legs + feet.
  for (const dx of [-0.16, 0.16]) {
    add(MeshBuilder.CreateCylinder(name + "_leg", { diameter: 0.22, height: 0.5, tessellation: 10 }, scene), dark, 0.05).position.set(dx, 0.27, 0);
    const foot = add(MeshBuilder.CreateSphere(name + "_foot", { diameter: 0.26, segments: 8 }, scene), "#3a2b1a", 0.04);
    foot.position.set(dx, 0.07, 0.06);
    foot.scaling.set(1, 0.6, 1.5);
  }
  // Chubby torso (team colour).
  const torso = add(MeshBuilder.CreateCapsule(name + "_torso", { radius: 0.36, height: 0.95 }, scene), hex, 0.14);
  torso.position.y = 0.92;
  torso.scaling.set(1, 1, 0.9);
  // Big round head.
  add(MeshBuilder.CreateSphere(name + "_head", { diameter: 0.62, segments: 14 }, scene), skin, 0.1).position.y = 1.66;
  // Googly eyes (white + dark pupils) on the +Z face.
  for (const dx of [-0.13, 0.13]) {
    const eye = add(MeshBuilder.CreateSphere(name + "_eye", { diameter: 0.18, segments: 10 }, scene), "#ffffff", 0.25);
    eye.position.set(dx, 1.7, 0.24);
    eye.scaling.z = 0.6;
    add(MeshBuilder.CreateSphere(name + "_pupil", { diameter: 0.08, segments: 8 }, scene), "#161616", 0).position.set(dx, 1.7, 0.33);
  }
  // Grin.
  const grin = add(MeshBuilder.CreateTorus(name + "_grin", { diameter: 0.24, thickness: 0.035, tessellation: 12 }, scene), "#803030", 0.05);
  grin.position.set(0, 1.56, 0.27);
  grin.rotation.set(Math.PI / 2, 0, 0);
  grin.scaling.y = 0.6; // just the bottom arc reads as a smile

  // A little forearm segment helper (shoulder pivot → hand), so arms read as
  // holding something instead of poking straight out.
  const arm = (side: number, pos: [number, number, number], rot: [number, number, number]) => {
    const a = add(MeshBuilder.CreateCapsule(name + "_arm", { radius: 0.1, height: 0.5 }, scene), hex, 0.12);
    a.position.set(pos[0], pos[1], pos[2]);
    a.rotation.set(rot[0], rot[1], rot[2]);
    void side;
    return a;
  };
  const hand = (x: number, y: number, z: number) => add(MeshBuilder.CreateSphere(name + "_hand", { diameter: 0.17, segments: 8 }, scene), skin, 0.08).position.set(x, y, z);

  if (armed) {
    // ---- SEEKER: hunter cap, forward stance, gun held out + axe carried up ----
    // Red baseball cap (dome + forward brim) — clearly not a goofy prop.
    add(MeshBuilder.CreateSphere(name + "_cap", { diameter: 0.6, segments: 12, slice: 0.55 }, scene), "#c0392b", 0.13).position.set(0, 1.9, 0.02);
    add(MeshBuilder.CreateBox(name + "_brim", { width: 0.42, height: 0.05, depth: 0.26 }, scene), "#a5321f", 0.1).position.set(0, 1.82, 0.34);
    add(MeshBuilder.CreateSphere(name + "_capbtn", { diameter: 0.07, segments: 8 }, scene), "#7a2115", 0).position.set(0, 2.08, 0.02);
    // Dark chest strap for a tactical look.
    const strap = add(MeshBuilder.CreateBox(name + "_strap", { width: 0.1, height: 0.9, depth: 0.02 }, scene), dark, 0.05);
    strap.position.set(0.02, 0.95, 0.34);
    strap.rotation.z = 0.4;

    // RIGHT arm reaches forward, holding the blaster out in front.
    arm(1, [0.34, 1.0, 0.18], [-0.95, 0, 0.1]);
    hand(0.3, 0.82, 0.46);
    add(MeshBuilder.CreateBox(name + "_gun", { width: 0.16, height: 0.19, depth: 0.42 }, scene), "#22b58e", 0.18).position.set(0.3, 0.85, 0.62);
    const funnel = add(MeshBuilder.CreateCylinder(name + "_gunf", { diameterTop: 0.22, diameterBottom: 0.1, height: 0.18, tessellation: 14 }, scene), "#1c2530", 0.05);
    funnel.rotation.x = Math.PI / 2;
    funnel.position.set(0.3, 0.87, 0.86);
    add(MeshBuilder.CreateSphere(name + "_gunt", { diameter: 0.13, segments: 10 }, scene), "#ff7a3c", 0.85).position.set(0.3, 0.87, 0.96);
    add(MeshBuilder.CreateBox(name + "_gungrip", { width: 0.1, height: 0.18, depth: 0.12 }, scene), "#1c2530", 0.05).position.set(0.3, 0.72, 0.5);

    // LEFT arm bent up, carrying the axe head-up by the shoulder (not dragging).
    arm(-1, [-0.36, 1.06, 0.06], [-0.2, 0, -0.35]);
    hand(-0.42, 0.94, 0.24);
    add(MeshBuilder.CreateCylinder(name + "_axeh", { diameter: 0.06, height: 0.66, tessellation: 8 }, scene), "#5b3b22", 0.05).position.set(-0.44, 1.16, 0.24);
    add(MeshBuilder.CreateBox(name + "_axehd", { width: 0.08, height: 0.24, depth: 0.24 }, scene), "#8a9199", 0.14).position.set(-0.44, 1.52, 0.3);
    const blade = add(MeshBuilder.CreateCylinder(name + "_axebl", { diameterTop: 0, diameterBottom: 0.26, height: 0.16, tessellation: 3 }, scene), "#8a9199", 0.14);
    blade.rotation.x = Math.PI / 2;
    blade.position.set(-0.44, 1.52, 0.46);
    add(MeshBuilder.CreateSphere(name + "_axerune", { diameter: 0.07, segments: 8 }, scene), "#ff7a3c", 0.85).position.set(-0.4, 1.54, 0.36);
  } else {
    // ---- UNDISGUISED PROP: goofy propeller beanie, arms relaxed at the sides ----
    for (const side of [-1, 1] as const) {
      const a = add(MeshBuilder.CreateCapsule(name + "_arm", { radius: 0.1, height: 0.52 }, scene), hex, 0.12);
      a.position.set(side * 0.38, 0.9, 0.05);
      a.rotation.z = side * 0.14;
      hand(side * 0.44, 0.64, 0.08);
    }
    add(MeshBuilder.CreateSphere(name + "_cap", { diameter: 0.52, segments: 12, slice: 0.5 }, scene), capHex, 0.16).position.y = 1.9;
    add(MeshBuilder.CreateCylinder(name + "_capstick", { diameter: 0.05, height: 0.14, tessellation: 6 }, scene), dark, 0.05).position.y = 2.06;
    for (const ry of [0, Math.PI / 2]) {
      const blade = add(MeshBuilder.CreateBox(name + "_blade", { width: 0.34, height: 0.02, depth: 0.08 }, scene), "#e74c3c", 0.14);
      blade.position.y = 2.14;
      blade.rotation.y = ry;
    }
    add(MeshBuilder.CreateSphere(name + "_hub", { diameter: 0.09, segments: 8 }, scene), "#f1c40f", 0.2).position.y = 2.14;
  }
  return root;
}

export function setPropVisualCollisions(node: TransformNode, enabled: boolean): void {
  node.getChildMeshes().forEach((m) => {
    m.checkCollisions = enabled;
    m.isPickable = enabled;
  });
}

export function buildStaticProps(scene: Scene, map: MapDefinition): void {
  for (const spawn of map.props) {
    const node = createPropVisual(scene, spawn.modelKey, `static_${spawn.id}`);
    node.position.set(spawn.x, spawn.y, spawn.z);
    node.rotation.y = spawn.ry;
    setPropVisualCollisions(node, true);
  }
}

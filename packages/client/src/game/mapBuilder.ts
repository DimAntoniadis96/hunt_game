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
  shedRoof.material = mat(scene, "#7a3b2e", 0.1);
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
      // Mottled foliage instead of a flat green ball.
      leaf.material = texMat(scene, "#3f7d34", "grass", 2.2, 2.2, 0.1);
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
  const hedge = (x: number, z: number, W: number, D: number) => {
    const H = 1.7;
    // Foliage texture (not the structural grain) so hedges read as leafy.
    box("hedge", W, H, D, x, H / 2, z, "#3f7d34", true, 0.09).material = texMat(scene, "#3f7d34", "grass", 2.5, 2.5, 0.09);
    // Lighter top layer (decorative, non-colliding) so it looks bushy.
    box("hedgeTop", W + 0.25, 0.5, D + 0.25, x, H + 0.12, z, "#4f9e3a", false, 0.11).material = texMat(scene, "#4f9e3a", "grass", 2.5, 2.5, 0.11);
  };
  // South-central L (near the hunters' approach — first cover off the gate).
  hedge(-4, -20, 10, 0.9);
  hedge(1, -24, 0.9, 8);
  // Mid-west cover cluster.
  hedge(-16, -6, 0.9, 10);
  hedge(-20, -11, 9, 0.9);
  // Mid-east cover cluster.
  hedge(14, -3, 0.9, 10);
  hedge(18, 2, 9, 0.9);
  // Center-north screen.
  hedge(0, 15, 10, 0.9);
  // Long runs down the new east/west margins — chase lanes with cover.
  hedge(-41, -8, 0.9, 14);
  hedge(41, -6, 0.9, 14);
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

export function buildStaticProps(scene: Scene, map: MapDefinition): void {
  for (const spawn of map.props) {
    const node = createPropVisual(scene, spawn.modelKey, `static_${spawn.id}`);
    node.position.set(spawn.x, 0, spawn.z);
    node.rotation.y = spawn.ry;
    node.getChildMeshes().forEach((m) => (m.checkCollisions = true));
  }
}

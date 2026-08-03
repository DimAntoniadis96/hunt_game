/**
 * Map + prop definitions. These are DATA, not art — the client builds simple
 * procedural meshes from them for the prototype, and swaps in real glTF models
 * later by mapping `modelKey` -> an asset file. The server uses `bounds` for
 * anti-teleport checks and `props[]` as the authoritative whitelist of things a
 * player is allowed to disguise as.
 */

export interface PropModel {
  key: string;
  label: string;
  /** Collision cylinder radius & height (metres) applied when disguised. */
  radius: number;
  height: number;
  /** Rough tint for the procedural prototype mesh (hex). */
  color: string;
  /** If false, valid geometry but disallowed as a disguise (unfair/too small). */
  disguiseAllowed: boolean;
}

export interface PropSpawn {
  /** Stable id used by transform messages. */
  id: string;
  modelKey: string;
  x: number;
  y: number;
  z: number;
  /** Initial yaw (radians). */
  ry: number;
}

export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
  ry: number;
}

export interface MapBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * A solid, sight-blocking box in world space (axis-aligned). The SERVER uses
 * these to occlude shots and melee — a bullet/axe can't pass through a wall,
 * the house, a hedge, a car, etc. They must mirror the collidable meshes the
 * client builds in `mapBuilder`. (The disguise furniture in `props[]` already
 * self-occludes via the hitscan, so only structural geometry is listed here.)
 */
export interface Occluder {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface MapDefinition {
  id: string;
  displayName: string;
  /** Visual style the client builds the environment for. */
  theme: "warehouse" | "backyard" | "cemetery";
  /** Floor size for the procedural room (metres). */
  width: number;
  depth: number;
  wallHeight: number;
  bounds: MapBounds;
  hunterSpawns: SpawnPoint[];
  propSpawns: SpawnPoint[];
  props: PropSpawn[];
  /** Solid structures that block line-of-sight for shots + melee. */
  occluders: Occluder[];
}

/** Build an Occluder from footprint centre (cx,cz), width W (x), depth D (z), height H. */
function occ(cx: number, cz: number, W: number, D: number, H: number): Occluder {
  return { minX: cx - W / 2, maxX: cx + W / 2, minY: 0, maxY: H, minZ: cz - D / 2, maxZ: cz + D / 2 };
}

/** Registry of prop models keyed by `modelKey`. */
export const PROP_MODELS: Record<string, PropModel> = {
  // ---- Warehouse / generic ----
  crate_small: { key: "crate_small", label: "Small Crate", radius: 0.45, height: 0.9, color: "#b5793a", disguiseAllowed: true },
  crate_large: { key: "crate_large", label: "Large Crate", radius: 0.7, height: 1.4, color: "#9c6631", disguiseAllowed: true },
  barrel: { key: "barrel", label: "Barrel", radius: 0.42, height: 1.15, color: "#3d6ea5", disguiseAllowed: true },
  bucket: { key: "bucket", label: "Bucket", radius: 0.3, height: 0.5, color: "#c0392b", disguiseAllowed: true },
  toolbox: { key: "toolbox", label: "Toolbox", radius: 0.5, height: 0.55, color: "#c0392b", disguiseAllowed: true },
  pallet_stack: { key: "pallet_stack", label: "Pallet Stack", radius: 0.75, height: 1.1, color: "#a07840", disguiseAllowed: true },
  traffic_cone: { key: "traffic_cone", label: "Traffic Cone", radius: 0.28, height: 0.7, color: "#e8792b", disguiseAllowed: true },
  tire: { key: "tire", label: "Stacked Tires", radius: 0.5, height: 0.8, color: "#222831", disguiseAllowed: true },
  plant: { key: "plant", label: "Potted Plant", radius: 0.4, height: 1.2, color: "#3f8f4f", disguiseAllowed: true },
  bin: { key: "bin", label: "Waste Bin", radius: 0.4, height: 1.05, color: "#4a5d4a", disguiseAllowed: true },

  // ---- Backyard / outdoor ----
  bush: { key: "bush", label: "Bush", radius: 0.6, height: 0.95, color: "#4a7c3a", disguiseAllowed: true },
  rock: { key: "rock", label: "Rock", radius: 0.55, height: 0.6, color: "#8a8d91", disguiseAllowed: true },
  trash_can: { key: "trash_can", label: "Trash Can", radius: 0.35, height: 1.0, color: "#3c4a3a", disguiseAllowed: true },
  mailbox: { key: "mailbox", label: "Mailbox", radius: 0.3, height: 1.15, color: "#43525f", disguiseAllowed: true },
  fire_hydrant: { key: "fire_hydrant", label: "Fire Hydrant", radius: 0.3, height: 0.85, color: "#c0392b", disguiseAllowed: true },
  propane_tank: { key: "propane_tank", label: "Propane Tank", radius: 0.34, height: 1.2, color: "#d8dde2", disguiseAllowed: true },
  cooler: { key: "cooler", label: "Cooler", radius: 0.5, height: 0.6, color: "#2e86c1", disguiseAllowed: true },
  flower_pot: { key: "flower_pot", label: "Flower Pot", radius: 0.35, height: 0.7, color: "#b5651d", disguiseAllowed: true },
  garden_gnome: { key: "garden_gnome", label: "Garden Gnome", radius: 0.3, height: 0.65, color: "#2e7d32", disguiseAllowed: true },
  bench: { key: "bench", label: "Garden Bench", radius: 0.85, height: 0.85, color: "#6b4f2a", disguiseAllowed: true },
  dog_house: { key: "dog_house", label: "Dog House", radius: 0.7, height: 1.05, color: "#8b5a2b", disguiseAllowed: true },
  bird_bath: { key: "bird_bath", label: "Bird Bath", radius: 0.45, height: 1.05, color: "#9aa0a6", disguiseAllowed: true },
  ac_unit: { key: "ac_unit", label: "AC Unit", radius: 0.55, height: 0.8, color: "#b0b6bd", disguiseAllowed: true },
  planter: { key: "planter", label: "Planter Box", radius: 0.6, height: 0.6, color: "#7a5230", disguiseAllowed: true },

  // ---- Fun / whimsical (great for decoy clusters) ----
  flamingo: { key: "flamingo", label: "Pink Flamingo", radius: 0.32, height: 1.2, color: "#ff8fbf", disguiseAllowed: true },
  rubber_duck: { key: "rubber_duck", label: "Giant Rubber Duck", radius: 0.5, height: 0.85, color: "#ffd92e", disguiseAllowed: true },
  beach_ball: { key: "beach_ball", label: "Beach Ball", radius: 0.45, height: 0.9, color: "#e74c3c", disguiseAllowed: true },
  bbq_grill: { key: "bbq_grill", label: "BBQ Grill", radius: 0.5, height: 1.05, color: "#2b2b2b", disguiseAllowed: true },
  watering_can: { key: "watering_can", label: "Watering Can", radius: 0.38, height: 0.65, color: "#3fa07f", disguiseAllowed: true },
  wheelbarrow: { key: "wheelbarrow", label: "Wheelbarrow", radius: 0.6, height: 0.7, color: "#c0392b", disguiseAllowed: true },
  pumpkin: { key: "pumpkin", label: "Pumpkin", radius: 0.45, height: 0.55, color: "#e67e22", disguiseAllowed: true },
  soccer_ball: { key: "soccer_ball", label: "Soccer Ball", radius: 0.34, height: 0.68, color: "#ecf0f1", disguiseAllowed: true },
  snowman: { key: "snowman", label: "Snowman (in July?!)", radius: 0.5, height: 1.6, color: "#f4f7fb", disguiseAllowed: true },
  cactus: { key: "cactus", label: "Potted Cactus", radius: 0.35, height: 1.15, color: "#3f8f4f", disguiseAllowed: true },
  lawn_chair: { key: "lawn_chair", label: "Lawn Chair", radius: 0.55, height: 0.72, color: "#2e86c1", disguiseAllowed: true },
  dog_bowl: { key: "dog_bowl", label: "Dog Bowl", radius: 0.36, height: 0.34, color: "#7f8c8d", disguiseAllowed: true },

  // ---- Small / detail items ----
  tree_stump: { key: "tree_stump", label: "Tree Stump", radius: 0.5, height: 0.6, color: "#6b4a2a", disguiseAllowed: true },
  portrait: { key: "portrait", label: "Framed Portrait", radius: 0.45, height: 1.0, color: "#b8860b", disguiseAllowed: true },
  watermelon: { key: "watermelon", label: "Watermelon", radius: 0.4, height: 0.52, color: "#2e7d32", disguiseAllowed: true },
  teapot: { key: "teapot", label: "Teapot", radius: 0.4, height: 0.58, color: "#dfe6e9", disguiseAllowed: true },
  lantern: { key: "lantern", label: "Lantern", radius: 0.28, height: 0.75, color: "#34495e", disguiseAllowed: true },
  mushroom: { key: "mushroom", label: "Toadstool", radius: 0.35, height: 0.7, color: "#e74c3c", disguiseAllowed: true },
  birdhouse: { key: "birdhouse", label: "Birdhouse", radius: 0.34, height: 0.85, color: "#a0763f", disguiseAllowed: true },
  picnic_basket: { key: "picnic_basket", label: "Picnic Basket", radius: 0.45, height: 0.5, color: "#c49a5a", disguiseAllowed: true },

  // Present in the world but NOT allowed as a disguise (too small / would be unfair).
  bolt: { key: "bolt", label: "Bolt", radius: 0.05, height: 0.05, color: "#888888", disguiseAllowed: false },
  // ---- Cemetery ----
  headstone: { key: "headstone", label: "Headstone", radius: 0.45, height: 1.0, color: "#5b6068", disguiseAllowed: true },
  grave_cross: { key: "grave_cross", label: "Grave Cross", radius: 0.35, height: 1.3, color: "#666c73", disguiseAllowed: true },
  urn: { key: "urn", label: "Stone Urn", radius: 0.34, height: 0.8, color: "#6b675e", disguiseAllowed: true },
  angel_statue: { key: "angel_statue", label: "Stone Angel", radius: 0.45, height: 1.7, color: "#7b8087", disguiseAllowed: true },
  coffin: { key: "coffin", label: "Coffin", radius: 0.7, height: 0.6, color: "#4a3729", disguiseAllowed: true },
};

/** First shipping map: a compact original warehouse. */
export const DEPOT_7: MapDefinition = {
  id: "depot7",
  displayName: "Depot 7",
  theme: "warehouse",
  width: 34,
  depth: 34,
  wallHeight: 6,
  bounds: { minX: -17.5, maxX: 17.5, minZ: -17.5, maxZ: 17.5 },
  hunterSpawns: [
    { x: 0, y: 0, z: -14, ry: 0 },
    { x: -2, y: 0, z: -14, ry: 0 },
    { x: 2, y: 0, z: -14, ry: 0 },
    { x: 0, y: 0, z: -12, ry: 0 },
  ],
  propSpawns: [
    { x: 0, y: 0, z: 12, ry: Math.PI },
    { x: 6, y: 0, z: 10, ry: Math.PI },
    { x: -6, y: 0, z: 10, ry: Math.PI },
    { x: 10, y: 0, z: 6, ry: Math.PI },
    { x: -10, y: 0, z: 6, ry: Math.PI },
    { x: 0, y: 0, z: 8, ry: Math.PI },
  ],
  props: [
    { id: "p01", modelKey: "crate_large", x: 8, y: 0, z: 4, ry: 0 },
    { id: "p02", modelKey: "crate_small", x: 9.2, y: 0, z: 5.5, ry: 0.3 },
    { id: "p03", modelKey: "barrel", x: -7, y: 0, z: 6, ry: 0 },
    { id: "p04", modelKey: "barrel", x: -8, y: 0, z: 7.2, ry: 0 },
    { id: "p05", modelKey: "pallet_stack", x: 12, y: 0, z: -3, ry: 0 },
    { id: "p06", modelKey: "toolbox", x: -12, y: 0, z: -2, ry: 1.2 },
    { id: "p07", modelKey: "bucket", x: 4, y: 0, z: -6, ry: 0 },
    { id: "p08", modelKey: "traffic_cone", x: -4, y: 0, z: -8, ry: 0 },
    { id: "p09", modelKey: "tire", x: 13, y: 0, z: 9, ry: 0 },
    { id: "p10", modelKey: "plant", x: -13, y: 0, z: 10, ry: 0 },
    { id: "p11", modelKey: "bin", x: 14, y: 0, z: -10, ry: 0 },
    { id: "p12", modelKey: "crate_small", x: -14, y: 0, z: -10, ry: 0.8 },
    { id: "p13", modelKey: "crate_large", x: 0, y: 0, z: 14, ry: 0 },
    { id: "p14", modelKey: "barrel", x: 2, y: 0, z: 15, ry: 0 },
    { id: "p15", modelKey: "pallet_stack", x: -3, y: 0, z: 0, ry: 0.5 },
    { id: "p16", modelKey: "crate_small", x: 6, y: 0, z: -12, ry: 0 },
  ],
  // Perimeter walls (crates self-occlude as furniture via the hitscan).
  occluders: [
    occ(0, -17.5, 34, 0.5, 6),
    occ(0, 17.5, 34, 0.5, 6),
    occ(-17.5, 0, 0.5, 34, 6),
    occ(17.5, 0, 0.5, 34, 6),
  ],
};

/** Backyard hedge cover as non-overlapping axis-aligned boxes. L-corners touch
 * at their edges instead of interpenetrating, which avoids flickering faces. */
export const BACKYARD_HEDGES: Occluder[] = [
  // South-central L.
  occ(-4, -20, 10, 0.9, 1.7),
  occ(1, -24.225, 0.9, 7.55, 1.7),
  // Mid-west cover cluster.
  occ(-16, -5.775, 0.9, 9.55, 1.7),
  occ(-20, -11, 9, 0.9, 1.7),
  // Mid-east cover cluster.
  occ(14, -3.225, 0.9, 9.55, 1.7),
  occ(18, 2, 9, 0.9, 1.7),
  // Center-north screen.
  occ(0, 15, 10, 0.9, 1.7),
  // Long runs down the east/west margins.
  occ(-41, -8, 0.9, 14, 1.7),
  occ(41, -6, 0.9, 14, 1.7),
];

/**
 * Second map: an original suburban backyard. Grass, a fence, a house, a shed and
 * trees, with plenty of natural props to hide as.
 */
export const BACKYARD: MapDefinition = {
  id: "backyard",
  displayName: "Sunnyside Yard",
  theme: "backyard",
  width: 96,
  depth: 88,
  wallHeight: 2,
  // Big fully-fenced yard; the house sits inside the north edge. Enlarged east/
  // west/south to give props more ground to run across and hedge cover to break
  // line of sight (see mapBuilder hedges).
  bounds: { minX: -46, maxX: 46, minZ: -44, maxZ: 30 },
  // Hunters break out from the south gate.
  hunterSpawns: [
    { x: -9, y: 0, z: -35, ry: 0 },
    { x: -6, y: 0, z: -35, ry: 0 },
    { x: -3, y: 0, z: -35, ry: 0 },
    { x: 0, y: 0, z: -35, ry: 0 },
    { x: 3, y: 0, z: -35, ry: 0 },
    { x: 6, y: 0, z: -35, ry: 0 },
    { x: 9, y: 0, z: -35, ry: 0 },
    { x: 0, y: 0, z: -33, ry: 0 },
  ],
  // Props scatter across the zones to hide.
  propSpawns: [
    { x: 0, y: 0, z: 0, ry: Math.PI },
    { x: 12, y: 0, z: 10, ry: Math.PI },
    { x: -12, y: 0, z: 8, ry: Math.PI },
    { x: 22, y: 0, z: -4, ry: Math.PI },
    { x: -22, y: 0, z: -4, ry: Math.PI },
    { x: 10, y: 0, z: 20, ry: Math.PI },
    { x: -10, y: 0, z: 20, ry: Math.PI },
    { x: 24, y: 0, z: -22, ry: Math.PI },
  ],
  props: [
    // ---- Patio / near the house (north, z ~ 22-28) ----
    { id: "b01", modelKey: "bbq_grill", x: 7, y: 0, z: 25, ry: 0 },
    { id: "b02", modelKey: "cooler", x: 10.5, y: 0, z: 25, ry: 0.2 },
    // Trash-can row (decoy cluster)
    { id: "b03", modelKey: "trash_can", x: 15, y: 0, z: 26, ry: 0 },
    { id: "b04", modelKey: "trash_can", x: 16.2, y: 0, z: 26, ry: 0 },
    { id: "b05", modelKey: "trash_can", x: 17.4, y: 0, z: 26, ry: 0 },
    { id: "b06", modelKey: "ac_unit", x: -16, y: 0, z: 26.5, ry: 0 },
    // Flower-pot row (decoy cluster)
    { id: "b07", modelKey: "flower_pot", x: -9, y: 0, z: 25.5, ry: 0 },
    { id: "b08", modelKey: "flower_pot", x: -7.7, y: 0, z: 25.5, ry: 0 },
    { id: "b09", modelKey: "flower_pot", x: -6.4, y: 0, z: 25.5, ry: 0 },
    { id: "b10", modelKey: "flower_pot", x: -5.1, y: 0, z: 25.5, ry: 0 },
    { id: "b11", modelKey: "cactus", x: 1, y: 0, z: 25, ry: 0 },
    { id: "b12", modelKey: "lawn_chair", x: 3, y: 0, z: 21, ry: 0.1 },
    { id: "b13", modelKey: "lawn_chair", x: 5, y: 0, z: 21, ry: -0.1 },

    // ---- Vegetable garden (north-east) ----
    { id: "b14", modelKey: "wheelbarrow", x: 26, y: 0, z: 20, ry: 0.6 },
    { id: "b15", modelKey: "watering_can", x: 22, y: 0, z: 18, ry: 0 },
    { id: "b16", modelKey: "watering_can", x: 23.2, y: 0, z: 18.4, ry: 0.5 },
    { id: "b17", modelKey: "planter", x: 24, y: 0, z: 24, ry: 0 },
    { id: "b18", modelKey: "planter", x: 26.5, y: 0, z: 24, ry: 0 },
    // Pumpkin patch (decoy cluster)
    { id: "b19", modelKey: "pumpkin", x: 30, y: 0, z: 14, ry: 0 },
    { id: "b20", modelKey: "pumpkin", x: 31.3, y: 0, z: 14.6, ry: 0.4 },
    { id: "b21", modelKey: "pumpkin", x: 29.5, y: 0, z: 15.4, ry: 0.9 },
    { id: "b22", modelKey: "pumpkin", x: 31, y: 0, z: 16.2, ry: 1.3 },
    { id: "b23", modelKey: "pumpkin", x: 32.4, y: 0, z: 15, ry: 0.2 },

    // ---- Pool area (east) ----
    { id: "b24", modelKey: "beach_ball", x: 24, y: 0, z: 4, ry: 0 },
    { id: "b25", modelKey: "beach_ball", x: 25.2, y: 0, z: 5.1, ry: 0 },
    { id: "b26", modelKey: "beach_ball", x: 23.4, y: 0, z: 6, ry: 0 },
    { id: "b27", modelKey: "rubber_duck", x: 33, y: 0, z: 1, ry: -0.5 },
    { id: "b28", modelKey: "lawn_chair", x: 34, y: 0, z: -3, ry: 1.4 },
    { id: "b29", modelKey: "lawn_chair", x: 34, y: 0, z: 0, ry: 1.4 },
    { id: "b30", modelKey: "cooler", x: 21, y: 0, z: -5, ry: 0 },

    // ---- Play area (south-east) ----
    { id: "b31", modelKey: "soccer_ball", x: 19, y: 0, z: -19, ry: 0 },
    { id: "b32", modelKey: "soccer_ball", x: 20.3, y: 0, z: -20, ry: 0 },
    { id: "b33", modelKey: "soccer_ball", x: 18.4, y: 0, z: -21, ry: 0 },
    { id: "b34", modelKey: "dog_house", x: 15, y: 0, z: -14, ry: -0.6 },
    { id: "b35", modelKey: "dog_bowl", x: 13, y: 0, z: -13, ry: 0 },

    // ---- Driveway / gate (south) ----
    { id: "b36", modelKey: "mailbox", x: -15, y: 0, z: -35.5, ry: 0 },
    { id: "b37", modelKey: "fire_hydrant", x: 15, y: 0, z: -35.5, ry: 0 },
    // Traffic-cone cluster (decoy)
    { id: "b38", modelKey: "traffic_cone", x: 18, y: 0, z: -30, ry: 0 },
    { id: "b39", modelKey: "traffic_cone", x: 19.2, y: 0, z: -30.6, ry: 0 },
    { id: "b40", modelKey: "traffic_cone", x: 17.2, y: 0, z: -31, ry: 0 },

    // ---- Tool corner / shed (south-west) ----
    { id: "b41", modelKey: "propane_tank", x: -26, y: 0, z: -31, ry: 0 },
    { id: "b42", modelKey: "propane_tank", x: -24.8, y: 0, z: -30.2, ry: 0 },
    // Barrel cluster (decoy)
    { id: "b43", modelKey: "barrel", x: -21, y: 0, z: -31, ry: 0 },
    { id: "b44", modelKey: "barrel", x: -22.2, y: 0, z: -31.6, ry: 0 },
    { id: "b45", modelKey: "barrel", x: -20.2, y: 0, z: -32, ry: 0 },
    // Tire stack (decoy)
    { id: "b46", modelKey: "tire", x: -28, y: 0, z: -24, ry: 0 },
    { id: "b47", modelKey: "tire", x: -26.8, y: 0, z: -24.5, ry: 0 },
    { id: "b48", modelKey: "crate_large", x: -24, y: 0, z: -26, ry: 0.4 },
    { id: "b49", modelKey: "crate_small", x: -22.4, y: 0, z: -25.4, ry: 0.9 },
    { id: "b50", modelKey: "bucket", x: -30, y: 0, z: -22, ry: 0 },

    // ---- Garden / decor strip (west) ----
    // Gnome army (decoy cluster of 5!)
    { id: "b51", modelKey: "garden_gnome", x: -31, y: 0, z: 1, ry: 0 },
    { id: "b52", modelKey: "garden_gnome", x: -30, y: 0, z: 2, ry: 0.3 },
    { id: "b53", modelKey: "garden_gnome", x: -32, y: 0, z: 2.2, ry: -0.3 },
    { id: "b54", modelKey: "garden_gnome", x: -30.5, y: 0, z: 0, ry: 0.6 },
    { id: "b55", modelKey: "garden_gnome", x: -32.2, y: 0, z: 0.6, ry: -0.5 },
    // Flamingo flock (decoy cluster)
    { id: "b56", modelKey: "flamingo", x: -24, y: 0, z: 7, ry: 0.2 },
    { id: "b57", modelKey: "flamingo", x: -22.8, y: 0, z: 8, ry: -0.3 },
    { id: "b58", modelKey: "flamingo", x: -25, y: 0, z: 8.6, ry: 0.5 },
    { id: "b59", modelKey: "flamingo", x: -23.6, y: 0, z: 9.6, ry: 0 },
    { id: "b60", modelKey: "snowman", x: -19, y: 0, z: 14, ry: 0 },
    { id: "b61", modelKey: "bench", x: -30, y: 0, z: 11, ry: 0.2 },
    // Bushes along west fence
    { id: "b62", modelKey: "bush", x: -36, y: 0, z: 12, ry: 0 },
    { id: "b63", modelKey: "bush", x: -36, y: 0, z: 4, ry: 0 },
    { id: "b64", modelKey: "bush", x: -36, y: 0, z: -4, ry: 0 },
    { id: "b65", modelKey: "bush", x: -36, y: 0, z: -12, ry: 0 },
    // Bushes along east fence
    { id: "b66", modelKey: "bush", x: 36, y: 0, z: 10, ry: 0 },
    { id: "b67", modelKey: "bush", x: 36, y: 0, z: -14, ry: 0 },

    // ---- Center lawn ----
    { id: "b68", modelKey: "bird_bath", x: -2, y: 0, z: 6, ry: 0 },
    { id: "b69", modelKey: "rock", x: 5, y: 0, z: 4, ry: 0.5 },
    { id: "b70", modelKey: "rock", x: 6.2, y: 0, z: 5, ry: 1.4 },
    { id: "b71", modelKey: "rock", x: 4.4, y: 0, z: 5.6, ry: 0.8 },
    { id: "b72", modelKey: "garden_gnome", x: 6, y: 0, z: -6, ry: 0 },

    // ---- Small / detail items (scattered) ----
    { id: "b73", modelKey: "tree_stump", x: 12, y: 0, z: 9.5, ry: 0 },
    { id: "b74", modelKey: "tree_stump", x: -8, y: 0, z: 10, ry: 0.6 },
    { id: "b75", modelKey: "birdhouse", x: 9, y: 0, z: 10, ry: 0 },
    { id: "b76", modelKey: "portrait", x: -3.5, y: 0, z: 25.2, ry: 0 },
    { id: "b77", modelKey: "portrait", x: 20, y: 0, z: 25.2, ry: -0.2 },
    { id: "b78", modelKey: "teapot", x: 2, y: 0, z: 22.5, ry: 0 },
    { id: "b79", modelKey: "picnic_basket", x: -5, y: 0, z: -7.2, ry: 0.4 },
    { id: "b80", modelKey: "watermelon", x: -6.5, y: 0, z: -5.5, ry: 0 },
    { id: "b81", modelKey: "watermelon", x: 29, y: 0, z: 17, ry: 0.3 },
    { id: "b82", modelKey: "lantern", x: -2, y: 0, z: -2, ry: 0 },
    { id: "b83", modelKey: "lantern", x: 2, y: 0, z: -14, ry: 0 },
    { id: "b84", modelKey: "mushroom", x: -29, y: 0, z: 3.5, ry: 0 },
    { id: "b85", modelKey: "mushroom", x: -27.5, y: 0, z: 4.5, ry: 0.5 },
    { id: "b86", modelKey: "teapot", x: 24.5, y: 0, z: 22, ry: 0.2 },

    // ---- Cover-adjacent props (blend in right next to the hedges) ----
    { id: "b87", modelKey: "bush", x: 3, y: 0, z: -20, ry: 0 },
    { id: "b88", modelKey: "bush", x: -16, y: 0, z: 1, ry: 0 },
    { id: "b89", modelKey: "bush", x: 14, y: 0, z: 4, ry: 0 },
    { id: "b90", modelKey: "bush", x: -6, y: 0, z: 15, ry: 0 },
    { id: "b91", modelKey: "rock", x: 6.5, y: 0, z: 15, ry: 0.7 },
    { id: "b92", modelKey: "planter", x: 22, y: 0, z: 2.5, ry: 0 },
    { id: "b93", modelKey: "trash_can", x: -42, y: 0, z: -2, ry: 0 },
    { id: "b94", modelKey: "trash_can", x: -42, y: 0, z: -14, ry: 0 },
    { id: "b95", modelKey: "flower_pot", x: -8, y: 0, z: 20, ry: 0 },
    { id: "b96", modelKey: "bush", x: 41, y: 0, z: -12, ry: 0 },
  ],
  // Structural sight-blockers (mirror the collidable meshes in mapBuilder).
  occluders: [
    // Perimeter fence (pushed out by half its thickness; inner faces on bounds).
    occ(0, -44.3, 92.6, 0.6, 1.9), // south
    occ(0, 30.3, 92.6, 0.6, 1.9), // north
    occ(-46.3, -7, 0.6, 74.6, 1.9), // west
    occ(46.3, -7, 0.6, 74.6, 1.9), // east
    // Buildings.
    occ(0, 29.5, 40, 7, 6.5), // house
    occ(-30, -28, 5, 4.5, 2.8), // shed
    // Cars in the driveway.
    occ(-14, -38, 4.2, 1.9, 2.0),
    occ(14, -38, 4.2, 1.9, 2.0),
    // Tree trunks.
    occ(10, 12, 0.8, 0.8, 3), occ(-10, 12, 0.8, 0.8, 3), occ(0, -14, 0.8, 0.8, 3),
    occ(-34, 20, 0.8, 0.8, 3), occ(34, 26, 0.8, 0.8, 3), occ(13, -22, 0.8, 0.8, 3),
    // Hedges (chest/head-high cover, H=1.7).
    ...BACKYARD_HEDGES,
    // Low brick garden walls (H=0.9 — taller props peek over them).
    occ(-14, 20, 11, 0.6, 0.9),
    occ(24, -33, 8, 0.6, 0.9),
  ],
};

/** Solid structures on the cemetery — mirrors the collidable meshes the
 *  client builds in mapBuilder's buildCemetery(). */
export const CEMETERY_STRUCTURES: Occluder[] = [
  occ(0, -28.6, 68.0, 0.8, 2.6), // wall_s
  occ(0, 28.6, 68.0, 0.8, 2.6), // wall_n
  occ(-33.6, 0, 0.8, 58.0, 2.6), // wall_w
  occ(33.6, 0, 0.8, 58.0, 2.6), // wall_e
  occ(0, 20.0, 16.0, 11.0, 7.0), // chapel
  occ(0, 13.6, 6.0, 2.2, 3.4), // chapel_porch
  occ(22.0, -13.0, 6.0, 5.0, 3.4), // crypt_e0
  occ(22.0, -3.0, 6.0, 5.0, 3.4), // crypt_e1
  occ(22.0, 7.0, 6.0, 5.0, 3.4), // crypt_e2
  occ(-22.0, -8.0, 5.5, 5.5, 3.0), // crypt_w0
  occ(-23.0, 6.0, 4.5, 6.5, 2.8), // crypt_w1
  occ(-24.0, -20.0, 7.0, 5.0, 2.8), // shed
  occ(-17.5, -21.0, 3.0, 3.0, 2.2), // lean_to
  occ(-6.0, -2.0, 0.7, 14.0, 1.6), // divider_a
  occ(9.0, 4.0, 0.7, 12.0, 1.6), // divider_b
  occ(4.0, -14.0, 13.0, 0.7, 1.5), // divider_c
  occ(-13.0, 14.0, 1.1, 1.1, 5.5), // tree0
  occ(14.0, -20.0, 1.1, 1.1, 5.5), // tree1
  occ(-30.0, 18.0, 1.1, 1.1, 5.5), // tree2
  occ(28.0, 21.0, 1.1, 1.1, 5.5), // tree3
  occ(-3.0, -24.0, 1.1, 1.1, 5.5), // tree4
];

/** Dead trees (x, z) — the client draws trunks and bare branches here. */
export const CEMETERY_TREES: Array<[number, number]> = [
  [-13.0, 14.0], [14.0, -20.0], [-30.0, 18.0], [28.0, 21.0], [-3.0, -24.0],
];

export const HOLLOW_ROW: MapDefinition = {
  id: "hollow_row",
  displayName: "Hollow Row",
  theme: "cemetery",
  width: 68.0,
  depth: 58.0,
  wallHeight: 3.0,
  bounds: { minX: -34.0, maxX: 34.0, minZ: -29.0, maxZ: 29.0 },
  hunterSpawns: [
    { x: -9, y: 0, z: -26.0, ry: 0 },
    { x: -6, y: 0, z: -26.0, ry: 0 },
    { x: -3, y: 0, z: -26.0, ry: 0 },
    { x: 0, y: 0, z: -26.0, ry: 0 },
    { x: 3, y: 0, z: -26.0, ry: 0 },
    { x: 6, y: 0, z: -26.0, ry: 0 },
    { x: 9, y: 0, z: -26.0, ry: 0 },
    { x: 0.0, y: 0, z: -23.5, ry: 0 },
  ],
  propSpawns: [
    { x: -14.0, y: 0, z: -6.0, ry: Math.PI },
    { x: 13.0, y: 0, z: -8.0, ry: Math.PI },
    { x: -16.0, y: 0, z: 2.0, ry: Math.PI },
    { x: 16.0, y: 0, z: 12.0, ry: Math.PI },
    { x: -9.0, y: 0, z: 22.0, ry: Math.PI },
    { x: 7.0, y: 0, z: 24.0, ry: Math.PI },
    { x: -27.0, y: 0, z: -12.0, ry: Math.PI },
    { x: 27.0, y: 0, z: -22.0, ry: Math.PI },
  ],
  props: [
    { id: "c00", modelKey: "headstone", x: -18.21, y: 0, z: -17.73, ry: 0.019 },
    { id: "c01", modelKey: "grave_cross", x: -16.03, y: 0, z: -17.98, ry: 0.041 },
    { id: "c02", modelKey: "headstone", x: -13.54, y: 0, z: -18.26, ry: 0.045 },
    { id: "c03", modelKey: "headstone", x: -11.23, y: 0, z: -17.98, ry: 0.016 },
    { id: "c04", modelKey: "urn", x: -8.71, y: 0, z: -17.95, ry: -0.044 },
    { id: "c05", modelKey: "headstone", x: -6.32, y: 0, z: -17.76, ry: -0.025 },
    { id: "c06", modelKey: "grave_cross", x: -4.16, y: 0, z: -18.0, ry: -0.009 },
    { id: "c07", modelKey: "headstone", x: -23.24, y: 0, z: -13.79, ry: -0.043 },
    { id: "c08", modelKey: "headstone", x: -20.71, y: 0, z: -13.48, ry: -0.044 },
    { id: "c09", modelKey: "grave_cross", x: -18.46, y: 0, z: -13.58, ry: 0.04 },
    { id: "c10", modelKey: "headstone", x: -15.82, y: 0, z: -13.4, ry: -0.039 },
    { id: "c11", modelKey: "headstone", x: -13.72, y: 0, z: -13.74, ry: 0.037 },
    { id: "c12", modelKey: "headstone", x: -11.18, y: 0, z: -13.49, ry: -0.042 },
    { id: "c13", modelKey: "headstone", x: -8.87, y: 0, z: -13.44, ry: -0.025 },
    { id: "c14", modelKey: "headstone", x: -6.41, y: 0, z: -13.68, ry: 0.035 },
    { id: "c15", modelKey: "headstone", x: -3.99, y: 0, z: -13.6, ry: -0.005 },
    { id: "c16", modelKey: "headstone", x: -28.22, y: 0, z: -8.94, ry: 0.044 },
    { id: "c17", modelKey: "headstone", x: -25.61, y: 0, z: -9.23, ry: -0.046 },
    { id: "c18", modelKey: "headstone", x: -18.51, y: 0, z: -8.93, ry: -0.001 },
    { id: "c19", modelKey: "headstone", x: -16.11, y: 0, z: -8.73, ry: 0.041 },
    { id: "c20", modelKey: "urn", x: -13.53, y: 0, z: -8.75, ry: 0.008 },
    { id: "c21", modelKey: "headstone", x: -11.27, y: 0, z: -8.86, ry: 0.037 },
    { id: "c22", modelKey: "headstone", x: -8.7, y: 0, z: -8.78, ry: 0.031 },
    { id: "c23", modelKey: "headstone", x: -3.94, y: 0, z: -9.01, ry: -0.021 },
    { id: "c24", modelKey: "headstone", x: 1.09, y: 0, z: -19.95, ry: 0.017 },
    { id: "c25", modelKey: "headstone", x: 3.32, y: 0, z: -19.72, ry: 0.044 },
    { id: "c26", modelKey: "headstone", x: 5.63, y: 0, z: -19.97, ry: -0.028 },
    { id: "c27", modelKey: "headstone", x: 8.26, y: 0, z: -19.94, ry: 0.024 },
    { id: "c28", modelKey: "grave_cross", x: 10.39, y: 0, z: -20.17, ry: 0.047 },
    { id: "c29", modelKey: "headstone", x: 15.48, y: 0, z: -20.05, ry: 0.02 },
    { id: "c30", modelKey: "headstone", x: 0.96, y: 0, z: -16.06, ry: 0.006 },
    { id: "c31", modelKey: "grave_cross", x: 3.61, y: 0, z: -16.26, ry: 0.042 },
    { id: "c32", modelKey: "headstone", x: 5.77, y: 0, z: -16.22, ry: 0.049 },
    { id: "c33", modelKey: "headstone", x: 8.13, y: 0, z: -15.76, ry: 0.005 },
    { id: "c34", modelKey: "headstone", x: 10.62, y: 0, z: -16.15, ry: 0.048 },
    { id: "c35", modelKey: "headstone", x: 12.93, y: 0, z: -15.93, ry: -0.041 },
    { id: "c36", modelKey: "headstone", x: 15.61, y: 0, z: -16.21, ry: -0.048 },
    { id: "c37", modelKey: "headstone", x: -17.4, y: 0, z: 9.85, ry: 3.144 },
    { id: "c38", modelKey: "headstone", x: -15.05, y: 0, z: 10.29, ry: 3.166 },
    { id: "c39", modelKey: "headstone", x: -12.73, y: 0, z: 9.98, ry: 3.154 },
    { id: "c40", modelKey: "urn", x: -10.57, y: 0, z: 9.85, ry: 3.158 },
    { id: "c41", modelKey: "headstone", x: -20.0, y: 0, z: 15.16, ry: 3.14 },
    { id: "c42", modelKey: "headstone", x: -17.39, y: 0, z: 14.96, ry: 3.131 },
    { id: "c43", modelKey: "headstone", x: -15.23, y: 0, z: 15.04, ry: 3.129 },
    { id: "c44", modelKey: "headstone", x: -10.35, y: 0, z: 15.15, ry: 3.094 },
    { id: "c45", modelKey: "grave_cross", x: 9.16, y: 0, z: 14.79, ry: 3.12 },
    { id: "c46", modelKey: "headstone", x: 11.4, y: 0, z: 14.85, ry: 3.16 },
    { id: "c47", modelKey: "headstone", x: 13.9, y: 0, z: 14.94, ry: 3.172 },
    { id: "c48", modelKey: "angel_statue", x: 19.81, y: 0, z: 16.52, ry: 5.518 },
    { id: "c49", modelKey: "angel_statue", x: 6.05, y: 0, z: 10.26, ry: 5.218 },
    { id: "c50", modelKey: "angel_statue", x: -22.99, y: 0, z: -3.24, ry: 1.011 },
    { id: "c51", modelKey: "angel_statue", x: -4.41, y: 0, z: -1.08, ry: 5.841 },
    { id: "c52", modelKey: "coffin", x: 25.94, y: 0, z: -7.26, ry: 2.791 },
    { id: "c53", modelKey: "coffin", x: -22.26, y: 0, z: 0.71, ry: 6.201 },
    { id: "c54", modelKey: "coffin", x: -9.9, y: 0, z: 4.15, ry: 4.2 },
    { id: "c55", modelKey: "wheelbarrow", x: -28.36, y: 0, z: -23.03, ry: 5.372 },
    { id: "c56", modelKey: "wheelbarrow", x: -30.07, y: 0, z: -22.59, ry: 4.127 },
    { id: "c57", modelKey: "barrel", x: -26.98, y: 0, z: -25.01, ry: 2.346 },
    { id: "c58", modelKey: "barrel", x: -17.04, y: 0, z: -26.42, ry: 4.182 },
    { id: "c59", modelKey: "barrel", x: -30.32, y: 0, z: -23.77, ry: 3.663 },
    { id: "c60", modelKey: "barrel", x: -18.23, y: 0, z: -26.2, ry: 5.823 },
    { id: "c61", modelKey: "crate_small", x: -14.11, y: 0, z: -25.78, ry: 2.493 },
    { id: "c62", modelKey: "crate_small", x: -18.2, y: 0, z: -24.31, ry: 3.531 },
    { id: "c63", modelKey: "crate_small", x: -25.77, y: 0, z: -25.54, ry: 1.365 },
    { id: "c64", modelKey: "crate_small", x: -24.43, y: 0, z: -25.6, ry: 5.501 },
    { id: "c65", modelKey: "crate_large", x: -11.92, y: 0, z: -23.34, ry: 1.53 },
    { id: "c66", modelKey: "crate_large", x: -22.63, y: 0, z: -24.8, ry: 3.945 },
    { id: "c67", modelKey: "bucket", x: -21.75, y: 0, z: -26.07, ry: 2.658 },
    { id: "c68", modelKey: "bucket", x: -15.1, y: 0, z: -23.9, ry: 4.763 },
    { id: "c69", modelKey: "bucket", x: -26.22, y: 0, z: -23.4, ry: 3.417 },
    { id: "c70", modelKey: "toolbox", x: -29.94, y: 0, z: -26.47, ry: 5.539 },
    { id: "c71", modelKey: "toolbox", x: -28.56, y: 0, z: -24.58, ry: 1.38 },
    { id: "c72", modelKey: "pallet_stack", x: -20.26, y: 0, z: -25.24, ry: 0.009 },
    { id: "c73", modelKey: "pallet_stack", x: -15.49, y: 0, z: -25.45, ry: 4.865 },
    { id: "c74", modelKey: "tire", x: -11.81, y: 0, z: -25.74, ry: 1.554 },
    { id: "c75", modelKey: "tire", x: -20.09, y: 0, z: -23.63, ry: 2.246 },
    { id: "c76", modelKey: "cooler", x: -16.52, y: 0, z: -24.39, ry: 1.599 },
    { id: "c77", modelKey: "headstone", x: -7.14, y: 0, z: -7.15, ry: 4.361 },
    { id: "c78", modelKey: "headstone", x: -9.13, y: 0, z: 6.22, ry: 1.375 },
    { id: "c79", modelKey: "headstone", x: 29.69, y: 0, z: -6.67, ry: 4.307 },
    { id: "c80", modelKey: "headstone", x: -14.53, y: 0, z: -9.79, ry: 4.803 },
    { id: "c81", modelKey: "headstone", x: -14.62, y: 0, z: -11.28, ry: 5.793 },
    { id: "c82", modelKey: "headstone", x: -12.07, y: 0, z: 4.31, ry: 4.211 },
    { id: "c83", modelKey: "headstone", x: 28.53, y: 0, z: -8.55, ry: 0.3 },
    { id: "c84", modelKey: "headstone", x: -4.24, y: 0, z: -6.45, ry: 2.687 },
    { id: "c85", modelKey: "headstone", x: -16.03, y: 0, z: -14.57, ry: 5.049 },
    { id: "c86", modelKey: "headstone", x: -27.22, y: 0, z: 12.52, ry: 4.529 },
    { id: "c87", modelKey: "urn", x: -15.15, y: 0, z: 6.22, ry: 4.313 },
    { id: "c88", modelKey: "urn", x: -17.44, y: 0, z: 22.44, ry: 1.364 },
    { id: "c89", modelKey: "urn", x: -27.24, y: 0, z: 7.96, ry: 5.008 },
    { id: "c90", modelKey: "urn", x: 4.18, y: 0, z: -17.41, ry: 3.261 },
    { id: "c91", modelKey: "urn", x: 10.47, y: 0, z: 16.81, ry: 0.193 },
    { id: "c92", modelKey: "urn", x: -20.17, y: 0, z: 23.38, ry: 1.443 },
    { id: "c93", modelKey: "grave_cross", x: 28.94, y: 0, z: -23.69, ry: 5.657 },
    { id: "c94", modelKey: "grave_cross", x: 15.65, y: 0, z: 16.8, ry: 4.386 },
    { id: "c95", modelKey: "grave_cross", x: -9.02, y: 0, z: -21.37, ry: 5.609 },
    { id: "c96", modelKey: "grave_cross", x: -21.83, y: 0, z: 19.39, ry: 3.552 },
    { id: "c97", modelKey: "grave_cross", x: -1.84, y: 0, z: -19.78, ry: 3.805 },
    { id: "c98", modelKey: "rock", x: 20.06, y: 0, z: -24.8, ry: 4.928 },
    { id: "c99", modelKey: "rock", x: 14.9, y: 0, z: -17.91, ry: 0.774 },
    { id: "c100", modelKey: "rock", x: 11.83, y: 0, z: 22.89, ry: 0.359 },
    { id: "c101", modelKey: "rock", x: -5.98, y: 0, z: -21.11, ry: 3.736 },
    { id: "c102", modelKey: "rock", x: -24.58, y: 0, z: 1.79, ry: 1.366 },
    { id: "c103", modelKey: "rock", x: -0.08, y: 0, z: 10.57, ry: 0.624 },
    { id: "c104", modelKey: "rock", x: 28.67, y: 0, z: 11.31, ry: 2.834 },
    { id: "c105", modelKey: "rock", x: -13.8, y: 0, z: 9.29, ry: 3.784 },
    { id: "c106", modelKey: "rock", x: -3.12, y: 0, z: -12.31, ry: 2.941 },
    { id: "c107", modelKey: "tree_stump", x: 1.44, y: 0, z: 9.73, ry: 4.867 },
    { id: "c108", modelKey: "tree_stump", x: -14.67, y: 0, z: -0.72, ry: 3.242 },
    { id: "c109", modelKey: "tree_stump", x: 9.93, y: 0, z: -10.7, ry: 5.837 },
    { id: "c110", modelKey: "tree_stump", x: 26.18, y: 0, z: -5.05, ry: 3.707 },
    { id: "c111", modelKey: "tree_stump", x: 13.44, y: 0, z: -25.47, ry: 5.3 },
    { id: "c112", modelKey: "tree_stump", x: -3.3, y: 0, z: -19.35, ry: 4.829 },
    { id: "c113", modelKey: "lantern", x: 15.77, y: 0, z: -25.89, ry: 1.163 },
    { id: "c114", modelKey: "lantern", x: -14.67, y: 0, z: 25.4, ry: 4.355 },
    { id: "c115", modelKey: "lantern", x: 13.65, y: 0, z: 0.56, ry: 4.484 },
    { id: "c116", modelKey: "lantern", x: 30.93, y: 0, z: -7.84, ry: 4.847 },
    { id: "c117", modelKey: "lantern", x: -10.38, y: 0, z: 25.53, ry: 3.862 },
    { id: "c118", modelKey: "lantern", x: 0.42, y: 0, z: 8.32, ry: 4.067 },
    { id: "c119", modelKey: "lantern", x: -21.73, y: 0, z: 23.85, ry: 2.93 },
    { id: "c120", modelKey: "lantern", x: -28.31, y: 0, z: -2.27, ry: 3.302 },
    { id: "c121", modelKey: "bench", x: 17.35, y: 0, z: 8.29, ry: 4.3 },
    { id: "c122", modelKey: "bench", x: -24.66, y: 0, z: 11.75, ry: 6.239 },
    { id: "c123", modelKey: "bench", x: -28.78, y: 0, z: -19.68, ry: 1.693 },
    { id: "c124", modelKey: "bench", x: 13.98, y: 0, z: 23.42, ry: 0.772 },
    { id: "c125", modelKey: "bench", x: 30.85, y: 0, z: -9.26, ry: 2.302 },
    { id: "c126", modelKey: "flower_pot", x: 6.5, y: 0, z: 5.06, ry: 1.195 },
    { id: "c127", modelKey: "flower_pot", x: 11.73, y: 0, z: 20.03, ry: 2.17 },
    { id: "c128", modelKey: "flower_pot", x: 2.42, y: 0, z: 7.98, ry: 5.97 },
    { id: "c129", modelKey: "flower_pot", x: 11.04, y: 0, z: 18.07, ry: 1.365 },
  ],
  occluders: CEMETERY_STRUCTURES,
};

export const MAPS: Record<string, MapDefinition> = {
  [DEPOT_7.id]: DEPOT_7,
  [BACKYARD.id]: BACKYARD,
  [HOLLOW_ROW.id]: HOLLOW_ROW,
};

export const DEFAULT_MAP_ID = BACKYARD.id;

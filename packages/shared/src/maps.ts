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
  /** One line shown under the name in the map picker. */
  tagline: string;
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
  // ---- Cemetery: horror props -----------------------------------------------
  // Everything Hollow Row places comes from this group. Deliberately no crates,
  // barrels, buckets or tyres: a stack of pallets in a graveyard reads as a
  // placeholder, and a hider who becomes one is announcing themselves.
  headstone: { key: "headstone", label: "Headstone", radius: 0.45, height: 1.0, color: "#5b6068", disguiseAllowed: true },
  grave_cross: { key: "grave_cross", label: "Grave Cross", radius: 0.35, height: 1.3, color: "#666c73", disguiseAllowed: true },
  urn: { key: "urn", label: "Stone Urn", radius: 0.34, height: 0.8, color: "#6b675e", disguiseAllowed: true },
  angel_statue: { key: "angel_statue", label: "Stone Angel", radius: 0.45, height: 1.7, color: "#7b8087", disguiseAllowed: true },
  coffin: { key: "coffin", label: "Coffin", radius: 0.7, height: 0.6, color: "#4a3729", disguiseAllowed: true },
  skull: { key: "skull", label: "Skull", radius: 0.26, height: 0.34, color: "#ddd6c2", disguiseAllowed: true },
  bone_pile: { key: "bone_pile", label: "Pile of Bones", radius: 0.55, height: 0.42, color: "#d5cdb8", disguiseAllowed: true },
  skeleton: { key: "skeleton", label: "Skeleton", radius: 0.42, height: 1.75, color: "#d8d2c0", disguiseAllowed: true },
  sarcophagus: { key: "sarcophagus", label: "Sarcophagus", radius: 0.85, height: 0.95, color: "#7d7669", disguiseAllowed: true },
  gargoyle: { key: "gargoyle", label: "Gargoyle", radius: 0.46, height: 1.3, color: "#6f7378", disguiseAllowed: true },
  candelabra: { key: "candelabra", label: "Candelabra", radius: 0.3, height: 1.35, color: "#4a4a52", disguiseAllowed: true },
  cauldron: { key: "cauldron", label: "Cauldron", radius: 0.52, height: 0.8, color: "#2f3238", disguiseAllowed: true },
  brazier: { key: "brazier", label: "Brazier", radius: 0.44, height: 1.05, color: "#4a4038", disguiseAllowed: true },
  scarecrow: { key: "scarecrow", label: "Scarecrow", radius: 0.45, height: 2.0, color: "#6b5a3c", disguiseAllowed: true },
  raven: { key: "raven", label: "Raven", radius: 0.3, height: 0.6, color: "#1d1f24", disguiseAllowed: true },
  bat: { key: "bat", label: "Roosting Bat", radius: 0.32, height: 0.58, color: "#2a2530", disguiseAllowed: true },
  grave_sword: { key: "grave_sword", label: "Buried Sword", radius: 0.3, height: 1.45, color: "#8b8f96", disguiseAllowed: true },
  shield: { key: "shield", label: "Rotted Shield", radius: 0.42, height: 1.05, color: "#5a4632", disguiseAllowed: true },
  jack_o_lantern: { key: "jack_o_lantern", label: "Jack-o'-Lantern", radius: 0.44, height: 0.55, color: "#b85a1c", disguiseAllowed: true },
  grave_mound: { key: "grave_mound", label: "Fresh Grave", radius: 0.82, height: 0.55, color: "#4a3c2e", disguiseAllowed: true },
  stone_well: { key: "stone_well", label: "Old Well", radius: 0.88, height: 1.15, color: "#6d6a63", disguiseAllowed: true },
  broken_pillar: { key: "broken_pillar", label: "Broken Pillar", radius: 0.42, height: 1.15, color: "#7a746a", disguiseAllowed: true },
  coffin_open: { key: "coffin_open", label: "Open Casket", radius: 0.62, height: 1.9, color: "#4f3b2b", disguiseAllowed: true },
};

/** First shipping map: a compact original warehouse. */
export const DEPOT_7: MapDefinition = {
  id: "depot7",
  tagline: "Tight industrial floor. Nowhere far to run.",
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
  tagline: "A wide suburban garden in full daylight.",
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

/**
 * Hollow Row's solid geometry — generated by tools/gen_cemetery.py.
 *
 * The client builds its meshes from this array and the server derives its
 * occluders from the same entries, so the thing you see and the thing that
 * stops a bullet cannot drift apart. `kind` only selects a material.
 */
export interface CemeteryBlock {
  /** Footprint centre. */
  x: number;
  z: number;
  /** Footprint size on x and z, and height from the ground. */
  w: number;
  d: number;
  h: number;
  kind: "wall" | "pillar" | "altar" | "gable" | "tomb" | "plot" | "shed" | "obelisk" | "tree";
}

export const CEMETERY_BLOCKS: CemeteryBlock[] = [
  { x: 0.0, z: -24.6, w: 60.0, d: 0.8, h: 2.8, kind: "wall" }, // perim_s
  { x: 0.0, z: 24.6, w: 60.0, d: 0.8, h: 2.8, kind: "wall" }, // perim_n
  { x: -29.6, z: 0.0, w: 0.8, d: 50.0, h: 2.8, kind: "wall" }, // perim_w
  { x: 29.6, z: 0.0, w: 0.8, d: 50.0, h: 2.8, kind: "wall" }, // perim_e
  { x: -25.5, z: 4.0, w: 9.0, d: 0.7, h: 3.2, kind: "wall" }, // chapel_s_a
  { x: -10.5, z: 4.0, w: 13.0, d: 0.7, h: 3.2, kind: "wall" }, // chapel_s_b
  { x: -4.0, z: 9.5, w: 0.7, d: 11.0, h: 3.2, kind: "wall" }, // chapel_e_a
  { x: -4.0, z: 22.0, w: 0.7, d: 6.0, h: 3.2, kind: "wall" }, // chapel_e_b
  { x: 6.5, z: 4.0, w: 5.0, d: 0.7, h: 3.2, kind: "wall" }, // alley_s_a
  { x: 21.5, z: 4.0, w: 17.0, d: 0.7, h: 3.2, kind: "wall" }, // alley_s_b
  { x: 4.0, z: 11.5, w: 0.7, d: 15.0, h: 3.2, kind: "wall" }, // alley_w_a
  { x: 4.0, z: 24.0, w: 0.7, d: 2.0, h: 3.2, kind: "wall" }, // alley_w_b
  { x: -26.5, z: -4.0, w: 7.0, d: 0.7, h: 3.2, kind: "wall" }, // plots_n_a
  { x: -11.5, z: -4.0, w: 15.0, d: 0.7, h: 3.2, kind: "wall" }, // plots_n_b
  { x: -4.0, z: -21.75, w: 0.7, d: 6.5, h: 3.2, kind: "wall" }, // plots_e_a
  { x: -4.0, z: -9.25, w: 0.7, d: 10.5, h: 3.2, kind: "wall" }, // plots_e_b
  { x: 7.5, z: -4.0, w: 7.0, d: 0.7, h: 3.2, kind: "wall" }, // yard_n_a
  { x: 22.5, z: -4.0, w: 15.0, d: 0.7, h: 3.2, kind: "wall" }, // yard_n_b
  { x: 4.0, z: -18.5, w: 0.7, d: 13.0, h: 3.2, kind: "wall" }, // yard_w_a
  { x: 4.0, z: -6.0, w: 0.7, d: 4.0, h: 3.2, kind: "wall" }, // yard_w_b
  { x: -22.0, z: 9.5, w: 0.9, d: 0.9, h: 4.2, kind: "pillar" }, // chapel_colw0
  { x: -11.0, z: 9.5, w: 0.9, d: 0.9, h: 4.2, kind: "pillar" }, // chapel_cole0
  { x: -22.0, z: 13.5, w: 0.9, d: 0.9, h: 4.2, kind: "pillar" }, // chapel_colw1
  { x: -11.0, z: 13.5, w: 0.9, d: 0.9, h: 4.2, kind: "pillar" }, // chapel_cole1
  { x: -22.0, z: 17.5, w: 0.9, d: 0.9, h: 4.2, kind: "pillar" }, // chapel_colw2
  { x: -11.0, z: 17.5, w: 0.9, d: 0.9, h: 4.2, kind: "pillar" }, // chapel_cole2
  { x: -22.0, z: 21.0, w: 0.9, d: 0.9, h: 4.2, kind: "pillar" }, // chapel_colw3
  { x: -11.0, z: 21.0, w: 0.9, d: 0.9, h: 4.2, kind: "pillar" }, // chapel_cole3
  { x: -16.5, z: 22.0, w: 5.0, d: 1.4, h: 1.2, kind: "altar" }, // chapel_altar
  { x: -16.5, z: 23.9, w: 13.0, d: 0.9, h: 8.0, kind: "gable" }, // chapel_gable
  { x: -27.0, z: 15.0, w: 2.4, d: 3.2, h: 1.0, kind: "wall" }, // chapel_rubble
  { x: 10.5, z: 15.0, w: 4.8, d: 11.0, h: 3.6, kind: "tomb" }, // tomb0
  { x: 17.5, z: 15.0, w: 4.8, d: 11.0, h: 3.6, kind: "tomb" }, // tomb1
  { x: 24.5, z: 15.0, w: 4.8, d: 11.0, h: 3.6, kind: "tomb" }, // tomb2
  { x: -23.0, z: -21.0, w: 8.0, d: 0.5, h: 1.1, kind: "plot" }, // plot0_s
  { x: -23.0, z: -15.0, w: 8.0, d: 0.5, h: 1.1, kind: "plot" }, // plot0_n
  { x: -27.0, z: -18.0, w: 0.5, d: 6.0, h: 1.1, kind: "plot" }, // plot0_w
  { x: -11.5, z: -21.0, w: 8.0, d: 0.5, h: 1.1, kind: "plot" }, // plot1_s
  { x: -11.5, z: -15.0, w: 8.0, d: 0.5, h: 1.1, kind: "plot" }, // plot1_n
  { x: -15.5, z: -18.0, w: 0.5, d: 6.0, h: 1.1, kind: "plot" }, // plot1_w
  { x: -23.0, z: -12.0, w: 8.0, d: 0.5, h: 1.1, kind: "plot" }, // plot2_s
  { x: -23.0, z: -6.0, w: 8.0, d: 0.5, h: 1.1, kind: "plot" }, // plot2_n
  { x: -27.0, z: -9.0, w: 0.5, d: 6.0, h: 1.1, kind: "plot" }, // plot2_w
  { x: 22.0, z: -19.0, w: 8.0, d: 6.0, h: 3.0, kind: "shed" }, // shed
  { x: 14.5, z: -20.5, w: 3.4, d: 3.4, h: 2.2, kind: "shed" }, // lean_to
  { x: 24.0, z: -9.0, w: 6.0, d: 1.0, h: 1.4, kind: "plot" }, // yard_stack
  { x: 0.0, z: 0.0, w: 2.2, d: 2.2, h: 6.0, kind: "obelisk" }, // obelisk
  { x: -6.5, z: 8.0, w: 1.1, d: 1.1, h: 5.5, kind: "tree" }, // tree0
  { x: 6.5, z: -8.0, w: 1.1, d: 1.1, h: 5.5, kind: "tree" }, // tree1
  { x: -6.5, z: -20.0, w: 1.1, d: 1.1, h: 5.5, kind: "tree" }, // tree2
  { x: 6.5, z: 20.0, w: 1.1, d: 1.1, h: 5.5, kind: "tree" }, // tree3
];

/** Occluders derived from the blocks above — never hand-written. */
export const CEMETERY_STRUCTURES: Occluder[] = CEMETERY_BLOCKS.map((b) =>
  occ(b.x, b.z, b.w, b.d, b.h),
);

/** Dead trees (x, z) — the client draws trunks and bare branches here. */
export const CEMETERY_TREES: Array<[number, number]> = [
  [-6.5, 8.0], [6.5, -8.0], [-6.5, -20.0], [6.5, 20.0],
];

export const HOLLOW_ROW: MapDefinition = {
  id: "hollow_row",
  displayName: "Hollow Row",
  tagline: "Four walled rooms around a crossing. Midnight, and fog.",
  theme: "cemetery",
  width: 60.0,
  depth: 50.0,
  wallHeight: 3.0,
  bounds: { minX: -30.0, maxX: 30.0, minZ: -25.0, maxZ: 25.0 },
  hunterSpawns: [
    { x: -3.0, y: 0, z: -22.5, ry: 0 },
    { x: -1.5, y: 0, z: -22.5, ry: 0 },
    { x: 0.0, y: 0, z: -22.5, ry: 0 },
    { x: 1.5, y: 0, z: -22.5, ry: 0 },
    { x: 3.0, y: 0, z: -22.5, ry: 0 },
    { x: -2.0, y: 0, z: -20.0, ry: 0 },
    { x: 0.0, y: 0, z: -20.0, ry: 0 },
    { x: 2.0, y: 0, z: -20.0, ry: 0 },
  ],
  propSpawns: [
    { x: -16.0, y: 0, z: 12.0, ry: Math.PI },
    { x: -13.0, y: 0, z: 20.0, ry: Math.PI },
    { x: 13.5, y: 0, z: 11.5, ry: Math.PI },
    { x: 21.0, y: 0, z: 17.5, ry: Math.PI },
    { x: -16.5, y: 0, z: -22.5, ry: Math.PI },
    { x: -25.5, y: 0, z: -12.8, ry: Math.PI },
    { x: 11.0, y: 0, z: -13.0, ry: Math.PI },
    { x: 25.0, y: 0, z: -23.0, ry: Math.PI },
  ],
  props: [
    { id: "c00", modelKey: "candelabra", x: -20.4, y: 0, z: 22.4, ry: 5.446 },
    { id: "c01", modelKey: "candelabra", x: -12.6, y: 0, z: 22.4, ry: 1.515 },
    { id: "c02", modelKey: "lantern", x: 14.0, y: 0, z: 8.6, ry: 3.964 },
    { id: "c03", modelKey: "lantern", x: 21.0, y: 0, z: 8.6, ry: 0.4 },
    { id: "c04", modelKey: "lantern", x: 14.0, y: 0, z: 15.0, ry: 1.896 },
    { id: "c05", modelKey: "lantern", x: 21.0, y: 0, z: 15.0, ry: 4.121 },
    { id: "c06", modelKey: "lantern", x: 14.0, y: 0, z: 21.4, ry: 4.264 },
    { id: "c07", modelKey: "lantern", x: 21.0, y: 0, z: 21.4, ry: 4.457 },
    { id: "c08", modelKey: "brazier", x: 14.0, y: 0, z: 22.6, ry: 5.31 },
    { id: "c09", modelKey: "brazier", x: 21.0, y: 0, z: 22.6, ry: 4.905 },
    { id: "c10", modelKey: "lantern", x: -5.2, y: 0, z: -19.0, ry: 1.155 },
    { id: "c11", modelKey: "lantern", x: 5.2, y: 0, z: 11.0, ry: 0.902 },
    { id: "c12", modelKey: "lantern", x: -5.2, y: 0, z: 17.0, ry: 5.44 },
    { id: "c13", modelKey: "lantern", x: 5.2, y: 0, z: -10.0, ry: 3.598 },
    { id: "c14", modelKey: "lantern", x: -18.0, y: 0, z: -5.3, ry: 3.666 },
    { id: "c15", modelKey: "lantern", x: 13.0, y: 0, z: 5.3, ry: 5.56 },
    { id: "c16", modelKey: "bench", x: -19.6, y: 0, z: 10.0, ry: 0.0 },
    { id: "c17", modelKey: "bench", x: -13.4, y: 0, z: 10.0, ry: 0.0 },
    { id: "c18", modelKey: "bench", x: -19.6, y: 0, z: 12.4, ry: 0.0 },
    { id: "c19", modelKey: "bench", x: -19.6, y: 0, z: 14.8, ry: 0.0 },
    { id: "c20", modelKey: "bench", x: -13.4, y: 0, z: 14.8, ry: 0.0 },
    { id: "c21", modelKey: "bench", x: -19.6, y: 0, z: 17.2, ry: 0.0 },
    { id: "c22", modelKey: "bench", x: -19.6, y: 0, z: 19.6, ry: 0.0 },
    { id: "c23", modelKey: "candelabra", x: -8.22, y: 0, z: 19.13, ry: 5.965 },
    { id: "c24", modelKey: "candelabra", x: -9.72, y: 0, z: 17.36, ry: 3.944 },
    { id: "c25", modelKey: "broken_pillar", x: -25.54, y: 0, z: 17.63, ry: 1.025 },
    { id: "c26", modelKey: "broken_pillar", x: -24.59, y: 0, z: 16.67, ry: 0.386 },
    { id: "c27", modelKey: "broken_pillar", x: -23.54, y: 0, z: 12.25, ry: 0.463 },
    { id: "c28", modelKey: "urn", x: -24.37, y: 0, z: 15.42, ry: 2.546 },
    { id: "c29", modelKey: "urn", x: -16.59, y: 0, z: 20.26, ry: 4.877 },
    { id: "c30", modelKey: "brazier", x: -8.1, y: 0, z: 21.4, ry: 0.479 },
    { id: "c31", modelKey: "brazier", x: -26.78, y: 0, z: 9.5, ry: 3.015 },
    { id: "c32", modelKey: "skull", x: -20.83, y: 0, z: 13.73, ry: 5.624 },
    { id: "c33", modelKey: "skull", x: -9.56, y: 0, z: 11.84, ry: 0.657 },
    { id: "c34", modelKey: "bat", x: -17.0, y: 0, z: 15.78, ry: 0.533 },
    { id: "c35", modelKey: "bat", x: -24.14, y: 0, z: 20.43, ry: 4.559 },
    { id: "c36", modelKey: "sarcophagus", x: 6.12, y: 0, z: 17.13, ry: 5.932 },
    { id: "c37", modelKey: "sarcophagus", x: 26.91, y: 0, z: 21.76, ry: 1.299 },
    { id: "c38", modelKey: "sarcophagus", x: 6.75, y: 0, z: 11.69, ry: 6.089 },
    { id: "c39", modelKey: "angel_statue", x: 7.66, y: 0, z: 22.83, ry: 0.408 },
    { id: "c40", modelKey: "angel_statue", x: 27.87, y: 0, z: 19.36, ry: 2.122 },
    { id: "c41", modelKey: "angel_statue", x: 13.8, y: 0, z: 16.55, ry: 1.579 },
    { id: "c42", modelKey: "gargoyle", x: 6.37, y: 0, z: 22.43, ry: 1.457 },
    { id: "c43", modelKey: "gargoyle", x: 6.02, y: 0, z: 14.57, ry: 0.975 },
    { id: "c44", modelKey: "gargoyle", x: 12.34, y: 0, z: 21.39, ry: 0.255 },
    { id: "c45", modelKey: "coffin_open", x: 16.15, y: 0, z: 21.77, ry: 4.996 },
    { id: "c46", modelKey: "coffin_open", x: 23.03, y: 0, z: 22.41, ry: 1.2 },
    { id: "c47", modelKey: "raven", x: 13.85, y: 0, z: 18.56, ry: 2.185 },
    { id: "c48", modelKey: "raven", x: 27.89, y: 0, z: 13.81, ry: 4.307 },
    { id: "c49", modelKey: "raven", x: 10.61, y: 0, z: 22.26, ry: 1.364 },
    { id: "c50", modelKey: "grave_cross", x: 6.32, y: 0, z: 10.06, ry: 3.105 },
    { id: "c51", modelKey: "headstone", x: -25.54, y: 0, z: -16.48, ry: -0.038 },
    { id: "c52", modelKey: "headstone", x: -23.12, y: 0, z: -16.43, ry: -0.022 },
    { id: "c53", modelKey: "headstone", x: -20.23, y: 0, z: -16.77, ry: 0.032 },
    { id: "c54", modelKey: "headstone", x: -25.71, y: 0, z: -19.29, ry: -0.002 },
    { id: "c55", modelKey: "headstone", x: -22.83, y: 0, z: -19.04, ry: -0.012 },
    { id: "c56", modelKey: "headstone", x: -20.31, y: 0, z: -19.08, ry: 0.016 },
    { id: "c57", modelKey: "headstone", x: -14.15, y: 0, z: -16.75, ry: 0.031 },
    { id: "c58", modelKey: "headstone", x: -11.5, y: 0, z: -16.45, ry: -0.029 },
    { id: "c59", modelKey: "headstone", x: -8.76, y: 0, z: -16.58, ry: -0.002 },
    { id: "c60", modelKey: "headstone", x: -14.24, y: 0, z: -19.16, ry: 0.026 },
    { id: "c61", modelKey: "headstone", x: -11.67, y: 0, z: -19.1, ry: -0.034 },
    { id: "c62", modelKey: "headstone", x: -9.07, y: 0, z: -19.11, ry: -0.028 },
    { id: "c63", modelKey: "headstone", x: -25.74, y: 0, z: -7.53, ry: 0.035 },
    { id: "c64", modelKey: "headstone", x: -23.16, y: 0, z: -7.63, ry: -0.032 },
    { id: "c65", modelKey: "headstone", x: -20.37, y: 0, z: -7.74, ry: 0.003 },
    { id: "c66", modelKey: "headstone", x: -25.7, y: 0, z: -10.16, ry: -0.032 },
    { id: "c67", modelKey: "headstone", x: -23.01, y: 0, z: -10.34, ry: -0.0 },
    { id: "c68", modelKey: "headstone", x: -20.33, y: 0, z: -10.34, ry: 0.037 },
    { id: "c69", modelKey: "grave_sword", x: -16.49, y: 0, z: -11.32, ry: 4.867 },
    { id: "c70", modelKey: "grave_sword", x: -21.53, y: 0, z: -7.21, ry: 4.142 },
    { id: "c71", modelKey: "grave_sword", x: -9.8, y: 0, z: -7.32, ry: 2.532 },
    { id: "c72", modelKey: "shield", x: -15.02, y: 0, z: -8.69, ry: 2.623 },
    { id: "c73", modelKey: "shield", x: -12.23, y: 0, z: -22.83, ry: 5.3 },
    { id: "c74", modelKey: "grave_cross", x: -18.17, y: 0, z: -20.82, ry: 4.829 },
    { id: "c75", modelKey: "grave_cross", x: -23.93, y: 0, z: -18.52, ry: 6.211 },
    { id: "c76", modelKey: "grave_cross", x: -12.75, y: 0, z: -16.54, ry: 5.894 },
    { id: "c77", modelKey: "urn", x: -12.3, y: 0, z: -6.02, ry: 2.195 },
    { id: "c78", modelKey: "urn", x: -11.03, y: 0, z: -17.64, ry: 1.589 },
    { id: "c79", modelKey: "urn", x: -15.81, y: 0, z: -7.83, ry: 2.089 },
    { id: "c80", modelKey: "bone_pile", x: -6.2, y: 0, z: -12.55, ry: 3.184 },
    { id: "c81", modelKey: "bone_pile", x: -13.48, y: 0, z: -12.0, ry: 5.237 },
    { id: "c82", modelKey: "skull", x: -21.79, y: 0, z: -13.64, ry: 6.239 },
    { id: "c83", modelKey: "skull", x: -17.96, y: 0, z: -14.07, ry: 4.9 },
    { id: "c84", modelKey: "lantern", x: -13.76, y: 0, z: -22.48, ry: 2.161 },
    { id: "c85", modelKey: "lantern", x: -12.26, y: 0, z: -10.67, ry: 5.972 },
    { id: "c86", modelKey: "grave_mound", x: 9.58, y: 0, z: -6.54, ry: 2.023 },
    { id: "c87", modelKey: "grave_mound", x: 14.69, y: 0, z: -10.92, ry: 0.369 },
    { id: "c88", modelKey: "grave_mound", x: 10.99, y: 0, z: -20.97, ry: 3.571 },
    { id: "c89", modelKey: "grave_mound", x: 25.28, y: 0, z: -11.91, ry: 3.358 },
    { id: "c90", modelKey: "bone_pile", x: 14.03, y: 0, z: -7.84, ry: 5.596 },
    { id: "c91", modelKey: "bone_pile", x: 7.42, y: 0, z: -18.51, ry: 0.051 },
    { id: "c92", modelKey: "bone_pile", x: 27.36, y: 0, z: -16.23, ry: 5.719 },
    { id: "c93", modelKey: "bone_pile", x: 11.42, y: 0, z: -17.85, ry: 4.072 },
    { id: "c94", modelKey: "skeleton", x: 10.86, y: 0, z: -22.9, ry: 1.584 },
    { id: "c95", modelKey: "skeleton", x: 19.74, y: 0, z: -11.93, ry: 5.904 },
    { id: "c96", modelKey: "skeleton", x: 8.34, y: 0, z: -17.39, ry: 4.187 },
    { id: "c97", modelKey: "coffin", x: 20.22, y: 0, z: -14.96, ry: 0.916 },
    { id: "c98", modelKey: "coffin", x: 10.05, y: 0, z: -16.2, ry: 5.69 },
    { id: "c99", modelKey: "coffin", x: 16.05, y: 0, z: -16.67, ry: 5.413 },
    { id: "c100", modelKey: "cauldron", x: 12.51, y: 0, z: -10.32, ry: 5.742 },
    { id: "c101", modelKey: "cauldron", x: 19.62, y: 0, z: -9.3, ry: 0.262 },
    { id: "c102", modelKey: "jack_o_lantern", x: 27.84, y: 0, z: -19.85, ry: 4.382 },
    { id: "c103", modelKey: "jack_o_lantern", x: 17.03, y: 0, z: -19.18, ry: 6.17 },
    { id: "c104", modelKey: "jack_o_lantern", x: 9.24, y: 0, z: -19.1, ry: 1.202 },
    { id: "c105", modelKey: "skull", x: 12.34, y: 0, z: -15.23, ry: 0.098 },
    { id: "c106", modelKey: "skull", x: 17.53, y: 0, z: -8.89, ry: 2.068 },
    { id: "c107", modelKey: "skull", x: 11.23, y: 0, z: -19.11, ry: 3.575 },
    { id: "c108", modelKey: "scarecrow", x: 26.89, y: 0, z: -18.3, ry: 6.195 },
    { id: "c109", modelKey: "scarecrow", x: 13.81, y: 0, z: -16.66, ry: 0.38 },
    { id: "c110", modelKey: "stone_well", x: 10.5, y: 0, z: -8.5, ry: 5.484 },
    { id: "c111", modelKey: "brazier", x: 22.61, y: 0, z: -12.09, ry: 1.247 },
    { id: "c112", modelKey: "brazier", x: 17.64, y: 0, z: -14.92, ry: 2.866 },
    { id: "c113", modelKey: "raven", x: 1.92, y: 0, z: 9.61, ry: 5.447 },
    { id: "c114", modelKey: "raven", x: 0.87, y: 0, z: -10.34, ry: 5.314 },
    { id: "c115", modelKey: "raven", x: 2.17, y: 0, z: -6.83, ry: 4.461 },
  ],
  occluders: CEMETERY_STRUCTURES,
};

/** Every map in the order players should see them offered. */
export const MAP_ORDER = ["depot7", "backyard", "hollow_row"] as const;

/** True if `id` names a real map — always gate client-supplied ids on this. */
export function isMapId(id: unknown): id is string {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(MAPS, id);
}

export const MAPS: Record<string, MapDefinition> = {
  [DEPOT_7.id]: DEPOT_7,
  [BACKYARD.id]: BACKYARD,
  [HOLLOW_ROW.id]: HOLLOW_ROW,
};

export const DEFAULT_MAP_ID = BACKYARD.id;

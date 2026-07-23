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

export interface MapDefinition {
  id: string;
  displayName: string;
  /** Visual style the client builds the environment for. */
  theme: "warehouse" | "backyard";
  /** Floor size for the procedural room (metres). */
  width: number;
  depth: number;
  wallHeight: number;
  bounds: MapBounds;
  hunterSpawns: SpawnPoint[];
  propSpawns: SpawnPoint[];
  props: PropSpawn[];
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

  // Present in the world but NOT allowed as a disguise (too small / would be unfair).
  bolt: { key: "bolt", label: "Bolt", radius: 0.05, height: 0.05, color: "#888888", disguiseAllowed: false },
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
};

/**
 * Second map: an original suburban backyard. Grass, a fence, a house, a shed and
 * trees, with plenty of natural props to hide as.
 */
export const BACKYARD: MapDefinition = {
  id: "backyard",
  displayName: "Sunnyside Yard",
  theme: "backyard",
  width: 84,
  depth: 84,
  wallHeight: 2,
  // Big fully-fenced yard; the house sits inside the north edge.
  bounds: { minX: -38, maxX: 38, minZ: -38, maxZ: 30 },
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
  ],
};

export const MAPS: Record<string, MapDefinition> = {
  [DEPOT_7.id]: DEPOT_7,
  [BACKYARD.id]: BACKYARD,
};

export const DEFAULT_MAP_ID = BACKYARD.id;

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
  width: 44,
  depth: 44,
  wallHeight: 2,
  bounds: { minX: -21, maxX: 21, minZ: -21, maxZ: 17.5 },
  // Hunters break out near the south gate.
  hunterSpawns: [
    { x: 0, y: 0, z: -18.5, ry: 0 },
    { x: -2.5, y: 0, z: -18.5, ry: 0 },
    { x: 2.5, y: 0, z: -18.5, ry: 0 },
    { x: -5, y: 0, z: -18.5, ry: 0 },
    { x: 5, y: 0, z: -18.5, ry: 0 },
    { x: 0, y: 0, z: -16.5, ry: 0 },
  ],
  // Props scatter into the yard to hide.
  propSpawns: [
    { x: 10, y: 0, z: -4, ry: Math.PI },
    { x: -10, y: 0, z: -2, ry: Math.PI },
    { x: 6, y: 0, z: 8, ry: Math.PI },
    { x: -6, y: 0, z: 6, ry: Math.PI },
    { x: 14, y: 0, z: 3, ry: Math.PI },
    { x: -14, y: 0, z: -8, ry: Math.PI },
  ],
  props: [
    // Front / south (near the gate)
    { id: "b01", modelKey: "mailbox", x: -18, y: 0, z: -18.5, ry: 0 },
    { id: "b02", modelKey: "fire_hydrant", x: 18, y: 0, z: -18.5, ry: 0 },
    { id: "b03", modelKey: "traffic_cone", x: 8, y: 0, z: -16, ry: 0 },
    { id: "b04", modelKey: "bucket", x: 6, y: 0, z: -14, ry: 0 },
    // Work corner / shed (south-west)
    { id: "b05", modelKey: "propane_tank", x: -16.5, y: 0, z: -16.5, ry: 0 },
    { id: "b06", modelKey: "crate_large", x: -15, y: 0, z: -14.5, ry: 0.4 },
    { id: "b07", modelKey: "crate_small", x: -13.4, y: 0, z: -15, ry: 0.9 },
    { id: "b08", modelKey: "tire", x: -17.5, y: 0, z: -13, ry: 0 },
    { id: "b09", modelKey: "barrel", x: 12, y: 0, z: -13.5, ry: 0 },
    // Garden beds / mid-yard
    { id: "b10", modelKey: "bird_bath", x: 0, y: 0, z: 0, ry: 0 },
    { id: "b11", modelKey: "rock", x: -3, y: 0, z: 3.2, ry: 0.5 },
    { id: "b12", modelKey: "rock", x: -1.8, y: 0, z: 4.4, ry: 1.4 },
    { id: "b13", modelKey: "garden_gnome", x: -4.2, y: 0, z: 5, ry: 0 },
    { id: "b14", modelKey: "bench", x: -12, y: 0, z: 9, ry: 0.2 },
    { id: "b15", modelKey: "dog_house", x: 17, y: 0, z: -8, ry: -0.6 },
    // Bushes along the fences
    { id: "b16", modelKey: "bush", x: 19, y: 0, z: 5, ry: 0 },
    { id: "b17", modelKey: "bush", x: 19, y: 0, z: -2, ry: 0 },
    { id: "b18", modelKey: "bush", x: -19, y: 0, z: 8, ry: 0 },
    { id: "b19", modelKey: "bush", x: -19, y: 0, z: 1, ry: 0 },
    { id: "b20", modelKey: "bush", x: 15, y: 0, z: 11, ry: 0 },
    // Patio / near the house (north)
    { id: "b21", modelKey: "trash_can", x: 10, y: 0, z: 14.5, ry: 0 },
    { id: "b22", modelKey: "trash_can", x: 11.2, y: 0, z: 14.5, ry: 0 },
    { id: "b23", modelKey: "ac_unit", x: -14, y: 0, z: 15, ry: 0 },
    { id: "b24", modelKey: "cooler", x: 4, y: 0, z: 13, ry: 0.3 },
    { id: "b25", modelKey: "flower_pot", x: -8, y: 0, z: 14.5, ry: 0 },
    { id: "b26", modelKey: "flower_pot", x: -6.7, y: 0, z: 14.5, ry: 0 },
    { id: "b27", modelKey: "planter", x: 13.5, y: 0, z: 14, ry: 0 },
  ],
};

export const MAPS: Record<string, MapDefinition> = {
  [DEPOT_7.id]: DEPOT_7,
  [BACKYARD.id]: BACKYARD,
};

export const DEFAULT_MAP_ID = BACKYARD.id;

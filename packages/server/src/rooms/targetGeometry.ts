import { PLAYER_RADIUS, PROP_MODELS, type PropModel } from "@mimic/shared";
import type { CylinderTarget } from "./hitscan.js";

/** Enlarge gun hit cylinders slightly so visible prop edges register fairly. */
export const HIT_RADIUS_BUFFER = 1.15;
/** Hit-cylinder height for an undisguised prop player. */
export const PLAYER_HIT_HEIGHT = 1.8;

export function bufferedPropRadius(model: Pick<PropModel, "radius">): number {
  return model.radius * HIT_RADIUS_BUFFER;
}

export function propModelHitCylinder(id: string, modelKey: string, x: number, baseY: number, z: number): CylinderTarget | null {
  const model = PROP_MODELS[modelKey];
  if (!model) return null;
  return { id, x, z, baseY, radius: bufferedPropRadius(model), height: model.height };
}

export function playerHitCylinder(id: string, x: number, baseY: number, z: number, modelKey: string): CylinderTarget {
  const model = PROP_MODELS[modelKey];
  return {
    id,
    x,
    z,
    baseY,
    radius: model ? bufferedPropRadius(model) : PLAYER_RADIUS * HIT_RADIUS_BUFFER,
    height: model ? model.height : PLAYER_HIT_HEIGHT,
  };
}

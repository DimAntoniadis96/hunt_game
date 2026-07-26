import { Team } from "@mimic/shared";

export interface FlashbangActor {
  id: string;
  team: Team;
  alive: boolean;
  x: number;
  y: number;
  z: number;
}

export function flashbangDistance(a: Pick<FlashbangActor, "x" | "y" | "z">, b: Pick<FlashbangActor, "x" | "y" | "z">): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function canFlashbangBlind(source: FlashbangActor, target: FlashbangActor, range: number): boolean {
  if (!source.alive || !target.alive) return false;
  if (source.team !== Team.Props || target.team !== Team.Hunters) return false;
  return flashbangDistance(source, target) <= range;
}

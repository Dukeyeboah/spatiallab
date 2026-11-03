import type { ExperienceFloor } from "./types";

export function worldToUv(
  x: number,
  z: number,
  b: ExperienceFloor["worldBounds"],
): { u: number; v: number } {
  const u = (x - b.minX) / Math.max(1e-6, b.maxX - b.minX);
  const v = 1 - (z - b.minZ) / Math.max(1e-6, b.maxZ - b.minZ);
  return { u: Math.min(1, Math.max(0, u)), v: Math.min(1, Math.max(0, v)) };
}

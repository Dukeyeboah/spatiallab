import type { Prod02aQualityPreset } from "@/lib/labs/prod02a/qualityPresets";

/** These are render budgets, not a claim about the vendor's resident memory. */
export const ROBOT_QUALITY: Record<string, Prod02aQualityPreset> = {
  performance: {
    id: "performance",
    label: "Performance",
    maxSplats: 300_000,
    maxDistance: 28,
    pixelRatioCap: 0.85,
    lodSmooth: false,
    note: "300k splats · 28 m · lower resolution",
  },
  balanced: {
    id: "balanced",
    label: "Balanced",
    maxSplats: 650_000,
    maxDistance: 40,
    pixelRatioCap: 1,
    lodSmooth: false,
    note: "650k splats · 40 m · balanced detail",
  },
  high: {
    id: "high",
    label: "High Quality",
    maxSplats: 1_200_000,
    maxDistance: 55,
    pixelRatioCap: 1.25,
    lodSmooth: true,
    note: "1.2M splats · 55 m · more GPU memory",
  },
};

export function renderBudget(
  q: Prod02aQualityPreset,
  level: number,
  width: number,
  height: number,
  deviceDpr: number,
) {
  const pixelLimit =
    q.id === "performance"
      ? 1280 * 720
      : q.id === "balanced"
        ? 1600 * 900
        : 1920 * 1080;
  return {
    splats: Math.round(q.maxSplats * Math.pow(0.78, level)),
    distance: q.maxDistance * Math.pow(0.93, level),
    dpr: Math.max(
      0.05,
      Math.min(
        deviceDpr,
        q.pixelRatioCap,
        Math.sqrt(pixelLimit / Math.max(1, width * height)),
      ) * Math.pow(0.88, level),
    ),
  };
}

/** Five-second windows, a warm-up, and asymmetric recovery prevent oscillation. */
export class AdaptiveRenderBudget {
  level = 0;
  private fastWindows = 0;
  update(fps: number, p95: number) {
    if (fps < 27 || p95 > 55) {
      this.fastWindows = 0;
      this.level = Math.min(4, this.level + 1);
    } else if (fps >= 29 && p95 < 38) {
      if (++this.fastWindows >= 3) {
        this.level = Math.max(0, this.level - 1);
        this.fastWindows = 0;
      }
    } else this.fastWindows = 0;
    return this.level;
  }
  reset() {
    this.level = 0;
    this.fastWindows = 0;
  }
}

/** Fixed-size storage: diagnostics cannot grow with session length. */
export class FrameWindow {
  private values = new Float32Array(180);
  private cursor = 0;
  private count = 0;
  add(ms: number) {
    if (!Number.isFinite(ms) || ms <= 0) return;
    this.values[this.cursor] = ms;
    this.cursor = (this.cursor + 1) % this.values.length;
    this.count = Math.min(this.count + 1, this.values.length);
  }
  summary() {
    const sorted = Array.from(this.values.subarray(0, this.count)).sort(
      (a, b) => a - b,
    );
    return {
      p95: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0,
      samples: this.count,
    };
  }
  reset() {
    this.cursor = 0;
    this.count = 0;
  }
}

export type RobotPerfStats = {
  p95Ms: number;
  cpuMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  heapMB: number | null;
  width: number;
  height: number;
  dpr: number;
  splatBudget: number;
  autoLevel: number;
  contextLosses: number;
  elapsedSeconds: number;
};

/** Limit the vendor caches themselves, separately from the visible splat budget. */
export function robotCacheBudget(deviceMemory?: number, cores?: number) {
  const small =
    (deviceMemory != null && deviceMemory <= 4) ||
    (cores != null && cores <= 4);
  return {
    maxHostCacheSize: (small ? 96 : 192) * 1048576,
    maxGpuCacheSize: (small ? 64 : 128) * 1048576,
    maxConcurrentDownloads: 2,
    workerPerFrameRequests: 2,
  };
}

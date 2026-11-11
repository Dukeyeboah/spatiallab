import type { RobotPerfStats } from "./performance";

type Input = {
  fps: number;
  phase: string;
  perf?: RobotPerfStats;
  camera?: {
    actualCam: number[];
    boomDistance: number;
    obstructed: boolean;
  } | null;
};
type Tags = {
  robot?: string;
  scale: number;
  floor: string;
  quality: string;
  autoPerformance: boolean;
};
type Sample = Tags & {
  sessionSeconds: number;
  phase: string;
  fps: number;
  perf: RobotPerfStats;
  camera?: Input["camera"];
};
type HeapMinute = {
  minute: number;
  minMB: number;
  maxMB: number;
  readings: number;
};

/** One hour of five-second samples and two hours of minute summaries, never unbounded. */
export class PerformanceSession {
  readonly startedAt: string;
  private origin: number;
  private lastAt = -Infinity;
  private lastKey = "";
  private samples: Sample[] = [];
  private minutes: HeapMinute[] = [];
  private total = 0;
  constructor(now = performance.now(), date = new Date()) {
    this.origin = now;
    this.startedAt = date.toISOString();
  }
  record(input: Input, tags: Tags, now = performance.now()) {
    if (!input.perf) return;
    const seconds = Math.max(0, (now - this.origin) / 1000);
    const heap = input.perf.heapMB;
    if (heap != null && Number.isFinite(heap)) {
      const minute = Math.floor(seconds / 60);
      let bucket = this.minutes.at(-1);
      if (!bucket || bucket.minute !== minute) {
        bucket = { minute, minMB: heap, maxMB: heap, readings: 0 };
        this.minutes.push(bucket);
        if (this.minutes.length > 120) this.minutes.shift();
      }
      bucket.minMB = Math.min(bucket.minMB, heap);
      bucket.maxMB = Math.max(bucket.maxMB, heap);
      bucket.readings++;
    }
    const key = `${tags.floor}/${tags.robot}/${tags.scale}/${tags.quality}/${input.phase}`;
    if (now - this.lastAt < 5000 && key === this.lastKey) return;
    this.lastAt = now;
    this.lastKey = key;
    this.total++;
    this.samples.push({
      ...tags,
      sessionSeconds: seconds,
      phase: input.phase,
      fps: input.fps,
      perf: { ...input.perf },
      camera: input.camera
        ? {
            actualCam: [...input.camera.actualCam],
            boomDistance: input.camera.boomDistance,
            obstructed: input.camera.obstructed,
          }
        : null,
    });
    if (this.samples.length > 720) this.samples.shift();
  }
  report(metadata: Record<string, unknown>, now = performance.now()) {
    const duration = Math.max(0, (now - this.origin) / 1000);
    // Exclude initial load/warm-up and incomplete minute from the regression.
    const stable = this.minutes.filter(
      (m) => m.minute >= 2 && m.minute < Math.floor(duration / 60),
    );
    let slope: number | null = null;
    if (stable.length >= 3) {
      const mx = stable.reduce((s, m) => s + m.minute, 0) / stable.length,
        my = stable.reduce((s, m) => s + m.minMB, 0) / stable.length;
      slope =
        stable.reduce((s, m) => s + (m.minute - mx) * (m.minMB - my), 0) /
        stable.reduce((s, m) => s + (m.minute - mx) ** 2, 0);
    }
    return {
      schemaVersion: 2,
      startedAt: this.startedAt,
      durationSeconds: duration,
      metadata,
      retention: {
        sampleIntervalSeconds: 5,
        sampleCapacity: 720,
        minuteCapacity: 120,
        totalSamples: this.total,
        retainedSamples: this.samples.length,
      },
      summary: {
        heapMinuteLowSlopeMBPerMinute: slope,
        trendMinutes: stable.length,
        minFPS: this.samples.some((s) => s.phase === "ready")
          ? Math.min(
              ...this.samples
                .filter((s) => s.phase === "ready")
                .map((s) => s.fps),
            )
          : null,
        limitation:
          "JS heap is not total Chrome/worker/GPU memory. Rising minute lows warrant investigation; this is not a leak verdict.",
      },
      heapByMinute: this.minutes.map((m) => ({ ...m })),
      samples: this.samples.map((s) => ({ ...s })),
    };
  }
}

"use client";

import { useEffect, useRef, type RefObject } from "react";
import "@playcanvas/supersplat-viewer/viewer.css";
import type { ViewerHandle } from "@playcanvas/supersplat-viewer/viewer";
import type { CameraPose } from "@/lib/splats";

/**
 * The official SuperSplat Viewer (@playcanvas/supersplat-viewer), embedded
 * with its documented `createViewer` API. It builds its own canvas, PlayCanvas
 * engine app and WebGPU/WebGL context inside our <div>; nothing is shared
 * with React Three Fiber (this route has no R3F canvas at all).
 *
 * One viewer per scene: changing the scene (or the performance graphs flag,
 * which is a creation option) destroys the old viewer — engine app, GPU
 * context, listeners and DOM — before the next one is created. Browsers cap
 * live WebGL contexts at ~16, so an instance must never be leaked.
 */

export type ViewerStatus =
  | { phase: "idle" }
  | { phase: "loading"; progress: number }
  | { phase: "loaded"; seconds: number }
  | { phase: "error"; message: string };

export type ViewerStats = {
  renderer: string;
  fps: number;
  frameMs: number;
  /** Splats submitted for the last rendered frame (LOD scenes stream a subset). */
  splatsDrawn: number;
  /** GPU memory the engine has allocated (textures + buffers). */
  vramBytes: number;
};

/** Camera commands for the panel; valid once the scene has loaded. */
export type SplatViewerApi = { resetCamera(): void };

type SplatViewerProps = {
  contentUrl: string | null;
  /** Starting view (also what Reset camera returns to); null lets the viewer frame everything. */
  startCamera: CameraPose | null;
  ministats: boolean;
  onStatus: (status: ViewerStatus) => void;
  onStats: (stats: ViewerStats | null) => void;
  apiRef: RefObject<SplatViewerApi | null>;
};

/** Experience settings: SuperSplat's defaults (no effects, annotations or animation tracks) plus our start view. */
async function viewerSettings(startCamera: CameraPose | null): Promise<object> {
  const { defaultSettings } = await import("@playcanvas/supersplat-viewer/settings");
  return { ...defaultSettings("object"), cameras: startCamera ? [{ initial: startCamera }] : [] };
}

/** One byte of the scene, so a missing or unreachable scene fails with a message instead of a blank viewer. */
async function checkReachable(url: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { Range: "bytes=0-0" }, cache: "no-store" });
  } catch {
    throw new Error("Could not reach the local backend to load this scene.");
  }
  if (!response.ok) throw new Error(`The scene file could not be loaded (HTTP ${response.status}).`);
  await response.body?.cancel();
}

export function SplatViewer({ contentUrl, startCamera, ministats, onStatus, onStats, apiRef }: SplatViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Latest callbacks without re-creating the viewer when the parent re-renders.
  const callbacks = useRef({ onStatus, onStats });
  useEffect(() => {
    callbacks.current = { onStatus, onStats };
  });
  // The start view is a creation option: a different one means a new viewer.
  const startKey = JSON.stringify(startCamera);

  useEffect(() => {
    const container = containerRef.current;
    const { onStatus, onStats } = callbacks.current;
    const startCamera = JSON.parse(startKey) as CameraPose | null;
    if (!container || !contentUrl) {
      onStatus({ phase: "idle" });
      return;
    }
    let cancelled = false;
    let viewer: ViewerHandle | null = null;
    let statsTimer: number | undefined;
    const started = performance.now();
    onStatus({ phase: "loading", progress: 0 });

    const fail = (message: string) => {
      if (!cancelled) onStatus({ phase: "error", message });
    };

    (async () => {
      await checkReachable(contentUrl);
      const [{ createViewer }, settings] = await Promise.all([
        import("@playcanvas/supersplat-viewer/viewer"),
        viewerSettings(startCamera),
      ]);
      if (cancelled) return;
      // noanim: the viewer would otherwise start with a camera animation of its own.
      const created = await createViewer({ container, contentUrl, settings, ministats, noanim: true });
      if (cancelled) {
        created.destroy(); // the scene changed while the engine was starting
        return;
      }
      viewer = created;
      const { app, events, state } = viewer;

      // The viewer has no public load-error event; failed assets (including
      // LOD chunks streamed later) surface on the engine's asset registry.
      app.assets.on("error", (error: unknown) => {
        fail(`The scene failed to load: ${error instanceof Error ? error.message : String(error)}`);
      });
      events.on("progress:changed", (progress: number) => {
        if (!cancelled && !state.loaded) onStatus({ phase: "loading", progress });
      });
      const onLoaded = (loaded: boolean) => {
        if (!loaded || cancelled) return;
        state.cameraMode = "orbit"; // orbit + zoom around the start view's target
        onStatus({ phase: "loaded", seconds: (performance.now() - started) / 1000 });
      };
      events.on("loaded:changed", onLoaded);
      onLoaded(state.loaded);

      apiRef.current = {
        resetCamera: () => viewer?.state.loaded && viewer.resetCamera(),
      };
      const renderer = app.graphicsDevice.isWebGPU ? "WebGPU" : "WebGL 2";
      statsTimer = window.setInterval(() => {
        const frame = app.stats.frame as { fps: number; ms: number; gsplats?: number };
        const { tex, vb, ib, ub, sb } = app.stats.vram;
        onStats({
          renderer,
          fps: frame.fps,
          frameMs: frame.ms,
          splatsDrawn: frame.gsplats ?? 0,
          vramBytes: tex + vb + ib + ub + sb,
        });
      }, 500);
    })().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));

    return () => {
      cancelled = true;
      window.clearInterval(statsTimer);
      apiRef.current = null;
      viewer?.destroy();
      viewer = null;
      onStats(null);
    };
  }, [contentUrl, startKey, ministats, apiRef]);

  return <div ref={containerRef} className="splat-viewer" />;
}

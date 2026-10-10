"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SplatPanel } from "@/components/splat/SplatPanel";
import { SplatViewer, type SplatViewerApi, type ViewerStats, type ViewerStatus } from "@/components/splat/SplatViewer";
import { captureOfDataset, catalogApi, type Catalog } from "@/lib/catalog";
import { API_URL } from "@/lib/datasets";
import {
  deleteSplat,
  fetchSplats,
  selectionForm,
  defaultStartView,
  splatContentUrl,
  startCamera,
  uploadSplat,
  type SplatScene,
  type SplatSelection,
  type StartView,
} from "@/lib/splats";

/**
 * Lab 8: real trained Gaussian splat scenes, imported through the local
 * backend and shown with the official SuperSplat Viewer. Its own route and
 * renderer (no React Three Fiber here); the LiDAR viewer and Labs 6/7B are
 * untouched. Scenes are standalone unless put in a capture, and are never
 * aligned with LiDAR.
 */
export default function GaussianViewerPage() {
  const [scenes, setScenes] = useState<SplatScene[]>([]);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<ViewerStatus>({ phase: "idle" });
  const [stats, setStats] = useState<ViewerStats | null>(null);
  const [ministats, setMinistats] = useState(false);
  /** Per scene, once the user picks one; otherwise defaultStartView. */
  const [startViews, setStartViews] = useState<Record<string, StartView>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const viewerApi = useRef<SplatViewerApi | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await fetchSplats();
      setScenes(list);
      setSelectedId((current) => (current && list.some((s) => s.id === current) ? current : (list[0]?.id ?? null)));
      setError(null);
    } catch {
      setError(`The local backend isn't reachable at ${API_URL}. Start it to import and view Gaussian scenes.`);
      return;
    }
    // An older backend has no catalog: scenes still work, just unorganised.
    setCatalog(await catalogApi.fetch().catch(() => null));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const selected = scenes.find((s) => s.id === selectedId) ?? null;
  const contentUrl = selected ? splatContentUrl(selected) : null;
  const startView = selected ? (startViews[selected.id] ?? defaultStartView(selected)) : "inside";

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const assign = (captureId: string | null) =>
    run(async () => {
      if (!selected || !catalog) return;
      if (captureId) setCatalog(await catalogApi.assignDataset(captureId, selected.id));
      else {
        const current = captureOfDataset(catalog, selected.id);
        if (current) setCatalog(await catalogApi.unassignDataset(current.id, selected.id));
      }
    });

  const remove = () =>
    run(async () => {
      if (!selected) return;
      const ok = window.confirm(
        `Delete "${selected.name}"?\n\nIts files (the original upload and anything extracted from it) are ` +
          "permanently removed from spatial-data/, and it is removed from its capture.",
      );
      if (!ok) return;
      setSelectedId(null); // destroys the viewer before the files disappear
      await deleteSplat(selected.id);
      await refresh();
    });

  async function importScene(name: string, selection: SplatSelection, onProgress: (fraction: number) => void) {
    const scene = await uploadSplat(selectionForm(name, selection), onProgress);
    await refresh();
    setSelectedId(scene.id);
  }

  return (
    <>
      <SplatViewer
        contentUrl={contentUrl}
        startCamera={selected ? startCamera(selected, startView) : null}
        ministats={ministats}
        onStatus={setStatus}
        onStats={setStats}
        apiRef={viewerApi}
      />
      <SplatPanel
        scenes={scenes}
        catalog={catalog}
        selected={selected}
        onSelect={setSelectedId}
        status={status}
        stats={stats}
        ministats={ministats}
        onMinistatsChange={setMinistats}
        onResetCamera={() => viewerApi.current?.resetCamera()}
        startView={startView}
        onStartViewChange={(view) => selected && setStartViews((views) => ({ ...views, [selected.id]: view }))}
        onAssign={assign}
        onDelete={remove}
        onImport={importScene}
        error={error}
        busy={busy}
      />
    </>
  );
}

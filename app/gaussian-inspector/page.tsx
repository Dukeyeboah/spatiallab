"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { InspectorScene, type ViewReport } from "@/components/gaussian/InspectorScene";
import { InspectorPanel, type PreviewOptions } from "@/components/gaussian/InspectorPanel";
import { covariance3D, type ProjectedGaussian } from "@/lib/gaussian/gaussianMath";
import {
  editsFromRecord,
  gaussianApi,
  magnificationFor,
  previewGaussian,
  sameEdits,
  type GaussianEdits,
  type GaussianLayout,
  type GaussianRecord,
  type GaussianSummary,
} from "@/lib/gaussian/inspector";
import { API_URL } from "@/lib/datasets";
import { fetchSplats, type SplatScene } from "@/lib/splats";

const SAMPLE_SIZE = 12;
const SUMMARY_SEED = 1;
const DEFAULT_OPTIONS: PreviewOptions = { supportSigmas: 3, showOutline: true, showEllipsoid: true };

/**
 * Lab 9: inspect single Gaussians of a real trained scene. Records come from
 * the backend a few at a time (never the whole file); experiments change only
 * this page's preview.
 */
export default function GaussianInspectorPage() {
  const [scenes, setScenes] = useState<SplatScene[]>([]);
  const [sceneId, setSceneId] = useState<string | null>(null);
  const [layout, setLayout] = useState<GaussianLayout | null>(null);
  const [summary, setSummary] = useState<GaussianSummary | null>(null);
  const [record, setRecord] = useState<GaussianRecord | null>(null);
  const [edits, setEdits] = useState<GaussianEdits | null>(null);
  const [sample, setSample] = useState<GaussianRecord[]>([]);
  const [seed, setSeed] = useState("42");
  const [indexInput, setIndexInput] = useState("0");
  const [options, setOptions] = useState<PreviewOptions>(DEFAULT_OPTIONS);
  const [projection, setProjection] = useState<ProjectedGaussian | null>(null);
  const [view, setView] = useState<ViewReport | null>(null);
  const [resetRequest, setResetRequest] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const show = useCallback((next: GaussianRecord) => {
    setRecord(next);
    setEdits(editsFromRecord(next));
    setIndexInput(String(next.index));
    setResetRequest((n) => n + 1); // each Gaussian starts from the same view
  }, []);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError(err instanceof TypeError ? `The local backend isn't reachable at ${API_URL}.` : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const loadSample = useCallback(
    async (id: string, seedText: string) => {
      const value = Number(seedText);
      if (!Number.isSafeInteger(value) || value < 0) throw new Error("The seed must be a whole number ≥ 0.");
      const result = await gaussianApi.sample(id, value, SAMPLE_SIZE);
      setLayout(result.layout);
      setSample(result.records);
      show(result.records[0]);
    },
    [show],
  );

  // A scene: its layout + a first sample + the scene-wide statistics.
  async function openScene(id: string, seedText: string) {
    setSceneId(id);
    setRecord(null);
    setEdits(null);
    setSample([]);
    setSummary(null);
    setLayout(null);
    await loadSample(id, seedText);
    setSummary((await gaussianApi.summary(id, SUMMARY_SEED)).summary);
  }

  useEffect(() => {
    run(async () => {
      let list: SplatScene[];
      try {
        list = await fetchSplats();
      } catch (err) {
        if (err instanceof TypeError) throw new Error(`The local backend isn't reachable at ${API_URL}. Start it to inspect Gaussians.`);
        throw err;
      }
      setScenes(list);
      const first = list.find((s) => s.format === "ply");
      if (first) await openScene(first.id, seed);
    });
    // Once, on load.
  }, []);

  function showIndex(index: number) {
    if (!sceneId || !layout) return;
    if (!Number.isInteger(index) || index < 0 || index >= layout.count) {
      setError(`Choose an index from 0 to ${(layout.count - 1).toLocaleString()}.`);
      return;
    }
    const inSample = sample.find((r) => r.index === index);
    if (inSample) return show(inSample);
    run(async () => show((await gaussianApi.records(sceneId, [index])).records[0]));
  }

  const magnification = useMemo(() => (record ? magnificationFor(record) : 1), [record]);
  const gaussian = useMemo(() => (edits ? previewGaussian(edits, magnification) : null), [edits, magnification]);
  const sigma3D = useMemo(() => (gaussian ? covariance3D(gaussian) : null), [gaussian]);
  // The same covariance at real size (m²), for the panel.
  const sigma3DReal = useMemo(() => (edits ? covariance3D(previewGaussian(edits, 1)) : null), [edits]);
  const original = useMemo(() => (record ? editsFromRecord(record) : null), [record]);

  return (
    <>
      {record && edits && gaussian && sigma3D && (
        <InspectorScene
          record={record}
          edits={edits}
          gaussian={gaussian}
          sigma3D={sigma3D}
          supportSigmas={options.supportSigmas}
          showOutline={options.showOutline}
          showEllipsoid={options.showEllipsoid}
          resetRequest={resetRequest}
          onProjection={setProjection}
          onView={setView}
        />
      )}
      <InspectorPanel
        scenes={scenes}
        sceneId={sceneId}
        onScene={(id) => run(() => openScene(id, seed))}
        layout={layout}
        summary={summary}
        record={record}
        onIndex={showIndex}
        indexInput={indexInput}
        onIndexInput={setIndexInput}
        seed={seed}
        onSeed={setSeed}
        sample={sample}
        onSample={() => sceneId && run(() => loadSample(sceneId, seed))}
        edits={edits}
        edited={!!edits && !!original && !sameEdits(edits, original)}
        onEdits={setEdits}
        onResetGaussian={() => original && setEdits(original)}
        onResetCamera={() => setResetRequest((n) => n + 1)}
        options={options}
        onOptions={setOptions}
        magnification={magnification}
        sigma3DReal={sigma3DReal}
        projection={projection}
        view={view}
        busy={busy}
        error={error}
      />
    </>
  );
}

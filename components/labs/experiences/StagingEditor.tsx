"use client";

import {
  BUILTIN_CHAIR_ASSET,
  type StagingAssetRef,
  type StagingPlacement,
  type StagingTransformMode,
  type Vec3,
} from "@/lib/labs/experiences/stagingTypes";
import { importStagingAsset } from "@/lib/labs/experiences/stagingAssetPipeline";
import { removeStagingPlacement, saveStagingPlacement, exportStaging } from "@/lib/labs/experiences/stagingStorage";

export type { StagingTransformMode };

type Props = {
  propertyId: string;
  placements: StagingPlacement[];
  selectedId: string | null;
  placeMode: boolean;
  transformMode: StagingTransformMode;
  stagedVisible: boolean;
  draftAsset: StagingAssetRef;
  draftName: string;
  onDraftAsset: (a: StagingAssetRef) => void;
  onDraftName: (n: string) => void;
  onRefresh: () => void;
  onSelect: (id: string | null) => void;
  onPlaceMode: (on: boolean) => void;
  onTransformMode: (m: StagingTransformMode) => void;
  onStagedVisible: (v: boolean) => void;
  proxyDebug: boolean;
  onProxyDebug: (v: boolean) => void;
  liveDims?: { size: Vec3; position: Vec3; rotation: Vec3; scale: Vec3 } | null;
};

/**
 * Dev: virtual staging — built-in chair or uploaded GLB, place on floor, transform, export.
 */
export function StagingEditor({
  propertyId,
  placements,
  selectedId,
  placeMode,
  transformMode,
  stagedVisible,
  draftAsset,
  draftName,
  onDraftAsset,
  onDraftName,
  onRefresh,
  onSelect,
  onPlaceMode,
  onTransformMode,
  onStagedVisible,
  proxyDebug,
  onProxyDebug,
  liveDims,
}: Props) {
  const selected = placements.find((p) => p.id === selectedId) ?? null;

  const onUploadGlb = async (file: File | null) => {
    if (!file) return;
    try {
      const format = /\.gltf$/i.test(file.name) ? "gltf" : "glb";
      const { asset, note } = await importStagingAsset({ format, file });
      onDraftAsset(asset);
      const name =
        asset.kind === "idb"
          ? asset.fileName.replace(/\.(glb|gltf)$/i, "")
          : asset.kind === "public"
            ? asset.fileName.replace(/\.(glb|gltf)$/i, "")
            : "Chair";
      onDraftName(name || "Furniture");
      console.info("[staging]", note);
    } catch (e) {
      window.alert((e as Error).message);
    }
  };

  const deleteSelected = () => {
    if (!selected) return;
    removeStagingPlacement(propertyId, selected.id);
    onSelect(null);
    onRefresh();
  };

  const resetSelected = () => {
    if (!selected) return;
    saveStagingPlacement({ ...selected, rotation: [0, 0, 0], scale: [1, 1, 1] });
    onRefresh();
  };

  return (
    <div className="exp-staging">
      <b className="exp-sub">Virtual staging (EXP-04)</b>
      <p className="exp-hint">
        1) Pick Built-in chair or Upload GLB → 2) <b>Place on floor</b> → 3) move the blue ring on the floor → 4) click
        to drop. Oversized exports (cm/mm) are auto-fitted to ~1 m. Gizmo is Dev-only.
      </p>

      <label className="exp-check">
        <input type="checkbox" checked={stagedVisible} onChange={(e) => onStagedVisible(e.target.checked)} />
        Show staged furniture
      </label>
      <label className="exp-check">
        <input type="checkbox" checked={proxyDebug} onChange={(e) => onProxyDebug(e.target.checked)} />
        Debug collision proxies (OBB wireframes)
      </label>

      <div className="exp-dev-row">
        <button
          type="button"
          className={draftAsset.kind === "builtin" ? "on" : ""}
          onClick={() => {
            onDraftAsset(BUILTIN_CHAIR_ASSET);
            onDraftName("Chair");
          }}
        >
          Built-in chair
        </button>
        <label className="exp-fp-replace">
          Upload GLB
          <input
            type="file"
            accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
            hidden
            onChange={(e) => void onUploadGlb(e.target.files?.[0] ?? null)}
          />
        </label>
      </div>
      <input
        type="text"
        value={draftName}
        onChange={(e) => onDraftName(e.target.value)}
        placeholder="Display name"
      />

      <div className="exp-dev-row">
        <button type="button" className={placeMode ? "on" : ""} onClick={() => onPlaceMode(!placeMode)}>
          {placeMode ? "Aim blue ring → click to drop" : "Place on floor"}
        </button>
      </div>
      {placeMode && (
        <p className="exp-hint ok">
          Place mode on: a blue ring follows your pointer on the floor. Click once to place. Then use translate / rotate /
          scale.
        </p>
      )}

      <div className="exp-dev-row">
        {(
          [
            ["translate", "move"],
            ["rotate", "rotate"],
            ["scaleUniform", "scale ∝"],
            ["scale", "stretch"],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            className={transformMode === m ? "on" : ""}
            disabled={!selected}
            title={
              m === "scaleUniform"
                ? "Uniform scale — keeps proportions"
                : m === "scale"
                  ? "Per-axis stretch along the object’s local X / Y / Z"
                  : undefined
            }
            onClick={() => onTransformMode(m)}
          >
            {label}
          </button>
        ))}
      </div>
      {transformMode === "scaleUniform" && selected && (
        <div className="exp-dev-row">
          <button
            type="button"
            disabled={!selected}
            title="Make smaller (keep proportions)"
            onClick={() => {
              if (!selected) return;
              const base =
                Math.cbrt(Math.abs(selected.scale[0] * selected.scale[1] * selected.scale[2])) || 1;
              const s = Math.max(0.05, base * 0.9);
              saveStagingPlacement({ ...selected, scale: [s, s, s] });
              onRefresh();
            }}
          >
            − smaller
          </button>
          <button
            type="button"
            disabled={!selected}
            title="Make larger (keep proportions)"
            onClick={() => {
              if (!selected) return;
              const base =
                Math.cbrt(Math.abs(selected.scale[0] * selected.scale[1] * selected.scale[2])) || 1;
              const s = Math.min(8, base * 1.1);
              saveStagingPlacement({ ...selected, scale: [s, s, s] });
              onRefresh();
            }}
          >
            + larger
          </button>
        </div>
      )}

      {selected && (
        <div className="exp-staging-sel">
          <div>
            Selected: <b>{selected.displayName}</b>
          </div>
          {liveDims && (
            <div className="exp-hint">
              Size ~{liveDims.size[0].toFixed(2)}×{liveDims.size[1].toFixed(2)}×{liveDims.size[2].toFixed(2)} m
              <br />
              Pos ({liveDims.position.map((n) => n.toFixed(2)).join(", ")})
              <br />
              Rot ° ({liveDims.rotation.map((r) => ((r * 180) / Math.PI).toFixed(0)).join(", ")})
              <br />
              Scale ({liveDims.scale.map((n) => n.toFixed(2)).join(", ")})
            </div>
          )}
          <label className="exp-check">
            <input
              type="checkbox"
              checked={selected.collisionEnabled !== false}
              onChange={(e) => {
                saveStagingPlacement({ ...selected, collisionEnabled: e.target.checked });
                onRefresh();
              }}
            />
            Walk collision on
            <span className="exp-hint" style={{ display: "inline", marginLeft: 6 }}>
              (new pieces start off — turn on when placed)
            </span>
          </label>
          <div className="exp-dev-row">
            <button type="button" onClick={resetSelected}>
              Reset rot/scale
            </button>
            <button type="button" onClick={deleteSelected}>
              Delete
            </button>
            <button type="button" onClick={() => onSelect(null)}>
              Deselect
            </button>
          </div>
        </div>
      )}

      {placements.length > 0 && (
        <ul className="exp-list compact">
          {placements.map((p) => (
            <li key={p.id}>
              <button type="button" className={p.id === selectedId ? "on" : ""} onClick={() => onSelect(p.id)}>
                {p.visible ? "" : "(hidden) "}
                {p.collisionEnabled === false ? "(no coll) " : ""}
                {p.displayName}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="exp-dev-row">
        <button
          type="button"
          onClick={() => {
            const blob = new Blob([JSON.stringify(exportStaging(propertyId), null, 2)], {
              type: "application/json",
            });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `${propertyId}-staging.json`;
            a.click();
          }}
        >
          Export staging JSON
        </button>
      </div>
    </div>
  );
}

export function createPlacementFromHit(
  propertyId: string,
  modelDataPath: string | undefined,
  asset: StagingAssetRef,
  displayName: string,
  position: Vec3,
): StagingPlacement {
  const now = new Date().toISOString();
  const placement: StagingPlacement = {
    id: `stgobj_${Date.now().toString(36)}`,
    propertyId,
    modelDataPath,
    asset,
    displayName: displayName.trim() || "Furniture",
    position,
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    visible: true,
    // Off until you opt in — free move/rotate without fighting walls or other furniture
    collisionEnabled: false,
    createdAt: now,
    updatedAt: now,
  };
  saveStagingPlacement(placement);
  return placement;
}

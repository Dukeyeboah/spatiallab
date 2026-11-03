"use client";

import {
  DEFAULT_TEXTURE_MAPPING,
  SURFACE_COLOR_PRESETS,
  defaultColorMaterial,
  type SurfaceArtwork,
  type SurfaceExcludeRect,
  type SurfaceOverlay,
  type SurfacePickMeta,
  type Vec3,
} from "@/lib/labs/experiences/surfaceTypes";
import {
  exportSurfaces,
  fileToSurfaceImage,
  removeSurfaceOverlay,
  saveSurfaceOverlay,
} from "@/lib/labs/experiences/surfaceStorage";
import {
  createOverlayFromHit,
  overlayFromCornerPicks,
} from "@/lib/labs/experiences/surfaceGeometry";
import {
  describeOffsetConvention,
  type SurfaceDepthDiag,
  type SurfaceRenderPreset,
} from "@/lib/labs/experiences/surfaceOcclusion";
import {
  WALL_FINISH_PRESET_META,
  normalizeWallFinish,
  presetFinishDefaults,
  type WallBlendMode,
  type WallFinishPresetId,
  type WallFinishSettingsV1,
} from "@/lib/labs/experiences/wallMaterialTypes";
import { ExpDevSection } from "@/components/labs/experiences/ExpDevSection";

export type SurfaceEditorMode = "idle" | "pick" | "corners";

type Props = {
  propertyId: string;
  modelDataPath?: string;
  surfaces: SurfaceOverlay[];
  selectedId: string | null;
  surfacesVisible: boolean;
  mode: SurfaceEditorMode;
  lastPick: SurfacePickMeta | null;
  cornerHits: { point: Vec3; normal: Vec3 }[];
  onRefresh: () => void;
  onSelect: (id: string | null) => void;
  onSurfacesVisible: (v: boolean) => void;
  onMode: (m: SurfaceEditorMode) => void;
  onClearCorners: () => void;
  /** EXP-05B */
  depthDiag?: SurfaceDepthDiag | null;
  labNote?: string | null;
  renderPreset: SurfaceRenderPreset;
  onRenderPreset: (p: SurfaceRenderPreset) => void;
  clipTest: boolean;
  onClipTest: (v: boolean) => void;
  semanticProbe: boolean;
  onSemanticProbe: (v: boolean) => void;
  collisionDepthProxy: boolean;
  onCollisionDepthProxy: (v: boolean) => void;
  /** 3D wall-plane drag (off by default so look/orbit are safe). */
  dragEnabled: boolean;
  onDragEnabled: (v: boolean) => void;
};

/**
 * Dev: wall / surface customization (EXP-05) — pick, overlay, color, wallpaper, artwork.
 */
export function SurfaceEditor({
  propertyId,
  modelDataPath,
  surfaces,
  selectedId,
  surfacesVisible,
  mode,
  lastPick,
  cornerHits,
  onRefresh,
  onSelect,
  onSurfacesVisible,
  onMode,
  onClearCorners,
  depthDiag = null,
  labNote = null,
  renderPreset,
  onRenderPreset,
  clipTest,
  onClipTest,
  semanticProbe,
  onSemanticProbe,
  collisionDepthProxy,
  onCollisionDepthProxy,
  dragEnabled,
  onDragEnabled,
}: Props) {
  const selected = surfaces.find((s) => s.id === selectedId) ?? null;

  const createFromLastPick = () => {
    if (!lastPick) return;
    const s = createOverlayFromHit(
      propertyId,
      modelDataPath,
      lastPick.hitPoint,
      lastPick.hitNormal,
      lastPick.source,
    );
    saveSurfaceOverlay(s);
    onSelect(s.id);
    onMode("idle");
    onRefresh();
  };

  const createFromCorners = () => {
    if (!lastPick || cornerHits.length < 2) return;
    const s = overlayFromCornerPicks(propertyId, modelDataPath, cornerHits, lastPick);
    if (!s) return;
    saveSurfaceOverlay(s);
    onSelect(s.id);
    onMode("idle");
    onClearCorners();
    onRefresh();
  };

  const patch = (next: Partial<SurfaceOverlay>) => {
    if (!selected) return;
    saveSurfaceOverlay({ ...selected, ...next });
    onRefresh();
  };

  const finishOf = (s: SurfaceOverlay): WallFinishSettingsV1 =>
    normalizeWallFinish(
      s.finish ??
        presetFinishDefaults(
          s.material.kind === "texture" ? "wallpaper" : "mattePaint",
          s.material.color,
        ),
      s.material.color,
    );

  const patchFinish = (partial: Partial<WallFinishSettingsV1>) => {
    if (!selected) return;
    const nextFinish = normalizeWallFinish({ ...finishOf(selected), ...partial }, selected.material.color);
    const mat =
      selected.material.kind === "texture"
        ? { ...selected.material, color: nextFinish.baseColor, opacity: nextFinish.opacity }
        : { kind: "color" as const, color: nextFinish.baseColor, opacity: nextFinish.opacity };
    patch({ finish: nextFinish, material: mat });
  };

  const applyPreset = (presetId: WallFinishPresetId) => {
    if (!selected) return;
    const color = selected.material.color || finishOf(selected).baseColor;
    const seed = finishOf(selected).seed;
    patchFinish(presetFinishDefaults(presetId, color, seed));
  };

  const restoreColor = () => {
    if (!selected) return;
    const finish = presetFinishDefaults("mattePaint", "#c8d0d8", finishOf(selected).seed);
    patch({ material: defaultColorMaterial("#c8d0d8"), finish });
  };

  const onWallpaper = async (file: File | null) => {
    if (!selected || !file) return;
    try {
      const { assetId, fileName } = await fileToSurfaceImage(file);
      const prev = selected.material;
      const f = finishOf(selected);
      const nextFinish = presetFinishDefaults("wallpaper", prev.color || f.baseColor, f.seed);
      patch({
        material: {
          kind: "texture",
          assetId,
          fileName,
          color: nextFinish.baseColor,
          opacity: nextFinish.opacity,
          mapping: prev.kind === "texture" ? prev.mapping : { ...DEFAULT_TEXTURE_MAPPING },
        },
        finish: nextFinish,
      });
    } catch (e) {
      window.alert((e as Error).message);
    }
  };

  const onArtwork = async (file: File | null) => {
    if (!selected || !file) return;
    try {
      const { assetId, fileName } = await fileToSurfaceImage(file);
      const art: SurfaceArtwork = {
        id: `art_${Date.now().toString(36)}`,
        imageAssetId: assetId,
        fileName,
        u: 0,
        v: 0.2,
        width: 0.6,
        height: 0.8,
        rotation: 0,
        frameColor: "#2a2118",
        frameDepth: 0.025,
        frameBorder: 0.04,
      };
      patch({ artwork: [...selected.artwork, art] });
    } catch (e) {
      window.alert((e as Error).message);
    }
  };

  const patchArt = (artId: string, next: Partial<SurfaceArtwork>) => {
    if (!selected) return;
    patch({
      artwork: selected.artwork.map((a) => (a.id === artId ? { ...a, ...next } : a)),
    });
  };

  const removeArt = (artId: string) => {
    if (!selected) return;
    patch({ artwork: selected.artwork.filter((a) => a.id !== artId) });
  };

  return (
    <div className="exp-staging exp-surfaces">
      <b className="exp-sub">Wall / surfaces (EXP-05)</b>
      <p className="exp-hint">
        Pick a wall (collision ray + normal) → create overlay → color / wallpaper / artwork. Does not edit the LCC
        Gaussians. Prefer a flat vertical wall in the Room sample.
      </p>

      <label className="exp-check">
        <input type="checkbox" checked={surfacesVisible} onChange={(e) => onSurfacesVisible(e.target.checked)} />
        Show surface overlays
      </label>

      <div className="exp-dev-row">
        <button
          type="button"
          className={mode === "pick" ? "on" : ""}
          onClick={() => {
            onMode(mode === "pick" ? "idle" : "pick");
            onClearCorners();
          }}
        >
          {mode === "pick" ? "Click wall in 3D…" : "1. Pick wall"}
        </button>
        <button
          type="button"
          className={mode === "corners" ? "on" : ""}
          disabled={!lastPick}
          onClick={() => {
            onMode(mode === "corners" ? "idle" : "corners");
            onClearCorners();
          }}
        >
          {mode === "corners" ? `Corners (${cornerHits.length}/4)` : "Corner region"}
        </button>
      </div>

      {lastPick && (
        <div className="exp-hint ok">
          Last pick ({lastPick.source}): pos ({lastPick.hitPoint.map((n) => n.toFixed(2)).join(", ")}) · n (
          {lastPick.hitNormal.map((n) => n.toFixed(2)).join(", ")}) ·{" "}
          {lastPick.planarSuitable ? "planar wall OK" : "may not be a vertical wall"}
        </div>
      )}

      <div className="exp-dev-row">
        <button type="button" disabled={!lastPick} onClick={createFromLastPick}>
          2. Create ~2.2×2.4 m overlay
        </button>
        <button
          type="button"
          disabled={!lastPick}
          title="Smaller decorative panel (better for depth tests)"
          onClick={() => {
            if (!lastPick) return;
            const s = createOverlayFromHit(
              propertyId,
              modelDataPath,
              lastPick.hitPoint,
              lastPick.hitNormal,
              lastPick.source,
              0.9,
              1.1,
            );
            s.label = "Decorative panel";
            s.offset = 0.015;
            s.material = defaultColorMaterial("#d8dde4");
            saveSurfaceOverlay(s);
            onSelect(s.id);
            onMode("idle");
            onRefresh();
          }}
        >
          Create 0.9×1.1 m panel
        </button>
        <button type="button" disabled={cornerHits.length < 2} onClick={createFromCorners}>
          Create from corners
        </button>
        <button
          type="button"
          disabled={!lastPick}
          title="Invisible panel mount — add artwork only, no wallpaper card"
          onClick={() => {
            if (!lastPick) return;
            const s = createOverlayFromHit(
              propertyId,
              modelDataPath,
              lastPick.hitPoint,
              lastPick.hitNormal,
              lastPick.source,
              1.2,
              1.4,
            );
            s.label = "Artwork mount";
            s.showBase = false;
            s.offset = 0.015;
            saveSurfaceOverlay(s);
            onSelect(s.id);
            onMode("idle");
            onRefresh();
          }}
        >
          Artwork mount (no panel)
        </button>
      </div>

      {surfaces.length > 0 && (
        <ul className="exp-list compact">
          {surfaces.map((s) => (
            <li key={s.id}>
              <button type="button" className={s.id === selectedId ? "on" : ""} onClick={() => onSelect(s.id)}>
                {s.visible ? "" : "(hidden) "}
                {s.showBase === false ? "(art only) " : ""}
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <div className="exp-staging-sel">
          <div>
            Selected: <b>{selected.label}</b>
          </div>
          <input
            type="text"
            value={selected.label}
            onChange={(e) => patch({ label: e.target.value })}
            placeholder="Label"
          />

          <div className="exp-hint">Geometry (metres)</div>
          <div className="exp-surf-grid">
            <label>
              Width
              <input
                type="number"
                step={0.05}
                min={0.2}
                value={selected.width}
                onChange={(e) => patch({ width: Math.max(0.2, Number(e.target.value) || 0.2) })}
              />
            </label>
            <label>
              Height
              <input
                type="number"
                step={0.05}
                min={0.2}
                value={selected.height}
                onChange={(e) => patch({ height: Math.max(0.2, Number(e.target.value) || 0.2) })}
              />
            </label>
            <label>
              Offset (m)
              <input
                type="number"
                step={0.005}
                value={selected.offset}
                onChange={(e) => patch({ offset: Number(e.target.value) || 0 })}
                title={describeOffsetConvention()}
              />
            </label>
            <label>
              Twist °
              <input
                type="number"
                step={1}
                value={((selected.twist * 180) / Math.PI).toFixed(0)}
                onChange={(e) => patch({ twist: ((Number(e.target.value) || 0) * Math.PI) / 180 })}
              />
            </label>
          </div>
          <div className="exp-surf-grid">
            <label>
              Centre X
              <input
                type="number"
                step={0.02}
                value={selected.center[0]}
                onChange={(e) =>
                  patch({ center: [Number(e.target.value) || 0, selected.center[1], selected.center[2]] })
                }
              />
            </label>
            <label>
              Centre Y
              <input
                type="number"
                step={0.02}
                value={selected.center[1]}
                onChange={(e) =>
                  patch({ center: [selected.center[0], Number(e.target.value) || 0, selected.center[2]] })
                }
              />
            </label>
            <label>
              Centre Z
              <input
                type="number"
                step={0.02}
                value={selected.center[2]}
                onChange={(e) =>
                  patch({ center: [selected.center[0], selected.center[1], Number(e.target.value) || 0] })
                }
              />
            </label>
          </div>

          <label className="exp-check">
            <input
              type="checkbox"
              checked={selected.showBase !== false}
              onChange={(e) => patch({ showBase: e.target.checked })}
            />
            Show wall panel / wallpaper
            <span className="exp-hint" style={{ display: "inline", marginLeft: 6 }}>
              (off = artwork + frame only)
            </span>
          </label>
          <label className="exp-check">
            <input
              type="checkbox"
              checked={dragEnabled}
              onChange={(e) => onDragEnabled(e.target.checked)}
            />
            Drag panel in 3D
            <span className="exp-hint" style={{ display: "inline", marginLeft: 6 }}>
              (off = click selects only; safer for look / rotate)
            </span>
          </label>
          {dragEnabled && (
            <p className="exp-hint">Drag along the wall (left/right, up/down). Centre fields always work.</p>
          )}

          <div className="exp-hint">Shell (EXP-05D) — front face stays at the same place</div>
          <div className="exp-dev-row">
            <button
              type="button"
              className={(selected.shellMode ?? "plane") === "plane" ? "on" : ""}
              onClick={() => patch({ shellMode: "plane" })}
            >
              Plane
            </button>
            <button
              type="button"
              className={selected.shellMode === "thinBox" ? "on" : ""}
              onClick={() => patch({ shellMode: "thinBox", shellThickness: selected.shellThickness ?? 0.02 })}
            >
              Thin box
            </button>
            {([0.01, 0.02, 0.03] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={selected.shellMode === "thinBox" && (selected.shellThickness ?? 0.02) === t ? "on" : ""}
                disabled={(selected.shellMode ?? "plane") !== "thinBox"}
                onClick={() => patch({ shellMode: "thinBox", shellThickness: t })}
              >
                {Math.round(t * 100)} cm
              </button>
            ))}
          </div>
          <p className="exp-hint">
            Thin box extends <b>into</b> the wall (−normal) so the room-facing face matches the plane. Compare bleeding
            vs plane at identical offset.
          </p>

          <div className="exp-hint">
            Exclusion holes — add as many as you need (décor, windows, trim)
            {(selected.excludeRects?.length ?? 0) > 0
              ? ` · ${selected.excludeRects!.length} hole${selected.excludeRects!.length === 1 ? "" : "s"}`
              : ""}
          </div>
          <div className="exp-dev-row">
            <button
              type="button"
              onClick={() => {
                const existing = selected.excludeRects ?? [];
                const i = existing.length;
                // Stagger so new holes don’t stack on top of the previous one
                const hole: SurfaceExcludeRect = {
                  id: `excl_${Date.now().toString(36)}_${i}`,
                  u: (i % 3) * 0.45 - 0.45,
                  v: 0.35 - Math.floor(i / 3) * 0.4,
                  width: Math.min(1.0, selected.width * 0.28),
                  height: Math.min(0.75, selected.height * 0.28),
                };
                patch({ excludeRects: [...existing, hole] });
              }}
            >
              {selected.excludeRects?.length ? "Add another hole" : "Add hole"}
            </button>
            <button
              type="button"
              disabled={!selected.excludeRects?.length}
              onClick={() => patch({ excludeRects: [] })}
            >
              Clear all holes
            </button>
          </div>
          {(selected.excludeRects ?? []).map((r, idx) => (
            <div key={r.id} className="exp-art-card">
              <div className="exp-dev-row">
                <span className="exp-hint">Hole {idx + 1}</span>
                <button
                  type="button"
                  onClick={() =>
                    patch({ excludeRects: (selected.excludeRects ?? []).filter((x) => x.id !== r.id) })
                  }
                >
                  Remove
                </button>
              </div>
              <div className="exp-surf-grid">
                <label>
                  U
                  <input
                    type="number"
                    step={0.05}
                    value={r.u}
                    onChange={(e) =>
                      patch({
                        excludeRects: (selected.excludeRects ?? []).map((x) =>
                          x.id === r.id ? { ...x, u: Number(e.target.value) || 0 } : x,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  V
                  <input
                    type="number"
                    step={0.05}
                    value={r.v}
                    onChange={(e) =>
                      patch({
                        excludeRects: (selected.excludeRects ?? []).map((x) =>
                          x.id === r.id ? { ...x, v: Number(e.target.value) || 0 } : x,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  W
                  <input
                    type="number"
                    step={0.05}
                    min={0.05}
                    value={r.width}
                    onChange={(e) =>
                      patch({
                        excludeRects: (selected.excludeRects ?? []).map((x) =>
                          x.id === r.id ? { ...x, width: Math.max(0.05, Number(e.target.value) || 0.05) } : x,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  H
                  <input
                    type="number"
                    step={0.05}
                    min={0.05}
                    value={r.height}
                    onChange={(e) =>
                      patch({
                        excludeRects: (selected.excludeRects ?? []).map((x) =>
                          x.id === r.id ? { ...x, height: Math.max(0.05, Number(e.target.value) || 0.05) } : x,
                        ),
                      })
                    }
                  />
                </label>
              </div>
            </div>
          ))}

          <div className="exp-hint">Wall finish (EXP-05E) — one shader, not stacked planes</div>
          <div className="exp-dev-row wrap">
            {WALL_FINISH_PRESET_META.map((p) => (
              <button
                key={p.id}
                type="button"
                className={finishOf(selected).presetId === p.id ? "on" : ""}
                title={p.blurb}
                onClick={() => applyPreset(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="exp-dev-row">
            <button
              type="button"
              onClick={() => applyPreset(finishOf(selected).presetId)}
              title="Restore restrained defaults for the active preset (keeps base colour)"
            >
              Reset to preset defaults
            </button>
          </div>

          <div className="exp-hint">Base color (independent of preset)</div>
          <div className="exp-color-row">
            <label className="exp-color-wheel" title="Open color wheel — any color">
              <span>Any color</span>
              <input
                type="color"
                value={finishOf(selected).baseColor}
                onChange={(e) => patchFinish({ baseColor: e.target.value })}
              />
            </label>
            <label className="exp-hex-field">
              Hex
              <input
                type="text"
                value={finishOf(selected).baseColor}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  if (!/^#?[0-9a-fA-F]{6}$/.test(raw)) return;
                  const color = raw.startsWith("#") ? raw : `#${raw}`;
                  patchFinish({ baseColor: color });
                }}
              />
            </label>
          </div>
          <div className="exp-dev-row">
            {SURFACE_COLOR_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                title={p.label}
                style={{ background: p.color, minWidth: 28 }}
                onClick={() => patchFinish({ baseColor: p.color })}
              >
                {" "}
              </button>
            ))}
          </div>

          {(() => {
            const f = finishOf(selected);
            const slider = (
              key: keyof WallFinishSettingsV1,
              label: string,
              min: number,
              max: number,
              step: number,
            ) => (
              <label key={String(key)} className="exp-check">
                {label}
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={Number(f[key])}
                  onChange={(e) => patchFinish({ [key]: Number(e.target.value) } as Partial<WallFinishSettingsV1>)}
                />
                <span className="exp-hint">{Number(f[key]).toFixed(2)}</span>
              </label>
            );
            return (
              <>
                {slider("grainStrength", "Grain", 0, 0.5, 0.01)}
                {slider("colorVariation", "Color variation", 0, 0.5, 0.01)}
                {slider("textureStrength", "Texture strength", 0, 1, 0.02)}
                {slider("brightness", "Brightness", 0.55, 1.45, 0.01)}
                {slider("contrast", "Contrast", 0.7, 1.4, 0.01)}
                {slider("warmCool", "Warm ↔ cool", -1, 1, 0.02)}
                {slider("verticalGradient", "Vertical gradient", 0, 0.5, 0.01)}
                {slider("roughness", "Matte / chalk cue", 0, 1, 0.02)}
              </>
            );
          })()}

          <div className="exp-hint">Layer blend (material layers only — not vs LCC Gaussians)</div>
          <div className="exp-dev-row wrap">
            {(
              [
                ["normal", "Normal"],
                ["multiply", "Multiply"],
                ["overlay", "Overlay"],
                ["softLight", "Soft Light"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={finishOf(selected).blendMode === id ? "on" : ""}
                onClick={() => patchFinish({ blendMode: id as WallBlendMode })}
              >
                {label}
              </button>
            ))}
          </div>

          <label className="exp-check">
            Opacity
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.02}
              disabled={renderPreset === "opaque"}
              value={renderPreset === "opaque" ? 1 : finishOf(selected).opacity}
              onChange={(e) => {
                if (renderPreset === "opaque") return;
                patchFinish({ opacity: Number(e.target.value) });
              }}
            />
            <span className="exp-hint">
              {renderPreset === "opaque" ? "1.00 (Opaque preset)" : finishOf(selected).opacity.toFixed(2)}
            </span>
          </label>
          {renderPreset === "opaque" && (
            <p className="exp-hint">
              Opacity is locked while render preset is <b>Opaque</b>. Switch to{" "}
              <button type="button" className="exp-linkish" onClick={() => onRenderPreset("default")}>
                Default
              </button>{" "}
              for transparency.
            </p>
          )}
          <div className="exp-dev-row">
            <button type="button" onClick={restoreColor}>
              Restore matte + #c8d0d8
            </button>
          </div>

          <div className="exp-hint">Wallpaper / map upload (optional; composites in-shader)</div>
          <label className="exp-fp-replace">
            Upload texture
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp"
              hidden
              onChange={(e) => void onWallpaper(e.target.files?.[0] ?? null)}
            />
          </label>
          {selected.material.kind === "texture" &&
            (() => {
              const texMat = selected.material;
              const patchMap = (partial: Partial<typeof texMat.mapping>) =>
                patch({
                  material: { ...texMat, mapping: { ...texMat.mapping, ...partial } },
                });
              return (
                <div className="exp-surf-grid">
                  <label>
                    Tile U
                    <input
                      type="number"
                      step={0.1}
                      min={0.1}
                      value={texMat.mapping.repeatU}
                      onChange={(e) =>
                        patchMap({ repeatU: Math.max(0.1, Number(e.target.value) || 0.1) })
                      }
                    />
                  </label>
                  <label>
                    Tile V
                    <input
                      type="number"
                      step={0.1}
                      min={0.1}
                      value={texMat.mapping.repeatV}
                      onChange={(e) =>
                        patchMap({ repeatV: Math.max(0.1, Number(e.target.value) || 0.1) })
                      }
                    />
                  </label>
                  <label>
                    Off U
                    <input
                      type="number"
                      step={0.05}
                      value={texMat.mapping.offsetU}
                      onChange={(e) => patchMap({ offsetU: Number(e.target.value) || 0 })}
                    />
                  </label>
                  <label>
                    Off V
                    <input
                      type="number"
                      step={0.05}
                      value={texMat.mapping.offsetV}
                      onChange={(e) => patchMap({ offsetV: Number(e.target.value) || 0 })}
                    />
                  </label>
                  <label>
                    Tex rot °
                    <input
                      type="number"
                      step={1}
                      value={((texMat.mapping.rotation * 180) / Math.PI).toFixed(0)}
                      onChange={(e) =>
                        patchMap({ rotation: ((Number(e.target.value) || 0) * Math.PI) / 180 })
                      }
                    />
                  </label>
                </div>
              );
            })()}

          <div className="exp-hint">Artwork (independent of wall paint)</div>
          <div className="exp-dev-row">
            <label className="exp-fp-replace">
              Add artwork image
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp"
                hidden
                onChange={(e) => void onArtwork(e.target.files?.[0] ?? null)}
              />
            </label>
            <button
              type="button"
              title="Hide the wall panel so only the frame hangs on the original wall"
              onClick={() => {
                if (!selected) return;
                patch({ showBase: false });
              }}
            >
              Artwork only (hide panel)
            </button>
          </div>
          {selected.artwork.map((a) => (
            <div key={a.id} className="exp-art-card">
              <div className="exp-hint">{a.fileName}</div>
              <div className="exp-surf-grid">
                <label>
                  U
                  <input
                    type="number"
                    step={0.05}
                    value={a.u}
                    onChange={(e) => patchArt(a.id, { u: Number(e.target.value) || 0 })}
                  />
                </label>
                <label>
                  V
                  <input
                    type="number"
                    step={0.05}
                    value={a.v}
                    onChange={(e) => patchArt(a.id, { v: Number(e.target.value) || 0 })}
                  />
                </label>
                <label>
                  W
                  <input
                    type="number"
                    step={0.05}
                    min={0.1}
                    value={a.width}
                    onChange={(e) => patchArt(a.id, { width: Math.max(0.1, Number(e.target.value) || 0.1) })}
                  />
                </label>
                <label>
                  H
                  <input
                    type="number"
                    step={0.05}
                    min={0.1}
                    value={a.height}
                    onChange={(e) => patchArt(a.id, { height: Math.max(0.1, Number(e.target.value) || 0.1) })}
                  />
                </label>
                <label>
                  Frame
                  <input
                    type="color"
                    value={a.frameColor}
                    onChange={(e) => patchArt(a.id, { frameColor: e.target.value })}
                  />
                </label>
                <label>
                  Depth
                  <input
                    type="number"
                    step={0.005}
                    min={0}
                    value={a.frameDepth}
                    onChange={(e) => patchArt(a.id, { frameDepth: Math.max(0, Number(e.target.value) || 0) })}
                  />
                </label>
              </div>
              <button type="button" onClick={() => removeArt(a.id)}>
                Remove artwork
              </button>
            </div>
          ))}

          <div className="exp-dev-row">
            <button
              type="button"
              onClick={() => {
                removeSurfaceOverlay(propertyId, selected.id);
                onSelect(null);
                onRefresh();
              }}
            >
              Delete surface
            </button>
            <button type="button" onClick={() => onSelect(null)}>
              Deselect
            </button>
          </div>
        </div>
      )}

      <ExpDevSection id="occlusion-lab" title="Occlusion lab (EXP-05B)" defaultOpen={false}>
        <div className="exp-surf-lab">
          <p className="exp-hint">{describeOffsetConvention()}</p>
          {depthDiag && (
            <div className="exp-hint ok">
              Gap plane→wall:{" "}
              {depthDiag.signedGapM == null ? "n/a" : `${depthDiag.signedGapM.toFixed(3)} m`} (
              {depthDiag.source}) · plane (
              {depthDiag.planeOrigin.map((n) => n.toFixed(2)).join(", ")}) · n (
              {depthDiag.normal.map((n) => n.toFixed(2)).join(", ")})
            </div>
          )}
          {labNote && <div className="exp-hint">{labNote}</div>}
          <div className="exp-hint">Render preset (rebuilds overlays)</div>
          <div className="exp-dev-row">
            {(
              [
                ["opaque", "Opaque"],
                ["default", "Default"],
                ["noDepthWrite", "No depthWrite"],
                ["alwaysFront", "Always front"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={renderPreset === id ? "on" : ""}
                onClick={() => onRenderPreset(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {selected && (
            <div className="exp-dev-row">
              <button type="button" onClick={() => patch({ offset: 0 })}>
                offset 0
              </button>
              <button type="button" onClick={() => patch({ offset: 0.01 })}>
                +1 cm
              </button>
              <button type="button" onClick={() => patch({ offset: 0.02 })}>
                +2 cm
              </button>
              <button type="button" onClick={() => patch({ offset: -0.01 })}>
                −1 cm
              </button>
              <button
                type="button"
                onClick={() => {
                  patch({
                    material: { kind: "color", color: "#c8d0d8", opacity: 1 },
                    offset: 0.015,
                  });
                  onRenderPreset("opaque");
                }}
              >
                Opaque wall test
              </button>
            </div>
          )}
          <label className="exp-check">
            <input type="checkbox" checked={clipTest} onChange={(e) => onClipTest(e.target.checked)} />
            Thin clip box on selected wall (reversible)
          </label>
          <label className="exp-check">
            <input
              type="checkbox"
              checked={semanticProbe}
              onChange={(e) => onSemanticProbe(e.target.checked)}
            />
            Semantic colour probe
          </label>
          <label className="exp-check">
            <input
              type="checkbox"
              checked={collisionDepthProxy}
              onChange={(e) => onCollisionDepthProxy(e.target.checked)}
            />
            Collision depth-only proxy
          </label>
          <p className="exp-hint">
            Why sofa vanishes: a large overlay is a solid/translucent card. Soft furniture Gaussians often do not write
            usable depth, so the plane wins in the depth buffer and paints over the sofa. Offset slides the card; it does
            not cut a hole in the reconstruction.
          </p>
        </div>
      </ExpDevSection>

      <div className="exp-dev-row">
        <button
          type="button"
          onClick={() => {
            const blob = new Blob([JSON.stringify(exportSurfaces(propertyId), null, 2)], {
              type: "application/json",
            });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = `${propertyId}-surfaces.json`;
            a.click();
          }}
        >
          Export surfaces JSON
        </button>
      </div>
    </div>
  );
}

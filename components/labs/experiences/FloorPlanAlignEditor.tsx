"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckpointIcon } from "@/components/labs/experiences/CheckpointIcon";
import {
  CHECKPOINT_ICONS,
  DEFAULT_CHECKPOINT_ICON,
  type CheckpointIconId,
} from "@/lib/labs/experiences/checkpointIcons";
import { alignmentQuality, fitAffine, fitSimilarity } from "@/lib/labs/experiences/floorPlanAlign";
import {
  exportFloorPlans,
  fileToPlanImage,
  getFloorPlanImageUrl,
  listFloorPlans,
  removeFloorPlan,
  saveFloorPlanRecord,
} from "@/lib/labs/experiences/floorPlanStorage";
import type { FloorPlanAnchor, FloorPlanRecord } from "@/lib/labs/experiences/floorPlanTypes";
import type { ExperienceViewpoint } from "@/lib/labs/experiences/types";

type WorldPick =
  | {
      kind: "viewpoint";
      viewpointId: string;
      label: string;
      worldX: number;
      worldZ: number;
      icon: CheckpointIconId;
    }
  | {
      kind: "live";
      label: string;
      worldX: number;
      worldZ: number;
      icon: CheckpointIconId;
      /** When set, parent will create a named checkpoint after the plan click. */
      saveAsCheckpoint: boolean;
      checkpointName: string;
    };

type Props = {
  propertyId: string;
  floorId: string;
  floorName: string;
  modelDataPath?: string;
  viewpoints: ExperienceViewpoint[];
  livePose: { x: number; z: number } | null;
  onPlansChanged: () => void;
  onPreviewViewpoint?: (vp: ExperienceViewpoint) => void;
  /**
   * Create a checkpoint at the current camera from “where I stand”, then return it
   * so we can link the new plan pair. Prefer this over orphan live anchors.
   */
  onCreateCheckpointAtLive?: (meta: {
    name: string;
    icon: CheckpointIconId;
  }) => ExperienceViewpoint | null;
};

/**
 * Dev: upload floor plans, place 3D↔2D anchors, fit similarity (optional affine).
 * Pairing clicks go on the LARGE preview here — not the tiny top-right map.
 */
export function FloorPlanAlignEditor({
  propertyId,
  floorId,
  floorName,
  modelDataPath,
  viewpoints,
  livePose,
  onPlansChanged,
  onPreviewViewpoint,
  onCreateCheckpointAtLive,
}: Props) {
  const [plans, setPlans] = useState<FloorPlanRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [worldPick, setWorldPick] = useState<WorldPick | null>(null);
  const [anchorIcon, setAnchorIcon] = useState<CheckpointIconId>(DEFAULT_CHECKPOINT_ICON);
  const [liveName, setLiveName] = useState("");
  const [saveLiveAsCp, setSaveLiveAsCp] = useState(true);
  const [lastFlashId, setLastFlashId] = useState<string | null>(null);
  const [roomDraw, setRoomDraw] = useState(false);
  const [draftPoly, setDraftPoly] = useState<{ u: number; v: number }[]>([]);
  const [roomName, setRoomName] = useState("Room");
  const [roomVpId, setRoomVpId] = useState<string>("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    const list = listFloorPlans(propertyId);
    setPlans(list);
    if (!activeId && list[0]) setActiveId(list[0].id);
    if (activeId && !list.some((p) => p.id === activeId)) setActiveId(list[0]?.id ?? null);
    onPlansChanged();
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId]);

  const active = useMemo(() => plans.find((p) => p.id === activeId) ?? null, [plans, activeId]);

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    (async () => {
      if (!active) {
        setImgUrl(null);
        return;
      }
      const url = await getFloorPlanImageUrl(active.imageAssetId, active.publicUrl);
      if (cancelled) {
        if (url && !active.publicUrl) URL.revokeObjectURL(url);
        return;
      }
      if (url && !active.publicUrl) revoked = url;
      setImgUrl(url);
    })();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [active?.id, active?.imageAssetId, active?.publicUrl]);

  const persist = (next: FloorPlanRecord) => {
    saveFloorPlanRecord(next);
    refresh();
  };

  const onUpload = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const { assetId, width, height, mimeType } = await fileToPlanImage(file);
      const plan: FloorPlanRecord = {
        id: `fp_${Date.now().toString(36)}`,
        propertyId,
        floorId,
        floorName,
        imageAssetId: assetId,
        width,
        height,
        mimeType,
        isDefault: plans.length === 0,
        anchors: [],
        transform: null,
        rooms: [],
        coordSystemVersion: 1,
        modelDataPath,
        updatedAt: new Date().toISOString(),
      };
      saveFloorPlanRecord(plan);
      setActiveId(plan.id);
      refresh();
      setMsg("Plan uploaded. Pair Entrance, then Kitchen (≥3 pairs), then Calculate alignment.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const pickViewpoint = (vp: ExperienceViewpoint) => {
    setRoomDraw(false);
    const icon = (vp.icon as CheckpointIconId) || anchorIcon;
    setAnchorIcon(icon);
    setWorldPick({
      kind: "viewpoint",
      viewpointId: vp.id,
      label: vp.name,
      worldX: vp.position[0],
      worldZ: vp.position[2],
      icon,
    });
    onPreviewViewpoint?.(vp);
    setMsg(`① 3D locked: “${vp.name}”. Click that spot on the LARGE blue-bordered plan below.`);
  };

  const pickLive = () => {
    if (!livePose) {
      setMsg("Walk somewhere first — live position not ready yet.");
      return;
    }
    setRoomDraw(false);
    const name = liveName.trim() || "Where I stand";
    setWorldPick({
      kind: "live",
      label: name,
      worldX: livePose.x,
      worldZ: livePose.z,
      icon: anchorIcon,
      saveAsCheckpoint: saveLiveAsCp,
      checkpointName: name,
    });
    setMsg(
      saveLiveAsCp
        ? `① Standing spot locked as “${name}”. Click the plan — we’ll also save a new checkpoint.`
        : `① Standing spot locked (pair only). Click the plan. Tip: turn on “Also save as checkpoint” to name it.`,
    );
  };

  const clearWorldPick = () => {
    setWorldPick(null);
    setMsg(null);
  };

  const addAnchorFromPlanClick = (u: number, v: number) => {
    if (!active || !worldPick) return;

    let viewpointId: string | undefined =
      worldPick.kind === "viewpoint" ? worldPick.viewpointId : undefined;
    let label = worldPick.label;
    let icon = worldPick.icon;
    let worldX = worldPick.worldX;
    let worldZ = worldPick.worldZ;

    if (worldPick.kind === "live" && worldPick.saveAsCheckpoint && onCreateCheckpointAtLive) {
      const name = worldPick.checkpointName.trim() || "New spot";
      const vp = onCreateCheckpointAtLive({ name, icon: worldPick.icon });
      if (vp) {
        viewpointId = vp.id;
        label = vp.name;
        icon = (vp.icon as CheckpointIconId) || worldPick.icon;
        worldX = vp.position[0];
        worldZ = vp.position[2];
      }
    }

    const anchor: FloorPlanAnchor = {
      id: `anc_${Date.now().toString(36)}`,
      viewpointId,
      label,
      icon,
      worldX,
      worldZ,
      u,
      v,
    };
    const nextCount = active.anchors.length + 1;
    persist({ ...active, anchors: [...active.anchors, anchor], transform: null });
    setLastFlashId(anchor.id);
    window.setTimeout(() => setLastFlashId((id) => (id === anchor.id ? null : id)), 1600);
    setWorldPick(null);
    if (nextCount < 3) {
      setMsg(`② Blue pin placed for “${label}” (${nextCount}/3+). Pick another 3D place, then click the plan again.`);
    } else {
      setMsg(`② Blue pin placed for “${label}” (${nextCount} pairs). Press Calculate alignment to save the transform.`);
    }
  };

  const recalculate = (affine = false) => {
    if (!active) return;
    const result = affine ? fitAffine(active.anchors) : fitSimilarity(active.anchors);
    if ("error" in result) {
      setMsg(result.error);
      return;
    }
    persist({ ...active, transform: result });
    const q = alignmentQuality(result, active.anchors.length);
    setMsg(
      `${affine ? "Affine" : "Similarity"} fit saved · ${q.message} — top-right map will now show markers.`,
    );
  };

  const quality = active ? alignmentQuality(active.transform, active.anchors.length) : null;
  const waitingForPlan = !!worldPick && !roomDraw;

  const replaceImage = async (file: File | null) => {
    if (!file || !active) return;
    setBusy(true);
    try {
      const { assetId, width, height, mimeType } = await fileToPlanImage(file);
      persist({
        ...active,
        imageAssetId: assetId,
        publicUrl: undefined,
        width,
        height,
        mimeType,
        anchors: [],
        transform: null,
      });
      setWorldPick(null);
      setMsg("Image replaced — re-do anchors.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const finishRoom = () => {
    if (!active || draftPoly.length < 3) {
      setMsg("Need ≥3 polygon corners for a room.");
      return;
    }
    const room = {
      id: `room_${Date.now().toString(36)}`,
      name: roomName.trim() || "Room",
      floorId,
      polygon: draftPoly,
      viewpointIds: roomVpId ? [roomVpId] : [],
      defaultViewpointId: roomVpId || undefined,
    };
    persist({ ...active, rooms: [...active.rooms, room] });
    setDraftPoly([]);
    setRoomDraw(false);
    setMsg(`Room “${room.name}” saved — visitors can click that region to fly to its checkpoint.`);
  };

  const entrance = viewpoints.find((v) => /entrance/i.test(v.name));
  const kitchen = viewpoints.find((v) => /kitchen/i.test(v.name));
  const living = viewpoints.find((v) => /living/i.test(v.name));

  const iconForAnchor = (a: FloorPlanAnchor): CheckpointIconId => {
    if (a.icon && CHECKPOINT_ICONS.some((c) => c.id === a.icon)) return a.icon as CheckpointIconId;
    const vp = viewpoints.find((v) => v.id === a.viewpointId);
    return (vp?.icon as CheckpointIconId) || DEFAULT_CHECKPOINT_ICON;
  };

  return (
    <div className="exp-fp-editor">
      <b className="exp-sub">Floor plans — align</b>

      <ol className="exp-fp-steps">
        <li>
          <b>Recommended:</b> create named checkpoints first (Dev → New checkpoint), then pair them here.
        </li>
        <li>
          Or use <b>Where I stand</b> with a name — that creates a checkpoint and places the plan pin together.
        </li>
        <li>
          Click the plan only on the <em>large image below</em> (not the top-right visitor map).
        </li>
        <li>
          <b>Calculate alignment</b> is the save — it writes the transform to local storage immediately.
        </li>
      </ol>

      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        disabled={busy}
        onChange={(e) => void onUpload(e.target.files?.[0] ?? null)}
      />
      {plans.length > 0 && (
        <select value={activeId ?? ""} onChange={(e) => setActiveId(e.target.value)}>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.floorName}
              {p.isDefault ? " (default)" : ""} · {p.anchors.length} anchors
            </option>
          ))}
        </select>
      )}

      {active && (
        <>
          <label className="exp-hint">
            Floor name{" "}
            <input
              type="text"
              value={active.floorName}
              onChange={(e) => persist({ ...active, floorName: e.target.value })}
            />
          </label>
          <div className="exp-dev-row">
            <button type="button" onClick={() => persist({ ...active, isDefault: true })}>
              Set default
            </button>
            <label className="exp-fp-replace">
              Replace image
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={busy}
                hidden
                onChange={(e) => void replaceImage(e.target.files?.[0] ?? null)}
              />
            </label>
            <button
              type="button"
              onClick={() => {
                void removeFloorPlan(propertyId, active.id).then(() => {
                  setWorldPick(null);
                  refresh();
                });
              }}
            >
              Remove
            </button>
            <button
              type="button"
              onClick={() => {
                const blob = new Blob([JSON.stringify(exportFloorPlans(propertyId), null, 2)], {
                  type: "application/json",
                });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = `${propertyId}-floor-plans.json`;
                a.click();
              }}
            >
              Export JSON
            </button>
          </div>

          <div className={`exp-fp-status${worldPick ? " ready" : ""}`}>
            {worldPick ? (
              <>
                <span className="exp-fp-badge ok">① 3D ready</span>
                <strong>{worldPick.label}</strong>
                <button type="button" className="exp-fp-clear" onClick={clearWorldPick}>
                  Clear
                </button>
                <span className="exp-fp-badge wait">② Click large plan</span>
              </>
            ) : (
              <>
                <span className="exp-fp-badge">① Choose 3D place</span>
                <span>Checkpoint chip, or name a standing spot below.</span>
              </>
            )}
          </div>

          <div className="exp-fp-icon-row" title="Symbol for the next plan pin">
            <span className="exp-hint">Pin symbol</span>
            <div className="exp-icon-picker compact">
              {CHECKPOINT_ICONS.map((ic) => (
                <button
                  key={ic.id}
                  type="button"
                  className={anchorIcon === ic.id ? "on" : ""}
                  title={ic.label}
                  onClick={() => setAnchorIcon(ic.id)}
                >
                  <CheckpointIcon id={ic.id} />
                </button>
              ))}
            </div>
          </div>

          <div className="exp-fp-live-box">
            <input
              type="text"
              placeholder="Name for where I stand (e.g. Kitchen)"
              value={liveName}
              onChange={(e) => setLiveName(e.target.value)}
            />
            <label className="exp-check">
              <input type="checkbox" checked={saveLiveAsCp} onChange={(e) => setSaveLiveAsCp(e.target.checked)} />
              Also save as checkpoint
            </label>
            <button type="button" className={worldPick?.kind === "live" ? "on" : ""} onClick={pickLive}>
              ① Use where I stand
            </button>
          </div>

          <div className="exp-fp-quick">
            {entrance && (
              <button
                type="button"
                className={
                  worldPick?.kind === "viewpoint" && worldPick.viewpointId === entrance.id ? "on" : ""
                }
                onClick={() => pickViewpoint(entrance)}
              >
                ① Entrance
              </button>
            )}
            {kitchen ? (
              <button
                type="button"
                className={
                  worldPick?.kind === "viewpoint" && worldPick.viewpointId === kitchen.id ? "on" : ""
                }
                onClick={() => pickViewpoint(kitchen)}
              >
                ① Kitchen
              </button>
            ) : (
              living && (
                <button
                  type="button"
                  className={
                    worldPick?.kind === "viewpoint" && worldPick.viewpointId === living.id ? "on" : ""
                  }
                  onClick={() => pickViewpoint(living)}
                >
                  ① Living
                </button>
              )
            )}
          </div>

          <div className="exp-fp-vp-grid">
            {viewpoints.map((vp) => {
              const paired = active.anchors.some((a) => a.viewpointId === vp.id);
              const selected = worldPick?.kind === "viewpoint" && worldPick.viewpointId === vp.id;
              return (
                <button
                  key={vp.id}
                  type="button"
                  className={`exp-fp-vp${selected ? " on" : ""}${paired ? " paired" : ""}`}
                  onClick={() => pickViewpoint(vp)}
                >
                  {paired ? "✓ " : ""}
                  {vp.name}
                </button>
              );
            })}
          </div>

          {imgUrl && (
            <div className={`exp-fp-preview${waitingForPlan ? " waiting" : ""}`}>
              <div className="exp-fp-preview-banner">
                {waitingForPlan
                  ? `② Click “${worldPick!.label}” here — a blue pin appears immediately`
                  : roomDraw
                    ? "Click room corners on THIS image"
                    : "Plan preview — pairing clicks go here"}
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imgUrl}
                alt="Floor plan — click here to place 2D side of an anchor"
                className={waitingForPlan || roomDraw ? "picking" : ""}
                onClick={(e) => {
                  if (roomDraw) {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const u = (e.clientX - rect.left) / rect.width;
                    const v = (e.clientY - rect.top) / rect.height;
                    setDraftPoly((p) => [...p, { u, v }]);
                    return;
                  }
                  if (!worldPick) {
                    setMsg("First pick a 3D place (or Where I stand), then click this image.");
                    return;
                  }
                  const rect = e.currentTarget.getBoundingClientRect();
                  const u = (e.clientX - rect.left) / rect.width;
                  const v = (e.clientY - rect.top) / rect.height;
                  addAnchorFromPlanClick(u, v);
                }}
              />
              {active.anchors.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={`exp-fp-anchor${lastFlashId === a.id ? " flash" : ""}`}
                  style={{ left: `${a.u * 100}%`, top: `${a.v * 100}%` }}
                  title={`${a.label ?? a.id} · click to remove`}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    persist({
                      ...active,
                      anchors: active.anchors.filter((x) => x.id !== a.id),
                      transform: null,
                    });
                  }}
                >
                  <CheckpointIcon id={iconForAnchor(a)} className="exp-fp-anchor-icon" />
                </button>
              ))}
              {draftPoly.map((p, i) => (
                <span
                  key={`d${i}`}
                  className="exp-fp-draft"
                  style={{ left: `${p.u * 100}%`, top: `${p.v * 100}%` }}
                />
              ))}
            </div>
          )}

          {active.anchors.length > 0 && (
            <ul className="exp-fp-pairs">
              {active.anchors.map((a, i) => (
                <li key={a.id}>
                  Pair {i + 1}: <b>{a.label ?? a.id}</b>
                </li>
              ))}
            </ul>
          )}

          <div className="exp-dev-row">
            <button type="button" onClick={() => recalculate(false)} disabled={active.anchors.length < 2}>
              Calculate alignment (= save)
            </button>
            <button type="button" onClick={() => recalculate(true)} title="Nonuniform — use with caution">
              Optional affine
            </button>
            <button
              type="button"
              onClick={() => {
                persist({ ...active, transform: null, anchors: [] });
                setWorldPick(null);
                setMsg("Alignment reset.");
              }}
            >
              Reset pairs
            </button>
          </div>
          {quality && <div className={`exp-hint${quality.ok ? " ok" : ""}`}>{quality.message}</div>}
          {active.transform?.kind === "affine" && <div className="exp-hint">{active.transform.warning}</div>}

          <details className="exp-fp-rooms-block">
            <summary>Room polygons (optional — after alignment)</summary>
            <p className="exp-hint">
              Draw a shape on the plan for a room (Living, Kitchen…). Choose which checkpoint “Fly to” when a
              visitor clicks that region on the map. This is separate from alignment pins.
            </p>
            <div className="exp-dev-row">
              <input
                type="text"
                value={roomName}
                placeholder="Room name"
                onChange={(e) => setRoomName(e.target.value)}
              />
              <select value={roomVpId || viewpoints[0]?.id || ""} onChange={(e) => setRoomVpId(e.target.value)}>
                {viewpoints.map((vp) => (
                  <option key={vp.id} value={vp.id}>
                    Fly to: {vp.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={roomDraw ? "on" : ""}
                onClick={() => {
                  setWorldPick(null);
                  setDraftPoly([]);
                  setRoomDraw((v) => !v);
                }}
              >
                {roomDraw ? "Drawing…" : "Draw room"}
              </button>
              {roomDraw && (
                <button type="button" onClick={finishRoom} disabled={draftPoly.length < 3}>
                  Finish ({draftPoly.length})
                </button>
              )}
            </div>
            {active.rooms.length > 0 && (
              <ul className="exp-fp-rooms">
                {active.rooms.map((r) => (
                  <li key={r.id}>
                    {r.name}{" "}
                    <button
                      type="button"
                      onClick={() => persist({ ...active, rooms: active.rooms.filter((x) => x.id !== r.id) })}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </details>
        </>
      )}
      {msg && <div className="exp-fp-msg">{msg}</div>}
    </div>
  );
}

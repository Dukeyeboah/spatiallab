"use client";

import { useEffect, useState } from "react";
import type { Vec3 } from "@/lib/datasets";
import { loadStored, store, type Correspondence } from "@/lib/correspondences";
import { DEFAULT_FISHEYE_MODEL, type FisheyeModel } from "@/lib/fisheyeProjection";
import { DEFAULT_PICK_OPTIONS, type PickOptions, type PickResult } from "@/lib/pointPicking";

/** A clicked image position, tied to the image it was clicked on. */
export type PendingPixel = { runId: string; imageFile: string; u: number; v: number };

/** A LiDAR pick, tied to the cloud it was made on (dataset coordinates + that cloud's offset). */
export type PendingPick = { datasetId: string; budget: string; offset: Vec3; result: PickResult };

/**
 * Lab 13U: state shared by the correspondence panel, the image viewer and the
 * 3D picker. Records persist in localStorage (read after mounting: the page
 * is prerendered without it).
 */
export function useCorrespondenceLab() {
  const [records, setRecordsState] = useState<Correspondence[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setRecordsState(loadStored());
    setLoaded(true);
  }, []);
  const setRecords = (next: Correspondence[]) => {
    setRecordsState(next);
    if (loaded) store(next);
  };

  const [channel, setChannel] = useState("ch14");
  const [pendingPixel, setPendingPixel] = useState<PendingPixel | null>(null);
  const [pendingPick, setPendingPick] = useState<PendingPick | null>(null);
  /** Use the ray ∩ local plane refinement when it succeeded. */
  const [preferRefined, setPreferRefined] = useState(true);
  const [pickArmed, setPickArmed] = useState(false);
  const [pickOptions, setPickOptions] = useState<PickOptions>(DEFAULT_PICK_OPTIONS);
  const [model, setModel] = useState<FisheyeModel>(DEFAULT_FISHEYE_MODEL);
  const [showOverlay, setShowOverlay] = useState(false);
  const [showPredictions, setShowPredictions] = useState(true);

  return {
    records,
    setRecords,
    channel,
    setChannel,
    pendingPixel,
    setPendingPixel,
    pendingPick,
    setPendingPick,
    preferRefined,
    setPreferRefined,
    pickArmed,
    setPickArmed,
    pickOptions,
    setPickOptions,
    model,
    setModel,
    showOverlay,
    setShowOverlay,
    showPredictions,
    setShowPredictions,
  };
}

export type CorrespondenceLab = ReturnType<typeof useCorrespondenceLab>;

/** The LiDAR position a pending pick would save, in dataset coordinates, and how it was found. */
export function chosenPick(pick: PickResult, preferRefined: boolean) {
  if (preferRefined && pick.plane.ok)
    return {
      position: pick.plane.position,
      method: "ray-plane" as const,
      detail: `click ray ∩ plane fitted to ${pick.plane.neighbours} points within the neighbourhood (rms ${(pick.plane.rmsM * 1000).toFixed(1)} mm), ${(pick.plane.shiftM * 100).toFixed(1)} cm from the nearest point`,
    };
  return {
    position: pick.nearest.position,
    method: "nearest-point" as const,
    detail: `approximate: front scan point nearest the cursor (${pick.nearest.screenDistancePx.toFixed(1)} px from it, ${pick.candidates} candidates, ${pick.nearest.depthM.toFixed(1)} m from the view)`,
  };
}

/** Dataset coordinates (float32 values) + offset → original LAS, in float64. */
export const datasetToLas = (p: Vec3, offset: Vec3): Vec3 => [p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]];

"use client";

import { useMemo, useState } from "react";
import { parseCorrespondenceFile, type Correspondence } from "@/lib/correspondences";
import type { AuditResponse, Experiment, SetCamera } from "@/lib/calibrationExperiment";

/** The correspondence export an experiment runs on: its exact text (hashed by the backend) and parsed records. */
export type OptimizationSource = { name: string; origin: "browser" | "file"; text: string; records: Correspondence[]; rejected: string[] };

/**
 * Lab 13V: state of the calibration optimization mode, shared by the panel
 * and the image viewer. Kept in memory only; the durable copy is the
 * exported experiment JSON.
 */
export function useCalibrationOptimization() {
  const [source, setSourceState] = useState<OptimizationSource | null>(null);
  const [audit, setAudit] = useState<AuditResponse | null>(null);
  /** User overrides of the audit's default use: true = fit it, false = leave it out. */
  const [use, setUse] = useState<Record<string, boolean>>({});
  const [experiment, setExperiment] = useState<Experiment | null>(null);
  const [displaySet, setDisplaySet] = useState("provisional");
  const [showOverlay, setShowOverlay] = useState(false);

  const setSource = (text: string, name: string, origin: OptimizationSource["origin"]) => {
    const { records, rejected } = parseCorrespondenceFile(text);
    setSourceState({ name, origin, text, records, rejected });
    setAudit(null);
    setUse({});
    setExperiment(null);
    setDisplaySet("provisional");
  };

  const cameras: Record<string, SetCamera> | null = experiment?.parameterSets[displaySet]?.cameras ?? null;
  const excludedByDefault = useMemo(() => new Set(audit?.audit.excludedByDefault ?? []), [audit]);
  const isUsed = (id: string) => use[id] ?? !excludedByDefault.has(id);

  return {
    source,
    setSource,
    audit,
    setAudit,
    use,
    setUse,
    isUsed,
    excludedByDefault,
    experiment,
    setExperiment,
    displaySet,
    setDisplaySet,
    cameras,
    showOverlay,
    setShowOverlay,
  };
}

export type CalibrationOptimization = ReturnType<typeof useCalibrationOptimization>;

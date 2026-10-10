"use client";

import { useMemo, useState } from "react";
import { CompositingScene } from "@/components/gaussian/CompositingScene";
import { CompositingPanel } from "@/components/gaussian/CompositingPanel";
import type { CompositingReport } from "@/components/gaussian/CompositedGaussians";
import { createScene } from "@/lib/gaussian/compositingScene";
import {
  defaultCompositingControls,
  type CompositingControlsState,
} from "@/lib/gaussian/compositingControls";

/**
 * Lab 7B: many Gaussians and alpha compositing. Like Lab 6, an isolated
 * experiment with its own scene and camera; nothing here touches the LiDAR
 * viewer's data, frames or camera.
 */
export default function GaussianCompositingPage() {
  const [controls, setControls] = useState<CompositingControlsState>(defaultCompositingControls);
  const [resetRequest, setResetRequest] = useState(0);
  const [report, setReport] = useState<CompositingReport | null>(null);

  const scene = useMemo(() => createScene(controls.count), [controls.count]);

  function reset() {
    setControls(defaultCompositingControls);
    setResetRequest((n) => n + 1);
  }

  return (
    <>
      <CompositingScene scene={scene} controls={controls} resetRequest={resetRequest} onReport={setReport} />
      <CompositingPanel state={controls} onChange={setControls} onReset={reset} report={report} />
    </>
  );
}

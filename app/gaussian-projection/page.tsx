"use client";

import { useMemo, useState } from "react";
import { GaussianProjectionScene } from "@/components/gaussian/GaussianProjectionScene";
import { GaussianProjectionPanel } from "@/components/gaussian/GaussianProjectionPanel";
import { covariance3D, type ProjectedGaussian } from "@/lib/gaussian/gaussianMath";
import {
  defaultGaussianControls,
  toGaussian3D,
  type GaussianControlsState,
} from "@/lib/gaussian/gaussianControls";

/**
 * Lab 6: an isolated experiment with its own scene and camera. Nothing here
 * touches the LiDAR viewer's data, coordinate frames or camera state.
 */
export default function GaussianProjectionPage() {
  const [controls, setControls] = useState<GaussianControlsState>(defaultGaussianControls);
  const [resetRequest, setResetRequest] = useState(0);
  const [projection, setProjection] = useState<ProjectedGaussian | null>(null);

  const gaussian = useMemo(() => toGaussian3D(controls), [controls]);
  const sigma3D = useMemo(() => covariance3D(gaussian), [gaussian]);

  function reset() {
    setControls(defaultGaussianControls);
    setResetRequest((n) => n + 1);
  }

  return (
    <>
      <GaussianProjectionScene
        gaussian={gaussian}
        sigma3D={sigma3D}
        supportSigmas={controls.supportSigmas}
        showOutline={controls.showOutline}
        showEllipsoid={controls.showEllipsoid}
        resetRequest={resetRequest}
        onProjection={setProjection}
      />
      <GaussianProjectionPanel
        state={controls}
        onChange={setControls}
        onReset={reset}
        sigma3D={sigma3D}
        projection={projection}
      />
    </>
  );
}

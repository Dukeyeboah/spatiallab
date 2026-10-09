"use client";

import { useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { pointCloudVertexShader } from "@/shaders/pointCloudVertex";
import { pointCloudFragmentShader } from "@/shaders/pointCloudFragment";
import { heightVertexShader, heightFragmentShader } from "@/shaders/heightShader";
import { depthSizeVertexShader } from "@/shaders/depthSizeShader";
import { circleFragmentShader } from "@/shaders/circleShader";
import { softCircleFragmentShader } from "@/shaders/softCircleShader";
import { gaussianFragmentShader } from "@/shaders/gaussianShader";
import { ellipticalGaussianFragmentShader } from "@/shaders/ellipticalGaussianShader";
import {
  TRANSPARENT_EXPERIMENTS,
  type ShaderExperiment,
  type SoftPointSettings,
} from "@/lib/viewSettings";

/**
 * Which vertex + fragment shader each experiment uses. Reading this table
 * shows which stage of the pipeline each experiment changes:
 *   height     -> both stages (new varying)
 *   depthSize  -> vertex stage only (gl_PointSize)
 *   circle     -> fragment stage only (discard)
 *   softCircle -> fragment stage only (alpha from smoothstep)
 *   gaussian   -> fragment stage only (alpha from exp)
 *   ellipticalGaussian -> fragment stage only (rotated, two-sigma exp)
 */
const SHADERS: Record<ShaderExperiment, { vertex: string; fragment: string }> = {
  rgb: { vertex: pointCloudVertexShader, fragment: pointCloudFragmentShader },
  height: { vertex: heightVertexShader, fragment: heightFragmentShader },
  depthSize: { vertex: depthSizeVertexShader, fragment: pointCloudFragmentShader },
  circle: { vertex: pointCloudVertexShader, fragment: circleFragmentShader },
  softCircle: { vertex: pointCloudVertexShader, fragment: softCircleFragmentShader },
  gaussian: { vertex: pointCloudVertexShader, fragment: gaussianFragmentShader },
  ellipticalGaussian: {
    vertex: pointCloudVertexShader,
    fragment: ellipticalGaussianFragmentShader,
  },
};

/** Depth Size: at this distance from the camera (metres) points have the slider size. */
const REFERENCE_DEPTH = 10;

type ShaderPointsMaterialProps = {
  /** Point size in CSS pixels (the Size slider). */
  pointSize: number;
  experiment: ShaderExperiment;
  /** Vertical range of the scan in LiDAR-local metres (for the Height experiment). */
  minHeight: number;
  maxHeight: number;
  /** Soft Circle, Gaussian Point and Elliptical Gaussian parameters. */
  softPoints: SoftPointSettings;
};

/**
 * A minimal custom material for <points>.
 *
 * RawShaderMaterial is ShaderMaterial without the code three.js silently
 * prepends, so every attribute and uniform the shaders use is declared
 * visibly in the shader files. three.js still fills in modelViewMatrix and
 * projectionMatrix for us each frame.
 */
export function ShaderPointsMaterial({
  pointSize,
  experiment,
  minHeight,
  maxHeight,
  softPoints,
}: ShaderPointsMaterialProps) {
  // Device pixel ratio (2 on Retina). gl_PointSize is in device pixels, so we
  // multiply to match pointsMaterial, which does the same internally.
  const dpr = useThree((state) => state.viewport.dpr);

  // R3F copies these values into the material's own uniforms, so editing this
  // object later would not reach the GPU. Instead we build a new object when an
  // input changes; R3F then copies the new values in (no shader recompile).
  // Every experiment gets all uniforms; a shader simply ignores ones it doesn't declare.
  const uniforms = useMemo(
    () => ({
      uPointSize: { value: pointSize * dpr },
      uMinHeight: { value: minHeight },
      uMaxHeight: { value: maxHeight },
      uReferenceDepth: { value: REFERENCE_DEPTH },
      uInnerRadius: { value: softPoints.innerRadius },
      uOuterRadius: { value: softPoints.outerRadius },
      uSigma: { value: softPoints.sigma },
      uOpacity: { value: softPoints.opacity },
      uSigmaX: { value: softPoints.sigmaX },
      uSigmaY: { value: softPoints.sigmaY },
      // GLSL's sin/cos work in radians.
      uRotation: { value: (softPoints.rotationDegrees * Math.PI) / 180 },
    }),
    [pointSize, dpr, minHeight, maxHeight, softPoints],
  );

  const shader = SHADERS[experiment];

  /*
   * Transparency and the depth buffer
   *
   * transparent: true turns on blending: the fragment colour is mixed with
   * what is already on screen using its alpha. three.js also draws
   * transparent objects after opaque ones (scan after grid, path, marker).
   *
   * depthTest (kept on): a point is hidden if something closer has already
   * written to the depth buffer. Keeps the scan behind/in front of the
   * opaque scanner marker and path correctly.
   *
   * depthWrite (off by default for soft points): whether this point records
   * its own depth so later points behind it are rejected.
   *   - ON:  points are drawn in file order, not back-to-front. A near point
   *          drawn first writes depth over its whole (soft, partly
   *          transparent) area, and farther points drawn later are rejected
   *          there. Result: dark/cut-out halos around points.
   *   - OFF: nothing blocks anything within the scan; every overlapping
   *          point is blended in. No halos, but the result depends on draw
   *          order and dense areas look more "see-through".
   * A real Gaussian splat renderer avoids this trade-off by sorting splats
   * back-to-front every frame; we don't sort yet.
   */
  const isTransparent = TRANSPARENT_EXPERIMENTS.includes(experiment);

  return (
    <rawShaderMaterial
      // A different shader pair is a different GPU program, so we let React
      // create a new material per experiment instead of editing this one.
      key={experiment}
      vertexShader={shader.vertex}
      fragmentShader={shader.fragment}
      uniforms={uniforms}
      transparent={isTransparent}
      depthTest={true}
      depthWrite={isTransparent ? softPoints.depthWrite : true}
    />
  );
}

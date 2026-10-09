"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { ShaderPointsMaterial } from "./ShaderPointsMaterial";
import type { PointCloudData } from "@/lib/loadPointCloud";
import { usefulBounds } from "@/lib/usefulBounds";
import type { RenderMode, ShaderExperiment, SoftPointSettings } from "@/lib/viewSettings";

type PointCloudProps = {
  data: PointCloudData;
  pointSize: number;
  /** Only used by "standard" mode. */
  showRgb: boolean;
  renderMode: RenderMode;
  /** Only used by "shader" mode. */
  shaderExperiment: ShaderExperiment;
  /** Only used by the Soft Circle and Gaussian Point shader experiments. */
  softPoints: SoftPointSettings;
};

/**
 * The basic point-cloud pipeline:
 *
 *   typed arrays  ->  BufferAttributes  ->  BufferGeometry  ->  <points> + material
 *
 * Every point is one vertex. The GPU draws each vertex as a small square.
 */
export function PointCloud({
  data,
  pointSize,
  showRgb,
  renderMode,
  shaderExperiment,
  softPoints,
}: PointCloudProps) {
  const geometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();

    // 3 numbers per vertex: x, y, z.
    geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));

    // 3 numbers per vertex: r, g, b.
    // `normalized = true` tells the GPU to map uint8 0..255 to 0.0..1.0,
    // so we can keep 1 byte per channel instead of a 4-byte float.
    geometry.setAttribute("color", new THREE.BufferAttribute(data.colors, 3, true));

    // Used by three.js for frustum culling.
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    return geometry;
  }, [data]);

  // Vertical range of the scan (LiDAR-local Z) for the Height shader experiment.
  const heightBounds = useMemo(() => usefulBounds(data.positions), [data]);

  // Free GPU memory when the data changes or the component unmounts.
  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    // Same geometry in both modes; only the material (the GPU program) changes.
    <points geometry={geometry}>
      {renderMode === "standard" ? (
        <pointsMaterial
          // Changing `vertexColors` requires the shader to be recompiled.
          // Using it as a `key` makes React create a fresh material instead.
          key={showRgb ? "rgb" : "flat"}
          vertexColors={showRgb}
          color={showRgb ? "white" : "#9ab"}
          size={pointSize}
          // false = `size` is in screen pixels, independent of distance.
          // true  = `size` is in world units (metres), points shrink with distance.
          sizeAttenuation={false}
        />
      ) : (
        <ShaderPointsMaterial
          pointSize={pointSize}
          experiment={shaderExperiment}
          minHeight={heightBounds.min.z}
          maxHeight={heightBounds.max.z}
          softPoints={softPoints}
        />
      )}
    </points>
  );
}

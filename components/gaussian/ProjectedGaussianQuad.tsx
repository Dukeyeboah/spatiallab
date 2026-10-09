"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { projectGaussian, type Gaussian3D, type ProjectedGaussian } from "@/lib/gaussian/gaussianMath";
import {
  projectedGaussianFragmentShader,
  projectedGaussianVertexShader,
} from "@/shaders/projectedGaussianShader";

type ProjectedGaussianQuadProps = {
  gaussian: Gaussian3D;
  sigma3D: THREE.Matrix3;
  supportSigmas: number;
  showOutline: boolean;
  /** Called when the projection result changes (camera or Gaussian moved). */
  onProjection: (projection: ProjectedGaussian) => void;
};

/**
 * Projects the Gaussian every frame (the camera may be orbiting) and draws the
 * resulting 2D ellipse on a screen-space quad.
 */
export function ProjectedGaussianQuad({
  gaussian,
  sigma3D,
  supportSigmas,
  showOutline,
  onProjection,
}: ProjectedGaussianQuadProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const lastReport = useRef("");

  // A 2x2 plane: corners at (+-1, +-1). The vertex shader turns them into
  // screen-space offsets, so the plane's own world position is irrelevant.
  const geometry = useMemo(() => new THREE.PlaneGeometry(2, 2), []);

  // Created directly (not via JSX props) so we own the uniform objects and
  // can update their values every frame.
  const material = useMemo(
    () =>
      new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: projectedGaussianVertexShader,
        fragmentShader: projectedGaussianFragmentShader,
        uniforms: {
          uCenterClip: { value: new THREE.Vector4() },
          uMajorAxisPx: { value: new THREE.Vector2() },
          uMinorAxisPx: { value: new THREE.Vector2() },
          uViewportPx: { value: new THREE.Vector2() },
          uConic: { value: new THREE.Vector3() },
          uColor: { value: new THREE.Color() },
          uOpacity: { value: 1 },
          uSupportSigmas: { value: 3 },
          uShowOutline: { value: true },
        },
        transparent: true,
        // The shader outputs colour already multiplied by alpha. This switches
        // NormalBlending to  src * 1 + dst * (1 - src.alpha).
        premultipliedAlpha: true,
        // A 2D overlay of the projection: always drawn on top, writes no depth.
        depthTest: false,
        depthWrite: false,
      }),
    [],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  useFrame(({ camera, size }) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const projection = projectGaussian(
      gaussian,
      sigma3D,
      camera as THREE.PerspectiveCamera,
      size,
    );

    mesh.visible = projection.visible;
    if (projection.visible) {
      const u = material.uniforms;
      u.uCenterClip.value.copy(projection.centerClip);
      u.uMajorAxisPx.value
        .copy(projection.majorDir)
        .multiplyScalar(supportSigmas * projection.sigmaMajorPx);
      u.uMinorAxisPx.value
        .copy(projection.minorDir)
        .multiplyScalar(supportSigmas * projection.sigmaMinorPx);
      u.uViewportPx.value.set(size.width, size.height);
      u.uConic.value.set(projection.conic.a, projection.conic.b, projection.conic.c);
      u.uColor.value.copy(gaussian.color);
      u.uOpacity.value = gaussian.opacity;
      u.uSupportSigmas.value = supportSigmas;
      u.uShowOutline.value = showOutline;
    }

    // Only tell React when the numbers shown in the panel actually change.
    const report = reportKey(projection);
    if (report !== lastReport.current) {
      lastReport.current = report;
      onProjection(projection);
    }
  });

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={material}
      // Its real position is computed in the shader; never cull it.
      frustumCulled={false}
      renderOrder={10}
    />
  );
}

function reportKey(p: ProjectedGaussian): string {
  if (!p.visible) return `hidden:${p.reason}`;
  const { a, b, c } = p.cov2D;
  return [a, b, c, p.depth, p.angleDeg].map((v) => v.toFixed(2)).join(",");
}

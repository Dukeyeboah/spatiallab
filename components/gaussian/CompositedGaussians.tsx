"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import {
  MAX_ALPHA,
  MIN_ALPHA,
  SUPPORT_SIGMAS,
  compositePixel,
  covarianceFromScaleRotation,
  frameCamera,
  newCovariance3,
  newSplat,
  projectSplat,
  type Contribution,
} from "@/lib/gaussian/compositing";
import { animateGaussian, newAnimatedGaussian, type SceneGaussian } from "@/lib/gaussian/compositingScene";
import type { CompositingControlsState } from "@/lib/gaussian/compositingControls";
import {
  compositedGaussianFragmentShader,
  compositedGaussianVertexShader,
} from "@/shaders/compositedGaussianShader";

/** The page background (#1a1a1a) that shows through wherever transmittance is left. */
export const BACKGROUND_RGB = [0x1a / 255, 0x1a / 255, 0x1a / 255] as const;

/**
 * Front-to-back ("under") blending. The canvas starts fully transparent; its
 * alpha channel holds the accumulated opacity, i.e. 1 - transmittance. Each
 * premultiplied fragment (c * alpha, alpha) is added scaled by what is still
 * transparent:
 *
 *   dst.rgb += (1 - dst.a) * alpha * c        (= T * alpha * c)
 *   dst.a   += (1 - dst.a) * alpha            (T becomes T * (1 - alpha))
 *
 * The browser then puts the canvas over the page background, adding
 * T_final * background. Anything drawn later with this blending lands BEHIND
 * everything drawn before it.
 */
export const UNDER_BLENDING = {
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneMinusDstAlphaFactor,
  blendDst: THREE.OneFactor,
  blendSrcAlpha: THREE.OneMinusDstAlphaFactor,
  blendDstAlpha: THREE.OneFactor,
} as const;

/** How many probe contributions the panel lists. */
const PROBE_ROWS = 8;
/** The panel is updated at most this often (ms); the scene itself updates every frame. */
const REPORT_INTERVAL_MS = 100;

export type ProbeRow = Contribution & { name: string; color: readonly [number, number, number] };

export type CompositingReport = {
  /** Animation time (s). */
  time: number;
  total: number;
  /** Gaussians in front of the camera (drawn). */
  drawn: number;
  /** Smoothed CPU time per frame for animate + project + sort + upload (ms). */
  cpuMs: number;
  /** Compositing at the probe pixel (screen centre), in drawing order. */
  probe: { rows: ProbeRow[]; covering: number; transmittance: number; color: [number, number, number] };
  /** Gaussian 0's animated values relative to its base values. */
  first: { name: string; scaleFactor: number; dy: number; opacity: number; rotationDeg: number };
  /** Names of the first Gaussians in drawing order. */
  drawOrder: string[];
};

type CompositedGaussiansProps = {
  scene: SceneGaussian[];
  controls: CompositingControlsState;
  /** Increases by one on every Reset click: animation time goes back to 0. */
  resetRequest: number;
  onReport: (report: CompositingReport) => void;
};

/**
 * All Gaussians as one instanced quad mesh (one draw call), plus an optional
 * second instanced pass for the footprint outlines. Every frame, on the CPU:
 * animate each Gaussian, build Sigma3D, project it to Sigma2D (Lab 6's math),
 * sort the centres by depth, and write the quads into the instance buffers in
 * drawing order.
 */
export function CompositedGaussians({ scene, controls, resetRequest, onReport }: CompositedGaussiansProps) {
  const n = scene.length;
  const time = useRef(0);
  const lastReportAt = useRef(-Infinity);
  const lastReportKey = useRef("");
  const cpuMs = useRef(0);

  useEffect(() => {
    time.current = 0;
  }, [resetRequest]);

  const { geometry, attributes } = useMemo(() => {
    const plane = new THREE.PlaneGeometry(2, 2);
    const g = new THREE.InstancedBufferGeometry();
    g.setIndex(plane.getIndex());
    g.setAttribute("position", plane.getAttribute("position"));
    const instanced = (name: string, itemSize: number) => {
      const attribute = new THREE.InstancedBufferAttribute(new Float32Array(n * itemSize), itemSize);
      attribute.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(name, attribute);
      return attribute;
    };
    const attributes = {
      center: instanced("aCenterClip", 4),
      axes: instanced("aAxesPx", 4),
      conic: instanced("aConic", 3),
      colorOpacity: instanced("aColorOpacity", 4),
    };
    g.instanceCount = 0;
    return { geometry: g, attributes };
  }, [n]);

  const [fillMaterial, outlineMaterial] = useMemo(() => {
    const viewport = { value: new THREE.Vector2() };
    const make = (outlinePass: boolean) =>
      new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: compositedGaussianVertexShader,
        fragmentShader: compositedGaussianFragmentShader,
        uniforms: {
          uViewportPx: viewport,
          uSupportSigmas: { value: SUPPORT_SIGMAS },
          uMaxAlpha: { value: MAX_ALPHA },
          uMinAlpha: { value: MIN_ALPHA },
          uOutlinePass: { value: outlinePass },
        },
        transparent: true,
        // Order comes from the sort, not from the depth buffer.
        depthTest: false,
        depthWrite: false,
        ...(outlinePass ? { premultipliedAlpha: true } : UNDER_BLENDING),
      });
    return [make(false), make(true)];
  }, []);

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(
    () => () => {
      fillMaterial.dispose();
      outlineMaterial.dispose();
    },
    [fillMaterial, outlineMaterial],
  );

  // Per-frame working memory, reused (no allocations in the frame loop).
  const work = useMemo(
    () => ({
      animated: newAnimatedGaussian(),
      sigma: newCovariance3(),
      splats: scene.map(() => newSplat()),
      opacities: new Float32Array(n),
      colors: Float32Array.from(scene.flatMap((g) => g.color)),
      order: new Uint32Array(n),
    }),
    [scene, n],
  );

  useFrame((state, delta) => {
    const start = performance.now();
    // Clamp delta so a backgrounded tab doesn't jump the animation forward.
    if (controls.playing) time.current += Math.min(delta, 0.1) * controls.speed;
    const t = time.current;
    const cam = frameCamera(state.camera as THREE.PerspectiveCamera, state.size);
    const { animated: a, sigma, splats, opacities, order } = work;

    // 1. Animate, build Sigma3D, project. Keep the ones in front of the camera.
    let drawn = 0;
    let first: CompositingReport["first"] | null = null;
    for (let i = 0; i < n; i++) {
      const g = scene[i];
      animateGaussian(g, controls.preset, t, controls.globalScale, controls.globalOpacity, a);
      covarianceFromScaleRotation(a.sx, a.sy, a.sz, a.qx, a.qy, a.qz, a.qw, sigma);
      opacities[i] = a.opacity;
      if (projectSplat(a.px, a.py, a.pz, sigma, cam, splats[i])) order[drawn++] = i;
      if (i === 0) {
        const [bx, by, bz, bw] = g.rotation;
        const dot = Math.min(1, Math.abs(bx * a.qx + by * a.qy + bz * a.qz + bw * a.qw));
        first = {
          name: g.name,
          scaleFactor: a.sx / g.scale[0],
          dy: a.py - g.position[1],
          opacity: a.opacity,
          rotationDeg: THREE.MathUtils.radToDeg(2 * Math.acos(dot)),
        };
      }
    }

    // 2. Sort by the depth of each Gaussian's CENTRE. Nearest first is the
    //    correct front-to-back order; "reversed" deliberately draws farthest first.
    const visible = order.subarray(0, drawn);
    const sign = controls.ordering === "correct" ? 1 : -1;
    visible.sort((i, j) => sign * (splats[i].depth - splats[j].depth));

    // 3. Write the quads into the instance buffers in drawing order.
    const { center, axes, conic, colorOpacity } = attributes;
    for (let k = 0; k < drawn; k++) {
      const i = visible[k];
      const s = splats[i];
      center.array.set(s.clip, k * 4);
      axes.array.set(s.axesPx, k * 4);
      conic.array.set(s.conic, k * 3);
      colorOpacity.array[k * 4] = work.colors[i * 3];
      colorOpacity.array[k * 4 + 1] = work.colors[i * 3 + 1];
      colorOpacity.array[k * 4 + 2] = work.colors[i * 3 + 2];
      colorOpacity.array[k * 4 + 3] = opacities[i];
    }
    center.needsUpdate = axes.needsUpdate = conic.needsUpdate = colorOpacity.needsUpdate = true;
    geometry.instanceCount = drawn;
    fillMaterial.uniforms.uViewportPx.value.set(state.size.width, state.size.height);
    cpuMs.current = 0.9 * cpuMs.current + 0.1 * (performance.now() - start);

    // 4. Tell the panel what is happening at the probe pixel (throttled).
    const now = performance.now();
    if (now - lastReportAt.current < REPORT_INTERVAL_MS) return;
    lastReportAt.current = now;
    const probe = compositePixel(visible, drawn, splats, opacities, work.colors, BACKGROUND_RGB, 0, 0);
    const report: CompositingReport = {
      time: t,
      total: n,
      drawn,
      cpuMs: cpuMs.current,
      probe: {
        rows: probe.contributions.slice(0, PROBE_ROWS).map((c) => ({
          ...c,
          name: scene[c.index].name,
          color: scene[c.index].color,
        })),
        covering: probe.contributions.length,
        transmittance: probe.transmittance,
        color: probe.color,
      },
      first: first!,
      drawOrder: Array.from(visible.subarray(0, 5), (i) => scene[i].name),
    };
    const key = JSON.stringify([report.probe, report.first, report.drawOrder, report.drawn, t.toFixed(1)], (_, v) =>
      typeof v === "number" ? Number(v.toFixed(3)) : v,
    );
    if (key !== lastReportKey.current) {
      lastReportKey.current = key;
      onReport(report);
    }
  });

  return (
    <>
      <mesh geometry={geometry} material={fillMaterial} frustumCulled={false} renderOrder={1} />
      <mesh
        geometry={geometry}
        material={outlineMaterial}
        frustumCulled={false}
        renderOrder={3}
        visible={controls.showOutlines}
      />
    </>
  );
}

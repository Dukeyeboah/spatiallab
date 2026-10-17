"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import {
  absoluteDataUrl,
  defaultLccModelMatrixElements,
  importLccSdk,
  releaseLccSdk,
  type LccObject,
  type LCCRenderType,
} from "@/lib/labs/lccSdk";
import { applyInteriorView, resolveInteriorView } from "@/lib/labs/lccInteriorView";
import type { OrbitControls as OrbitControlsImpl } from "three/examples/jsm/controls/OrbitControls.js";

type Props = {
  dataPath: string;
  appKey: string;
  onProgress: (p: number) => void;
  onStatus: (s: string) => void;
};

/**
 * Experimental R3F bridge (parked — not shown in the lab UI for now).
 * Plain Three.js is the supported tour host: faster first paint, Orbit + first-person nav.
 * Keep this file for a later revisit; do not wire it back without re-testing host switching.
 */
function LccBridge({ dataPath, appKey, onProgress, onStatus }: Props) {
  const { scene, camera, gl, controls } = useThree();
  const sdkRef = useRef<LCCRenderType | null>(null);
  const onProgressRef = useRef(onProgress);
  const onStatusRef = useRef(onStatus);
  onProgressRef.current = onProgress;
  onStatusRef.current = onStatus;

  useEffect(() => {
    let cancelled = false;
    let lcc: LccObject | null = null;
    let LCCRender: LCCRenderType | null = null;

    (async () => {
      try {
        onStatusRef.current("loading SDK…");
        const sdk = await importLccSdk();
        if (cancelled) return;
        LCCRender = sdk.LCCRender;
        sdkRef.current = LCCRender;
        try {
          LCCRender.setWriteDepth?.(true);
        } catch {
          /* optional */
        }
        LCCRender.setCamera(camera);
        onStatusRef.current(`SDK ${LCCRender.getVersion()} · loading model…`);

        const modelMatrix = new THREE.Matrix4().fromArray(defaultLccModelMatrixElements());
        const path = absoluteDataUrl(dataPath);

        lcc = LCCRender.load(
          {
            camera,
            scene,
            renderLib: THREE,
            renderer: gl,
            canvas: gl.domElement,
            dataPath: path,
            useEnv: true,
            useIndexDB: true,
            useLoadingEffect: false,
            modelMatrix,
            appKey: appKey.trim() ? appKey.trim() : null,
            usePage: path.toLowerCase().endsWith(".lcc2"),
            usePrecisionRaycast: true,
          },
          () => {
            if (cancelled || !lcc) return;
            try {
              lcc.setLodAutoLevelUp?.(true);
              lcc.setMaxDistance?.(80);
              lcc.setMaxSplats?.(2_500_000);
              lcc.setMaxNodeSplats?.(1_200_000);
              const meta = lcc.getMeta();
              const b = lcc.getBounds();
              onStatusRef.current(
                `ready · ${String(meta?.name ?? meta?.dataType ?? "model")} · bounds ${
                  b ? "ok" : "null"
                } · collision ${lcc.hasCollision?.() ? "yes" : "no"}`,
              );
              // Wait a frame so OrbitControls (makeDefault) is registered on useThree().
              requestAnimationFrame(() => {
                if (cancelled) return;
                void resolveInteriorView(path).then((view) => {
                  if (cancelled) return;
                  const orbit = controls as OrbitControlsImpl | null;
                  if (orbit?.target) {
                    applyInteriorView(camera as THREE.PerspectiveCamera, orbit, () => undefined, view);
                  } else {
                    camera.position.copy(view.eye);
                    camera.lookAt(view.target);
                  }
                  onStatusRef.current(
                    `ready · framed (${view.source}) · ${String(meta?.name ?? meta?.dataType ?? "model")}`,
                  );
                });
              });
            } catch (err) {
              onStatusRef.current(`ready (meta error: ${(err as Error).message})`);
            }
          },
          (p) => onProgressRef.current(p),
          () => onStatusRef.current("R3F bridge: LCC load failure callback"),
        );
      } catch (err) {
        if (cancelled) return;
        const msg = (err as Error).message;
        onStatusRef.current(msg === "LCC_SDK_RELEASED" ? "Reloading SDK…" : `R3F bridge error: ${msg}`);
      }
    })();

    return () => {
      cancelled = true;
      if (LCCRender && lcc) {
        try {
          LCCRender.unload(lcc);
        } catch {
          /* ignore */
        }
      }
      releaseLccSdk();
      sdkRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataPath, appKey]);

  useFrame(() => {
    const sdk = sdkRef.current;
    if (!sdk) return;
    sdk.setCamera(camera);
    sdk.update();
  });

  // Small coexistence marker near the feet — not a substitute for the LCC room.
  return (
    <mesh position={[0.4, 0.15, 0.4]}>
      <boxGeometry args={[0.2, 0.2, 0.2]} />
      <meshNormalMaterial />
    </mesh>
  );
}

export function LccR3FHost(props: Props) {
  const [note, setNote] = useState("R3F mode: loading…");
  return (
    <div className="lcc-host lcc-host-r3f">
      <Canvas
        // Match Spatial Lab colour pipeline; LCC expects a normal WebGL render path.
        linear
        flat
        camera={{ position: [0, 1.55, 0.5], fov: 45, near: 0.05, far: 150000 }}
        gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
      >
        <color attach="background" args={["#111111"]} />
        <OrbitControls makeDefault target={[0, 1.4, -2.5]} />
        <LccBridge
          dataPath={props.dataPath}
          appKey={props.appKey}
          onProgress={props.onProgress}
          onStatus={(s) => {
            props.onStatus(s);
            setNote(s);
          }}
        />
      </Canvas>
      <div className="lcc-r3f-note">{note}</div>
    </div>
  );
}

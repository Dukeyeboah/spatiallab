"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { PROD02B_AVATARS } from "@/lib/labs/prod02b/avatarAssets";

type Candidate = "walker" | "r01";
type AssetStats = {
  triangles: number;
  bytes: number;
  bones: number;
  drawCalls: number;
};
/** A/B preview uses the exact runtime assets; only one is active in the LCC lab. */
export function AvatarStudio() {
  const mount = useRef<HTMLDivElement>(null);
  const play = useRef<(moving: boolean) => void>(() => {});
  const [moving, setMoving] = useState(false);
  const [ready, setReady] = useState(false);
  const [fps, setFps] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Partial<Record<Candidate, AssetStats>>>(
    {},
  );
  useEffect(() => {
    const el = mount.current!;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#e8e2d8");
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    el.appendChild(renderer.domElement);
    const room = new RoomEnvironment(),
      pmrem = new THREE.PMREMGenerator(renderer);
    const environment = pmrem.fromScene(room, 0.04);
    scene.environment = environment.texture;
    room.dispose();
    pmrem.dispose();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 30);
    camera.position.set(0, 1.05, 4.2);
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.target.set(0, 0.85, 0);
    orbit.enableDamping = true;
    orbit.minDistance = 1.6;
    orbit.maxDistance = 7;
    const grid = new THREE.GridHelper(10, 50, 0xc6bba9, 0xdcd2c4);
    grid.position.y = -0.006;
    scene.add(grid);
    const mixers: THREE.AnimationMixer[] = [],
      maps: Record<string, THREE.AnimationAction>[] = [];
    let cancelled = false,
      raf = 0;
    play.current = (move) => {
      for (const actions of maps) {
        const next = move ? actions.Walk : actions.Idle,
          previous = move ? actions.Idle : actions.Walk;
        next.reset().stopFading().setEffectiveWeight(1).fadeIn(0.18).play();
        previous.fadeOut(0.18);
      }
    };
    void Promise.all(
      (["walker", "r01"] as Candidate[]).map(async (id, index) => {
        const config = PROD02B_AVATARS[id];
        const [gltf, meta] = await Promise.all([
          new GLTFLoader().loadAsync(config.url),
          fetch(config.url.replace(".glb", ".meta.json")).then(
            (r) => r.json() as Promise<AssetStats>,
          ),
        ]);
        if (cancelled) {
          disposeObject(gltf.scene);
          return;
        }
        const model = gltf.scene;
        model.position.x = index === 0 ? -0.58 : 0.58;
        model.position.y = config.hoverHeight;
        model.rotation.y = index === 0 ? -0.12 : 0.12;
        model.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          for (const m of Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material]) {
            (m as THREE.MeshStandardMaterial).envMapIntensity = 1.1;
            if (m.transparent) m.depthWrite = false;
          }
        });
        scene.add(model);
        const mixer = new THREE.AnimationMixer(model),
          actions: Record<string, THREE.AnimationAction> = {};
        for (const clip of gltf.animations)
          actions[clip.name] = mixer.clipAction(clip);
        if (!actions.Idle || !actions.Walk)
          throw new Error(`${config.label}: missing Idle or movement action`);
        mixers.push(mixer);
        maps.push(actions);
        actions.Idle.play();
        setStats((s) => ({ ...s, [id]: meta }));
      }),
    )
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    const resize = () => {
      renderer.setSize(el.clientWidth, el.clientHeight);
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    let prior = performance.now(),
      reported = prior,
      frames = 0;
    const tick = () => {
      if (cancelled || document.hidden) return;
      const now = performance.now(),
        dt = Math.min(0.05, (now - prior) / 1000);
      prior = now;
      frames++;
      if (now - reported >= 500) {
        setFps(Math.round((frames * 1000) / (now - reported)));
        frames = 0;
        reported = now;
      }
      mixers.forEach((m) => m.update(dt));
      orbit.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    const visibility = () => {
      cancelAnimationFrame(raf);
      prior = performance.now();
      reported = prior;
      frames = 0;
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", visibility);
    tick();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", visibility);
      observer.disconnect();
      orbit.dispose();
      mixers.forEach((m) => m.stopAllAction());
      disposeObject(scene);
      environment.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, []);
  const button = {
    border: "1px solid #c9bea9",
    borderRadius: 999,
    padding: "10px 22px",
    cursor: "pointer",
  };
  return (
    <main
      style={{
        height: "100dvh",
        background: "#e8e2d8",
        color: "#1b1916",
        display: "flex",
        flexDirection: "column",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <header style={{ padding: "20px 24px 8px" }}>
        <div style={{ fontSize: 11, color: "#7a5a34", letterSpacing: ".18em" }}>
          SPATIAL HOUSE · AVATAR TEST
        </div>
        <h1 style={{ fontSize: 25, fontWeight: 500, margin: "8px 0" }}>
          Two robots. One space.
        </h1>
        <Link href="/labs/prod-02b" style={{ color: "#5c4326", fontSize: 14 }}>
          Compare inside the walkthrough ↗
        </Link>
        {error ? <p role="alert">{error}</p> : null}
      </header>
      <div
        ref={mount}
        aria-label="Walking robot on the left and R01 hover robot on the right"
        style={{ flex: 1, minHeight: 280, overflow: "hidden" }}
      />
      <footer style={{ padding: "10px 24px 20px", textAlign: "center" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 14,
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          {(["walker", "r01"] as Candidate[]).map((id) => (
            <div key={id}>
              <strong>{PROD02B_AVATARS[id].label}</strong>
              <div style={{ color: "#6e675f", marginTop: 5 }}>
                {stats[id]
                  ? `${stats[id]!.triangles.toLocaleString()} triangles · ${Math.round(stats[id]!.bytes / 1024)} KB`
                  : "Loading…"}
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
          <button
            disabled={!ready}
            style={{
              ...button,
              background: moving ? "#f4f1eb" : "#1b1916",
              color: moving ? "#1b1916" : "#f4f1eb",
            }}
            onClick={() => {
              setMoving(false);
              play.current(false);
            }}
          >
            Stand / idle
          </button>
          <button
            disabled={!ready}
            style={{
              ...button,
              background: moving ? "#1b1916" : "#f4f1eb",
              color: moving ? "#f4f1eb" : "#1b1916",
            }}
            onClick={() => {
              setMoving(true);
              play.current(true);
            }}
          >
            Walk / hover
          </button>
        </div>
        <p style={{ fontSize: 12, color: "#6e675f", marginBottom: 0 }}>
          Drag to rotate · scroll to inspect · {moving ? "Movement" : "Idle"} ·{" "}
          {fps} fps
        </p>
      </footer>
    </main>
  );
}
function disposeObject(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>(),
    textures = new Set<THREE.Texture>(),
    skeletons = new Set<THREE.Skeleton>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.geometry) return;
    geometries.add(mesh.geometry);
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh)
      skeletons.add((mesh as THREE.SkinnedMesh).skeleton);
    for (const m of Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material]) {
      materials.add(m);
      for (const [key, value] of Object.entries(m))
        if (key !== "envMap" && value instanceof THREE.Texture)
          textures.add(value);
    }
  });
  skeletons.forEach((s) => s.dispose());
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
  textures.forEach((t) => {
    t.dispose();
    (t.source.data as ImageBitmap | null)?.close?.();
  });
}

"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import {
  OrbAssistantMotion,
  createOrbFloorGlow,
} from "@/lib/labs/prod02b/orbAssistant";
import { PROD02B_AVATARS } from "@/lib/labs/prod02b/avatarAssets";

type View = "Front" | "Side" | "Three-quarter";
export function OrbAssistantStudio() {
  const mount = useRef<HTMLDivElement>(null),
    setView = useRef<(view: View) => void>(() => {}),
    moving = useRef(false);
  const [mode, setMode] = useState(false),
    [error, setError] = useState<string | null>(null),
    [ready, setReady] = useState(false);
  const [stats, setStats] = useState<{
    triangles: number;
    bytes: number;
    meshObjects: number;
  } | null>(null);
  useEffect(() => {
    const el = mount.current!,
      scene = new THREE.Scene();
    scene.background = new THREE.Color("#e8e2d8");
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    el.append(renderer.domElement);
    const room = new RoomEnvironment(),
      pmrem = new THREE.PMREMGenerator(renderer),
      environment = pmrem.fromScene(room, 0.04);
    room.dispose();
    pmrem.dispose();
    scene.environment = environment.texture;
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 10),
      controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.25, 0);
    controls.enableDamping = true;
    controls.minDistance = 0.4;
    controls.maxDistance = 2;
    setView.current = (view) => {
      camera.position.set(
        ...((view === "Front"
          ? [0, 0.28, 0.8]
          : view === "Side"
            ? [0.8, 0.28, 0]
            : [0.52, 0.42, 0.72]) as [number, number, number]),
      );
      controls.target.set(0, 0.25, 0);
      controls.update();
    };
    setView.current("Three-quarter");
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 10),
      new THREE.MeshStandardMaterial({ color: "#d3cbbd", roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    const glow = createOrbFloorGlow();
    glow.position.y = 0.006;
    scene.add(glow);
    let model: THREE.Group | null = null,
      motion: OrbAssistantMotion | null = null,
      cancelled = false,
      raf = 0;
    void new GLTFLoader()
      .loadAsync(PROD02B_AVATARS.orb.url)
      .then((gltf) => {
        if (cancelled) {
          dispose(gltf.scene);
          return;
        }
        model = gltf.scene;
        scene.add(model);
        motion = new OrbAssistantMotion(model);
        setReady(true);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    void fetch(PROD02B_AVATARS.orb.url.replace(".glb", ".meta.json"))
      .then((r) => r.json())
      .then((s) => {
        if (!cancelled) setStats(s);
      });
    const resize = () => {
      const w = el.clientWidth,
        h = el.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    let previous = performance.now();
    const tick = () => {
      if (cancelled || document.hidden) return;
      const now = performance.now(),
        dt = Math.min(0.05, (now - previous) / 1000);
      previous = now;
      motion?.update(dt, moving.current ? 1.25 : 0, 0);
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    const visibility = () => {
      cancelAnimationFrame(raf);
      previous = performance.now();
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", visibility);
    tick();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", visibility);
      observer.disconnect();
      controls.dispose();
      dispose(scene);
      environment.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, []);
  const button = {
    border: "1px solid #c9bea9",
    borderRadius: 999,
    padding: "9px 18px",
    background: "#f4f1eb",
    color: "#1b1916",
    cursor: "pointer",
  };
  return (
    <main
      style={{
        height: "100dvh",
        display: "flex",
        flexDirection: "column",
        background: "#e8e2d8",
        color: "#1b1916",
        fontFamily: "Arial,sans-serif",
      }}
    >
      <header style={{ padding: "20px 24px 8px" }}>
        <div style={{ fontSize: 11, color: "#7a5a34", letterSpacing: ".18em" }}>
          SPATIAL LABS · ORB ASSISTANT V1.1
        </div>
        <h1 style={{ fontSize: 25, fontWeight: 500, margin: "8px 0" }}>
          Your floating space assistant.
        </h1>
        <Link href="/labs/prod-02b" style={{ color: "#5c4326", fontSize: 14 }}>
          Test inside the walkthrough ↗
        </Link>
        {error && <p role="alert">{error}</p>}
      </header>
      <div
        ref={mount}
        aria-label="Orb Assistant V1.1 model preview"
        style={{ flex: 1, minHeight: 280, overflow: "hidden" }}
      />
      <footer style={{ padding: "12px 24px 20px", textAlign: "center" }}>
        <p style={{ fontSize: 13, margin: "0 0 12px" }}>
          {stats
            ? `${stats.triangles.toLocaleString()} triangles · ${Math.round(stats.bytes / 1024)} KB · 4 materials · no textures or bones`
            : "Loading Orb Assistant…"}{" "}
          · 24 cm body
        </p>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          {(["Front", "Side", "Three-quarter"] as View[]).map((view) => (
            <button
              key={view}
              style={button}
              onClick={() => setView.current(view)}
            >
              {view}
            </button>
          ))}
          <button
            style={{
              ...button,
              background: mode ? "#1b1916" : "#f4f1eb",
              color: mode ? "#f4f1eb" : "#1b1916",
            }}
            disabled={!ready}
            onClick={() => {
              moving.current = !moving.current;
              setMode(moving.current);
            }}
          >
            {mode ? "Moving hover" : "Idle hover"}
          </button>
        </div>
        <p style={{ fontSize: 12, color: "#6e675f", marginBottom: 0 }}>
          Drag to orbit · scroll to inspect · floor glow stays on the ground
        </p>
      </footer>
    </main>
  );
}
function dispose(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      geometries.add(mesh.geometry);
      for (const m of Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material])
        materials.add(m);
    }
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
}

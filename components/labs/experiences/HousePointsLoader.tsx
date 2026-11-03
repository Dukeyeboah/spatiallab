"use client";

import { useEffect, useRef } from "react";

type Props = {
  progress: number;
  label?: string;
};

/**
 * Procedural point-house loading overlay (no external mesh required).
 * Soft WebGL points with a wavy pulse — independent of the LCC canvas.
 */
export function HousePointsLoader({ progress, label }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { alpha: true, antialias: true, premultipliedAlpha: false });
    if (!gl) return;

    const vs = `
      attribute vec3 aPos;
      attribute float aPhase;
      uniform float uTime;
      uniform float uAspect;
      uniform float uProgress;
      void main() {
        float wave = sin(uTime * 2.4 + aPhase + aPos.y * 4.0 + aPos.x * 2.2);
        float breathe = 1.0 + 0.08 * wave + 0.04 * sin(uTime * 1.1);
        vec3 p = aPos * breathe;
        // Spin the house slowly around Y
        float ang = uTime * 0.55;
        float cs = cos(ang);
        float sn = sin(ang);
        float rx = p.x * cs - p.z * sn;
        float rz = p.x * sn + p.z * cs;
        p.x = rx;
        p.z = rz;
        // Gentle tilt so the roof reads in 3D
        float tilt = 0.22;
        float ty = p.y * cos(tilt) - p.z * sin(tilt);
        float tz = p.y * sin(tilt) + p.z * cos(tilt);
        p.y = ty;
        p.z = tz;
        // Reveal denser points as load progresses; grow with settle
        float reveal = smoothstep(aPhase * 0.12, aPhase * 0.12 + 0.5, uProgress + 0.2);
        float grow = mix(0.72, 1.08, smoothstep(0.0, 1.0, uProgress));
        p *= grow;
        p.y *= mix(0.28, 1.0, reveal);
        vec2 xy = p.xz * 0.58;
        xy.x /= uAspect;
        gl_Position = vec4(xy.x, p.y * 0.58 - 0.02, 0.0, 1.0);
        gl_PointSize = mix(1.6, 5.2, 0.5 + 0.5 * wave) * mix(0.35, 1.05, reveal);
      }
    `;
    const fs = `
      precision mediump float;
      uniform vec3 uColor;
      uniform float uTime;
      void main() {
        vec2 c = gl_PointCoord - vec2(0.5);
        float d = length(c);
        float a = smoothstep(0.5, 0.1, d);
        if (a < 0.02) discard;
        float pulse = 0.85 + 0.15 * sin(uTime * 2.0);
        gl_FragColor = vec4(uColor * pulse, a * 0.94);
      }
    `;

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const positions: number[] = [];
    const phases: number[] = [];
    const push = (x: number, y: number, z: number, phase: number) => {
      positions.push(x, y, z);
      phases.push(phase);
    };

    // Unit house: walls + pitched roof + floor ring (procedural — no asset needed)
    const addBox = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, dens: number, phase0: number) => {
      for (let i = 0; i < dens; i++) {
        const face = i % 6;
        const u = Math.random();
        const v = Math.random();
        let x = 0;
        let y = 0;
        let z = 0;
        if (face === 0) {
          x = -0.5;
          y = u - 0.5;
          z = v - 0.5;
        } else if (face === 1) {
          x = 0.5;
          y = u - 0.5;
          z = v - 0.5;
        } else if (face === 2) {
          x = u - 0.5;
          y = -0.5;
          z = v - 0.5;
        } else if (face === 3) {
          x = u - 0.5;
          y = 0.5;
          z = v - 0.5;
        } else if (face === 4) {
          x = u - 0.5;
          y = v - 0.5;
          z = -0.5;
        } else {
          x = u - 0.5;
          y = v - 0.5;
          z = 0.5;
        }
        push(cx + x * sx, cy + y * sy, cz + z * sz, phase0 + Math.random() * Math.PI * 2);
      }
    };

    addBox(0, 0.05, 0, 1.1, 0.7, 0.9, 520, 0);
    // Roof ridge
    for (let i = 0; i < 280; i++) {
      const t = Math.random();
      const s = Math.random();
      const x = (t - 0.5) * 1.2;
      const z = (s - 0.5) * 0.95;
      const y = 0.4 + (0.5 - Math.abs(x) / 1.2) * 0.45;
      push(x, y, z, 1.5 + Math.random() * 4);
    }
    // Door frame accent
    for (let i = 0; i < 60; i++) {
      const y = Math.random() * 0.35 - 0.15;
      const x = (Math.random() - 0.5) * 0.22;
      push(x, y, 0.46, 3 + Math.random());
    }

    const posBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);

    const phBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, phBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(phases), gl.STATIC_DRAW);
    const aPhase = gl.getAttribLocation(prog, "aPhase");
    gl.enableVertexAttribArray(aPhase);
    gl.vertexAttribPointer(aPhase, 1, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(prog, "uTime");
    const uAspect = gl.getUniformLocation(prog, "uAspect");
    const uProgress = gl.getUniformLocation(prog, "uProgress");
    const uColor = gl.getUniformLocation(prog, "uColor");

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    let raf = 0;
    let alive = true;
    const count = positions.length / 3;
    const progressRef = { current: progress };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth || 320;
      const h = canvas.clientHeight || 220;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const tick = (t: number) => {
      if (!alive) return;
      raf = requestAnimationFrame(tick);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(prog);
      gl.uniform1f(uTime, t * 0.001);
      gl.uniform1f(uAspect, (canvas.width || 1) / Math.max(1, canvas.height || 1));
      gl.uniform1f(uProgress, Math.min(1, Math.max(0, progressRef.current)));
      gl.uniform3f(uColor, 0.82, 0.72, 0.52);
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, phBuf);
      gl.vertexAttribPointer(aPhase, 1, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.POINTS, 0, count);
    };
    raf = requestAnimationFrame(tick);

    const sync = () => {
      progressRef.current = progress;
    };
    sync();
    (canvas as HTMLCanvasElement & { __setProgress?: (p: number) => void }).__setProgress = (p) => {
      progressRef.current = p;
    };

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      gl.deleteBuffer(posBuf);
      gl.deleteBuffer(phBuf);
      gl.deleteProgram(prog);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current as (HTMLCanvasElement & { __setProgress?: (p: number) => void }) | null;
    canvas?.__setProgress?.(progress);
  }, [progress]);

  return (
    <div className="exp-house-loader" aria-live="polite">
      <canvas ref={canvasRef} className="exp-house-loader-canvas" />
      <div className="exp-house-loader-meta">
        <div className="exp-loading-bar">
          <i style={{ width: `${Math.min(100, Math.round(progress * 1000) / 10)}%` }} />
        </div>
        <span>{label ?? "Loading"} · {Math.round(progress * 100)}%</span>
      </div>
    </div>
  );
}

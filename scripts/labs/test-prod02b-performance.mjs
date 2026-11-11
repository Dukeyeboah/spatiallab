import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "robot-perf-"));
try {
  const source = await fs.readFile(
    new URL("../../lib/labs/prod02b/performance.ts", import.meta.url),
    "utf8",
  );
  await fs.writeFile(
    path.join(temp, "performance.mjs"),
    ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
      },
    }).outputText,
  );
  const {
    AdaptiveRenderBudget,
    FrameWindow,
    ROBOT_QUALITY,
    renderBudget,
    robotCacheBudget,
  } = await import(pathToFileURL(path.join(temp, "performance.mjs")));
  const lowCache = robotCacheBudget(4, 4),
    normalCache = robotCacheBudget(8, 8);
  assert.equal(lowCache.maxGpuCacheSize, 64 * 1048576);
  assert.equal(normalCache.maxHostCacheSize, 192 * 1048576);
  assert.ok(
    normalCache.maxGpuCacheSize < 256 * 1048576,
    "vendor GPU cache cannot silently grow to gigabytes",
  );
  const adaptive = new AdaptiveRenderBudget();
  for (let i = 0; i < 20; i++) adaptive.update(15, 75);
  assert.equal(
    adaptive.level,
    4,
    "slow machines have a bounded minimum budget",
  );
  adaptive.update(60, 17);
  adaptive.update(60, 17);
  assert.equal(adaptive.level, 4, "no rapid oscillation");
  adaptive.update(60, 17);
  assert.equal(adaptive.level, 3, "recovery requires three healthy windows");
  adaptive.update(45, 30);
  assert.equal(adaptive.level, 3, "middle range keeps budget");
  adaptive.reset();
  assert.equal(adaptive.level, 0);
  for (let i = 0; i < 10; i++) adaptive.update(30, 35);
  assert.equal(adaptive.level, 0, "stable 30 Hz displays retain detail");
  const win = new FrameWindow();
  for (let i = 0; i < 100000; i++) win.add(16.7);
  assert.equal(
    win.summary().samples,
    180,
    "session length cannot grow frame history",
  );
  win.add(100);
  assert.ok(win.summary().p95 < 17, "one outlier does not poison p95");
  for (let i = 0; i < 12; i++) win.add(100);
  assert.equal(win.summary().p95, 100);
  win.reset();
  assert.equal(win.summary().samples, 0);
  for (const q of Object.values(ROBOT_QUALITY))
    for (const [w, h, dpr] of [
      [390, 844, 3],
      [1920, 1080, 2],
      [3840, 2160, 2],
    ]) {
      const budget = renderBudget(q, 0, w, h, dpr),
        low = renderBudget(q, 4, w, h, dpr);
      const maxPixels =
        q.id === "performance"
          ? 1280 * 720
          : q.id === "balanced"
            ? 1600 * 900
            : 1920 * 1080;
      assert.ok(
        w * h * budget.dpr ** 2 <= maxPixels + 1,
        "DPI cannot exceed profile pixel budget",
      );
      assert.ok(
        low.splats < budget.splats * 0.4 && low.dpr < budget.dpr,
        "auto reduces splats and fill cost",
      );
      assert.ok(budget.dpr <= dpr);
    }
  console.log(
    "PASS adaptive bounds/hysteresis, bounded session history, mobile/laptop/4K pixel budgets and load shedding",
  );
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}

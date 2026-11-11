import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "robot-report-"));
try {
  for (const [source, name] of [
    ["lib/labs/prod02b/performanceSession.ts", "session"],
    ["app/labs/prod-02b/report/route.ts", "route"],
  ]) {
    const input = await fs.readFile(source, "utf8");
    await fs.writeFile(
      path.join(temp, name + ".mjs"),
      ts.transpileModule(input, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ES2022,
        },
      }).outputText,
    );
  }
  const { PerformanceSession } = await import(
    pathToFileURL(path.join(temp, "session.mjs"))
  );
  const { POST } = await import(pathToFileURL(path.join(temp, "route.mjs")));
  const session = new PerformanceSession(0, new Date("2026-11-09T12:00:00Z"));
  const tags = {
    robot: "walker",
    scale: 0.5,
    floor: "ground",
    quality: "performance",
    autoPerformance: true,
  };
  for (let time = 0; time < 2 * 3600 * 1000; time += 500) {
    const minute = Math.floor(time / 60000);
    session.record(
      {
        fps: 60,
        phase: "ready",
        perf: {
          heapMB: 80 + minute * 0.1 + (time % 5000) / 1000,
          elapsedSeconds: time / 1000,
        },
      },
      tags,
      time,
    );
  }
  const report = session.report({ test: true }, 2 * 3600 * 1000);
  assert.equal(report.samples.length, 720);
  assert.equal(report.heapByMinute.length, 120);
  assert.equal(report.durationSeconds, 7200);
  assert.ok(report.retention.totalSamples > report.samples.length);
  assert.ok(
    Math.abs(report.summary.heapMinuteLowSlopeMBPerMinute - 0.1) < 1e-6,
    "minute low regression survives GC-like sawtooth",
  );
  const form = new FormData();
  form.set("report", JSON.stringify(report));
  const response = await POST(
    new Request("http://localhost/labs/prod-02b/report", {
      method: "POST",
      body: form,
    }),
  );
  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-disposition"),
    /attachment; filename="spatial-robot-performance.json"/,
  );
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(
    await response.json(),
    report,
    "download contains the original session",
  );
  const bad = new FormData();
  bad.set("report", "{bad");
  assert.equal(
    (
      await POST(
        new Request("http://localhost/labs/prod-02b/report", {
          method: "POST",
          body: bad,
        }),
      )
    ).status,
    400,
  );
  console.log(
    "PASS two-hour bounded session, minute memory trend, attachment contents/headers and malformed-report rejection",
  );
} finally {
  await fs.rm(temp, { recursive: true, force: true });
}

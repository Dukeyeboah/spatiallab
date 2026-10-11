"use client";

import Link from "next/link";
import { useState } from "react";
import { formatBytes } from "@/lib/splats";
import {
  packageDownloadUrl,
  WARNING_LABELS,
  type Environment,
  type ProjectSummary,
  type TrainingPackage,
  type TrainingProject,
  type WarningKind,
} from "@/lib/training";

type TrainingPanelProps = {
  projects: ProjectSummary[];
  project: TrainingProject | null;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
  onDelete: () => void;
  onFiles: (files: File[]) => void;
  progress: number | null;
  lastUpload: { accepted: number; refused: number } | null;
  skipped: { filename: string; reason: string }[];
  onClearRefused: () => void;
  onlyWarnings: boolean;
  onOnlyWarnings: (value: boolean) => void;
  environment: Environment | null;
  onStartPoses: () => void;
  onCancelPoses: () => void;
  view: "photos" | "poses";
  onView: (view: "photos" | "poses") => void;
  onlyUnplaced: boolean;
  onOnlyUnplaced: (value: boolean) => void;
  trainingPackage: TrainingPackage | null;
  onBuildPackage: () => void;
  busy: boolean;
  error: string | null;
};

export function TrainingPanel(props: TrainingPanelProps) {
  const { projects, project, busy, progress } = props;
  const [newName, setNewName] = useState("");
  // Photos can't change while COLMAP reads them (the backend refuses it too).
  const estimating = project?.poses?.status === "queued" || project?.poses?.status === "running";
  const uploading = progress !== null || estimating;

  return (
    <div className="controls inspector">
      <div className="title-row">
        <h1>Gaussian Training: Photos</h1>
      </div>
      <Link href="/" className="lab-link">
        ← LiDAR viewer
      </Link>
      <Link href="/gaussian-viewer" className="lab-link">
        ← Lab 8: Gaussian Splat Viewer
      </Link>
      <Link href="/gaussian-inspector" className="lab-link">
        ← Lab 9: Gaussian Inspector
      </Link>
      <div className="note">
        Lab 10A: collect photographs of a space and check them. Lab 10B: estimate where each photo was taken from with
        COLMAP. Lab 10C: package the result for training on a rented GPU. Nothing is trained on this Mac; the photos
        are stored by the local backend and never modified.
      </div>
      {props.error && <div className="error">{props.error}</div>}

      <div className="section">
        <b>Project</b>
        {projects.length > 0 && (
          <select
            aria-label="Project"
            value={project?.id ?? ""}
            onChange={(e) => props.onSelect(e.target.value)}
            disabled={busy || uploading}
          >
            {!project && <option value="">Choose a project…</option>}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.imageCount} photos)
              </option>
            ))}
          </select>
        )}
        <form
          className="inline-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (newName.trim()) props.onCreate(newName.trim());
            setNewName("");
          }}
        >
          <input
            type="text"
            aria-label="New project name"
            placeholder="New project name, e.g. Living room"
            value={newName}
            maxLength={80}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button type="submit" disabled={busy || uploading || !newName.trim()}>
            Create
          </button>
        </form>
      </div>

      {project && (
        <>
          <ProjectFacts project={project} onDelete={props.onDelete} disabled={busy || uploading} />

          <div className="section import-form">
            <b>Add photographs</b>
            <div className="note">
              JPG, PNG or HEIC (iPhone), up to 64 MB each. Walk around the space and take overlapping photos from many positions;
              keep the camera still while each photo is taken.
            </div>
            <div className="dataset-actions">
              <label className="picker">
                Choose photos…
                <input
                  type="file"
                  multiple
                  accept=".jpg,.jpeg,.png,.heic,.heif,image/jpeg,image/png,image/heic,image/heif"
                  disabled={busy || uploading}
                  onChange={(e) => {
                    props.onFiles(Array.from(e.target.files ?? []));
                    e.target.value = "";
                  }}
                />
              </label>
              <label className="picker">
                Choose folder…
                <input
                  type="file"
                  // Not in React's types: lets the user pick a whole folder (all files inside, recursively).
                  ref={(input) => input?.setAttribute("webkitdirectory", "")}
                  disabled={busy || uploading}
                  onChange={(e) => {
                    props.onFiles(Array.from(e.target.files ?? []));
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            {progress !== null && (
              <div className="dataset-info">
                Uploading and checking… {Math.round(progress * 100)}%
                <progress value={progress} max={1} />
              </div>
            )}
            {props.lastUpload && !uploading && (
              <div className="note">
                Last upload: {props.lastUpload.accepted} added
                {props.lastUpload.refused > 0 && `, ${props.lastUpload.refused} refused (listed below)`}.
              </div>
            )}
          </div>

          <Checks
            project={project}
            onlyWarnings={props.onlyWarnings}
            onOnlyWarnings={props.onOnlyWarnings}
          />
          <Refused project={project} skipped={props.skipped} onClear={props.onClearRefused} disabled={busy || uploading} />
          <Poses
            project={project}
            colmapInstalled={!!props.environment?.tools.colmap?.path}
            busy={busy || progress !== null}
            onStart={props.onStartPoses}
            onCancel={props.onCancelPoses}
            view={props.view}
            onView={props.onView}
            onlyUnplaced={props.onlyUnplaced}
            onOnlyUnplaced={props.onOnlyUnplaced}
          />
          {project.poses?.status === "done" && (
            <CloudPackage
              projectId={project.id}
              pkg={props.trainingPackage}
              busy={busy || uploading}
              onBuild={props.onBuildPackage}
            />
          )}
          <Stages project={project} />
        </>
      )}

      <EnvironmentReport environment={props.environment} />
    </div>
  );
}

function ProjectFacts({ project, onDelete, disabled }: { project: TrainingProject; onDelete: () => void; disabled: boolean }) {
  const a = project.analysis;
  return (
    <div className="section">
      <div className="title-row">
        <b>{project.name}</b>
        <button onClick={onDelete} disabled={disabled}>
          Delete project
        </button>
      </div>
      <div className="dataset-info">
        <span>
          {a.imageCount} photographs · {formatBytes(a.totalBytes)} in total
        </span>
        {a.sizes.length > 0 && (
          <span>Sizes: {a.sizes.map((s) => `${s.width}×${s.height} (${s.count})`).join(", ")}</span>
        )}
        {a.cameras.length > 0 && <span>Cameras: {a.cameras.map((c) => `${c.label} (${c.count})`).join(", ")}</span>}
        <span>
          Linked to a property/capture: not yet (reserved; photos are never assumed to belong to a LiDAR capture).
        </span>
      </div>
    </div>
  );
}

function Checks({
  project,
  onlyWarnings,
  onOnlyWarnings,
}: {
  project: TrainingProject;
  onlyWarnings: boolean;
  onOnlyWarnings: (value: boolean) => void;
}) {
  const a = project.analysis;
  const kinds = Object.keys(WARNING_LABELS) as WarningKind[];
  return (
    <div className="section">
      <b>Checks</b>
      {a.imageCount === 0 ? (
        <div className="note">Add photographs to check them.</div>
      ) : a.imagesWithWarnings === 0 ? (
        <div className="note ok">✓ No warnings for {a.imageCount} photos.</div>
      ) : (
        <>
          <div className="note">
            {a.imagesWithWarnings} of {a.imageCount} photos have warnings. Warnings never block a photo: review them
            and remove photos you don&apos;t want.
          </div>
          <table className="attr-table">
            <tbody>
              {kinds
                .filter((k) => a.warningCounts[k])
                .map((k) => (
                  <tr key={k}>
                    <th>{a.warningCounts[k]}</th>
                    <td>
                      <b>{WARNING_LABELS[k].label}</b>: {WARNING_LABELS[k].explain}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          <label>
            <input type="checkbox" checked={onlyWarnings} onChange={(e) => onOnlyWarnings(e.target.checked)} />
            Show only photos with warnings
          </label>
        </>
      )}
      <div className="note">
        These checks look at each photo on its own. They can&apos;t tell whether the photos overlap enough or cover
        the whole space: that only shows when camera poses are estimated (Lab 10B).
      </div>
    </div>
  );
}

function Refused({
  project,
  skipped,
  onClear,
  disabled,
}: {
  project: TrainingProject;
  skipped: { filename: string; reason: string }[];
  onClear: () => void;
  disabled: boolean;
}) {
  if (project.rejected.length === 0 && skipped.length === 0) return null;
  return (
    <div className="section">
      <div className="title-row">
        <b>Unreadable or unsupported files</b>
        {project.rejected.length > 0 && (
          <button onClick={onClear} disabled={disabled}>
            Clear
          </button>
        )}
      </div>
      <ul className="refused-list">
        {skipped.map((f, i) => (
          <li key={`s${i}`}>
            <b>{f.filename}</b>: {f.reason}
          </li>
        ))}
        {project.rejected.map((f, i) => (
          <li key={`r${i}`}>
            <b>{f.filename}</b>: {f.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Poses({
  project,
  colmapInstalled,
  busy,
  onStart,
  onCancel,
  view,
  onView,
  onlyUnplaced,
  onOnlyUnplaced,
}: {
  project: TrainingProject;
  colmapInstalled: boolean;
  busy: boolean;
  onStart: () => void;
  onCancel: () => void;
  view: "photos" | "poses";
  onView: (view: "photos" | "poses") => void;
  onlyUnplaced: boolean;
  onOnlyUnplaced: (value: boolean) => void;
}) {
  const job = project.poses;
  const active = job?.status === "queued" || job?.status === "running";
  const tooFew = project.images.length < 3;
  const s = job?.status === "done" ? job.summary : null;
  const names = new Map(project.images.map((i) => [i.id, i.filename]));
  const startLabel = job ? "Run again" : "Estimate camera poses";

  return (
    <div className="section">
      <b>Camera poses (Lab 10B, step 1)</b>
      <div className="note">
        COLMAP finds the same features in overlapping photos and solves where each photo was taken from, plus a sparse
        point cloud. This is where coverage is really tested. It runs on the CPU in the background (192 photos took
        about 4 minutes on an M2).
      </div>

      {!active && (
        <div className="dataset-actions">
          <button onClick={onStart} disabled={busy || !colmapInstalled || tooFew}>
            {startLabel}
          </button>
          {s && (
            <button onClick={() => onView(view === "poses" ? "photos" : "poses")}>
              {view === "poses" ? "Show photos" : "Show cameras in 3D"}
            </button>
          )}
        </div>
      )}
      {!colmapInstalled && !job && (
        <div className="status">COLMAP isn&apos;t installed: run brew install colmap, then restart the backend.</div>
      )}
      {tooFew && <div className="note">Needs at least 3 photos.</div>}

      {active && job && (
        <div className="dataset-info">
          {job.stage} · {Math.round(job.progress * 100)}%
          <progress value={job.progress} max={1} />
          <div className="dataset-actions">
            <button onClick={onCancel}>Cancel</button>
          </div>
          <span className="note">Adding or removing photos is paused until it finishes.</span>
        </div>
      )}

      {job?.status === "failed" && (
        <>
          <div className="error">{job.error}</div>
          {job.logTail && <pre className="log-tail">{job.logTail}</pre>}
        </>
      )}
      {job?.status === "cancelled" && <div className="note">Cancelled. Nothing was kept from that run.</div>}

      {s && (
        <>
          {job?.outdated && (
            <div className="status">
              Photos were added or removed after this ran: the result describes the earlier set. Run it again.
            </div>
          )}
          <table className="attr-table">
            <tbody>
              <tr>
                <th>Placed</th>
                <td>
                  {s.registered} of {s.imageCount} photos ({Math.round((100 * s.registered) / s.imageCount)}%)
                </td>
              </tr>
              <tr>
                <th>Points</th>
                <td>
                  {s.points.toLocaleString()}, each seen in {s.meanTrackLength} photos on average
                </td>
              </tr>
              <tr>
                <th>Reprojection</th>
                <td>{s.meanReprojectionErrorPx} px mean error</td>
              </tr>
              <tr>
                <th>Lens</th>
                <td>
                  {s.camera.model}, {s.camera.width}×{s.camera.height}, focal {s.camera.focalPx.join(" / ")} px
                  {s.cameraCount === 1 ? " (one lens for all photos)" : ` (${s.cameraCount} lenses)`}
                </td>
              </tr>
              <tr>
                <th>Time</th>
                <td>
                  {Object.entries(s.seconds)
                    .map(([k, v]) => `${k} ${Math.round(v)} s`)
                    .join(" · ")}
                </td>
              </tr>
            </tbody>
          </table>
          <div className="note">
            Reprojection error: how far, on average, the solved 3D points land from where they were seen in the
            photos. Around 1 px or less means the cameras and points agree well. The model has no real-world scale or
            up direction.
          </div>
          {s.models.length > 1 && (
            <div className="status">
              The photos formed {s.models.length} separate groups ({s.models.join(", ")} photos) that COLMAP couldn&apos;t
              connect; only the largest is used. More overlapping photos between the areas would join them.
            </div>
          )}
          {s.notRegistered.length > 0 && (
            <>
              <div className="note">
                <b>{s.notRegistered.length} not placed</b>: too few matches with the other photos (plain surfaces,
                close-ups, or views that overlap nothing else). They are left out, never given a guessed pose.
              </div>
              <details className="explain">
                <summary>Which photos</summary>
                <div className="note">{s.notRegistered.map((id) => names.get(id) ?? id).join(", ")}</div>
              </details>
              <label>
                <input type="checkbox" checked={onlyUnplaced} onChange={(e) => onOnlyUnplaced(e.target.checked)} />
                Show only photos not placed
              </label>
            </>
          )}
        </>
      )}
    </div>
  );
}

const CHECK_MARKS = { ok: "✓", warn: "!", fail: "✗" } as const;

function CloudPackage({
  projectId,
  pkg,
  busy,
  onBuild,
}: {
  projectId: string;
  pkg: TrainingPackage | null;
  busy: boolean;
  onBuild: () => void;
}) {
  const e = pkg?.estimate;
  const built = pkg?.built;
  return (
    <div className="section">
      <b>Cloud training package (Lab 10C)</b>
      <div className="note">
        Gaussian training needs an NVIDIA GPU, so it runs on a rented one with Nerfstudio splatfacto. This builds a zip
        of the placed photos and the COLMAP reconstruction on this computer. Nothing is uploaded and no cloud service is
        contacted: you take the zip there yourself.
      </div>
      {!pkg ? (
        <div className="note">Checking the reconstruction…</div>
      ) : (
        <>
          <ul className="check-list">
            {pkg.checks.map((c) => (
              <li key={c.key} className={c.level}>
                <span className="mark">{CHECK_MARKS[c.level]}</span>
                <span>
                  <b>{c.label}</b>: {c.detail}
                </span>
              </li>
            ))}
          </ul>
          {e && (
            <div className="dataset-info">
              <span>
                Contents: {e.imageCount} photos ({e.imageCount - e.evalCount} to train on, {e.evalCount} held out for
                evaluation), the COLMAP model, scripts and manifest · {e.files} files
              </span>
              <span>
                Size before export: about {formatBytes(e.total)} (photos {formatBytes(e.images)}, model{" "}
                {formatBytes(e.model)}, scripts and manifest {formatBytes(e.other)})
              </span>
            </div>
          )}
          <div className="dataset-actions">
            <button onClick={onBuild} disabled={busy || !pkg.ready || pkg.building}>
              {pkg.building ? "Building…" : built ? "Build again" : "Build package"}
            </button>
            {built?.available && (
              <a className="download-link" href={packageDownloadUrl(projectId)} download={built.file}>
                Download {built.file}
              </a>
            )}
          </div>
          {built && (
            <div className="dataset-info">
              <span>
                Built {new Date(built.createdAt).toLocaleString()}: {formatBytes(built.bytes)}, {built.imageCount} photos
                ({built.evalCount} held out), {built.excludedCount} unplaced left out.
              </span>
              <span>
                SHA-256 (check it after uploading: <code>sha256sum {built.file}</code>):{" "}
                <code className="hash">{built.sha256}</code>
              </span>
            </div>
          )}
          {built?.outdated && (
            <div className="status">The camera poses changed after this package was built. Build it again.</div>
          )}
          <details className="explain">
            <summary>What to do with it</summary>
            <ol className="steps">
              <li>
                Rent one NVIDIA RTX 4090 or 3090 (24 GB). On Runpod: Pods → Deploy, Secure Cloud for private photos,
                template &quot;PyTorch 2.1&quot;, 20 GB container disk, 30 GB encrypted volume. Billing starts here
                (about $0.34–0.74 per hour).
              </li>
              <li>Upload the zip (drag it into JupyterLab) and unpack it in /workspace.</li>
              <li>
                <code>bash setup_env.sh</code> installs Nerfstudio 1.1.5 at pinned versions, runs pip check and tests
                the GPU.
              </li>
              <li>
                <code>bash train.sh smoke</code> (300 steps, minutes) proves training, export and evaluation work, then{" "}
                <code>bash train.sh quick</code> (7,000 steps) gives a first look. Check the renders of the held-out
                photos.
              </li>
              <li>
                <code>bash train.sh quality</code> (30,000 steps) makes the first useful scene.
              </li>
              <li>Download the result folder (splat.ply, run.json, evaluation) to this Mac.</li>
              <li>Stop, then Terminate the Pod, so nothing keeps billing.</li>
            </ol>
            <div className="note">
              README.md inside the package has the exact commands, versions, time and cost estimates, monitoring and
              troubleshooting. Importing the trained scene into Labs 8 and 9 comes next.
            </div>
          </details>
        </>
      )}
    </div>
  );
}

function Stages({ project }: { project: TrainingProject }) {
  const anyRun = project.stages.some((s) => s.status !== "planned");
  return (
    <div className="section">
      <b>Training stages</b>
      <div className="note">
        {anyRun
          ? "Preprocessing and camera poses run together (above). Training and export happen on a rented GPU from the cloud training package; there are no trained Gaussians for this project yet."
          : "The plan for Lab 10B. None of these has run yet: there are no camera poses and no trained Gaussians for this project."}
      </div>
      <ol className="stage-list">
        {project.stages.map((stage) => (
          <li key={stage.key}>
            <div>
              <b>{stage.title}</b> <span className={`badge ${stage.status}`}>{stage.status}</span>
            </div>
            <div className="note">{stage.detail}</div>
            <div className="note">
              Tools: {stage.tools.join(", ")} · Output: <code>{stage.output}</code>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function EnvironmentReport({ environment: env }: { environment: Environment | null }) {
  if (!env) return null;
  const GiB = 1024 ** 3;
  const found = Object.values(env.tools).filter((t) => t.path);
  const missing = Object.values(env.tools).filter((t) => !t.path);
  return (
    <div className="section">
      <details className="explain">
        <summary>Training environment (this machine)</summary>
        <div className="dataset-info">
          <span>
            {env.os} · {env.architecture} · {env.cpu} ({env.cpuCores} cores)
            {env.memoryBytes && ` · ${(env.memoryBytes / GiB).toFixed(0)} GB memory`}
          </span>
          {env.gpus.map((g, i) => (
            <span key={i}>
              GPU: {g.name} ({g.api}, {g.detail}
              {g.memoryBytes ? `, ${(g.memoryBytes / GiB).toFixed(0)} GB` : ""})
            </span>
          ))}
          {env.gpus.length === 0 && <span>GPU: none found</span>}
          <span>Free disk: {(env.diskFreeBytes / GiB).toFixed(0)} GiB</span>
          <span>Installed: {found.length ? found.map((t) => t.label).join(", ") : "none of the training tools"}</span>
          <span>Not installed: {missing.map((t) => t.label).join(", ") || "—"}</span>
        </div>
        <div className={env.assessment.verdict === "local-cuda" ? "note ok" : "status"}>{env.assessment.summary}</div>
        <ul className="refused-list">
          {env.assessment.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

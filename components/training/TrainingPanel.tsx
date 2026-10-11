"use client";

import Link from "next/link";
import { useState } from "react";
import { formatBytes } from "@/lib/splats";
import {
  WARNING_LABELS,
  type Environment,
  type ProjectSummary,
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
  busy: boolean;
  error: string | null;
};

export function TrainingPanel(props: TrainingPanelProps) {
  const { projects, project, busy, progress } = props;
  const [newName, setNewName] = useState("");
  const uploading = progress !== null;

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
        Lab 10A: collect photographs of a space and check them before Gaussian training. Nothing is trained yet;
        the photos are stored by the local backend and never modified.
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
            {uploading && (
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

function Stages({ project }: { project: TrainingProject }) {
  return (
    <div className="section">
      <b>Training stages</b>
      <div className="note">
        The plan for Lab 10B. None of these has run: there are no camera poses and no trained Gaussians for this
        project yet.
      </div>
      <ol className="stage-list">
        {project.stages.map((stage) => (
          <li key={stage.key}>
            <div>
              <b>{stage.title}</b> <span className="badge">{stage.status}</span>
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

"use client";

import { useState, type FormEvent } from "react";
import { deleteDataset, uploadDataset, type Dataset } from "@/lib/datasets";
import { describePlan, planImport, type ImportCandidate, type ImportRole } from "@/lib/importPlan";

type DatasetManagerProps = {
  datasets: Dataset[];
  selected: Dataset;
  onSelect: (id: string) => void;
  /** Set when the local backend can't be reached. */
  backendError: string | null;
  /** Re-read the dataset list (after an import or delete). */
  onChanged: () => Promise<void>;
};

/**
 * Collapsible "Datasets" section: pick a dataset, see its metadata and
 * conversion status, delete it, or import a new one.
 *
 * Importing uploads the files to the local backend, which converts them in a
 * worker process; the page polls the dataset list to show progress.
 */
export function DatasetManager({ datasets, selected, onSelect, backendError, onChanged }: DatasetManagerProps) {
  const [importing, setImporting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function remove() {
    if (!window.confirm(`Delete "${selected.name}"? Its uploaded and converted files will be removed.`)) return;
    try {
      await deleteDataset(selected.id);
      setActionError(null);
      await onChanged();
    } catch (err) {
      setActionError((err as Error).message);
    }
  }

  return (
    <details className="section datasets" open>
      <summary>Datasets</summary>

      <select value={selected.id} onChange={(e) => onSelect(e.target.value)}>
        {datasets.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
            {d.status !== "ready" && ` (${statusText(d)})`}
          </option>
        ))}
      </select>

      <DatasetInfo dataset={selected} />

      <div className="dataset-actions">
        <button onClick={() => setImporting((open) => !open)} disabled={!!backendError}>
          {importing ? "Cancel import" : "Import dataset…"}
        </button>
        {selected.origin === "local-backend" && (
          <button onClick={remove} disabled={selected.status === "queued" || selected.status === "converting"}>
            Delete
          </button>
        )}
      </div>

      {importing && (
        <ImportForm
          onImported={async (dataset) => {
            setImporting(false);
            await onChanged();
            onSelect(dataset.id);
          }}
        />
      )}

      {actionError && <div className="error">{actionError}</div>}
      {backendError && <div className="note">{backendError}</div>}
    </details>
  );
}

function statusText(dataset: Dataset): string {
  if (dataset.status === "converting") return `converting ${Math.round(dataset.progress * 100)}%`;
  return dataset.status;
}

/** Metadata of the selected dataset. */
function DatasetInfo({ dataset }: { dataset: Dataset }) {
  const bounds = dataset.originalBounds;
  const size = bounds && bounds.max.map((max, i) => max - bounds.min[i]);
  const poses = dataset.poses;

  return (
    <div className="dataset-info">
      {dataset.status === "ready" ? null : dataset.status === "failed" ? (
        <div className="error">Import failed: {dataset.error}</div>
      ) : (
        <div className="status">
          {dataset.stage}
          <progress value={dataset.progress} max={1} />
        </div>
      )}
      {dataset.originalPointCount !== null && (
        <div>Original points: {dataset.originalPointCount.toLocaleString()}</div>
      )}
      {size && <div>Size: {size.map((s) => s.toFixed(1)).join(" × ")} m</div>}
      {dataset.offset && (
        <div title={`Exact: ${dataset.offset.join(", ")}`}>
          Offset: {dataset.offset.map((v) => v.toFixed(3)).join(", ")}
        </div>
      )}
      {dataset.budgets.length > 0 && <div>Budgets: {dataset.budgets.map((b) => b.label).join(", ")}</div>}
      <div>
        Poses:{" "}
        {poses ? `${poses.count.toLocaleString()} (${poses.status})` : dataset.source.poses ? "pending" : "none"}
      </div>
      {dataset.hasRgb === false && <div>No RGB in the LAS file: points are grey.</div>}
      {dataset.source.pointcloud && (
        <div>
          Source: {dataset.source.pointcloud.filename} ({formatBytes(dataset.source.pointcloud.bytes)})
        </div>
      )}
      {dataset.source.project && <div>Project metadata: {dataset.source.project.filename}</div>}
      {dataset.attachments.map((a) => (
        <div key={a.role}>
          Kept for later: {a.filename} ({String(a.rows ?? "?")} rows)
        </div>
      ))}
      {dataset.origin === "local-backend" && (
        <div>Imported: {new Date(dataset.createdAt).toLocaleString()}</div>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

const ROLE_LABELS: Record<ImportRole, string> = {
  pointcloud: "Point cloud",
  poses: "Scanner poses",
  project: "Project metadata",
  control_points: "Control points",
  gnss: "GNSS",
  ignore: "Don't import",
};

/**
 * Pick a folder or individual files, review what was detected, fix any
 * ambiguous roles, then upload. Nothing is sent before "Upload and convert".
 */
function ImportForm({ onImported }: { onImported: (dataset: Dataset) => Promise<void> }) {
  const [name, setName] = useState("");
  const [candidates, setCandidates] = useState<ImportCandidate[] | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const plan = candidates && describePlan(candidates);

  function choose(fileList: FileList | null) {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;
    const planned = planImport(files);
    setCandidates(planned);
    setUploadError(null);
    // Suggest a name: the folder's name, or the point cloud's file name.
    const folder = files[0].webkitRelativePath.split("/")[0];
    const las = planned.find((c) => c.role === "pointcloud");
    setName(folder || las?.file.name.replace(/\.[^.]+$/, "") || "");
  }

  function setRole(index: number, role: ImportRole) {
    setCandidates((current) => current && current.map((c, i) => (i === index ? { ...c, role } : c)));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!candidates || !plan?.ready) return;

    const form = new FormData();
    const pointcloud = candidates.find((c) => c.role === "pointcloud")!;
    form.append("name", name.trim() || pointcloud.file.name);
    for (const c of candidates) {
      if (c.role !== "ignore") form.append(c.role, c.file, c.file.name);
    }

    setUploadError(null);
    setUploadProgress(0);
    try {
      const dataset = await uploadDataset(form, setUploadProgress);
      await onImported(dataset);
    } catch (err) {
      setUploadError((err as Error).message);
    } finally {
      setUploadProgress(null);
    }
  }

  const uploading = uploadProgress !== null;
  const uploadBytes = candidates?.filter((c) => c.role !== "ignore").reduce((sum, c) => sum + c.file.size, 0) ?? 0;

  return (
    <form className="import-form" onSubmit={submit}>
      <div className="dataset-actions">
        <label className="picker">
          Choose folder…
          <input
            type="file"
            // Not in React's types: lets the user pick a whole folder (all files inside, recursively).
            ref={(input) => input?.setAttribute("webkitdirectory", "")}
            disabled={uploading}
            onChange={(e) => choose(e.target.files)}
          />
        </label>
        <label className="picker">
          Choose files…
          <input
            type="file"
            multiple
            accept=".las,.csv,.json"
            disabled={uploading}
            onChange={(e) => choose(e.target.files)}
          />
        </label>
      </div>

      {candidates && plan && (
        <>
          <div className="import-summary">{plan.summary}</div>
          <ul className="import-files">
            {candidates.map((c, i) => (
              <li key={c.path}>
                <div className="import-file-row">
                  <span className="import-path" title={c.path}>
                    {c.path}
                  </span>
                  <select
                    value={c.role}
                    disabled={uploading || c.allowedRoles.length === 0}
                    onChange={(e) => setRole(i, e.target.value as ImportRole)}
                  >
                    {[...c.allowedRoles, "ignore" as const].map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                </div>
                {c.note && <div className={c.ambiguousRole ? "status" : "note"}>{c.note}</div>}
              </li>
            ))}
          </ul>
          {plan.problems.map((p) => (
            <div key={p} className="error">
              {p}
            </div>
          ))}
          {plan.warnings.map((w) => (
            <div key={w} className="status">
              {w}
            </div>
          ))}
          <label className="stacked">
            Name
            <input type="text" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="note">
            Control points and GNSS files are stored for later analysis; their columns aren&apos;t interpreted yet.
          </div>
          <button type="submit" disabled={uploading || !plan.ready}>
            {uploading
              ? `Uploading ${Math.round(uploadProgress * 100)}%`
              : `Upload and convert (${formatBytes(uploadBytes)})`}
          </button>
        </>
      )}
      {uploadError && <div className="error">{uploadError}</div>}
    </form>
  );
}

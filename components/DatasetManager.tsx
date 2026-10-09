"use client";

import { useState, type FormEvent } from "react";
import {
  UPLOAD_ROLES,
  checkFileForRole,
  deleteDataset,
  uploadDataset,
  type Dataset,
  type UploadRole,
} from "@/lib/datasets";

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

/** Name + one file input per role. Checks extensions before uploading. */
function ImportForm({ onImported }: { onImported: (dataset: Dataset) => Promise<void> }) {
  const [name, setName] = useState("");
  const [files, setFiles] = useState<Partial<Record<UploadRole, File>>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  function pick(role: UploadRole, file: File | undefined) {
    setFiles((current) => ({ ...current, [role]: file }));
    setProblem(file ? checkFileForRole(role, file.name) : null);
    // Suggest a name from the point-cloud file.
    if (role === "pointcloud" && file && !name) setName(file.name.replace(/\.[^.]+$/, ""));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!files.pointcloud) return setProblem("Choose a .las point cloud.");
    for (const [role, file] of Object.entries(files) as [UploadRole, File | undefined][]) {
      const message = file && checkFileForRole(role, file.name);
      if (message) return setProblem(message);
    }

    const form = new FormData();
    form.append("name", name.trim() || files.pointcloud.name);
    for (const [role, file] of Object.entries(files)) {
      if (file) form.append(role, file);
    }

    setProblem(null);
    setUploadProgress(0);
    try {
      const dataset = await uploadDataset(form, setUploadProgress);
      await onImported(dataset);
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      setUploadProgress(null);
    }
  }

  const uploading = uploadProgress !== null;

  return (
    <form className="import-form" onSubmit={submit}>
      <label className="stacked">
        Name
        <input type="text" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </label>
      {UPLOAD_ROLES.map((rule) => (
        <label key={rule.role} className="stacked">
          {rule.label} ({rule.extension}
          {rule.required ? ", required" : ", optional"})
          <input
            type="file"
            accept={rule.extension}
            disabled={uploading}
            onChange={(e) => pick(rule.role, e.target.files?.[0])}
          />
        </label>
      ))}
      <div className="note">
        Control points and GNSS files are stored for later analysis; their columns aren&apos;t interpreted yet.
      </div>
      <button type="submit" disabled={uploading || !files.pointcloud}>
        {uploading ? `Uploading ${Math.round(uploadProgress * 100)}%` : "Upload and convert"}
      </button>
      {problem && <div className="error">{problem}</div>}
    </form>
  );
}

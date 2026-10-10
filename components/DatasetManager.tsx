"use client";

import { useState, type FormEvent } from "react";
import { deleteDataset, uploadDataset, type Dataset } from "@/lib/datasets";
import {
  captureOfDataset,
  capturesOfProperty,
  catalogApi,
  lidarDatasetIds,
  type Capture,
  type Catalog,
} from "@/lib/catalog";
import { describePlan, planImport, type ImportCandidate, type ImportRole } from "@/lib/importPlan";

type DatasetManagerProps = {
  datasets: Dataset[];
  catalog: Catalog;
  /** Every catalog change returns the whole new catalog. */
  onCatalogChange: (catalog: Catalog) => void;
  /** Set when the backend is reachable but has no catalog endpoints (started with older code). */
  catalogError: string | null;
  /** The dataset being viewed. */
  selected: Dataset;
  onSelect: (id: string) => void;
  /** Set when the local backend can't be reached. */
  backendError: string | null;
  /** Re-read the dataset list and catalog (after an import or delete). */
  onChanged: () => Promise<void>;
};

/** Value of the property picker for "datasets that are in no capture". */
const UNASSIGNED = "";

/**
 * Collapsible "Properties" section: Property -> Capture -> Dataset.
 *
 * Pick a property (or "Unassigned datasets"), one of its captures, and the
 * capture's dataset to view. Properties and captures only reference datasets
 * (lib/catalog.ts): creating, renaming or deleting them never touches dataset
 * files. Only "Delete dataset" removes files.
 *
 * Importing uploads files to the local backend, which converts them in a
 * worker process; the page polls the dataset list to show progress.
 */
export function DatasetManager({
  datasets,
  catalog,
  onCatalogChange,
  catalogError,
  selected,
  onSelect,
  backendError,
  onChanged,
}: DatasetManagerProps) {
  const [importing, setImporting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // null = follow the viewed dataset (e.g. on first load).
  const [propertyChoice, setPropertyChoice] = useState<string | null>(null);
  const [captureChoice, setCaptureChoice] = useState<string | null>(null);

  const selectedCapture = captureOfDataset(catalog, selected.id);
  const propertyId = propertyChoice ?? selectedCapture?.propertyId ?? UNASSIGNED;
  const property = catalog.properties.find((p) => p.id === propertyId) ?? null;
  const captures = property ? capturesOfProperty(catalog, property.id) : [];
  const capture =
    captures.find((c) => c.id === (captureChoice ?? selectedCapture?.id)) ?? captures[0] ?? null;

  const byId = new Map(datasets.map((d) => [d.id, d]));
  const datasetsOf = (c: Capture) => lidarDatasetIds(c).flatMap((id) => byId.get(id) ?? []);
  const unassigned = datasets.filter((d) => !captureOfDataset(catalog, d.id));
  // The datasets offered in the Dataset picker.
  const listed = property ? (capture ? datasetsOf(capture) : []) : unassigned;
  const viewingListed = listed.some((d) => d.id === selected.id);

  /** Run a catalog/API action; show its error in the panel instead of throwing. */
  async function run(action: () => Promise<void>) {
    try {
      await action();
      setActionError(null);
    } catch (err) {
      setActionError((err as Error).message);
    }
  }

  function chooseProperty(id: string) {
    setPropertyChoice(id);
    setCaptureChoice(null);
    const first = id === UNASSIGNED ? null : capturesOfProperty(catalog, id)[0];
    const firstDataset = first ? datasetsOf(first)[0] : unassigned[0];
    if (firstDataset) onSelect(firstDataset.id);
  }

  function chooseCapture(id: string) {
    setCaptureChoice(id);
    const chosen = captures.find((c) => c.id === id);
    const firstDataset = chosen ? datasetsOf(chosen)[0] : undefined;
    if (firstDataset) onSelect(firstDataset.id);
  }

  const ask = (question: string, current = "") => window.prompt(question, current)?.trim() || null;

  const newProperty = () =>
    run(async () => {
      const name = ask("Name of the new property (a real-world place, e.g. Hawaii Resort):");
      if (!name) return;
      const next = await catalogApi.createProperty(name);
      onCatalogChange(next);
      setPropertyChoice(next.properties.at(-1)!.id);
      setCaptureChoice(null);
    });

  const renameProperty = () =>
    run(async () => {
      const name = property && ask("New name for this property:", property.name);
      if (property && name) onCatalogChange(await catalogApi.renameProperty(property.id, name));
    });

  const deleteProperty = () =>
    run(async () => {
      if (!property) return;
      const datasetCount = captures.reduce((n, c) => n + lidarDatasetIds(c).length, 0);
      const ok = window.confirm(
        `Delete property "${property.name}" and its ${captures.length} capture(s)?\n\n` +
          `No files are deleted: its ${datasetCount} dataset(s) stay available under "Unassigned datasets".`,
      );
      if (!ok) return;
      onCatalogChange(await catalogApi.deleteProperty(property.id));
      setPropertyChoice(UNASSIGNED);
      setCaptureChoice(null);
    });

  const newCapture = () =>
    run(async () => {
      const name = property && ask(`Name of the new capture at ${property.name} (e.g. Reception Capture):`);
      if (!property || !name) return;
      const next = await catalogApi.createCapture(property.id, name);
      onCatalogChange(next);
      setCaptureChoice(next.captures.at(-1)!.id);
    });

  const renameCapture = () =>
    run(async () => {
      const name = capture && ask("New name for this capture:", capture.name);
      if (capture && name) onCatalogChange(await catalogApi.renameCapture(capture.id, name));
    });

  const deleteCapture = () =>
    run(async () => {
      if (!capture) return;
      const ok = window.confirm(
        `Delete capture "${capture.name}"?\n\nNo files are deleted: its ${lidarDatasetIds(capture).length} ` +
          `dataset(s) stay available under "Unassigned datasets".`,
      );
      if (!ok) return;
      onCatalogChange(await catalogApi.deleteCapture(capture.id));
      setCaptureChoice(null);
    });

  const addToCapture = (datasetId: string) =>
    run(async () => {
      if (!capture || !datasetId) return;
      onCatalogChange(await catalogApi.assignDataset(capture.id, datasetId));
      setCaptureChoice(capture.id);
      onSelect(datasetId);
    });

  const removeFromCapture = () =>
    run(async () => {
      if (capture) onCatalogChange(await catalogApi.unassignDataset(capture.id, selected.id));
    });

  const removeDataset = () =>
    run(async () => {
      const inCapture = selectedCapture
        ? `\n\nIt is part of capture "${selectedCapture.name}" and will be removed from it.`
        : "";
      const ok = window.confirm(
        `Delete dataset "${selected.name}"? Its uploaded and converted files will be permanently removed.${inCapture}`,
      );
      if (!ok) return;
      await deleteDataset(selected.id);
      await onChanged();
    });

  const offline = !!backendError;
  // Property/capture editing needs the catalog endpoints as well.
  const noCatalog = offline || !!catalogError;
  const busy = (d: Dataset) =>
    d.status === "queued" ||
    d.status === "converting" ||
    d.budgetJob?.status === "queued" ||
    d.budgetJob?.status === "running";

  return (
    <details className="section datasets" open>
      <summary>Properties</summary>

      <label className="stacked">
        Property
        <select value={propertyId} onChange={(e) => chooseProperty(e.target.value)}>
          <option value={UNASSIGNED}>Unassigned datasets ({unassigned.length})</option>
          {catalog.properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({plural(capturesOfProperty(catalog, p.id).length, "capture")})
            </option>
          ))}
        </select>
      </label>
      <div className="mini-actions">
        <button onClick={newProperty} disabled={noCatalog}>New</button>
        <button onClick={renameProperty} disabled={noCatalog || !property}>Rename</button>
        <button onClick={deleteProperty} disabled={noCatalog || !property}>Delete</button>
      </div>

      {property && (
        <>
          <label className="stacked">
            Capture
            {captures.length > 0 ? (
              <select value={capture?.id} onChange={(e) => chooseCapture(e.target.value)}>
                {captures.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({plural(lidarDatasetIds(c).length, "dataset")})
                  </option>
                ))}
              </select>
            ) : (
              <span className="note">No captures yet. Add one for each scanning session.</span>
            )}
          </label>
          <div className="mini-actions">
            <button onClick={newCapture} disabled={noCatalog}>Add</button>
            <button onClick={renameCapture} disabled={noCatalog || !capture}>Rename</button>
            <button onClick={deleteCapture} disabled={noCatalog || !capture}>Delete</button>
          </div>
        </>
      )}

      {listed.length > 0 && (
        <label className="stacked">
          Dataset
          <select value={viewingListed ? selected.id : ""} onChange={(e) => onSelect(e.target.value)}>
            {!viewingListed && <option value="">Choose…</option>}
            {listed.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.status !== "ready" && ` (${statusText(d)})`}
              </option>
            ))}
          </select>
        </label>
      )}
      {capture && listed.length === 0 && <div className="note">No datasets in this capture yet.</div>}

      {capture && (
        <select className="assign" value="" disabled={noCatalog} onChange={(e) => addToCapture(e.target.value)}>
          <option value="">Add a dataset to this capture…</option>
          {datasets
            .filter((d) => !listed.includes(d))
            .map((d) => {
              const other = captureOfDataset(catalog, d.id);
              return (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {other ? ` (moves from ${other.name})` : ""}
                </option>
              );
            })}
        </select>
      )}

      {!viewingListed && <div className="note">Viewing {selected.name} (not in this list).</div>}
      <DatasetInfo dataset={selected} />
      {capture && (
        <div className="note">
          Each capture keeps its own coordinate frame; captures are not aligned to each other yet.
        </div>
      )}

      <div className="dataset-actions">
        <button onClick={() => setImporting((open) => !open)} disabled={offline} title="Import a new dataset">
          {importing ? "Cancel import" : "Import…"}
        </button>
        {capture && viewingListed && (
          <button
            onClick={removeFromCapture}
            disabled={noCatalog}
            title="Remove this dataset from the capture; the dataset and its files are kept"
          >
            Unassign
          </button>
        )}
        {selected.origin === "local-backend" && (
          <button
            onClick={removeDataset}
            disabled={busy(selected)}
            title="Delete this dataset and permanently remove its uploaded and converted files"
          >
            Delete files
          </button>
        )}
      </div>

      {importing && (
        <ImportForm
          capture={capture}
          onImported={async (dataset, addTo) => {
            setImporting(false);
            if (addTo) onCatalogChange(await catalogApi.assignDataset(addTo.id, dataset.id));
            await onChanged();
            onSelect(dataset.id);
          }}
        />
      )}

      {actionError && <div className="error">{actionError}</div>}
      {backendError && <div className="note">{backendError}</div>}
      {!backendError && catalogError && <div className="status">{catalogError}</div>}
    </details>
  );
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
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
      {dataset.budgetJob &&
        (dataset.budgetJob.status === "failed" ? (
          <div className="error">
            {dataset.budgetJob.stage}: {dataset.budgetJob.error}
          </div>
        ) : (
          <div className="status">
            {dataset.budgetJob.stage} (the other budgets stay usable)
            <progress value={dataset.budgetJob.progress} max={1} />
          </div>
        ))}
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
      {dataset.projectInferred && (
        <div>
          Project metadata: inferred from the LAS header (CRS:{" "}
          {dataset.projectInferred.coordinateReferenceSystem ?? "unknown"})
        </div>
      )}
      {dataset.attachments.map((a) => (
        <div key={a.role}>
          Kept for later: {a.filename} ({String(a.rows ?? "?")} rows)
        </div>
      ))}
      {dataset.origin === "local-backend" && (
        <div>Imported: {new Date(dataset.createdAt).toLocaleString()}</div>
      )}
      {dataset.warnings?.map((warning) => (
        <div key={warning} className="status">
          ⚠ {warning}
        </div>
      ))}
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
function ImportForm({
  capture,
  onImported,
}: {
  /** The capture selected in the panel, offered as the new dataset's capture. */
  capture: Capture | null;
  onImported: (dataset: Dataset, addTo: Capture | null) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [addToCapture, setAddToCapture] = useState(true);
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
      await onImported(dataset, capture && addToCapture ? capture : null);
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
          {capture && (
            <label>
              <input
                type="checkbox"
                checked={addToCapture}
                disabled={uploading}
                onChange={(e) => setAddToCapture(e.target.checked)}
              />
              Add to capture &quot;{capture.name}&quot;
            </label>
          )}
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

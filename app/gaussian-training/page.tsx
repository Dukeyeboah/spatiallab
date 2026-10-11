"use client";

import { useEffect, useState } from "react";
import { PhotoGrid } from "@/components/training/PhotoGrid";
import { TrainingPanel } from "@/components/training/TrainingPanel";
import { API_URL } from "@/lib/datasets";
import {
  partitionFiles,
  trainingApi,
  uploadPhotos,
  type Environment,
  type ProjectSummary,
  type TrainingProject,
} from "@/lib/training";

/**
 * Lab 10A: photographs for Gaussian training. The backend stores and checks
 * them; this page lists, previews and removes them, and shows the planned
 * training stages and what this machine can do. No R3F here: nothing 3D exists
 * until camera poses are estimated (Lab 10B).
 */
export default function GaussianTrainingPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<TrainingProject | null>(null);
  const [environment, setEnvironment] = useState<Environment | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [lastUpload, setLastUpload] = useState<{ accepted: number; refused: number } | null>(null);
  const [skipped, setSkipped] = useState<{ filename: string; reason: string }[]>([]);
  const [onlyWarnings, setOnlyWarnings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError(
        err instanceof TypeError
          ? `The local backend isn't reachable at ${API_URL}. Start it (and restart it after updates) to manage training photos.`
          : (err as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }

  async function open(id: string) {
    setProject(await trainingApi.get(id));
    setSkipped([]);
    setLastUpload(null);
    setOnlyWarnings(false);
  }

  useEffect(() => {
    run(async () => {
      const list = await trainingApi.list();
      setProjects(list);
      if (list.length) await open(list[list.length - 1].id);
      setEnvironment(await trainingApi.environment());
    });
    // Once, on load.
  }, []);

  const refreshList = async () => setProjects(await trainingApi.list());

  return (
    <>
      {project && (
        <PhotoGrid
          project={project}
          onlyWarnings={onlyWarnings}
          disabled={busy || progress !== null}
          onRemove={(imageId, filename) => {
            if (!window.confirm(`Remove "${filename}" from this project? The stored copy is deleted.`)) return;
            run(async () => {
              setProject(await trainingApi.removeImage(project.id, imageId));
              await refreshList();
            });
          }}
        />
      )}
      <TrainingPanel
        projects={projects}
        project={project}
        onSelect={(id) => run(() => open(id))}
        onCreate={(name) =>
          run(async () => {
            const created = await trainingApi.create(name);
            await refreshList();
            await open(created.id);
          })
        }
        onDelete={() => {
          if (!project) return;
          const ok = window.confirm(
            `Delete the project "${project.name}" and its ${project.images.length} stored photographs?\n\n` +
              "Your original files on this computer are not affected.",
          );
          if (!ok) return;
          run(async () => {
            await trainingApi.remove(project.id);
            setProject(null);
            await refreshList();
          });
        }}
        onFiles={(files) => {
          if (!project) return;
          const { photos, skipped: notUploaded } = partitionFiles(files);
          setSkipped(notUploaded);
          if (photos.length === 0) {
            setLastUpload({ accepted: 0, refused: notUploaded.length });
            return;
          }
          setProgress(0);
          run(async () => {
            try {
              const result = await uploadPhotos(project.id, photos, setProgress);
              setLastUpload({ accepted: result.accepted, refused: result.rejected.length + notUploaded.length });
            } finally {
              setProgress(null);
              setProject(await trainingApi.get(project.id));
              await refreshList();
            }
          });
        }}
        progress={progress}
        lastUpload={lastUpload}
        skipped={skipped}
        onClearRefused={() => {
          setSkipped([]);
          if (project) run(async () => setProject(await trainingApi.clearRejected(project.id)));
        }}
        onlyWarnings={onlyWarnings}
        onOnlyWarnings={setOnlyWarnings}
        environment={environment}
        busy={busy}
        error={error}
      />
    </>
  );
}

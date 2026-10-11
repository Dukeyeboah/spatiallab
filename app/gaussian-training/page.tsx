"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { PhotoGrid } from "@/components/training/PhotoGrid";
import { TrainingPanel } from "@/components/training/TrainingPanel";
import { API_URL } from "@/lib/datasets";
import {
  partitionFiles,
  trainingApi,
  uploadPhotos,
  type Environment,
  type PosePreview,
  type ProjectSummary,
  type TrainingProject,
} from "@/lib/training";

// WebGL only in the browser, and only loaded once someone opens the 3D view.
const PoseScene = dynamic(() => import("@/components/training/PoseScene").then((m) => m.PoseScene), { ssr: false });

const POLL_MS = 2000;

/**
 * Lab 10A: photographs for Gaussian training. The backend stores and checks
 * them; this page lists, previews and removes them, and shows the training
 * stages and what this machine can do.
 * Lab 10B (step 1): camera pose estimation with COLMAP as a background job;
 * the page polls its progress and shows the result as photos (placed or not)
 * or in 3D (sparse points and solved cameras).
 */
export default function GaussianTrainingPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<TrainingProject | null>(null);
  const [environment, setEnvironment] = useState<Environment | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [lastUpload, setLastUpload] = useState<{ accepted: number; refused: number } | null>(null);
  const [skipped, setSkipped] = useState<{ filename: string; reason: string }[]>([]);
  const [onlyWarnings, setOnlyWarnings] = useState(false);
  const [onlyUnplaced, setOnlyUnplaced] = useState(false);
  const [view, setView] = useState<"photos" | "poses">("photos");
  /** Tagged with the job it belongs to, so a re-run never shows the previous result. */
  const [preview, setPreview] = useState<{ key: string; data: PosePreview } | null>(null);
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
    setOnlyUnplaced(false);
    setView("photos");
  }

  const job = project?.poses ?? null;
  const jobActive = job?.status === "queued" || job?.status === "running";
  const previewKey = project && job?.status === "done" ? `${project.id}:${job.finishedAt}` : null;

  // While COLMAP runs, refresh the project (its job carries stage and progress). Keyed on the id and
  // the active flag only: each refresh replaces `project`, which must not restart the timer.
  useEffect(() => {
    if (!project || !jobActive) return;
    const timer = window.setInterval(() => {
      trainingApi
        .get(project.id)
        .then(setProject)
        .catch(() => {});
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [project?.id, jobActive]);

  // The 3D data (about 1 MB) is fetched once per finished job, when the 3D view is opened.
  useEffect(() => {
    if (view !== "poses" || !project || !previewKey || preview?.key === previewKey) return;
    run(async () => setPreview({ key: previewKey, data: await trainingApi.posePreview(project.id) }));
  }, [view, previewKey]);

  const showPoses = view === "poses" && !!project && preview?.key === previewKey && !!preview;

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
      {showPoses && project && preview && (
        <PoseScene
          projectId={project.id}
          preview={preview.data}
          unplaced={job?.summary?.notRegistered.length ?? 0}
        />
      )}
      {project && !showPoses && (
        <PhotoGrid
          project={project}
          onlyWarnings={onlyWarnings}
          onlyUnplaced={onlyUnplaced}
          disabled={busy || progress !== null || jobActive}
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
        onStartPoses={() => {
          if (!project) return;
          setView("photos");
          run(async () => setProject(await trainingApi.startPoses(project.id)));
        }}
        onCancelPoses={() => {
          if (project) run(async () => setProject(await trainingApi.cancelPoses(project.id)));
        }}
        view={view}
        onView={(next) => {
          setView(next);
          setOnlyUnplaced(false);
        }}
        onlyUnplaced={onlyUnplaced}
        onOnlyUnplaced={setOnlyUnplaced}
        busy={busy}
        error={error}
      />
    </>
  );
}

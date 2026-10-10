import { UPLOAD_ROLES, type UploadRole } from "./datasets";

/**
 * Turns a set of picked files (a folder or individual files) into an import
 * plan: which file is the point cloud, which are the poses, etc.
 *
 * Files are only assigned automatically when the choice is unambiguous.
 * Two LAS files, or several candidate pose files, are flagged and left
 * unassigned until the user picks one — we never guess.
 *
 * Detection uses file names and extensions only; the backend validates the
 * contents after upload.
 */

export type ImportRole = UploadRole | "ignore";

export type ImportCandidate = {
  file: File;
  /** Path relative to the picked folder, or just the file name. */
  path: string;
  role: ImportRole;
  /** Roles the user may choose for this file ("ignore" is always allowed). */
  allowedRoles: UploadRole[];
  /** Why the file was (not) assigned, shown in the preview. */
  note: string | null;
  /** Set when several files compete for this role. */
  ambiguousRole: UploadRole | null;
  /** CSV whose role couldn't be told from its name. */
  unrecognised: boolean;
  /** 0-byte file: an empty .las blocks the import, empty optional files are skipped. */
  empty: boolean;
};

export type ImportPlanStatus = {
  /** "Found 1 LAS point cloud, 1 poses CSV, …" */
  summary: string;
  /** Must be fixed before uploading. */
  problems: string[];
  /** Worth knowing, but uploading is allowed. */
  warnings: string[];
  ready: boolean;
};

const ROLES_BY_EXTENSION: Record<string, UploadRole[]> = {
  ".las": ["pointcloud"],
  ".csv": ["poses", "control_points", "gnss"],
  ".json": ["project"],
};

const UNSUPPORTED: Record<string, string> = {
  ".laz": "LAZ isn't supported yet; decompress it to .las first.",
  ".ply": "Trained Gaussian splats (.ply) are imported in the Gaussian viewer (Lab 8); meshes aren't supported.",
  ".sog": "Trained Gaussian splats (.sog) are imported in the Gaussian viewer (Lab 8).",
  ".splat": "Trained Gaussian splats: convert to .sog with SplatTransform and import in the Gaussian viewer (Lab 8).",
  ".ksplat": "Trained Gaussian splats: convert to .sog with SplatTransform and import in the Gaussian viewer (Lab 8).",
  ".e57": "E57 isn't supported yet; export the scan as .las.",
};

/** CSV roles recognised from the file name. */
const CSV_NAME_PATTERNS: [UploadRole, RegExp][] = [
  ["control_points", /control[ _-]?points?|\bgcps?\b/],
  ["gnss", /gnss|\bgps\b/],
  ["poses", /pose|trajectory|odom/],
];

const ROLE_NAMES: Record<UploadRole, string> = {
  pointcloud: "LAS point cloud",
  poses: "poses CSV",
  project: "project JSON",
  control_points: "control points CSV",
  gnss: "GNSS CSV",
};

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

function isSystemFile(name: string): boolean {
  return name.startsWith(".") || name.toLowerCase() === "thumbs.db" || name.toLowerCase() === "desktop.ini";
}

/** Initial plan for the picked files. */
export function planImport(files: File[]): ImportCandidate[] {
  const candidates: (ImportCandidate & { guess: UploadRole | null })[] = files
    .filter((file) => !isSystemFile(file.name))
    .map((file) => {
      const extension = extensionOf(file.name);
      const empty = file.size === 0 && extension in ROLES_BY_EXTENSION;
      // An empty file can't take any role.
      const allowedRoles = empty ? [] : (ROLES_BY_EXTENSION[extension] ?? []);
      let guess: UploadRole | null = null;
      let note: string | null = null;

      if (empty) {
        note =
          extension === ".las"
            ? "Empty file (0 bytes): not a valid point cloud."
            : "Empty file (0 bytes): will be skipped.";
      } else if (UNSUPPORTED[extension]) {
        note = UNSUPPORTED[extension];
      } else if (allowedRoles.length === 0) {
        note = "Not a supported file type; not imported.";
      } else if (extension === ".csv") {
        const name = file.name.toLowerCase();
        guess = CSV_NAME_PATTERNS.find(([, pattern]) => pattern.test(name))?.[0] ?? null;
        if (!guess) note = "CSV not recognised from its name; choose a role if it should be imported.";
      } else {
        guess = allowedRoles[0];
      }

      const path = file.webkitRelativePath || file.name;
      const unrecognised = extension === ".csv" && !guess && !empty;
      return { file, path, role: "ignore", allowedRoles, note, ambiguousRole: null, unrecognised, empty, guess };
    });

  // Assign each role only if exactly one file claims it.
  for (const rule of UPLOAD_ROLES) {
    const claimants = candidates.filter((c) => c.guess === rule.role);
    if (claimants.length === 1) {
      claimants[0].role = rule.role;
    } else if (claimants.length > 1) {
      for (const c of claimants) {
        c.ambiguousRole = rule.role;
        c.note = `Ambiguous: one of ${claimants.length} candidate ${ROLE_NAMES[rule.role]} files.`;
      }
    }
  }

  // Show paths relative to the picked folder (its name is already the dataset name).
  const root = candidates[0]?.path.split("/")[0];
  const sharedRoot = !!root && candidates.every((c) => c.path.startsWith(`${root}/`));

  return candidates
    .map(({ guess: _guess, ...candidate }) => ({
      ...candidate,
      path: sharedRoot ? candidate.path.slice(root.length + 1) : candidate.path,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function countPhrase(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

/** Summary, problems and warnings for the current assignment. */
export function describePlan(candidates: ImportCandidate[]): ImportPlanStatus {
  if (candidates.length === 0) {
    return { summary: "No usable files found.", problems: ["Choose a folder or files that include a .las point cloud."], warnings: [], ready: false };
  }
  const assigned = (role: UploadRole) => candidates.filter((c) => c.role === role);
  const problems: string[] = [];
  const warnings: string[] = [];

  for (const rule of UPLOAD_ROLES) {
    const files = assigned(rule.role);
    if (files.length > 1) {
      problems.push(
        `${files.length} files are set as ${ROLE_NAMES[rule.role]} (${files.map((f) => f.path).join(", ")}); keep one.`,
      );
    }
  }

  const lasFiles = candidates.filter((c) => c.allowedRoles.includes("pointcloud"));
  const emptyLas = candidates.filter((c) => c.empty && c.path.toLowerCase().endsWith(".las"));
  if (assigned("pointcloud").length === 0) {
    problems.push(
      lasFiles.length > 1
        ? `Found ${lasFiles.length} LAS files; choose which one is the point cloud.`
        : emptyLas.length > 0
          ? `${emptyLas.map((c) => c.path).join(", ")} is empty (0 bytes); a valid .las point cloud is required.`
          : "No .las point cloud found.",
    );
  }

  // Empty optional files don't stop the import; they're skipped.
  for (const c of candidates) {
    if (c.empty && !emptyLas.includes(c)) warnings.push(`${c.path} is empty and will be skipped.`);
  }
  if (assigned("pointcloud").length > 0 && assigned("project").length === 0) {
    warnings.push(
      "No project.json: project metadata will be inferred from the LAS header, and the coordinate " +
        "reference system may be unknown (treated as a local frame in metres).",
    );
  }

  // Optional roles with several candidates and none chosen yet: allowed, but said out loud.
  for (const rule of UPLOAD_ROLES) {
    if (rule.role === "pointcloud" || assigned(rule.role).length > 0) continue;
    const competing = candidates.filter((c) => c.ambiguousRole === rule.role);
    if (competing.length > 1) {
      warnings.push(
        `Found ${competing.length} candidate ${ROLE_NAMES[rule.role]} files ` +
          `(${competing.map((c) => c.path).join(", ")}); none will be imported unless you choose one.`,
      );
    }
  }
  const unknownCsv = candidates.filter((c) => c.role === "ignore" && c.unrecognised);
  if (unknownCsv.length > 0) {
    warnings.push(`${countPhrase(unknownCsv.length, "CSV file")} not recognised and not imported unless you assign a role.`);
  }

  // "Found": files assigned to a role plus unresolved candidates competing for it.
  const found = (role: UploadRole) =>
    candidates.filter((c) => c.role === role || (c.role === "ignore" && c.ambiguousRole === role)).length;
  const optionalMetadata = found("control_points") + found("gnss");
  const parts = [
    countPhrase(found("pointcloud"), "LAS point cloud"),
    countPhrase(found("poses"), "poses CSV"),
    countPhrase(found("project"), "project JSON"),
  ];
  const ignored = candidates.filter((c) => c.role === "ignore").length;
  const summary =
    `Found ${parts.join(", ")}, and ${countPhrase(optionalMetadata, "optional metadata file")}.` +
    (ignored > 0 ? ` ${countPhrase(ignored, "file")} won't be imported.` : "");

  return { summary, problems, warnings, ready: problems.length === 0 };
}

"""
Gaussian splat scenes (Lab 8): trained 3D Gaussian splats, viewed with the
official SuperSplat Viewer. A separate store from the LiDAR datasets; a splat
file is never read as a LAS point cloud.

    spatial-data/splats/<spl_id>/
        metadata.json       see new_metadata
        source/             the original upload, never modified
            scene.ply | scene.compressed.ply | scene.sog | original.zip
            package/<relative paths>        a SOG folder, structure preserved
        converted/          only for .zip uploads: the scene extracted from it
            scene.ply | scene.compressed.ply | scene.sog | package/<relative paths>

Supported scenes (all loaded by the viewer directly, no format conversion):
    ply             trained Gaussian PLY (binary little-endian, 3DGS properties)
    compressed-ply  SuperSplat compressed PLY (.compressed.ply)
    sog             bundled SOG: one .sog file (a zip of meta.json + WebP images)
    sog-folder      unbundled SOG: meta.json + the WebP images it lists
    sog-lod         streaming LOD SOG: lod-meta.json + chunk folders (N_M/meta.json + WebP)

Only the files a scene's manifest references are served (metadata "files"),
from the folder named by "servedFrom". Paths inside packages are validated
segment by segment; client file names are display text only.
"""

import json
import posixpath
import re
import secrets
import shutil
import zipfile
from pathlib import Path
from typing import Any, Callable, Optional

from storage import DATA_DIR, now_iso
from uploads import UploadError

SPLATS_DIR = DATA_DIR / "splats"
SPLAT_ID_PATTERN = re.compile(r"^spl_[0-9a-f]{12}$")
METADATA_SCHEMA_VERSION = 1

MiB = 1024 * 1024
GiB = 1024 * MiB
COPY_CHUNK = 4 * MiB
MAX_SINGLE_FILE = 4 * GiB          # one .ply / .sog / .zip upload
MAX_PACKAGE_BYTES = 4 * GiB        # a SOG folder, or everything extracted from a zip
MAX_PACKAGE_FILES = 2000
MAX_PATH_DEPTH = 6
LICENSE_NAMES = ("license.txt", "LICENSE.txt", "LICENSE", "SPLAT-LICENSE.txt")
MAX_LICENSE_BYTES = 8 * 1024

# Files a SOG package may contain; anything else in a folder is ignored.
PACKAGE_EXTENSIONS = {".json", ".webp", ".sog", ".txt"}
PATH_SEGMENT = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9 ._()+-]{0,119}$")

FORMAT_LABELS = {
    "ply": "Gaussian PLY",
    "compressed-ply": "Compressed Gaussian PLY",
    "sog": "SOG (single .sog file)",
    "sog-folder": "SOG (folder: meta.json + WebP)",
    "sog-lod": "SOG with levels of detail (lod-meta.json)",
}

# Formats the official viewer can't open; SplatTransform converts them.
CONVERT_HINT = (
    "Convert it with SplatTransform first, e.g. "
    "`npx @playcanvas/splat-transform scene{ext} scene.sog`, and import the .sog."
)
CONVERTIBLE = {".splat", ".ksplat", ".spz", ".lcc"}
NOT_SPLATS = {
    ".las": "LAS files are LiDAR point clouds: import them in the LiDAR viewer.",
    ".laz": "LAZ files are LiDAR point clouds: decompress to .las and import them in the LiDAR viewer.",
    ".obj": "Meshes aren't supported yet.",
    ".glb": "Meshes aren't supported yet.",
    ".html": "This is a viewer page, not a scene. Import the scene file (.sog, .ply or the SOG folder).",
}


def new_splat_id() -> str:
    return "spl_" + secrets.token_hex(6)


def splat_dir(splat_id: str) -> Path:
    """The folder of a scene. Raises ValueError for anything that isn't a valid id."""
    if not SPLAT_ID_PATTERN.match(splat_id):
        raise ValueError("invalid scene id")
    path = (SPLATS_DIR / splat_id).resolve()
    if path.parent != SPLATS_DIR.resolve():
        raise ValueError("invalid scene id")
    return path


def new_metadata(splat_id: str, name: str) -> dict[str, Any]:
    return {
        "schemaVersion": METADATA_SCHEMA_VERSION,
        "id": splat_id,
        "name": name,
        "kind": "gaussian-scene",
        "createdAt": now_iso(),
        "format": None,                 # see FORMAT_LABELS
        "formatLabel": None,
        "splatCount": None,             # from the PLY header or the SOG manifest
        "shBands": None,                # spherical-harmonic bands beyond the base colour (0..3)
        "lodLevels": None,              # sog-lod only
        # What was uploaded: {"kind": "file" | "folder" | "zip", "filename", "bytes", "fileCount"}
        "source": {},
        "servedFrom": "source",         # "source" | "converted"
        "entry": None,                  # the file the viewer opens, relative to servedFrom
        "files": [],                    # [{"path", "bytes"}]: everything the viewer may fetch
        "sceneBytes": 0,
        "conversion": None,             # set when the scene had to be extracted from a zip
        "license": None,                # license.txt shipped with the scene (attribution!)
        # 2nd-98th percentile box of the splat centres, file frame (splat_bounds.py):
        # {"min", "max", "percentiles", "sampledCentres"}; frames the viewer's start view.
        "robustBounds": None,
        "warnings": [],
        # A trained scene has its own arbitrary frame (often the camera solver's):
        # never assumed to match a LiDAR capture. Alignment is future work.
        "frame": {"units": "unknown (as trained)", "upAxis": "as trained (not converted)", "alignedTo": None},
    }


def read_metadata(splat_id: str) -> Optional[dict[str, Any]]:
    path = splat_dir(splat_id) / "metadata.json"
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def write_metadata(splat_id: str, metadata: dict[str, Any]) -> None:
    folder = splat_dir(splat_id)
    tmp = folder / ".metadata.tmp"
    tmp.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    tmp.replace(folder / "metadata.json")


def list_metadata() -> list[dict[str, Any]]:
    if not SPLATS_DIR.is_dir():
        return []
    result = []
    for entry in sorted(SPLATS_DIR.iterdir()):
        if SPLAT_ID_PATTERN.match(entry.name) and (metadata := read_metadata(entry.name)):
            result.append(metadata)
    return sorted(result, key=lambda m: m.get("createdAt", ""))


def delete_splat(splat_id: str) -> None:
    shutil.rmtree(splat_dir(splat_id))


def served_file(metadata: dict[str, Any], relative: str) -> Optional[Path]:
    """The path of a file the viewer may fetch, or None (whitelist: listed in metadata only)."""
    if relative not in {f["path"] for f in metadata.get("files", [])}:
        return None
    root = (splat_dir(metadata["id"]) / metadata["servedFrom"]).resolve()
    path = (root / relative).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        return None
    return path


# ---------------------------------------------------------------------------
# Paths inside packages


def clean_relative_path(raw: str) -> Optional[str]:
    """
    A safe relative path ("0_0/meta.json"), or None for files to skip silently
    (hidden files, macOS resource forks). Raises UploadError for unsafe paths.
    """
    parts = raw.replace("\\", "/").split("/")
    if raw.startswith("/") or any(p in ("", ".", "..") for p in parts) or len(parts) > MAX_PATH_DEPTH:
        raise UploadError(f"Unsupported path in the package: \"{raw[:120]}\".")
    if any(p.startswith(".") or p == "__MACOSX" for p in parts):
        return None
    for part in parts:
        if not PATH_SEGMENT.match(part):
            raise UploadError(f"Unsupported file or folder name in the package: \"{part[:120]}\".")
    return "/".join(parts)


def resolve_reference(base_file: str, reference: Any) -> str:
    """A path referenced by a manifest, relative to that manifest's folder; must stay inside the package."""
    if not isinstance(reference, str) or not reference:
        raise UploadError(f"{base_file}: a referenced file name is not a string.")
    joined = posixpath.normpath(posixpath.join(posixpath.dirname(base_file), reference))
    if joined.startswith("../") or joined == ".." or joined.startswith("/"):
        raise UploadError(f"{base_file}: \"{reference}\" points outside the package.")
    return joined


def common_root(paths: list[str]) -> str:
    """The folder all paths share ("" if none), e.g. the folder name the browser prefixes."""
    first = paths[0].split("/")[:-1]
    depth = len(first)
    for path in paths[1:]:
        parts = path.split("/")[:-1]
        depth = min(depth, len(parts))
        while depth and parts[:depth] != first[:depth]:
            depth -= 1
    return "/".join(first[:depth])


# ---------------------------------------------------------------------------
# PLY


PLY_TYPE_SIZES = {
    "char": 1, "int8": 1, "uchar": 1, "uint8": 1,
    "short": 2, "int16": 2, "ushort": 2, "uint16": 2,
    "int": 4, "int32": 4, "uint": 4, "uint32": 4,
    "float": 4, "float32": 4, "double": 8, "float64": 8,
}
GAUSSIAN_PROPERTIES = {"x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", "opacity",
                       "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"}
SH_BANDS_BY_REST = {0: 0, 9: 1, 24: 2, 45: 3}  # f_rest_* count -> extra SH bands


def parse_ply_header(head: bytes, label: str) -> tuple[Optional[str], int, list[dict[str, Any]]]:
    """(format, header length in bytes, elements with their scalar property names and types)."""
    if not head.startswith(b"ply"):
        raise UploadError(f"{label}: not a PLY file (missing the \"ply\" signature).")
    end = head.find(b"end_header")
    if end < 0:
        raise UploadError(f"{label}: PLY header not found in the first {len(head) // 1024} KB.")
    newline = head.find(b"\n", end)
    header_length = newline + 1 if newline >= 0 else len(head)
    lines = head[:end].decode("ascii", errors="replace").splitlines()

    fmt = None
    elements: list[dict[str, Any]] = []
    for line in lines[1:]:
        words = line.split()
        if not words:
            continue
        if words[0] == "format" and len(words) >= 2:
            fmt = words[1]
        elif words[0] == "element" and len(words) == 3 and words[2].isdigit():
            elements.append({"name": words[1], "count": int(words[2]), "properties": [], "hasList": False})
        elif words[0] == "property" and elements:
            if len(words) >= 2 and words[1] == "list":
                elements[-1]["hasList"] = True
                elements[-1]["properties"].append(words[-1])
            elif len(words) == 3 and words[1] in PLY_TYPE_SIZES:
                elements[-1]["properties"].append(words[2])
                elements[-1].setdefault("types", []).append(words[1])
                elements[-1].setdefault("stride", 0)
                elements[-1]["stride"] += PLY_TYPE_SIZES[words[1]]
            else:
                raise UploadError(f"{label}: unreadable PLY property line \"{line[:80]}\".")
    return fmt, header_length, elements


def inspect_ply(head: bytes, total_bytes: int, label: str) -> dict[str, Any]:
    """
    Classify a PLY from its header: a trained Gaussian splat (or SuperSplat's
    compressed variant), or an ordinary point cloud / mesh (rejected). Checks
    that the file is as long as its header says.
    """
    fmt, header_length, elements = parse_ply_header(head, label)
    by_name = {e["name"]: e for e in elements}
    vertex = by_name.get("vertex")
    props = set(vertex["properties"]) if vertex else set()
    if vertex and GAUSSIAN_PROPERTIES <= props:
        kind = "ply"
        rest = sum(1 for p in props if p.startswith("f_rest_"))
        sh_bands = SH_BANDS_BY_REST.get(rest)
    elif vertex and "chunk" in by_name and "packed_position" in props:
        kind = "compressed-ply"
        sh = by_name.get("sh")
        sh_bands = SH_BANDS_BY_REST.get(len(sh["properties"])) if sh else 0
    else:
        listed = ", ".join(sorted(props)[:8]) or "none"
        raise UploadError(
            f"{label}: this PLY is an ordinary point cloud or mesh (vertex properties: {listed}), not a "
            "trained Gaussian splat, which has f_dc_0, opacity, scale_0 and rot_0 per splat. "
            "LiDAR point clouds are imported as .las in the LiDAR viewer."
        )
    if fmt != "binary_little_endian":
        raise UploadError(
            f"{label}: Gaussian PLY in \"{fmt}\" format; the viewer reads binary little-endian PLY only. "
            "Re-export it as binary, or convert it with SplatTransform "
            "(`npx @playcanvas/splat-transform scene.ply scene.sog`)."
        )
    if any(e["hasList"] for e in elements):
        raise UploadError(f"{label}: unexpected list properties (mesh faces?) in a Gaussian PLY.")
    if vertex["count"] == 0:
        raise UploadError(f"{label}: the PLY contains no splats.")

    expected = header_length + sum(e["count"] * e.get("stride", 0) for e in elements)
    if total_bytes < expected:
        raise UploadError(
            f"{label}: the file is truncated: its header declares {vertex['count']:,} splats "
            f"({expected:,} bytes) but it has {total_bytes:,} bytes. Download it again."
        )
    warnings = []
    if total_bytes > expected:
        warnings.append(f"{label}: {total_bytes - expected:,} unexpected bytes after the splat data (ignored).")
    return {"format": kind, "splatCount": vertex["count"], "shBands": sh_bands, "warnings": warnings}


def ply_name(kind: str) -> str:
    return "scene.compressed.ply" if kind == "compressed-ply" else "scene.ply"


# ---------------------------------------------------------------------------
# SOG


SOG_REQUIRED = ("means", "scales", "quats", "sh0")


def sog_meta_files(meta_path: str, meta: Any) -> tuple[int, int, list[str]]:
    """(splat count, SH bands, referenced files) of one SOG meta.json."""
    if not isinstance(meta, dict):
        raise UploadError(f"{meta_path}: not a SOG manifest (expected a JSON object).")
    count = meta.get("count")
    if not isinstance(count, int) or count <= 0:
        raise UploadError(f"{meta_path}: no valid splat \"count\"; this doesn't look like a SOG manifest.")
    missing_keys = [k for k in SOG_REQUIRED if not isinstance(meta.get(k), dict)]
    if missing_keys:
        raise UploadError(f"{meta_path}: SOG manifest without {', '.join(missing_keys)}.")
    files: list[str] = []
    for value in meta.values():
        if isinstance(value, dict) and isinstance(value.get("files"), list):
            files += [resolve_reference(meta_path, name) for name in value["files"]]
    for name in files:
        if not name.endswith(".webp"):
            raise UploadError(f"{meta_path}: expected WebP images, found \"{name}\".")
    sh_n = meta.get("shN")
    bands = sh_n.get("bands", 0) if isinstance(sh_n, dict) else 0
    return count, bands if isinstance(bands, int) else 0, files


def inspect_sog_package(
    names: dict[str, int],
    read: Callable[[str, int], bytes],
    label: str,
) -> dict[str, Any]:
    """
    Validate a SOG package given its files ({relative path: bytes}) and a
    reader (path, max bytes). The entry is lod-meta.json if present, else
    meta.json. Every referenced file must exist; WebP signatures are checked.
    """
    def load_json(path: str) -> Any:
        if path not in names:
            raise UploadError(f"{label}: incomplete package: \"{path}\" is missing.")
        try:
            return json.loads(read(path, 50 * MiB).decode("utf-8-sig"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise UploadError(f"{label}: \"{path}\" is not valid JSON ({error}).") from error

    referenced: list[str] = []
    if "lod-meta.json" in names:
        entry, fmt = "lod-meta.json", "sog-lod"
        lod = load_json(entry)
        filenames = lod.get("filenames") if isinstance(lod, dict) else None
        if not isinstance(filenames, list) or not filenames or not isinstance(lod.get("count"), int):
            raise UploadError(f"{label}: lod-meta.json has no \"filenames\" / \"count\"; not a SOG LOD manifest.")
        chunk_files = [resolve_reference(entry, f) for f in filenames]
        if isinstance(lod.get("environment"), str):
            chunk_files.append(resolve_reference(entry, lod["environment"]))
        count, bands = lod["count"], 0
        lod_levels = lod.get("lodLevels") if isinstance(lod.get("lodLevels"), int) else None
        for chunk in chunk_files:
            referenced.append(chunk)
            if chunk.endswith(".sog"):
                continue  # bundled chunk; checked for existence below
            _, chunk_bands, files = sog_meta_files(chunk, load_json(chunk))
            bands = max(bands, chunk_bands)
            referenced += files
    elif "meta.json" in names:
        entry, fmt, lod_levels = "meta.json", "sog-folder", None
        count, bands, files = sog_meta_files(entry, load_json(entry))
        referenced += files
    else:
        raise UploadError(
            f"{label}: no SOG manifest found. A SOG folder contains meta.json (or lod-meta.json for "
            "levels of detail) next to its WebP images."
        )

    referenced = list(dict.fromkeys([entry] + referenced))
    missing = [path for path in referenced if path not in names]
    if missing:
        shown = ", ".join(missing[:6]) + (f" and {len(missing) - 6} more" if len(missing) > 6 else "")
        raise UploadError(f"{label}: incomplete SOG package: {len(missing)} referenced file(s) missing: {shown}.")
    for path in referenced:
        if path.endswith(".webp"):
            head = read(path, 12)
            if head[:4] != b"RIFF" or head[8:12] != b"WEBP":
                raise UploadError(f"{label}: \"{path}\" is not a WebP image.")
        elif path.endswith(".sog"):
            if read(path, 4) != b"PK\x03\x04":
                raise UploadError(f"{label}: \"{path}\" is not a .sog archive.")

    ignored = sorted(set(names) - set(referenced) - set(LICENSE_NAMES))
    warnings = [f"{label}: ignored {len(ignored)} file(s) not referenced by the manifest: "
                + ", ".join(ignored[:5]) + ("…" if len(ignored) > 5 else "")] if ignored else []
    return {
        "format": fmt, "entry": entry, "splatCount": count, "shBands": bands, "lodLevels": lod_levels,
        "files": [{"path": p, "bytes": names[p]} for p in referenced], "warnings": warnings,
    }


def inspect_sog_file(path: Path, label: str) -> dict[str, Any]:
    """A bundled .sog: a zip with meta.json at its root. Inspected without extracting."""
    try:
        with zipfile.ZipFile(path) as archive:
            infos = {i.filename: i for i in archive.infolist() if not i.is_dir()}
            if any(i.flag_bits & 0x1 for i in infos.values()):
                raise UploadError(f"{label}: encrypted archives aren't supported.")

            def read(name: str, limit: int) -> bytes:
                with archive.open(infos[name]) as f:
                    return f.read(limit)

            result = inspect_sog_package({n: i.file_size for n, i in infos.items()}, read, label)
            license_text = next((read(n, MAX_LICENSE_BYTES) for n in LICENSE_NAMES if n in infos), None)
    except zipfile.BadZipFile as error:
        raise UploadError(f"{label}: not a valid .sog file (it should be a zip archive).") from error
    if result["format"] != "sog-folder":
        raise UploadError(f"{label}: a .sog file must have meta.json at its root.")
    result.update(format="sog", license=decode_license(license_text))
    return result


def decode_license(raw: Optional[bytes]) -> Optional[str]:
    if not raw:
        return None
    return raw.decode("utf-8", errors="replace").strip()[:MAX_LICENSE_BYTES] or None


def find_license(root: Path) -> Optional[str]:
    for name in LICENSE_NAMES:
        path = root / name
        if path.is_file():
            with open(path, "rb") as f:
                return decode_license(f.read(MAX_LICENSE_BYTES))
    return None


def package_root(names: list[str], label: str) -> str:
    """
    The folder holding the package manifest: the shallowest lod-meta.json,
    else the shallowest meta.json ("" = top level). LOD chunk folders also
    contain meta.json files, which is why lod-meta.json wins.
    """
    for manifest in ("lod-meta.json", "meta.json"):
        found = sorted((n for n in names if posixpath.basename(n) == manifest), key=lambda n: n.count("/"))
        if found:
            return posixpath.dirname(found[0])
    raise UploadError(
        f"{label}: no SOG manifest found. A SOG folder contains meta.json (or lod-meta.json for "
        "levels of detail) next to its WebP images."
    )


def inspect_folder(root: Path, label: str) -> dict[str, Any]:
    """
    A SOG package stored on disk under `root` (an uploaded folder, or one
    extracted from a zip), possibly in a subfolder (e.g. public/splat/).
    Returned paths are relative to `root`.
    """
    names = {p.relative_to(root).as_posix(): p.stat().st_size for p in root.rglob("*") if p.is_file()}
    base = package_root(list(names), label)
    prefix = base + "/" if base else ""
    package = {n[len(prefix):]: size for n, size in names.items() if n.startswith(prefix)}

    def read(name: str, limit: int) -> bytes:
        with open(root / (prefix + name), "rb") as f:
            return f.read(limit)

    result = inspect_sog_package(package, read, label)
    result["files"] = [{"path": prefix + f["path"], "bytes": f["bytes"]} for f in result["files"]]
    result["entry"] = prefix + result["entry"]
    result["license"] = find_license(root / base) or find_license(root)
    return result


def read_head(path: Path, size: int = 64 * 1024) -> bytes:
    with open(path, "rb") as f:
        return f.read(size)


# ---------------------------------------------------------------------------
# Imports


# Single-file uploads: extension -> fixed storage name in source/.
SINGLE_FILE_NAMES = {
    ".compressed.ply": "scene.compressed.ply",
    ".ply": "scene.ply",
    ".sog": "scene.sog",
    ".zip": "original.zip",
}


def single_file_kind(filename: str) -> str:
    """The import kind of a single uploaded file, from its extension; helpful errors otherwise."""
    lower = filename.lower()
    for extension in SINGLE_FILE_NAMES:
        if lower.endswith(extension):
            return extension
    extension = Path(lower).suffix
    shown = Path(filename).name[:120]
    if extension in CONVERTIBLE:
        raise UploadError(f"\"{shown}\": the viewer can't open {extension} scenes. " + CONVERT_HINT.format(ext=extension))
    if extension in NOT_SPLATS:
        raise UploadError(f"\"{shown}\": {NOT_SPLATS[extension]}")
    if extension in (".json", ".webp"):
        raise UploadError(
            f"\"{shown}\" is one part of a SOG package. Choose the whole folder (with meta.json or "
            "lod-meta.json), or a .zip of it."
        )
    raise UploadError(
        f"\"{shown}\": unsupported file. Import a trained Gaussian .ply, a .sog, a SOG folder, or a .zip of one."
    )


def inspect_single_file(folder: Path, kind: str, label: str) -> tuple[dict[str, Any], str]:
    """Inspect a saved single-file upload. Returns (result, servedFrom)."""
    source = folder / "source"
    path = source / SINGLE_FILE_NAMES[kind]
    if kind in (".ply", ".compressed.ply"):
        size = path.stat().st_size
        result = inspect_ply(read_head(path), size, label)
        name = ply_name(result["format"])  # the header decides, not the extension
        if name != path.name:
            path.rename(source / name)
        result.update(entry=name, files=[{"path": name, "bytes": size}])
        return result, "source"
    if kind == ".sog":
        result = inspect_sog_file(path, label)
        result.update(entry="scene.sog", files=[{"path": "scene.sog", "bytes": path.stat().st_size}])
        return result, "source"
    return extract_zip(path, folder / "converted", label), "converted"


def inspect_uploaded_folder(folder: Path, label: str) -> tuple[dict[str, Any], str]:
    """Inspect a SOG folder saved under source/package/. Returns (result, servedFrom)."""
    result = inspect_folder(folder / "source" / "package", label)
    result["files"] = [{"path": f"package/{f['path']}", "bytes": f["bytes"]} for f in result["files"]]
    result["entry"] = f"package/{result['entry']}"
    return result, "source"


def apply_inspection(metadata: dict[str, Any], result: dict[str, Any], served_from: str) -> None:
    metadata.update(
        format=result["format"],
        formatLabel=FORMAT_LABELS[result["format"]],
        splatCount=result.get("splatCount"),
        shBands=result.get("shBands"),
        lodLevels=result.get("lodLevels"),
        servedFrom=served_from,
        entry=result["entry"],
        files=result["files"],
        sceneBytes=sum(f["bytes"] for f in result["files"]),
        conversion=result.get("conversion"),
        license=result.get("license"),
    )
    metadata["warnings"] += result.get("warnings", [])


# ---------------------------------------------------------------------------
# Zip archives (e.g. a SuperSplat download): extracted into converted/


def extract_zip(archive_path: Path, converted: Path, label: str) -> dict[str, Any]:
    """
    Find the scene inside a zip and extract only that: the shallowest
    lod-meta.json / meta.json package (with its folder structure), else a
    single .sog or Gaussian .ply. Paths and sizes are checked before and
    while extracting; nothing is executed.
    """
    try:
        archive = zipfile.ZipFile(archive_path)
    except zipfile.BadZipFile as error:
        raise UploadError(f"{label}: not a valid zip archive.") from error
    with archive:
        infos = {}
        for info in archive.infolist():
            if info.is_dir():
                continue
            if info.flag_bits & 0x1:
                raise UploadError(f"{label}: encrypted archives aren't supported.")
            name = clean_relative_path(info.filename)
            if name is not None:
                infos[name] = info
        if len(infos) > MAX_PACKAGE_FILES:
            raise UploadError(f"{label}: more than {MAX_PACKAGE_FILES} files.")

        has_manifest = any(posixpath.basename(n) in ("lod-meta.json", "meta.json") for n in infos)
        sogs = [n for n in infos if n.endswith(".sog")]
        plys = [n for n in infos if n.lower().endswith(".ply")]

        if has_manifest:
            root = package_root(list(infos), label)
            prefix = root + "/" if root else ""
            members = {n[len(prefix):]: i for n, i in infos.items()
                       if n.startswith(prefix) and posixpath.splitext(n)[1].lower() in PACKAGE_EXTENSIONS}
            target = converted / "package"
            description = f"SOG package{f' in folder {root}' if root else ''}"
        elif len(sogs) == 1 and not plys:
            members, target = {"scene.sog": infos[sogs[0]]}, converted
            description = f".sog file {sogs[0]}"
        elif len(plys) == 1 and not sogs:
            members, target = {"scene.ply": infos[plys[0]]}, converted
            description = f"PLY file {plys[0]}"
        else:
            found = ", ".join(sorted(infos)[:8]) or "nothing"
            raise UploadError(
                f"{label}: no single Gaussian scene in this zip (expected a SOG folder with meta.json or "
                f"lod-meta.json, one .sog, or one .ply). Found: {found}."
            )

        declared = sum(i.file_size for i in members.values())
        if declared > MAX_PACKAGE_BYTES:
            raise UploadError(f"{label}: the scene inside is larger than {MAX_PACKAGE_BYTES // GiB} GiB.")
        for name, info in members.items():
            destination = (target / name).resolve()
            if not destination.is_relative_to(target.resolve()):
                raise UploadError(f"{label}: unsafe path \"{name}\".")
            destination.parent.mkdir(parents=True, exist_ok=True)
            written = 0
            with archive.open(info) as source, open(destination, "wb") as out:
                while chunk := source.read(COPY_CHUNK):
                    written += len(chunk)
                    if written > info.file_size:  # the archive lied about the size
                        raise UploadError(f"{label}: \"{name}\" is larger than the archive declares.")
                    out.write(chunk)
        license_text = next((decode_license(archive.read(infos[n])[:MAX_LICENSE_BYTES])
                             for n in infos if posixpath.basename(n) in LICENSE_NAMES
                             and infos[n].file_size <= MAX_LICENSE_BYTES), None)

    if target.name == "package":
        result = inspect_folder(target, label)
        result["files"] = [{"path": f"package/{f['path']}", "bytes": f["bytes"]} for f in result["files"]]
        result["entry"] = f"package/{result['entry']}"
    elif "scene.sog" in members:
        result = inspect_sog_file(converted / "scene.sog", label)
        result.update(entry="scene.sog", files=[{"path": "scene.sog", "bytes": declared}])
    else:
        path = converted / "scene.ply"
        result = inspect_ply(read_head(path), path.stat().st_size, label)
        name = ply_name(result["format"])
        if name != "scene.ply":
            path.rename(converted / name)
        result.update(entry=name, files=[{"path": name, "bytes": declared}])
    result["license"] = result.get("license") or license_text
    result["conversion"] = {"step": "extracted from zip", "detail": f"{description} extracted to converted/"}
    return result

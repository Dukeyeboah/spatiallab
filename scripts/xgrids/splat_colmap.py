"""
Lab 14A: minimal COLMAP model reader/writer (text and binary), PINHOLE only.

Formats: https://colmap.github.io/format.html. Images carry no 2D points and
3D points carry no tracks: poses come from the scanner, not from feature
matching, and the 3D points are LiDAR samples used only to initialise
Gaussians. Nerfstudio's COLMAP parser accepts this (max_2D_matches_per_3D_point
defaults to 0, so tracks are never read).
"""

from __future__ import annotations

import struct
from dataclasses import dataclass
from pathlib import Path

import numpy as np

PINHOLE_MODEL_ID = 1


@dataclass
class Camera:
    camera_id: int
    width: int
    height: int
    params: tuple[float, float, float, float]   # fx, fy, cx, cy (COLMAP pixel convention)


@dataclass
class Image:
    image_id: int
    qvec: tuple[float, float, float, float]      # w, x, y, z of R_world→camera
    tvec: tuple[float, float, float]
    camera_id: int
    name: str


def write_model(folder: Path, cameras: list[Camera], images: list[Image], xyz: np.ndarray, rgb: np.ndarray) -> None:
    """cameras/images/points3D in both .txt and .bin (identical content)."""
    folder.mkdir(parents=True, exist_ok=False)
    xyz = np.asarray(xyz, np.float64).reshape(-1, 3)
    rgb = np.asarray(rgb, np.uint8).reshape(-1, 3)

    with open(folder / "cameras.txt", "w") as f:
        f.write("# Camera list with one line of data per camera:\n#   CAMERA_ID, MODEL, WIDTH, HEIGHT, PARAMS[]\n")
        f.write(f"# Number of cameras: {len(cameras)}\n")
        for c in cameras:
            f.write(f"{c.camera_id} PINHOLE {c.width} {c.height} " + " ".join(repr(float(p)) for p in c.params) + "\n")
    with open(folder / "cameras.bin", "wb") as f:
        f.write(struct.pack("<Q", len(cameras)))
        for c in cameras:
            f.write(struct.pack("<iiQQ", c.camera_id, PINHOLE_MODEL_ID, c.width, c.height))
            f.write(struct.pack("<4d", *c.params))

    with open(folder / "images.txt", "w") as f:
        f.write("# Image list with two lines of data per image:\n"
                "#   IMAGE_ID, QW, QX, QY, QZ, TX, TY, TZ, CAMERA_ID, NAME\n#   POINTS2D[] as (X, Y, POINT3D_ID)\n")
        f.write(f"# Number of images: {len(images)}, mean observations per image: 0\n")
        for im in images:
            f.write(f"{im.image_id} " + " ".join(repr(float(v)) for v in (*im.qvec, *im.tvec)) + f" {im.camera_id} {im.name}\n\n")
    with open(folder / "images.bin", "wb") as f:
        f.write(struct.pack("<Q", len(images)))
        for im in images:
            f.write(struct.pack("<i7di", im.image_id, *im.qvec, *im.tvec, im.camera_id))
            f.write(im.name.encode("utf-8") + b"\0")
            f.write(struct.pack("<Q", 0))

    with open(folder / "points3D.txt", "w") as f:
        f.write("# 3D point list with one line of data per point:\n"
                "#   POINT3D_ID, X, Y, Z, R, G, B, ERROR, TRACK[] as (IMAGE_ID, POINT2D_IDX)\n")
        f.write(f"# Number of points: {len(xyz)}, mean track length: 0\n")
        f.writelines(f"{i + 1} {p[0]!r} {p[1]!r} {p[2]!r} {c[0]} {c[1]} {c[2]} 0\n" for i, (p, c) in enumerate(zip(xyz.tolist(), rgb.tolist())))
    record = np.dtype([("id", "<u8"), ("xyz", "<f8", 3), ("rgb", "u1", 3), ("error", "<f8"), ("track", "<u8")])
    points = np.zeros(len(xyz), dtype=record)
    points["id"] = np.arange(1, len(xyz) + 1)
    points["xyz"], points["rgb"] = xyz, rgb
    with open(folder / "points3D.bin", "wb") as f:
        f.write(struct.pack("<Q", len(xyz)))
        f.write(points.tobytes())


def read_cameras_bin(path: Path) -> dict[int, Camera]:
    data, out = path.read_bytes(), {}
    (n,), offset = struct.unpack_from("<Q", data), 8
    for _ in range(n):
        cid, model, w, h = struct.unpack_from("<iiQQ", data, offset)
        offset += 24
        if model != PINHOLE_MODEL_ID:
            raise ValueError(f"camera {cid}: model id {model}, expected PINHOLE ({PINHOLE_MODEL_ID})")
        out[cid] = Camera(cid, w, h, struct.unpack_from("<4d", data, offset))
        offset += 32
    if offset != len(data):
        raise ValueError(f"{path}: {len(data) - offset} trailing bytes")
    return out


def read_images_bin(path: Path) -> dict[int, Image]:
    data, out = path.read_bytes(), {}
    (n,), offset = struct.unpack_from("<Q", data), 8
    for _ in range(n):
        values = struct.unpack_from("<i7di", data, offset)
        offset += 64
        end = data.index(b"\0", offset)
        name = data[offset:end].decode("utf-8")
        offset = end + 1
        (points,) = struct.unpack_from("<Q", data, offset)
        offset += 8 + points * 24
        out[values[0]] = Image(values[0], values[1:5], values[5:8], values[8], name)
    if offset != len(data):
        raise ValueError(f"{path}: {len(data) - offset} trailing bytes")
    return out


def read_points_bin(path: Path) -> tuple[np.ndarray, np.ndarray]:
    data = path.read_bytes()
    (n,) = struct.unpack_from("<Q", data)
    record = np.dtype([("id", "<u8"), ("xyz", "<f8", 3), ("rgb", "u1", 3), ("error", "<f8"), ("track", "<u8")])
    if len(data) != 8 + n * record.itemsize:
        raise ValueError(f"{path}: size does not match {n} points without tracks")
    points = np.frombuffer(data, dtype=record, offset=8, count=n)
    if points["track"].any():
        raise ValueError(f"{path}: unexpected tracks")
    return points["xyz"].copy(), points["rgb"].copy()


def read_cameras_txt(path: Path) -> dict[int, Camera]:
    out = {}
    for line in path.read_text().splitlines():
        if line.startswith("#") or not line.strip():
            continue
        e = line.split()
        if e[1] != "PINHOLE":
            raise ValueError(f"camera {e[0]}: model {e[1]}, expected PINHOLE")
        out[int(e[0])] = Camera(int(e[0]), int(e[2]), int(e[3]), tuple(float(x) for x in e[4:8]))  # type: ignore[arg-type]
    return out


def read_images_txt(path: Path) -> dict[int, Image]:
    out = {}
    lines = [line for line in path.read_text().splitlines() if not line.startswith("#")]
    for k in range(0, len(lines), 2):
        if not lines[k].strip():
            continue
        e = lines[k].split()
        out[int(e[0])] = Image(int(e[0]), tuple(map(float, e[1:5])), tuple(map(float, e[5:8])), int(e[8]), " ".join(e[9:]))  # type: ignore[arg-type]
    return out


def read_points_txt(path: Path) -> tuple[np.ndarray, np.ndarray]:
    rows = [line.split() for line in path.read_text().splitlines() if line and not line.startswith("#")]
    if any(len(r) != 8 for r in rows):
        raise ValueError(f"{path}: points with tracks")
    xyz = np.array([[float(v) for v in r[1:4]] for r in rows]).reshape(-1, 3)
    rgb = np.array([[int(v) for v in r[4:7]] for r in rows], dtype=np.uint8).reshape(-1, 3)
    return xyz, rgb


def write_ply(path: Path, xyz: np.ndarray, rgb: np.ndarray) -> None:
    """Binary little-endian PLY: float x y z, uchar red green blue."""
    record = np.dtype([("xyz", "<f4", 3), ("rgb", "u1", 3)])
    points = np.zeros(len(xyz), dtype=record)
    points["xyz"], points["rgb"] = xyz, rgb
    header = ("ply\nformat binary_little_endian 1.0\n"
              f"element vertex {len(xyz)}\n"
              "property float x\nproperty float y\nproperty float z\n"
              "property uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n")
    with open(path, "xb") as f:
        f.write(header.encode("ascii"))
        f.write(points.tobytes())

"""
Lab 14A: camera geometry for a Gaussian splatting dataset built from XGRIDS
fisheye frames. Pure NumPy; no file access.

Frames, in the order a LiDAR point travels through them
-------------------------------------------------------
1. LAS (world): original LAS axes, metres, Z up. Scanner poses and the LiDAR
   cloud are both in this frame; nothing here moves or rescales it.
2. Scanner body (poses.csv): v_las = R(q) · v_body + p, q = (x, y, z, w);
   body X forward, Y left, Z up. This is the SCANNER pose, not a camera pose.
3. Fisheye camera frame "F" (Labs 13S–13W): X = optical axis, Y = image left,
   Z = image up. v_body = R_off · v_F with R_off = Rz(−yaw)·Ry(−pitch)·Rx(roll)
   from the calibration experiment (experimental Stage B values).
   Camera centre = p + R(q) · lever_arm; the lever arm is UNKNOWN and set to 0.
4. Fisheye OpenCV frame "cv": x right, y down, z = optical axis, so
   x_cv = −Y_F, y_cv = −Z_F, z_cv = X_F (R_F_CV below, a proper rotation).
5. Virtual pinhole view "view" (OpenCV axes): the fisheye cv frame turned by
   yaw (about cv y, + = right) then pitch (about cv x, + = up). Same optical
   centre as the fisheye: a view is a different crop of the same photo, never
   a new viewpoint.

So   R_las_view = R(q) · R_off · R_F_CV · R_view,   C = p (+ lever arm),
camera-to-world (OpenCV) = [R_las_view | C]; COLMAP stores world-to-camera
R_w2c = R_las_viewᵀ, t = −R_w2c · C, quaternion (w, x, y, z).

Pixels
------
Internally every pixel coordinate is OpenCV's: (0, 0) = centre of the
top-left pixel. COLMAP's convention puts (0, 0) at the top-left CORNER, so a
COLMAP principal point is the OpenCV one + 0.5 (`colmap_intrinsics`).
"""

from __future__ import annotations

import math
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
import camera_calibration as cc  # noqa: E402  (single source of the Lab 13V conventions)

# Columns are the cv axes written in the fisheye frame F.
R_F_CV = np.array([[0.0, 0.0, 1.0],
                   [-1.0, 0.0, 0.0],
                   [0.0, -1.0, 0.0]])


@dataclass(frozen=True)
class PinholeView:
    """A virtual perspective crop of one fisheye image (same optical centre)."""
    name: str
    yaw_deg: float      # + = towards image right
    pitch_deg: float    # + = towards image up
    width: int
    height: int
    hfov_deg: float

    @property
    def focal_px(self) -> float:
        return (self.width / 2) / math.tan(math.radians(self.hfov_deg) / 2)

    @property
    def cx(self) -> float:   # OpenCV convention
        return (self.width - 1) / 2

    @property
    def cy(self) -> float:
        return (self.height - 1) / 2

    @property
    def vfov_deg(self) -> float:
        return math.degrees(2 * math.atan((self.height / 2) / self.focal_px))

    def k_opencv(self) -> np.ndarray:
        return np.array([[self.focal_px, 0, self.cx], [0, self.focal_px, self.cy], [0, 0, 1.0]])


# Layout entries give yaw TOWARDS THE SCANNER'S FORWARD DIRECTION (body +X); the
# signed image yaw per camera comes from `views_for_camera`. The operator and the
# device occupy the backward side of both fisheyes (Lab 14A), so the views lean forward.
# "forward12": one 110° × 94° view turned 12° forward; every pixel ≤ ~1183 px from the
#   fisheye centre (usable radius 1400 px ≈ 83° at f ≈ 961), so no masks.
# "centre": the same view on the optical axis (touches the operator zone).
# "forward12+wing": adds a narrow view further forward that reaches the fisheye edge (masked).
LAYOUTS: dict[str, tuple[PinholeView, ...]] = {
    "forward12": (PinholeView("c", 12.0, 0.0, 1600, 1200, 110.0),),
    "centre": (PinholeView("c", 0.0, 0.0, 1600, 1200, 110.0),),
    "forward12+wing": (
        PinholeView("c", 12.0, 0.0, 1600, 1200, 110.0),
        PinholeView("f", 70.0, 0.0, 800, 1200, 50.0),
    ),
}


def forward_sign(orientation: dict) -> float:
    """+1 if the scanner's forward direction (body +X) is on the image's right, −1 if on its left."""
    right = cc.offset_matrix(orientation["yawDeg"], orientation["pitchDeg"], orientation["rollDeg"]) @ R_F_CV @ np.array([1.0, 0, 0])
    return 1.0 if right[0] >= 0 else -1.0


def views_for_camera(layout: str, orientation: dict) -> list[PinholeView]:
    """The layout's views with yaw signed for this camera (forward-relative → image-relative)."""
    sign = forward_sign(orientation)
    return [PinholeView(v.name, sign * v.yaw_deg, v.pitch_deg, v.width, v.height, v.hfov_deg) for v in LAYOUTS[layout]]


def rot_y(deg: float) -> np.ndarray:
    a = math.radians(deg)
    return np.array([[math.cos(a), 0, math.sin(a)], [0, 1, 0], [-math.sin(a), 0, math.cos(a)]])


def rot_x(deg: float) -> np.ndarray:
    a = math.radians(deg)
    return np.array([[1, 0, 0], [0, math.cos(a), -math.sin(a)], [0, math.sin(a), math.cos(a)]])


def view_rotation(view: PinholeView) -> np.ndarray:
    """R_cv_view: view (OpenCV axes) → fisheye cv frame. Yaw + turns right, pitch + turns up."""
    return rot_y(view.yaw_deg) @ rot_x(view.pitch_deg)


def camera_to_world(position, quaternion_xyzw, orientation: dict, view: PinholeView,
                    lever_arm_body=(0.0, 0.0, 0.0)) -> tuple[np.ndarray, np.ndarray]:
    """(R_las_view, C): OpenCV-convention camera-to-world rotation and camera centre in LAS."""
    rb = cc.quaternion_matrix(quaternion_xyzw)
    r_off = cc.offset_matrix(orientation["yawDeg"], orientation["pitchDeg"], orientation["rollDeg"])
    rotation = rb @ r_off @ R_F_CV @ view_rotation(view)
    centre = np.asarray(position, float) + rb @ np.asarray(lever_arm_body, float)
    return rotation, centre


def rotmat_to_qvec(r: np.ndarray) -> np.ndarray:
    """Rotation matrix → unit quaternion (w, x, y, z), w ≥ 0 (COLMAP order)."""
    m = np.asarray(r, float)
    t = np.trace(m)
    if t > 0:
        s = 2 * math.sqrt(t + 1)
        q = [0.25 * s, (m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s]
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = 2 * math.sqrt(1 + m[0, 0] - m[1, 1] - m[2, 2])
        q = [(m[2, 1] - m[1, 2]) / s, 0.25 * s, (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s]
    elif m[1, 1] > m[2, 2]:
        s = 2 * math.sqrt(1 + m[1, 1] - m[0, 0] - m[2, 2])
        q = [(m[0, 2] - m[2, 0]) / s, (m[0, 1] + m[1, 0]) / s, 0.25 * s, (m[1, 2] + m[2, 1]) / s]
    else:
        s = 2 * math.sqrt(1 + m[2, 2] - m[0, 0] - m[1, 1])
        q = [(m[1, 0] - m[0, 1]) / s, (m[0, 2] + m[2, 0]) / s, (m[1, 2] + m[2, 1]) / s, 0.25 * s]
    q = np.array(q) / np.linalg.norm(q)
    return -q if q[0] < 0 else q


def qvec_to_rotmat(q) -> np.ndarray:
    """COLMAP (w, x, y, z) quaternion → rotation matrix."""
    w, x, y, z = np.asarray(q, float) / np.linalg.norm(q)
    return cc.quaternion_matrix((x, y, z, w))


def world_to_colmap(rotation_c2w: np.ndarray, centre: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """COLMAP image pose: (qvec w,x,y,z of R_w2c, tvec) with x_cam = R_w2c · x_world + t."""
    r_w2c = rotation_c2w.T
    return rotmat_to_qvec(r_w2c), -r_w2c @ np.asarray(centre, float)


def colmap_intrinsics(view: PinholeView) -> tuple[float, float, float, float]:
    """PINHOLE params (fx, fy, cx, cy) in COLMAP's pixel convention (corner origin)."""
    return view.focal_px, view.focal_px, view.cx + 0.5, view.cy + 0.5


def project_pinhole(points_world, rotation_c2w, centre, k_opencv) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """World points → (u, v) OpenCV pixels and depth z (no validity test; z ≤ 0 is behind)."""
    cam = (np.atleast_2d(np.asarray(points_world, float)) - np.asarray(centre, float)) @ rotation_c2w
    z = cam[:, 2]
    safe = np.where(np.abs(z) > 1e-12, z, 1e-12)
    return k_opencv[0, 0] * cam[:, 0] / safe + k_opencv[0, 2], k_opencv[1, 1] * cam[:, 1] / safe + k_opencv[1, 2], z


def view_rays_fisheye(view: PinholeView, us=None, vs=None) -> np.ndarray:
    """Unit directions (N × 3) in the fisheye frame F of view pixels (all pixels by default)."""
    if us is None:
        vs, us = np.mgrid[0:view.height, 0:view.width]
    us, vs = np.asarray(us, float).ravel(), np.asarray(vs, float).ravel()
    d = np.stack([(us - view.cx) / view.focal_px, (vs - view.cy) / view.focal_px, np.ones_like(us)], axis=1)
    d = d @ (R_F_CV @ view_rotation(view)).T
    return d / np.linalg.norm(d, axis=1, keepdims=True)


def view_source_map(view: PinholeView, model: dict) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """For every view pixel: the fisheye source pixel (u, v) and whether it lies in the usable circle."""
    u, v, theta = cc.project_camera(view_rays_fisheye(view), model)
    valid = cc.is_valid_projection(u, v, theta, model)
    shape = (view.height, view.width)
    return u.reshape(shape), v.reshape(shape), valid.reshape(shape)


def fisheye_pixel_to_view(u: float, v: float, view: PinholeView, model: dict) -> tuple[float, float, bool]:
    """A fisheye pixel → the same ray's pixel in the view (and whether it falls inside the view)."""
    d_f = cc.pixel_ray_camera(u, v, model)
    d = (R_F_CV @ view_rotation(view)).T @ d_f
    if d[2] <= 1e-9:
        return math.nan, math.nan, False
    pu = view.focal_px * d[0] / d[2] + view.cx
    pv = view.focal_px * d[1] / d[2] + view.cy
    inside = -0.5 <= pu <= view.width - 0.5 and -0.5 <= pv <= view.height - 0.5
    return float(pu), float(pv), inside


def rotation_angle_deg(a: np.ndarray, b: np.ndarray) -> float:
    """Angle of the rotation a · bᵀ, degrees."""
    c = (np.trace(np.asarray(a) @ np.asarray(b).T) - 1) / 2
    return math.degrees(math.acos(max(-1.0, min(1.0, c))))

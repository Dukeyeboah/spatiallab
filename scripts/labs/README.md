# Spatial Lab — offline lab scripts

## EXP-05C / 05D — Gaussian wall edit feasibility

`gaussian_wall_edit_feasibility.py` selects and recolours Gaussians in a **copy** of a trained PLY (never the source).

- `--mode in-place` — edit `f_dc` on selected (EXP-05C)
- `--mode duplicate` — keep originals + append recoloured clones (EXP-05D Test B)

See `docs/labs/spatial-experiences-exp05c.md` and `docs/labs/spatial-experiences-exp05d.md`.

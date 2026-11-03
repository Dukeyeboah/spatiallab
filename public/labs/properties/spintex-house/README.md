# Spintex House — property assets (LAB PROD-01)

## Layout

```
v1/
  ground/     Extracted Ground Floor LCC package (gitignored)
  first/      Extracted First Floor LCC package (gitignored)
  previews/   Floor-selection screenshots (thumb.jpg copies OK)
  spintex-house.experience.json   Optional committed export
```

## Extract (local)

From the Spatial Lab repo root:

```bash
PROP=public/labs/properties/spintex-house/v1
mkdir -p "$PROP/ground" "$PROP/first" "$PROP/previews"
unzip -o ~/Downloads/"Spintex House Ground Floor_render.zip" -d "$PROP/ground"
unzip -o ~/Downloads/"Spintex Upstairs_render.zip" -d "$PROP/first"
cp -f "$PROP/ground/thumb.jpg" "$PROP/previews/ground.jpg"
cp -f "$PROP/first/thumb.jpg" "$PROP/previews/first.jpg"
```

Entry points (portable, PROD-01):

- Ground: `ground/SpintexHouseGroundFloor.lcc`
- First: `first/SpintexUpstairs.lcc`

### LCC2 (PROD-02A lab)

```bash
PROP=public/labs/properties/spintex-house/v1-lcc2
mkdir -p "$PROP/ground" "$PROP/first"
unzip -o ~/Downloads/"Spintex House Ground Floor_render2.zip" -d "$PROP/ground"
unzip -o ~/Downloads/"Spintex Upstairs_render2.zip" -d "$PROP/first"
```

- Ground: `v1-lcc2/ground/SpintexHouseGroundFloor.lcc2`
- First: `v1-lcc2/first/SpintexUpstairs.lcc2`
- Packages include `data/mesh/` — check `hasCollision()` in the lab before assuming walls are solid.

Do **not** commit `data.bin` / `.lcc` / `.lcc2` binaries. For Spatial House / R2 later, upload each floor folder with the same relative layout under a versioned prefix.

## Authoring

- PROD-01 property player → `/labs/property-experience`
- PROD-02A smooth nav (isolated) → `/labs/prod-02a`

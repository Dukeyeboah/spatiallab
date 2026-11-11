"""Bake the user-supplied Spatial House mark + exact shirt copy into one 1K atlas.
Usage: python3 scripts/labs/create-prod02b-shirt-atlas.py /path/to/mark.png
Requires Pillow. Logo is composited unchanged; no generated lettering or geometry.
"""
from pathlib import Path
import sys
from PIL import Image, ImageDraw, ImageFont
root = Path(__file__).resolve().parents[2]
logo_path = Path(sys.argv[1]) if len(sys.argv) > 1 else root.parent / 'SpatialHouse/public/images/brand/mark.png'
out = root / 'public/labs/prod02b/avatars/shirt-atlas.png'
im = Image.new('RGB', (1024, 1024), '#f4f1eb')
draw = ImageDraw.Draw(im)
logo = Image.open(logo_path).convert('RGBA')
font_dir = Path('/System/Library/Fonts/Supplemental')
def text(label, cx, y, size, bold=True, color='#1b1916'):
    font = ImageFont.truetype(str(font_dir / ('Arial Bold.ttf' if bold else 'Arial.ttf')), size)
    box = draw.textbbox((0, 0), label, font=font)
    draw.text((cx - (box[2] - box[0]) / 2, y), label, font=font, fill=color)
for cx, width, y in [(256, 330, 155), (768, 300, 135)]:
    mark = logo.copy()
    mark.thumbnail((width, width))
    im.paste(mark, (cx - mark.width // 2, y), mark)
text('SPATIAL HOUSE', 256, 525, 46)
text('SPATIAL HOUSE', 768, 475, 44)
text('Real spaces. Global possibilities.', 768, 546, 25, False, '#5c4326')
im.save(out, optimize=True)
print(out)

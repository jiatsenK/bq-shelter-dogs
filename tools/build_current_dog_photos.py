from pathlib import Path
from urllib.request import urlopen, Request
import json
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
MANIFESTS = sorted((ROOT / "tools").glob("photo_manifest_*.json"))
OUT = ROOT / "photos"
TMP = ROOT / ".photo_tmp"
OUT.mkdir(exist_ok=True)
TMP.mkdir(exist_ok=True)

def crop_photo(src, dst, side):
    im = Image.open(src).convert("RGB")
    w, h = im.size
    crop_side = max(1, round(h * 0.25))
    cx = w * (0.735 if side == "R" else 0.265)
    cy = h * (0.80 if side == "R" else 0.795)
    x0 = max(0, min(round(cx - crop_side / 2), w - crop_side))
    y0 = max(0, min(round(cy - crop_side / 2), h - crop_side))
    crop = im.crop((x0, y0, x0 + crop_side, y0 + crop_side))
    crop = crop.resize((320, 320), Image.Resampling.LANCZOS)
    crop.save(dst, "JPEG", quality=72, optimize=True, progressive=True, subsampling=2)

items = []
for path in MANIFESTS:
    items.extend(json.loads(path.read_text(encoding="utf-8")))

if not items:
    raise SystemExit("No photo manifest entries found")

for i, item in enumerate(items, 1):
    dog_id = item["id"]
    req = Request(item["url"], headers={"User-Agent": "Mozilla/5.0"})
    raw = TMP / f"{dog_id}.jpg"
    with urlopen(req, timeout=60) as r, raw.open("wb") as f:
        f.write(r.read())
    crop_photo(raw, OUT / f"{dog_id}.jpg", item["side"])
    print(f"[{i}/{len(items)}] {dog_id}")

print(f"Generated {len(items)} photos")

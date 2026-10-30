# 狗狗變裝秀的臉部位置（#795）：幫在所狗的主照片算出兩眼、鼻子、人中、下巴、頭頂，存成 public/data/dog-faces.json
# - 模型：Hugging Face 的 hugocornellier/dog-face-landmarks（DogFLW 46 點，CC BY-NC 4.0），執行時才下載到 .scratch/dog-faces/model/，不進 repo
# - 狗和照片以正式網站 /api/dogs 為準，照片讀網站上的原圖（photos/{編號}.jpg?v=版本）
# - 每張照片跑原圖一次、左右翻轉一次；兩次差太多、兩眼太近（照片太小）、側臉的不收，不收的狗遊戲不出題
# - 每筆記下算位置時的照片版本，前端只用版本跟 /api/dogs 一樣的狗；換過照片沒重跑就自動不出題
# - 另外畫對照表 .scratch/dog-faces/sheet-*.png（每隻狗的臉和裝飾會戴的位置），給 K 用眼睛抽查
#
# 用法（本機，要 Python 3.10 以上）：
#   pip install ai-edge-litert pillow numpy
#   python scripts/dog-faces.py --site https://正式網站網址
# 跑完看印出的數量與原因、抽查對照表，再照一般流程開 PR
import argparse
import io
import json
import math
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / '.scratch' / 'dog-faces'
OUT = ROOT / 'public' / 'data' / 'dog-faces.json'
MODEL_URL = 'https://huggingface.co/hugocornellier/dog-face-landmarks/resolve/main/'
MODELS = ('dog_face_localizer.tflite', 'dog_face_landmarks_full.tflite')

# DogFLW 46 點的編號（左右以畫面為準）：16/18/20/22 畫面左眼、17/19/21/23 畫面右眼、0/1 兩耳根、14/15 額頭、
# 25 鼻樑末端、32 兩鼻孔中間、35 人中、45 下巴（張嘴時是舌尖）
L_EYE, R_EYE = (16, 18, 20, 22), (17, 19, 21, 23)
MIN_EYES_PX = 40   # 原圖兩眼距離少於這個像素：照片太小
MAX_FLIP = 0.12    # 原圖和翻轉的眼睛、鼻頭差距超過兩眼距離的這個比例：模型結果不穩
MIN_FRONTAL = 0.75 # 兩眼距離／眼鼻距離小於這個：側臉


def fetch(url, origin=None):
    # /api 只收同網站的要求（Worker 看 Origin），帶上網站自己的網址
    req = urllib.request.Request(url, headers={'User-Agent': 'bq-dog-faces', **({'Origin': origin} if origin else {})})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def model_path(name):
    path = WORK / 'model' / name
    if not path.exists():
        print(f'下載模型 {name}…')
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix('.part')
        tmp.write_bytes(fetch(MODEL_URL + name))
        tmp.replace(path)
    return path


def load_model(name):
    from ai_edge_litert.interpreter import Interpreter
    it = Interpreter(model_path=str(model_path(name)), num_threads=os.cpu_count())
    it.allocate_tensors()
    return it


def run(it, arr):
    i, o = it.get_input_details()[0], it.get_output_details()[0]
    it.set_tensor(i['index'], arr[None].astype(np.float32))
    it.invoke()
    return it.get_tensor(o['index'])[0].astype(np.float32)


def face_box(it, img):
    # 補黑邊成正方形縮到 224，模型回傳補邊座標的臉框，再換回原圖像素
    w, h = img.size
    s = min(224 / w, 224 / h)
    nw, nh = round(w * s), round(h * s)
    px, py = (224 - nw) // 2, (224 - nh) // 2
    canvas = Image.new('RGB', (224, 224))
    canvas.paste(img.resize((nw, nh), Image.Resampling.BILINEAR), (px, py))
    b = np.clip(run(it, np.asarray(canvas) / 255.0), 0, 1) * 224
    x1, x2 = sorted(((b[0] - px) / s, (b[2] - px) / s))
    y1, y2 = sorted(((b[1] - py) / s, (b[3] - py) / s))
    return [max(0.0, x1), max(0.0, y1), min(w, x2), min(h, y2)]


def landmarks(it, img, box, margin=0.1):
    # 臉框外擴 0.1 後裁切縮到 384，輸出是裁切範圍裡的比例座標，換回原圖像素
    w, h = img.size
    x1, y1, x2, y2 = box
    bw, bh = x2 - x1, y2 - y1
    c = [max(0, x1 - bw * margin), max(0, y1 - bh * margin), min(w, x2 + bw * margin), min(h, y2 + bh * margin)]
    crop = img.crop(c).resize((384, 384), Image.Resampling.BILINEAR)
    xy = run(it, np.asarray(crop) / 255.0).reshape(46, 2)
    xy[:, 0] = xy[:, 0] * (c[2] - c[0]) + c[0]
    xy[:, 1] = xy[:, 1] * (c[3] - c[1]) + c[1]
    return xy


def mean(p, idx):
    return np.mean([p[i] for i in idx], axis=0)


def face_points(loc, lm, img):
    """原圖、左右翻轉各跑一次。回傳像素座標的臉部位置，以及不收的原因（收的話是空字串）"""
    w, _ = img.size
    a = landmarks(lm, img, face_box(loc, img))
    b = landmarks(lm, ImageOps.mirror(img), face_box(loc, ImageOps.mirror(img)))
    b[:, 0] = w - b[:, 0]  # 翻回來；翻轉的那次，模型的「左眼」是原圖的右眼
    le, re = mean(a, L_EYE), mean(a, R_EYE)
    eyes = (le + re) / 2
    iod = float(np.linalg.norm(re - le))
    gap = lambda p, q: float(np.linalg.norm(p - q)) / max(iod, 1)
    flip = max(gap(le, mean(b, R_EYE)), gap(re, mean(b, L_EYE)), gap(a[32], b[32]))
    # 鼻子正中間：鼻樑末端和兩鼻孔中間取 4:6，只用 32 號會偏低到鼻孔下緣
    nose = a[25] * .4 + a[32] * .6
    # 頭頂：兩耳根中點和「兩眼往額頭方向延伸 1.8 倍」取平均，單一點不準時互相抵銷
    top = (mean(a, (0, 1)) + eyes + (mean(a, (14, 15)) - eyes) * 1.8) / 2
    pts = {'le': le, 're': re, 'nose': nose, 'lip': a[35], 'chin': a[45], 'top': top}
    if iod < MIN_EYES_PX:
        return pts, '照片太小'
    if flip > MAX_FLIP:
        return pts, '模型結果不穩'
    # 側臉：用 32 號（兩鼻孔中間）量眼鼻距離，側臉時這段會被拉長
    if iod / max(float(np.linalg.norm(a[32] - eyes)), 1) < MIN_FRONTAL:
        return pts, '側臉'
    return pts, ''


def neck(p):
    """脖子：沿兩眼連線的垂直方向往下，取「眼鼻距離 3.1 倍」和「下巴再往下 0.35 個兩眼距離」比較遠的（跟 public/js/dress-up.js 一樣）"""
    eyes = (p['le'] + p['re']) / 2
    d = p['re'] - p['le']
    iod = float(np.linalg.norm(d))
    ax = np.array([-d[1], d[0]]) / max(iod, 1e-6)
    far = max(float(np.linalg.norm(p['nose'] - eyes)) * 3.1, float(np.dot(p['chin'] - eyes, ax)) + iod * .35)
    return eyes + ax * far


def draw_tile(img, p, label, size=300):
    """以兩眼中點為中心裁一塊正方形，畫上裝飾會戴的位置：頭頂、兩眼、鼻子、人中、脖子"""
    iod = float(np.linalg.norm(p['re'] - p['le']))
    eyes = (p['le'] + p['re']) / 2
    half = max(iod * 2.6, 60)
    box = (eyes[0] - half, eyes[1] - half * .8, eyes[0] + half, eyes[1] + half * 1.2)  # 往下多留一點，看得到脖子
    tile = img.crop(tuple(int(v) for v in box)).resize((size, size))
    s = size / (box[2] - box[0])
    at = lambda q: ((q[0] - box[0]) * s, (q[1] - box[1]) * s)
    d = ImageDraw.Draw(tile)
    d.line([at(p['le']), at(p['re'])], fill=(0, 200, 255), width=3)
    for key, color in (('le', (0, 200, 255)), ('re', (0, 200, 255)), ('nose', (255, 60, 60)), ('lip', (255, 160, 0)), ('top', (180, 80, 255))):
        x, y = at(p[key])
        d.ellipse((x - 6, y - 6, x + 6, y + 6), outline=(255, 255, 255), fill=color, width=2)
    x, y = at(neck(p))
    d.rectangle((x - 22, y - 8, x + 22, y + 8), outline=(255, 255, 255), fill=(230, 60, 100), width=2)
    d.rectangle((0, size - 28, size, size), fill=(0, 0, 0))
    d.text((8, size - 25), label, fill=(255, 255, 255), font=label_font())
    return tile


def label_font():
    # 狗名是中文，PIL 內建字型畫不出來；找得到系統的中文字型就用，找不到只會變方框，不影響抽查位置
    for path in ('C:/Windows/Fonts/msjh.ttc', '/System/Library/Fonts/PingFang.ttc', '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'):
        if Path(path).exists():
            return ImageFont.truetype(path, 18)
    return ImageFont.load_default()


def save_sheets(tiles, cols=5, per_sheet=40):
    for f in WORK.glob('sheet-*.png'):
        f.unlink()
    size = tiles[0].width if tiles else 0
    for n in range(0, len(tiles), per_sheet):
        part = tiles[n:n + per_sheet]
        rows = math.ceil(len(part) / cols)
        sheet = Image.new('RGB', (cols * size, rows * size), (40, 40, 40))
        for i, t in enumerate(part):
            sheet.paste(t, ((i % cols) * size, (i // cols) * size))
        path = WORK / f'sheet-{n // per_sheet + 1}.png'
        sheet.save(path)
        print(f'對照表：{path}')


def main():
    ap = argparse.ArgumentParser(description='算狗狗變裝秀的臉部位置')
    ap.add_argument('--site', required=True, help='正式網站網址，例如 https://bq-shelter-dogs.example.workers.dev')
    args = ap.parse_args()
    site = args.site.rstrip('/')
    data = json.loads(fetch(site + '/api/dogs', origin=site))
    versions = data.get('photoVersions') or {}
    loc, lm = load_model(MODELS[0]), load_model(MODELS[1])
    out, skipped, tiles = {}, {}, []
    dogs = [d for d in data.get('dogs', []) if str(d.get('id') or '').strip()]
    for dog in dogs:
        dog_id = str(dog['id']).strip()
        ver = versions.get(f'photos/{dog_id}.jpg')
        if not ver:
            skipped.setdefault('沒有照片', []).append(dog_id)
            continue
        cache = WORK / 'photos' / f'{dog_id}-{ver}.jpg'
        if not cache.exists():
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_bytes(fetch(f'{site}/photos/{urllib.parse.quote(dog_id)}.jpg?v={ver}'))
        img = ImageOps.exif_transpose(Image.open(io.BytesIO(cache.read_bytes()))).convert('RGB')
        w, h = img.size
        p, why = face_points(loc, lm, img)
        if why:
            skipped.setdefault(why, []).append(dog_id)
            continue
        # 照片比例座標限制在 0～1：頭頂是往外延伸算的，貼著照片上緣的狗會算出負值
        clip = lambda x: round(min(max(x, 0.0), 1.0), 4)
        out[dog_id] = {'photoVersion': ver, **{k: [clip(float(v[0]) / w), clip(float(v[1]) / h)] for k, v in p.items()}}
        tiles.append(draw_tile(img, p, f'{dog_id} {dog.get("name", "")}'.strip()))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    # 一隻狗一行，重跑時 git 只看到真的有變的狗
    lines = [f'{json.dumps(k)}:{json.dumps(v, separators=(",", ":"))}' for k, v in sorted(out.items())]
    OUT.write_text('{\n' + ',\n'.join(lines) + '\n}\n', encoding='utf-8')
    print(f'在所有編號 {len(dogs)} 隻，可以出題 {len(out)} 隻，寫進 {OUT.relative_to(ROOT)}')
    for why, ids in skipped.items():
        print(f'不收（{why}）{len(ids)} 隻：{"、".join(ids)}')
    save_sheets(tiles)


if __name__ == '__main__':
    sys.exit(main())

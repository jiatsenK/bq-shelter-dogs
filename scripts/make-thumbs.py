# 產生照片縮圖（#83）：清單、相簿格子只要小圖，不必每次下載 1280px 的原圖
# - photos/{編號}.jpg              → photos/thumbs/{編號}.jpg
# - photos/gallery/{編號}/{檔名}.jpg → photos/thumbs/gallery/{編號}/{檔名}.jpg
# - 短邊縮到 THUMB_SHORT_EDGE（畫面用 object-fit: cover 裁成正方形，手機高解析度也夠清楚）；本來就比較小的不放大
# - 原圖刪掉了，對應的縮圖也刪掉
# - 每次全部重做：Pillow 版本固定時同一張原圖產生的縮圖一模一樣，git 只會看到真的有變的檔案
# 用法：python3 scripts/make-thumbs.py [repo 根目錄]
#
# 照片放 R2 以後（#130）：python3 scripts/make-thumbs.py --site https://網站網址
# - 問網站哪些照片還沒有縮圖（/api/admin/thumbs），下載原圖、做好縮圖傳回去，存進 R2，不提交 repo
# - 通關碼放環境變數 ADMIN_PASSCODE（GitHub Secret NOTES_PASSCODE）；由 .github/workflows/r2-thumbs.yml 執行
import io
import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image, ImageOps

THUMB_SHORT_EDGE = 300
QUALITY = 72


def sources(photos):
    """原圖（相對 photos/ 的路徑）：主照片與相簿照片，不含縮圖資料夾本身"""
    out = [p.relative_to(photos) for p in photos.glob('*.jpg')]
    out += [p.relative_to(photos) for p in photos.glob('gallery/*/*.jpg')]
    return sorted(out)


def make_thumb(src, dst):
    """src、dst 可以是檔案路徑或 BytesIO"""
    with Image.open(src) as im:
        im = ImageOps.exif_transpose(im).convert('RGB')
        k = THUMB_SHORT_EDGE / min(im.size)
        if k < 1:
            im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
        if isinstance(dst, Path):
            dst.parent.mkdir(parents=True, exist_ok=True)
        im.save(dst, 'JPEG', quality=QUALITY, optimize=True, progressive=True)


def remote(site, passcode, opener=urllib.request.urlopen):
    """R2 模式：還沒有縮圖的照片做好縮圖傳回網站。回傳 (成功張數, 失敗張數)"""
    site = site.rstrip('/')
    auth = {'X-Admin-Passcode': urllib.parse.quote(passcode, safe=''), 'User-Agent': 'bq-shelter-dogs-thumbs'}

    def call(url, data=None, method='GET', headers=None):
        req = urllib.request.Request(url, data=data, method=method, headers={**auth, **(headers or {})})
        with opener(req, timeout=60) as res:
            return res.read()

    pending = json.loads(call(f'{site}/api/admin/thumbs'))['pending']
    print(f'要做縮圖的照片：{len(pending)} 張')
    done = failed = 0
    for key in pending:
        try:
            original = call(f'{site}/{urllib.parse.quote(key)}', headers={'Cache-Control': 'no-cache'})
            out = io.BytesIO()
            make_thumb(io.BytesIO(original), out)
            call(f'{site}/api/admin/thumbs/{urllib.parse.quote(key)}', data=out.getvalue(), method='PUT',
                 headers={'Content-Type': 'image/jpeg'})
            done += 1
        except Exception as e:  # 一張失敗不擋其他張；下次 Cron 會再叫一次
            print(f'略過 {key}：{e}')
            failed += 1
    print(f'縮圖做好 {done} 張，失敗 {failed} 張')
    return done, failed


def main(root):
    photos = Path(root) / 'photos'
    thumbs = photos / 'thumbs'
    wanted = set()
    for rel in sources(photos):
        dst = thumbs / rel
        wanted.add(dst)
        try:
            make_thumb(photos / rel, dst)
        except Exception as e:  # 壞掉的檔案跳過，不擋其他照片
            print(f'略過 {rel}：{e}')
            wanted.discard(dst)
    removed = 0
    for old in thumbs.rglob('*.jpg') if thumbs.exists() else []:
        if old not in wanted:
            old.unlink()
            removed += 1
    for d in sorted(thumbs.rglob('*'), reverse=True) if thumbs.exists() else []:
        if d.is_dir() and not any(d.iterdir()):
            d.rmdir()
    print(f'縮圖 {len(wanted)} 張，刪掉多餘的 {removed} 張')


if __name__ == '__main__':
    if len(sys.argv) > 2 and sys.argv[1] == '--site':
        remote(sys.argv[2], os.environ.get('ADMIN_PASSCODE', ''))
        sys.exit(0)  # 個別失敗只印出來；下次 Cron 會再試，不讓 Action 一直紅
    main(sys.argv[1] if len(sys.argv) > 1 else '.')

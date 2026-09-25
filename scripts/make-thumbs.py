# 產生照片縮圖（#83）：清單、相簿格子只要小圖，不必每次下載 1280px 的原圖
# - photos/{編號}.jpg              → photos/thumbs/{編號}.jpg
# - photos/gallery/{編號}/{檔名}.jpg → photos/thumbs/gallery/{編號}/{檔名}.jpg
# - 短邊縮到 THUMB_SHORT_EDGE（畫面用 object-fit: cover 裁成正方形，手機高解析度也夠清楚）；本來就比較小的不放大
# - 原圖刪掉了，對應的縮圖也刪掉
# - 每次全部重做：Pillow 版本固定時同一張原圖產生的縮圖一模一樣，git 只會看到真的有變的檔案
# 用法：python3 scripts/make-thumbs.py [repo 根目錄]
import sys
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
    with Image.open(src) as im:
        im = ImageOps.exif_transpose(im).convert('RGB')
        k = THUMB_SHORT_EDGE / min(im.size)
        if k < 1:
            im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
        dst.parent.mkdir(parents=True, exist_ok=True)
        im.save(dst, 'JPEG', quality=QUALITY, optimize=True, progressive=True)


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
    main(sys.argv[1] if len(sys.argv) > 1 else '.')

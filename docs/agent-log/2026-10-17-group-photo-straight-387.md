# 常溜狗群照片改正放（#387）
n- Agent：Claude Code（Opus 5.5）
- 依據：#387

- K 反映手機版常溜狗群的狗照片斜放，看了眼睛痛。
- `public/css/app.css`：`.gw-tile` 拿掉 `skew(-8deg)`，照片和狗名拿掉反向 `skew(8deg)`，照片寬度回到 100%；拿掉每排左右錯開的 `translateX`，每張卡位置、大小一致。按住放大（`scale(1.12)`）保留。

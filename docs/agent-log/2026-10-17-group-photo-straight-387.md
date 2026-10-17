# 常溜狗群照片改正放（#387）
n- Agent：Claude Code（Opus 5.5）
- 依據：#387

- K 反映手機版常溜狗群的狗照片斜放，看了眼睛痛。
- `public/css/app.css`：`.gw-tile` 拿掉 `skew(-8deg)`，照片和狗名拿掉反向 `skew(8deg)`，照片寬度回到 100%；拿掉每排左右錯開的 `translateX`，每張卡位置、大小一致。按住放大（`scale(1.12)`）保留。

## 追加：照片放大、箭頭移到「溜了」兩側（K 2026-10-17）

- K 覺得照片還是太小。原本左右換群箭頭夾在照片區兩側占掉 88px，改放在「溜了」按鈕兩側、貼齊畫面左右邊，跟按鈕留 16px 免得誤按換群。
- `public/js/group-stage.js`：箭頭搬進新的 `.gw-walkbar`（上一群｜溜了｜下一群）。
- `public/css/app.css`：照片區改撐滿寬度、照片改正方形；保留第一排三張、之後每排四張的交錯排法。390px 寬時照片從 56px 放大到約 83px。
- 已用 Playwright 在 320／390px 截圖確認；node、網頁測試全過。
- CI（Linux）量到「＋加入狗」卡在空群時高度不到 44px（字型比 Windows 矮），補 `min-height: 100px`。

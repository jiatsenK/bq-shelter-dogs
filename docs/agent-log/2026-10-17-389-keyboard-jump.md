# 2026-10-17 手機鍵盤彈出畫面亂跳（#389）

- Agent：Claude Code（Opus 5.5）
- 依據：issue #389（K：手機版輸入超難輸入，跳鍵盤整個視窗亂跳）
- 做了什麼：
  - 新增 `public/js/keyboard-viewport.js`：鍵盤彈出時標記 `html.kb-open`、提供 `--vv-top`／`--vv-height`，底部面板裡的輸入框只在面板內捲。
  - `app.css`：`kb-open` 時收起底部分類列；`.with-backdrop`、`.onboard` 貼齊看得到的範圍。
  - 拿掉編輯介紹、入所紀錄、休養的 `scrollIntoView({ block: 'center' })`（會連整頁一起捲），交給既有 `detail-viewport.js`。
  - `docs/DESIGN_GUIDE.md` 新增獨立小節「手機鍵盤不讓畫面跳」。
  - 新增 `tests/keyboard-viewport.cjs`（假 visualViewport 模擬鍵盤）。
- 沒動：常溜狗群＋加入流程（#388 負責）。
- 未完成：真機（iPhone Safari、Android Chrome）確認，步驟列在 PR。

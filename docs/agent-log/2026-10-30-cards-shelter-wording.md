# 2026-10-30 圖鑑文字改成動物之家說法

- Agent：Claude
- 分支：claude/pokedex-text-adjustment-fbde1e
- 依據：K 2026-10-30：「叫籃球隊好怪，應該要是動物之家」；選「全部改成動物之家說法，卡片外觀不動」。
- 做了什麼：
  - `public/js/site-config.js`：圖鑑卡面的隊名改區名（新犬舍隊→新犬舍、幼母隊→幼母犬舍、自由球員→其他…），顏色不變。
  - `public/js/cards.js`：卡面「守備位置」→「籠位」；卡背「入隊／球齡」→「入所／在所」；年度獎項（目前藏著）「資深球星／新人王」→「最資深／新來的」；大卡 aria 改「的卡」。
  - `public/cards.html`：大標 BQ ALL-STARS → 板橋動物之家；左邊徽章「板橋 收容所」→「板收 圖鑑」；說明與對話框 aria 拿掉「球員卡」。
  - `public/css/cards.css`：大標改用 Noto Sans TC 900（Anton 沒有中文），年份照舊 Anton；手機字級縮小免得一行放不下。
  - 測試獎項名稱、`docs/design/cards.md`、`SITE_CONFIG.md`、`PROJECT_GOALS.md` 跟著改。
- 未處理：卡片材質（球場直條紋、燙金卡包、背號）照原設計保留；`.impeccable/` 舊方向紀錄與歷史文件不改。大標新字型的實際樣子要 K 在預覽版用眼睛看。

---
name: 板收志工溜狗表
description: 志工單手用的溜狗清單；目前視覺的快照，不是定案
colors:
  primary: "#0062CC"
  primary-soft: "#E6F0FB"
  bg: "#F2F2F7"
  surface: "#FFFFFF"
  surface-soft: "#EFEFF4"
  ink: "#1C1C1E"
  ink-soft: "#636366"
  line: "#E5E5EA"
  red-text: "#D70015"
  red-bg: "#FFE9EA"
  amber-text: "#B25000"
  amber-bg: "#FFF1E0"
  green-text: "#1C7A33"
  green-bg: "#E5F5E9"
  muted-text: "#6C6C70"
  muted-bg: "#EFEFF4"
typography:
  body:
    fontFamily: "-apple-system, 'PingFang TC', 'Noto Sans TC', 'Noto Sans CJK TC', 'Microsoft JhengHei', sans-serif"
  title:
    fontSize: "20px"
    fontWeight: 700
rounded:
  card: "14px"
  photo: "10px"
---

# Design System: 板收志工溜狗表

<!-- 給 impeccable 技能讀的視覺入口。這份只是指路和目前狀態的快照：
     - 數值以 css/app.css 的 :root 為準；上面 frontmatter 是 2026-10-09 抄下來的，兩邊不一樣時信 CSS，再用 /impeccable document 重新產生這份。
     - 設計理由與元件說明以 docs/DESIGN_GUIDE.md 為準，這裡不重寫。
     - 目前的外觀可以改。改版時照 docs/PROJECT_GOALS.md 的版本流程（K 確認後定版），不要因為這份檔案寫了某個值就拒絕改。 -->

## Overview

目前的樣子（V9，#141）：參考 iOS 系統色，灰底、白卡、一個藍色主色，平面不靠陰影。整體要安靜、實用，讓志工單手很快看完、按到。

這些都是**現況描述，不是規定**。真正不能動的只有產品面的事（見 `PRODUCT.md` 和 `docs/DESIGN_GUIDE.md`「原則」「單手操作」），例如單手好按、天數連著顏色、不出現假的編輯元素；顏色、字級、圓角、版面細節都可以隨改版調整。

## Colors

色碼見上方 frontmatter（抄自 `css/app.css`）。用法目前是：藍色只給主要動作和選中狀態；紅、橘、綠、灰給天數和警示（規則見 `docs/DESIGN_GUIDE.md`「天數色標」）；找狗平面圖另有一組分區色（`--z-*`），沿用所內看板色系。

## Typography

用手機內建字型、不載入網路字型（#91，理由見 `docs/DESIGN_GUIDE.md`「字體與字級」）。各處字級以 CSS 為準。

## Elevation & Depth

目前是平面的：卡片沒有陰影（`--shadow-card: none`），頁首、底部列只用一條細線分隔。

## Components

元件的樣子和行為見 `docs/DESIGN_GUIDE.md`「元件」與「單手操作」，以及 `css/app.css`。

## Do's and Don'ts

### Do:
- **Do** 改顏色、字級時改 `css/app.css` 的 `:root` 變數，再更新這份 frontmatter。
- **Do** 改版前先看 `docs/DESIGN_GUIDE.md` 的設計理由；要推翻的話跟 K 確認。

### Don't:
- **Don't** 把這份快照當成不能改的規格。
- **Don't** 在這裡重寫 `docs/PROJECT_GOALS.md` 或 `docs/DESIGN_GUIDE.md` 的內容；有變動改那兩份。

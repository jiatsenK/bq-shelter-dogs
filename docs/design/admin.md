---
name: 板收管理網站
description: Tabler 狗資料表、功能管理與狗資料編輯
colors:
  primary: "#206bc4"
  ink: "#182433"
  muted: "#526478"
  ground: "#f5f7fa"
  surface: "#ffffff"
  border: "#dce1e7"
typography:
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans TC", sans-serif'
    fontSize: "0.875rem"
    lineHeight: 1.4285714286
  heading:
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1.3
rounded:
  small: "4px"
spacing:
  small: "8px"
  medium: "16px"
  large: "24px"
---

## Overview

Operate 模式。K 已選定 Tabler 免費後台、左側導覽、原生 ES module 及唯讀狗表；採直接實作，不另開視覺提案或產生 mock。品質基準為 Tabler 的成熟表格與原生表單：資訊可掃讀、來源清楚、錯誤可重試。#564 做唯讀狗表，#565 加功能管理頁（`settings.html`），#566 加逐隻狗編輯；活動、資料檢查、更新紀錄在 #567。

## Colors

白色導覽與表格、淺灰頁底；單一藍色用於當前導覽、排序、焦點與主要按鈕。文字／placeholder 維持可讀對比，狀態用文字表達，不只靠顏色。

## Typography

沿用 Tabler 系統無襯線字體及固定 rem 字級；不載外部字型。表格使用等寬數字，永久 ID 可換行；狗名和編號優先掃讀。

## Layout

桌面 216px 左側導覽，內容留白 32px。標題在左、重新讀取在右；來源說明、搜尋／篩選、結果數、資料表、分頁依操作順序排列。900px 以下導覽移到上方橫向捲動，表格在獨立容器水平捲動，不能讓整頁橫向溢出。

## Shapes

使用 Tabler 原生表單與按鈕，照片 56px、圓角 4px。簡潔邊框區分欄列，不加裝飾圖示或背景動畫。

## Components

表頭按鈕排序、`aria-sort`、搜尋標籤、狀態 live region、鍵盤焦點、跳到內容及可聚焦捲動區。介紹以原生 details 展開全文；試算表備註以文字顯示。支援讀取、無資料、無符合條件、格式錯誤、權限失效、照片讀不到、重試與停用按鈕。

## Do's and Don'ts

試算表來源的目前編號、狗名、籠位與備註保持唯讀；網站維護欄位依已開放範圍逐隻編輯，不提供任意 SQL 或批次操作。未列主清單不等於離所；照片 metadata 不等於檔案存在。保留志工站的既有設計與行為。

## 功能管理（#565）

`admin/public/settings.html` 延用同一側欄、字體及原生 Tabler 表單，分成功能顯示與志工可編輯兩組。checkbox 僅改草稿，按「儲存設定」才送出；無差異停用。重新讀取、載入中、儲存中、失敗與版本衝突都有文字狀態；衝突保留草稿，重新讀取後才可再存。狗資料仍唯讀，管理狗資料編輯不在本階段。功能契約與正式步驟見 [操作說明](../operations/feature-settings.md)。

## 狗資料編輯（#566）

延伸既有狗表，在單隻狗的編輯區逐項處理介紹、休養、固定照顧、編號、出入所紀錄、照片與性別補正。一次只儲存一項，先顯示改前／改後；沒有差異時不送出。照片顯示新舊圖，垃圾桶先預覽再確認復原；出入所紀錄使用日期與原因表單，不讓使用者編輯 JSON。

切換項目或改字時標明「草稿尚未儲存」，不能沿用前一項的成功訊息。儲存中停用編輯，失敗與 409 保留草稿；重新讀取取得最新版本後，保留輸入並要求重新預覽。成功只在伺服器確認交易後顯示。

性別使用公／母／待確認，說明舊試算表副本已停止維護，供管理者以狗正本逐隻核對；不依名字推測。試算表欄位仍只讀；管理者不受志工編輯開關限制。既有 Tabler 色彩、字體、側欄、手機配置保持不變；操作與正式步驟見 [狗編輯說明](../operations/dog-editing.md)。

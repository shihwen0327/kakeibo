# Wen 記帳

薪資單紀錄＋每日家計簿 CSV 留存（日常記帳仍用每日家計簿）。可加到 iPhone 主畫面使用。

- **App**：本 repo 根目錄，用 GitHub Pages 發佈
- **資料**：存在自己的 Google 試算表（Apps Script 連線），薪資單 PDF、CSV 原檔存在 Google Drive「Wen 記帳」資料夾
- **程式裡沒有任何個人資料或密碼**；密碼只存在 Apps Script 和手機瀏覽器

## 功能

| 分頁 | 內容 |
|---|---|
| 薪資 | 總覽（年收、每月圖表、各公司）／明細（清單、照薪資單逐項的表）／稅金（所得税試算、住民税、源泉徴収票對照） |
| 收支紀錄 | 每日家計簿匯入的紀錄，依月份瀏覽、搜尋 |
| 每月彙總 | 依類別的每月合計 |
| 資料 | 匯入每日家計簿 CSV、匯出、完整備份／還原、儲存位置 |

上傳薪資單 PDF 會自動讀取（目前支援 freee 人事労務的給与明細；讀不出來可以手動輸入）。

## 第一次設定

1. **Apps Script**
   1. 到 [script.google.com](https://script.google.com) 新增專案，把 `apps-script/Code.gs` 整個貼上。
   2. 專案設定 → 勾選「在編輯器中顯示 appsscript.json」，內容換成 `apps-script/appsscript.json`。
   3. 函式選 `setup` → 執行，第一次會要求授權。執行紀錄會印出**試算表網址**和**密碼**。
   4. 部署 → 新增部署作業 → 類型「網頁應用程式」，執行身分「我」、存取權「所有人」→ 部署，複製**網頁應用程式網址**（…/exec）。
2. **App**：打開 GitHub Pages 網址，填入上面的網址和密碼 →「連線」。
3. **資料**：選「匯入備份檔」，選 `wen-kakeibo-backup-….json`（不在 repo 裡，另外保存）。
4. iPhone Safari → 分享 →「加入主畫面」。

## 之後更新程式

- App：改完推到 `main`，GitHub Pages 自動更新（重新整理即可）。
- Apps Script：`Code.gs` 有改時，貼上新版 → 部署 → 管理部署作業 → 編輯 → 版本選「新版本」→ 部署（網址不變）。

## 新增薪資單格式

`js/parse.js` 的 `PROFILES` 是各家薪資單的讀取規則。換工作、格式不同時，加一組新的 profile（判斷是哪種格式、各欄位在哪裡），舊的不用動。

## 檔案

```
index.html, style.css      畫面
js/parse.js                薪資單 PDF 讀取規則
js/core.js                 資料、儲存（Google 試算表／這台裝置）、CSV 匯入、稅金試算、備份
js/ui.js                   共用元件、圖表
js/salary.js               薪資頁
js/records.js              收支紀錄、每月彙總
js/data.js                 資料頁
js/main.js                 啟動、連線設定
vendor/                    pdf.js（Mozilla，Apache-2.0）
apps-script/               Google Apps Script 後端
sw.js, manifest.webmanifest, icons/   加到主畫面、離線快取
```

# 粵語堂主日職事表自動排程系統

一個綁定在 Google Sheet 上的 Google Apps Script 專案，幫教會幹事自動產生、審閱、
調整並發出粵語堂主日的服侍職事表（誰在哪個主日擔任哪個崗位），並處理正式發出之後
的人手變動與重新通知。

## ⚠️ 本 Repo 只含程式碼，不含任何個人資料

**這個 repo 只公開 `src/` 底下的 Google Apps Script 原始碼。**
所有真實資料——會友姓名、電郵地址、服侍紀錄、Google 試算表 / Apps Script 的 ID——
一律只存在於這個腳本綁定的私有 Google Sheet 中，**從未、也不會**出現在這個 repo 裡。

原始碼本身依照「一切可配置，不可寫死」的原則撰寫：所有試算表 ID、資料夾 ID、
電郵地址等設定，一律透過腳本綁定試算表中的 `Config` 工作表讀取（`getConfig()`），
不會寫死在程式碼裡。要執行這份程式碼，你需要自備一份符合對應欄位結構的 Google Sheet，
並在 `Config` 工作表填入自己的設定值。

## 技術棧

- **執行環境**：[Google Apps Script](https://developers.google.com/apps-script)（V8 runtime），綁定於一份 Google Sheet
- **語言**：JavaScript（`.gs`），搭配少量 `HTML Service`（`.html`）做輔助介面
- **部署工具**：[`clasp`](https://github.com/google/clasp)（Google 官方 CLI，用於本機原始碼與 Apps Script 專案之間同步）
- **資料層**：全部資料存於 Google Sheet 的多個工作表（Config、Quarters、NameMapping、
  Eligibility、ServiceDates、Requests、SendLog、EmailTemplates、RosterAssignments 等），
  沒有外部資料庫
- **對外服務**：`MailApp`（寄送通知電郵）、`DriveApp`（產生並存放 PDF 職事表）、
  `SpreadsheetApp`（讀寫試算表、自訂選單）

## 五階段流程

系統的核心是一個不可逆的狀態機（`Quarters.Stage`），依序推進：

| 階段 | 說明 | 觸發方式 |
|---|---|---|
| 1. 生成初稿 | 依規則自動排出一份職事表初稿 | 幹事按掣（或自動排程於指定日期執行） |
| 2. 寄給堂委審閱 | 把初稿連同完整版 PDF 寄給指定審閱者 | 幹事按掣 |
| 3. 套用修改申報 | 讀取「不能服侍」／「指定服侍」申報，驗證後套用，產生新版本 | 幹事按掣，可重複執行 |
| 4. 正式發出 | 寄出個人化職事表通知（含個人版 PDF）給每位有服侍的義工 | 幹事按掣，**永不由自動排程觸發** |
| 5. 改動後重發 | 正式發出後如有人手變動，套用申報、產生新版本，只通知有改動的人 | 幹事按掣，可重複執行、無次數限制 |

每個階段都有明確的前置 Stage 檢查，狀態只能依序前進（步驟 3 例外，允許重複停留）。
所有寄送動作都受 `Config` 的 `DRY_RUN` 開關保護——開啟時只會把「本應寄出」的內容
寫入 SendLog 供核對，不會真正呼叫 `MailApp.sendEmail()`。

## 其他功能

- 職事表產生演算法支援多輪嘗試取最佳解、可調整的軟／硬規則權重
- 個人版與完整版 PDF 自動匯出、分批產生（避開 Apps Script 單次執行時間上限）、
  失敗自動重試與完整性核對
- 內建自我測試（選單「測試工具 ▸ 自我測試」）與多項唯讀診斷工具
- 每次寄送都留有 SendLog 紀錄，供事後核對「誰在什麼時候收到了什麼」

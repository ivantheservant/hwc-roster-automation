# Web UI 現況調查（第二十二輪批次階段 E）

**這份報告只讀不改，調查過程一行程式碼都沒有動過。** 目的是給下一輪
Web UI 介面改造設計參考，所以寫得比較詳細。

背景：真正操作系統的人是幹事，不是 Ivan，2026 年 11 月中之前要教識他；
2027T1 會用簡化後的 Web UI 上線，現有選單流程全部保留作安全網。

---

## 1. 檔案分工

| 檔案 | 負責什麼 |
|---|---|
| `src/WebApp.gs` | 三層安全模型（部署權限／`WEBAPP_ENABLED`／白名單）、`doGet()` 入口與分流、深色模式偏好、季度與版本清單、職事表 grid 唯讀資料、核對職事表、檢查改動——這五個較「工具型」的 api* 函式住在這裡，跟五步驟流程（`WebAppFlow.gs`）分開 |
| `src/WebAppFlow.gs` | 五步驟流程（步驟 1 唯讀顯示、步驟 2–5 完整操作）的全部 `api*` 函式。只負責「HTTP 請求進來、把 `FiveStageCore.gs` 的結果整理成前端看得懂的 JSON、把前端的選擇轉呼叫回 `FiveStageCore.gs`」——業務規則一律不在這裡重複實作 |
| `src/WebAppPersonalLink.gs` | 義工「個人專屬連結」：token 產生／查核／重新產生、`doGet()` 帶 `p` 參數時的唯讀渲染入口（`renderPersonalRosterPage_()`），安全模型與幹事介面完全獨立（靠 token 不可猜，不靠 Google 身分） |
| `src/ui/Index.html` | 幹事介面的唯一頁面骨架：頂部工具列（季度選單、Stage／DRY_RUN 徽章、重新整理、深色模式切換掣）＋步驟卡片區＋一個共用的「精靈視窗」容器。本身幾乎沒有邏輯，只是 `includeHtml()` 拼裝 `Style`／`Script` 兩個片段 |
| `src/ui/Script.html` | 幹事介面**全部**前端邏輯（807 行）：狀態管理、五步驟卡片渲染、每一步的精靈視窗流程、深色模式切換、`google.script.run` 呼叫包裝 |
| `src/ui/Style.html` | 幹事介面的 CSS，含深色/淺色雙套變數（跟裝置設定自動切換 + 手動覆寫兩種模式並存） |
| `src/ui/PersonalRoster.html` | 義工個人專屬連結頁面：轉置後的職事表（崗位做列、日期做欄）＋自己的服侍摘要＋圖例，伺服器端渲染好整頁再送出，前端零 JS 呼叫 |
| `src/ui/PreacherFillSidebar.html` | **不屬於 Web App**——這是 Google 試算表側邊欄（`SpreadsheetApp.getUi().showSidebar()`），用來填講員／翻譯／獻花。跟 `doGet()` 完全是兩條獨立的 HtmlService 入口 |

---

## 2. 全部 `api*` 函式清單

**共 25 個**，全部第一行都呼叫 `assertWebAppRequestAllowed_()`（已用
`tests/webapp_access_guard.test.js` 自動掃描鎖住，逐一核對過原始碼，
沒有例外）。

⚠️ **6 個從未被前端呼叫過**（用 `grep callServer(...)` 對照全部
`api*` 定義得出，見下表「前端呼叫」欄）：

| 函式 | 檔案 | 輸入 | 回傳結構（摘要） | 前端呼叫 |
|---|---|---|---|---|
| `apiGetThemePreference` | WebApp.gs | — | `'dark'／'light'／''` | ✅ Script.html `initThemeToggle()` |
| `apiSetThemePreference` | WebApp.gs | theme | — | ✅ Script.html `initThemeToggle()` |
| `apiListQuarters` | WebApp.gs | — | `[{quarterId, status, startDate, endDate, latestVersionNo}]` | ✅ `loadQuarters()` |
| `apiListVersions` | WebApp.gs | quarterId | `[{versionNo, sheetName, basis, status, warningCount}]` | ❌ **未使用** |
| `apiGenerateRoster` | WebApp.gs | quarterId | 生成結果統計 | ❌ **未使用**（步驟 1 在 Web UI 一律唯讀顯示，見檔頭說明） |
| `apiGetRosterGrid` | WebApp.gs | quarterId, versionNo | `{headers, rows}`（grid 表格） | ❌ **未使用** |
| `apiVerifyRoster` | WebApp.gs | quarterId, versionNo | 核對報告 | ❌ **未使用** |
| `apiDetectChanges` | WebApp.gs | quarterId, versionNo | fine-tune 建議 | ❌ **未使用** |
| `apiGetFlowState` | WebAppFlow.gs | quarterId | 五步驟卡片狀態 | ✅ `loadFlowState()` |
| `apiStep2Preview` | WebAppFlow.gs | quarterId | 確認畫面資料 | ✅ `openStep2()` |
| `apiStep2Confirm` | WebAppFlow.gs | quarterId | 寄送結果 | ✅ `confirmStep2()` |
| `apiStep3Plan` | WebAppFlow.gs | quarterId | 依情況回傳不同 mode | ✅ `openStep3()` |
| `apiStep3Decline` | WebAppFlow.gs | quarterId | `{recorded}` | ✅ `step3Decline()` |
| `apiStep3Apply` | WebAppFlow.gs | quarterId, acceptConfirmList | 套用結果 | ✅ `step3Apply()` |
| `apiStep3Release` | WebAppFlow.gs | quarterId, releaseText | 是否前進 | ✅ `step3Release()` |
| `apiStep4GetPendingWarnings` | WebAppFlow.gs | quarterId | 未完成事項警告 | ✅ `openStep4()` |
| `apiStep4GetMissingPdfWarnings` | WebAppFlow.gs | quarterId, versionNo | PDF 缺件檢查 | ✅ `step4CheckMissingPdf()` |
| `apiStep4GetSendPreview` | WebAppFlow.gs | quarterId, versionNo | 收件人數／DRY_RUN | ✅ `step4SendPreview()` |
| `apiStep4Confirm` | WebAppFlow.gs | quarterId | 寄送結果 | ✅ `step4Confirm()` |
| `apiStep5Plan` | WebAppFlow.gs | quarterId | 是否有待處理申報 | ✅ `openStep5()` |
| `apiStep5Decline` | WebAppFlow.gs | quarterId | `{recorded}` | ✅ `step5Decline()` |
| `apiStep5Apply` | WebAppFlow.gs | quarterId, acceptConfirmList | 套用結果 | ✅ `step5Apply()` |
| `apiStep5CheckRelease` | WebAppFlow.gs | quarterId, releaseText | 放行文字是否正確 | ❌ **未使用**（前端直接呼叫 `apiStep5GeneratePdfs`／`apiStep5SendConfirm`，兩者本身已經各自重新驗證放行文字，見下） |
| `apiStep5GeneratePdfs` | WebAppFlow.gs | quarterId, releaseText | PDF 產生進度 | ✅ `step5GeneratePdfs()` |
| `apiStep5SendPreview` | WebAppFlow.gs | quarterId | 3/3 確認畫面資料 | ✅ `step5SendPreview()` |
| `apiStep5SendConfirm` | WebAppFlow.gs | quarterId, releaseText | 寄送結果 | ✅ `step5SendConfirm()` |

**這 6 個未使用函式對下一輪的意義**：`apiListVersions`／`apiGetRosterGrid`／
`apiVerifyRoster`／`apiDetectChanges` 都是完整可用、有正確安全檢查的
後端端點，只是從未接過前端——如果下一輪要在 Web UI 加「查看職事表格子」
「核對」「檢查改動」這類功能，後端幾乎不用重寫，直接接前端就能用。
`apiGenerateRoster` 目前刻意不接（步驟 1 設計上唯讀），除非下一輪決定
改變這個設計決策。`apiStep5CheckRelease` 是重複建設——它做的事
`apiStep5GeneratePdfs`／`apiStep5SendConfirm` 已經各自做一次，可以考慮
直接移除或者留給前端做「打字時即時驗證」的體驗優化用途。

---

## 3. 前端狀態（`ui/Script.html`）

**沒有框架，純手寫 vanilla JS**，狀態管理非常簡單：

- **全域狀態只有兩個變數**：`currentQuarterId`（目前選中的季度）、
  `currentFlowState`（`apiGetFlowState()` 最近一次的完整回傳，供渲染
  用；但實際上大部分精靈視窗流程都是「重新問伺服器要最新資料」，不太
  依賴這個快取值本身）。
- **沒有前端路由**，畫面就是「頂部季度選單 + 步驟卡片區 + 一個共用的
  精靈視窗容器」三塊固定區域，靠 `renderXxx()` 系列函式直接清空重繪
  對應的 DOM 節點（`el('steps')`、`el('wizardBody')`），不是虛擬 DOM
  diff。
- **刷新機制**：`loadFlowState()` 是唯一的「重新問伺服器要五步驟狀態」
  入口，幾乎每個動作完成或取消之後都會呼叫 `closeWizardAndRefresh()`
  （= 關精靈視窗 + 呼叫 `loadFlowState()`）。**沒有輪詢、沒有
  WebSocket**——單人操作情境下這樣已經足夠，但代表如果日後多人同時用
  Web UI，某人操作完不會自動通知另一個人的畫面更新（跟選單版本靠人手
  重新整理試算表分頁是同一種侷限）。
- **精靈視窗（wizard）怎樣串起來**：每一步都是「呼叫一個 `apiXxx()` 讀
  資料 → `renderWizard([...])` 畫出這一畫面 → 使用者按按鈕觸發下一個
  `apiXxx()` 呼叫 → 再 `renderWizard()` 換下一畫面」，是一條手寫的
  callback 鏈，不是狀態機模式（沒有集中的「目前在哪一步」的 enum）。
  每個 `stepNContinue...()`／`stepNApply()`／`stepNXxx()` 函式都直接
  知道下一步要呼叫什麼，靠函式呼叫串接，不是靠讀某個 state 變數決定
  下一步渲染什麼。這跟選單版本（`FourStageFlow.gs`）的多輪
  `ui.alert()`／`ui.prompt()` 對話框序列在概念上是一一對應的移植，只是
  換成非同步 JS 版本。
- **`runAction(label, action)`** 是唯一的「忙碌狀態 + 錯誤處理」共用
  包裝，全部會呼叫伺服器的動作都要包一層，兩處遺漏過（見 Script.html
  第 76-87、423-430 行的收尾輪修正註解）——**下一輪如果重寫，這個
  「所有非同步呼叫都必須經過統一的 busy/error 處理」的原則值得保留**，
  但目前是靠人手記得包，沒有結構性強制，容易再漏。

---

## 4. 現時五個步驟的畫面流程

| 步驟 | 畫面數 | 每個畫面問什麼 | 有沒有打字確認 |
|---|---|---|---|
| 1：生成初稿 | 1（唯讀卡片，非精靈視窗） | 只顯示「已有版本 vN，建立時間 X」或「尚未生成」，沒有按鈕 | 不適用（Web UI 沒有人手入口） |
| 2：寄給堂委審閱 | 2（確認 → 完成） | 1：QuarterID／版本號／收件人數／DRY_RUN／已寄紀錄警告；2：寄出統計 | 沒有——一個「確定寄出」按鈕即可 |
| 3：套用修改申報 | 最多 4（1/3 驗證 → 子問題「未曾任該崗位」是否接受 → 完成/放行盒） | 1/3：可套用／需確認／無法套用三份清單；子問題：CONFIRM 類別是否全接受；完成：套用統計＋規則違反清單；如未前進，出現放行輸入框 | **有**——硬規則違反時要求打字「確認放行」（`RELEASE_PHRASE`）才能繼續，跟選單版本一致 |
| 4：正式發出 | 最多 4（未完成事項警告 → PDF 缺件警告 → 確認寄送 → 完成） | 待處理申報／待補格子警告；PDF 缺件名單；收件人數／DRY_RUN；寄送統計＋結論句 | 沒有（第十九輪的缺件比例硬性上限取代了打字確認——超過上限直接擋，不是要求打字繼續） |
| 5：改動後重發 | 最多 6（1/3 驗證 → 子問題 → 2/3 套用完成/放行盒 → 產生 PDF 進度 → 3/3 確認寄送 → 完成） | 跟步驟 3 類似的申報套用流程，加上「產生個人 PDF」（可能要按時間預算分批、重複呼叫）與「哪些人有改動需要通知」清單 | **有兩道**——套用完成後如有硬規則違反要打字放行；產生 PDF 與寄送兩處各自獨立重新驗證放行文字，就算前端跳過中間畫面直接呼叫也擋得住 |

**共用元件**：`renderViolations()`（硬規則／準硬規則分兩節顯示）、
`renderReleaseBox()`（打字放行輸入框）、`renderRequestList()`（申報清單）
——這三個渲染函式被步驟 3、4、5 共用，下一輪重寫時值得保留同一種
「共用小元件」的做法，不要每個步驟各自重畫一遍相似的清單/放行框。

---

## 5. 可以直接重用 vs 要重寫

以下按 Ivan 描述的目標四區逐項評估：

### 區一　日常四個掣：儲存並確認／寄給堂委審閱／正式發出給全體／改動後重發

| 項目 | 評估 | 理由 |
|---|---|---|
| 寄給堂委審閱（步驟 2） | ✅ **直接重用** | `apiStep2Preview`／`apiStep2Confirm` 已完整、已測試、已經是「一個按鈕、一次確認」的最簡形式，跟目標形態幾乎一致 |
| 正式發出給全體（步驟 4） | ✅ **直接重用** | 同上，`apiStep4*` 系列已經是完整流程；PDF 缺件保護（第十九輪）已內建 |
| 改動後重發（步驟 5） | ✅ **後端直接重用，前端可簡化** | `apiStep5*` 系列完整、有兩道硬規則關卡；如果目標是把「套用申報」「產生 PDF」「寄送」壓縮成使用者只需按一次「改動後重發」，前端可以把現在 6 個畫面自動串起來（背景依序呼叫這幾個 api，只在真正需要人手決定時才停下來問——例如硬規則放行、CONFIRM 類別是否接受），後端完全不用改 |
| **儲存並確認** | ⚠️ **要新建，但可以重用既有邏輯積木** | Web UI 目前完全沒有「幹事直接改職事表格子」這件事——`apiGetRosterGrid` 只能唯讀顯示，沒有任何寫入路徑。但選單版本已經有完整的「人手改動 grid → 偵測改動 → 寫成新版本」邏輯（`StateSource.gs` 的 `analyseManualState_()`／`materialiseManualEdits_()`，第十九、二十輪修過的那一套），這一套是純粹的資料處理函式，不碰 UI，理論上可以直接被新的 `apiXxx()` 包裝呼叫。真正要新建的是**前端一個可編輯的表格元件**（目前 Web UI 完全沒有任何可編輯表格，`apiGetRosterGrid` 回傳的 grid 資料目前設計上只用來畫唯讀表格，見下方第 6 點欄位形狀），這是這一區唯一真正的「從零開始」工作 |

### 區二　開季前準備：確認合堂日期、填講員翻譯獻花、檢查名單

| 項目 | 評估 | 理由 |
|---|---|---|
| 填講員／翻譯／獻花 | ⚠️ **後端直接重用，需要搬家** | `PreacherFillSidebar.html` 已經是功能完整、已實測過的介面，但它是**試算表側邊欄**（`SpreadsheetApp.getUi().showSidebar()`），不是 Web App 的一部分，`doGet()` 完全碰不到它。要整合進 Web UI，前端要重新用 Web UI 的樣式系統畫一次畫面（HTML／CSS 大部分可以照搬，只是入口機制不同），後端讀寫邏輯（`PreacherTranslationFill.gs`）應該可以原封不動重用 |
| 確認合堂日期（SpecialSundays.Confirmed） | ❌ **要新建** | 目前完全只有選單工具（`AnnualCombined.gs` 一類），沒有任何 `api*` 包裝，也沒有前端畫面。後端讀寫函式應該可以重用，但要新寫 `apiXxx()` 與前端表單 |
| 檢查名單 | ❌ **要新建** | 現有「查看」子選單一堆唯讀檢查工具（`PreLaunchChecklist.gs`／`RoleImpact.gs` 等）都是 `ui.alert()` 對話框，沒有 Web UI 版本。後端邏輯可重用（本來就是純函式＋讀表），純粹是缺 `api*` 包裝與前端呈現 |

### 區三　名單維護：人員與電郵／崗位資格／身分（堂委執事）／不能服侍日期／個人崗位排除

**❌ 全部要新建，這是四區之中缺口最大的一區。**

現時完全沒有任何 Web UI 入口能編輯 `NameMapping`／`Eligibility`／
`Roles`／`Unavailable`／`PersonPostExclusions` 這五張表——幹事目前
一律直接在 Google 試算表工作表上編輯儲存格。後端有齊讀取函式
（`readPeople()`、`readEligibilityNormalized()` 等，散落在 `SheetReader.gs`），
但完全沒有對應的寫入 `api*` 函式，也沒有任何前端表單。這一區是**唯一
連後端 API 層都要從零設計**的部分（其他三區大多是「後端有、前端沒有」
或「兩邊都有、只是接不上」），需要下一輪認真評估安全性（寫入敏感個人
資料的 Web 表單，要考慮輸入驗證、AuditLog 記錄、以及是否要跟現有
Requests 系統的申報流程整合，而不是直接改動基礎資料表）。

### 區四　進階功能（收摺）：現有工具的 Web 版，含「回到上一個版本」

| 項目 | 評估 | 理由 |
|---|---|---|
| 大部分唯讀查看工具（AuditLog 摘要、Config 檢查、上線前檢查……） | ⚠️ **後端幾乎全部可重用** | 這些工具全部都遵守本專案一貫的「plan 函式純讀取、run 函式包 UI」慣例（本輪 D2 的 `planConfigBaselineCheck_()`／`runConfigBaselineCheck_()` 就是這個慣例的最新例子）。`plan*_()` 系列函式本身跟 UI 無關，理論上換一層 `apiXxx()` 包裝就能在 Web UI 呈現，工作量主要在前端要畫多少種不同格式的報表 |
| 會寫入的維護工具（重設季度測試資料、清理舊 PDF……） | ⚠️ **要重新設計確認流程** | 選單版本靠 `ui.alert()` 逐字輸入確認（例如 `QUARTER_RESET_CONFIRM_TEXT`），Web UI 已經有 `renderReleaseBox()` 這個現成的「打字確認」元件可以直接套用同一種互動模式，不需要另外發明 |
| **回到上一個版本** | ❌ **全新功能**（menu 版本也沒有） | 見下方第 8 點詳細評估 |

---

## 6. 前端硬編碼檢查

**沒有找到任何硬編碼的季度／版本／PersonID。** 全部 `src/ui/*.html`
逐一 grep 過 `2026T`／`2027T`／`P[0-9]{3,}`／`'v[0-9]'` 這類樣式，
唯一命中的是 `PreacherFillSidebar.html` 裡解釋 escaping bug 的**註解**
本身提到 `"2026T4"` 當範例，不是真正寫死在程式邏輯裡。全部季度／版本
資訊都是執行時從 `apiListQuarters()`／`apiGetFlowState()` 等動態取得。

---

## 7. HtmlService 樣板逃逸的既有處理

Apps Script 的 HtmlService 樣板有兩種輸出標籤：`<?= x ?>`（自動 HTML
escape）與 `<?!= x ?>`（不 escape，原樣輸出）。用錯方向會有兩種相反的
風險——該轉義的不轉義（XSS），或者不該轉義的被轉義（第十九輪
`PreacherFillSidebar.html` 撞到的那種：`JSON.stringify()` 產生的合法 JS
字面值被當成 HTML 內容轉義，變成語法錯誤令整個 script 區塊死掉）。

逐一核對現有四個會渲染樣板的檔案：

| 檔案 | 用法 | 是否正確 |
|---|---|---|
| `ui/Index.html` | `<?!= includeHtml('ui/Style') ?>`／`<?!= includeHtml('ui/Script') ?>` | ✅ 正確——這兩個是要原樣插入的 CSS／JS 內容，不是使用者資料，本來就不應該轉義 |
| `ui/PersonalRoster.html` | 逐一資料欄位（`data.quarterId`／`item.serviceDate`／`cell.text` 等）用 `<?= ?>`；只有第 169 行組 `class`／`style` 屬性字串（`cell.mine ? ' class="mine"' : ...`）用 `<?!= ?>` | ✅ 正確——資料值一律轉義防 XSS，唯一不轉義的那處是程式碼自己組出來的 HTML 屬性片段（不是使用者輸入），符合「組 HTML 標籤本身要用不轉義版本」的慣例 |
| `ui/PreacherFillSidebar.html` | `var QUARTER_ID = <?!= JSON.stringify(quarterId) ?>;` | ✅ 正確（第十九輪修正過），且檔案內留了完整的中文說明解釋點解一定要用呢個標籤，值得作為下一輪新樣板的參考範例 |
| `ui/Script.html` | 純 `<script>` 片段，本身不是獨立樣板（由 `Index.html` `include`），沒有任何 `<?= ?>`／`<?!= ?>` | 不適用 |

`tools/scan-static-risks.js` 規則 1 已經涵蓋這個檢查（掃全部 `ui/*.html`
的 `<?= ?>` vs `<?!= ?>` 使用模式），本輪執行結果 0 項發現，
可以放心作為既有防線。

---

## 8. 「回到上一個版本」的可行做法評估

**目前選單版本與 Web UI 版本都沒有這個功能**，需要從零設計。以下是
讀 v(N-1) 的 `RosterAssignments` 重寫 grid、建立新版本、不刪任何舊版本
這個做法的可行性評估。

### 會用到的既有函式（全部可重用，不需要改動）

| 函式 | 檔案 | 用途 |
|---|---|---|
| `readVersionAssignmentsForGrid_(quarterId, versionNo)` | RosterWriter.gs | 讀出指定版本的完整派工資料，格式已經是 `writeAssignments()`／`createRosterSheet()` 要的形狀 |
| `writeAssignments(quarterId, versionNo, assignments)` | RosterWriter.gs | 把派工結果附加寫入 `RosterAssignments` 長表（**只 append，不覆寫**，符合本專案一貫的「不改動既有資料列」原則） |
| `createRosterSheet(quarterId, versionNo, assignments, warnings)` | RosterWriter.gs | 建立新的 grid 工作表並填色、加圖例 |
| `registerVersion(quarterId, versionNo, sheetName, basis, parentVersionNo, warningCount, isProtected, notes)` | RosterWriter.gs | 在 `RosterVersions` 登記新版本一列，`basis` 欄可以填一個新值（例如 `ROLLBACK`）清楚標示這個版本是怎麼來的 |
| `findLatestVersionNo(quarterId)` | RosterWriter.gs | 算出新版本應該是幾號（最新版本號 + 1） |

**做法骨架**（沒有寫成程式碼，只是設計方向）：讀 v(N-1) 的派工資料 →
以「最新版本號 + 1」為新版本號，呼叫 `writeAssignments()` 寫入完全相同
的內容 → `createRosterSheet()` 建立對應 grid → `registerVersion()` 登記，
`basis` 標明「回到 v(N-1)」、`parentVersionNo` 填目前最新版本號（誠實
記錄「這個版本是從哪裡回退來的」，不是假裝它是 v(N-1) 本身）。

### 會踩到的既有機制

- **Stage 檢查**：跟其他建立新版本的動作一樣，應該套用
  `requireQuarterStage_()`——但要先決定「回到上一個版本」在哪些 Stage
  可以用。如果只允許在 `REQUESTS_APPLIED`／`OFFICIAL_SENT` 用（即步驟
  3、5 的情境），做法上跟步驟 3、5 現有的「套用改動 → 建立新版本」
  流程一致；如果要允許在更早的 Stage 用，要另外設計。
- **硬規則放行機制**：回退到的版本內容本身**理論上一定合規**（它是
  之前已經通過檢查、甚至已經寄出過的版本），所以照理不需要放行流程。
  但保守起見，建議仍然呼叫一次 `findStateViolations_()` 重新檢查
  （防止「這一版本在生成之後、規則設定又改變了」這種第二十一輪剛修過
  的情境——見 `HardViolationClass.gs` 的三分類設計），如果真的驗出
  違反，走跟步驟 3、5 相同的放行流程，不要假設「舊版本一定沒問題」。
- **v0 保護**：如果 v(N-1) 剛好是 v0 且已被保護（`Protected=TRUE`），
  `readVersionAssignmentsForGrid_()` 只是讀取，不會受保護狀態影響——
  保護只限制「改動 v0 本身」，不限制「讀取 v0 的內容去建立一個新版本」。
- **PDF／SendLog 的一致性**：回退之後的新版本是「全新版本號」，跟
  `PdfBatch.gs`／`Mailer.gs` 既有的「PDF 檔名內嵌版本號」設計完全相容
  （第十九輪已經確認這個設計本身是正確的，見
  `docs/系統範圍稽核.md`）——回退版本的 PDF 會被當成全新版本重新產生，
  不會跟舊版本的 PDF 混淆。

### 風險

- **語意上「回到上一個版本」容易被誤會成「刪除／取代」**，但實際做法
  是新增一個內容相同的版本，舊版本原封不動保留——這一點在 UI 文案上
  一定要講清楚，避免幹事以為自己在「復原」而緊張，或者以為這樣做會
  影響已經收到舊版本通知的義工（不會，因為沒有自動觸發任何寄送）。
- **v(N-1) 要回到多遠？** 如果只做「回到上一版」（N-1），做法簡單；
  如果要讓幹事選任意一個更早的歷史版本，前端要多一個版本選擇器，
  後端邏輯不變（`readVersionAssignmentsForGrid_()` 本來就支援任意
  `versionNo`）。
- **這個功能目前完全沒有測試覆蓋**（因為完全不存在），下一輪設計時
  應該跟其他寫入類工具一樣，先寫 `plan*_()` 純函式版本並補離線測試，
  再包 `execute*_()`／`api*()`，遵守本專案一貫的「先算後做」慣例。

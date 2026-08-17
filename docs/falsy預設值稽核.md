# falsy 預設值稽核（第二十二輪批次階段 C）

## 這份文件是查什麼

JavaScript 的 `X || fallback` 寫法，判斷嘅係 `X` 是否 **falsy**——`false`、
數字 `0`、空字串 `''`、`null`、`undefined` 全部一視同仁。如果 `X` 本身可能係
一個「有意義嘅假值」（例如一格 checkbox 打了 `false`，或者一個數量真係
`0`），呢種寫法會靜靜把佢當成「冇值」，用 fallback 頂替。

**本專案已經因為呢個 bug class 出過事兩次**：第十八輪
`countHardViolations_` 漏傳 `roles`（`context.roles || []` 把漏傳同「真係
冇身分」混埋一齊）；本輪（第二十二輪）階段 B 撞到 `QuarterReset.gs` 把
Eligibility.Active 的 `false` 印成空白。

呢份文件係全 `src/` 掃一次同一個寫法家族，逐類判斷邊啲安全、邊啲要修。

## 掃描結果總數

| 寫法 | 出現次數 |
|---|---|
| `X \|\| ''`（或 `""`） | 363 |
| `X \|\| 0` | 99 |
| `X \|\| []` | 75 |
| `X \|\| {}` | 32 |
| `X \|\| null` | 8 |
| `X \|\| false` | 0 |
| **總數** | **577** |

遠超過 60 處。按指示：**「會顯示給人看的值」呢一類全部逐個判斷並修正**；
其餘按寫法分類、講清楚點解安全，唔逐行修改。

---

## 一、已修正：會顯示給人看的值（5 處）

呢 5 處全部係**布林值或數字**經過 `\|\| ''` 被吞成空字串，畫面會印出
「欄位名稱=」而睇唔到實際值——同第十八輪、本輪 B1 完全同一個 bug class。

| 檔案：行號 | 原式 | 判斷 | 處理方式 |
|---|---|---|---|
| `QuarterReset.gs:187`（B1） | `String(row[E.ACTIVE] \|\| '').trim()` | Eligibility.Active 係 boolean，`false` 會印成「Active=」 | 改用 `displayCellValue_()`：`false` 顯示 "false"，唔會顯示做空白 |
| `QuarterReset.gs:188`（B2） | `String(row[E.ADDED_AT] \|\| '').trim()` | AddedAt 係 Date 物件，直接 `String()` 印出成串英文長格式 | 改用 `toDateString()`，輸出 `yyyy-MM-dd` |
| `Diagnostics.gs:246` | `String(v[V.PROTECTED] \|\| '')` | RosterVersions.Protected 係 boolean，`false` 會印成「Protected=」——「查看各版本派工紀錄」報告入面睇落好似冇呢個欄位 | 改用 `displayCellValue_()` |
| `Diagnostics.gs:245` | `String(v[V.PARENT_VERSION_NO] \|\| '')` | ParentVersionNo 係數字，v1 嘅 Parent 係 v0 時（合法值 `0`）會印成「Parent=v」，個數字不見咗 | 改用 `displayCellValue_()` |
| `Diagnostics.gs:247` | `String(v[V.CREATED_AT] \|\| '')` | CreatedAt 係 Date 物件，直接 `String()` 印出成串英文長格式 | 改用 `toDateString()` |

**共用的修正 helper**：`displayCellValue_(value, fallback)`（`Utils.gs`）——
只有 `null`／`undefined`／空字串先用 fallback（預設「（空白）」），`false`
同 `0` 一律照原樣顯示。**呢個係顯示用嘅 helper，唔負責業務判斷**——
「呢一行是否啟用」呢類邏輯仍然要用 `isTrueValue_()`。

回歸測試：`tests/quarter_reset_display_fixes.test.js`（5 種輸入
`false`／`0`／`''`／`null`／Date 物件 各一個 case，加正式碼有真係改用新寫法
嘅靜態掃描）。

---

## 二、按寫法分類：為什麼其餘的安全

### 2.1 `X || 0`（99 處）——安全，數字類累加／讀取

絕大多數係兩種形狀：

**(a) 累加計數器**：`counts[key] = (counts[key] || 0) + 1;`
`counts[key]` 未出現過時係 `undefined`，`undefined || 0` = `0`，加一之後
變成 `1`——同「呢個 key 本來就存在、目前係 0」得出嘅下一步結果完全一樣。
**`0` 同「未出現過」喺呢種寫法之下係等價嘅，冇資訊流失。**

**(b) 讀取一個本身可能就係 0 嘅數字設定**（例如 Tolerance、RandomSeed、
VersionNo、EarlyArrivalMinutes）：`Number(x) || 0`。呢種寫法嘅特性係
**如果 `x` 本身真係 `0`，fallback 都係 `0`，結果冇分別**——同 B1 嗰種
「fallback 同真實值唔一樣」（`false` → `''`）唔同，呢度 fallback 同真實值
撞埋一齊，唔會有資訊流失。

⚠️ 唯一要留意嘅係 `Number(x)` 本身：如果 `x` 係非數字亂碼，
`Number(x)` 會係 `NaN`，`NaN || 0` 會靜靜變成 `0`。呢個唔係「假值被吞」，
係「無效輸入被吞」，屬於另一個 bug class（唔喺本輪範圍），列喺底下
「待處理」。

**代表性檔案**：`Generator.gs`（Tolerance／RandomSeed／VersionNo）、
`Verify.gs`（Tolerance）、`SoftRuleMetrics.gs`（累加計數）、
`Mailer.gs`／`PdfBatch.gs`（retries／highlightMs 累加）、
`DraftReviewReport.gs`（格數統計，會顯示俾堂委睇，但因為係「本身可能
就係 0」嘅計數，`0 \|\| 0 = 0`，冇資訊流失，安全）。

### 2.2 `X || []` 同 `X || {}`（共 107 處）——安全，容器天生係 truthy

**關鍵事實：JavaScript 入面空陣列 `[]` 同空物件 `{}` 都係 truthy。**
即係話 `X || []` 呢個 fallback **只會喺 `X` 係 `undefined`／`null`／`''`／
`0`／`false` 先會觸發**——如果 `X` 已經係一個空陣列，`[] || []` 會直接
攞返原本嗰個 `[]`，fallback 完全冇機會出手。

所以呢種寫法唔會出現「本來有意義嘅空陣列被錯誤頂替」嘅情況——結構上
唔可能發生。

絕大部分實例係「字典查詢、呢個 key 未出現過」呢種形狀：
`eligibility.byPost[postId] || []`、`state.weekByPost[postId] || []`、
`byQuarter[quarterId] || []`。呢個 key 未出現過，語意上**本來就等於
「呢個分組目前係空」**——`[]` 正正就係正確答案，唔係將就出嚟嘅 fallback。

第十八輪嗰個真 bug（`context.roles || []`）唔屬於呢種形狀——嗰個係
「單一物件應該有嘅欄位，冇咗代表上游有 bug」，唔係「字典查唔到 key」。
本輪逐個核對，冇搵到第二個同類形狀嘅實例（已修正嗰個仍然生效，
見 `Roles.gs:334`、`Tune.gs:161` 嘅檔頭說明）。

### 2.3 `X || ''`（363 處）——絕大部分安全，文字欄位

已經針對「布林／數字被錯當成文字」呢個具體風險（同已修正嗰 5 處
一樣嘅形狀）逐一 grep 過全部已知嘅布林／數字欄位常數
（`ACTIVE`、`ENABLED`、`PROTECTED`、`IS_*`、`*_NO`、`*_COUNT`、`*_INDEX`、
`*_MINUTES` 等），**除咗已修正嗰 5 處，冇搵到第二個**。

其餘全部係文字欄位本身（人名、PersonID、備註、狀態文字、日期已經
正規化之後嘅字串）用 `\|\| ''` 頂替「未填寫」，呢個正正係文字欄位嘅
正確語意——**空字串就係「冇值」冇歧義**，唔存在「有意義嘅假值」呢個
問題。

### 2.4 `X || null`（8 處）——安全，字典查詢／函式回傳值正規化

`aliasMap[name] || null`、`(...)[0] || null` 呢類，全部係「查唔到就明確
回傳 `null`」，用嚟同「查到咗但個值本身係 falsy」分辨——但呢啲欄位
（別名、PersonID）本身唔可能合法地係 `0`／`false`，所以冇風險。

---

## 三、待處理（非本輪範圍，記錄低待日後處理）

呢幾項唔屬於「假值被吞」呢個 bug class，但掃描過程中順帶發現，值得
記錄低：

1. **`Number(x) || 0` 嘅 `NaN` 吞沒風險**（見 2.1）——如果 Config 或
   RuleSettings 嘅數字欄位被人手打錯成非數字文字，會靜靜變成 `0`，
   而唔係報錯。影響範圍：`RANDOM_SEED`、`TOLERANCE` 等經人手維護嘅
   數字設定。建議：日後可以喺 `getConfig()` 或者讀取呢類欄位嗰陣
   加一個「讀出嚟係 `NaN` 就寫入 Diagnostics 警告」嘅檢查，但呢個屬於
   「無效輸入處理」，同今日呢個「假值被吞」嘅 bug class 唔係同一件事，
   本輪唔展開。

2. **`findQuarter_(quarterId) || {}`（`Mailer.gs:198`）同類「函式查唔到
   就回傳空物件」寫法**——如果季度真係唔存在，下游讀 `quarter.xxx`
   會靜靜攞到 `undefined` 而唔係盡早報錯。少數幾處（`FineTune.gs`、
   `RequestsApply.gs`、`StateSource.gs` 的 `originalByKey[key] || {}`）
   屬於同類形狀，但呢啲全部係「呢一格喺原始版本入面本來就冇資料」嘅
   合法情況（新增嘅格），唔算 bug。`findQuarter_` 嗰個因為理論上
   quarterId 應該一定存在（呼叫端已經驗證過），風險較低，但值得
   日後加一個更明確嘅「查唔到就拋錯」保護。本輪唔改，因為冇實測證據
   顯示呢個曾經造成過問題，改咗反而可能喺冇心理準備嘅情況下令原本
   「安靜略過」嘅路徑變成拋錯。

這兩項都唔會阻礙上線，只係記錄低，供以後有需要時參考。

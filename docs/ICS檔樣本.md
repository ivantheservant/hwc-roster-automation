# ICS 日曆檔樣本（實際渲染結果）

呢份文件係**用虛構資料實際呼叫 `buildIcsCalendarText_()`**
（`src/IcsExport.gs`，同真正寄信時用緊嘅係同一個函式，唔係抄一份
副本）產生嘅完整 `.ics` 內容。目的係喺步驟 4「正式發出」第一次
真正寄出帶 ICS 附件嘅信之前，先有人讀過實際內容——ICS 功能已經
實作咗成個第十一輪批次，但從未有人睇過真正產生出嚟嘅檔案長咩樣。

產生方式：`node tests/render_ics_samples.js`。全部資料一律虛構：
姓名用「陳大文」，`PersonID` 用 `P010`，季度用 2027T1。

---

## 情境

陳大文喺 2027T1 有 4 次服侍，其中司事、音響兩個崗位設定咗提早到場
（分別 30、45 分鐘，對照 `docs/幹事操作說明.md` 記錄嘅建議值）：

| 日期 | 崗位 | 提早到場 | 預期 DTSTART（本地時間） |
|---|---|---|---|
| 2027-01-10 | 主席 | 0 分鐘 | 10:45（預設崇拜開始時間） |
| 2027-02-14 | 司事 | 30 分鐘 | 10:15 |
| 2027-03-14 | 音響 | 45 分鐘 | 10:00 |
| 2027-04-04 | 主席 | 0 分鐘 | 10:45 |

---

## E3 覆核結論（詳細討論見 docs/系統範圍稽核.md 第十三輪批次階段 E）

逐項核對（**全部用真正嘅函式輸出做斷言，唔係憑印象寫結論**——
呢份文件嘅產生器本身如果有任何一項核對唔過，會拒絕產生文件並
列印失敗原因，唔會寫低錯誤結論）：

| 檢查項目 | 結果 |
|---|---|
| 符合 RFC 5545 基本要求（CRLF、折行、VTIMEZONE、METHOD:PUBLISH） | ✅ |
| UID 跨版本穩定（同一人同一日同一崗位） | ✅ |
| SEQUENCE 隨版本遞增 | ✅ |
| 崗位提早到場分鐘數正確套用（DTSTART 提早，DTEND 唔受影響） | ✅ |
| 時區 Pacific/Auckland 正確處理夏令時間轉換 | ✅（見下面詳細分析） |
| iPhone 相容性（MIME type／檔名／MailApp 附件寫法） | ✅（見下面詳細分析） |

**冇發現任何格式問題。**

### UID／SEQUENCE 跨版本比較（步驟 4 v5 → 步驟 5 重發 v7）

第一次服侍（2027-01-10 主席）喺兩個版本嘅 UID 同 SEQUENCE：

```
v5（步驟 4 正式發出）：
  UID:2027T1-P010-2027-01-10-CHAIR-1@hwc-roster.invalid
  SEQUENCE:5

v7（步驟 5 改動後重發）：
  UID:2027T1-P010-2027-01-10-CHAIR-1@hwc-roster.invalid
  SEQUENCE:7
```

`UID` 完全一致（義工嘅日曆 App 會**更新**呢個事件，唔會當成新事件、
唔會重複），`SEQUENCE` 由 5 變 7（日曆 App 據此知道呢個係較新版本）。

### VTIMEZONE 分析（E4：夏令時間轉換）

紐西蘭 2007 年後嘅 DST 規則：9 月最後一個星期日轉夏令 NZDT
（+13:00），4 月第一個星期日轉返標準 NZST（+12:00）。呢個規則
**唔係寫死某一年嘅日期**，而係用 `RRULE:FREQ=YEARLY;BYMONTH=...;BYDAY=...`
表達成一條每年都適用嘅規則，日曆 App 收到之後會自己計算「今年
嗰個轉換日實際係幾號」：

```
BEGIN:VTIMEZONE
TZID:Pacific/Auckland
BEGIN:STANDARD
DTSTART:19700405T030000
RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU
TZOFFSETFROM:+1300
TZOFFSETTO:+1200
TZNAME:NZST
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:19700928T020000
RRULE:FREQ=YEARLY;BYMONTH=9;BYDAY=-1SU
TZOFFSETFROM:+1200
TZOFFSETTO:+1300
TZNAME:NZDT
END:DAYLIGHT
END:VTIMEZONE
```

要點：

1. **兩段規則都有**——`STANDARD`（轉返 NZST，`TZOFFSETTO:+1200`）
   同 `DAYLIGHT`（轉做 NZDT，`TZOFFSETTO:+1300`），唔係得一個寫死
   嘅 offset。
2. **`2026T4`（10-12 月）成季都喺 9 月尾轉換之後、4 月轉換之前**，
   所以全季實際上都係 NZDT——但呢個唔係樣板刻意寫死，而係嗰幾個
   月份本身就落喺 DAYLIGHT 規則嘅生效範圍入面，`.ics` 檔案本身
   完全唔需要為呢一點做任何特殊處理。
3. **`2027T1`（1-3 月，最後一次服侍可能踩到 4 月頭）先係真正會
   踩到轉換點嘅情況**——上面嘅樣本刻意將最後一次服侍放喺
   4 月頭。因為轉換規則用 `RRULE` 表達（唔係寫死日期），邊一年
   嘅 4 月幾號先係「第一個星期日」由日曆 App 自己計，本專案嘅
   程式碼完全唔需要（亦都冇辦法，因為冇任何一個服務可靠咁計到
   任意年份嘅確實轉換日）知道實際邊一日轉換。
4. **`DTSTART;TZID=Pacific/Auckland:...` 呢種寫法對轉換前後嘅日期
   格式完全一樣**（都係本地時間字串，冇 UTC offset），呢個係
   刻意嘅設計——時區換算完全交俾日曆 App 根據 VTIMEZONE 嘅
   規則自己處理，本專案嘅程式碼（`shiftIcsLocalDateTime_()`）
   完全唔需要知道邊一日轉換、轉換咗之後個 offset 係乜——呢個
   正正就係用 `TZID` 參照而唔係自己計 UTC offset 嘅意義：**轉換
   邏輯只需要定義一次（喺 VTIMEZONE），唔使喺程式碼入面重複計算**。

### iPhone 相容性

- **MIME type**：`Utilities.newBlob(icsText, 'text/calendar', fileName)`
  ——`text/calendar` 係 RFC 5545 定義嘅標準 MIME type，iOS Mail
  識別到呢個 type 會提供「加入日曆」嘅選項。
- **檔名**：`buildIcsFileName_()` 一律以 `.ics` 結尾（例如
  `2027T1_v5_服侍日曆_陳大文.ics`），
  同 MIME type 雙重確保 iOS 識別到呢個係日曆檔。
- **`MailApp` 附件寫法**：`Mailer.gs` 嘅 `sendRealEmail_()` 將 ICS
  同個人 PDF 一齊放入 `options.attachments`（陣列，`MailApp.sendEmail()`
  原生支援同一封信夾多個附件），唔需要額外處理。

---

## 完整 `.ics` 內容（步驟 4：正式發出，v5）

```
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//HWC Cantonese Congregation Roster//Roster Automation//TC
METHOD:PUBLISH
CALSCALE:GREGORIAN
BEGIN:VTIMEZONE
TZID:Pacific/Auckland
BEGIN:STANDARD
DTSTART:19700405T030000
RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU
TZOFFSETFROM:+1300
TZOFFSETTO:+1200
TZNAME:NZST
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:19700928T020000
RRULE:FREQ=YEARLY;BYMONTH=9;BYDAY=-1SU
TZOFFSETFROM:+1200
TZOFFSETTO:+1300
TZNAME:NZDT
END:DAYLIGHT
END:VTIMEZONE
BEGIN:VEVENT
UID:2027T1-P010-2027-01-10-CHAIR-1@hwc-roster.invalid
SEQUENCE:5
DTSTAMP:20270101T030000Z
DTSTART;TZID=Pacific/Auckland:20270110T104500
DTEND;TZID=Pacific/Auckland:20270110T120000
SUMMARY:主席
DESCRIPTION:2027T1 職事表\n如當日不能服侍，請盡早聯絡幹事
 安排調動。
END:VEVENT
BEGIN:VEVENT
UID:2027T1-P010-2027-02-14-USHER-1@hwc-roster.invalid
SEQUENCE:5
DTSTAMP:20270101T030000Z
DTSTART;TZID=Pacific/Auckland:20270214T101500
DTEND;TZID=Pacific/Auckland:20270214T120000
SUMMARY:司事
DESCRIPTION:2027T1 職事表\n如當日不能服侍，請盡早聯絡幹事
 安排調動。
END:VEVENT
BEGIN:VEVENT
UID:2027T1-P010-2027-03-14-AUDIO-1@hwc-roster.invalid
SEQUENCE:5
DTSTAMP:20270101T030000Z
DTSTART;TZID=Pacific/Auckland:20270314T100000
DTEND;TZID=Pacific/Auckland:20270314T120000
SUMMARY:音響
DESCRIPTION:2027T1 職事表\n如當日不能服侍，請盡早聯絡幹事
 安排調動。
END:VEVENT
BEGIN:VEVENT
UID:2027T1-P010-2027-04-04-CHAIR-1@hwc-roster.invalid
SEQUENCE:5
DTSTAMP:20270101T030000Z
DTSTART;TZID=Pacific/Auckland:20270404T104500
DTEND;TZID=Pacific/Auckland:20270404T120000
SUMMARY:主席
DESCRIPTION:2027T1 職事表\n如當日不能服侍，請盡早聯絡幹事
 安排調動。
END:VEVENT
END:VCALENDAR

```

（上面顯示時已經將 CRLF 轉做一般換行方便閱讀；實際檔案內容用
CRLF，符合 RFC 5545 要求。）

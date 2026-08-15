// 第九輪批次階段 C：產生 docs/電郵範本樣本.md。
// 執行方式：node tests/render_email_samples.js
//
// 這不是測試（檔名刻意不是 *.test.js，不會被「跑齊全部測試」的迴圈掃到），
// 而是一個文件產生器：把 tests/email_templates_render.test.js 的渲染結果
// 輸出成一份可以直接閱讀的 Markdown，供 Ivan 在 DRY_RUN=FALSE 之前逐封讀過。
//
// 為什麼要產生成靜態檔案而不是叫人自己跑：docs/ 是公開文件，對話另一邊的
// Claude（以及任何只看得到 GitHub repo 的人）讀不到本機執行結果，只讀得到
// 檔案本身。範本改動之後重新跑一次這個script 就會更新。

const path = require('path');
const fs = require('fs');

// 載入渲染器。email_templates_render.test.js 在被 require 時會把全部斷言跑一次
// 並印出結果——那是好事（產生文件之前先確認範本沒有問題），但輸出會蓋過
// 這個 script 自己的訊息，所以暫時靜音，跑完再還原。
const originalLog = console.log;
console.log = function () {};
const renderer = require('./email_templates_render.test.js');
console.log = originalLog;

const samples = renderer.renderAllSamples();

const lines = [];
lines.push('# 電郵範本樣本（實際渲染結果）');
lines.push('');
lines.push('呢份文件係**用虛構資料實際渲染出嚟嘅電郵內容**，唔係範本原始碼。');
lines.push('目的係讓人喺 `DRY_RUN=FALSE`（真正寄信）之前，可以逐封讀一次');
lines.push('收件人實際會收到咩——之前系統模擬寄出過幾十封信，但由頭到尾');
lines.push('冇人真正讀過內文，只喺 Logger 見到一行「不寄出 → 某某 | 主旨」。');
lines.push('');
lines.push('產生方式：`node tests/render_email_samples.js`。範本內容讀自');
lines.push('`src/EmailTemplateSeed.gs` 嘅預設值（**唔係**讀試算表），代入變數');
lines.push('用嘅係正式碼嘅 `applyPlaceholders_()`（`src/Mailer.gs`），');
lines.push('所以呢度見到嘅就係實際會寄出嘅文字。');
lines.push('');
lines.push('全部資料一律虛構：姓名用「陳大文」「李小明」「王美美」，');
lines.push('電郵一律 `x.com`，季度用 2099T1，試算表連結用 `example.invalid`。');
lines.push('');
lines.push('---');
lines.push('');
lines.push('## 一覽');
lines.push('');
lines.push('| # | 範本 | 收件人類型 | 用途 | 附件 |');
lines.push('|---|---|---|---|---|');
samples.forEach(function (s, i) {
  lines.push('| ' + (i + 1) + ' | `' + s.template.templateId + '` | '
    + (s.recipient.type === 'LIST' ? 'LIST（名單）' : 'PERSON（個人）') + ' | '
    + s.purpose + ' | ' + s.attachment + ' |');
});
lines.push('');
lines.push('注意樣本數多過範本數：同一個範本寄俾 PERSON 同 LIST 兩種收件人，');
lines.push('渲染出嚟嘅內容可以完全唔同，所以兩種都要有人讀過。');
lines.push('');
lines.push('---');
lines.push('');

samples.forEach(function (s, i) {
  lines.push('## ' + (i + 1) + '. `' + s.template.templateId + '`'
    + (s.recipient.type === 'LIST' ? '（寄俾名單）' : '（寄俾個人）'));
  lines.push('');
  lines.push('- **用途**：' + s.purpose);
  lines.push('- **幾時寄**：' + s.trigger);
  lines.push('- **收件人**：' + s.audience);
  lines.push('- **附件**：' + s.attachment);
  lines.push('');
  lines.push('**主旨**');
  lines.push('');
  lines.push('```');
  lines.push(s.rendered.subject);
  lines.push('```');
  lines.push('');
  lines.push('**內文（純文字版，收件人喺唔支援 HTML 嘅郵件程式會見到呢個）**');
  lines.push('');
  lines.push('```');
  lines.push(s.rendered.bodyPlain);
  lines.push('```');
  lines.push('');
  lines.push('<details>');
  lines.push('<summary>HTML 版原始碼（大部分收件人實際見到嘅係呢個渲染之後嘅樣）</summary>');
  lines.push('');
  lines.push('```html');
  lines.push(s.rendered.bodyHtml);
  lines.push('```');
  lines.push('');
  lines.push('</details>');
  lines.push('');
  lines.push('---');
  lines.push('');
});

lines.push('## 本輪覆核發現嘅問題同修正');
lines.push('');
lines.push('### ⚠️ 問題 1（最嚴重）：堂委收到一封寫俾個人、內容壞咗嘅信');
lines.push('');
lines.push('**點解會咁**：步驟 4「正式發出」同時寄俾兩種收件人——每一位有服侍');
lines.push('嘅義工（PERSON），同埋 `EmailRecipients` 裡面 `Stage` 欄含 `OFFICIAL`');
lines.push('嘅名單（LIST，例如堂委、教會辦公室）。2027T1 實測嗰次就係「LIST 2 +');
lines.push('PERSON 58」。修正前兩種收件人**共用同一個 `TPL_OFFICIAL_TC`**，');
lines.push('於是 LIST 收件人收到嘅信會係咁：');
lines.push('');
lines.push('```');
lines.push('堂委名單 弟兄／姊妹：');
lines.push('');
lines.push('平安！2099T1（2099-01-04 至 2099-03-29）的職事表已經確定，閣下本季的服侍安排如下：');
lines.push('');
lines.push('');
lines.push('');
lines.push('個人版職事表已作為附件，敬請查收並預留時間。如因特殊情況未能出席，請盡早聯絡幹事安排調動。');
lines.push('');
lines.push('多謝配搭服侍！');
lines.push('```');
lines.push('');
lines.push('三個問題疊埋一齊：');
lines.push('');
lines.push('1. 稱呼一份**名單**做「弟兄／姊妹」；');
lines.push('2. 「閣下本季的服侍安排如下：」後面**完全空白**——LIST 收件人冇');
lines.push('   `PersonID`，`buildAssignmentSummary_()` 回傳空字串，而');
lines.push('   `deliverOne_()` 嗰句「本季您暫時沒有任何服侍安排」替代文字');
lines.push('   **只對 PERSON 收件人生效**；');
lines.push('3. 聲稱「個人版職事表已作為附件」，但 `generateMailAttachment_()` 對');
lines.push('   `PERSONAL_PDF` ＋ 非 PERSON 收件人一律回傳 `null`，**實際上冇附件**。');
lines.push('');
lines.push('**修正**：新增 `TPL_OFFICIAL_LIST_TC`，用返步驟 5 已經驗證過嘅同一套');
lines.push('做法（`TPL_RESEND_LIST_TC` 一直都係咁做）——LIST 收件人用自己嘅範本、');
lines.push('附完整版 PDF。`sendStage()` 依收件人類型揀範本（見 `Mailer.gs` 嘅');
lines.push('`resolveStageTemplates_()`）。**向後相容**：工作表未加呢一行之前，');
lines.push('系統會自動退回用舊範本，唔會因為缺一行而寄唔到信。');
lines.push('');
lines.push('### ⚠️ 問題 2：日期格式有月日歧義');
lines.push('');
lines.push('個人信入面「1月4日 主席」嗰一行嘅日期格式，由 `dd/MM` 改為 `M月d日`。');
lines.push('');
lines.push('`dd/MM` 寫出嚟係「03/04」——對習慣 `MM/dd` 嘅讀者嚟講，究竟係 3 月 4 日');
lines.push('定 4 月 3 日分唔到。而義工就係靠呢一行去記自己邊個禮拜要返，記錯日期');
lines.push('嘅代價好實際（當日冇人到位）。`M月d日` 對中文讀者完全冇歧義，');
lines.push('亦都唔受地區慣例影響。');
lines.push('');
lines.push('### ✅ 覆核過冇問題嘅項目');
lines.push('');
lines.push('- **未替換嘅變數**：全部 7 個樣本嘅主旨、純文字內文、HTML 內文都冇');
lines.push('  殘留任何 `{...}`（`tests/email_templates_render.test.js` 用比正式碼');
lines.push('  更寬鬆嘅樣式掃，連中文變數名同帶空格嘅寫法都會抓到）。');
lines.push('- **零派工者**：步驟 5 通知「本來有服侍、改動後變成整季零服侍」嘅人時，');
lines.push('  會用「本季您暫時沒有任何服侍安排，因此本次未附上個人職事表。」');
lines.push('  頂住，唔會出現「安排如下：」後面直接空白嘅斷句。');
lines.push('- **無電郵者**：系統照樣計佢本季安排、照樣產生 PDF，只係寄信嗰步略過，');
lines.push('  `SendLog` 記 `SKIPPED_NO_EMAIL`，另外寄一封通知幹事列出係邊幾位。');
lines.push('  之後喺 `NameMapping` 補返電郵，下次步驟 5 會當佢「首次通知」寄一次。');
lines.push('- **OFFICIAL 個人信有交代「唔做得嗰日點算」**：「如因特殊情況未能出席，');
lines.push('  請盡早聯絡幹事安排調動。」');
lines.push('- **語氣同用詞**：全部樣本都冇台灣式書面語（「您好」「軟體」「網路」');
lines.push('  「資訊」「影片」呢類），維持香港教會書面語。');
lines.push('');
lines.push('---');
lines.push('');
lines.push('## Ivan 需要自己做嘅事');
lines.push('');
lines.push('程式碼嘅預設值已經改好，但**`EmailTemplates` 同 `Config` 兩張工作表');
lines.push('唔會自動更新**（本輪全程冇寫入過試算表）。要令上面兩項修正真正生效：');
lines.push('');
lines.push('### 1. 加入 `TPL_OFFICIAL_LIST_TC`');
lines.push('');
lines.push('執行 **「維護 ▸ 補齊 Email 範本」**。呢個工具會自己偵測到少咗');
lines.push('`TPL_OFFICIAL_LIST_TC` 並補上（佢係依 `TemplateID` 判斷，唔係依 `Stage`，');
lines.push('所以同一個 `Stage=OFFICIAL` 已經有一行都唔會漏）。');
lines.push('');
lines.push('補完之後，`EmailTemplates` 應該有 6 行範本。');
lines.push('');
lines.push('如果想自己人手貼，以下係完整內容：');
lines.push('');
const officialList = samples.filter(function (s) {
  return s.template.templateId === 'TPL_OFFICIAL_LIST_TC';
})[0].template;
lines.push('| 欄位 | 值 |');
lines.push('|---|---|');
lines.push('| `TemplateID` | `' + officialList.templateId + '` |');
lines.push('| `Stage` | `' + officialList.stage + '` |');
lines.push('| `Lang` | `' + officialList.lang + '` |');
lines.push('| `AttachType` | `' + officialList.attachType + '` |');
lines.push('| `Placeholders` | `' + officialList.placeholders + '` |');
lines.push('| `Active` | `TRUE` |');
lines.push('');
lines.push('`Subject`：');
lines.push('');
lines.push('```');
lines.push(officialList.subject);
lines.push('```');
lines.push('');
lines.push('`BodyHtml`：');
lines.push('');
lines.push('```html');
lines.push(officialList.bodyHtml);
lines.push('```');
lines.push('');
lines.push('`BodyPlain`：');
lines.push('');
lines.push('```');
lines.push(officialList.bodyPlain);
lines.push('```');
lines.push('');
lines.push('### 2. 改日期格式（只有喺 `Config` 已經有呢一行嘅時候先需要做）');
lines.push('');
lines.push('去 `Config` 工作表搵 `MAIL_SUMMARY_DATE_FORMAT`：');
lines.push('');
lines.push('- **搵唔到呢一行** → 唔使做嘢，系統會用程式碼嘅新預設值 `M月d日`。');
lines.push('- **搵到而且值係 `dd/MM`** → 改成 `M月d日`。工作表嘅值一定蓋過程式碼');
lines.push('  預設值，唔改嘅話個人信會繼續用有歧義嘅 `03/04` 寫法。');
lines.push('');
lines.push('改完可以用 **「查看 ▸ 預覽電郵範本（唯讀）」** 睇下實際效果。');
lines.push('');

const outPath = path.join(__dirname, '..', 'docs', '電郵範本樣本.md');
fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
console.log('已產生：' + outPath);
console.log('樣本數：' + samples.length + '（範本 '
  + new Set(samples.map(function (s) { return s.template.templateId; })).size + ' 個）');

// 第九輪批次階段 C：電郵實際內容覆核。
// 執行方式：node tests/email_templates_render.test.js
//
// 背景：系統已經模擬寄出過幾十封信（2027T1 步驟 4 有 60 個收件人），但
// **從來沒有人真正讀過收件人會收到的內容**——DRY_RUN 只會在 Logger 記一行
// 「不寄出 → 某某@某某 | 主旨」，內文根本沒有被人看過一次。DRY_RUN=FALSE
// 之前必須有人讀過每一封。
//
// 這個檔案做兩件事：
//   1. 【回歸測試】渲染後不可以留有任何未替換的 placeholder（C5）。
//   2. 【渲染器】提供 renderAllSamples()，供 tests/render_email_samples.js
//      產生 docs/電郵範本樣本.md（C1／C2）。
//
// 渲染邏輯**重用正式碼**：applyPlaceholders_()／htmlToPlainText_()／
// buildAssignmentSummary_() 全部由 gas_loader 從真正的 Mailer.gs 載入，
// 範本內容則直接讀 EmailTemplateSeed.gs 的 EMAIL_TEMPLATE_SEEDS——
// 不讀試算表（本輪禁止讀取試算表），也不另抄一份渲染邏輯。
//
// 全部資料一律虛構：姓名用「陳大文」這類明顯造出來的名字，電郵一律 x.com，
// 季度用 2099T1，試算表連結用 example.invalid。

const { loadGasSource } = require('./helpers/gas_loader.js');

// Mailer.gs 有 top-level 的 GAS API 呼叫嗎？沒有——它全部包在函式裡，
// 所以可以安全載入沙箱。EmailTemplateSeed.gs 的 EMAIL_TEMPLATE_SEEDS 是
// 純資料陣列，只引用 MAIL_STAGES／ATTACH_TYPE 兩個常數。
const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'EmailTemplateSeed.gs', 'Mailer.gs'
]);

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}

// ---------------------------------------------------------------------------
// 虛構但結構真實的測試資料
// ---------------------------------------------------------------------------
const QUARTER_ID = '2099T1';
const SAMPLE_PLACEHOLDERS = {
  QuarterID: QUARTER_ID,
  VersionNo: 'v3',
  StartDate: '2099-01-04',
  EndDate: '2099-03-29',
  OfficialSendDate: '2099-01-11',
  SpreadsheetUrl: 'https://example.invalid/spreadsheet-url',
  CurrentStage: 'REVIEW_SENT',
  NextAction: '四階段流程 ▸ 步驟 3：套用修改申報'
};

/** 虛構的個人派工摘要（已經是 buildAssignmentSummary_() 會產生的格式）。 */
const SAMPLE_SUMMARY = '1月4日 主席；1月4日 報告；2月15日 讀經';

/** 虛構的異動人員摘要（buildChangedPeopleSummaryText_() 會產生的格式）。 */
const SAMPLE_CHANGED_SUMMARY = [
  '陳大文：1月4日 主席；2月15日 讀經',
  '李小明：本季暫時沒有任何服侍安排'
].join('\n');

/**
 * 收件人樣本。同一個 OFFICIAL 範本會同時寄給 PERSON 與 LIST 兩種收件人，
 * 兩者渲染出來的內容差很遠——這正是 C4 要檢查的地方。
 */
const RECIPIENTS = {
  person: { type: 'PERSON', personId: 'P001', displayName: '陳大文', email: 'testa01@x.com' },
  personNoAssignment: { type: 'PERSON', personId: 'P002', displayName: '李小明', email: 'testa02@x.com' },
  personNoEmail: { type: 'PERSON', personId: 'P003', displayName: '王美美', email: '' },
  list: { type: 'LIST', personId: '', displayName: '堂委名單', email: 'committee@x.com' }
};

/** 零派工者的替代句——逐字對應 Mailer.gs 的 deliverOne_()。 */
const NO_ASSIGNMENT_SUMMARY = '本季您暫時沒有任何服侍安排，因此本次未附上個人職事表。';

/**
 * 渲染一個範本。完全重用正式碼的 applyPlaceholders_()。
 * @param {Object} template EMAIL_TEMPLATE_SEEDS 的一項
 * @param {Object} recipient 收件人
 * @param {string} summary 該人的派工摘要
 * @param {Object=} extraPlaceholders 額外的 placeholder（例如 ChangedPeopleSummary）
 * @returns {{subject: string, bodyPlain: string, bodyHtml: string}}
 */
function render(template, recipient, summary, extraPlaceholders) {
  const placeholders = Object.assign({}, SAMPLE_PLACEHOLDERS, extraPlaceholders || {});
  return {
    subject: gas.applyPlaceholders_(template.subject, placeholders, recipient, summary),
    bodyPlain: gas.applyPlaceholders_(template.bodyPlain, placeholders, recipient, summary),
    bodyHtml: gas.applyPlaceholders_(template.bodyHtml, placeholders, recipient, summary)
  };
}

/**
 * 組出全部要覆核的樣本。每一項代表「一種收件人在一種情境下實際收到的信」，
 * 不是「一個範本」——同一個範本寄給 PERSON 與 LIST 會產生完全不同的內容，
 * 兩者都要有人讀過。
 * @returns {Object[]} 樣本陣列
 */
function renderAllSamples() {
  const byId = {};
  gas.EMAIL_TEMPLATE_SEEDS.forEach(function (t) { byId[t.templateId] = t; });

  const samples = [];
  const add = function (spec) {
    samples.push(Object.assign({}, spec, {
      rendered: render(spec.template, spec.recipient, spec.summary, spec.extraPlaceholders)
    }));
  };

  add({
    key: 'TPL_REVIEW_TC',
    template: byId.TPL_REVIEW_TC,
    recipient: RECIPIENTS.list,
    summary: '',
    purpose: '步驟 2：把職事表初稿寄給堂委審閱',
    trigger: '幹事手動執行「四階段流程 ▸ 步驟 2：寄給堂委審閱」',
    audience: 'EmailRecipients 中 Role=REVIEWER 且 Active=TRUE 的收件人（堂委、幹事）',
    attachment: '完整版職事表 PDF（FULL_PDF）'
  });

  add({
    key: 'TPL_REMIND_TC',
    template: byId.TPL_REMIND_TC,
    recipient: RECIPIENTS.list,
    summary: '',
    purpose: '提醒堂委／幹事職事表卡在某個階段',
    trigger: '⚠️ 只有「測試工具 ▸ 寄送（測試模式）」手動指定 Stage=REMIND 才會用到。'
      + '自動排程實際寄出的「Stage 停滯／死線接近」提醒**完全不經過這個範本**，'
      + '那是 Trigger.gs 直接呼叫 notifyAdminStageReminder_()，文字寫在程式碼裡',
    audience: 'EmailRecipients 中 Stage 欄含 REMIND 的收件人',
    attachment: '無（NONE）'
  });

  add({
    key: 'TPL_OFFICIAL_TC@PERSON',
    template: byId.TPL_OFFICIAL_TC,
    recipient: RECIPIENTS.person,
    summary: SAMPLE_SUMMARY,
    purpose: '步驟 4：正式發出，通知每一位有服侍的義工',
    trigger: '幹事手動執行「四階段流程 ▸ 步驟 4：正式發出」',
    audience: '本季有被派工的每一位義工（PERSON 收件人）',
    attachment: '該人的個人版職事表 PDF（PERSONAL_PDF）'
  });

  add({
    key: 'TPL_OFFICIAL_LIST_TC',
    template: byId.TPL_OFFICIAL_LIST_TC,
    recipient: RECIPIENTS.list,
    summary: '',
    purpose: '步驟 4：正式發出，同時通知堂委／幹事名單（LIST 收件人）',
    trigger: '同上，跟個人信在同一次執行寄出',
    audience: 'EmailRecipients 中 Stage 欄含 OFFICIAL 的收件人（堂委、教會辦公室）',
    attachment: '完整版職事表 PDF（FULL_PDF）'
  });

  add({
    key: 'TPL_RESEND_TC',
    template: byId.TPL_RESEND_TC,
    recipient: RECIPIENTS.person,
    summary: SAMPLE_SUMMARY,
    purpose: '步驟 5：改動後重發，只通知安排真的有改動的義工',
    trigger: '幹事手動執行「四階段流程 ▸ 步驟 5：改動後重發」',
    audience: '這一版跟上次寄出時內容不同的義工（PERSON 收件人）',
    attachment: '該人最新版的個人職事表 PDF（PERSONAL_PDF）'
  });

  add({
    key: 'TPL_RESEND_TC@ZERO',
    template: byId.TPL_RESEND_TC,
    recipient: RECIPIENTS.personNoAssignment,
    summary: NO_ASSIGNMENT_SUMMARY,
    purpose: '步驟 5：通知「本來有服侍、改動後變成整季零服侍」的人',
    trigger: '同上；這種人的派工被別人頂走，一格都不剩',
    audience: '被頂走、這一版零派工的義工',
    attachment: '無（零派工的人不會有個人 PDF，系統會自動略過附件）'
  });

  add({
    key: 'TPL_RESEND_LIST_TC',
    template: byId.TPL_RESEND_LIST_TC,
    recipient: RECIPIENTS.list,
    summary: '',
    extraPlaceholders: { ChangedPeopleSummary: SAMPLE_CHANGED_SUMMARY },
    purpose: '步驟 5：把本輪異動摘要寄給堂委／幹事',
    trigger: '同上，跟個人信在同一次執行寄出',
    audience: 'EmailRecipients 中 Stage 欄含 RESEND 的收件人',
    attachment: '完整版職事表 PDF（FULL_PDF）'
  });

  return samples;
}

// ---------------------------------------------------------------------------
// C5：渲染後不可留有任何未替換的 placeholder
// ---------------------------------------------------------------------------
const samples = renderAllSamples();

console.log('\n=== C5【核心回歸】渲染後不可留有任何未替換的 placeholder ===');
{
  // applyPlaceholders_() 最後那一道 /\{[A-Za-z][A-Za-z0-9]*\}/g 清理會把未知的
  // placeholder 換成空字串，所以「殘留花括號」理論上不會發生——但那道清理只認
  // 純英數的樣式。這裡用更寬鬆的樣式掃描，連 {Person Name}（有空格）、
  // {個人姓名}（中文）這類清理不到的寫法都會抓到。
  const LOOSE_PLACEHOLDER = /\{[^}\n]{1,40}\}/g;

  samples.forEach(function (s) {
    ['subject', 'bodyPlain', 'bodyHtml'].forEach(function (field) {
      const leftovers = s.rendered[field].match(LOOSE_PLACEHOLDER);
      check('★★ ' + s.key + ' 的 ' + field + ' 沒有殘留 placeholder',
        !leftovers, leftovers ? '殘留：' + leftovers.join('、') : '');
    });
  });
}

console.log('\n=== C5：反證——確認上面的檢查真的抓得到殘留 placeholder ===');
{
  const broken = gas.applyPlaceholders_(
    '你好 {PersonName}，請看 {某個中文變數} 與 {Not A Key}',
    SAMPLE_PLACEHOLDERS, RECIPIENTS.person, '');
  const LOOSE_PLACEHOLDER = /\{[^}\n]{1,40}\}/g;
  const leftovers = broken.match(LOOSE_PLACEHOLDER);
  check('★ 刻意放入清理不到的 placeholder，檢查確實抓得到',
    !!leftovers && leftovers.length === 2,
    '抓到：' + JSON.stringify(leftovers));
  check('★ 已知的 {PersonName} 仍然被正確代入', broken.indexOf('陳大文') !== -1);
}

console.log('\n=== C5：每一封信都要有主旨與內文，不可以是空的 ===');
{
  samples.forEach(function (s) {
    check('★ ' + s.key + ' 有主旨', s.rendered.subject.trim().length > 0);
    check('★ ' + s.key + ' 有純文字內文（MailApp 的純文字版不可以空白）',
      s.rendered.bodyPlain.trim().length > 0);
    check('★ ' + s.key + ' 有 HTML 內文', s.rendered.bodyHtml.trim().length > 0);
  });
}

console.log('\n=== C4：LIST 收件人不可以收到寫給個人的內容 ===');
{
  // 這是本階段最重要的一項發現（詳見 docs/電郵範本樣本.md）。
  // OFFICIAL 階段同時有 PERSON 與 LIST 兩種收件人；修正前兩者共用
  // TPL_OFFICIAL_TC，令堂委收到一封稱呼自己「弟兄／姊妹」、
  // 「閣下本季的服侍安排如下：」後面卻完全空白、還聲稱附了個人 PDF
  // （實際上 LIST 收件人不會有 PERSONAL_PDF 附件）的信。
  const listSamples = samples.filter(function (s) { return s.recipient.type === 'LIST'; });
  const PERSONAL_PHRASES = ['弟兄／姊妹', '閣下本季', '個人版職事表已作為附件', '最新版個人職事表已作為附件'];

  listSamples.forEach(function (s) {
    PERSONAL_PHRASES.forEach(function (phrase) {
      check('★★ ' + s.key + '（LIST）的內文沒有個人化字句「' + phrase + '」',
        s.rendered.bodyPlain.indexOf(phrase) === -1,
        'LIST 收件人是一整份名單，不是一個人，不可以用個人稱呼或聲稱附了個人 PDF');
    });
    check('★ ' + s.key + '（LIST）沒有出現空白的服侍安排段落',
      s.rendered.bodyPlain.indexOf('安排如下：\n\n\n') === -1
        && !/安排如下：\s*$/.test(s.rendered.bodyPlain));
  });
}

console.log('\n=== C4：零派工者收到的信要讀得通順 ===');
{
  const zero = samples.filter(function (s) { return s.key === 'TPL_RESEND_TC@ZERO'; })[0];
  check('★★ 零派工者的信有明確說明「本季沒有服侍安排」',
    zero.rendered.bodyPlain.indexOf('沒有任何服侍安排') !== -1);
  check('★ 零派工者的信不會出現「安排如下：」後面直接空白的斷句',
    !/安排如下：\s*\n\s*\n\s*(最新版|個人版|多謝)/.test(zero.rendered.bodyPlain),
    '實際內文：\n' + zero.rendered.bodyPlain);
}

console.log('\n=== C3：OFFICIAL 個人信必須說明「不能服侍要點做」 ===');
{
  const official = samples.filter(function (s) { return s.key === 'TPL_OFFICIAL_TC@PERSON'; })[0];
  check('★★ OFFICIAL 個人信有交代未能出席時的處理方法',
    /未能出席|不能服侍|未能服侍/.test(official.rendered.bodyPlain)
      && /聯絡幹事|回覆本郵件|通知幹事/.test(official.rendered.bodyPlain),
    '義工收到通知之後最常問的就是「我做唔到嗰日點算」，信入面一定要答到');
}

console.log('\n=== C3：日期格式對紐西蘭讀者不可有歧義 ===');
{
  // MAIL_SUMMARY_DATE_FORMAT 決定個人信裡「10/04 主席」那一段的日期寫法。
  // dd/MM 對習慣 MM/dd 的讀者來說，03/04 究竟是 3 月 4 日還是 4 月 3 日分不出，
  // 而職事表寄出後義工是靠這一行去記自己邊個禮拜要返——記錯日期的代價很實際。
  const format = String(gas.DEFAULTS.MAIL_SUMMARY_DATE_FORMAT);
  check('★★ 個人信的日期格式不是純數字的 dd/MM 或 MM/dd（會有月日歧義）',
    !/^d{1,2}\/M{1,2}$/.test(format) && !/^M{1,2}\/d{1,2}$/.test(format),
    '目前格式＝「' + format + '」。建議用「M月d日」這類帶單位的寫法，'
      + '中文讀者一看就分得出，也不受地區慣例影響');
  check('★ 日期格式含中文「月」「日」單位', format.indexOf('月') !== -1 && format.indexOf('日') !== -1,
    '目前格式＝「' + format + '」');
}

console.log('\n=== C3：不可出現台灣式書面語用詞 ===');
{
  // 香港教會的書面語跟台灣書面語有明顯差異，用錯會讀起來「唔係我哋嗰種中文」。
  const TAIWAN_WORDS = ['請問您', '您好', '軟體', '網路', '資訊', '影片', '螢幕', '檔案夾', '喔', '唷'];
  samples.forEach(function (s) {
    const hits = TAIWAN_WORDS.filter(function (w) {
      return s.rendered.bodyPlain.indexOf(w) !== -1 || s.rendered.subject.indexOf(w) !== -1;
    });
    check('★ ' + s.key + ' 沒有台灣式用詞', hits.length === 0,
      hits.length > 0 ? '出現：' + hits.join('、') : '');
  });
}

console.log('\n=== C1：全部範本都有被覆核到（沒有漏掉任何一個）===');
{
  const coveredTemplateIds = {};
  samples.forEach(function (s) { coveredTemplateIds[s.template.templateId] = true; });
  gas.EMAIL_TEMPLATE_SEEDS.forEach(function (t) {
    check('★ ' + t.templateId + ' 有至少一個渲染樣本', !!coveredTemplateIds[t.templateId]);
  });
  console.log('      （EMAIL_TEMPLATE_SEEDS 共 ' + gas.EMAIL_TEMPLATE_SEEDS.length
    + ' 個範本，渲染出 ' + samples.length + ' 個樣本——同一個範本寄給 PERSON 與 LIST '
    + '會產生不同內容，所以樣本數多於範本數）');
}

module.exports = { renderAllSamples, SAMPLE_PLACEHOLDERS, SAMPLE_SUMMARY, SAMPLE_CHANGED_SUMMARY };

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
if (require.main === module) process.exit(fail === 0 ? 0 : 1);

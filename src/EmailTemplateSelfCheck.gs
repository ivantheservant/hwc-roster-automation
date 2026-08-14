/**
 * 階段 E 新增：「查看 ▸ 電郵範本自我檢查（唯讀）」。
 *
 * 完全不依賴任何實際季度／版本資料——所有代入值（QuarterID、日期、收件人姓名、
 * 派工摘要）都是虛構的示範資料，不讀取 `Quarters`／`RosterAssignments`／
 * `NameMapping` 等任何真實紀錄，所以這個工具隨時可以執行、結果永遠一致，
 * 也不可能洩漏任何真實會友的資訊。虛構收件人固定叫「（示範）陳大文」——
 * 這不是真實會友，是本專案既有匿名化慣例（追加階段 AQ）延伸出來的做法。
 *
 * 逐一檢查 EmailTemplates 的每一列（不限於目前四／五個已知 Stage，未來新增
 * 的範本也會自動被抓到）：
 * 1. 這個範本用了哪些 `{變數}` 佔位符（從 Subject／BodyHtml／BodyPlain 掃出來）
 * 2. 這些佔位符是不是真的會被代入——用跟寄送流程完全相同的
 *    `applyPlaceholders_()`（Mailer.gs）代入一次虛構資料，再用
 *    `findUnresolvedPlaceholders_()`（TemplatePreview.gs）掃代入後還殘留的
 *    `{變數}`，殘留的就是「宣稱要代入、實際沒有對應代入邏輯」的變數——這正是
 *    `{ServiceList}` 那次真實 bug 的偵測方式，見 TemplatePreview.gs 的
 *    `isPersonalizedTemplate_()` 檔頭註解
 * 3. BodyHtml／BodyPlain 是否至少有一個有內容（兩個都空白代表寄出的信會是空的）
 * 4. 代入 `MAIL_SUBJECT_PREFIX` 之後的完整主旨是否含測試字眼
 * 5. 完整代入後的 Subject／BodyHtml／BodyPlain 全部寫進 Diagnostics，供人
 *    （或未來的 Claude）直接讀文字判斷內容對不對，不需要真的寄一封信
 *
 * `TPL_RESEND_LIST_TC` 特別處理：這個範本用 `{ChangedPeopleSummary}`，
 * 只有 `ResendFlow.gs` 的 `sendResendStage_()` 會在寄送前把這個值塞進
 * `context.placeholders`（見該檔案），一般的 `buildMailContext_()` 不會。
 * 這裡比照那個做法，額外注入一個虛構的 `ChangedPeopleSummary`，避免這個範本
 * 被誤判成「有變數沒代入」。
 *
 * 跟 `TemplatePreview.gs` 一樣套用 `PREVIEW_MODE_ACTIVE` 結構性防護——雖然這裡
 * 完全沒有呼叫任何會寄信的函式，多一層防護沒有壞處，跟既有慣例一致。
 */

/** 虛構示範收件人；不是真實會友，見本檔案檔頭說明。 */
const EMAIL_SELF_CHECK_DEMO_RECIPIENT = {
  type: 'PREVIEW', personId: '', email: 'demo@example.invalid',
  displayName: '（示範）陳大文', sendAs: SEND_AS.TO
};

/** 電郵主旨測試字眼偵測，跟 PreLaunchChecklist.gs 用同一份關鍵字。 */
const EMAIL_SELF_CHECK_TEST_KEYWORDS = ['test', '測試', 'demo', 'temp', 'sample', 'debug'];

/**
 * 建構一份完全虛構的 mail context 佔位符，不讀取任何真實工作表的資料。
 * @returns {Object.<string, string>} 供 applyPlaceholders_() 使用的佔位符對照
 */
function buildDemoMailPlaceholders_() {
  return {
    QuarterID: '2099T1',
    VersionNo: 'v0',
    StartDate: '2099-01-03',
    EndDate: '2099-03-28',
    OfficialSendDate: '2099-01-01',
    SpreadsheetUrl: 'https://example.invalid/demo-spreadsheet',
    ChangedPeopleSummary: '（示範）陳大文：2099-01-03 主席；（示範）李小明：2099-01-10 讀經'
  };
}

/**
 * 建構一份虛構的個人派工摘要文字，重用真正寄送流程會用的
 * `buildAssignmentSummary_()`（同一個日期格式／分隔符邏輯），但輸入資料
 * 完全是虛構的（假日期＋真實存在的崗位名稱——崗位名稱不是個人資料，可以放心
 * 使用，只有「日期」與「人名」用虛構值）。
 * @returns {string} 虛構的派工摘要文字
 */
function buildDemoAssignmentSummary_() {
  const posts = readPosts();
  const postNames = {};
  posts.forEach(function (row) { postNames[row[COLUMNS.POSTS.POST_ID]] = row[COLUMNS.POSTS.POST_NAME_TC]; });
  const demoPostIds = posts.slice(0, 2).map(function (row) { return row[COLUMNS.POSTS.POST_ID]; });
  const demoAssignments = demoPostIds.map(function (postId, i) {
    return { serviceDate: i === 0 ? '2099-01-03' : '2099-01-17', postId: postId };
  });
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  return buildAssignmentSummary_(demoAssignments, postNames, timezone);
}

/**
 * 上線前規劃：對單一範本列做完整的自我檢查，純讀取（除了 Posts／Config 之外
 * 不讀取任何跟真實季度／會友有關的資料）。
 * @param {Object} templateRow readSheet(SHEETS.EMAIL_TEMPLATES) 的一列原始資料
 * @param {string} subjectPrefix Config 的 MAIL_SUBJECT_PREFIX
 * @param {string} demoSummary buildDemoAssignmentSummary_() 的結果，所有範本共用
 * @returns {Object} 單一範本的檢查結果
 */
function checkOneEmailTemplate_(templateRow, subjectPrefix, demoSummary) {
  const C = COLUMNS.EMAIL_TEMPLATES;
  const template = normalizeEmailTemplateRow_(templateRow);
  const rawBodyPlain = String(templateRow[C.BODY_PLAIN] || '');
  const rawBodyHtml = String(templateRow[C.BODY_HTML] || '');

  const placeholders = buildDemoMailPlaceholders_();
  const declaredPlaceholders = findUnresolvedPlaceholders_(
    [template.subject, template.bodyHtml, template.bodyPlain].join('\n'));

  const renderedSubject = subjectPrefix + applyPlaceholders_(template.subject, placeholders, EMAIL_SELF_CHECK_DEMO_RECIPIENT, demoSummary);
  const renderedBodyHtml = applyPlaceholders_(template.bodyHtml, placeholders, EMAIL_SELF_CHECK_DEMO_RECIPIENT, demoSummary);
  const renderedBodyPlain = applyPlaceholders_(template.bodyPlain, placeholders, EMAIL_SELF_CHECK_DEMO_RECIPIENT, demoSummary);

  const unresolved = findUnresolvedPlaceholders_([renderedSubject, renderedBodyHtml, renderedBodyPlain].join('\n'));

  const bothBodiesEmpty = rawBodyHtml.trim() === '' && rawBodyPlain.trim() === '';
  const bodyPlainUsesFallback = rawBodyPlain.trim() === '' && rawBodyHtml.trim() !== '';

  const subjectLower = renderedSubject.toLowerCase();
  const looksLikeTestSubject = EMAIL_SELF_CHECK_TEST_KEYWORDS.some(function (k) { return subjectLower.indexOf(k) >= 0; });

  return {
    templateId: template.templateId,
    stage: template.stage,
    lang: template.lang,
    active: isTrueValue_(templateRow[C.ACTIVE]),
    attachType: template.attachType,
    declaredPlaceholders: declaredPlaceholders,
    unresolvedAfterRender: unresolved,
    bothBodiesEmpty: bothBodiesEmpty,
    bodyPlainUsesFallback: bodyPlainUsesFallback,
    looksLikeTestSubject: looksLikeTestSubject,
    renderedSubject: renderedSubject,
    renderedBodyHtml: renderedBodyHtml,
    renderedBodyPlain: renderedBodyPlain
  };
}

/**
 * 上線前規劃：對 EmailTemplates 全部列做自我檢查。純讀取，不寄送、不改動
 * 任何工作表（除了呼叫端可能寫入 Diagnostics）。
 * @returns {Object[]} 每一列範本各一項檢查結果
 */
function buildEmailTemplateSelfCheckReport_() {
  PREVIEW_MODE_ACTIVE = true;
  try {
    const subjectPrefix = String(getConfig(CONFIG_KEYS.MAIL_SUBJECT_PREFIX, '') || '');
    const demoSummary = buildDemoAssignmentSummary_();
    return readSheet(SHEETS.EMAIL_TEMPLATES).map(function (row) {
      return checkOneEmailTemplate_(row, subjectPrefix, demoSummary);
    });
  } finally {
    PREVIEW_MODE_ACTIVE = false;
  }
}

/**
 * 選單項目「查看 ▸ 電郵範本自我檢查（唯讀）」的執行入口。
 * @returns {void}
 */
function runEmailTemplateSelfCheck_() {
  const ui = SpreadsheetApp.getUi();
  let results;
  try {
    results = buildEmailTemplateSelfCheckReport_();
  } catch (err) {
    log_('ERROR', 'runEmailTemplateSelfCheck_ 失敗: ' + err.message);
    ui.alert('電郵範本自我檢查（唯讀）', '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  if (results.length === 0) {
    ui.alert('電郵範本自我檢查（唯讀）', 'EmailTemplates 工作表沒有任何範本。', ui.ButtonSet.OK);
    return;
  }

  const lines = ['共 ' + results.length + ' 個範本，虛構收件人：（示範）陳大文', ''];
  const rows = [];
  let problemCount = 0;

  results.forEach(function (r) {
    const problems = [];
    if (r.unresolvedAfterRender.length > 0) problems.push('有變數沒有真的代入：' + r.unresolvedAfterRender.join('、'));
    if (r.bothBodiesEmpty) problems.push('BodyHtml 與 BodyPlain 都是空的');
    if (r.looksLikeTestSubject) problems.push('主旨含測試字眼');
    if (problems.length > 0) problemCount++;

    lines.push(
      (problems.length > 0 ? '⚠ ' : '✓ ') + r.templateId + '　Stage=' + r.stage + '　Lang=' + r.lang
        + '　Active=' + r.active + '　AttachType=' + r.attachType,
      '　用到的變數：' + (r.declaredPlaceholders.length > 0 ? r.declaredPlaceholders.join('、') : '（無）')
    );
    if (r.bodyPlainUsesFallback) lines.push('　（BodyPlain 留空，寄送時會自動由 BodyHtml 轉換純文字版，不算問題）');
    problems.forEach(function (p) { lines.push('　⚠ ' + p); });
    lines.push('');

    rows.push(diagRow_('電郵範本自我檢查', r.templateId, 'Stage=' + r.stage + '／Active=' + r.active,
      problems.length > 0 ? problems.join('；') : '沒有發現問題'));
    rows.push(diagRow_('電郵範本自我檢查', r.templateId + '　用到的變數', r.declaredPlaceholders.join('、'), ''));
    rows.push(diagRow_('電郵範本自我檢查', r.templateId + '　代入後主旨', '', r.renderedSubject));
    rows.push(diagRow_('電郵範本自我檢查', r.templateId + '　代入後 BodyPlain', '', r.renderedBodyPlain));
    rows.push(diagRow_('電郵範本自我檢查', r.templateId + '　代入後 BodyHtml', '', r.renderedBodyHtml));
  });

  lines.unshift('共發現 ' + problemCount + ' 個範本有問題。');
  tryWriteDiagnostics_('電郵範本自我檢查', rows);
  lines.push(DIAGNOSTICS_WRITTEN_NOTE);

  ui.alert('電郵範本自我檢查（唯讀）', lines.join('\n'), ui.ButtonSet.OK);
}

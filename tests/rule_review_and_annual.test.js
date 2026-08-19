// 第二十七輪批次階段 G：年度工具搬入區二 ＋ 規則「人話版」審閱表匯出／匯入。
// 執行方式：node tests/rule_review_and_annual.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 規則審閱表要解決嘅問題
// ─────────────────────────────────────────────────────────────────────
//
// `RuleSettings` 上面寫住一個 0 到 1 之間嘅小數。堂委睇住嗰個數字係
// **冇辦法決定任何嘢**嘅——佢哋唔知單位、唔知調大定調細係想點、
// 更加唔知調完之後實際會有咩分別。
//
// 所以審閱表把小數換算成「N 個主日之中大約 M 個」——嗰個係堂委
// 腦入面本來就有嘅單位。
//
// ⚠️ 而換算嘅分母**唔可以寫死 13**。有啲季度係 12 或者 14 個主日，
// 而成句話嘅意思完全靠嗰個分母。分母錯咗，堂委就會照住一個錯嘅比例
// 做決定，而張表上面睇落一切正常。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'RuleReview.gs']);

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const backend = read('src/WebAppRuleReview.gs');
const pure = read('src/RuleReview.gs');
const zone2 = read('src/ui/ScriptZone2.html');
const zone4 = read('src/ui/ScriptZone4.html');
const common = read('src/ui/Script.html');

const R = gas.COLUMNS.RULE_SETTINGS;
function ruleRow(id, name, level, target, opts) {
  const row = {};
  row[R.RULE_ID] = id;
  row[R.RULE_NAME] = name;
  row[R.LEVEL] = level;
  row[R.TARGET_VALUE] = target;
  row[R.ENABLED] = (opts && opts.enabled === false) ? 'FALSE' : 'TRUE';
  // ⚠️ 用 `in` 而唔係 `||`——傳一個空字串入嚟嘅時候，`||` 會靜靜換成預設值，
  // 而呢個測試個 case 就係要測空字串。（又係同一個 bug class，連測試都中。）
  row[R.DESCRIPTION] = (opts && 'description' in opts) ? opts.description : '說明';
  return row;
}

/* ══════════════════════════════════════════════════════════════
 * G2　小數換算
 * ══════════════════════════════════════════════════════════════ */

console.log('\n=== G2【核心】小數換算成「N 個主日之中約 M 個」 ===');
{
  check('★★★★★ 0.63 × 13 ⇒ 「13 個主日之中約 8 個」'
    + '——堂委睇住 0.63 係冇辦法決定任何嘢嘅',
    gas.describeRuleValue_(0.63, 13) === '13 個主日之中約 8 個',
    gas.describeRuleValue_(0.63, 13));
  check('★★★★★ 分母跟住季度走，唔係寫死 13'
    + '——有啲季度 12 個主日，成句話嘅意思完全靠嗰個分母',
    gas.describeRuleValue_(0.5, 12) === '12 個主日之中約 6 個',
    gas.describeRuleValue_(0.5, 12));
  check('★★★★★ 分母查不到就**唔換算**，而且明講查不到'
    + '——硬用 13 換算出嚟嘅數字睇落好確定，但可能係錯嘅',
    gas.describeRuleValue_(0.63, null).indexOf('查不到一季有幾多個主日') !== -1,
    gas.describeRuleValue_(0.63, null));
  check('★★★★ 1 以上係次數，唔會被當成比例',
    gas.describeRuleValue_(8, 13) === '8');
  check('★★★★ 空白講「（沒有設定）」，唔會印一個 0 出嚟'
    + '——0 睇落係一個檢查過嘅值',
    gas.describeRuleValue_('', 13) === '（沒有設定）');
}

console.log('\n=== G2 選項：2–5 個，唔會超出範圍，而且**自己帶住要寫入嘅值** ===');
{
  // ⚠️ 第二十八輪批次階段 B4：選項而家係 `{label, value, field}`，
  // 而且**唔再由顯示文字反推值**——反推就係上一輪抓到嗰個漂移 bug 嘅來源。
  const choices = gas.buildRuleReviewRatioChoices_(0.63, 13);
  check('★★★★ 2 到 5 個選項', choices.length >= 2 && choices.length <= 5,
    JSON.stringify(choices));
  check('★★★★★ 每個選項都帶住 value 同 field（呼叫端唔使反推）',
    choices.every((c) => typeof c.value === 'number' && !!c.field),
    JSON.stringify(choices));
  check('★★★★★ 有標明邊個係「維持現狀」'
    + '——冇標嘅話，堂委會以為每一個選項都係改動',
    choices.some((c) => c.label.indexOf('（維持現狀）') !== -1));
  check('★★★★★ 而且「維持現狀」帶住嘅係**原值 0.63**，唔係反推出嚟嘅 0.62'
    + '——反推嘅話，揀「維持現狀」反而會靜靜改咗個值，每次匯入漂移少少',
    choices.filter((c) => c.label.indexOf('（維持現狀）') !== -1)[0].value === 0.63);

  const edge = gas.buildRuleReviewRatioChoices_(0.08, 13);   // ≈1 次
  check('★★★★★ 唔會生成負數次數',
    edge.every((c) => !/約 -\d/.test(c.label)), JSON.stringify(edge));
  const high = gas.buildRuleReviewRatioChoices_(0.95, 13);   // ≈12 次
  check('★★★★★ 唔會生成超過主日總數嘅次數',
    high.every((c) => {
      const m = /約 (\d+) 個/.exec(c.label);
      return !m || Number(m[1]) <= 13;
    }), JSON.stringify(high));
  check('★★★★ 分母查不到就唔生成數值選項（只留「維持現狀」）',
    gas.buildRuleReviewRatioChoices_(0.63, null).length === 1);
}

/* ══════════════════════════════════════════════════════════════
 * G2　整份表
 * ══════════════════════════════════════════════════════════════ */

console.log('\n=== G2 表格結構：三組、七欄 ===');
{
  const rules = [
    ruleRow('HARD_A', '同一日不可以排同一個人兩個崗位', 'HARD', ''),
    ruleRow('SEMI_A', '同一個崗位盡量不要連續兩週', 'SEMI_HARD', ''),
    ruleRow('SOFT_A', '主席和報告盡量由同一位擔任', 'SOFT', 0.63)
  ];
  const built = gas.buildRuleReviewSheetRows_(rules, 13);

  check('★★★★ 七欄，而且次序同規格一樣',
    gas.RULE_REVIEW_HEADERS.join('|')
      === '編號|規則（一句話）|這一條在做什麼|現時設定|可以改成|堂委決定|備註／原因');
  check('★★★★★ 分三組，而且組標題係人話',
    built.rows.some((r) => r[0].indexOf('一定要遵守') === 0)
    && built.rows.some((r) => r[0].indexOf('盡量遵守') === 0)
    && built.rows.some((r) => r[0].indexOf('目標值') === 0));
  check('★★★★★ 硬規則／準硬規則只有兩個選項（同意／要討論）',
    // 第二十八輪批次階段 B5：選項改成**一個一行**（用「／」串埋一行會排到好長，
    // 而堂委係喺會議上面對住張表逐條揀）。
    built.rows.some((r) => r[1].indexOf('同一日') === 0 && r[4] === '同意\n要討論'));
  check('★★★★★ 軟規則嘅「現時設定」係換算過嘅人話',
    built.rows.some((r) => r[1].indexOf('主席和報告') === 0
      && r[3] === '13 個主日之中約 8 個'));
  check('★★★★★ 說明空白時唔可以留白'
    + '——留白會令堂委以為「呢條冇嘢做」',
    gas.buildRuleReviewSheetRows_(
      [ruleRow('SOFT_B', '某條規則', 'SOFT', 0.5, { description: '' })], 13)
    // 第二十八輪批次階段 B2：說明改成由本檔案嘅人話對照表出，
    // 對照表冇覆蓋到先退回試算表嗰欄——而退回時空白仍然唔可以留白。
      .rows.some((r) => r[2].indexOf('還沒有寫給堂委看的說明') !== -1));
  check('★★★★ meta 逐行對應（組標題行係 null）',
    built.meta.length === built.rows.length
    && built.meta[0] === null
    && built.meta.filter((m) => !!m).length === 3);
  check('★★★★★ 「堂委決定」同「備註」兩欄一律留空俾人填',
    built.rows.filter((r, i) => built.meta[i]).every((r) => r[5] === '' && r[6] === ''));
}

/* ══════════════════════════════════════════════════════════════
 * G2　匯入
 * ══════════════════════════════════════════════════════════════ */

const IMPORT_RULES = [
  ruleRow('HARD_A', '同一日不可以排同一個人兩個崗位', 'HARD', ''),
  ruleRow('SOFT_A', '主席和報告盡量由同一位擔任', 'SOFT', 0.63)
];

function sheetRow(seq, name, decision, note) {
  return [String(seq), name, '說明', '現時', '選項', decision, note || ''];
}

console.log('\n=== G2【核心】匯入只讀「堂委決定」同「備註」兩欄 ===');
{
  const values = [
    gas.RULE_REVIEW_HEADERS.slice(),
    ['目標值（想做到多少，做不到也不算錯）', '', '', '', '', '', ''],
    // 第 4 欄「現時設定」同第 5 欄「可以改成」特登填一啲亂七八糟嘅嘢，
    // 證明佢哋完全唔會影響結果。
    ['1', '主席和報告盡量由同一位擔任', '被人改過的說明', '被人改過的現時設定',
      '被人改過的選項', '13 個主日之中約 10 個', '堂委 2026-08 決議']
  ];
  const plan = gas.buildRuleReviewImportPlan_(values, IMPORT_RULES, 13);

  check('★★★★★ 就算「現時設定」「可以改成」被改過，一樣讀得出正確改動'
    + '——嗰份表會喺幾個人手上傳嚟傳去，任何一格都可能被順手改過',
    plan.changes.length === 1
    && Math.abs(plan.changes[0].newValue - 0.77) < 0.005,
    JSON.stringify(plan.changes));
  check('★★★★ 三欄對照齊全：現時／堂委決定／換算成系統嘅值',
    plan.changes[0].currentText === '13 個主日之中約 8 個'
    && plan.changes[0].decisionText === '13 個主日之中約 10 個'
    && plan.changes[0].currentValue === 0.63);
  check('★★★★ 備註跟住入嚟', plan.changes[0].note === '堂委 2026-08 決議');
}

console.log('\n=== G2【核心】硬規則一律唔可以由匯入改動 ===');
{
  const values = [
    gas.RULE_REVIEW_HEADERS.slice(),
    sheetRow(1, '同一日不可以排同一個人兩個崗位', '要討論', '這一條太嚴了')
  ];
  const plan = gas.buildRuleReviewImportPlan_(values, IMPORT_RULES, 13);
  check('★★★★★ 硬規則唔會出現喺 changes（即係唔會被改動）'
    + '——硬規則係「一定唔可以違反」嘅嘢，'
    + '唔應該由一份試算表嘅一格下拉去關掉',
    plan.changes.length === 0);
  check('★★★★★ 但意見會記低（hardNotes），唔會靜靜掉咗',
    plan.hardNotes.length === 1
    && plan.hardNotes[0].decision === '要討論'
    && plan.hardNotes[0].note === '這一條太嚴了');
}

console.log('\n=== G2 睇唔明／冇改動嘅要列出原因，唔可以靜靜略過 ===');
{
  const values = [
    gas.RULE_REVIEW_HEADERS.slice(),
    sheetRow(1, '主席和報告盡量由同一位擔任', '少少啦', ''),
    sheetRow(2, '一條系統沒有的規則', '13 個主日之中約 3 個', ''),
    // ⚠️ 下拉裡面「維持現狀」嗰個選項嘅**完整文字**係帶住標記嘅。
    // 用唔完整嘅文字就會落入「看不懂」——而嗰個行為係啱嘅：
    // 匯入只認下拉入面真正有嘅選項，唔會靠猜。
    sheetRow(3, '主席和報告盡量由同一位擔任', '13 個主日之中約 8 個（維持現狀）', '')
  ];
  const plan = gas.buildRuleReviewImportPlan_(values, IMPORT_RULES, 13);
  check('★★★★★ 三種情況都列入 ignored，而且各有原因',
    plan.ignored.length === 3, JSON.stringify(plan.ignored));
  check('★★★★ 看不懂的決定：講明「不會改動任何東西」',
    plan.ignored.some((i) => i.reason.indexOf('看不懂') !== -1));
  check('★★★★★ 規則名被改過 ⇒ 對唔返，而且要講出嚟'
    + '——靜靜略過就會變成「我明明填咗，點解冇生效」',
    plan.ignored.some((i) => i.reason.indexOf('找不到這一條規則') !== -1));
  check('★★★★ 同現時一樣 ⇒ 唔算改動',
    plan.ignored.some((i) => i.reason.indexOf('跟現在的設定一樣') !== -1));
  check('★★★★ 完全冇填嘅行唔會出現喺任何一組',
    gas.buildRuleReviewImportPlan_(
      [gas.RULE_REVIEW_HEADERS.slice(), sheetRow(1, '主席和報告盡量由同一位擔任', '', '')],
      IMPORT_RULES, 13).ignored.length === 0);
}

/* ══════════════════════════════════════════════════════════════
 * 後端：寫入行為
 * ══════════════════════════════════════════════════════════════ */

console.log('\n=== G2 後端寫入 ===');
{
  const exec = backend.slice(backend.indexOf('function apiRuleReviewImportExecute'));
  check('★★★★★ 執行時後端自己重新算一次計畫，前端只傳「接受邊幾條」',
    /const plan = apiRuleReviewImportPlan\(fileId\);/.test(exec)
    && /accepted\[c\.ruleId\]/.test(exec));
  // ⚠️ 第二十八輪批次階段 B4：有啲選項改目標值、有啲改開關（例如「關掉」），
  // 所以寫入嗰欄而家由選項自己指定（`c.field`）。
  // 兩者混做一欄嘅話，一個 boolean 會被寫入 TargetValue，
  // 之後被 `Number()` 讀成 NaN——規則靜靜失效。
  check('★★★★★ 只寫**一欄**，而且係選項指定嗰欄',
    /const column = c\.field === RULE_REVIEW_FIELD\.ENABLED \? R\.ENABLED : R\.TARGET_VALUE;/.test(exec)
    && /updates\[column\] = c\.newValue;/.test(exec)
    && (exec.match(/updates\[/g) || []).length === 1);
  check('★★★★★ 硬規則只寫 AuditLog（RULE_REVIEW_NOTE_ONLY），完全唔會經過寫入路徑',
    /action: 'RULE_REVIEW_NOTE_ONLY'/.test(exec)
    && /plan\.hardNotes\.forEach[\s\S]{0,400}?RULE_REVIEW_NOTE_ONLY/.test(exec)
    && !/plan\.hardNotes\.forEach[\s\S]{0,400}?writeRowFields_/.test(exec));
  check('★★★★ 每一條改動都寫 AuditLog，而且 old／new 兩邊都有',
    /oldValue: column \+ '=' \+ c\.currentValue/.test(exec)
    && /newValue: column \+ '=' \+ c\.newValue/.test(exec));

  const exp = backend.slice(
    backend.indexOf('function apiExportRuleReviewSheet'),
    backend.indexOf('function apiListRuleReviewSheets'));
  check('★★★★★ 匯出完全唔碰 RuleSettings（只讀）',
    !/writeRowFields_|R\.TARGET_VALUE\] =/.test(exp));
  check('★★★★ 「堂委決定」黃底 ＋ 下拉（其餘欄由系統產生）',
    /setBackground\(GRID_COLORS\.WARNING\)/.test(exp)
    && /requireValueInList\(m\.choices\.map\(function \(c\) \{ return c\.label; \}\), true\)/.test(exp));
  check('★★★★★ 分母要講出嚟（查不到嗰陣，表上會寫百分比而唔係次數）',
    /weeksText:/.test(exp));
  check('★★★★ 放入 RuleReview 子資料夾', /RULE_REVIEW_FOLDER_NAME/.test(backend));
}

console.log('\n=== G2 前端：同掣 1 一樣嘅三欄對照，預設全部唔接受 ===');
{
  check('★★★★★ 逐條有 checkbox，而且預設 false',
    /ruleImportDecisions\[key\] = false;/.test(zone4));
  check('★★★★ 明講「預設全部不接受——你要主動勾」',
    zone4.indexOf('逐條決定要不要接受。預設全部不接受——你要主動勾。') !== -1);
  check('★★★★★ 三欄對照：現時／堂委決定／換算成系統嘅值',
    /'現時：' \+ c\.currentText/.test(zone4)
    && /'堂委決定：' \+ c\.decisionText/.test(zone4)
    && /'換算成系統的值：'/.test(zone4));
  check('★★★★★ 硬規則嗰組明講「不會被匯入改動」',
    zone4.indexOf('這一組不會被匯入改動，系統只會把堂委的意見記進紀錄。') !== -1);
  check('★★★★ 匯出畫面明講「不會改動系統現時任何一條規則」',
    zone4.indexOf('・不會改動系統現時任何一條規則') !== -1);
}

/* ══════════════════════════════════════════════════════════════
 * G1　年度工具
 * ══════════════════════════════════════════════════════════════ */

console.log('\n=== G1 年度工具搬入區二 ===');
{
  check('★★★★ 「確認特別主日」畫面底部有兩粒掣',
    /button\('產生下一年度四個季度', \(\) => openAnnualTool\('quarters'\), 'secondary'\)/.test(zone2)
    && /button\('產生年度合堂建議', \(\) => openAnnualTool\('combined'\), 'secondary'\)/.test(zone2));
  check('★★★★★ 而且「暫時請用選單」嗰段已經拆走',
    !/這個工具本輪還沒有搬上網頁/.test(zone2));
  check('★★★★★ 兩個都係先預覽（列出全部會新增嘅行）',
    /callServer\(api, yearInput\.value\.trim\(\)\)/.test(zone2)
    && /plan\.rows\.forEach/.test(zone2));
  check('★★★★★ 兩個都要打字確認（都係寫入動作）',
    (zone2.match(/requireTyping: true,\s*\n\s*confirmLabel: '確定寫入'/g) || []).length === 2);
  check('★★★★★ 確認畫面有「不會做的事」，而且明講唔會覆寫既有資料',
    zone2.indexOf('・不會覆寫任何一格既有資料') !== -1
    && zone2.indexOf('・不會覆寫已經存在的那幾日') !== -1);
  check('★★★★★ 冇 QuarterID 嘅合堂建議會喺**預覽**就標明會略過'
    + '——冇 QuarterID 嘅行寫落去等於垃圾行（全系統都讀唔到），'
    + '唔可以寫完先發現',
    /willWrite: !p\.alreadyExists && !!p\.quarterId/.test(backend)
    && zone2.indexOf('找不到對應的季度（那一季還沒有建立），略過') !== -1);
  check('★★★★ 略過嘅一定要報出嚟', /res\.skipped\.length > 0/.test(zone2));
  check('★★★★★ 後端自己重新算一次，唔信前端傳返嚟嗰份',
    /const plan = apiAnnualQuartersPlan\(year\);/.test(backend)
    && /const preview = apiAnnualCombinedPlan\(year\);/.test(backend));
  check('★★★★★ 打字確認喺後端再驗一次',
    (backend.match(/!== ANNUAL_TOOL_CONFIRM_TEXT/g) || []).length === 2);
  check('★★★★★ 而且寫 AuditLog',
    /action: 'ANNUAL_QUARTERS_CREATE'/.test(backend)
    && /action: 'ANNUAL_COMBINED_CREATE'/.test(backend));
  check('★★★★★ 選單版一行都冇改（兩個 wizard 仍然存在）',
    /function runAnnualQuartersWizard_/.test(read('src/AnnualQuarters.gs'))
    && /function runAnnualCombinedWizard_/.test(read('src/AnnualCombined.gs')));
}

console.log('\n=== G 呼叫層：讀寫分流 ===');
{
  const listMatch = common.match(/const READ_ONLY_APIS = \[([\s\S]*?)\];/);
  const readOnly = (listMatch[1].match(/'([A-Za-z0-9_]+)'/g) || []).map((s) => s.replace(/'/g, ''));
  ['apiAnnualQuartersPlan', 'apiAnnualCombinedPlan',
    'apiListRuleReviewSheets', 'apiRuleReviewImportPlan'].forEach(function (n) {
    check('★★★★ ' + n + ' 喺唯讀白名單', readOnly.indexOf(n) !== -1);
  });
  ['apiAnnualQuartersExecute', 'apiAnnualCombinedExecute',
    'apiExportRuleReviewSheet', 'apiRuleReviewImportExecute'].forEach(function (n) {
    const src = n.indexOf('Annual') !== -1 ? zone2 : zone4;
    check('★★★★★ ' + n + ' 唔喺白名單，而且用 callServerMutating()',
      readOnly.indexOf(n) === -1 && src.indexOf("callServerMutating('" + n + "'") !== -1);
  });
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);

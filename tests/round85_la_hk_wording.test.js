// 第八十五輪批次 LA 組：介面文字改用香港書面語；〔給所有人〕不用藍色；一次性更新說明文字。
// 執行方式：node tests/round85_la_hk_wording.test.js
//
//   LA1　防止回退：src/ 全部使用者可見字串字面值（略過註解）沒有撳、掣、清走、刪走、接住、嘅、咗、喺、唔、
//        裡、呢個、幾多、一齊、即刻、係（「關係」除外）、著（顯著、著作、著名、著重、著想除外）、什麼
//   LA2　掃描器本身：字串內的口語字會被抓到；註解內的不會；「關係」「顯著」不算
//   LA3　第一部分九項的新字眼都在畫面（〔整季重設〕〔確定重設〕「記錄中……」等）
//   LA4　第 3 步四個寄出按鈕同一個樣式（secondary），沒有藍色主按鈕
//   LA5　RosterVersions.Notes 新紀錄寫「儲存並確認：人手改動 N 格」（不再寫「掣 1」）
//   LA6　一次性更新說明文字：完全等於舊文字才改；不同就略過；每格 AuditLog；第二次全部「已是新內容」
// 下面用假資料，不涉及真實姓名。

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { extractStringLiterals } = require('./helpers/string_literals.js');
const { loadGasSource } = require('./helpers/gas_loader.js');
const { RealisticMockSpreadsheet, seedSheet } = require('./helpers/mock_sheets_realistic.js');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 900));
}
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const BANNED = ['撳', '掣', '清走', '刪走', '接住', '嘅', '咗', '喺', '唔', '裡', '呢個', '幾多', '一齊', '即刻', '係', '著', '什麼'];

/**
 * 一段字串裏面的禁用字（「係」排除「關係」；「著」排除顯著、著作、著名、著重、著想）。
 * @param {string} text 字串
 * @returns {string[]}
 */
function bannedIn(text) {
  return BANNED.filter((w) => {
    let t = text;
    if (w === '係') t = t.replace(/關係/g, '');
    if (w === '著') t = t.replace(/顯著|著作|著名|著重|著想/g, '');
    return t.indexOf(w) !== -1;
  });
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
    ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

/**
 * 掃一個檔案；一次性更新工具的 `old:` 行（試算表現時的舊文字，用來核對）略過。
 * @param {string} rel 相對路徑
 * @param {string} src 檔案內容
 * @returns {string[]} 「檔案:行 [字] 內容」
 */
function scanFile(rel, src) {
  const lines = src.split('\n');
  return extractStringLiterals(src, rel).filter((l) => {
    if (/SheetTextUpdate\.gs$/.test(rel) && /^\s*old: '/.test(lines[l.line - 1] || '')) return false;
    return bannedIn(l.text).length > 0;
  }).map((l) => rel + ':' + l.line + ' [' + bannedIn(l.text).join('、') + '] ' + l.text.slice(0, 80));
}

console.log('\n=== LA1：src/ 使用者可見字串沒有口語字 ===');
{
  const files = walk(SRC).filter((f) => /\.(gs|html)$/.test(f));
  const found = [];
  let literalCount = 0;
  files.forEach((f) => {
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    const src = fs.readFileSync(f, 'utf8');
    literalCount += extractStringLiterals(src, rel).length;
    scanFile(rel, src).forEach((x) => found.push(x));
  });
  check('★★★★★★ ' + files.length + ' 個檔案、' + literalCount + ' 段字串，一個口語字都沒有', found.length === 0, found.slice(0, 30).join('\n'));
  check('★★★★ 開發者測試工具也有掃到（SelfTestRunner、MonkeyRun、SeasonRehearsal 等）',
    ['SelfTestRunner.gs', 'MonkeyRun.gs', 'SeasonRehearsal.gs', 'SeasonRehearsalResume.gs', 'EpsilonTrial.gs',
      'MultiRun.gs', 'Invariants.gs', 'Debug.gs'].every((n) => files.some((f) => f.endsWith(n))));
}

console.log('\n=== LA2：掃描器本身 ===');
{
  const fixture = [
    "// 註解：撳掣清走唔緊要",
    "/* 區塊註解：嘅咗喺 */",
    "const a = '請撳「重新整理」';",
    "const b = \"沒有關係\";",
    "const c = '效果顯著';",
    "const d = `留著 ${x ? '裡面' : ''}`;",
    "const r = /撳/.test(s);"
  ].join('\n');
  const hits = scanFile('fixture.gs', fixture);
  check('★★★★★ 字串內的「撳」被抓到', hits.some((h) => /請撳/.test(h)), hits.join('\n'));
  check('★★★★★ 模板字串和 ${} 內的字串都被抓到', hits.some((h) => /留著/.test(h)) && hits.some((h) => /裡面/.test(h)), hits.join('\n'));
  check('★★★★★ 註解內的口語字不算', !hits.some((h) => /唔緊要|嘅咗喺/.test(h)), hits.join('\n'));
  check('★★★★ 「關係」「顯著」不算', !hits.some((h) => /關係|顯著/.test(h)), hits.join('\n'));
  check('★★★★ 正規表示式不算字串', !hits.some((h) => /:7 /.test(h)), hits.join('\n'));
  const html = '<!-- 註解：撳 -->\n<div>請撳這裏</div>\n<script>\n// 撳\nconst t = \'見到嘅\';\n</script>';
  const hh = scanFile('fixture.html', html);
  check('★★★★★ HTML 文字和 <script> 內字串都掃到；HTML 註解和 JS 註解不算',
    hh.length === 2 && hh.some((h) => /請撳這裏/.test(h)) && hh.some((h) => /見到嘅/.test(h)), hh.join('\n'));
}

console.log('\n=== LA3：第一部分九項的新字眼 ===');
{
  const z3 = read('src/ui/ScriptZone3.html');
  const all = walk(SRC).filter((f) => /\.(gs|html)$/.test(f)).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  check('★★★★★ 〔整季重設〕〔確定重設〕「重設中，請稍候」「已重設「…」」',
    /zone4Row\('整季重設'/.test(z3) && /'確定重設'/.test(z3) && /重設中，請稍候/.test(z3) && /已重設「/.test(z3));
  check('★★★★ 主畫面提示「用「常用設定 ▸ 整季重設」」', /用下面「常用設定 ▸ 整季重設」/.test(read('src/ui/ScriptMainFlow.html')));
  check('★★★★ 打字確認字眼照舊「確認重設」', /QUARTER_RESET_CONFIRM_TEXT\s*=\s*'確認重設'/.test(all));
  check('★★★★ 〔繼續處理餘下的〕', /繼續處理餘下的/.test(read('src/ui/ScriptSendPaper.html')));
  check('★★★★ 「開啟職事表檢查和修改」', /開啟職事表檢查和修改/.test(read('src/ui/ScriptZone1.html')));
  check('★★★★ 進階與診斷小字「出現問題或需要核對資料時使用」', /出現問題或需要核對資料時使用/.test(read('src/ui/Index.html')));
  const s = read('src/ui/Script.html');
  check('★★★★ 「記錄中……」「這一格未能記錄，請再勾一次」', /　記錄中……/.test(s) && /　這一格未能記錄，請再勾一次/.test(s));
  check('★★★★ 「逐個檔案（只想印其中一兩位就用這裏）」', /逐個檔案（只想印其中一兩位就用這裏）/.test(read('src/ui/ScriptSendPaper.html')));
  const menu = read('src/Menu.gs');
  check('★★★★ 測試工具選單四項新名稱',
    menu.indexOf("'⚠️ 執行自測（沙盒季度，DRY_RUN）'") !== -1 && menu.indexOf("'▶️ 繼續執行自測'") !== -1
    && menu.indexOf("'▶️ 只重新執行紅色情境'") !== -1 && menu.indexOf("'⚠️⚠️ 全季流程演練（第一段：從頭開始）'") !== -1);
  check('★★★★ 重設季度測試資料「連 v0 一併清除」', /連 v0 一併清除/.test(menu));
  check('★★★★ 舊字眼不再出現在字串（整季清走重來、確定清走、接住做餘下的）',
    !/['"]整季清走重來|確定清走['"]|接住做餘下的/.test(all.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')));
}

console.log('\n=== LA4：第 3 步四個寄出按鈕同一個樣式 ===');
{
  const ui = loadUiScripts(['Script.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html',
    'ScriptZone4.html', 'ScriptMainFlow.html', 'ScriptSendPaper.html', 'ScriptSuggestion.html', 'ScriptRollback.html']);
  vm.runInContext("currentQuarterId = '2099T1';", ui);
  const card = ui.renderStepSend({ latestVersion: { versionNo: 2 }, officialSentOnce: false, buttons: {} });
  const buttons = card.flatten().filter((n) => n.tagName === 'BUTTON');
  check('★★★★★★ 四個按鈕全部是 secondary（沒有藍色主按鈕）',
    buttons.length === 4 && buttons.every((b) => /\bsecondary\b/.test(b.className)),
    JSON.stringify(buttons.map((b) => [b.textContent, b.className])));
  const all = buttons.filter((b) => b.textContent === '給所有人')[0];
  check('★★★★★ 〔給所有人〕仍然可以按', all && all.disabled === false);
}

console.log('\n=== LA5：版本 Notes 不再寫「掣 1」 ===');
{
  const save = read('src/WebAppSaveConfirm.gs');
  check('★★★★★ 新紀錄寫「儲存並確認：人手改動 N 格」', /\+ '儲存並確認：人手改動 ' \+ resolved\.changes\.length \+ ' 格'/.test(save));
  check('★★★★ 字串內沒有「掣 1」', !/'[^'\n]*掣 1[^'\n]*'/.test(save));
}

console.log('\n=== LA6：一次性更新說明文字 ===');
{
  const gas = loadGasSource(['Constants.gs', 'MutationLock.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs', 'SheetTextUpdate.gs']);
  const C = gas.COLUMNS; const S = gas.SHEETS;
  const ss = new RealisticMockSpreadsheet();
  gas.SpreadsheetApp = { getActiveSpreadsheet: () => ss };
  gas.Session = { getActiveUser: () => ({ getEmail: () => 'k@example.invalid' }) };
  gas.Utilities = { formatDate: () => '2099-01-01 09:00:00' };
  gas.CacheService = { getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {} }) };
  gas.PropertiesService = { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) };
  const items = gas.SHEET_TEXT_UPDATES_R85;
  const json = JSON.parse(read('browser-test/第八十五輪_介面用字清單.json'));
  check('★★★★★ 19 格（json sheet_cells）＋ RuleSettings HARD_MUTEX_GROUP 一格', items.length === 20 && json.sheet_cells.length === 19);
  check('★★★★★ 每一格的舊文字和 json 一字不差；新文字＝json（「什麼」統一為「甚麼」）',
    json.sheet_cells.every((c, i) => items[i].old === c.old && items[i].new === c.new.replace(/什麼/g, '甚麼')));
  const mutex = items[19];
  check('★★★★ 互斥組說明：舊「現時無任何組」→ 新「現時主席與聖餐襄禮為同一組（CHAIR_COMMUNION）」',
    mutex.key === 'HARD_MUTEX_GROUP' && /現時無任何組$/.test(mutex.old) && /現時主席與聖餐襄禮為同一組（CHAIR_COMMUNION）$/.test(mutex.new));
  check('★★★★ 新文字沒有口語字', items.every((x) => bannedIn(x.new).length === 0),
    items.filter((x) => bannedIn(x.new).length > 0).map((x) => x.key || x.cell).join('、'));

  const cfgItems = items.filter((x) => x.sheet === S.CONFIG);
  // Config：第一格內容不同（幹事改過）⇒ 略過；其餘等於舊文字
  const cfgRows = cfgItems.map((x, i) => {
    const r = {}; r[C.CONFIG.KEY] = x.key; r[C.CONFIG.VALUE] = 'v';
    r[C.CONFIG.DESCRIPTION] = i === 0 ? '幹事自己改過的說明' : x.old; return r;
  });
  seedSheet(ss, S.CONFIG, ['K'], [C.CONFIG.KEY, C.CONFIG.VALUE, C.CONFIG.DESCRIPTION], cfgRows);
  const una = ss.insertSheet(S.UNAVAILABLE);
  una.getRange(1, 1, 1, 1).setValues([[items[18].old]]);
  const ruleRow = {}; ruleRow[C.RULE_SETTINGS.RULE_ID] = 'HARD_MUTEX_GROUP'; ruleRow[C.RULE_SETTINGS.DESCRIPTION] = mutex.old;
  seedSheet(ss, S.RULE_SETTINGS, ['R'], [C.RULE_SETTINGS.RULE_ID, C.RULE_SETTINGS.DESCRIPTION], [ruleRow]);
  seedSheet(ss, S.AUDIT_LOG, ['A'], Object.values(C.AUDIT_LOG), []);

  const plan = gas.planSheetTextUpdate_();
  const st = (k) => plan.items.filter((x) => x.status === k).length;
  check('★★★★★★ 計劃：19 格會改、1 格內容不同（略過）', st('WILL_UPDATE') === 19 && st('DIFFERENT') === 1,
    JSON.stringify(plan.items.map((x) => x.status)));
  const html = gas.buildSheetTextUpdateDialogHtml_(plan);
  check('★★★★★ 確認窗逐格列出會改／略過，有〔更新〕〔取消〕',
    (html.match(/<li>[^"]/g) || []).length === 20 && /略過（現時內容與舊文字不同，不會改動）/.test(html)
    && />更新<\/button>/.test(html) && />取消<\/button>/.test(html));
  check('★★★★ 計劃只讀：一格都未改', ss.getSheetByName(S.CONFIG).getRange(4, 3).getValue() === cfgItems[1].old);

  const r1 = gas.apiApplySheetTextUpdate();
  check('★★★★★★ 〔更新〕⇒ 改了 19 格', r1.updated === 19, JSON.stringify(r1));
  check('★★★★★ Config 按 Key 找行改 Description；內容不同那一格沒有改',
    ss.getSheetByName(S.CONFIG).getRange(4, 3).getValue() === cfgItems[1].new
    && ss.getSheetByName(S.CONFIG).getRange(3, 3).getValue() === '幹事自己改過的說明');
  check('★★★★★ Unavailable!A1、RuleSettings 互斥組都改了',
    ss.getSheetByName(S.UNAVAILABLE).getRange(1, 1).getValue() === items[18].new
    && ss.getSheetByName(S.RULE_SETTINGS).getRange(3, 2).getValue() === mutex.new);
  const audit = gas.readSheet(S.AUDIT_LOG).filter((r) => r[C.AUDIT_LOG.ACTION] === 'SHEET_TEXT_UPDATED');
  check('★★★★★ 每格一筆 AuditLog（共 19 筆，有舊值和新值）', audit.length === 19
    && audit.every((r) => r[C.AUDIT_LOG.OLD_VALUE] && r[C.AUDIT_LOG.NEW_VALUE]), audit.length);
  const r2 = gas.apiApplySheetTextUpdate();
  const plan2 = gas.planSheetTextUpdate_();
  check('★★★★★★ 再執行一次 ⇒ 0 格；會改的 19 格全部「已是新內容」',
    r2.updated === 0 && plan2.items.filter((x) => x.status === 'ALREADY_NEW').length === 19
    && r2.lines.filter((l) => /已是新內容$/.test(l)).length === 19, JSON.stringify(r2.lines.slice(0, 3)));
  check('★★★★ 選單「維護 ▸ 更新說明文字（一次性）」', /\.addItem\('更新說明文字（一次性）', 'runSheetTextUpdate_'\)/.test(read('src/Menu.gs')));
}

console.log(fail === 0 ? '\nALL PASS' : '\n' + fail + ' FAILURE(S)');
process.exitCode = fail === 0 ? 0 : 1;

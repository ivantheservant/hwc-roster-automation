// 第一百零九輪批次 SC 組：自由文字以 =、+、-、@ 開頭不可以變成公式（Utils.gs sheetSafeText_()）
// 執行方式：node tests/round109_sc_formula_text.test.js
// 場景：tests/helpers/unavailable_scene.js（假 ID P97xx、example.invalid）。測試用的試算表模擬與真實試算表一樣，存入時去掉最前的單引號。

const fs = require('fs');
const path = require('path');
const { buildUnavailableScene, tok, T1 } = require('./helpers/unavailable_scene.js');

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('PASS  ' + name);
  else { failures++; console.log('FAIL  ' + name + (detail !== undefined ? '\n      ' + String(detail).slice(0, 1500) : '')); }
}
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const sc = buildUnavailableScene({ config: {}, today: '2098-11-01' });
const g = sc.gas;

console.log('\n=== SC1 共用函式 ===');
{
  const risky = ['=1+1', '=HYPERLINK("https://example.invalid","x")', '+abc', '-abc', '@abc', '  =1+1', '\n=1+1', '\t@x'];
  check('★★★★★★ 以 =、+、-、@ 開頭（包括前面有空白、Tab、換行）⇒ 前面加單引號', risky.every((t) => g.sheetSafeText_(t) === "'" + t),
    JSON.stringify(risky.map((t) => g.sheetSafeText_(t))));
  const normal = ['出外旅行', 'a=b', '公幹 - 一星期', '', '電郵 a@example.invalid'];
  check('★★★★★★ 正常文字不變', normal.every((t) => g.sheetSafeText_(t) === t));
  check('★★★★★ 非文字不變（數字、布林、null）', g.sheetSafeText_(-5) === -5 && g.sheetSafeText_(true) === true && g.sheetSafeText_(null) === null);
}

console.log('\n=== SC2 個人連結提交「=1+1」⇒ 讀回是文字「=1+1」；確認後抄到 Unavailable 亦一樣 ===');
{
  sc.today = '2098-11-01';
  // 記下真正交給試算表的值（真實試算表見到沒有單引號的「=1+1」會當作公式）
  const written = [];
  const origAppend = g.appendRowFields_;
  g.appendRowFields_ = function (sheet, headers, rec) { written.push(Object.assign({}, rec)); return origAppend.apply(this, arguments); };
  const res = g.personalSubmitUnavailable(tok(1), '', [T1[1]], '=1+1');
  check('★★★★★ 提交成功', res && res.ok, JSON.stringify(res));
  check('★★★★★★ 交給試算表的原因前面有單引號（試算表當作純文字）', written.length === 1
    && written[0][g.COLUMNS.UNAVAILABLE_SUBMISSIONS.REASON] === "'=1+1", JSON.stringify(written));
  const sheet = sc.ss.getSheetByName(g.SHEETS.UNAVAILABLE_SUBMISSIONS);
  const headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  const raw = sheet.getRange(3, headers.indexOf(g.COLUMNS.UNAVAILABLE_SUBMISSIONS.REASON) + 1).getValue();
  check('★★★★★★ UnavailableSubmissions 讀回原文（沒有多出單引號）', raw === '=1+1', JSON.stringify(raw));
  const subs = g.readUnavailableSubmissions_('Pacific/Auckland');
  const id = subs.filter((s) => s.serviceDate === T1[1])[0].submissionId;
  const dec = g.apiDecideUnavailableSubmissions([id], 'ACCEPT');
  check('★★★★★ 確認成功', dec && dec.ok !== false, JSON.stringify(dec));
  check('★★★★★★ 抄到 Unavailable 時亦加單引號', written.length === 2 && written[1][g.COLUMNS.UNAVAILABLE.REASON] === "'=1+1", JSON.stringify(written[1]));
  g.appendRowFields_ = origAppend;
  const unav = g.readSheet_(g.SHEETS.UNAVAILABLE);
  check('★★★★★★ 抄到 Unavailable 的原因亦是原文', unav.length === 1 && unav[0][g.COLUMNS.UNAVAILABLE.REASON] === '=1+1', JSON.stringify(unav));
}

console.log('\n=== SC3 寫入位置全部經過共用函式 ===');
{
  const pu = read('src/PersonalUnavailable.gs');
  check('★★★★★★ 個人連結：提交及抄到 Unavailable', /rec\[S\.REASON\] = sheetSafeText_\(cleanReason\)/.test(pu) && /rec\[U\.REASON\] = sheetSafeText_\(s\.reason\)/.test(pu));
  const u = read('src/Utils.gs');
  check('★★★★★ AuditLog 舊值、新值、備註', /record\[C\.OLD_VALUE\] = sheetSafeText_/.test(u) && /record\[C\.NEW_VALUE\] = sheetSafeText_/.test(u)
    && /record\[C\.NOTES\] = sheetSafeText_/.test(u));
  check('★★★★★ 幹事輸入：「其他（自己輸入）」名字、每週標題、特別主日標題、不能服侍原因、偏好原因、排除原因及備註、崗位備註',
    /record\[P\.FREE_TEXT\] = sheetSafeText_/.test(read('src/PreAssign.gs'))
    && /setValue\(sheetSafeText_\(newTitle\)\)/.test(read('src/SheetReader.gs'))
    && (read('src/WebAppPreQuarterEdit.gs').match(/updates\[S\.TITLE\] = sheetSafeText_/g) || []).length === 2
    && /newValues\[U\.REASON\] = sheetSafeText_/.test(read('src/WebAppUnavailable.gs'))
    && /record\[W\.REASON\] = sheetSafeText_/.test(read('src/WebAppWeightEdit.gs'))
    && (read('src/WebAppExclusions.gs').match(/sheetSafeText_\(/g) || []).length === 4
    && (read('src/WebAppRoles.gs').match(/sheetSafeText_\(/g) || []).length === 2);
}

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);

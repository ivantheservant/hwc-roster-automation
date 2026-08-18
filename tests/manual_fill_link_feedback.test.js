// 第二十五輪批次階段 B：填講員／翻譯／獻花——拆走建議、加「有冇對上名單」回饋。
// 執行方式：node tests/manual_fill_link_feedback.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 點解拆走建議下拉
// ─────────────────────────────────────────────────────────────────────
//
// 講員多數外請或客席、翻譯視乎該週講員嘅語言需要臨時決定、
// 獻花由會友認獻幾乎每次唔同人。用歷史記錄去猜命中率極低，
// 反而阻住幹事打字。而且**根本冇資料**——呢三個崗位喺
// `RosterAssignments` 從來冇填過一次，所以嗰條建議名單一直都係空。
//
// ─────────────────────────────────────────────────────────────────────
// 取而代之嗰句字，先係真正擋到風險嗰句
// ─────────────────────────────────────────────────────────────────────
//
// 翻譯打錯一個字，嗰位弟兄姊妹就**永遠收唔到通知**——正式發出嗰陣
// 佢唔喺收件名單入面。而畫面上完全睇唔出：職事表照樣印住個名，
// PDF 照樣有佢，一切正常。
//
// `linkedToNameMapping` 呢一句係唯一會即刻話你知嘅位。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'QuarterStage.gs', 'PreacherTranslationFill.gs'
]);

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}
function checkEqual(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}

const backend = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'PreacherTranslationFill.gs'), 'utf8');
const zone2 = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'ui', 'ScriptZone2.html'), 'utf8');
const sidebar = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'ui', 'PreacherFillSidebar.html'), 'utf8');

console.log('\n=== B1【核心】建議名單三個欄位同埋產生器全部拆走 ===');
{
  ['preacherSuggestions', 'translationSuggestions', 'flowerSuggestions',
    'suggestionsByPostId', 'suggestHistoricalNames_'].forEach(function (name) {
    check('★★★★ 後端已經冇 ' + name, backend.indexOf(name) === -1);
  });
  check('★★★★★ 側邊欄亦已經拆走（唔可以淨係拆後端——'
    + '拆咗後端而前端照讀，就會攞到 undefined 再喺 .length 度爆）',
    ['preacherSuggestions', 'translationSuggestions', 'flowerSuggestions',
      'suggestionsFor', 'fillSuggestion'].every(function (n) {
      return sidebar.indexOf(n) === -1;
    }));
  check('★★★★ 幹事介面亦已經拆走',
    zone2.indexOf('suggestionsByPostId') === -1);

  const wholeSrc = fs.readdirSync(path.join(__dirname, '..', 'src'))
    .filter(function (f) { return f.endsWith('.gs'); })
    .map(function (f) { return fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'); })
    .join('\n');
  check('★★★★★ 全 src/ 都冇人再叫 suggestHistoricalNames_()'
    + '（確認真係冇其他呼叫端，唔係刪咗一個仲有人用嘅函式）',
    wholeSrc.indexOf('suggestHistoricalNames_') === -1);
}

console.log('\n=== B1 但 pending 同 officialSentHint 一定要留 ===');
{
  const fn = backend.slice(backend.indexOf('function apiListPreacherTranslationPending'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 3);
  check('★★★★★ pending 仲喺度（拆建議唔可以順手拆走個主體）',
    /pending: pending/.test(body));
  check('★★★★ officialSentHint 仲喺度', /officialSentHint:/.test(body));
  check('★★★★ optional（獻花可留空）仲喺度', /optional: postId === ids\.flowerPostId/.test(body));
}

console.log('\n=== B2【核心】輸入格要關掉瀏覽器自動填充 ===');
{
  // Ivan 實測：Chrome 當咗個姓名格係聯絡人欄位，彈出佢自己嘅通訊錄。
  // 幹事會以為嗰啲係系統畀嘅建議，撳落去就填咗一個完全唔相干嘅人。
  check('★★★★★ 幹事介面嘅姓名格有 autocomplete = off',
    /input\.autocomplete = 'off';/.test(zone2));
  check('★★★★★ 而且有一個 Chrome 認唔出嘅 name'
    + '——單靠 autocomplete=off，Chrome 有時會照樣無視',
    /input\.name = 'hwc-person-free-text';/.test(zone2));
  check('★★★★ 側邊欄嗰個輸入格一樣',
    /autocomplete="off"/.test(sidebar) && /hwc-person-free-text/.test(sidebar));
}

console.log('\n=== B3【核心】儲存之後要講「有冇對上名單」 ===');
{
  check('★★★★★ 前端有 renderLinkFeedback()', /function renderLinkFeedback\(/.test(zone2));
  check('★★★★★ 儲存之後真係攞返個結果嚟用'
    + '（原本嗰句 await 冇收回傳值，即係後端講咗都冇人聽）',
    // 第二十七輪批次階段 A：呢個呼叫會寫入，所以改咗行 callServerMutating()
    // ——寫完之後狀態快取要標記過期，否則區二嘅「還有 N 項未做」會停喺舊數。
    /const res = await callServerMutating\('apiWebSavePreacherEntry'/.test(zone2));
  check('★★★★★ 對得上：講明佢會收到通知',
    zone2.indexOf('已對上名單上的「') !== -1 && zone2.indexOf('正式發出時他會收到通知。') !== -1);
  check('★★★★★ 對唔上：講明佢唔會收到，**而且講明外請講員屬正常**'
    + '——寫成錯誤嘅話，幹事會去「修正」一件根本冇問題嘅事',
    zone2.indexOf('名單上沒有這個名字，正式發出時不會寄給他。外請講員屬正常。') !== -1);
  check('★★★★ 兩種都唔用紅色（對唔上唔係錯誤）',
    /className = 'link-warn'/.test(zone2) && !/link-err/.test(zone2));
}

console.log('\n=== B3 後端一直都有回 linkedToNameMapping ===');
{
  const fn = backend.slice(backend.indexOf('function apiSavePreacherTranslationEntry'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 3);
  check('★★★★★ 回傳有 linkedToNameMapping', /linkedToNameMapping/.test(body));
  check('★★★★ 判斷準則係 resolvePersonId() 有冇搵到人',
    /resolvePersonId\(trimmedName\)/.test(body));
}

console.log('\n=== B3 核實 resolvePersonId() 嘅判斷準則 ===');
{
  // 呢一段係任務要求嘅「順便核實一次」。結論寫入稽核文件。
  const NM = gas.COLUMNS.NAME_MAPPING;
  const AL = gas.COLUMNS.NAME_ALIAS;
  const nmRow = function (id, name) {
    const r = {}; r[NM.PERSON_ID] = id; r[NM.NAME_TC] = name; return r;
  };
  const alRow = function (alias, id) {
    const r = {}; r[AL.ALIAS] = alias; r[AL.PERSON_ID] = id;
    r[AL.ACTIVE] = 'TRUE'; return r;
  };

  // ⚠️ 全部用明顯假嘅 PersonID（P9xxx）同假名——呢個 repo 係公開嘅。
  gas.readSheet = function (sheetName) {
    if (sheetName === gas.SHEETS.NAME_MAPPING) {
      return [nmRow('P9001', '測試甲'), nmRow('P9002', '測試乙')];
    }
    if (sheetName === gas.SHEETS.NAME_ALIAS) return [alRow('測試甲別寫', 'P9001')];
    return [];
  };

  checkEqual('★★★★ 完全一樣 ⇒ 對得上', gas.resolvePersonId('測試甲'), 'P9001');
  checkEqual('★★★★★ 經 NameAlias 亦對得上（別名係一條真出路）',
    gas.resolvePersonId('測試甲別寫'), 'P9001');
  checkEqual('★★★★★ 差一個字 ⇒ **對唔上**，唔會估最接近嗰個'
    + '——估錯就會寄錯人，兩邊都唔知發生咗咩事',
    gas.resolvePersonId('測試丙'), null);
  checkEqual('★★★★★ 前後有空格 ⇒ 對唔上（呼叫端已經 trim，但呢個函式本身唔會）',
    gas.resolvePersonId(' 測試甲'), null);
  checkEqual('★★★★★ 全形字 ⇒ 對唔上（冇做全形正規化）'
    + '——所以異體字／輸入法差異一定要靠 NameAlias 明確登記，唔會自動對到',
    gas.resolvePersonId('測試甲'.replace('甲', 'Ａ')), null);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);

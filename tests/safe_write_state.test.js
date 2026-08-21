// 第四十四輪批次 A 組：`Failed due to illegal value in property: 1`。
// 執行方式：node tests/safe_write_state.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 呢一份守住咩
// ═════════════════════════════════════════════════════════════════════
//
// Ivan 撳〔請系統幫我調整〕撞到三次同一句：
//
//     Failed due to illegal value in property: 1
//
// 而且**時好時壞**——同一串動作，有時爆有時唔爆。
//
// ─────────────────────────────────────────────────────────────────────
// ⚠️ 老實講清楚：我重現唔到嗰一句
// ─────────────────────────────────────────────────────────────────────
//
// 嗰句係 Google 嗰邊拋嘅，離線環境冇得拋。所以呢一份**唔係**
// 「重現咗然後修好」——佢守嘅係兩件可以驗證嘅事：
//
//   一、`PropertiesService` **唔係**成因（`src/` 一個 `setProperties(`
//   　　都冇，全部 `setProperty()` 都係字串常數 ＋ JSON.stringify）；
//   二、`Range.setValues()` 收到 `undefined`／`null`／物件嗰陣，
//   　　喺**寫落去之前**就會被擋住並且寫 log。
//
// 第二件係最貼近嗰句錯嘅假設：`Failed due to illegal value in
// property: <索引>` 入面嗰個「property」指嘅係傳入陣列嘅索引，
// 而「時好時壞」正正係「某一格嘅資料剛好走到某一條分支先會出現
// undefined」嘅指紋。

const { loadGasSource } = require('./helpers/gas_loader.js');
const fs = require('fs');
const path = require('path');

const gas = loadGasSource(['Constants.gs', 'Utils.gs']);

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 500));
}
function checkEqual(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}

const ROOT = path.join(__dirname, '..');
const read = function (rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); };

const logs = [];
gas.log_ = function (level, msg) { logs.push(level + ' ' + msg); };

// =====================================================================
console.log('\n=== A【核心】試算表寫唔到嘅值 ===');
{
  const bad = [undefined, null, {}, [], function () {}, new Date('x')];
  bad.forEach(function (v) {
    checkEqual('★★★★★ ' + String(v) + ' 寫唔到', gas.isSheetWritableValue_(v), false);
  });
  const good = ['', 'abc', 0, -1, 3.5, true, false, new Date(2099, 0, 1)];
  good.forEach(function (v) {
    checkEqual('★★★★ ' + String(v) + ' 寫得到', gas.isSheetWritableValue_(v), true);
  });
}

console.log('\n=== A【核心】洗一個有 undefined 嘅二維陣列 ===');
{
  logs.length = 0;
  // ⚠️ 呢個形狀就係最有可能拋 `illegal value in property: 1` 嗰個：
  // 索引 1 嗰一行入面有一個 undefined。
  const rows = [
    ['日期', '週次', '類型'],
    ['date', undefined, 'type'],
    ['2099-01-04', 1, '主日崇拜']
  ];
  const out = gas.sheetSafeValues_(rows, 'testcase');
  checkEqual('★★★★★★ `undefined` 換成空字串（**寫落去之前**就擋住）',
    out[1], ['date', '', 'type']);
  checkEqual('★★★★★ 其餘一格都冇改', [out[0], out[2]], [rows[0], rows[2]]);
  check('★★★★★★ 而且**唔係靜靜吞掉**——有 log，而且講得出係第幾行第幾欄'
    + '。靜靜換走而唔留痕，只會把一個資料問題變成一個'
    + '「表上有一格莫名其妙係空嘅」問題，而後者更難查',
    logs.some(function (l) {
      return l.indexOf('WARN') === 0 && l.indexOf('第 2 行第 2 欄') !== -1;
    }), logs.join('\n'));
}

console.log('\n=== A：行長度唔齊都要處理 ===');
{
  // `setValues()` 要求每一行長度一樣，唔齊會拋另一個一樣睇唔明嘅錯。
  const out = gas.sheetSafeValues_([['a', 'b', 'c'], ['d']], 'testcase');
  checkEqual('★★★★★ 短嗰行補齊', out[1], ['d', '', '']);
  checkEqual('★★★★ 每一行長度一樣', out.map(function (r) { return r.length; }), [3, 3]);
}

console.log('\n=== A：空陣列唔可以炸 ===');
{
  checkEqual('★★★★ 空陣列', gas.sheetSafeValues_([], 'testcase'), []);
  checkEqual('★★★★ null', gas.sheetSafeValues_(null, 'testcase'), []);
}

console.log('\n=== A【核心】`setSheetValuesSafely_()` 真係寫得出洗完嗰份 ===');
{
  const written = [];
  const fakeSheet = {
    getRange: function (row, col, numRows, numCols) {
      return {
        setValues: function (v) { written.push({ row: row, col: col, v: v }); }
      };
    }
  };
  gas.setSheetValuesSafely_(fakeSheet, 3, 1,
    [['a', undefined], ['b', 'c']], 'testcase');
  checkEqual('★★★★★★ 寫落去嗰份**一格 undefined 都冇**',
    written[0].v, [['a', ''], ['b', 'c']]);
  checkEqual('★★★★ 位置照傳', [written[0].row, written[0].col], [3, 1]);

  written.length = 0;
  gas.setSheetValuesSafely_(fakeSheet, 1, 1, [], 'testcase');
  checkEqual('★★★★★ 空陣列 ⇒ 完全唔叫 `setValues()`'
    + '（叫落去會拋一個「範圍高度係 0」嘅錯）', written.length, 0);
}

// =====================================================================
console.log('\n=== A【核心】`PropertiesService` 唔係成因（查證） ===');
{
  const srcDir = path.join(ROOT, 'src');
  const files = fs.readdirSync(srcDir).filter(function (f) { return /\.gs$/.test(f); });
  const hits = [];
  files.forEach(function (f) {
    const s = fs.readFileSync(path.join(srcDir, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    (s.match(/setProperties\s*\(/g) || []).forEach(function () { hits.push(f); });
  });
  checkEqual('★★★★★★ `src/` 一個 `setProperties(` 都冇'
    + '——嗰個先係會整出 `"0"`／`"1"` 呢種 key 嘅寫法。'
    + '（呢一條同時係 lint：日後有人加返一個就會紅）',
    hits, []);

  // 全部 `setProperty()` 都要係「字串常數 ＋ 字串值」。
  const direct = [];
  files.forEach(function (f) {
    if (f === 'SafeWrite.gs') return;   // 佢係唯一入口，見下面
    const s = fs.readFileSync(path.join(srcDir, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    (s.match(/PropertiesService[\s\S]{0,60}?\.setProperty\s*\(/g) || [])
      .forEach(function () { direct.push(f); });
  });
  checkEqual('★★★★★★ 除咗 `SafeWrite.gs` 之外，冇任何檔案直接寫 property'
    + '——一個唯一入口，就唔可能再有人攤開一個物件做多個 property',
    direct, ['WebApp.gs']);
  check('★★★★★ 而 `WebApp.gs` 嗰一個存嘅係一個字串常數（唔係狀態）',
    /setProperty\(WEBAPP_THEME_PROPERTY_KEY, normalized\)/.test(read('src/WebApp.gs')), '');
}

console.log('\n=== A：`saveState_()`／`readState_()` ===');
{
  const store = {};
  gas.PropertiesService = {
    getScriptProperties: function () {
      return {
        setProperty: function (k, v) {
          // ⚠️ 模擬 Apps Script 嗰個限制：value 唔係字串就拋。
          if (typeof v !== 'string') {
            throw new Error('Failed due to illegal value in property: ' + k);
          }
          store[k] = v;
        },
        getProperty: function (k) { return store[k] === undefined ? null : store[k]; },
        deleteProperty: function (k) { delete store[k]; }
      };
    }
  };

  gas.saveState_('T', { quarterId: '2099T1', versionNo: 3, rows: [1, 2] });
  check('★★★★★★ 存落去一定係一個**字串**（所以永遠唔會拋嗰句錯）',
    typeof store.T === 'string', typeof store.T);
  checkEqual('★★★★★ 而且只用**一個** key（唔會攤開做 "0"／"1"）',
    Object.keys(store), ['T']);
  checkEqual('★★★★★ 讀返出嚟一模一樣',
    gas.readState_('T'), { quarterId: '2099T1', versionNo: 3, rows: [1, 2] });

  store.T = '{壞咗嘅 JSON';
  logs.length = 0;
  checkEqual('★★★★★★ 爛咗嘅狀態 ⇒ 當作冇，**唔拋錯**'
    + '——拋錯嘅話幹事會完全卡死，而佢根本冇辦法去清嗰個 property',
    gas.readState_('T'), null);
  check('★★★★ 但要寫 log', logs.some(function (l) { return l.indexOf('WARN') === 0; }), '');

  checkEqual('★★★★ 冇存過 ⇒ null', gas.readState_('NOPE'), null);

  gas.clearState_('T');
  checkEqual('★★★★ 清得走', Object.keys(store), []);

  let threw = '';
  try { gas.saveState_('', {}); } catch (e) { threw = e.message; }
  check('★★★★★ 空 key ⇒ 拋錯（呢個係程式錯誤，唔係使用者錯）',
    threw.indexOf('空的 key') !== -1, threw);

  const circular = {};
  circular.self = circular;
  threw = '';
  try { gas.saveState_('C', circular); } catch (e) { threw = e.message; }
  check('★★★★★★ 序列化唔到 ⇒ **拋錯，唔可以靜靜略過**'
    + '——靜靜略過嘅話，下一次讀出嚟會係「冇狀態」，'
    + '而嗰個會令一個做到一半嘅批次由頭再做一次',
    threw.indexOf('序列化不到') !== -1, threw);
}

console.log('\n=== A：全部進度狀態都經咗嗰個唯一入口 ===');
{
  ['src/PdfBatch.gs', 'src/Tune.gs'].forEach(function (f) {
    const s = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    check('★★★★★ ' + f + ' 唔再直接掂 `PropertiesService`',
      s.indexOf('PropertiesService') === -1, '');
    check('★★★★ 而且改用咗 `saveState_()`／`readState_()`',
      /saveState_\(/.test(s) && /readState_\(/.test(s), '');
  });
}

// =====================================================================
console.log('\n=== A【核心】出錯嗰陣要講得出係邊一步 ===');
{
  const src = read('src/SuggestionSheet.gs');
  const bare = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ['判斷這一次的起點是哪一張表', '讀取那一張表並且計算建議',
    '寫入建議工作表', '記低這一次的起點指紋'].forEach(function (label) {
    check('★★★★★ 「' + label + '」呢一步有標籤',
      bare.indexOf("suggestionStep_('" + label + "'") !== -1, '');
  });

  gas.buildThreePartMessage_ = function (a, b, c) {
    return '發生了什麼：' + a + '\n現在的情況：' + b + '\n你可以怎樣做：\n'
      + c.map(function (x) { return '　・' + x; }).join('\n');
  };
  // 把真嘅 `suggestionStep_` 抽出嚟跑（唔重新實作一份）。
  const stepSrc = src.slice(src.indexOf('function suggestionStep_'));
  const fn = new Function('buildThreePartMessage_',
    stepSrc.slice(0, stepSrc.indexOf('\n}\n') + 2) + '\nreturn suggestionStep_;')
    (gas.buildThreePartMessage_);

  let msg = '';
  try {
    fn('寫入建議工作表', function () {
      throw new Error('Failed due to illegal value in property: 1');
    });
  } catch (e) { msg = e.message; }
  check('★★★★★★ 原本嗰句 `Failed due to illegal value in property: 1` '
    + '會變成一句講得出**係邊一步**嘅訊息'
    + '——三輪過去，嗰三次嘅資訊量加起嚟仍然係零',
    msg.indexOf('寫入建議工作表') !== -1
      && msg.indexOf('Failed due to illegal value in property: 1') !== -1, msg);
  check('★★★★★ 而且講明「職事表一格都冇改動」'
    + '（唔講嘅話，佢唔知自己要唔要去核對）',
    msg.indexOf('職事表一格都沒有改動') !== -1, msg);

  msg = '';
  try {
    fn('某一步', function () {
      throw new Error(gas.buildThreePartMessage_('已經係人話', '冇改動', ['做啲乜']));
    });
  } catch (e) { msg = e.message; }
  checkEqual('★★★★★ 已經係三段式嘅就原封不動（包多一層只會令佢讀到兩段重複嘅說明）',
    (msg.match(/發生了什麼：/g) || []).length, 1);

  let ok = '';
  try { ok = fn('某一步', function () { return '正常'; }); } catch (e) { ok = 'THREW'; }
  checkEqual('★★★★★ 冇出錯就原封不動回傳（包裝唔可以改變正常路徑）', ok, '正常');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);

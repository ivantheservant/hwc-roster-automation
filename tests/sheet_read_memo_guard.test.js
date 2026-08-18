// 第二十四輪批次階段 A1：`readSheet()` 快取要回傳複本，唔可以回傳快取本身。
// 執行方式：node tests/sheet_read_memo_guard.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 呢個測試防嘅係一個**將來**風險，唔係現有 bug
// ─────────────────────────────────────────────────────────────────────
//
// 掃描過全部 `readSheet()` 呼叫點（第二十四輪階段 A1）：
//   • 全部 `record[C.X] = …` 都係喺新建嘅 `{}` 上面
//   • 四處 `.sort()` 全部喺 `.filter()`／`.map()` 之後
// 所以目前冇任何一處會 mutate。
//
// 但快取一開，「有人 mutate 咗回傳值」就會由「只影響佢自己」變成
// 「污染埋同一次呼叫入面之後每一次讀取」——而且**完全冇聲**。
//
// 點解揀淺複本而唔揀 `Object.freeze()`：
//   freeze 喺非嚴格模式下係**靜靜失敗**（改動消失，程式繼續行）。
//   更決定性嘅係語意一致——冇快取嗰陣每次都回全新物件，
//   淺複本令有無快取行為完全一樣；freeze 就會令兩者唔同，
//   而個分別只喺「有開快取」嗰條路徑先浮現。

const { loadGasSource } = require('./helpers/gas_loader.js');
const fs = require('fs');
const path = require('path');

const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs']);

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

console.log('\n=== A1【核心】cloneMemoRows_ 真係造出獨立嘅新物件 ===');
{
  const original = [{ Name: '假甲', Count: 1 }, { Name: '假乙', Count: 2 }];
  const copy = gas.cloneMemoRows_(original);

  checkEqual('★★★★ 內容一樣', copy, original);
  check('★★★★★ 外層陣列係新物件', copy !== original);
  check('★★★★★ 每一行都係新物件（唔係共用同一個 reference）',
    copy[0] !== original[0] && copy[1] !== original[1]);

  // 改複本 ⇒ 原本嗰份唔可以受影響
  copy[0].Name = '被改咗';
  copy.push({ Name: '加多行' });
  copy.sort(function (a, b) { return String(a.Name) < String(b.Name) ? -1 : 1; });

  checkEqual('★★★★★ 改咗複本嘅 property，快取入面嗰份完全冇變',
    original[0].Name, '假甲');
  checkEqual('★★★★★ 喺複本 push／sort，快取入面嗰個陣列完全冇變',
    original.length, 2);
  checkEqual('★★★★ 而且次序都冇變', original[1].Name, '假乙');
}

console.log('\n=== A1：快取開／關嘅行為要一模一樣 ===');
{
  // 呢個先係揀複本而唔揀 freeze 嘅決定性理由。
  const rows = [{ A: 1 }];
  const fromMemo = gas.cloneMemoRows_(rows);

  let threwOnWrite = false;
  try { fromMemo[0].A = 999; } catch (e) { threwOnWrite = true; }

  check('★★★★★ 由快取攞返嚟嘅 row **改得到**（唔會拋錯、亦唔會靜靜失敗）'
    + '——同冇快取嗰陣完全一樣。'
    + 'freeze 就會令「有快取」同「冇快取」行為唔同，'
    + '而個分別只喺實際會行嗰條路徑先浮現',
    !threwOnWrite && fromMemo[0].A === 999);
}

console.log('\n=== A1：正式碼真係用咗複本（唔係淨係測 helper）===');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'SheetReader.gs'), 'utf8');

  check('★★★★★ 快取命中時回 cloneMemoRows_()，唔係直接回快取本身',
    /return cloneMemoRows_\(SHEET_READ_MEMO_\[sheetName\]\);/.test(src));
  check('★★★★★ 舊寫法（直接 return 快取）已經冇晒',
    !/return SHEET_READ_MEMO_\[sheetName\];/.test(src));
  check('★★★★ 存入快取嗰句仍然喺（唔係順手把快取整個拆咗）',
    /SHEET_READ_MEMO_\[sheetName\] = result;/.test(src));
  // ⚠️ 唔可以就咁 grep「Object.freeze」——檔頭**特登**提到佢
  // （解釋點解揀複本唔揀 freeze）。要分開「註解入面提過」同
  // 「真係有 call」，所以先剝走註解再查。
  const codeOnly = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(function (l) { return l.replace(/\/\/.*$/, ''); }).join('\n');
  check('★★★★ 程式碼**冇真正 call** Object.freeze（只喺註解解釋過點解唔用佢）',
    codeOnly.indexOf('Object.freeze') === -1);
  check('★★★★★ 而且註解要保留住「點解揀複本唔揀 freeze」呢個決定'
    + '——冇咗理由，下一個人好可能改返做 freeze',
    /freeze/i.test(src) && /靜靜失敗/.test(src));
  check('★★★★★ 檔頭有寫明「只可以喺完全冇寫入嘅純讀取流程開」',
    /只可以喺完全冇寫入嘅純讀取流程/.test(src));
}

console.log('\n=== A1：快取開關本身 ===');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'SheetReader.gs'), 'utf8');
  check('★★★★ 預設關閉（SHEET_READ_MEMO_ 初值係 null）',
    /let SHEET_READ_MEMO_ = null;/.test(src));
  check('★★★★★ 唯一開啟點（apiGetDashboardState）一定配 finally 收尾'
    + '——漏咗 finally 會令之後全部讀取都用緊過時快取',
    /beginSheetReadMemo_\(\);[\s\S]*?finally \{[\s\S]*?endSheetReadMemo_\(\);/.test(
      fs.readFileSync(path.join(__dirname, '..', 'src', 'WebAppDashboard.gs'), 'utf8')));
}

console.log('\n=== A1：掃描結論——目前冇任何一處會 mutate readSheet 嘅結果 ===');
{
  // 呢一段把階段 A1 嘅掃描結論鎖死做斷言：日後如果有人真係喺
  // readSheet 結果上面直接 sort／push，呢度就要重新檢視。
  const srcDir = path.join(__dirname, '..', 'src');
  const files = fs.readdirSync(srcDir).filter(function (f) { return f.endsWith('.gs'); });

  const offenders = [];
  files.forEach(function (f) {
    const text = fs.readFileSync(path.join(srcDir, f), 'utf8');
    // 直接喺 readSheet(...) 嘅回傳值上面 sort／push／splice／reverse
    const re = /readSheet\([^)]*\)\s*\.\s*(sort|push|splice|reverse)\s*\(/g;
    let m;
    while ((m = re.exec(text)) !== null) offenders.push(f + '：.' + m[1] + '()');
  });

  checkEqual('★★★★★ 冇任何一處直接 mutate readSheet() 嘅回傳值'
    + '（有嘅話代表階段 A1 嘅掃描結論已經過時，要重新檢視快取安全性）',
    offenders, []);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);

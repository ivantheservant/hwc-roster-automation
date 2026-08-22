#!/usr/bin/env node
// 第四十七輪批次 C5 組：schema drift 掃描器。
//
// ═════════════════════════════════════════════════════════════════════
// 呢一支守嘅係乜
// ═════════════════════════════════════════════════════════════════════
//
// C 組個 bug 嘅形狀係噉：
//
//   ・`COLUMNS.SPECIAL_SUNDAYS` 定義咗 `CONFIRMED`
//   ・全專案有五處程式碼讀寫佢
//   ・**但** `getSpecialSundaysHeaderKeys_()` 冇嗰一項
//   ⇒ 建表路徑由頭到尾造唔出呢一欄
//   ⇒ 讀嗰陣永遠 `undefined`，寫嗰陣靜靜略過
//
// 即係：**同一件事有兩個定義，而冇任何一樣嘢逼佢哋對齊。**
// 呢一支就係嗰樣嘢。
//
// ─────────────────────────────────────────────────────────────────────
// 做法：唔用 regex 猜，**真係行一次**
// ─────────────────────────────────────────────────────────────────────
//
// 用 `tests/helpers/gas_loader.js` 把 `Constants.gs` 同幾支 seed 檔載入
// 一個 vm 沙箱，然後**真係叫** `get<X>HeaderKeys_()`，
// 再同 `COLUMNS.<SHEET>` 逐個鍵比。
//
// 用 regex 抽陣列內容嘅話，遲早會有一個寫法（三元、`concat`、迴圈）
// 令個掃描器靜靜掃唔到——而一個靜靜掃唔到嘅掃描器，
// 就係另一個「綠燈但係壞咗」，同佢要捉嗰個 bug 一模一樣。
//
// ─────────────────────────────────────────────────────────────────────
// ⚠️ 只報告，不修改
// ─────────────────────────────────────────────────────────────────────
//
// 呢一支好可能會搵到 `SpecialSundays` 以外嘅嘢。搵到就逐個列出嚟，
// **唔會順手全部修**——邊一個係真 bug、邊一個係「嗰一欄係人手加嘅、
// 程式碼冇打算建佢」，要 Ivan 拍板。
//
// 所以退出碼分兩級：
//   ・`ACCEPTED_DRIFT` 入面嘅：大聲印出嚟，但**唔會擋 push**
//     （已知、等緊拍板）
//   ・唔喺入面嘅：退出碼 1，擋 push（新出現嘅 drift）
//
// 執行方式：node tools/lint-schema-drift.js

'use strict';

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('../tests/helpers/gas_loader.js');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

// ═════════════════════════════════════════════════════════════════════
// 已知、等緊 Ivan 拍板嘅 drift
// ═════════════════════════════════════════════════════════════════════
//
// 格式：'<SHEET>.<機器鍵>': '點解暫時唔修'
//
// ⚠️ 呢個清單**唔係垃圾桶**。每加一項都要寫得出點解，
// 而每一項都會喺報告最尾再列一次，唔會靜靜消失。
const ACCEPTED_DRIFT = {
  // （目前冇。有新項目要連理由一齊寫。）
};

// ═════════════════════════════════════════════════════════════════════
// 一、搵晒所有 `get<X>HeaderKeys_()`，同埋佢對住邊一個 COLUMNS 區塊
// ═════════════════════════════════════════════════════════════════════

/**
 * 掃 `src/*.gs`，搵出每一個 header 鍵函式同佢對應嘅 `COLUMNS.<SHEET>`。
 *
 * 對應關係由函式本體第一行 `const C = COLUMNS.<SHEET>;` 讀出——
 * 唔靠函式名同 sheet 名嘅字面相似度去猜。
 *
 * @returns {Array<{file: string, fn: string, sheetKey: string, tcConst: string}>}
 */
function findHeaderSources() {
  const out = [];
  fs.readdirSync(SRC).forEach(function (entry) {
    if (!/\.gs$/.test(entry)) return;
    const body = fs.readFileSync(path.join(SRC, entry), 'utf8');
    const re = /function\s+(get[A-Za-z0-9_]*HeaderKeys_)\s*\(\s*\)\s*\{([\s\S]*?)\n\}/g;
    let m;
    while ((m = re.exec(body)) !== null) {
      const fn = m[1];
      const inner = m[2];
      const sheetMatch = inner.match(/COLUMNS\.([A-Z0-9_]+)/);
      if (!sheetMatch) continue;
      out.push({
        file: entry,
        fn: fn,
        sheetKey: sheetMatch[1],
        tcConst: guessTcConst(body, fn)
      });
    }
  });
  return out;
}

/**
 * 搵返同一支檔案入面對應嘅中文標題陣列常數名。
 *
 * 慣例係 `<SHEET>_HEADERS_TC`，而 sheet 名由 JSDoc／註釋講明。
 * 搵唔到就回傳空字串——搵唔到唔係錯，只係「呢一項無法比長度」。
 *
 * @param {string} body 整支 .gs 嘅原始碼
 * @param {string} fn 對應嘅 header 鍵函式名
 * @returns {string} 常數名，搵唔到就 ''
 */
function guessTcConst(body, fn) {
  // `getSpecialSundaysHeaderKeys_` → `SPECIALSUNDAYS`
  const stem = fn.replace(/^get/, '').replace(/HeaderKeys_$/, '').toUpperCase();
  const names = [];
  const re = /const\s+([A-Z0-9_]+_HEADERS_TC)\s*=/g;
  let m;
  while ((m = re.exec(body)) !== null) names.push(m[1]);
  let best = '';
  names.forEach(function (name) {
    const flat = name.replace(/_HEADERS_TC$/, '').replace(/_/g, '');
    if (flat === stem) best = name;
  });
  return best;
}

// ═════════════════════════════════════════════════════════════════════
// 二、真係行一次，逐個鍵比
// ═════════════════════════════════════════════════════════════════════

const sources = findHeaderSources();
const problems = [];
const accepted = [];
const lines = [];

lines.push('');
lines.push('═══ schema drift 掃描 ═══');
lines.push('');

let gas;
try {
  const files = ['Constants.gs', 'Utils.gs'].concat(
    sources.map(function (s) { return s.file; })
      .filter(function (f, i, a) { return a.indexOf(f) === i; })
  );
  gas = loadGasSource(files);
} catch (err) {
  console.error('載入 src 失敗，掃描無法進行：' + err.message);
  process.exit(1);
}

sources.forEach(function (s) {
  const defined = gas.COLUMNS[s.sheetKey];
  if (!defined) {
    problems.push({
      sheet: s.sheetKey,
      key: '（整個區塊）',
      kind: 'NO_COLUMNS',
      detail: s.fn + '() 引用 COLUMNS.' + s.sheetKey + '，而 Constants.gs 冇呢個區塊'
    });
    return;
  }

  let keys;
  try {
    keys = gas[s.fn]();
  } catch (err) {
    problems.push({
      sheet: s.sheetKey, key: '（整個函式）', kind: 'THROWS',
      detail: s.fn + '() 拋錯：' + err.message
    });
    return;
  }

  const definedValues = Object.keys(defined).map(function (k) { return defined[k]; });

  // ── (a) COLUMNS 有、header 冇 ⇒ 建表路徑造唔出呢一欄 ────────────
  //     呢一種就係 `SpecialSundays.Confirmed` 嗰種，最惡：
  //     程式碼讀寫得好地地，而張表根本冇嗰一欄。
  Object.keys(defined).forEach(function (constName) {
    const value = defined[constName];
    if (keys.indexOf(value) !== -1) return;
    const id = s.sheetKey + '.' + value;
    const item = {
      sheet: s.sheetKey, key: value, kind: 'MISSING_IN_HEADER',
      detail: 'COLUMNS.' + s.sheetKey + '.' + constName + ' = "' + value
        + '"，而 ' + s.fn + '() 冇佢 ⇒ 建表路徑造唔出呢一欄'
    };
    if (ACCEPTED_DRIFT[id]) accepted.push(Object.assign({ id: id, why: ACCEPTED_DRIFT[id] }, item));
    else problems.push(item);
  });

  // ── (b) header 有、COLUMNS 冇 ⇒ 一條冇人讀得到嘅欄 ──────────────
  keys.forEach(function (value) {
    if (definedValues.indexOf(value) !== -1) return;
    const id = s.sheetKey + '.' + value;
    const item = {
      sheet: s.sheetKey, key: value, kind: 'MISSING_IN_COLUMNS',
      detail: s.fn + '() 會建 "' + value + '" 呢一欄，而 COLUMNS.'
        + s.sheetKey + ' 冇定義佢 ⇒ 冇任何程式碼讀得到'
    };
    if (ACCEPTED_DRIFT[id]) accepted.push(Object.assign({ id: id, why: ACCEPTED_DRIFT[id] }, item));
    else problems.push(item);
  });

  // ── (c) 中文標題同機器鍵長度唔一樣 ⇒ 建出嚟會整排錯位 ──────────
  if (s.tcConst && Array.isArray(gas[s.tcConst])) {
    if (gas[s.tcConst].length !== keys.length) {
      problems.push({
        sheet: s.sheetKey, key: '（長度）', kind: 'LENGTH_MISMATCH',
        detail: s.tcConst + ' 有 ' + gas[s.tcConst].length + ' 項，而 '
          + s.fn + '() 有 ' + keys.length
          + ' 項 ⇒ 建出嚟第 1 行同第 2 行會錯位'
      });
    }
  }

  lines.push('　' + pad(s.sheetKey, 26) + keys.length + ' 欄　'
    + (s.tcConst ? '（中文標題 ' + gas[s.tcConst].length + ' 項）' : '（冇對應嘅中文標題陣列）')
    + '　← ' + s.file);
});

// ═════════════════════════════════════════════════════════════════════
// 三、講清楚**掃唔到**嘅係邊啲
// ═════════════════════════════════════════════════════════════════════
//
// ⚠️ 呢一節同上面一樣重要。
//
// 大部分工作表根本冇程式建表路徑（張表由人手建，程式只讀），
// 所以靜態上冇嘢可以同 `COLUMNS` 比。
// 唔講明嘅話，一份「全部通過」嘅報告會令人以為全部表都查過——
// 而呢種「以為查過」正正就係 C 組個 bug 活咗噉耐嘅原因。
const covered = sources.map(function (s) { return s.sheetKey; });
const uncovered = Object.keys(gas.COLUMNS).filter(function (k) {
  return covered.indexOf(k) === -1;
});

lines.push('');
lines.push('掃唔到（冇程式建表路徑，靜態上冇嘢可以比）：' + uncovered.length + ' 張');
lines.push('　' + uncovered.join('、'));
lines.push('　⚠️ 呢幾張要對，只能開試算表逐張核。呢一支唔會、亦唔應該假裝查過。');
lines.push('');
// ═══════════════════════════════════════════════════════════════════
// 第五十輪批次 E3 組：**「冇嘢可以比」唔可以靜靜當成「冇問題」。**
// ═══════════════════════════════════════════════════════════════════
//
// 現場：`SendLog` 缺 `IntendedEmail` 同 `DeliveredTo` 兩欄，
// 而呢一支 lint **由頭到尾冇報過**。
//
// 原因：佢比對嘅係「`COLUMNS.<SHEET>` 嘅鍵」對「程式碼入面嘅
// `*_HEADERS_TC` 陣列」。而 `SendLog` 喺程式碼入面根本冇 header 陣列
// ——所以佢冇嘢可以比，就當成冇問題。
//
// ⚠️ **即係嗰一句「掃唔到 19 張」本身，就係一份風險清單。**
// 之前佢印喺報告最尾、語氣中性，讀落似一句免責聲明。
// 而實際上嗰 19 張入面至少有一張（`SendLog`）真係缺欄，
// 而且缺咗嗰兩欄係第四十一輪特登為咗一件事而加嘅。
//
// 所以呢一節改成 WARN 語氣，並且講明點樣先驗得到。
lines.push('⚠️ ⚠️ 上面嗰 ' + uncovered.length + ' 張，**唔係「查過冇事」，係「查唔到」。**');
lines.push('　 呢一支只驗得到「碼對碼」（`COLUMNS` 對 `*_HEADERS_TC`）。');
lines.push('　 一張表喺程式碼入面冇 header 陣列，佢就冇嘢可以比。');
lines.push('　 實測：`SendLog` 缺 `IntendedEmail`／`DeliveredTo` 兩欄，');
lines.push('　 而呢一支由頭到尾冇報過——最後係執行期不變量 I01 捉到。');
lines.push('　 要驗「碼對真實試算表」，只有 I01（`src/Invariants.gs`）做得到，');
lines.push('　 而佢要喺 Apps Script 度跑：「維護 ▸ 🩺 全面體檢」或者「⚠️ 跑自測」。');

console.log(lines.join('\n'));

// ═════════════════════════════════════════════════════════════════════
// 三之二、冇任何程式碼引用過嘅 `COLUMNS` 鍵
// ═════════════════════════════════════════════════════════════════════
//
// 呢一種同 C 組個 bug 係同一個病嘅另一面：
// `COLUMNS` 定義咗一個鍵，而全專案冇一行碼引用過佢。
//
// 佢本身唔會整壞任何嘢——所以**唔擋 push**。
// 但佢係「兩份定義開始分家」嘅第一個徵狀：
// 一個冇人引用嘅鍵，冇任何嘢會提你佢同張表對唔對得上。
// `SpecialSundays.Confirmed` 就係由「有人引用、而建表冇造」演變出嚟嘅。
//
// ⚠️ 只列出嚟，唔會刪。邊一個係「日後要用」、邊一個係真死碼，要 Ivan 拍板。
const allSrc = fs.readdirSync(SRC)
  .filter(function (entry) { return /\.gs$/.test(entry); })
  .map(function (entry) { return fs.readFileSync(path.join(SRC, entry), 'utf8'); })
  .join('\n');

// ⚠️ 用**純字串比對**，唔用 `new RegExp(…)`。
//
// 由字串砌 regex 嘅話，`'\b'` 喺字串字面量入面係退格字元（U+0008），
// 唔係字界。第一版就係噉：267 個鍵全部「冇人引用」——
// 即係個檢查根本一個都對唔到，而佢照樣印得好肯定。
// 一個永遠報全中嘅檢查，同一個永遠報全綠嘅檢查一樣冇用。
const unreferenced = [];
Object.keys(gas.COLUMNS).forEach(function (sheetKey) {
  const block = gas.COLUMNS[sheetKey];
  Object.keys(block).forEach(function (constName) {
    // 完整寫法：`COLUMNS.<SHEET>.<KEY>`
    if (allSrc.indexOf('COLUMNS.' + sheetKey + '.' + constName) !== -1) return;
    // 簡寫：`const C = COLUMNS.<SHEET>;` 之後嘅 `C.<KEY>`（別名唔一定係 C）。
    //
    // 故意寬鬆：`.<KEY>` 一命中就當引用過。
    // 寧願漏報，都唔好誤報——一個成日噏錯嘅清單，
    // 過兩個月就冇人再讀，噉就等於冇寫過。
    if (allSrc.indexOf('.' + constName) !== -1) return;
    unreferenced.push(sheetKey + '.' + constName + ' = "' + block[constName] + '"');
  });
});

if (unreferenced.length > 0) {
  console.log('');
  console.log('── 冇任何程式碼引用過嘅 COLUMNS 鍵：'
    + unreferenced.length + ' 個（唔擋 push，只係報告）──');
  unreferenced.forEach(function (u) { console.log('　・' + u); });
}



// ═════════════════════════════════════════════════════════════════════
// 四、報告
// ═════════════════════════════════════════════════════════════════════

if (accepted.length > 0) {
  console.log('');
  console.log('── 已知、等緊拍板（唔擋 push）──');
  accepted.forEach(function (a) {
    console.log('　・' + a.detail);
    console.log('　　理由：' + a.why);
  });
}

console.log('');
if (problems.length === 0) {
  console.log('冇發現 schema drift。');
  process.exit(0);
}

console.log('發現 ' + problems.length + ' 項 schema drift：');
console.log('');
problems.forEach(function (p, i) {
  console.log('　' + (i + 1) + '. [' + p.kind + '] ' + p.sheet + '　' + p.key);
  console.log('　　 ' + p.detail);
});
console.log('');
console.log('⚠️ 呢一支只報告，唔會改任何嘢。');
console.log('　 邊一項要修、邊一項係「嗰一欄本來就係人手加」，由 Ivan 拍板；');
console.log('　 拍板咗暫時唔修嘅，加入 ACCEPTED_DRIFT 並寫明理由。');
process.exit(1);

/**
 * 右邊補空格到指定闊度（報告對齊用）。
 * @param {string} text 原字串
 * @param {number} width 目標闊度
 * @returns {string} 補完嘅字串
 */
function pad(text, width) {
  let out = String(text);
  while (out.length < width) out += ' ';
  return out;
}

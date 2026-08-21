// 第四十四輪批次 H2 組：崗位名單工作表——**亂改都唔會整壞 PersonID**。
// 執行方式：node tests/eligibility_sheet_safety.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 點解要有呢一份
// ═════════════════════════════════════════════════════════════════════
//
// Ivan 問過兩次（原話）：
//
//   > would it be a problem if i remove, leave some cell empty in between,
//   > reverses orders (but all names are the same), etc? would this affect
//   > the person id? all system will check to confirm all matches and new
//   > added will create new id, skip blank cell will know to find another
//   > until the end of the column, etc?
//
// 佢問嘅係一件好實在嘅嘢：**佢喺嗰張表上面亂改，會唔會整爛底層嘅
// `PersonID`？** 因為 `PersonID` 係 `Eligibility`／`Unavailable`／
// `RosterAssignments`／`SendLog` 全部表嘅骨——一旦一個人多咗第二個 ID，
// 佢過去嘅紀錄同將來嘅安排就會分開兩邊，而且**冇任何畫面會顯示得出**。
//
// 答案（查過 `planEligibilitySheetApply_()`）係安全嘅，四個行為：
//
//   一、空格逐個跳過，**唔會提早收工**——中間留白唔會令下面嗰批人消失
//   二、完全唔理次序——內部用嘅係一個 set，唔係一個 list
//   三、按名字解析，**沿用原本嘅 `PersonID`**——唔會因為打過一次就多個 ID
//   四、認唔出嘅名**唔會自動開新人**，而係整批擋住
//
// 呢一份就係把呢四樣釘死。改壞任何一樣，下面就會紅。
//
// ⚠️ 呢度行嘅係**真正嗰個 `planEligibilitySheetApply_()`**，
// 唔係抄一份出嚟。抄一份出嚟測只會證明副本冇事。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

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
const src = fs.readFileSync(path.join(ROOT, 'src', 'EligibilitySheetEditor.gs'), 'utf8');

const gas = loadGasSource([
  'Constants.gs', 'MutationLock.gs', 'Utils.gs', 'WebAppGuards.gs',
  'EligibilitySheetEditor.gs'
]);

/**
 * 現況：兩個崗位、四個人，全部已經喺 `Eligibility` 入面。
 * 人名一律用測試名（`scan_sensitive.test.js` 會掃真人姓名）。
 */
const PEOPLE = [
  { personId: 'P9001', nameTC: '測試甲' },
  { personId: 'P9002', nameTC: '測試乙' },
  { personId: 'P9003', nameTC: '測試丙' },
  { personId: 'P9004', nameTC: '測試丁' }
];
const BEFORE = {
  SOUND: ['P9001', 'P9002', 'P9003'],
  USHER: ['P9002', 'P9004']
};

/**
 * 砌一次替身，然後行**真正嗰個** `planEligibilitySheetApply_()`。
 *
 * @param {Array[]} grid 「崗位名單」工作表第 3 行開始嘅內容（逐行、逐欄）
 * @returns {{plan: Object, createdIds: string[]}} 計劃，同埋佢有冇偷偷開過新 ID
 */
function runPlan(grid, postsOverride) {
  const createdIds = [];
  const headerRow = ['SOUND', 'USHER'];
  const lastCol = headerRow.length;
  const lastRow = 2 + grid.length;

  gas.SpreadsheetApp = {
    getActiveSpreadsheet: function () {
      return {
        getSheetByName: function (name) {
          if (name !== '崗位名單') return null;
          return {
            getLastRow: function () { return lastRow; },
            getLastColumn: function () { return lastCol; },
            getRange: function (row, col, numRows) {
              return {
                getValues: function () {
                  if (row === 2) return [headerRow];
                  return grid.slice(row - 3, row - 3 + numRows);
                }
              };
            }
          };
        }
      };
    }
  };
  gas.readPostsNormalized = function () {
    return postsOverride
      || [{ postId: 'SOUND', postNameTC: '音響' }, { postId: 'USHER', postNameTC: '司事' }];
  };
  gas.readEligibility = function () { return { byPost: JSON.parse(JSON.stringify(BEFORE)) }; };
  gas.readPeople = function () {
    return PEOPLE.map(function (p) {
      const row = {};
      row[gas.COLUMNS.NAME_MAPPING.PERSON_ID] = p.personId;
      row[gas.COLUMNS.NAME_MAPPING.NAME_TC] = p.nameTC;
      return row;
    });
  };
  // ⚠️ `resolvePersonId()` 係「名 → 既有 ID」嘅唯一入口。
  // 呢度**唔會**幫佢開新 ID——如果正式碼喺搵唔到嗰陣走去開一個，
  // 下面 `createdIds` 就會有嘢，而嗰個正正就係 Ivan 驚嗰件事。
  gas.resolvePersonId = function (name) {
    const hit = PEOPLE.filter(function (p) { return p.nameTC === String(name).trim(); })[0];
    return hit ? hit.personId : null;
  };
  gas.buildNextPersonId_ = function () {
    createdIds.push('（有人叫過開新 ID）');
    return 'P9999';
  };
  gas.findLatestVersionNo = function () { return -1; };
  gas.getConfig = function (_k, d) { return d; };
  gas.readSheet = function () { return []; };

  return { plan: gas.planEligibilitySheetApply_('2027T3'), createdIds: createdIds };
}

/** 由 plan 抽返「呢個崗位而家想要邊幾個人」。 */
function resultingSet(plan, postId) {
  const set = {};
  (BEFORE[postId] || []).forEach(function (id) { set[id] = true; });
  plan.added.forEach(function (a) { if (a.postId === postId) set[a.personId] = true; });
  plan.removed.forEach(function (r) { if (r.postId === postId) delete set[r.personId]; });
  return Object.keys(set).sort();
}

// =====================================================================
console.log('\n=== H2【核心】一次過亂改：中間空格 ＋ 次序打亂 ＋ 移走一個 ===');
{
  // 重現步驟：
  //   1. 第 3 步撳〔開啟名單工作表〕
  //   2. 喺「音響」嗰欄：把三個名嘅次序倒轉，中間留兩行空白，
  //      再把「測試丙」整行清空（＝移走佢）
  //   3. 喺「司事」嗰欄：兩個名調轉，中間留一行空白
  //   4. 回去撳〔儲存並套用名單〕
  const grid = [
    ['測試乙', '測試丁'],
    ['', ''],            // 中間空一行
    ['測試甲', ''],       // 司事嗰欄再空一格
    ['', '測試乙'],       // 空格之後**仲有嘢**——呢一行係整份測試嘅關鍵
    ['', '']
  ];
  const r = runPlan(grid);

  check('★★★★★ 冇被擋住（全部名都認得出）',
    r.plan.blocked === false && r.plan.unresolved.length === 0,
    JSON.stringify(r.plan.unresolved));

  // ── 一、空格唔會令讀取提早結束 ──────────────────────────
  checkEqual('★★★★★ **空格之後嗰個人照樣讀得到**'
    + '——如果撞到空格就 break，「司事」會淨返「測試丁」一個，'
    + '而「測試乙」會被靜靜移走',
    resultingSet(r.plan, 'USHER'), ['P9002', 'P9004']);
  check('★★★★★ 而且司事一個都冇被移走',
    r.plan.removed.filter(function (x) { return x.postId === 'USHER'; }).length === 0,
    JSON.stringify(r.plan.removed));

  // ── 二、次序完全唔緊要 ──────────────────────────────
  checkEqual('★★★★★ **次序倒轉唔會產生任何改動**'
    + '——內部用嘅係一個 set，唔係一個 list；'
    + '當成 list 嘅話，幹事淨係調轉兩行都會變成「移走兩個、加返兩個」',
    r.plan.added.filter(function (x) { return x.postId === 'USHER'; }).length, 0);

  // ── 三、移走一個 ⇒ 只影響嗰一個 ─────────────────────
  checkEqual('★★★★★ 音響淨係移走「測試丙」，另外兩個原封不動',
    resultingSet(r.plan, 'SOUND'), ['P9001', 'P9002']);
  checkEqual('★★★★★ 而且 `removed` 就係佢一個',
    r.plan.removed.map(function (x) { return x.personId + '|' + x.postId; }),
    ['P9003|SOUND']);
  checkEqual('★★★★★ **一個都冇加**（次序同空格都唔係「新人」）',
    r.plan.added.length, 0);

  // ── 四、PersonID 全部沿用 ───────────────────────────
  const allIds = r.plan.added.concat(r.plan.removed).map(function (x) { return x.personId; });
  check('★★★★★ **出現過嘅 `PersonID` 全部係原本嗰批**'
    + '——多咗一個 ID，佢過去嘅紀錄同將來嘅安排就會分開兩邊，'
    + '而冇任何一個畫面顯示得出',
    allIds.every(function (id) {
      return ['P9001', 'P9002', 'P9003', 'P9004'].indexOf(id) !== -1;
    }), JSON.stringify(allIds));
  checkEqual('★★★★★ 而且**一個新 ID 都冇開過**', r.createdIds, []);
}

// =====================================================================
console.log('\n=== H2【核心】加一個認唔出嘅名 ⇒ **整批擋住**，唔會自動開新人 ===');
{
  // 重現步驟：
  //   1. 〔開啟名單工作表〕
  //   2. 喺「音響」嗰欄最後打一個未加入過嘅名（例如「測試戊」）
  //   3. 回去撳〔儲存並套用名單〕
  const grid = [
    ['測試甲', '測試乙'],
    ['測試乙', '測試丁'],
    ['測試丙', ''],
    ['測試戊', '']        // ⚠️ 呢個名唔喺 NameMapping 入面
  ];
  const r = runPlan(grid);

  check('★★★★★ **`blocked === true`**'
    + '——唔擋嘅話，佢會被靜靜略過，而幹事以為佢加咗；'
    + '下一次生成先發現嗰個人一格都冇',
    r.plan.blocked === true, JSON.stringify(r.plan));
  checkEqual('★★★★★ 認唔出嗰個逐個列出（唔係淨係講「有 1 個」）',
    r.plan.unresolved.map(function (u) { return u.kind + '|' + u.text; }),
    ['UNKNOWN_NAME|測試戊']);
  check('★★★★★ 而且講得出係邊個崗位、第幾行'
    + '——冇呢兩樣，幹事要喺幾十行入面自己逐行搵',
    r.plan.unresolved[0].note.indexOf('音響') !== -1
    && r.plan.unresolved[0].note.indexOf('第 6 行') !== -1,
    r.plan.unresolved[0].note);
  checkEqual('★★★★★ **完全冇開過新 `PersonID`**'
    + '——自動開新人就係 Ivan 問嗰句「new added will create new id」'
    + '嘅危險版本：打錯一個字就會多咗一個人',
    r.createdIds, []);
  check('★★★★ 崗位代號帶埋中文名出去（畫面上要問「同時讓他可以做○○」）',
    r.plan.unresolved[0].postNameTC === '音響', JSON.stringify(r.plan.unresolved[0]));
}

// =====================================================================
console.log('\n=== H2 擋住 ⇒ 一格都唔准寫入（唔係「寫得幾多得幾多」）===');
{
  const bare = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const body = bare.slice(bare.indexOf('function apiApplyEligibilitySheet_locked_('));
  check('★★★★★ `apiApplyEligibilitySheet_locked_()` 第一件事就係睇 `blocked`',
    /const plan = planEligibilitySheetApply_\(quarterId\);\s*\n\s*if \(plan\.blocked\) \{\s*\n\s*throw new Error\(/
      .test(body), body.slice(0, 400));
  check('★★★★★ 而且明講「一個都沒有寫入」'
    + '——一句「有錯」會令幹事以為部分寫咗，然後唔敢再撳',
    /名單沒有任何改動——一個都沒有寫入。/.test(src), '');
  check('★★★★★ **會重新算一次預覽，唔信前端**'
    + '——幹事開住預覽嗰陣有可能又去改咗張表',
    body.indexOf('planEligibilitySheetApply_(quarterId)') !== -1, '');
}

// =====================================================================
console.log('\n=== H2 空格嘅處理係 `continue` 唔係 `break`（把成因釘住）===');
{
  const bare = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const loop = bare.slice(bare.indexOf('values.forEach(function (rowValues, r) {'),
    bare.indexOf('values.forEach(function (rowValues, r) {') + 900);
  check('★★★★★ 空格係 `return`（＝ 跳過呢一格，繼續行落去）'
    + '——`forEach` 入面冇 `break` 呢個選項，'
    + '而呢個正正就係「空格唔會令讀取提早結束」嘅結構性保證',
    /const text = String\(rowValues\[c\] \|\| ''\)\.trim\(\);\s*\n\s*if \(!text\) return;/
      .test(loop), loop.slice(0, 300));
  check('★★★★★ 讀嘅範圍去到 `getLastRow()`，唔係「第一個空格為止」',
    /lastRow - ELIGIBILITY_SHEET_FIRST_DATA_ROW \+ 1/.test(bare), '');
  check('★★★★★ 內部用 `wanted[postId][personId] = true`（set），唔係 push 落 array'
    + '——用 array 嘅話，次序就會變成資料嘅一部分',
    /wanted\[postId\]\[personId\] = true;/.test(bare), '');
}

// =====================================================================
console.log('\n=== H2 崗位代號對唔上都要擋（整欄剪貼錯位嗰種）===');
{
  const grid = [['測試甲', '測試乙']];
  const r0 = runPlan(grid);
  check('★★★★ （先確認正常情況唔會擋）', r0.plan.blocked === false);

  // 重現步驟：幹事整欄剪貼，令第 2 欄嘅崗位代號變成一個 `Posts` 冇嘅值。
  const r = runPlan(grid, [{ postId: 'SOUND', postNameTC: '音響' }]);
  check('★★★★★ 崗位代號對唔上 ⇒ **擋住**，唔係當嗰一欄唔存在'
    + '——當唔存在就會令「司事」成個崗位嘅名單被清空，而畫面上睇唔出',
    r.plan.blocked === true
    && r.plan.unresolved.some(function (u) { return u.kind === 'UNKNOWN_POST'; }),
    JSON.stringify(r.plan.unresolved));
  check('★★★★ 而且講得出係第幾欄同埋嗰個代號',
    r.plan.unresolved.some(function (u) {
      return u.note.indexOf('第 2 欄') !== -1 && u.note.indexOf('USHER') !== -1;
    }), JSON.stringify(r.plan.unresolved));
  check('★★★★ （這一段沒有開過新 ID）', r.createdIds.length === 0);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);

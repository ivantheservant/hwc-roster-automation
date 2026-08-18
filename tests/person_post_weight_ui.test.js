// 第二十六輪批次階段 C4：區三畫面六——排表偏好（介面 ＋ 寫入）。
// 執行方式：node tests/person_post_weight_ui.test.js
//
// ⚠️ 最重要嗰條：**揀返「一般」＝填 EffectiveTo，唔刪行。**
// 同 PersonPostExclusions 一致——要睇得返「嗰陣時堂委係點決定嘅」。
// 刪咗行嘅話，下次開會問「舊年我哋 decide 咗幾多」就答唔到。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'QuarterStage.gs',
  'WebAppGuards.gs', 'WebAppRoster3Common.gs', 'PersonPostWeight.gs', 'WebAppWeightEdit.gs'
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

const W = gas.COLUMNS.PERSON_POST_WEIGHT;
gas.assertWebAppRequestAllowed_ = function () {};
gas.beginSheetReadMemo_ = function () {};
gas.endSheetReadMemo_ = function () {};
gas.getConfig = function (key, fallback) { return fallback; };
gas.Utilities = { formatDate: function () { return '2026-08-18'; } };
gas.nowTimestamp_ = function () { return '2026-08-18 10:00'; };
gas.compactTimestamp_ = function () { return '20260818100000'; };
const FAKE_ACTOR = 'tester' + '@' + ['exam', 'ple', '.', 'invalid'].join('');
gas.Session = { getActiveUser: function () { return { getEmail: function () { return FAKE_ACTOR; } }; } };
gas.buildPersonNameIndex_ = function () { return { P9001: '測試甲' }; };
gas.readPosts = function () {
  const P = gas.COLUMNS.POSTS;
  const r = {};
  r[P.POST_ID] = 'CHAIR'; r[P.POST_NAME_TC] = '主席'; r[P.AUTO_GENERATE] = 'TRUE';
  return [r];
};

function weightRow(o) {
  const r = {};
  r[W.WEIGHT_ID] = o.id || 'W1';
  r[W.PERSON_ID] = o.personId || 'P9001';
  r[W.POST_ID] = o.postId || 'CHAIR';
  r[W.ADJUST] = o.adjust;
  r[W.REASON] = o.reason || '堂委決議';
  r[W.ACTIVE] = 'TRUE';
  r[W.EFFECTIVE_FROM] = o.from || '';
  r[W.EFFECTIVE_TO] = o.to || '';
  return r;
}

console.log('\n=== C4【核心】揀返「一般」＝填 EffectiveTo，唔刪行 ===');
{
  const writes = [];
  const appends = [];
  gas.readOptionalSheet_ = function () { return [weightRow({ adjust: 2 })]; };
  gas.openSheetForEdit_ = function () { return { sheet: {}, headers: [] }; };
  gas.writeRowFields_ = function (sheet, headers, sheetRow, updates) {
    writes.push({ sheetRow: sheetRow, updates: updates }); return [];
  };
  gas.appendRowFields_ = function (sheet, headers, record) { appends.push(record); return 9; };
  gas.writeZone3Audit_ = function () {};

  const res = gas.apiSavePersonPostWeightBatch([
    { personId: 'P9001', postId: 'CHAIR', adjust: 0, reason: '改回一般' }
  ]);
  checkEqual('★★★★ 算做「解除 1 項」', { added: res.added, released: res.released },
    { added: 0, released: 1 });
  checkEqual('★★★★★ 寫嘅係 EffectiveTo（今日），**唔係刪行、唔係 Active=FALSE**',
    writes[0].updates[W.EFFECTIVE_TO], '2026-08-18');
  check('★★★★★ 而且冇動 Active（Active=FALSE 係另一個意思）',
    !Object.prototype.hasOwnProperty.call(writes[0].updates, W.ACTIVE));
  checkEqual('★★★★★ 揀「一般」**唔會**再加一行新嘅', appends.length, 0);

  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'WebAppWeightEdit.gs'), 'utf8');
  check('★★★★★ 整個檔案冇任何刪行呼叫', !/deleteRow|deleteRows|removeRow/.test(src));
}

console.log('\n=== C4【核心】改動＝解除舊行 ＋ 加新行（唔就地改個數字）===');
{
  const writes = [];
  const appends = [];
  gas.readOptionalSheet_ = function () { return [weightRow({ adjust: 2 })]; };
  gas.writeRowFields_ = function (sheet, headers, sheetRow, updates) {
    writes.push(updates); return [];
  };
  gas.appendRowFields_ = function (sheet, headers, record) { appends.push(record); return 9; };

  const res = gas.apiSavePersonPostWeightBatch([
    { personId: 'P9001', postId: 'CHAIR', adjust: 1, reason: '堂委 2026-08 覆議' }
  ]);
  checkEqual('★★★★ 同時算「解除 1、新增 1」',
    { added: res.added, released: res.released }, { added: 1, released: 1 });
  checkEqual('★★★★★ 舊行填 EffectiveTo', writes[0][W.EFFECTIVE_TO], '2026-08-18');
  checkEqual('★★★★★ 新行係一行**全新**紀錄，唔係就地改'
    + '——就地改嘅話，「上一次係幾多、幾時改、點解改」就冇咗',
    appends[0][W.ADJUST], 1);
  checkEqual('★★★★ 新行有記低原因', appends[0][W.REASON], '堂委 2026-08 覆議');
  checkEqual('★★★★★ CreatedAt 已經格式化（唔係未格式化嘅 Date 物件）'
    + '——第二十二輪喺 QuarterReset.gs 撞過同一件事',
    appends[0][W.CREATED_AT], '2026-08-18 10:00');
  check('★★★★ 唔係 Date 物件', !(appends[0][W.CREATED_AT] instanceof Date));
}

console.log('\n=== C4 冇改到嘅唔算改動 ===');
{
  gas.readOptionalSheet_ = function () { return [weightRow({ adjust: 2 })]; };
  gas.writeRowFields_ = function () { return []; };
  gas.appendRowFields_ = function () { return 9; };
  const res = gas.apiSavePersonPostWeightBatch([
    { personId: 'P9001', postId: 'CHAIR', adjust: 2, reason: '一樣' }
  ]);
  checkEqual('★★★★★ 同原本一樣 ⇒ skipped，唔會白白加多一行',
    { added: res.added, released: res.released, skipped: res.skipped },
    { added: 0, released: 0, skipped: 1 });
}

console.log('\n=== C4【核心】每一項都要填原因 ===');
{
  gas.readOptionalSheet_ = function () { return []; };
  const res = gas.apiSavePersonPostWeightBatch([
    { personId: 'P9001', postId: 'CHAIR', adjust: 1, reason: '' }
  ]);
  check('★★★★★ 冇填原因 ⇒ 整批都唔寫'
    + '——三個月之後，冇原因嘅偏好冇人記得點解要噉改',
    res.ok === false && /沒有填原因/.test(res.message));
  check('★★★★ 而且講明「什麼都沒有儲存」（唔係寫咗一半）',
    /什麼都沒有儲存/.test(res.message));
}

console.log('\n=== C4 超出範圍要擋 ===');
{
  gas.readOptionalSheet_ = function () { return []; };
  const res = gas.apiSavePersonPostWeightBatch([
    { personId: 'P9001', postId: 'CHAIR', adjust: 9, reason: '測試' }
  ]);
  check('★★★★★ 超出 ±3 ⇒ 整批都唔寫，唔會靜靜夾到範圍內',
    res.ok === false && /超出範圍/.test(res.message));
}

console.log('\n=== C4 矩陣：只列有資格嘅人 ===');
{
  const E = gas.COLUMNS.ELIGIBILITY;
  const M = gas.COLUMNS.NAME_MAPPING;
  gas.readOptionalSheet_ = function () { return [weightRow({ adjust: 1 })]; };
  gas.readSheet = function (name) {
    if (name === gas.SHEETS.NAME_MAPPING) {
      const a = {}; a[M.PERSON_ID] = 'P9001'; a[M.NAME_TC] = '測試甲';
      const b = {}; b[M.PERSON_ID] = 'P9002'; b[M.NAME_TC] = '測試乙';
      return [a, b];
    }
    if (name === gas.SHEETS.ELIGIBILITY) {
      const e = {};
      e[E.PERSON_ID] = 'P9001'; e[E.POST_ID] = 'CHAIR';
      e[E.ELIGIBLE] = 'TRUE'; e[E.ACTIVE] = 'TRUE';
      return [e];
    }
    return [];
  };

  const m = gas.apiGetPersonPostWeightMatrix();
  checkEqual('★★★★★ 只列有該崗位資格嘅人（P9002 冇資格，唔會出現）'
    + '——90 × 16 個空下拉係一幅噪音，幹事會搵唔到想改嗰個',
    m.posts[0].people.map(function (p) { return p.personId; }), ['P9001']);
  checkEqual('★★★★ 而且帶埋現時嘅偏好值', m.posts[0].people[0].adjust, 1);
  checkEqual('★★★★★ 下拉選項用人話，唔俾幹事打數字'
    + '——打錯一個負號就完全相反，而「多一次」同「少一次」睇落只差一個字',
    m.choices.map(function (c) { return c.label; }),
    ['多兩次', '多一次', '一般（預設）', '少一次', '少兩次']);
}

console.log('\n=== C4 畫面文案 ===');
{
  const zone3 = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'ui', 'ScriptZone3.html'), 'utf8');
  // ⚠️ 前端嗰句喺原始碼度係用 `+` 駁埋嘅，所以唔可以整句比對。
  // 分兩截查——兩截都在，就代表嗰句完整存在。
  check('★★★★★ 有規格 4.6 指定嗰句（分清楚「做幾多次」同「有冇資格」）'
    + '——冇咗嘅話，幹事會以為「少一次」＝「唔俾佢做」，'
    + '然後去取消佢嘅資格，而嗰個係完全唔同、而且好難復原嘅一件事',
    zone3.indexOf('這裡只影響「誰做多少次」。不會影響誰有資格做，') !== -1
    && zone3.indexOf('也不會令系統違反任何規則。') !== -1);
  check('★★★★★ 確認畫面有「會新增 N 項偏好、解除 N 項偏好」',
    /會新增 ' \+ summary\.added \+ ' 項偏好、解除 ' \+ summary\.released \+ ' 項偏好/.test(zone3));
  check('★★★★★ 而且講明解除唔會刪行',
    zone3.indexOf('解除不會刪走那一行') !== -1);
  check('★★★★ 有講明「多一次」係「大約一次」，唔係「一定」',
    zone3.indexOf('不是「一定多一次」') !== -1);
  check('★★★★ 前端亦會擋住冇填原因',
    /每一項偏好都要填原因才可以儲存/.test(zone3));
}

console.log('\n=== C5：CHAIR × COMMUNION 互斥組種子（唯讀報告，唔寫入）===');
{
  const seed = fs.readFileSync(path.join(__dirname, '..', 'src', 'PostSeed.gs'), 'utf8');
  check('★★★★ 有互斥組常數', /POST_MUTEX_GROUP_CHAIR_COMMUNION = 'CHAIR_COMMUNION'/.test(seed));
  check('★★★★★ 主席同聖餐襄禮用**同一個**值（唔同值就唔會互斥）',
    /overrides\['主席'\] = POST_MUTEX_GROUP_CHAIR_COMMUNION/.test(seed)
    && /overrides\['聖餐襄禮'\] = POST_MUTEX_GROUP_CHAIR_COMMUNION/.test(seed));

  const planStart = seed.indexOf('function planPostMutexGroupSeed_');
  const planBody = seed.slice(planStart);
  check('★★★★★ 計畫函式**一格都唔會寫**（本輪只做唯讀報告）'
    + '——一條硬規則應該由人明確開啟，唔應該喺一次「補建欄位」'
    + '嘅維護動作入面順手生效',
    !/setValue\(|setValues\(/.test(planBody));
  check('★★★★ 而且會列出「而家係咩、建議係咩」俾人自己改',
    /currentValue: current/.test(planBody) && /suggestedValue: overrides\[name\]/.test(planBody));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);

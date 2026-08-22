// 第五十四輪批次 A／C 組：寫三格、問一次、換走犯規嗰幾格。
// 執行方式：node tests/selftest_batch_pick.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 三輪紅咗三次，每次原因唔同
// ═════════════════════════════════════════════════════════════════════
//
//   第五十一輪　修「名字要系統認得出」　　　⇒ 下一次撞喺 Eligibility
//   第五十三輪　修「要喺 Eligibility 合資格」⇒ 下一次撞喺 Roles 身分限制
//   （如果再猜）修「要有堂委身分」　　　　　⇒ 下一條規則
//
// **每一次嘅診斷都啱，但策略錯**：測試喺度自己重新實作系統嘅接受條件，
// 一條一條規則逐次發現。系統有幾多道閘，就會有幾多輪失敗。
//
// 呢一輪換策略：**唔再實作任何規則。寫入之後問系統。**
//
// `apiSaveAndConfirmPlan()` 係唯讀嘅（只回計劃，唔造版本、唔改 Stage），
// 佢回傳嘅 `needsRelease` 同 `violations.real` 就係
// 「儲存會唔會被攔」嘅**權威答案**——正正係攔住 S05 嗰道閘自己用嘅判斷。
//
// ═════════════════════════════════════════════════════════════════════
// ⚠️ 呢一份係**推送之前自己驗收**，唔交畀 Ivan 撞
// ═════════════════════════════════════════════════════════════════════
//
// 三條 fixture：
//   一、第一批有一格犯規　⇒ 要換格重試
//   二、五次都犯規　　　　⇒ 要用乾淨嗰幾格收口，唔可以死循環
//   三、plan 拋錯　　　　 ⇒ S03 要報 ERROR 帶住原文，唔可以靜靜過
//
// ⚠️ fixture 嘅 plan 回傳照 `buildSaveAndConfirmPlan_()` 真正嗰個
// return 砌，而且下面有一條斷言守住「欄位對得上」——
// 憑想像寫欄位名嘅話，呢一份會綠而實機會紅。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 900));
}
function checkEqual(label, actual, expected) {
  check(label, String(actual) === String(expected),
    '實際 = ' + JSON.stringify(actual) + '　期望 = ' + JSON.stringify(expected));
}

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const DATES = ['2028-07-02', '2028-07-09', '2028-07-16', '2028-07-23', '2028-07-30'];

/**
 * 照 `buildSaveAndConfirmPlan_()` 真正嗰個 return 砌一份 plan。
 *
 * @param {Object} opts `{real, gridChanges}`
 * @returns {Object}
 */
function makePlan(opts) {
  const real = (opts && opts.real) || [];
  return {
    blocked: false,
    blockReason: null,
    unresolved: [],
    requests: { apply: [], confirm: [], needsInput: [] },
    gridChanges: (opts && opts.gridChanges) || [],
    overlaps: [],
    blankCells: [],
    violations: { real: real, released: [], structural: [], semiHard: [] },
    needsRelease: real.length > 0,
    proposals: [],
    targetVersionNo: 1,
    stage: 'DRAFT',
    baseVersionNo: 0,
    skippedIncompleteCount: 0,
    zeroChange: false,
    zeroChangeAction: null
  };
}

/** 照 `findStateViolations_()` 真正嗰個 `add()` 砌一條違反。 */
function makeViolation(serviceDate, postId, slotIndex, ruleId) {
  return {
    serviceDateId: 'D-' + serviceDate,
    serviceDate: serviceDate,
    postId: postId,
    slotIndex: slotIndex,
    personId: 'P999',
    isManual: true,
    ruleId: ruleId || 'HARD_ROLE_REQUIRED',
    severity: 'HARD',
    reason: '獲派的人當日不持有所需身分'
  };
}

/** 照 `gridChanges` 真正嗰個 map 砌一格。 */
function makeGridChange(serviceDate, postId, slotIndex, originalName, manualName) {
  return {
    serviceDate: serviceDate, postId: postId, postNameTC: postId,
    slotIndex: slotIndex, originalName: originalName, manualName: manualName
  };
}

/**
 * 造一個沙箱，把所有工作表 I/O 換走，但**留住真嘅揀格同 S03**。
 *
 * @param {Object} opts `{posts, plans, people, byPost}`
 * @returns {Object}
 */
function sandbox(opts) {
  const gas = loadGasSource([
    'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs', 'QuarterStage.gs',
    'SelfTestRunner.gs'
  ]);
  const written = [];
  const planCalls = [];
  let planIdx = 0;

  gas.log_ = function () {};
  gas.selfTestRecordPayload_ = function () {};
  gas.getConfig = function () { return 'Asia/Hong_Kong'; };
  gas.toDateString = function (v) { return String(v); };
  gas.findLatestVersionNo = function () { return 0; };

  const people = opts.people || { P1: '假甲乙', P2: '假丙丁', P3: '假戊己', P4: '假庚辛' };
  gas.indexPeopleById_ = function () {
    const m = {};
    Object.keys(people).forEach(function (id) {
      m[id] = { personId: id, nameTC: people[id], email: '', maxPerQuarter: null };
    });
    return m;
  };
  gas.readEligibility = function () {
    return { byPost: opts.byPost || {}, byPerson: {}, historicalCount: {},
      explicitlyExcluded: {} };
  };

  const A = gas.COLUMNS.ROSTER_ASSIGNMENTS;
  gas.readSheet = function (name) {
    if (name !== gas.SHEETS.ROSTER_ASSIGNMENTS) return [];
    return (opts.rows || []).map(function (r) {
      const row = {};
      row[A.QUARTER_ID] = '2028T3';
      row[A.VERSION_NO] = 0;
      row[A.SERVICE_DATE] = r.serviceDate;
      row[A.POST_ID] = r.postId;
      row[A.SLOT_INDEX] = r.slotIndex;
      row[A.PERSON_ID] = r.personId;
      return row;
    });
  };

  gas.selfTestWriteGridCell_ = function (q, v, serviceDate, postId, slotIndex, text) {
    written.push({ serviceDate: serviceDate, postId: postId,
      slotIndex: slotIndex, text: text });
    return true;
  };

  gas.apiSaveAndConfirmPlan = function () {
    const p = opts.plans[Math.min(planIdx, opts.plans.length - 1)];
    planIdx++;
    planCalls.push(planIdx);
    if (typeof p === 'function') return p();
    return p;
  };
  gas.apiGetDashboardState = function () {
    return { unsaved: opts.unsaved || { gridChangeCount: 3, unresolvedCount: 0 } };
  };

  return { gas: gas, written: written, planCalls: planCalls,
    planCount: function () { return planIdx; } };
}

/** 一季五個主日、每日兩個崗位。 */
const ROWS = [];
DATES.forEach(function (d, i) {
  ROWS.push({ serviceDate: d, postId: 'WORSHIP', slotIndex: 1, personId: 'P1' });
  ROWS.push({ serviceDate: d, postId: 'USHER', slotIndex: 1, personId: 'P2' });
});
const BY_POST = { WORSHIP: ['P1', 'P3'], USHER: ['P2', 'P4'] };

// =====================================================================
console.log('\n=== 0【前提】fixture 嘅欄位要同真嗰個 return 對得上 ===');
{
  // ⚠️ 憑想像寫欄位名嘅話，下面每一條都會綠，而實機會紅。
  const SRC = read('src/WebAppSaveConfirm.gs');
  const at = SRC.indexOf('  // ── 零改動路徑（D4）');
  const block = SRC.slice(at, SRC.indexOf('\n}', at));
  const realKeys = (block.match(/^    (\w+):/gm) || [])
    .map(function (m) { return m.trim().replace(':', ''); }).sort();
  const mineKeys = Object.keys(makePlan({})).sort();
  checkEqual('★★★★★★ **fixture 嘅欄位同 `buildSaveAndConfirmPlan_()` 完全一樣**'
    + '——憑想像寫欄位名嘅話，呢一份會綠而實機會紅',
    mineKeys.join(','), realKeys.join(','));
  check('★★★★★ 而且真係抓到嘢（唔係兩邊都空）',
    realKeys.length >= 15, realKeys.join(','));
}

// =====================================================================
console.log('\n=== A【核心】第一批就乾淨 ⇒ 只叫一次 plan ===');
{
  const box = sandbox({
    rows: ROWS, byPost: BY_POST,
    plans: [makePlan({ real: [] })]
  });
  const picked = box.gas.selfTestPickAcceptedCells_('2028T3', 0, 3, 'S03');

  checkEqual('★★★★★★ 揀到 3 格', picked.cells.length, 3);
  checkEqual('★★★★★★ **只叫一次 plan**'
    + '——`apiSaveAndConfirmPlan()` 好貴，逐格試會食光 4.5 分鐘預算',
    picked.planCalls, 1);
  checkEqual('★★★★★★ 三格分散喺三個唔同主日'
    + '——同一日改三格會順手撞到同週規則，又係另一種雜訊',
    picked.cells.map(function (c) { return c.serviceDate; }).sort().join('、'),
    '2028-07-02、2028-07-09、2028-07-16');
  checkEqual('★★★★★★ 標住 `confirmed`——呼叫嗰邊唔使再叫多一次',
    picked.confirmed, true);
  checkEqual('★★★★★ 冇改回過任何一格', box.written.length, 3);
}

// =====================================================================
console.log('\n=== A【核心】第一批有一格犯規 ⇒ 改回原本嘅字、換格重試 ===');
{
  // 第 1 次：2028-07-02 WORSHIP 犯規。第 2 次：乾淨。
  const box = sandbox({
    rows: ROWS, byPost: BY_POST,
    plans: [
      makePlan({
        real: [makeViolation('2028-07-02', 'WORSHIP', 1, 'HARD_ROLE_REQUIRED')],
        gridChanges: [
          makeGridChange('2028-07-02', 'WORSHIP', 1, '假甲乙', '假戊己'),
          makeGridChange('2028-07-09', 'WORSHIP', 1, '假甲乙', '假戊己'),
          makeGridChange('2028-07-16', 'WORSHIP', 1, '假甲乙', '假戊己')
        ]
      }),
      makePlan({ real: [] })
    ]
  });
  const picked = box.gas.selfTestPickAcceptedCells_('2028T3', 0, 3, 'S03');

  checkEqual('★★★★★★ 叫咗 2 次 plan', picked.planCalls, 2);
  checkEqual('★★★★★★ 最後仍然湊夠 3 格', picked.cells.length, 3);
  check('★★★★★★ **犯規嗰格唔喺最終名單入面**'
    + '——留低嘅話，S05 一定會喺同一道閘拋錯',
    picked.cells.every(function (c) {
      return !(c.serviceDate === '2028-07-02' && c.postId === 'WORSHIP');
    }), JSON.stringify(picked.cells.map(function (c) {
      return c.serviceDate + ' ' + c.postId;
    })));

  // ⚠️ 改回嗰一下要用 plan 回傳嘅 `originalName`，唔自己再讀一次版本。
  const reverts = box.written.filter(function (w) {
    return w.serviceDate === '2028-07-02' && w.postId === 'WORSHIP'
      && w.text === '假甲乙';
  });
  checkEqual('★★★★★★ 犯規嗰格真係改咗回原本嗰個名'
    + '——而且個名由 plan 回傳嘅 `originalName` 攞，'
    + '唔自己再讀一次版本：同一件事用同一個來源',
    reverts.length, 1);
  const cleanReverts = box.written.filter(function (w) {
    return w.serviceDate === '2028-07-09' && w.text === '假甲乙';
  });
  checkEqual('★★★★★★ **乾淨嗰幾格冇被改回**'
    + '——全部改回就等於重頭嚟過，浪費咗嗰一次好貴嘅 plan',
    cleanReverts.length, 0);

  const att = picked.attempts;
  checkEqual('★★★★★ 過程記低咗兩次', att.length, 2);
  check('★★★★★ 而且第一次記低咗係邊一格、犯咗邊條規則'
    + '——冇呢一行，下一輪要由零查一次',
    /2028-07-02 WORSHIP#1/.test(att[0].offending.join('；'))
      && /HARD_ROLE_REQUIRED/.test(att[0].offending.join('；')),
    JSON.stringify(att));
}

// =====================================================================
console.log('\n=== A【核心】次次都犯規 ⇒ 用乾淨嗰幾格收口，唔死循環 ===');
{
  // 每一次都係 WORSHIP 嗰幾格犯規，USHER 嗰幾格乾淨。
  const always = function () {
    return makePlan({
      real: DATES.map(function (d) {
        return makeViolation(d, 'WORSHIP', 1, 'HARD_ELIGIBILITY');
      }),
      gridChanges: DATES.map(function (d) {
        return makeGridChange(d, 'WORSHIP', 1, '假甲乙', '假戊己');
      })
    });
  };
  const box = sandbox({ rows: ROWS, byPost: BY_POST, plans: [always] });
  const picked = box.gas.selfTestPickAcceptedCells_('2028T3', 0, 3, 'S03');

  check('★★★★★ 用完候選就停手，唔會死循環',
    picked.planCalls <= 4, '叫咗 ' + picked.planCalls + ' 次');
  check('★★★★★★ 收口嗰陣淨返嘅全部係乾淨嗰啲（USHER）',
    picked.cells.every(function (c) { return c.postId === 'USHER'; }),
    JSON.stringify(picked.cells));
  checkEqual('★★★★★★ 而且標住「未經最後確認」'
    + '——標成已確認嘅話，呼叫嗰邊會拎住一份過期嘅 plan 去斷言',
    picked.confirmed, false);
  check('★★★★★ 過程逐次都記低咗', picked.attempts.length >= 2,
    JSON.stringify(picked.attempts.length));
}

// =====================================================================
console.log('\n=== A【核心】候選源源不絕而次次都犯規 ⇒ plan 次數仍然有上限 ===');
{
  // ⚠️ 上面嗰條用完候選就停咗手，所以驗唔到個上限本身。
  // 呢一條造 18 個主日——候選夠跑足 6 個 round，
  // 冇上限嘅話佢就會叫足 6 次。
  const manyDates = [];
  for (let i = 0; i < 18; i++) {
    manyDates.push('2028-' + (i < 9 ? '07' : '08') + '-'
      + String((i % 9) + 1 + 10).slice(-2));
  }
  const manyRows = manyDates.map(function (d) {
    return { serviceDate: d, postId: 'WORSHIP', slotIndex: 1, personId: 'P1' };
  });
  const always = function () {
    return makePlan({
      real: manyDates.map(function (d) {
        return makeViolation(d, 'WORSHIP', 1, 'HARD_ELIGIBILITY');
      }),
      gridChanges: manyDates.map(function (d) {
        return makeGridChange(d, 'WORSHIP', 1, '假甲乙', '假戊己');
      })
    });
  };
  const box = sandbox({ rows: manyRows, byPost: BY_POST, plans: [always] });
  const picked = box.gas.selfTestPickAcceptedCells_('2028T3', 0, 3, 'S03');
  checkEqual('★★★★★★ **plan 最多叫 4 次**'
    + '——`apiSaveAndConfirmPlan()` 好貴，冇上限就會食光 4.5 分鐘預算，'
    + '退回「時間到、原地打轉」嗰個老問題。'
    + '呢一次有 18 個主日，冇上限嘅話佢會叫足 6 次',
    picked.planCalls, 4);
  checkEqual('★★★★★★ 而且收口嗰陣一格都唔收（全部都犯規）',
    picked.cells.length, 0);
}

// =====================================================================
console.log('\n=== A【核心】plan 拋錯 ⇒ 帶住原文，唔靜靜過 ===');
{
  const box = sandbox({
    rows: ROWS, byPost: BY_POST,
    plans: [function () { throw new Error('找不到「第 0 版」的工作表'); }]
  });
  const picked = box.gas.selfTestPickAcceptedCells_('2028T3', 0, 3, 'S03');
  check('★★★★★★ 帶住錯誤原文',
    /找不到「第 0 版」的工作表/.test(picked.planError), picked.planError);
  checkEqual('★★★★★ 而且冇當成「揀到 0 格」靜靜過去',
    picked.planError === '', false);
}

// =====================================================================
console.log('\n=== A 這一版本身就帶著違反 ⇒ 全部改回，唔賴喺呢一次改動身上 ===');
{
  // 違反喺一啲我哋冇掂過嘅格（DUTY_CC）。
  const box = sandbox({
    rows: ROWS, byPost: BY_POST,
    plans: [makePlan({
      real: [makeViolation('2028-07-02', 'DUTY_CC', 1, 'HARD_ROLE_REQUIRED')],
      gridChanges: DATES.slice(0, 3).map(function (d) {
        return makeGridChange(d, 'WORSHIP', 1, '假甲乙', '假戊己');
      })
    })]
  });
  const picked = box.gas.selfTestPickAcceptedCells_('2028T3', 0, 3, 'S03');
  checkEqual('★★★★★★ 一格都唔收'
    + '——違反唔喺我哋寫嗰幾格，即係呢一版本身就帶住，點換格都改變唔到',
    picked.cells.length, 0);
  check('★★★★★★ 而且講得出係邊幾格',
    /DUTY_CC/.test((picked.preExisting || []).join('；')),
    JSON.stringify(picked.preExisting));
  checkEqual('★★★★★ 只叫咗一次 plan——換極都一樣，唔好燒', picked.planCalls, 1);
  const reverted = box.written.filter(function (w) { return w.text === '假甲乙'; });
  checkEqual('★★★★★ 而且自己寫落去嗰三格全部改咗回原本嘅字', reverted.length, 3);
}

// =====================================================================
console.log('\n=== A【核心】`slotIndex` 型唔同都要對得上 ===');
{
  // ⚠️ 工作表讀返嚟係數字 `1`，而 API 回嚟可能係字串 `'1'`。
  // 唔統一嘅話兩邊永遠對唔上，於是「一格都冇犯規」
  // 就變成一個**永遠成立嘅假答案**——最難察覺嗰種。
  const box = sandbox({
    rows: ROWS, byPost: BY_POST,
    plans: [
      makePlan({
        // 特登用字串 '1'，而 `ROWS` 入面係數字 1。
        real: [makeViolation('2028-07-02', 'WORSHIP', '1', 'HARD_ROLE_REQUIRED')],
        gridChanges: [makeGridChange('2028-07-02', 'WORSHIP', '1', '假甲乙', '假戊己')]
      }),
      makePlan({ real: [] })
    ]
  });
  const picked = box.gas.selfTestPickAcceptedCells_('2028T3', 0, 3, 'S03');
  check('★★★★★★ **仍然認得出係嗰一格**'
    + '——認唔出嘅話，一格真犯規會被當成乾淨收咗貨，而 S05 一定拋錯',
    picked.cells.every(function (c) {
      return !(c.serviceDate === '2028-07-02' && c.postId === 'WORSHIP');
    }), JSON.stringify(picked.cells.map(function (c) {
      return c.serviceDate + ' ' + c.postId;
    })));
  checkEqual('★★★★★ 而且真係換過格重試', picked.planCalls, 2);
}

// =====================================================================
console.log('\n=== A1 揀法只做兩條粗篩，唔做規則判斷 ===');
{
  const gas = sandbox({ rows: ROWS, byPost: BY_POST, plans: [makePlan({})] }).gas;
  const pool = gas.selfTestBuildCandidatePool_('2028T3', 0);
  check('★★★★★★ 替代人選同現任唔同'
    + '——揀返同一個就唔算改動，而 `gridChangeCount` 會係 0',
    pool.every(function (c) { return c.replacement.personId !== c.personId; }),
    JSON.stringify(pool.slice(0, 3)));
  check('★★★★★★ 替代人選喺 `NameMapping` 認得出'
    + '——認唔出嘅話，系統會整批擋住（第五十一輪嗰個坑）',
    pool.every(function (c) { return !!c.replacement.name; }), '');

  // ⚠️ 冇 Eligibility 名單一樣要揀得到——因為合唔合資格由 plan 話事，
  // 唔係由呢度話事。
  const noElig = sandbox({ rows: ROWS, byPost: {}, plans: [makePlan({})] }).gas
    .selfTestBuildCandidatePool_('2028T3', 0);
  check('★★★★★★ **`Eligibility` 一個人都冇，一樣揀得到候選**'
    + '——合唔合資格由 plan 話事。喺呢度篩走就係自己再實作一次接受條件，'
    + '而嗰個正正係三輪紅嘅根源',
    noElig.length === ROWS.length, '揀到 ' + noElig.length + ' 個');
}

// =====================================================================
console.log('\n=== A1 `ANNOUNCE`／`DUTY_CC` 排最後（排序，唔係篩選）===');
{
  const rows = [
    { serviceDate: DATES[0], postId: 'ANNOUNCE', slotIndex: 1, personId: 'P1' },
    { serviceDate: DATES[1], postId: 'DUTY_CC', slotIndex: 1, personId: 'P1' },
    { serviceDate: DATES[2], postId: 'WORSHIP', slotIndex: 1, personId: 'P1' }
  ];
  const gas = sandbox({
    rows: rows,
    byPost: { ANNOUNCE: ['P1', 'P3'], DUTY_CC: ['P1', 'P3'], WORSHIP: ['P1', 'P3'] },
    plans: [makePlan({})]
  }).gas;
  const pool = gas.selfTestBuildCandidatePool_('2028T3', 0);
  checkEqual('★★★★★★ WORSHIP 行先'
    + '——嗰兩個崗位實際可用名單只有 Roles 上嗰幾位堂委，'
    + '一次命中率極低，白白燒 plan 次數',
    pool[0].postId, 'WORSHIP');
  checkEqual('★★★★★★ **但係冇被篩走**（排序，唔係規則判斷）'
    + '——篩走咗就係自己再實作一次接受條件',
    pool.length, 3);
}

// =====================================================================
console.log('\n=== C【核心】S03 真正跑一次：plan 拋錯 ⇒ 報 ERROR 帶住原文 ===');
{
  const box = sandbox({
    rows: ROWS, byPost: BY_POST,
    plans: [function () { throw new Error('找不到「第 0 版」的工作表'); }]
  });
  let threw = '';
  try { box.gas.selfTestS03_('2028T3'); } catch (err) { threw = err.message; }
  check('★★★★★★ **S03 拋出去**——自測機會把佢報成 `ERROR` 帶住原文。'
    + '靜靜過嘅話，後面每一條都會喺一個唔知咩狀態嘅季度上面跑',
    /找不到「第 0 版」的工作表/.test(threw), threw || '（居然冇拋）');
  // ⚠️ 唔可以淨係驗「有冇拋」——拆走咗嗰句 guard，S03 會照跑落去，
  // 然後喺最後嗰句「最終確認」度自然拋一次，一個「有冇拋」嘅斷言照樣綠。
  // 要驗**係佢自己嗰句拋嘅**：帶住 `S03 選格時：` 呢個前綴。
  check('★★★★★★ 而且係喺揀格嗰一步就停低'
    + '——唔係跑埋落去，撞到最後一句先自然拋一次',
    /^S03 選格時：/.test(threw), threw);
}

// =====================================================================
console.log('\n=== C【核心】S03 真正跑一次：第一批有一格犯規 ⇒ 綠 ===');
{
  const box = sandbox({
    rows: ROWS, byPost: BY_POST,
    unsaved: { gridChangeCount: 3, unresolvedCount: 0 },
    plans: [
      makePlan({
        real: [makeViolation('2028-07-02', 'WORSHIP', 1, 'HARD_ROLE_REQUIRED')],
        gridChanges: DATES.slice(0, 3).map(function (d) {
          return makeGridChange(d, 'WORSHIP', 1, '假甲乙', '假戊己');
        })
      }),
      makePlan({ real: [] })
    ]
  });
  const out = box.gas.selfTestS03_('2028T3');
  checkEqual('★★★★★★ S03 綠', out.status, box.gas.SELFTEST_STATUS.PASSED);
  const labels = out.checks.map(function (c) { return c.label; }).join('\n');
  check('★★★★★★ 而且過程寫入咗報告：plan 叫咗幾多次、邊幾格犯規',
    /plan 叫了 2 次/.test(labels) && /2028-07-02 WORSHIP#1/.test(labels),
    labels.slice(0, 900));
  check('★★★★★★ 而且真係驗咗 `needsRelease === false`'
    + '——呢一句就係攔住 S05 嗰道閘自己用嘅判斷',
    /不需要打字放行（needsRelease = false）/.test(labels), labels.slice(0, 900));
  check('★★★★★ 同埋 `violations.real` 係空嘅',
    /violations.real 是空的/.test(labels), labels.slice(0, 900));
}

// =====================================================================
console.log('\n=== C S03：湊唔夠格 ⇒ 跳過，唔係紅 ===');
{
  const always = function () {
    return makePlan({
      real: ROWS.map(function (r) {
        return makeViolation(r.serviceDate, r.postId, r.slotIndex, 'HARD_ELIGIBILITY');
      }),
      gridChanges: ROWS.map(function (r) {
        return makeGridChange(r.serviceDate, r.postId, r.slotIndex, '假甲乙', '假戊己');
      })
    });
  };
  const box = sandbox({ rows: ROWS, byPost: BY_POST, plans: [always] });
  const out = box.gas.selfTestS03_('2028T3');
  checkEqual('★★★★★★ **標 `SKIPPED`，唔係紅**'
    + '——紅會經 `dependsOn` 把 S04–S13 標成 `BLOCKED`，'
    + '而嗰九條先係呢部機器存在嘅理由',
    out.status, box.gas.SELFTEST_STATUS.SKIPPED);
  check('★★★★★ 而且講得出試過幾多次', /試了 \d 次/.test(out.note || ''), out.note);
}

// =====================================================================
console.log('\n=== C S03：接受條件淨係睇 real，唔睇 semiHard／structural ===');
{
  const plan = makePlan({ real: [] });
  plan.violations.semiHard = [makeViolation('2028-07-02', 'WORSHIP', 1, 'SEMI_NO_CONSECUTIVE')];
  plan.violations.structural = [makeViolation('2028-07-09', 'USHER', 1, 'HARD_SPECIAL_SUNDAY_SKIP')];
  const box = sandbox({ rows: ROWS, byPost: BY_POST, plans: [plan] });
  const picked = box.gas.selfTestPickAcceptedCells_('2028T3', 0, 3, 'S03');
  checkEqual('★★★★★★ 三格照收'
    + '——`semiHard` 同 `structural` **唔攔儲存**。'
    + '喺呢度理佢哋就係自己再解讀一次規則',
    picked.cells.length, 3);
  checkEqual('★★★★★ 而且只叫咗一次 plan', picked.planCalls, 1);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);

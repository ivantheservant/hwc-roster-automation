// 第二十三輪批次階段 F：區二「開季前準備」嘅未做完項數。
// 執行方式：node tests/pre_quarter_checklist.test.js

const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'AnnualCombined.gs',
  // 第二十六輪批次階段 D3：名單檢查新增「電郵格式唔對」一項，
  // 而個判斷函式住喺 WebAppPeople.gs。
  'WebAppPeople.gs', 'WebAppPreQuarter.gs'
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

const S = gas.COLUMNS.SPECIAL_SUNDAYS;

function specialRow(o) {
  const r = {};
  r[S.SERVICE_DATE] = o.serviceDate || '2027-03-28';
  r[S.TYPE] = o.type || '';
  r[S.TITLE] = o.title || '';
  r[S.SKIP_POST_IDS] = o.skipPostIds === undefined ? 'WORSHIP,PIANO' : o.skipPostIds;
  r[S.ACTIVE] = o.active === undefined ? 'TRUE' : o.active;
  r[S.CONFIRMED] = o.confirmed === undefined ? '' : o.confirmed;
  return r;
}
function countOf(result, id) {
  return result.items.filter(function (i) { return i.id === id; })[0].count;
}

console.log('\n=== F【核心】「未做完 N 項」係項數，唔係格數 ===');
{
  const r = gas.planPreQuarterChecklist_({
    specialRows: [specialRow({ confirmed: 'FALSE' })],
    serviceDates: [
      { serviceDate: '2027-01-03', translationRequired: false },
      { serviceDate: '2027-01-10', translationRequired: false },
      { serviceDate: '2027-01-17', translationRequired: false }
    ],
    filledByDatePost: {},
    preacherPostId: 'PREACH', translationPostId: 'TRANS', flowerPostId: 'FLOWER'
  });

  checkEqual('★★★★★ 講員 3 週未填、獻花 3 週未填、特別主日 1 個未確認 '
    + '⇒ N = 3（三**項**），唔係 7（七格）'
    + '——用格數會顯示「還有 7 項未做」，幹事會以為有七件唔同嘅事',
    r.undoneItemCount, 3);
  checkEqual('★★★★ 每項各自嘅 count 照樣要準', countOf(r, 'preacherEmpty'), 3);
  checkEqual('★★★★ 翻譯：冇一週要求翻譯 ⇒ 0', countOf(r, 'translationEmpty'), 0);
}

console.log('\n=== F【核心】Confirmed 方向：空白＝已確認，只有明確 FALSE 先算未確認 ===');
{
  const base = {
    serviceDates: [], filledByDatePost: {},
    preacherPostId: null, translationPostId: null, flowerPostId: null
  };

  checkEqual('★★★★★ Confirmed 空白 ⇒ **已確認**，唔算未做'
    + '（方向搞反嘅話，全部既有列一開機就會報未確認，噴一堆假警報）',
    countOf(gas.planPreQuarterChecklist_(Object.assign({}, base, {
      specialRows: [specialRow({ confirmed: '' })]
    })), 'specialUnconfirmed'), 0);

  checkEqual('★★★★★ Confirmed = FALSE ⇒ 未確認',
    countOf(gas.planPreQuarterChecklist_(Object.assign({}, base, {
      specialRows: [specialRow({ confirmed: 'FALSE' })]
    })), 'specialUnconfirmed'), 1);

  checkEqual('★★★★ Confirmed = TRUE ⇒ 已確認',
    countOf(gas.planPreQuarterChecklist_(Object.assign({}, base, {
      specialRows: [specialRow({ confirmed: 'TRUE' })]
    })), 'specialUnconfirmed'), 0);

  checkEqual('★★★★★ Active=FALSE 嘅列完全唔計（幹事已經決定唔用，'
    + '冇必要叫佢去確認一個唔會用嘅日期）',
    countOf(gas.planPreQuarterChecklist_(Object.assign({}, base, {
      specialRows: [specialRow({ confirmed: 'FALSE', active: 'FALSE' })]
    })), 'specialUnconfirmed'), 0);
}

console.log('\n=== F：合堂未指定跳過崗位 ===');
{
  const base = {
    serviceDates: [], filledByDatePost: {},
    preacherPostId: null, translationPostId: null, flowerPostId: null
  };
  checkEqual('★★★★★ 合堂 + SkipPostIDs 空白 ⇒ 算未做',
    countOf(gas.planPreQuarterChecklist_(Object.assign({}, base, {
      specialRows: [specialRow({ type: '合堂', skipPostIds: '' })]
    })), 'combinedNoSkip'), 1);
  checkEqual('★★★★ 合堂 + 已填 SkipPostIDs ⇒ 唔算',
    countOf(gas.planPreQuarterChecklist_(Object.assign({}, base, {
      specialRows: [specialRow({ type: '合堂', skipPostIds: 'WORSHIP,PIANO' })]
    })), 'combinedNoSkip'), 0);
  checkEqual('★★★★ 唔係合堂（例如浸禮）+ SkipPostIDs 空白 ⇒ 唔算'
    + '（只有合堂先一定要指定跳過崗位）',
    countOf(gas.planPreQuarterChecklist_(Object.assign({}, base, {
      specialRows: [specialRow({ type: '浸禮', skipPostIds: '' })]
    })), 'combinedNoSkip'), 0);
  checkEqual('★★★ Title 含「合堂」都認得（Type 同 Title 都會睇）',
    countOf(gas.planPreQuarterChecklist_(Object.assign({}, base, {
      specialRows: [specialRow({ type: '其他', title: '宣教月合堂', skipPostIds: '' })]
    })), 'combinedNoSkip'), 1);
}

console.log('\n=== F：翻譯只計 TranslationRequired=TRUE 嗰啲週 ===');
{
  const r = gas.planPreQuarterChecklist_({
    specialRows: [],
    serviceDates: [
      { serviceDate: '2027-01-03', translationRequired: true },
      { serviceDate: '2027-01-10', translationRequired: false },
      { serviceDate: '2027-01-17', translationRequired: true }
    ],
    filledByDatePost: { '2027-01-03|TRANS': true },
    preacherPostId: null, translationPostId: 'TRANS', flowerPostId: null
  });
  checkEqual('★★★★★ 兩週要翻譯、其中一週已填 ⇒ 1；唔需要翻譯嗰週唔計',
    countOf(r, 'translationEmpty'), 1);
}

console.log('\n=== F：搵唔到崗位時回 0，唔可以當成「全部未填」 ===');
{
  const r = gas.planPreQuarterChecklist_({
    specialRows: [],
    serviceDates: [
      { serviceDate: '2027-01-03', translationRequired: false },
      { serviceDate: '2027-01-10', translationRequired: false }
    ],
    filledByDatePost: {},
    preacherPostId: null, translationPostId: null, flowerPostId: null
  });
  checkEqual('★★★★★ 三個崗位都搵唔到 ⇒ 三項都係 0，N = 0'
    + '（如果當成「每週都未填」，會憑空報出一堆做唔到嘅嘢）',
    [countOf(r, 'preacherEmpty'), countOf(r, 'flowerEmpty'), r.undoneItemCount], [0, 0, 0]);
}

console.log('\n=== F：全部做好 ⇒ N = 0 ===');
{
  const r = gas.planPreQuarterChecklist_({
    specialRows: [specialRow({ type: '合堂', confirmed: 'TRUE', skipPostIds: 'WORSHIP' })],
    serviceDates: [{ serviceDate: '2027-01-03', translationRequired: true }],
    filledByDatePost: {
      '2027-01-03|PREACH': true, '2027-01-03|TRANS': true, '2027-01-03|FLOWER': true
    },
    preacherPostId: 'PREACH', translationPostId: 'TRANS', flowerPostId: 'FLOWER'
  });
  checkEqual('★★★★★ N = 0', r.undoneItemCount, 0);
  checkEqual('★★★★ 五項全部照樣回傳（前端要顯示「全部做好了」都要知有邊五項）',
    r.items.length, 5);
}

console.log('\n=== 規格 3.4：名單提示（唔計入 N）===');
{
  const R = gas.COLUMNS.ROLES;
  const roleRow = function (personId, effectiveTo, active) {
    const r = {};
    r[R.PERSON_ID] = personId;
    r[R.EFFECTIVE_TO] = effectiveTo;
    r[R.ACTIVE] = active === undefined ? 'TRUE' : active;
    return r;
  };

  const hints = gas.planPreQuarterPeopleHints_({
    assignments: [{ personId: 'P901' }, { personId: 'P902' }, { personId: 'P903' }],
    peopleById: {
      P901: { nameTC: '假甲', email: 'a@notarealchurch.invalid' },
      P902: { nameTC: '假乙', email: '' }
      // P903 完全唔喺名單
    },
    roleRows: [
      roleRow('P901', '2026-01-01'),   // 已過期而且喺表上 ⇒ 算
      roleRow('P902', ''),             // 現任 ⇒ 唔算
      roleRow('P999', '2026-01-01')    // 過期但唔喺表上 ⇒ 唔算
    ],
    quarterStartDate: '2026-10-04',
    eligibleCountByPost: { CHAIR: 8, PIANO: 2, AUDIO: 3 }
  });
  const byId = {};
  hints.forEach(function (h) { byId[h.id] = h.count; });

  checkEqual('★★★★★ 冇電郵：1 人（假乙）', byId.noEmail, 1);
  checkEqual('★★★★★ 唔喺人員名單：1 人（P903）', byId.notInNameList, 1);
  checkEqual('★★★★★ 身分已過期而且仲喺表上：1 人'
    + '（過期但唔喺本季表上嘅唔算——同本季無關）', byId.expiredRole, 1);
  checkEqual('★★★★ 合資格少於 3 人嘅崗位：1 個（PIANO=2；AUDIO=3 啱好唔算）',
    byId.thinEligibility, 1);
  // 第二十六輪批次階段 D3 新增第五條：「有人的電郵格式看起來不對」。
  // ⚠️ 同「冇電郵」係兩件唔同嘅事：冇電郵嘅人，系統知道佢收唔到；
  // 格式錯嘅人，**系統以為佢收到**——寄出去靜靜失敗，冇人會覺得有問題。
  checkEqual('★★★★ 五條提示全部回傳', hints.length, 5);
  check('★★★★★ 有「電郵格式看起來不對」呢一條',
    hints.some(function (h) { return h.id === 'badEmailFormat'; }),
    JSON.stringify(hints.map(function (h) { return h.id; })));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);

// 第二十五輪批次階段 E1：區三畫面一——不能服侍的日期。
// 執行方式：node tests/unavailable_crud.test.js
//
// ⚠️ 全部測試資料一律用 `P9xxx` 格式嘅假 PersonID 同明顯假名——
// 呢個 repo 係公開嘅，而呢一輪碰嘅係真實會友資料嘅工作表。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'QuarterStage.gs',
  'WebAppGuards.gs', 'WebAppRoster3Common.gs', 'WebAppUnavailable.gs'
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

const TZ = 'Pacific/Auckland';
gas.Utilities = {
  formatDate: function (date, timezone, format) {
    const pad = function (n) { return n < 10 ? '0' + n : String(n); };
    const base = date.getUTCFullYear() + '-' + pad(date.getUTCMonth() + 1)
      + '-' + pad(date.getUTCDate());
    return format === 'yyyy-MM-dd' ? base
      : base + ' ' + pad(date.getUTCHours()) + ':' + pad(date.getUTCMinutes());
  }
};
gas.assertWebAppRequestAllowed_ = function () {};
gas.getConfig = function (key, fallback) {
  return key === gas.CONFIG_KEYS.SYS_TIMEZONE ? TZ : fallback;
};

const U = gas.COLUMNS.UNAVAILABLE;
const M = gas.COLUMNS.NAME_MAPPING;

function personRow(id, name) {
  const r = {};
  r[M.PERSON_ID] = id; r[M.NAME_TC] = name; r[M.ACTIVE] = 'TRUE';
  return r;
}
function unavailRow(o) {
  const r = {};
  r[U.UNAVAILABLE_ID] = o.id;
  r[U.PERSON_ID] = o.personId;
  r[U.DATE_FROM] = o.from;
  r[U.DATE_TO] = o.to;
  r[U.APPLIES_TO] = o.appliesTo || 'ALL';
  r[U.POST_IDS] = o.postIds || '';
  r[U.REASON] = o.reason || '';
  r[U.STATUS] = 'ACTIVE';
  return r;
}

console.log('\n=== E1【核心】日期一律經 parseOfficerDateInput_()，唔另寫一套 ===');
{
  // 第二十一輪特登收窄咗接受嘅格式：「3/4」究竟係 3 月 4 日定 4 月 3 日，
  // 靠估就一定有一日估錯。另寫一套就等於喺呢個入口重新打開嗰個洞。
  checkEqual('★★★★★ yyyy-MM-dd 收',
    gas.parseUnavailableDate_('2026-11-08', TZ, '開始日期').dateStr, '2026-11-08');

  const slash = gas.parseUnavailableDate_('11/8', TZ, '開始日期');
  check('★★★★★ 「11/8」**唔收**（分唔出 11 月 8 日定 8 月 11 日）',
    slash.error !== '' && slash.dateStr === '');
  check('★★★★ 而且錯誤訊息要解釋點解唔收，唔係淨係話「格式錯」',
    /分不出/.test(slash.error), slash.error);

  const blank = gas.parseUnavailableDate_('', TZ, '開始日期');
  check('★★★★ 空白亦要報錯（唔可以靜靜當成今日）', blank.error !== '');

  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'WebAppUnavailable.gs'), 'utf8');
  check('★★★★★ 實作真係叫 parseOfficerDateInput_()，唔係自己 new Date()',
    /parseOfficerDateInput_\(raw, timezone\)/.test(src)
    && src.indexOf('new Date(raw') === -1);
}

console.log('\n=== E1【核心】影響預估：蓋住幾多個主日、有冇已經排咗 ===');
{
  gas.findLatestVersionNo = function () { return 1; };
  gas.readServiceDatesNormalized = function () {
    return [
      { serviceDate: '2026-11-01' }, { serviceDate: '2026-11-08' },
      { serviceDate: '2026-11-15' }, { serviceDate: '2026-11-22' },
      { serviceDate: '2026-11-29' }
    ];
  };
  gas.readPosts = function () {
    const P = gas.COLUMNS.POSTS;
    const mk = function (id, name) { const r = {}; r[P.POST_ID] = id; r[P.POST_NAME_TC] = name; return r; };
    return [mk('READ', '讀經'), mk('WORSHIP', '領詩')];
  };
  const A = gas.COLUMNS.ROSTER_ASSIGNMENTS;
  gas.readSheet = function (name) {
    if (name === gas.SHEETS.ROSTER_ASSIGNMENTS) {
      const r = {};
      r[A.QUARTER_ID] = '2026T4'; r[A.VERSION_NO] = 1;
      r[A.PERSON_ID] = 'P9001'; r[A.SERVICE_DATE] = '2026-11-08'; r[A.POST_ID] = 'READ';
      return [r];
    }
    return [];
  };

  const res = gas.apiPreviewUnavailableImpact({
    quarterId: '2026T4', personId: 'P9001',
    dateFrom: '2026-11-08', dateTo: '2026-11-22', appliesTo: 'ALL'
  });
  checkEqual('★★★★★ 蓋住 3 個主日', res.coveredDates,
    ['2026-11-08', '2026-11-15', '2026-11-22']);
  checkEqual('★★★★★ 而且指出佢喺 11-08 已經被排咗「讀經」'
    + '——冇呢一項，幹事會以為加完就搞掂，但現有版本其實冇變',
    res.conflicts, [{ serviceDate: '2026-11-08', postId: 'READ', postNameTC: '讀經' }]);

  const noOverlap = gas.apiPreviewUnavailableImpact({
    quarterId: '2026T4', personId: 'P9001',
    dateFrom: '2026-12-01', dateTo: '2026-12-31', appliesTo: 'ALL'
  });
  checkEqual('★★★★ 冇蓋住任何主日 ⇒ 空陣列（唔係報錯）', noOverlap.coveredDates, []);

  const otherPost = gas.apiPreviewUnavailableImpact({
    quarterId: '2026T4', personId: 'P9001',
    dateFrom: '2026-11-08', dateTo: '2026-11-22',
    appliesTo: 'POSTS', postIds: ['WORSHIP']
  });
  checkEqual('★★★★★ 只針對「領詩」時，佢嗰格「讀經」唔算衝突',
    otherPost.conflicts, []);

  const reversed = gas.apiPreviewUnavailableImpact({
    quarterId: '2026T4', personId: 'P9001',
    dateFrom: '2026-11-22', dateTo: '2026-11-08', appliesTo: 'ALL'
  });
  check('★★★★★ 開始日期遲過結束日期 ⇒ 擋住，而且講明「什麼都沒有加入」',
    reversed.ok === false && /什麼都沒有加入/.test(reversed.message));
}

console.log('\n=== E1【核心】過期嘅行摺埋，唔刪 ===');
{
  gas.readSheet = function (name) {
    if (name === gas.SHEETS.NAME_MAPPING) return [personRow('P9001', '測試甲')];
    if (name === gas.SHEETS.UNAVAILABLE) {
      return [
        unavailRow({ id: 'U1', personId: 'P9001', from: '2020-01-01', to: '2020-01-31' }),
        unavailRow({ id: 'U2', personId: 'P9001', from: '2099-01-01', to: '2099-01-31' })
      ];
    }
    return [];
  };
  gas.readPosts = function () { return []; };
  gas.beginSheetReadMemo_ = function () {};
  gas.endSheetReadMemo_ = function () {};

  const res = gas.apiListUnavailable('2026T4', '');
  checkEqual('★★★★ 未來嗰筆入「生效中」', res.current.map(function (r) { return r.unavailableId; }), ['U2']);
  checkEqual('★★★★★ 過去嗰筆入「已過去」而**唔係消失**'
    + '——刪咗就冇咗紀錄，下次有人問「佢舊年幾時唔喺度」就查唔到',
    res.past.map(function (r) { return r.unavailableId; }), ['U1']);
}

console.log('\n=== E1 名單上搵唔到嗰個人：唔可以顯示空白 ===');
{
  gas.readSheet = function (name) {
    if (name === gas.SHEETS.NAME_MAPPING) return [];
    if (name === gas.SHEETS.UNAVAILABLE) {
      return [unavailRow({ id: 'U3', personId: 'P9999', from: '2099-01-01', to: '2099-01-31' })];
    }
    return [];
  };
  const res = gas.apiListUnavailable('2026T4', '');
  check('★★★★★ 顯示「（名單上找不到 …）」而唔係空白'
    + '——空白會令幹事以為呢一行壞咗而想刪走佢',
    /名單上找不到/.test(res.current[0].personName), res.current[0].personName);
}

console.log('\n=== E1 結構：唔刪行、有 AuditLog、只改該欄 ===');
{
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'WebAppUnavailable.gs'), 'utf8');
  check('★★★★★ 完全冇 deleteRow 呢類刪行呼叫',
    !/deleteRow|deleteRows|removeRow/.test(src));
  check('★★★★★ 每個寫入 API 第一行都有 assertWebAppRequestAllowed_()',
    (src.match(/function api\w+\(/g) || []).length
      === (src.match(/assertWebAppRequestAllowed_\(\);/g) || []).length);
  check('★★★★★ 寫入之後有寫 AuditLog（新增同更新兩條路都有）',
    /action: 'UNAVAILABLE_ADD'/.test(src) && /action: 'UNAVAILABLE_UPDATE'/.test(src));
  check('★★★★★ 用 writeRowFields_()（只改該欄），**唔係整行覆寫**'
    + '——整行覆寫會靜靜清空畫面上冇顯示嘅欄',
    /writeRowFields_\(opened\.sheet, opened\.headers/.test(src)
    && !/setValues\(\[row\]\)/.test(src));
  check('★★★★★ 改現有行時用 findRowById_ 重新搵列號，**唔信前端傳嚟嗰個**'
    + '——幹事可能喺試算表插咗行，個列號就會指去第二行，寫落去就係改錯人',
    /findRowById_\(SHEETS\.UNAVAILABLE, U\.UNAVAILABLE_ID, existingId\)/.test(src));
}

console.log('\n=== E1 畫面文案：規格 4.1 指定嗰句一定要有 ===');
{
  const zone3 = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'ui', 'ScriptZone3.html'), 'utf8');
  check('★★★★★ 有「系統沒有『上半場不在』這種概念」',
    zone3.indexOf('系統沒有「上半場不在」這種概念。填了就代表整日不能服侍。') !== -1);
  check('★★★★★ 有「加了這一筆之後…要撳儲存並確認」',
    zone3.indexOf('要撳「儲存並確認」系統才會重新檢查。') !== -1);
  check('★★★★ 過期一節有講明「保留紀錄，不會刪走」',
    zone3.indexOf('保留紀錄，不會刪走') !== -1);
  check('★★★★★ 儲存前有確認畫面，而且寫住會改幾多行',
    zone3.indexOf('會改動 1 行。') !== -1);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);

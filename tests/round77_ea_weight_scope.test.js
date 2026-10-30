// 第七十七輪批次 EA 組：排表偏好搬到開季前準備；可以揀「只用於這一季」或「之後各季都用」。
// 執行方式：node tests/round77_ea_weight_scope.test.js
//
// Ivan（手動測試 B）：「排表偏好 move up beside 不能服侍的日期」；「加一個勾選框，把這次的偏好用於之後
// 所有季度，直到再改。預設不勾＝只用於這一季。儲存之前提醒使用者這個設定是只限這一季，還是之後的季度也用。」
//
//   EA1　讀取優先次序：只限行 > 長期行；同類 ⇒ CreatedAt 最新；只限行 Adjust=0 蓋過長期 +1（結果＝冇偏好）
//   EA2　純函式 planPersonPostWeightWrites_()：只限這一季 ⇒ 加一行（0 都寫）、唔解除；
//        之後各季都用 ⇒ 季初起仍生效嘅行填 EffectiveTo=季初前一日、Adjust≠0 加長期行；過去季度不受影響
//   EA3　apiGetPersonPostWeightMatrix()：參考日期＝季度開始日、每項有範圍文字
//   EA4　畫面：〔排表偏好〕喺開季前準備（〔不能服侍的日期〕旁邊）、第 2 步冇；標題寫季度；
//        勾選框預設不勾；確認窗文字按勾選改變；〔確定儲存〕〔返回〕；儲存時傳 quarterId 同 applyToFuture

const vm = require('vm');
const { loadGasSource } = require('./helpers/gas_loader.js');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 700));
}

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'QuarterStage.gs',
  'WebAppGuards.gs', 'WebAppRoster3Common.gs', 'PersonPostWeight.gs', 'WebAppWeightEdit.gs'
]);
const W = gas.COLUMNS.PERSON_POST_WEIGHT;
const TZ = 'Pacific/Auckland';
gas.assertWebAppRequestAllowed_ = function () {};
gas.beginSheetReadMemo_ = function () {};
gas.endSheetReadMemo_ = function () {};
gas.getConfig_ = function (key, fallback) { return fallback; };
gas.Utilities = { formatDate: function (d, tz, fmt) {
  const iso = new Date(d.getTime()).toISOString();
  if (fmt === 'yyyy-MM-dd' || tz === 'UTC') return iso.slice(0, 10);
  return iso.slice(0, 10) + ' ' + iso.slice(11, 19);
} };
gas.nowTimestamp_ = function () { return '2098-12-20 10:00:00'; };
gas.compactTimestamp_ = function () { return '20981220100000'; };
gas.Session = { getActiveUser: function () { return { getEmail: function () { return 'k@example.invalid'; } }; } };
gas.buildPersonNameIndex_ = function () { return { P9701: '假甲' }; };
gas.readPosts_ = function () {
  const P = gas.COLUMNS.POSTS;
  const r = {}; r[P.POST_ID] = 'CHAIR'; r[P.POST_NAME_TC] = '主席'; r[P.AUTO_GENERATE] = 'TRUE';
  return [r];
};
const QUARTERS = {
  '2098T4': ['2098-10-01', '2098-12-31'],
  '2099T1': ['2099-01-01', '2099-03-31'],
  '2099T2': ['2099-04-01', '2099-06-30']
};
gas.findQuarterRowInfo_ = function (id) {
  if (!QUARTERS[id]) return null;
  const Q = gas.COLUMNS.QUARTERS;
  const v = {}; v[Q.QUARTER_ID] = id; v[Q.START_DATE] = QUARTERS[id][0]; v[Q.END_DATE] = QUARTERS[id][1];
  return { sheetRow: 3, headers: [], values: v };
};
gas.buildQuarterLabel_ = function (id) { return id === '2099T1' ? '2099年1-3月' : id; };

function row(o) {
  const r = {};
  r[W.WEIGHT_ID] = o.id || 'W';
  r[W.PERSON_ID] = o.personId || 'P9701';
  r[W.POST_ID] = o.postId || 'CHAIR';
  r[W.ADJUST] = o.adjust;
  r[W.REASON] = o.reason || '測試';
  r[W.ACTIVE] = o.active === undefined ? 'TRUE' : o.active;
  r[W.EFFECTIVE_FROM] = o.from || '';
  r[W.EFFECTIVE_TO] = o.to || '';
  r[W.CREATED_AT] = o.createdAt || '';
  return r;
}
const adjustAt = function (date) {
  const a = gas.readActivePersonPostWeights_(date, TZ);
  const hit = a.byKey['P9701|CHAIR'];
  return hit ? hit.adjust : 0;
};

console.log('\n=== EA1：讀取優先次序 ===');
{
  gas.readOptionalSheet_ = function () {
    return [
      row({ id: 'L1', adjust: 1, from: '2098-10-01', createdAt: '2098-09-01 10:00:00' }),          // 長期 +1
      row({ id: 'Q0', adjust: 0, from: '2099-01-01', to: '2099-03-31', createdAt: '2098-12-01 10:00:00' }) // 2099T1 照一般排
    ];
  };
  check('★★★★★★ 只限行 Adjust=0 蓋過長期 +1：2099T1 讀到冇偏好', adjustAt('2099-01-01') === 0);
  check('★★★★★★ 下一季（2099T2）冇只限行 ⇒ 長期 +1 照用', adjustAt('2099-04-01') === 1);
  check('★★★★★ 上一季（2098T4）照舊讀到長期 +1', adjustAt('2098-10-01') === 1);
  const a = gas.readActivePersonPostWeights_('2099-04-01', TZ);
  check('★★★★ 讀出嚟嘅項目帶範圍（ONGOING）', a.byKey['P9701|CHAIR'].scope === 'ONGOING');

  gas.readOptionalSheet_ = function () {
    return [
      row({ id: 'Q1', adjust: 1, from: '2099-01-01', to: '2099-03-31', createdAt: '2098-12-01 10:00:00' }),
      row({ id: 'Q2', adjust: 2, from: '2099-01-01', to: '2099-03-31', createdAt: '2098-12-05 10:00:00' }),
      row({ id: 'L2', adjust: -1, from: '2098-01-01', createdAt: '2098-12-30 10:00:00' })
    ];
  };
  check('★★★★★★ 同一季兩行只限 ⇒ CreatedAt 最新嗰行（+2）；長期行即使更新都排後', adjustAt('2099-01-01') === 2);
  gas.readOptionalSheet_ = function () {
    return [
      row({ id: 'A', adjust: 1, from: '2098-01-01', createdAt: new Date('2098-12-01T10:00:00Z') }),
      row({ id: 'B', adjust: -2, from: '2098-01-01', createdAt: new Date('2098-12-01T10:00:00Z') })
    ];
  };
  check('★★★★ CreatedAt 係 Date 物件都比較到；同一秒 ⇒ 表上較後嗰行', adjustAt('2099-01-01') === -2);
}

console.log('\n=== EA2：純函式 planPersonPostWeightWrites_() ===');
{
  const quarter = { startDate: '2099-01-01', endDate: '2099-03-31' };
  const existing = [
    { sheetRow: 3, index: 0, weightId: 'L1', personId: 'P9701', postId: 'CHAIR', adjust: 1, effectiveFrom: '2098-10-01', effectiveTo: '', active: true, createdAt: '2098-09-01 10:00:00' },
    { sheetRow: 4, index: 1, weightId: 'OLD', personId: 'P9701', postId: 'CHAIR', adjust: 2, effectiveFrom: '2098-10-01', effectiveTo: '2098-12-31', active: true, createdAt: '2098-09-02 10:00:00' }
  ];
  // 只限這一季：0 蓋過長期 +1
  let plan = gas.planPersonPostWeightWrites_([{ personId: 'P9701', postId: 'CHAIR', adjust: 0, reason: 'r' }], existing, quarter, false);
  check('★★★★★★ 只限這一季、揀「一般」⇒ 加一行 Adjust=0（季初→季尾），唔解除任何行',
    plan.adds.length === 1 && plan.adds[0].adjust === 0 && plan.adds[0].effectiveFrom === '2099-01-01'
    && plan.adds[0].effectiveTo === '2099-03-31' && plan.releases.length === 0 && plan.skipped === 0, JSON.stringify(plan));
  plan = gas.planPersonPostWeightWrites_([{ personId: 'P9701', postId: 'CHAIR', adjust: 1, reason: 'r' }], existing, quarter, false);
  check('★★★★★ 只限這一季、同季初生效值一樣（+1）⇒ skipped', plan.adds.length === 0 && plan.skipped === 1, JSON.stringify(plan));

  // 之後各季都用
  plan = gas.planPersonPostWeightWrites_([{ personId: 'P9701', postId: 'CHAIR', adjust: 2, reason: 'r' }], existing, quarter, true);
  check('★★★★★★ 之後各季都用 ⇒ 長期行填 EffectiveTo=季初前一日；過去季度嗰行（已完結）唔郁',
    plan.releases.length === 1 && plan.releases[0].weightId === 'L1' && plan.releases[0].effectiveTo === '2098-12-31', JSON.stringify(plan));
  check('★★★★★ 而且加一行長期行（EffectiveFrom=季初、EffectiveTo 空白）',
    plan.adds.length === 1 && plan.adds[0].effectiveFrom === '2099-01-01' && plan.adds[0].effectiveTo === '' && plan.adds[0].scope === 'ONGOING', JSON.stringify(plan));
  plan = gas.planPersonPostWeightWrites_([{ personId: 'P9701', postId: 'CHAIR', adjust: 0, reason: 'r' }], existing, quarter, true);
  check('★★★★★ 之後各季都用、揀「一般」⇒ 只解除，唔加新行', plan.releases.length === 1 && plan.adds.length === 0, JSON.stringify(plan));

  // 改長期之後，同一季嘅只限行一併失效
  const withQuarter = existing.concat([
    { sheetRow: 5, index: 2, weightId: 'Q0', personId: 'P9701', postId: 'CHAIR', adjust: 0, effectiveFrom: '2099-01-01', effectiveTo: '2099-03-31', active: true, createdAt: '2098-12-01 10:00:00' }
  ]);
  plan = gas.planPersonPostWeightWrites_([{ personId: 'P9701', postId: 'CHAIR', adjust: 1, reason: 'r' }], withQuarter, quarter, true);
  check('★★★★★★ 改長期（值同原長期一樣）但同季有只限行 ⇒ 只限行同長期行都解除，再加長期行',
    plan.releases.map((r) => r.weightId).sort().join(',') === 'L1,Q0' && plan.adds.length === 1, JSON.stringify(plan));

  // 之後各季都用 ⇒ 上一季不受影響、下一季讀到：用 readActive 驗（模擬寫入之後嘅表）
  gas.readOptionalSheet_ = function () {
    return [
      row({ id: 'L1', adjust: 1, from: '2098-10-01', to: '2098-12-31', createdAt: '2098-09-01 10:00:00' }),
      row({ id: 'N', adjust: 2, from: '2099-01-01', createdAt: '2098-12-20 10:00:00' })
    ];
  };
  check('★★★★★★ 寫入之後：上一季仍然 +1、呢一季同下一季都係 +2',
    adjustAt('2098-10-01') === 1 && adjustAt('2099-01-01') === 2 && adjustAt('2099-04-01') === 2);
}

console.log('\n=== EA3：矩陣按季度 ===');
{
  const E = gas.COLUMNS.ELIGIBILITY;
  const M = gas.COLUMNS.NAME_MAPPING;
  gas.readOptionalSheet_ = function () {
    return [row({ id: 'Q', adjust: 1, from: '2099-01-01', to: '2099-03-31', createdAt: '2098-12-01 10:00:00' })];
  };
  gas.readSheet_ = function (name) {
    if (name === gas.SHEETS.NAME_MAPPING) { const a = {}; a[M.PERSON_ID] = 'P9701'; a[M.NAME_TC] = '假甲'; return [a]; }
    if (name === gas.SHEETS.ELIGIBILITY) {
      const e = {}; e[E.PERSON_ID] = 'P9701'; e[E.POST_ID] = 'CHAIR'; e[E.ELIGIBLE] = 'TRUE'; e[E.ACTIVE] = 'TRUE'; return [e];
    }
    return [];
  };
  const m = gas.apiGetPersonPostWeightMatrix('2099T1');
  check('★★★★★ 參考日期＝季度開始日、標題用季度名', m.referenceDate === '2099-01-01' && m.quarterLabel === '2099年1-3月', JSON.stringify([m.referenceDate, m.quarterLabel]));
  check('★★★★★ 每一項旁邊有範圍：只限這一季', m.posts[0].people[0].adjust === 1 && m.posts[0].people[0].scopeText === '只限這一季', JSON.stringify(m.posts[0].people[0]));
  const m2 = gas.apiGetPersonPostWeightMatrix('2099T2');
  check('★★★★★ 換季度（2099T2）⇒ 只限 2099T1 嗰項唔見', m2.posts[0].people[0].adjust === 0 && m2.posts[0].people[0].scopeText === '', JSON.stringify(m2.posts[0].people[0]));

  // 儲存：傳 quarterId 同 applyToFuture，寫嘅行同純函式一致
  const appends = []; const writes = []; const audits = [];
  gas.openSheetForEdit_ = function () { return { sheet: {}, headers: [] }; };
  gas.writeRowFields_ = function (s, h, sheetRow, u) { writes.push({ sheetRow, u }); return []; };
  gas.appendRowFields_ = function (s, h, r) { appends.push(r); return 9; };
  gas.writeZone3Audit_ = function (e) { audits.push(e); };
  const res = gas.apiSavePersonPostWeightBatch([{ personId: 'P9701', postId: 'CHAIR', adjust: 2, reason: '堂委決議' }],
    { quarterId: '2099T1', applyToFuture: true });
  check('★★★★★★ 之後各季都用：解除只限行（EffectiveTo=2098-12-31）、加長期行、回傳範圍文字',
    res.ok && res.released === 1 && writes[0].u[W.EFFECTIVE_TO] === '2098-12-31' && appends[0][W.EFFECTIVE_TO] === ''
    && appends[0][W.EFFECTIVE_FROM] === '2099-01-01' && /之後各季都用/.test(res.scopeText), JSON.stringify([res, writes, appends]));
  check('★★★★ AuditLog 每一個動作都寫明範圍', audits.length === 2 && audits.every((a) => /範圍：/.test(a.notes)), JSON.stringify(audits));
}

console.log('\n=== EA4：畫面 ===');
(async () => {
  const ui = loadUiScripts(['Script.html', 'ScriptZone1.html', 'ScriptZone2.html', 'ScriptZone3.html',
    'ScriptZone4.html', 'ScriptMainFlow.html', 'ScriptSendPaper.html', 'ScriptSuggestion.html', 'ScriptRollback.html']);
  vm.runInContext("currentQuarterId = '2099T1';", ui);
  vm.runInContext('runAction = async function (l, fn) { await fn(); };', ui);
  vm.runInContext('getDashboard = async function () { return { latestVersion: null }; };', ui);
  const calls = [];
  ui.callServerMutating = async (name, ...args) => { calls.push({ name, args }); return { ok: true, added: 1, released: 0, scopeText: 'x' }; };
  ui.callServer = async () => ({
    loadAvailable: true, invalid: [], quarterId: '2099T1', quarterLabel: '2099年1-3月',
    posts: [{ postId: 'CHAIR', postNameTC: '主席', people: [{ personId: 'P9701', nameTC: '假甲', adjust: 1, scope: 'QUARTER', scopeText: '只限這一季', reason: 'r', baselineText: 'b', thisQuarterCount: null, gapText: '', quarterLoad: null }] }],
    choices: [{ adjust: 1, label: '多一次' }, { adjust: 0, label: '一般（預設）' }]
  });
  const tick = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
  const btnIn = (node, text) => node.flatten().filter((n) => n.tagName === 'BUTTON' && n.textContent === text)[0];
  const body = () => ui.document.getElementById('modalBody');
  const acts = () => ui.document.getElementById('modalActions');

  ui.renderZone2Body({ preQuarter: { items: [] } });
  const z2 = ui.document.getElementById('zone2Body').flatten().filter((n) => n.tagName === 'BUTTON').map((n) => n.textContent);
  check('★★★★★★ 開季前準備：〔排表偏好〕喺〔不能服侍的日期〕旁邊', z2.indexOf('排表偏好') === z2.indexOf('不能服侍的日期') + 1, JSON.stringify(z2));
  const step2 = ui.renderStep2({ latestVersion: { versionNo: 1, sheetUrl: 'https://example.invalid/g' }, buttons: { save: { enabled: true } }, versionChoices: [] }, {});
  check('★★★★★ 第 2 步冇〔排表偏好〕', !btnIn(step2, '排表偏好'));

  await ui.openWeights();
  await tick();
  check('★★★★★ 標題寫明季度：「排表偏好：2099年1-3月」', ui.document.getElementById('modalTitle').textContent === '排表偏好：2099年1-3月', ui.document.getElementById('modalTitle').textContent);
  vm.runInContext("weightPostFilter = 'CHAIR'; renderWeights();", ui);
  await tick();
  const box = body().flatten().filter((n) => n.tagName === 'INPUT' && n.type === 'checkbox' && n.id === 'weightApplyFuture')[0];
  check('★★★★★★ 底部有「也用於之後的季度（直到再改）」勾選框，預設不勾', box && box.checked === false && /也用於之後的季度（直到再改）/.test(body().textContent));
  check('★★★★★ 每一項旁邊寫範圍「只限這一季」', /目前生效中（只限這一季）/.test(body().textContent), body().textContent.slice(0, 500));

  vm.runInContext("weightChanges = { 'P9701|CHAIR': { adjust: 0, reason: '改回一般' } };", ui);
  ui.confirmWeightBatch();
  await tick();
  check('★★★★★★ 不勾：「這 1 項偏好只用於 2099年1-3月。之後的季度不受影響。」', /這 1 項偏好只用於 2099年1-3月。之後的季度不受影響。/.test(body().textContent), body().textContent);
  check('★★★★★ 有〔確定儲存〕〔返回〕', !!btnIn(acts(), '確定儲存') && !!btnIn(acts(), '返回'));
  btnIn(acts(), '確定儲存').fire('click');
  await tick();
  const save = calls.filter((c) => c.name === 'apiSavePersonPostWeightBatch')[0];
  check('★★★★★★ 儲存時傳 {quarterId, applyToFuture:false}', save && save.args[1] && save.args[1].quarterId === '2099T1' && save.args[1].applyToFuture === false, JSON.stringify(save));

  // 勾了
  await ui.openWeights();
  await tick();
  vm.runInContext("weightApplyFuture = true; weightChanges = { 'P9701|CHAIR': { adjust: 0, reason: '改回一般' } };", ui);
  ui.confirmWeightBatch();
  await tick();
  check('★★★★★★ 勾了：「這 1 項偏好由 2099年1-3月 開始，之後每一季都會用，直到你再改。」',
    /這 1 項偏好由 2099年1-3月 開始，之後每一季都會用，直到你再改。/.test(body().textContent), body().textContent);
  btnIn(acts(), '確定儲存').fire('click');
  await tick();
  const save2 = calls.filter((c) => c.name === 'apiSavePersonPostWeightBatch')[1];
  check('★★★★★ 儲存時傳 applyToFuture:true', save2 && save2.args[1].applyToFuture === true, JSON.stringify(save2));

  console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
  process.exit(fail === 0 ? 0 : 1);
})();

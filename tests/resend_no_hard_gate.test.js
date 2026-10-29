// 第七十三輪批次 BA 組：改動後重發同正式發出一樣，**唔設硬規則關卡**，只提醒。
// 執行方式：node tests/resend_no_hard_gate.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場（第七十一輪 s47b／s47c／s47d）
// ═════════════════════════════════════════════════════════════════════
//
// 某一格已放行；第 5 版撳「改動後重發」被擋：「這一版仍然有違反規則的安排，需要先在
// 「儲存並確認」處理」。照訊息去儲存，卻說「沒有偵測到任何改動」＝死胡同。
// 成因：`apiStep5GeneratePdfs_locked_()`／`apiStep5SendConfirm_locked_()` 用
// `resolveHardViolationRelease_(violations, releaseText)`——完全唔理已放行，只認打字，
// 而畫面傳落嚟嘅 releaseText 永遠係空字串。正式發出（`executeStep4Send_()`）根本冇呢道關卡。
//
// Ivan 決定：改動後重發同正式發出一樣，不擋。
//
//   BA1　有已放行嘅格 ⇒ 重發唔擋（產生 PDF、寄送兩步都係）
//   BA2　有未放行嘅違反 ⇒ 重發都唔擋，而且寫一行 AuditLog 提醒紀錄
//   BA3　提醒紀錄**唔係**放行紀錄（唔用 HARD_RELEASE_ACTION、冇 RELEASED_KEYS），
//        否則下次會被當成「已放行」
//   BA4　提醒算唔到（拋錯）⇒ 照樣寄出，不變成新阻擋
//   BA5　`summariseVersionSendWarnings_()` 帶 `unreleased`（確認窗黃框用）；
//        `buildSendWarningNodes()` 畫黃框，文字同 Ivan 指定嘅一樣，狀態卡（compact）不畫
//   BA6　選單版「改動後重發」只提醒，不再要求打字「確認放行」
//   BA7　畫面前端兩處 `blocked` 防衛不再有「儲存並確認」字眼

const { loadGasSource } = require('./helpers/gas_loader.js');
const { loadUiScripts } = require('./helpers/ui_loader.js');
const fs = require('fs');
const path = require('path');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 600));
}

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs',
  'HardViolationClass.gs', 'FourStageFlow.gs', 'SendWarnings.gs', 'WebAppFlow.gs'
]);

const Q = '2099T1';
const HARD = (over) => Object.assign({
  severity: 'HARD', ruleId: 'HARD_ELIGIBILITY', serviceDate: '2099-01-03',
  postId: 'CHAIR', slotIndex: 1, personId: 'P9001', reason: '不在這個崗位的名單上'
}, over || {});

// ── 共用 stub：只留「改動後重發」兩個伺服器入口要用到嘅東西 ─────────────
const auditLog = [];
let releasedKeys = {};
let changedList = [];
let violationsNow = [];
gas.assertWebAppRequestAllowed_ = function () {};
gas.withMutationLock_ = function (label, fn) { return fn(); };
gas.assertNoUnsavedChanges_ = function () { return { released: false }; };
gas.resolveAllowUnsavedFlag_ = function () { return false; };
gas.logSendWithUnsavedRelease_ = function () {};
gas.withUnsavedReleaseNote_ = function (o) { return o; };
gas.log_ = function () {};
gas.writeAuditLog_ = function (e) { auditLog.push(e); };
gas.planStep5ChangedList_ = function () { return { versionNo: 5, changedList: changedList, context: {} }; };
gas.getConfig = function () { return 'Pacific/Auckland'; };
gas.readUnavailableNormalized = function () { return []; };
gas.findLatestVersionNo = function () { return 5; };
gas.buildHardViolationClassContext_ = function () {
  return {
    quarterId: Q, releasedKeys: releasedKeys, releasedVersionByKey: {}, legacyReleasedKeys: {},
    unavailableCreatedAtByPerson: {}, versionCreatedAtMs: null
  };
};
gas.recomputeLatestVersionViolations_ = function () { return violationsNow; };
gas.resolveHardViolationRelease_ = function () {
  throw new Error('改動後重發唔應該再叫 resolveHardViolationRelease_');
};

console.log('\n=== BA1　有已放行嘅格 ⇒ 重發唔擋 ===');
{
  const v = HARD();
  violationsNow = [v];
  releasedKeys = {}; releasedKeys[gas.buildHardViolationKey_(Q, v)] = true;
  auditLog.length = 0; changedList = [];
  const pdf = gas.apiStep5GeneratePdfs_locked_(Q, '', null);
  check('★★★★★ 產生 PDF：不回 blocked', pdf.blocked === false, JSON.stringify(pdf));
  const send = gas.apiStep5SendConfirm_locked_(Q, '', null);
  check('★★★★★ 寄送：不回 blocked', send.blocked === false, JSON.stringify(send));
  check('★★★★ 全部已放行 ⇒ 冇寫提醒紀錄', auditLog.length === 0, JSON.stringify(auditLog));
}

console.log('\n=== BA2／BA3　有未放行嘅違反 ⇒ 唔擋，只寫提醒紀錄（唔係放行紀錄）===');
{
  violationsNow = [HARD({ postId: 'CHAIR' }), HARD({ postId: 'READER', personId: 'P9002' })];
  releasedKeys = {};
  auditLog.length = 0; changedList = [];
  const pdf = gas.apiStep5GeneratePdfs_locked_(Q, '', null);
  const send = gas.apiStep5SendConfirm_locked_(Q, '', null);
  check('★★★★★ 未放行都唔擋（產生 PDF）', pdf.blocked === false, JSON.stringify(pdf));
  check('★★★★★ 未放行都唔擋（寄送）', send.blocked === false, JSON.stringify(send));
  const logged = auditLog.filter((e) => e.action === gas.HARD_UNRELEASED_AT_SEND_ACTION);
  check('★★★★ 寄送時寫咗一行提醒紀錄', logged.length === 1, JSON.stringify(auditLog));
  check('★★★★ 提醒紀錄講明 2 項', logged.length === 1 && /2 項/.test(logged[0].oldValue), JSON.stringify(logged));
  check('★★★★★ 提醒紀錄唔係放行紀錄（action 唔同）',
    auditLog.every((e) => e.action !== gas.HARD_RELEASE_ACTION), JSON.stringify(auditLog));
  check('★★★★★ 提醒紀錄冇 RELEASED_KEYS（唔會被當成已放行）',
    auditLog.every((e) => String(e.notes || '').indexOf(gas.HARD_RELEASE_KEY_PREFIX) === -1), JSON.stringify(auditLog));
  const C = gas.COLUMNS.AUDIT_LOG;
  const rows = auditLog.map((e) => {
    const r = [];
    r[C.ACTION] = e.action; r[C.TARGET_KEY] = e.targetKey; r[C.NOTES] = e.notes;
    return r;
  });
  check('★★★★★ readReleasedHardViolationKeys_ 唔會把提醒紀錄當放行',
    Object.keys(gas.readReleasedHardViolationKeys_(rows, Q)).length === 0);
}

console.log('\n=== BA4　提醒算唔到 ⇒ 照樣寄出 ===');
{
  const saved = gas.recomputeLatestVersionViolations_;
  gas.recomputeLatestVersionViolations_ = function () { throw new Error('讀唔到版本'); };
  auditLog.length = 0; changedList = [];
  let send = null; let threw = null;
  try { send = gas.apiStep5SendConfirm_locked_(Q, '', null); } catch (e) { threw = e; }
  check('★★★★★ 算唔到提醒唔會令重發拋錯', !threw, threw && threw.message);
  check('★★★★ 照常走落去', send && send.blocked === false, JSON.stringify(send));
  gas.recomputeLatestVersionViolations_ = saved;
}

console.log('\n=== BA5　確認窗資料同畫面：unreleased 黃框 ===');
{
  const g2 = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'HardViolationClass.gs', 'SendWarnings.gs']);
  const cells = [
    HARD({ postId: 'CHAIR', slotIndex: 1 }), HARD({ postId: 'READER', slotIndex: 1, personId: 'P9002' })
  ];
  g2.log_ = function () {};
  g2.buildFineTuneContext_ = function () {
    return { original: [], posts: [{ postId: 'CHAIR', postNameTC: '主席' }, { postId: 'READER', postNameTC: '讀經' }] };
  };
  g2.listGenuineBlankCells_ = function () { return []; };
  g2.findStateViolations_ = function () { return cells; };
  g2.nameOfPersonId_ = function (c, id) { return id; };
  g2.classifySaveConfirmViolations_ = function () { return { real: cells, released: [] }; };
  const w = g2.summariseVersionSendWarnings_(Q, 5);
  check('★★★★ summariseVersionSendWarnings_ 帶 unreleased.count = 2',
    w.unreleased && w.unreleased.count === 2, JSON.stringify(w));
  check('★★★★ unreleased 清單有崗位中文名', w.unreleased.items[0].postNameTC === '主席', JSON.stringify(w.unreleased.items));
  g2.classifySaveConfirmViolations_ = function () { return { real: [], released: cells }; };
  const w2 = g2.summariseVersionSendWarnings_(Q, 5);
  check('★★★★ 全部已放行 ⇒ unreleased.count = 0', w2.unreleased.count === 0 && w2.released.count === 2, JSON.stringify(w2));

  const ui = loadUiScripts(['Script.html', 'ScriptZone1.html']);
  const text = (n) => String(n.textContent || '') + (n.children || []).map(text).join('\n');
  const shown = ui.buildSendWarningNodes(w).map(text).join('\n');
  check('★★★★★ 黃框文字：還未放行、不阻擋、收到的人會見到、先在第 2 步改好再儲存',
    /這一版有 2 格違反一定要遵守的規則，而且還未放行（例如儲存之後改了名單）。這不會阻擋寄出，但收到的人會看到這些安排。要改的話，先在第 2 步改好再儲存。/.test(shown),
    shown);
  check('★★★★ 黃框列出那幾格（主席、讀經）', /主席/.test(shown) && /讀經/.test(shown), shown);
  const compact = ui.buildSendWarningNodes(w, { compact: true }).map(text).join('\n');
  check('★★★★ 狀態卡（compact）不畫未放行黃框', !/還未放行/.test(compact), compact);
  check('★★★★ 冇未放行 ⇒ 冇黃框', ui.buildSendWarningNodes(w2).map(text).join('\n').indexOf('還未放行') === -1);
  const z1 = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'ScriptZone1.html'), 'utf8');
  check('★★★★★ 審閱、正式發出、改動後重發三個確認窗都叫同一支 buildSendWarningNodes',
    (z1.match(/buildSendWarningNodes\((preview|plan)\.sendWarnings\)/g) || []).length === 3);
}

console.log('\n=== BA6　選單版「改動後重發」只提醒 ===');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'FourStageFlow.gs'), 'utf8').replace(/\r/g, '');
  const at = src.indexOf('function runFourStageStep5_locked_');
  const body = src.slice(at, src.indexOf('\nfunction ', at + 10));
  check('★★★★★ runFourStageStep5_locked_ 不再叫 confirmHardViolationOverride_', body.indexOf('confirmHardViolationOverride_') === -1);
  check('★★★★ runFourStageStep5_locked_ 改叫 remindUnreleasedHardViolations_', body.indexOf('remindUnreleasedHardViolations_') !== -1);
  const alerts = [];
  const ui = { alert: function (t, m) { alerts.push(t + '|' + m); }, ButtonSet: { OK: 'OK' } };
  gas.listUnreleasedHardViolations_ = function () { return [HARD()]; };
  auditLog.length = 0;
  const n = gas.remindUnreleasedHardViolations_(ui, Q, '步驟 5：改動後重發', [HARD()]);
  check('★★★★ 有未放行 ⇒ 提醒一次、回 1', n === 1 && alerts.length === 1 && /不會阻擋重發/.test(alerts[0]), alerts.join('\n'));
  check('★★★★ 有寫提醒紀錄', auditLog.some((e) => e.action === gas.HARD_UNRELEASED_AT_SEND_ACTION), JSON.stringify(auditLog));
}

console.log('\n=== BA7　前端防衛訊息冇舊名 ===');
{
  const z1 = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'ScriptZone1.html'), 'utf8');
  const at = z1.indexOf('async function resendGeneratePdfsThenSend');
  const seg = z1.slice(at, at + 9000);
  check('★★★★★ resendGeneratePdfsThenSend 沒有「儲存並確認」', seg.indexOf('儲存並確認') === -1);
  const at2 = z1.indexOf("callServerMutating('apiStep5SendConfirm'");
  check('★★★★★ 寄送後 blocked 防衛沒有「儲存並確認」', z1.slice(at2, at2 + 600).indexOf('儲存並確認') === -1);
}

console.log(fail === 0 ? '\nALL PASS' : '\n' + fail + ' FAIL');
process.exitCode = fail === 0 ? 0 : 1;

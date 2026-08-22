// 第四十七輪批次 B 組：確認窗講「會寄給這 3 位」，完成窗講「模擬 9 封」。
// 執行方式：node tests/preview_matches_send.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場
// ═════════════════════════════════════════════════════════════════════
//
// 同一次操作，兩個畫面前後腳出現：
//
//     寄給堂委審閱
//     會寄給這 3 位
//
//     寄給堂委審閱：完成
//     寄出 0 封　模擬 9 封　查無電郵略過 0 位
//
// **3 ≠ 9。**
//
// 成因唔係其中一個數字算錯，而係**同一件事有兩個算法**：
//
//   確認窗　`planStep2_()` → `countReviewerRecipients_()`
//           ⇒ 只數 `EmailRecipients` 上 `Role=REVIEWER` 而且 `Active=TRUE`
//   完成窗　`executeStep2_()` → `sendStage()`
//           ⇒ 第四十六輪新做嘅收件人池（`SendRecipients.gs`）
//
// 即係：**第四十六輪把「實際寄給誰」重做咗，但冇一併改
// 「事前告訴幹事會寄給誰」。**
//
// ─────────────────────────────────────────────────────────────────────
// ⚠️ 點解 `e2e_five_stage_flow.test.js` 捉唔到
// ─────────────────────────────────────────────────────────────────────
//
// 因為佢**冇傳 `sendOptions`**。冇傳嘅時候兩個算法啱啱好都退回
// `listRecipients_()`，所以兩個數字一樣。
//
// 而 Ivan 現場係經幹事介面撳嘅——第四十六輪之後嗰個彈窗一律傳
// `recipientScope: 'PICK'`。**兩個算法就係喺呢一種情況下先至分家。**
//
// 所以呢一份專門造嗰一種：**傳 `PICK`**。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 600));
}

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'QuarterStage.gs', 'Roles.gs',
  'WebAppGuards.gs', 'SendOptions.gs', 'MailRedirect.gs',
  // `isReviewerRecipientRow_()` 喺呢度（`listRecipients_()` 嘅 REVIEW 分支會叫）。
  'EmailRecipientsSeed.gs',
  // `resolveResendTargetPersonIds_()` 喺呢度——事前預覽同真正寄出
  // 行同一個，所以呢份測試兩邊都要載入。
  'SendRecipients.gs', 'Mailer.gs', 'ResendFlow.gs', 'FiveStageCore.gs'
]);

const TZ = 'Pacific/Auckland';
const Q = '2027T3';

/**
 * 一份現況，刻意造到**兩個算法一定會出唔同答案**：
 *
 *   `EmailRecipients`　　　　3 個審閱者地址　　← 舊算法只數呢 3 個
 *   這一季有服侍　　　　　　5 位
 *   一個冇服侍嘅堂委　　　　1 位
 *   ⇒ 收件人池 ＝ 3 ＋ 5 ＋ 1 ＝ 9
 *
 * 3 同 9——同 Ivan 現場見到嗰兩個數字一模一樣。
 */
function setup() {
  const people = {};
  ['P9001', 'P9002', 'P9003', 'P9004', 'P9005'].forEach(function (id, i) {
    people[id] = { personId: id, nameTC: '測試' + '甲乙丙丁戊'.charAt(i),
      email: id.toLowerCase() + '@example.invalid' };
  });
  people.P9006 = { personId: 'P9006', nameTC: '測試己',
    email: 'p9006@example.invalid' };

  const assignmentsByPerson = {};
  ['P9001', 'P9002', 'P9003', 'P9004', 'P9005'].forEach(function (id) {
    assignmentsByPerson[id] = [{}];
  });

  gas.readRolesSafe_ = function () {
    // P9006 係堂委而呢一季一格都冇服侍——舊算法完全睇唔到佢。
    return [{ personId: 'P9006', roleCode: 'COMMITTEE',
      effectiveFrom: '', effectiveTo: '' }];
  };
  gas.Utilities = { formatDate: function () { return '2027-10-01'; } };
  gas.getConfig = function (key, d) {
    if (key === gas.CONFIG_KEYS.DRY_RUN) return true;
    return d;
  };
  gas.readSheet = function (name) {
    if (name === gas.SHEETS.EMAIL_RECIPIENTS) {
      const R = gas.COLUMNS.EMAIL_RECIPIENTS;
      return ['r1', 'r2', 'r3'].map(function (n) {
        const row = {};
        row[R.ACTIVE] = true;
        row[R.EMAIL] = n + '@example.invalid';
        row[R.DISPLAY_NAME] = '堂委' + n;
        row[R.SEND_AS] = 'TO';
        row[R.STAGE] = 'REVIEW';
        row[R.ROLE] = 'REVIEWER';
        return row;
      });
    }
    return [];
  };
  gas.resolveStageTemplates_ = function () {
    return { person: { attachType: 'FULL_PDF' }, list: { attachType: 'FULL_PDF' } };
  };
  gas.findLatestVersionNo = function () { return 5; };
  gas.requireQuarterStage_ = function () {};
  gas.countAlreadySentForStage_ = function () { return 0; };
  gas.countReviewerRecipients_ = function () { return 3; };
  gas.buildMailContext_ = function (quarterId, versionNo, stage) {
    return {
      quarterId: quarterId, versionNo: versionNo, stage: stage, timezone: TZ,
      peopleById: people,
      assignmentsByPerson: assignmentsByPerson,
      lastHashByPerson: {},
      notifyReasonByPerson: {}
    };
  };
}

/** 幹事喺寄出彈窗做嘅決定：勾晒池入面全部人（第四十六輪之後嘅預設路）。 */
function pickEveryone() {
  const context = gas.buildMailContext_(Q, 5, gas.MAIL_STAGES.REVIEW);
  const pool = gas.buildSendRecipientPool_(context, TZ);
  return {
    recipientScope: 'PICK',
    pickedKeys: pool.map(function (p) { return p.key; }),
    attachType: 'NONE',
    includeIcs: false
  };
}

// =====================================================================
console.log('\n=== B【重現】舊算法同新算法喺 `PICK` 之下一定分家 ===');
{
  setup();
  const opts = pickEveryone();

  const oldWay = gas.countReviewerRecipients_();
  const actual = gas.resolveActualRecipients_(
    Q, 5, gas.MAIL_STAGES.REVIEW, opts).length;

  check('★★★★★ （前置）舊算法數到 3——就係 Ivan 見到嗰個「這 3 位」',
    oldWay === 3, String(oldWay));
  check('★★★★★ （前置）而真正會寄嘅係 9——就係佢見到嗰個「模擬 9 封」',
    actual === 9, String(actual));
  check('★★★★★★ **兩者真係唔同**'
    + '——冇呢一條，下面全部斷言都可以喺一個「兩邊啱啱好一樣」'
    + '嘅假情境入面綠燈',
    oldWay !== actual, oldWay + ' vs ' + actual);
}

// =====================================================================
console.log('\n=== B1【核心】步驟 2 嘅事前數字 ＝ 真正會寄嗰一份 ===');
{
  setup();
  const opts = pickEveryone();
  const plan = gas.planStep2_(Q, opts);
  const actual = gas.resolveActualRecipients_(
    Q, 5, gas.MAIL_STAGES.REVIEW, opts);

  check('★★★★★★ `planStep2_()` 報嘅數 ＝ 真正會寄嘅數'
    + '——現場就係 3 對住 9',
    plan.recipientCount === actual.length,
    '事前 ' + plan.recipientCount + '；實際 ' + actual.length);
  check('★★★★★★ 而且**唔再係** `countReviewerRecipients_()` 嗰個 3',
    plan.recipientCount !== 3, String(plan.recipientCount));
  check('★★★★★ 冇傳 `sendOptions` 嗰陣照樣對得上'
    + '——舊呼叫端（選單、彩排）一個字都冇改過',
    gas.planStep2_(Q).recipientCount
      === gas.resolveActualRecipients_(Q, 5, gas.MAIL_STAGES.REVIEW).length, '');
}

// =====================================================================
console.log('\n=== B2 步驟 4：查過，**本來有同一個問題**，已經一併收攏 ===');
{
  setup();
  const opts = pickEveryone();
  const plan = gas.planStep4SendPreview_(Q, 5, opts);
  const actual = gas.resolveActualRecipients_(
    Q, 5, gas.MAIL_STAGES.OFFICIAL, opts);

  check('★★★★★★ 步驟 4 嘅事前數字 ＝ 真正會寄嘅數'
    + '——本來係 `listRecipients_(OFFICIAL, …)`，完全唔理 `sendOptions`',
    plan.recipientCount === actual.length,
    '事前 ' + plan.recipientCount + '；實際 ' + actual.length);
  check('★★★★★ 而且個數字真係受 `sendOptions` 影響'
    + '（唔受影響嘅話，上面嗰條可以喺一個巧合下綠燈）',
    gas.planStep4SendPreview_(Q, 5, {
      recipientScope: 'PICK', pickedKeys: ['P9001'],
      attachType: 'NONE', includeIcs: false
    }).recipientCount === 1, '');
}

// =====================================================================
console.log('\n=== B2 步驟 5：查過，**本來都有**，只係形狀唔同 ===');
{
  setup();
  const context = gas.buildMailContext_(Q, 5, gas.MAIL_STAGES.RESEND);
  const changedList = [
    { personId: 'P9001', nameTC: '測試甲', hasAssignments: true },
    { personId: 'P9002', nameTC: '測試乙', hasAssignments: true }
  ];
  const opts = {
    recipientScope: 'PICK', pickedKeys: ['P9001', 'P9002', 'P9006'],
    attachType: 'NONE', includeIcs: false
  };
  const plan = gas.planStep5SendPreview_(Q, 5, context, changedList, opts);

  check('★★★★★★ 有一個**總數**（本來只有「有改動嘅人」同「名單收件人」兩個分開嘅數）'
    + '——兩個加埋唔一定等於實際寄出：'
    + '幹事可以勾一個唔喺「有改動」名單入面嘅人',
    typeof plan.recipientCount === 'number', JSON.stringify(plan.recipientCount));
  check('★★★★★★ 而且勾咗一個唔喺「有改動」名單入面嘅人（P9006）'
    + '要計埋落個總數',
    plan.recipientCount === 3,
    '總數 ' + plan.recipientCount + '；有改動 ' + changedList.length);
  check('★★★★ 「有改動嘅人」個數字仍然照報（兩樣都要有）',
    plan.changedList.length === 2, JSON.stringify(plan.changedList.length));
}

// =====================================================================
console.log('\n=== B 事前預覽**唔可以**改到寄信嗰段會讀嘅狀態 ===');
{
  setup();
  const context = gas.buildMailContext_(Q, 5, gas.MAIL_STAGES.RESEND);
  const opts = { recipientScope: 'ALL', attachType: 'NONE', includeIcs: false };
  gas.planStep5SendPreview_(Q, 5, context,
    [{ personId: 'P9001', nameTC: '測試甲', hasAssignments: true }], opts);

  check('★★★★★★ 跑完預覽之後 `notifyReasonByPerson` 仍然係空'
    + '——嗰個係 `deliverOne_()` 會讀嘅狀態。'
    + '預覽順手寫落去，就等於「睇一眼」改變咗「做出嚟」嘅結果',
    Object.keys(context.notifyReasonByPerson).length === 0,
    JSON.stringify(context.notifyReasonByPerson));
}

// =====================================================================
console.log('\n=== B1 只有一個解析器（唔准喺 plan 嗰邊順手數多次）===');
{
  const core = read('src/FiveStageCore.gs')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('★★★★★★ `planStep2_()` 唔再叫 `countReviewerRecipients_()`',
    core.indexOf('countReviewerRecipients_()') === -1, '');
  check('★★★★★ 三個 plan 全部行 `resolveActualRecipients*_()`',
    (core.match(/resolveActualRecipients/g) || []).length >= 3, '');
  check('★★★★★ 而且冇一個 plan 自己叫 `listRecipients_()`'
    + '——順手數一次就係多一個分岔點',
    core.indexOf('listRecipients_(') === -1, '');
}

// =====================================================================
console.log('\n=== B3 名單要同解析器回嗰一份係同一批物件 ===');
{
  setup();
  const opts = pickEveryone();
  const plan = gas.planStep2_(Q, opts);
  check('★★★★★★ 確認窗有名單，唔淨係一個數字'
    + '——第四十四輪 B 組已經定過「講明係邊個」，'
    + '而確認窗一直只講「這 3 位」，一個名都冇',
    plan.recipientPreview && plan.recipientPreview.total === plan.recipientCount,
    JSON.stringify(plan.recipientPreview && plan.recipientPreview.total));
  check('★★★★★ 超過 12 位就列頭 12 位 ＋「另外還有 N 位」',
    plan.recipientPreview.shown.length === 9
    && plan.recipientPreview.moreCount === 0, JSON.stringify({
      shown: plan.recipientPreview.shown.length,
      more: plan.recipientPreview.moreCount
    }));

  const many = gas.summariseRecipientsForPreview_(
    Array.from({ length: 20 }, function (_x, i) {
      return { type: 'PERSON', personId: 'P' + i, displayName: '人' + i,
        email: 'p' + i + '@example.invalid' };
    }));
  check('★★★★★ 20 位 ⇒ 列 12 位 ＋ 另外 8 位',
    many.shown.length === 12 && many.moreCount === 8, JSON.stringify(many.moreCount));
  check('★★★★★ 而且**整份都帶埋**，令〔全部列出〕唔使再打一次伺服器'
    + '——再打一次，兩次之間資料有機會唔同，'
    + '而幹事會見到一份同上面個數字對唔上嘅名單',
    many.all.length === 20, String(many.all.length));

  check('★★★★★ 電郵遮一半，但仍然分得出邊個係邊個',
    gas.maskEmailForPreview_('ivan@example.invalid') === 'i***@example.invalid',
    gas.maskEmailForPreview_('ivan@example.invalid'));
  check('★★★★ 冇電郵 ⇒ 空字串（唔會出一個 `***@` 嘅假地址）',
    gas.maskEmailForPreview_('') === '');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);

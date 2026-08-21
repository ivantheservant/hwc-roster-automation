// 第四十輪批次 A 組：寄出彈窗嗰三個決定。
// 執行方式：node tests/send_options.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 呢一份守住咩
// ═════════════════════════════════════════════════════════════════════
//
// 呢一輪改咗**寄信路徑本身**——一條上星期先修好兩個 bug 嘅路。
// 所以呢一份守嘅第一件事，唔係新功能，係：
//
//   ⚠️ **幹事乜都唔揀嘅時候，行為要同今日一模一樣。**
//
// 落面第一節就係逐項對住「今日嘅預設值」比。一有分別即刻紅。
//
// 第二件事係方法：`deliverOne_()` **唔可以**再自己判斷一次。
// 三個決定一律喺 `resolveSendOptions_()` 解析完，落到下游已經係結論。
// 第三十三、三十八輪連續喺呢條路上修過兩個「下游自己重新判斷」嘅 bug。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs',
  // 三段式錯誤訊息喺呢度（buildThreePartMessage_）。
  'WebAppGuards.gs',
  'SendOptions.gs'
]);

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 400));
}
function checkEqual(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}

const SRC = path.join(__dirname, '..', 'src');
const mailer = fs.readFileSync(path.join(SRC, 'Mailer.gs'), 'utf8');
const resend = fs.readFileSync(path.join(SRC, 'ResendFlow.gs'), 'utf8');

/** 照住現時七個範本嘅 AttachType。 */
const TPL = {
  REVIEW: { person: { attachType: 'FULL_PDF' }, list: null },
  OFFICIAL: { person: { attachType: 'PERSONAL_PDF' }, list: { attachType: 'FULL_PDF' } },
  RESEND: { person: { attachType: 'PERSONAL_PDF' }, list: { attachType: 'FULL_PDF' } },
  GENERATE: { person: { attachType: 'FULL_PDF' }, list: null },
  REMIND: { person: { attachType: 'NONE' }, list: null }
};

// =====================================================================
console.log('\n=== A【核心】乜都唔揀 ⇒ 行為同今日一模一樣 ===');
{
  // ⚠️ 呢一節係整份最重要嘅。改壞咗，幹事乜都唔揀撳落去就會
  // 寄咗一啲佢冇預期嘅嘢——而佢冇任何方法睇得出。
  const EXPECT = {
    REVIEW: { recipientScope: 'ALL', attachType: 'FULL_PDF', includeIcs: false },
    OFFICIAL: { recipientScope: 'ALL', attachType: 'PERSONAL_PDF', includeIcs: true },
    RESEND: { recipientScope: 'CHANGED_ONLY', attachType: 'PERSONAL_PDF', includeIcs: true },
    GENERATE: { recipientScope: 'ALL', attachType: 'FULL_PDF', includeIcs: false },
    REMIND: { recipientScope: 'ALL', attachType: 'NONE', includeIcs: false }
  };

  Object.keys(EXPECT).forEach(function (stage) {
    // 三種「乜都冇傳」嘅寫法都要一樣。
    [undefined, null, {}].forEach(function (nothing) {
      const d = gas.resolveSendOptions_(stage, nothing, TPL[stage]);
      checkEqual('★★★★★ ' + stage + '（傳 ' + JSON.stringify(nothing) + '）'
        + ' ⇒ 收件範圍／附件／日曆檔全部同今日一樣',
        {
          recipientScope: d.recipientScope,
          attachType: d.attachType,
          includeIcs: d.includeIcs
        }, EXPECT[stage]);
    });
  });

  // ★ 而且要分得出「佢冇揀」同「佢揀咗一個啱啱好一樣嘅值」。
  const notPicked = gas.resolveSendOptions_('OFFICIAL', {}, TPL.OFFICIAL);
  const pickedSame = gas.resolveSendOptions_('OFFICIAL',
    { recipientScope: 'ALL', attachType: 'PERSONAL_PDF', includeIcs: true }, TPL.OFFICIAL);
  checkEqual('★★★★★ 冇揀 ⇒ overridden 全部 false', notPicked.overridden,
    { scope: false, attachType: false, includeIcs: false });
  checkEqual('★★★★★ 揀咗一個一樣嘅值 ⇒ overridden 全部 true'
    + '（AuditLog 要分得出「系統預設」同「幹事親手揀過」——'
    + '日後查「點解嗰次係噉」嗰陣，呢個分別好重要）',
    pickedSame.overridden, { scope: true, attachType: true, includeIcs: true });
  checkEqual('★★★★ 但結論一樣', pickedSame.attachType, notPicked.attachType);
}

console.log('\n=== A：亂噏嘅值當成「冇揀」，唔可以拋錯或者靜靜變另一樣嘢 ===');
{
  const d = gas.resolveSendOptions_('OFFICIAL',
    { recipientScope: '亂噏', attachType: 'PDF', includeIcs: '係' }, TPL.OFFICIAL);
  checkEqual('★★★★★ 認唔出嘅收件範圍 ⇒ 退回該階段嘅預設', d.recipientScope, 'ALL');
  checkEqual('★★★★★ 認唔出嘅附件類型 ⇒ 退回範本嗰一欄'
    + '（`PDF` 唔係一個合法值——`FULL_PDF` 先係）', d.attachType, 'PERSONAL_PDF');
  checkEqual('★★★★★ `includeIcs` 唔係布林 ⇒ 退回自動判斷'
    + '（`\'係\'` 呢個字串係 truthy，直接當 true 就會靜靜開咗一樣佢冇揀嘅嘢）',
    d.includeIcs, true);
  checkEqual('★★★★ 而且 overridden 要照實講「佢冇揀到」',
    d.overridden, { scope: false, attachType: false, includeIcs: false });
}

// =====================================================================
console.log('\n=== A：揀「自己揀」但一個都冇揀 ⇒ 拋錯 ===');
{
  let threw = null;
  try {
    gas.resolveSendOptions_('OFFICIAL',
      { recipientScope: 'PICK', pickedKeys: [] }, TPL.OFFICIAL);
  } catch (e) { threw = e; }
  check('★★★★★ 真係拋錯，**唔會靜靜當成寄全部**'
    + '——靜靜寄全部係最壞嘅結果：佢以為淨係寄俾三個人，實際上成班人收到',
    threw !== null);
  check('★★★★ 而且明確講「一封都冇寄出」',
    threw && threw.message.indexOf('一封都沒有寄出') !== -1, threw && threw.message);
}

console.log('\n=== A：收件範圍點篩 ===');
{
  const R = [
    { type: 'PERSON', personId: 'P9001', email: 'a@example.invalid' },
    { type: 'PERSON', personId: 'P9002', email: 'b@example.invalid' },
    { type: 'LIST', personId: '', email: 'Board@Example.Invalid' }
  ];

  const all = gas.resolveSendOptions_('OFFICIAL', {}, TPL.OFFICIAL);
  checkEqual('★★★★★ ALL ⇒ 一個都唔篩（＝今日嘅行為）',
    gas.filterRecipientsByScope_(R, all).length, 3);

  const pick = gas.resolveSendOptions_('OFFICIAL',
    { recipientScope: 'PICK', pickedKeys: ['P9002'] }, TPL.OFFICIAL);
  checkEqual('★★★★★ PICK ⇒ 淨係揀咗嗰個',
    gas.filterRecipientsByScope_(R, pick).map(function (r) { return r.personId; }), ['P9002']);

  // ⚠️ REVIEW 階段**只有 LIST 收件人**（堂委名單），佢哋冇 PersonID。
  // 淨係用 PersonID 做鍵嘅話，喺 REVIEW 揀「自己揀」會一個人都揀唔到，
  // 而個彈窗睇落完全正常。
  checkEqual('★★★★★ LIST 收件人嘅鍵用電郵（而且大細楷唔敏感）',
    gas.sendRecipientKey_(R[2]), 'LIST:board@example.invalid');
  const pickList = gas.resolveSendOptions_('REVIEW',
    { recipientScope: 'PICK', pickedKeys: ['LIST:board@example.invalid'] }, TPL.REVIEW);
  checkEqual('★★★★★ 所以喺 REVIEW 揀得到堂委',
    gas.filterRecipientsByScope_(R, pickList).map(function (r) { return r.email; }),
    ['Board@Example.Invalid']);
}

console.log('\n=== A：LIST 收件人嗰個範本 ===');
{
  const none = gas.resolveSendOptions_('OFFICIAL', {}, TPL.OFFICIAL);
  checkEqual('★★★★★ 幹事冇改 ⇒ LIST 用返 LIST 範本嗰一欄（＝今日嘅行為）',
    none.listAttachType, 'FULL_PDF');
  const forced = gas.resolveSendOptions_('OFFICIAL',
    { attachType: 'NONE' }, TPL.OFFICIAL);
  checkEqual('★★★★★ 幹事改咗 ⇒ 兩邊都跟佢揀嗰個'
    + '（佢揀「不附」就係唔想任何人收到附件）', forced.listAttachType, 'NONE');
}

// =====================================================================
console.log('\n=== A【核心】`.ics` 嘅預設要同真正嗰道閘一致 ===');
{
  // ⚠️ 兩邊講唔同嘅話，彈窗上寫住「會附日曆檔」而實際上冇附，
  // 而幹事冇任何方法睇得出。
  const ics = fs.readFileSync(path.join(SRC, 'IcsExport.gs'), 'utf8');
  const guard = ics.slice(ics.indexOf('function buildIcsAttachmentForPerson_'));
  check('★★★★★ `buildIcsAttachmentForPerson_()` 嗰道閘仍然係「OFFICIAL 或 RESEND」',
    /context\.stage !== MAIL_STAGES\.OFFICIAL && context\.stage !== MAIL_STAGES\.RESEND/
      .test(guard.slice(0, 500)), guard.slice(0, 300));
  checkEqual('★★★★★ 而 `icsDefaultForStage_()` 講同一句',
    ['REVIEW', 'OFFICIAL', 'RESEND', 'GENERATE', 'REMIND']
      .map(function (st) { return st + '=' + gas.icsDefaultForStage_(st); }),
    ['REVIEW=false', 'OFFICIAL=true', 'RESEND=true', 'GENERATE=false', 'REMIND=false']);
}

// =====================================================================
console.log('\n=== A【核心】`deliverOne_()` 唔可以自己再判斷一次 ===');
{
  const body = mailer.slice(mailer.indexOf('function deliverOne_'),
    mailer.indexOf('function sendRealEmail_'));
  const bare = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  check('★★★★★ 附唔附日曆檔係讀上游嘅結論，唔係喺呢度按階段判斷',
    /context\.sendDecision\s*\n?\s*\?\s*context\.sendDecision\.includeIcs/.test(bare), bare.slice(0, 400));
  check('★★★★★ 而且**冇**喺 deliverOne_ 入面再寫一次「OFFICIAL 或 RESEND」嗰個判斷'
    + '——寫多一次就係兩個真相來源，改一個另一個唔會跟',
    !/MAIL_STAGES\.OFFICIAL[\s\S]{0,80}MAIL_STAGES\.RESEND/.test(bare), bare.slice(0, 400));

  const attachBody = mailer.slice(mailer.indexOf('function generateMailAttachment_'),
    mailer.indexOf('function lookupExistingPersonalPdf_'));
  check('★★★★★ 附件類型一樣係讀上游嘅結論',
    /const d = context\.sendDecision;/.test(attachBody), attachBody.slice(0, 300));
  check('★★★★★ 冇決定先退回範本嗰一欄（＝舊呼叫端／今日嘅行為）',
    /: template\.attachType;/.test(attachBody), attachBody.slice(0, 400));
}

console.log('\n=== A：收件範圍嘅決定要喺上游做 ===');
{
  const body = resend.slice(resend.indexOf('function sendResendStage_'));
  const before = body.indexOf('SEND_RECIPIENT_SCOPE.ALL');
  // ⚠️ 要搵**真正嘅呼叫**：上面嘅註解已經提過 deliverOne_ 好幾次，
  //  搵中註解就會量錯次序，而個測試會指住一段註解話你知有 bug。
  const firstDeliver = body.indexOf('outcomes.push(deliverOne_(');
  check('★★★★★ RESEND 嘅收件範圍喺 `deliverOne_()` **之前**就算好'
    + '——落咗去先篩就變返第三十三輪嗰個 bug（下游自己重新判斷要唔要寄）',
    before !== -1 && firstDeliver !== -1 && before < firstDeliver,
    'scope@' + before + ' deliver@' + firstDeliver);
  check('★★★★★ 揀「全部人」嗰陣要俾每個人一個理由'
    + '——唔俾嘅話 `deliverOne_()` 嗰個 hash 保險絲會把「內容冇變」嗰啲擋走，'
    + '而幹事明明揀咗「全部人」',
    /notifyReasonByPerson\[id\] = '幹事選擇寄給全部人'/.test(body), '');
  check('★★★★ 揀咗一個唔喺「有改動」名單入面嘅人 ⇒ 照樣寄俾佢',
    /notifyReasonByPerson\[key\] = '幹事指定要寄給這一位'/.test(body), '');
}

// =====================================================================
console.log('\n=== A：今次用咗咩選項一定要記低 ===');
{
  const d = gas.resolveSendOptions_('OFFICIAL',
    { recipientScope: 'PICK', pickedKeys: ['P9001', 'P9002'], attachType: 'NONE', includeIcs: false },
    TPL.OFFICIAL);
  const text = gas.describeSendDecision_(d);
  check('★★★★ 講得出收件範圍同人數', text.indexOf('自己揀（2 位）') !== -1, text);
  check('★★★★ 講得出附件類型', text.indexOf('不附') !== -1, text);
  check('★★★★ 講得出有冇日曆檔', text.indexOf('日曆檔=冇') !== -1, text);
  check('★★★★★ 而且標明邊幾項係幹事親手改嘅'
    + '——`EmailTemplates` 嗰一欄係當時嘅值，幹事可能今次覆寫過；'
    + '唔標明就查唔到「點解嗰次冇附件」',
    (text.match(/（幹事改過）/g) || []).length === 3, text);

  check('★★★★★ `sendStage()` 會把佢寫入 AuditLog（自由文字，一定寫得入）',
    /describeSendDecision_\(context\.sendDecision\)/.test(mailer), '');
  check('★★★★★ `sendResendStage_()` 一樣',
    /describeSendDecision_\(context\.sendDecision\)/.test(resend), '');
  check('★★★★★ SendLog 冇嗰一欄嗰陣會嘈一句 WARN'
    + '——`headers.map()` 會靜靜略過佢，而「靜靜略過」正正係呢個專案一直喺度殺嗰個',
    /headers\.indexOf\(COLUMNS\.SEND_LOG\.SEND_OPTIONS\) === -1/.test(mailer), '');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);

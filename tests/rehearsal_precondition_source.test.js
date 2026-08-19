// 第三十一輪批次階段 B2／B3：前置條件單一真相來源、`fileUrl` 欄名。
// 執行方式：node tests/rehearsal_precondition_source.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 實測（2027T4 全季流程演練報告）
// ─────────────────────────────────────────────────────────────────────
//
//   步驟 1：生成初稿　　　Stage 要係 DRAFT，實際係 REVIEW_SENT　⚠️ 不符合
//   步驟 2：寄給堂委審閱　Stage 要係 DRAFT，實際係 REVIEW_SENT　⚠️ 不符合
//
// **但兩步都成功。** 因為演練工具自己寫咗一套前置條件，同真正嘅閘門
// 完全冇關係——步驟 1 根本冇 Stage 限制，步驟 2 早就放寬到三個 Stage。
//
// ⚠️ 一個講錯嘅前置條件，比冇前置條件更差：佢會令人去查一件冇發生嘅事。
//
// 修法：`FiveStageCore.gs` 加 `describeFlowStepPrecondition_()`，
// 兩邊共用同一份 `FLOW_STEP_ALLOWED_STAGES_`。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}
function checkEqual(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}  expected=${JSON.stringify(expected)}`);
}

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

function loadWithStage(stage) {
  const gas = loadGasSource([
    'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'FiveStageCore.gs'
  ]);
  gas.getQuarterStage_ = function () { return stage; };
  return gas;
}

/* ══════════════════════════════════════════════════════════════
 * B2-1　`describeFlowStepPrecondition_()` 講嘅嘢同閘門一致
 * ══════════════════════════════════════════════════════════════ */

console.log('\n=== B2【核心】步驟 1 真係冇 Stage 限制，唔可以話「要係 DRAFT」===');
{
  const gas = loadWithStage('REVIEW_SENT');
  const pre = gas.describeFlowStepPrecondition_(gas.FLOW_STEP_KEYS.GENERATE, '2027T4');

  check('★★★★★ **`met` 係 true**——實測嗰陣兩步都成功，'
    + '而舊版報告寫住 ⚠️ 不符合', pre.met === true, JSON.stringify(pre));
  check('★★★★★ 而且明講「沒有 Stage 限制」，唔會扮成有',
    pre.text.indexOf('沒有 Stage 限制') !== -1, pre.text);
  check('★★★★★ 唔會再出現「要係 DRAFT」呢句錯嘢',
    pre.text.indexOf('DRAFT') === -1, pre.text);
}

console.log('\n=== B2【核心】步驟 2 嘅三個 Stage 全部照認 ===');
{
  // `STEP2_ALLOWED_STAGES_` 早就放寬到三個。演練工具寫死 DRAFT，
  // 所以 `REVIEW_SENT` 會被錯報成不符合。
  ['DRAFT', 'REVIEW_SENT', 'REQUESTS_APPLIED'].forEach(function (stage) {
    const gas = loadWithStage(stage);
    const pre = gas.describeFlowStepPrecondition_(gas.FLOW_STEP_KEYS.REVIEW_SEND, '2027T4');
    check('★★★★★ Stage ＝ ' + stage + ' ⇒ 符合（實測就係喺 REVIEW_SENT 成功寄咗）',
      pre.met === true, JSON.stringify(pre));
  });

  const gas = loadWithStage('OFFICIAL_SENT');
  const pre = gas.describeFlowStepPrecondition_(gas.FLOW_STEP_KEYS.REVIEW_SEND, '2027T4');
  check('★★★★★ 而 `OFFICIAL_SENT` 真係唔符合——'
    + '放寬唔等於乜都當啱，否則呢個欄位就變咗一句廢話',
    pre.met === false, JSON.stringify(pre));
  check('★★★★ 而且講得出實際係咩 Stage',
    pre.text.indexOf('OFFICIAL_SENT') !== -1, pre.text);
}

console.log('\n=== B2 步驟 3／4／5 嘅單一 Stage 照樣講得準 ===');
{
  const cases = [
    ['SAVE_CONFIRM', 'REVIEW_SENT', 'DRAFT'],
    ['OFFICIAL_SEND', 'REQUESTS_APPLIED', 'REVIEW_SENT'],
    ['RESEND', 'OFFICIAL_SENT', 'REQUESTS_APPLIED']
  ];
  cases.forEach(function (c) {
    const good = loadWithStage(c[1]);
    checkEqual('★★★★★ ' + c[0] + ' 喺 ' + c[1] + ' ⇒ 符合',
      good.describeFlowStepPrecondition_(good.FLOW_STEP_KEYS[c[0]], '2027T4').met, true);
    const bad = loadWithStage(c[2]);
    const preBad = bad.describeFlowStepPrecondition_(bad.FLOW_STEP_KEYS[c[0]], '2027T4');
    checkEqual('★★★★★ ' + c[0] + ' 喺 ' + c[2] + ' ⇒ 不符合', preBad.met, false);
    check('★★★★ 而且提示「下面的失敗很可能是連鎖」',
      preBad.text.indexOf('連鎖') !== -1, preBad.text);
  });
}

console.log('\n=== B2【核心】查唔到 Stage ⇒ 唔可以當成符合 ===');
{
  const gas = loadGasSource([
    'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'FiveStageCore.gs'
  ]);
  gas.getQuarterStage_ = function () { throw new Error('讀不到 Quarters'); };
  const pre = gas.describeFlowStepPrecondition_(gas.FLOW_STEP_KEYS.OFFICIAL_SEND, '2027T4');
  check('★★★★★ **`met` 唔可以係 true**'
    + '——「查不到」同「查到係啱」係兩件事，'
    + '而呢個專案已經因為呢個 bug class 燒過好幾次',
    pre.met === false, JSON.stringify(pre));
  check('★★★★ 而且講得出係查唔到，唔係報一個似模似樣嘅 Stage',
    pre.text.indexOf('查不到') !== -1, pre.text);
}

/* ══════════════════════════════════════════════════════════════
 * B2-2　真．單一真相來源：改咗閘門，演練工具嘅描述要跟住變
 * ══════════════════════════════════════════════════════════════ */

console.log('\n=== B2【最重要】兩邊真係讀同一份常數 ===');
{
  const core = read('src/FiveStageCore.gs');
  function stripComments(s) {
    return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  }
  const bare = stripComments(core);

  check('★★★★★ `FLOW_STEP_ALLOWED_STAGES_` 嘅步驟 2 直接引用 `STEP2_ALLOWED_STAGES_`'
    + '——抄一份數值落去就等於留返兩個真相來源',
    /REVIEW_SEND:\s*STEP2_ALLOWED_STAGES_/.test(bare), bare.slice(0, 100));
  check('★★★★★ 步驟 4／5 一樣引用常數',
    /OFFICIAL_SEND:\s*STEP4_ALLOWED_STAGES_/.test(bare)
    && /RESEND:\s*STEP5_ALLOWED_STAGES_/.test(bare));
  check('★★★★★ 而閘門本身（`requireQuarterStage_` 嗰啲呼叫）都係用同一批常數，'
    + '冇一個仲寫住 inline 陣列',
    !/requireQuarterStage_\([^,]+,\s*\[QUARTER_STAGE\./.test(bare));

  // 真正嘅回歸保護：改一改常數，描述要跟住變。
  const gas = loadWithStage('DRAFT');
  gas.STEP4_ALLOWED_STAGES_ = ['DRAFT'];
  gas.FLOW_STEP_ALLOWED_STAGES_.OFFICIAL_SEND = gas.STEP4_ALLOWED_STAGES_;
  const pre = gas.describeFlowStepPrecondition_(gas.FLOW_STEP_KEYS.OFFICIAL_SEND, '2027T4');
  check('★★★★★ 把允許 Stage 改成 DRAFT 之後，描述立即跟住講 DRAFT 而且符合'
    + '——描述唔係另寫嘅一段字',
    pre.met === true && pre.text.indexOf('DRAFT') !== -1, JSON.stringify(pre));
}

/* ══════════════════════════════════════════════════════════════
 * B3　`publishPublicRoster_()` 回嘅係 `fileUrl`，唔係 `url`
 * ══════════════════════════════════════════════════════════════ */

console.log('\n=== B3【核心】公開連結欄名讀啱 ===');
{
  const pub = read('src/PublicRoster.gs');
  // ⚠️ 一定要先剝走註解。解釋「唔可以寫 pub 加 .url」嗰段註解本身
  // 就會被下面條掃描捉到——呢個陷阱今個專案已經踩過八次。
  const src = read('src/SeasonRehearsal.gs')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  check('★★★★★ `publishPublicRoster_()` 回嘅欄名的確係 `fileUrl`',
    /return \{[^}]*fileUrl[^}]*\}/.test(pub.replace(/\n/g, ' ')), '（睇 PublicRoster.gs）');
  check('★★★★★ 演練工具讀 `pub.fileUrl`',
    /pub\.fileUrl/.test(src));
  check('★★★★★ **而且冇任何地方仲讀 `pub.url`**'
    + '——讀一個唔存在嘅欄名唔會拋錯，只會靜靜得出 undefined，'
    + '然後每次都印「（回傳沒有連結）」，令人以為發佈失敗咗（其實成功）',
    !/pub\s*&&\s*pub\.url\b/.test(src) && !/\bpub\.url\b/.test(src));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);

// 第七十輪批次 AY 組：畫面文字。
// 執行方式：node tests/screen_text_wording.test.js
//
//   AY1　「不在 Eligibility 名單內」→「不在這個崗位的名單上」（FineTune／Verify／其他畫面文字）
//   AY2　沒有改動時撳〔儲存〕，彈窗標題「儲存並確認」→「儲存」（與主流程按鈕一致）
//   AY3　修改申報認不到名字：「名單上找不到「X」。如果是新人，請先用「新增人員」加入；如果是舊人，請留意同音字或異體字。」
//   AY4　「指定服侍」和「不能服侍」認名字共用同一支 `resolvePersonId()`（包括 NameAlias）

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadGasSource } = require('./helpers/gas_loader.js');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 600));
}

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

console.log('\n=== AY1 「不在這個崗位的名單上」 ===');
{
  const NEW = '不在這個崗位的名單上';
  ['src/FineTune.gs', 'src/Verify.gs'].forEach((f) => {
    const code = stripComments(read(f));
    check('★★★★★★ ' + f + ' 沒有「不在 Eligibility 名單內」', code.indexOf('不在 Eligibility 名單內') === -1);
    check('★★★★★ ' + f + ' 用新字句', code.indexOf(NEW) !== -1);
  });
  check('★★★★★ Verify 的分組標題也改了', /label: '不在這個崗位的名單上', items: notEligible/.test(read('src/Verify.gs')));
  check('★★★★★ 排表生成器的「沒有任何合資格人選」也不寫內部表名',
    stripComments(read('src/Generator.gs')).indexOf('在 Eligibility 中沒有任何在職的合資格人選') === -1);
  check('★★★★★ 身分影響診斷也不寫內部表名',
    stripComments(read('src/RoleImpact.gs')).indexOf('這些人在 Eligibility 沒有這個崗位的紀錄') === -1);
  // 畫面上（src/ui）本來就沒有
  const uiHits = fs.readdirSync(path.join(ROOT, 'src', 'ui')).filter((f) => f.endsWith('.html'))
    .filter((f) => stripComments(read('src/ui/' + f)).indexOf('不在 Eligibility') !== -1);
  check('★★★★ src/ui 沒有「不在 Eligibility」', uiHits.length === 0, uiHits.join(','));
}

console.log('\n=== AY2 彈窗標題「儲存」 ===');
{
  const zone = stripComments(read('src/ui/ScriptZone1.html'));
  const stale = zone.split('\n').filter((l) => /(openModal|showErrorModal)\('儲存並確認|title: '儲存並確認/.test(l));
  check('★★★★★★ ScriptZone1 沒有任何「儲存並確認」開頭的彈窗標題', stale.length === 0, stale.join('\n'));

  const ui = loadUiScripts(['Script.html', 'ScriptZone1.html']);
  const title = () => {
    const walk = (n) => String(n._text || '') + (n.children || []).map(walk).join('');
    return walk(vm.runInContext('document.getElementById("modalTitle")', ui));
  };
  vm.runInContext('renderSaveZeroChange({ zeroChangeAction: "NONE", stage: "DRAFT" })', ui);
  check('★★★★★★ 沒有改動時撳〔儲存〕：彈窗標題是「儲存」', title() === '儲存', title());
  vm.runInContext('renderSaveResult({ ok: true, zeroChange: true, message: "完成" })', ui);
  check('★★★★★ 零改動完成窗標題同樣', title() === '儲存', title());
  vm.runInContext('renderSaveZeroChange({ zeroChangeAction: "ADVANCE_STAGE_ONLY", stage: "REVIEW_SENT" })', ui);
  // 第八十二輪批次 IG 組：「堂委沒有提出改動」嗰個窗拿走——任何零改動都係「儲存」
  check('★★★★★ 零改動（審閱階段）窗標題都係「儲存」（第八十二輪 IG 組）', title() === '儲存', title());
}

console.log('\n=== AY3／AY4 申報認不到名字的句子；兩條路認名一致 ===');
{
  const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'StateSource.gs', 'FineTune.gs', 'RequestsApply.gs']);
  const N = gas.COLUMNS.NAME_MAPPING;
  const person = {}; person[N.PERSON_ID] = 'P9001'; person[N.NAME_TC] = '假甲';
  gas.readSheet = function (name) { return name === gas.SHEETS.NAME_MAPPING ? [person] : []; };
  gas.readNameAlias = function () { return { 假甲別名: 'P9001' }; };

  const context = {
    quarterId: '2099T1',
    serviceDates: [{ serviceDate: '2099-07-04' }],
    posts: [{ postId: 'READ', postNameTC: '讀經', slotCount: 1 }],
    eligibility: { byPost: { READ: ['P9001'] } }
  };
  const assignByKey = {};
  // FIXTURE-OK: validateRequest_() 只讀這一格「某人在不在」，純函式的輸入替身，不是系統寫入嘅資料
  assignByKey[gas.cellKey_('2099-07-04', 'READ', 1)] = { personId: 'P9001', assignSource: 'AUTO', ruleFlags: [] };
  const req = (type, name) => ({
    requestType: type, personNameText: name, postNameText: '讀經', serviceDateText: '2099-07-04'
  });
  const CANNOT = gas.REQUEST_TYPE.CANNOT_SERVE;
  const DESIG = gas.REQUEST_TYPE.DESIGNATED_SERVE;

  const unknown = gas.validateRequest_(req(DESIG, '陌生人'), context, assignByKey);
  check('★★★★★★ 認不到名字：新句子', unknown.category === 'NEEDS_INPUT'
    && unknown.reason === '名單上找不到「陌生人」。如果是新人，請先用「新增人員」加入；如果是舊人，請留意同音字或異體字。',
    unknown.reason);
  check('★★★★★ 句子不再提內部表名 NameMapping', unknown.reason.indexOf('NameMapping') === -1);
  const unknown2 = gas.validateRequest_(req(CANNOT, '陌生人'), context, assignByKey);
  check('★★★★★★ 「不能服侍」同「指定服侍」兩條路認不到名字句子一樣', unknown2.reason === unknown.reason, unknown2.reason);

  // 用 NameAlias 別名：兩條路都認得
  const aliasDesig = gas.validateRequest_(req(DESIG, '假甲別名'), context, assignByKey);
  const aliasCannot = gas.validateRequest_(req(CANNOT, '假甲別名'), context, assignByKey);
  check('★★★★★★ 兩條路都認得 NameAlias 別名（認名一致）',
    aliasDesig.category === 'APPLY' && aliasDesig.personId === 'P9001'
    && aliasCannot.category === 'APPLY' && aliasCannot.personId === 'P9001',
    JSON.stringify([aliasDesig.category, aliasCannot.category]));

  const src = stripComments(read('src/RequestsApply.gs'));
  check('★★★★★ RequestsApply.gs 只用 resolvePersonId() 認名，冇另寫一套讀 NameMapping',
    !/readSheet\(SHEETS\.NAME_MAPPING\)/.test(src) && (src.match(/resolvePersonId\(/g) || []).length >= 3, '');
}

console.log('\n=== 第七十三輪文字組：畫面上叫幹事去撳「儲存並確認」（舊名）一律改為「儲存」 ===');
{
  // 例外（幹事看不到、或只是內部識別／紀錄）：
  //   ScriptZone1.html 的 ZONE1_BUTTONS（區一已收起，`hidden`）、MonkeyRun／SelfTestRunner／SeasonRehearsal 的
  //   內部步驟名、WebAppSaveConfirm.gs 寫入版本備註的「掣 1 儲存並確認：…」。
  const files = [];
  const walk = (dir) => fs.readdirSync(path.join(ROOT, dir)).forEach((f) => {
    const rel = dir + '/' + f;
    if (fs.statSync(path.join(ROOT, rel)).isDirectory()) return walk(rel);
    if (/\.(gs|html)$/.test(f)) files.push(rel);
  });
  walk('src');
  const ALLOWED = { 'src/ui/ScriptZone1.html': 1 };
  const hits = [];
  files.forEach((f) => {
    stripComments(read(f)).split('\n').forEach((l, i) => {
      if (l.indexOf('「儲存並確認」') === -1) return;
      if (/SelfTest|Rehearsal|MonkeyRun/.test(f)) return;
      if (ALLOWED[f] && /ZONE1_BUTTONS|name: '儲存並確認'/.test(l)) return;
      hits.push(f + ':' + (i + 1) + '　' + l.trim());
    });
  });
  check('★★★★★★ src 內所有畫面文字都不再叫幹事撳「儲存並確認」', hits.length === 0, hits.join('\n'));
  const guards = stripComments(read('src/WebAppGuards.gs'));
  check('★★★★★ 擋住寄出的訊息（WebAppGuards）指向「儲存」', guards.indexOf('先撳「儲存」') !== -1);
}

console.log(fail === 0 ? '\nOK' : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);

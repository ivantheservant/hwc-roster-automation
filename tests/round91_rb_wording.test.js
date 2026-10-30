// 第九十一輪批次 RB 組：三處字眼（第九十輪回歸觀察）。
// 執行方式：node tests/round91_rb_wording.test.js
//
//   RB1 〔人手檢查〕說明句有「同日不兼任」
//   RB2 常用設定〔整季重設〕說明寫「詩班獻詩」會保留
//   RB3 建議原因句子不再有「。；」：〔請系統幫我調整〕（FineTune、建議表）接原因前先去掉結尾標點；
//       建議表格註「原因：……。原本是……」亦不會「。。」；src 使用者可見字串沒有「。；」「；。」「。。」
// 下面用假資料，不涉及真實姓名。

const fs = require('fs');
const path = require('path');
const { loadGasSource, FILES_FOR_GENERATOR } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 900));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

console.log('\n=== RB1／RB2：字眼 ===');
check('★★★★★ 〔人手檢查〕說明句列出「同日不兼任」',
  /只計一定要遵守的規則（名單、不能服侍、身分要求、暫時不做、同週不可兼任、同日不兼任、每人每季上限）/.test(read('src/ui/ScriptZone2.html')));
check('★★★★★ 〔整季重設〕說明寫「詩班獻詩」會保留',
  /人手加入的不能服侍日期、每週標題、合堂主日、詩班獻詩會保留/.test(read('src/ui/ScriptZone3.html')));

console.log('\n=== RB3：標點 ===');
const gas = loadGasSource(FILES_FOR_GENERATOR.concat(['WebAppSaveConfirm.gs', 'SuggestionSheet.gs']));
check('★★★★★ trimSentenceEnd_：去掉結尾的「。；，、」', gas.trimSentenceEnd_('甲已經是領詩。') === '甲已經是領詩'
  && gas.trimSentenceEnd_('乙；。') === '乙' && gas.trimSentenceEnd_(null) === '' && gas.trimSentenceEnd_('丙') === '丙');
check('★★★★★★ joinReasonParts_：「……錄影。」＋「建議改派 乙」⇒「……錄影；建議改派 乙」（沒有「。；」）',
  gas.joinReasonParts_(['甲 7 月 9 日已經是領詩，同日不可以再做錄影。', '建議改派 乙']) === '甲 7 月 9 日已經是領詩，同日不可以再做錄影；建議改派 乙');
check('★★★★ 空段略過', gas.joinReasonParts_(['', null, '丁。']) === '丁');

// 真正走〔請系統幫我調整〕：同日兼任（違規原因以「。」結尾）
{
  const D1 = '2099-01-04';
  const POSTS = [
    { postId: 'CHAIR', postNameTC: '主席', slotCount: 1, frequency: 'WEEKLY', autoGenerate: true, requiredRoles: '', allowConsecutive: 'ALLOW', distinctWithinPost: true },
    { postId: 'WORSHIP', postNameTC: '領詩', slotCount: 1, frequency: 'WEEKLY', autoGenerate: false, requiredRoles: '', allowConsecutive: 'ALLOW', distinctWithinPost: true },
    { postId: 'USHER', postNameTC: '司事', slotCount: 1, frequency: 'WEEKLY', autoGenerate: true, requiredRoles: '', allowConsecutive: 'ALLOW', distinctWithinPost: true }
  ];
  const R = gas.COLUMNS.RULE_SETTINGS;
  const rule = (id, level) => ({ [R.RULE_ID]: id, [R.LEVEL]: level, [R.ENABLED]: true });
  const ctx = {
    posts: POSTS,
    serviceDates: [{ serviceDateId: 'SD1', serviceDate: D1, weekIndex: 1, isFirstSundayOfMonth: true, autoGenerate: true }],
    specialByDate: {},
    eligibility: { byPost: { CHAIR: ['P9701', 'P9702'], USHER: ['P9701', 'P9702', 'P9703'] }, explicitlyExcluded: {} },
    roles: [], personPostExclusions: [], unavailable: [],
    rules: { HARD_NO_AUTO_PREACHER: rule('HARD_NO_AUTO_PREACHER', 'HARD'), HARD_DISTINCT_SLOT: rule('HARD_DISTINCT_SLOT', 'HARD') },
    peopleById: { P9701: { personId: 'P9701', nameTC: '假一' }, P9702: { personId: 'P9702', nameTC: '假二' }, P9703: { personId: 'P9703', nameTC: '假三' } },
    warnOnSemiHard: true, maxPerQuarterDefault: 8, maxMoves: 20, sameDayExclusivePostIds: ['WORSHIP']
  };
  const cell = (postId, personId, extra) => Object.assign({ serviceDateId: 'SD1', serviceDate: D1, postId: postId, slotIndex: 1,
    personId: personId, isManual: false }, extra || {});
  const state = [cell('WORSHIP', 'P9701', { isManual: true }), cell('USHER', 'P9701'), cell('CHAIR', 'P9702')];
  const r = gas.proposeMinimalFixFromState_(ctx, { manualState: state }, { [D1 + '|WORSHIP|1']: true }, {}, null, {});
  const p = r.proposals.filter((x) => x.brokenRuleId === 'HARD_SAME_DAY_EXCLUSIVE')[0];
  check('★★★★★★ 〔請系統幫我調整〕的原因：「……同日不可以再做司事；建議改派 ……」，沒有「。；」',
    p && /同日不可以再做司事；建議改派 /.test(p.reason) && p.reason.indexOf('。；') === -1, p && p.reason);
}

// 選單版（FineTune proposeMinimalFix_()，要真正的 grid 工作表才跑得到）⇒ 用靜態檢查鎖住同一個接法
check('★★★★★ FineTune 的建議原因亦用 joinReasonParts_（不會「。；」）',
  /reason: joinReasonParts_\(\[violation\.reason, replacement\.reason\]\)/.test(read('src/FineTune.gs'))
  && !/violation\.reason \+ '；'/.test(read('src/FineTune.gs')));

// 建議表格註：原因以「。」結尾時不會「。。」
check('★★★★★ 建議表格註接「。原本是」之前先去掉原因結尾的標點',
  /'系統改了這一格。原因：' \+ trimSentenceEnd_\(p\.reason \|\| p\.brokenRuleId\)/.test(read('src/SuggestionSheet.gs')));

// 全域：src 使用者可見字串（引號內）沒有「。；」「；。」「。。」
{
  const bad = [];
  const walk = (dir) => fs.readdirSync(dir).forEach((f) => {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) return walk(p);
    if (!/\.(gs|html)$/.test(f)) return;
    fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      if (/^\s*\*/.test(code)) return;
      const strings = code.match(/'[^']*'|"[^"]*"|`[^`]*`/g) || [];
      if (strings.some((s) => /。；|；。|。。/.test(s))) bad.push(path.relative(ROOT, p) + ':' + (i + 1));
    });
  });
  walk(path.join(ROOT, 'src'));
  check('★★★★ src 字串常數沒有「。；」「；。」「。。」', bad.length === 0, bad.join('、'));
}

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
process.exitCode = fail === 0 ? 0 : 1;

// 第一百一十二輪批次 UB 組：開季前準備「還有 N 項未做」分「生成之前要做」及「生成之後才做」兩類。
// 執行方式：node tests/round112_ub_prequarter_phases.test.js
//
//   UB1 生成之前：標題數字只計現階段做得到的項目（特別主日確認、合堂跳過崗位）；講員、翻譯、獻花、領詩、司琴不計
//   UB2 現階段全部做好 ⇒ 0（畫面寫「開季前準備已完成」）；生成之後的項目另外數（afterGenerationCount）
//   UB3 生成之後：全部計（舊行為）；舊呼叫端沒有傳 generated ⇒ 全部計
//   UB4 區二標題、生成完成窗、寄出確認窗用同一支文字函式（describePreQuarterUndone），數字來自同一個伺服器函式
//   UB5 buildPreQuarterChecklistInputs_ 以有沒有版本決定 generated；清單分兩段顯示
// 用假資料。

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 900));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'AnnualCombined.gs', 'WebAppPeople.gs', 'WebAppPreQuarter.gs']);
const S = gas.COLUMNS.SPECIAL_SUNDAYS;
function specialRow(o) {
  const r = {};
  r[S.SERVICE_DATE] = '2027-03-28'; r[S.TYPE] = ''; r[S.TITLE] = ''; r[S.SKIP_POST_IDS] = 'WORSHIP,PIANO';
  r[S.ACTIVE] = 'TRUE'; r[S.CONFIRMED] = o.confirmed === undefined ? '' : o.confirmed;
  return r;
}
const dates = [{ serviceDate: '2027-01-03' }, { serviceDate: '2027-01-10' }, { serviceDate: '2027-01-17' }];
function plan(extra) {
  return gas.planPreQuarterChecklist_(Object.assign({
    specialRows: [specialRow({ confirmed: 'FALSE' })], serviceDates: dates, filledByDatePost: {},
    preacherPostId: 'PREACH', translationPostId: 'TRANS', flowerPostId: 'FLOWER',
    otherManualPosts: [{ postId: 'LEAD', postNameTC: '領詩' }]
  }, extra || {}));
}
const ids = (r, phase) => r.items.filter((i) => i.phase === phase).map((i) => i.id).sort().join(',');

console.log('\n=== UB1：生成之前 ===');
{
  const r = plan({ generated: false });
  check('★★★★★★ 特別主日未確認 1 項 ＋ 講員／獻花／領詩未填 ⇒ 標題只計 1 項（現階段做得到的）', r.undoneItemCount === 1, JSON.stringify(r.undoneItemCount));
  check('★★★★★★ 生成之後才做的有 3 項（講員、獻花、領詩）', r.afterGenerationCount === 3 && r.generated === false, r.afterGenerationCount);
  check('★★★★★ 項目階段：特別主日、合堂＝BEFORE；講員、翻譯、獻花、人手填崗位＝AFTER',
    ids(r, 'BEFORE') === 'combinedNoSkip,specialUnconfirmed' && ids(r, 'AFTER') === 'flowerEmpty,manualEmpty_LEAD,preacherEmpty,translationEmpty', ids(r, 'BEFORE') + '｜' + ids(r, 'AFTER'));
  check('★★★★★ 每項各自的 count 照舊（不因階段而變）', r.items.filter((i) => i.id === 'preacherEmpty')[0].count === 3);
}

console.log('\n=== UB2：現階段全部做好 ===');
{
  const r = plan({ generated: false, specialRows: [specialRow({ confirmed: 'TRUE' })] });
  check('★★★★★★ 特別主日都確認了 ⇒ 現階段 0 項；生成之後還有 3 項', r.undoneItemCount === 0 && r.afterGenerationCount === 3, JSON.stringify([r.undoneItemCount, r.afterGenerationCount]));
  const none = plan({ generated: false, specialRows: [], filledByDatePost: {}, preacherPostId: null, translationPostId: null, flowerPostId: null, otherManualPosts: [] });
  check('★★★★★ 什麼都沒有 ⇒ 0 項、生成之後 0 項', none.undoneItemCount === 0 && none.afterGenerationCount === 0);
}

console.log('\n=== UB3：生成之後／舊呼叫端 ===');
{
  const r = plan({ generated: true });
  check('★★★★★★ 已經生成 ⇒ 全部計（1＋3＝4 項）；生成之後另計 0', r.undoneItemCount === 4 && r.afterGenerationCount === 0 && r.generated === true, JSON.stringify(r.undoneItemCount));
  const legacy = plan({});
  check('★★★★★ 呼叫端沒有傳 generated（舊呼叫端）⇒ 全部計', legacy.undoneItemCount === 4 && legacy.afterGenerationCount === 0);
}

console.log('\n=== UB4：同一支文字函式 ===');
{
  const sh = read('src/ui/Script.html');
  const m = /function describePreQuarterUndone\(pq\) \{[\s\S]*?\n  \}\n/.exec(sh);
  check('★★★★★★ Script.html 有 describePreQuarterUndone', !!m);
  const ctx = {};
  vm.runInNewContext(m[0] + '\nthis.f = describePreQuarterUndone;', ctx);
  const f = ctx.f;
  const a = f(plan({ generated: false }));
  check('★★★★★★ 生成之前、有未做 ⇒「還有 1 項未做」＋「生成之後還有 3 項」；明細只列現階段的項目',
    a.state === 'todo' && a.headline === '還有 1 項未做' && a.afterText === '生成之後還有 3 項' && a.detail === '特別主日日期未確認 1', JSON.stringify(a));
  const b = f(plan({ generated: false, specialRows: [specialRow({ confirmed: 'TRUE' })] }));
  check('★★★★★★ 現階段全部做好 ⇒「開季前準備已完成」＋「生成之後還有 3 項」', b.state === 'done' && b.headline === '開季前準備已完成' && b.afterText === '生成之後還有 3 項', JSON.stringify(b));
  const c = f(plan({ generated: true }));
  check('★★★★★ 生成之後 ⇒「還有 4 項未做」，明細全部列出', c.headline === '還有 4 項未做' && c.afterText === '' && /講員未填 3/.test(c.detail) && /特別主日日期未確認 1/.test(c.detail), JSON.stringify(c));
  check('★★★★★★ 查不到（-1）⇒ 不可以當成做好了', f({ undoneItemCount: -1, items: [] }).state === 'unknown' && f(null).state === 'unknown' && f({}).state === 'unknown');
  const all = {};
  ['PREACH', 'FLOWER', 'LEAD'].forEach((p) => dates.forEach((d) => { all[d.serviceDate + '|' + p] = true; }));
  const d2 = f(plan({ generated: true, specialRows: [], filledByDatePost: all }));
  check('★★★★★ 生成之後、全部做好 ⇒「開季前準備已完成」、沒有「生成之後還有」', d2.state === 'done' && d2.afterText === '', JSON.stringify(d2));
  const z1 = read('src/ui/ScriptZone1.html'); const z2 = read('src/ui/ScriptZone2.html');
  check('★★★★★★ 區二標題用 describePreQuarterUndone', /const desc = describePreQuarterUndone\(pq\);/.test(z2) && /countNode\.textContent = desc\.headline/.test(z2));
  check('★★★★★★ 生成完成窗用 describePreQuarterUndone', /const desc = describePreQuarterUndone\(pq\);[\s\S]{0,200}desc\.headline/.test(z1));
  check('★★★★★★ 寄出確認（完成）窗用 describePreQuarterUndone；不再自己組「還有 N 項未做」', /describePreQuarterUndone\(d\.preQuarter\)/.test(z1) && z1.indexOf("'提提你：開季前準備還有 ' + undone") === -1);
  check('★★★★★ 區二標題不再寫死「全部做好了」', z2.indexOf("countNode.textContent = '全部做好了'") === -1);
}

console.log('\n=== UB5：輸入及分段顯示 ===');
{
  const pq = read('src/WebAppPreQuarter.gs');
  check('★★★★★★ inputs.generated ＝ 有版本（versionNo >= 0）', /generated: versionNo >= 0,/.test(pq));
  check('★★★★★ apiGetPreQuarterChecklist 回傳 afterGenerationCount、generated', /afterGenerationCount: checklist\.afterGenerationCount,\s*generated: checklist\.generated,/.test(pq));
  const z2 = read('src/ui/ScriptZone2.html');
  check('★★★★★★ 清單分「生成之前要做」及「生成之後才做」兩段', z2.indexOf("sectionTitle('生成之前要做：')") !== -1 && z2.indexOf('生成之後才做（現在還做不到，不計入上面的數字）') !== -1);
  check('★★★★★ 生成之後才做的項目用 ⏳（不是 ⬜）', z2.indexOf("notYet ? '⏳ ' : '⬜ '") !== -1);
  const ge = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'AnnualCombined.gs', 'WebAppPeople.gs', 'WebAppPreQuarter.gs', 'WebAppGenerate.gs']);
  check('★★★★★ sumManualFillItems_ 不受階段影響（照舊加總人手填項目）', ge.sumManualFillItems_(plan({ generated: true })) === 9, ge.sumManualFillItems_(plan({ generated: true })));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);

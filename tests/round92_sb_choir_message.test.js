// 第九十二輪批次 SB 組：〔詩班獻詩〕儲存訊息。
// 執行方式：node tests/round92_sb_choir_message.test.js
//
//   「已更新 N 週的設定。現時這一季共有 M 週詩班獻詩。」（M 由工作表實際值計算，不是前端傳入）
//   M＝0 ⇒「現時這一季沒有詩班獻詩的主日。」；沒有改動 ⇒「沒有改動。」
// 用假資料，不涉及真實姓名。

const fs = require('fs');
const path = require('path');
const { buildRound75Scene } = require('./helpers/round75_harness.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 900));
}

const sc = buildRound75Scene({ extraFiles: ['PostSeedChoir.gs', 'WebAppChoir.gs'] });
const g = sc.gas; const D = sc.DATES;
const msg = (items) => g.apiSaveChoirSinging(sc.Q, items);

console.log('\n=== SB1：勾選 ===');
{
  const r = msg([{ serviceDate: D[0], singing: true }]);
  check('★★★★★★ 勾選第 1 週 ⇒「已更新 1 週的設定。現時這一季共有 1 週詩班獻詩。」',
    r.ok && r.changed === 1 && r.message === '已更新 1 週的設定。現時這一季共有 1 週詩班獻詩。', JSON.stringify(r));
  const r2 = msg([{ serviceDate: D[2], singing: true }, { serviceDate: D[3], singing: true }]);
  check('★★★★★★ 再勾兩週 ⇒ 更新 2 週，共有 3 週（M 是整季的實際值，不只是這次送來的）',
    r2.changed === 2 && r2.message === '已更新 2 週的設定。現時這一季共有 3 週詩班獻詩。', JSON.stringify(r2));
}

console.log('\n=== SB2：取消勾選 ===');
{
  const r = msg([{ serviceDate: D[0], singing: false }]);
  check('★★★★★★ 取消 1 週、還剩 2 週 ⇒「已更新 1 週的設定。現時這一季共有 2 週詩班獻詩。」',
    r.changed === 1 && r.message === '已更新 1 週的設定。現時這一季共有 2 週詩班獻詩。', JSON.stringify(r));
  check('★★★★★ 訊息不再用「已儲存 N 週的詩班獻詩設定」（像是有 N 週獻詩）', r.message.indexOf('已儲存') === -1);
}

console.log('\n=== SB3：全部取消 ===');
{
  const r = msg([{ serviceDate: D[2], singing: false }, { serviceDate: D[3], singing: false }]);
  check('★★★★★★ 全部取消 ⇒「已更新 2 週的設定。現時這一季沒有詩班獻詩的主日。」',
    r.changed === 2 && r.message === '已更新 2 週的設定。現時這一季沒有詩班獻詩的主日。', JSON.stringify(r));
  check('★★★★ 回傳 singingCount 為 0', r.singingCount === 0);
  const open = g.apiGetChoirSinging(sc.Q);
  check('★★★★ 工作表實際上沒有任何一週勾選', open.weeks.every((w) => !w.singing));
}

console.log('\n=== SB4：沒有改動 ===');
{
  check('★★★★★ 同樣再存 ⇒「沒有改動。」',
    msg([{ serviceDate: D[0], singing: false }]).message === '沒有改動。');
  const r = msg([{ serviceDate: D[1], singing: true }]);
  check('★★★★ 勾了一週（前置）', r.changed === 1 && /共有 1 週/.test(r.message), JSON.stringify(r));
  const same = msg([{ serviceDate: D[1], singing: true }]);
  check('★★★★★ 勾選的狀態沒有變 ⇒「沒有改動。」，不寫「共有」', same.changed === 0 && same.message === '沒有改動。', JSON.stringify(same));
}

console.log('\n=== SB5：M 由工作表計算 ===');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/WebAppChoir.gs'), 'utf8');
  const fn = src.slice(src.indexOf('function saveChoirSinging_'));
  check('★★★★★ 儲存函式重讀工作表數勾選的週數', /getValues\(\)\.forEach\(function \(row\)/.test(fn) && /total\+\+/.test(fn));
  check('★★★★★ 前端沒有傳過 M（apiSaveChoirSinging 只收 quarterId、items）',
    /function apiSaveChoirSinging\(quarterId, items\)/.test(src));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);

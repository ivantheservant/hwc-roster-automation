// 第九十二輪批次 SA 組：〔儲存〕確認窗及等候牌不再把「重新發佈公開連結」列為儲存時做的事。
// 執行方式：node tests/round92_sa_save_wording.test.js
//
//   SA1 確認窗「這一次會做的事」寫「儲存完成後，公開連結會在背景自動更新（連結地址不變）」
//   SA2 等候牌（SAVE_BUSY_STEPS）沒有「重新發佈公開連結」，也沒有別的公開連結步驟
//   SA3 只改〔儲存〕這一條路：生成仍然即時發佈
//   SA4 指南：如有描述〔儲存〕確認窗那一行，同步改（指南檔不在 repo，檔案存在才檢查）

const fs = require('fs');
const path = require('path');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 900));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function sliceBetween(text, startMarker, endMarker) {
  const a = text.indexOf(startMarker);
  if (a === -1) return '';
  const b = text.indexOf(endMarker, a + startMarker.length);
  return b === -1 ? text.slice(a) : text.slice(a, b);
}

const zone1 = read('src/ui/ScriptZone1.html');

console.log('\n=== SA1：確認窗 ===');
{
  const fnBody = sliceBetween(zone1, 'function buildSaveSummary(plan)', '/* ── C3');
  check('★★★★ 找到 buildSaveSummary', fnBody.length > 200);
  check('★★★★★★ 「會做的事」寫「儲存完成後，公開連結會在背景自動更新（連結地址不變）」',
    fnBody.indexOf("willDo.push('儲存完成後，公開連結會在背景自動更新（連結地址不變）')") !== -1);
  check('★★★★★★ 「會做的事」不再有「重新發佈公開連結」',
    fnBody.indexOf('重新發佈公開連結') === -1, fnBody.match(/.*重新發佈公開連結.*/));
}

console.log('\n=== SA2：等候牌 ===');
{
  const m = zone1.match(/const SAVE_BUSY_STEPS = \[([\s\S]*?)\];/);
  check('★★★★ 找到 SAVE_BUSY_STEPS', !!m);
  const body = m ? m[1] : '';
  const steps = (body.match(/'[^']+'/g) || []);
  check('★★★★ 仍然有三項（讀取、檢查、建立新一版）', steps.length === 3, JSON.stringify(steps));
  check('★★★★★★ 沒有「重新發佈公開連結」', body.indexOf('重新發佈公開連結') === -1, body);
  check('★★★★★ 也沒有改寫成別的公開連結步驟（公開連結在完成窗之後才更新，不屬於儲存要等的事）',
    body.indexOf('公開連結') === -1, body);
  const uses = zone1.match(/\}, SAVE_BUSY_STEPS\)/g) || [];
  check('★★★★ 兩條儲存路（快路、確認窗）都用同一份等候牌', uses.length === 2, String(uses.length));
}

console.log('\n=== SA3：只改〔儲存〕這一條路 ===');
{
  const gen = read('src/WebAppGenerate.gs');
  check('★★★★★ 生成仍然即時發佈（呼叫 tryPublishPublicRoster_，回傳 publishFailed），不是背景更新',
    /const publish = tryPublishPublicRoster_\(quarterId\)/.test(gen) && /publishFailed: publish\.failed/.test(gen)
    && gen.indexOf('publishPending') === -1);
  check('★★★★ 前端那邊的〔立即重新發佈〕（背景更新失敗時用）字眼沒有變',
    zone1.indexOf("button('立即重新發佈'") !== -1);
}

console.log('\n=== SA4：指南 ===');
{
  const files = ['guide/指南內容.md', 'guide/快速指南內容.md', 'guide/新功能快速指南內容.md'];
  let checked = 0;
  files.forEach((f) => {
    if (!fs.existsSync(path.join(ROOT, f))) return;
    checked++;
    const text = read(f);
    const bad = text.split('\n').filter((l) => /會做的事/.test(l) && /重新發佈公開連結/.test(l));
    check('★★★★ ' + f + ' 沒有把「重新發佈公開連結」寫成儲存確認窗會做的事', bad.length === 0, bad.join('\n'));
  });
  if (checked === 0) console.log('SKIP  guide/ 不在 repo（gitignore），指南檢查略過');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);

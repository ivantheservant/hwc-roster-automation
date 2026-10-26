// 第七十七輪批次 EB 組：〔查看這一版〕要真正唯讀。
// 執行方式：node tests/round77_eb_view_version_readonly.test.js
//
// Ivan（手動測試 B）：「查看這一版，應該是 read only（現在使用者可以改）。」
// 之前只加 `setWarningOnly(true)` 嘅保護、開 `/edit`——試算表擁有人撳走提示就可以改。
//
//   EB1　舊版本嘅網址係唯讀顯示網址（`/preview#gid=<gid>`），唔係 `/edit`；含正確 gid
//   EB2　最新一版〔查看／修改職事表〕照舊 `/edit`（嗰張係要改嘅）
//   EB3　apiOpenVersionForViewing() 回唯讀網址；保護照加（第二道防線）；最新一版照舊 /edit

const { buildRound75Scene } = require('./helpers/round75_harness.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 700));
}

const sc = buildRound75Scene();
const gas = sc.gas;
const D = sc.DATES;
gas.apiGenerateDraftExecute(sc.Q);
const other = ['P9701', 'P9702', 'P9703', 'P9704', 'P9705'].map(sc.nameOf).filter((n) => n !== sc.getCell(0, D[0], 'CHAIR#1'))[0];
sc.setCell(0, D[0], 'CHAIR#1', other);
const saved = gas.apiSaveAndConfirmExecute(sc.Q, { decisions: [], confirmedRequestRows: [] });
check('（準備）第 1 版', saved && saved.versionNo === 1, JSON.stringify(saved).slice(0, 300));
const gidOf = (no) => sc.gridSheet(no).getSheetId();

console.log('\n=== EB1／EB2：版本清單嘅網址 ===');
{
  const list = gas.listQuarterVersionChoices_(sc.Q, sc.TZ);
  const v0 = list.filter((v) => v.versionNo === 0)[0];
  const v1 = list.filter((v) => v.versionNo === 1)[0];
  check('★★★★★★ 舊版本（第 0 版）網址係 /preview#gid=<gid>，唔含 /edit',
    /\/preview#gid=/.test(v0.sheetUrl) && v0.sheetUrl.indexOf('/edit') === -1
    && v0.sheetUrl.indexOf('#gid=' + gidOf(0)) !== -1, JSON.stringify(v0));
  check('★★★★★★ 最新一版（第 1 版）照舊 /edit#gid=<gid>',
    /\/edit#gid=/.test(v1.sheetUrl) && v1.sheetUrl.indexOf('#gid=' + gidOf(1)) !== -1, JSON.stringify(v1));
  check('★★★★ 兩條都係完整 https 網址', /^https:\/\/docs\.google\.com\/spreadsheets\/d\//.test(v0.sheetUrl)
    && /^https:\/\/docs\.google\.com\/spreadsheets\/d\//.test(v1.sheetUrl));
  check('★★★★ 搵唔到工作表 ⇒ 空字串（唔砌一條去錯地方嘅連結）', gas.buildGridSheetViewUrl_('Roster_不存在') === '');
}

console.log('\n=== EB3：apiOpenVersionForViewing() ===');
{
  const protectedSheets = [];
  const sheet = sc.gridSheet(0);
  const orig = sheet.protect.bind(sheet);
  sheet.protect = function () {
    const p = orig();
    const rec = { warningOnly: null };
    protectedSheets.push(rec);
    const setW = p.setWarningOnly;
    p.setWarningOnly = function (v) { rec.warningOnly = v; return setW.call(p, v); };
    return p;
  };
  const r = gas.apiOpenVersionForViewing(sc.Q, 0);
  check('★★★★★★ 舊版本：回唯讀顯示網址（/preview#gid=），唔係 /edit',
    /\/preview#gid=/.test(r.url) && r.url.indexOf('/edit') === -1 && r.url.indexOf('#gid=' + gidOf(0)) !== -1, JSON.stringify(r));
  check('★★★★★ 保護照舊加（第二道防線，只提示）', protectedSheets.length === 1 && protectedSheets[0].warningOnly === true,
    JSON.stringify(protectedSheets));
  const latest = gas.apiOpenVersionForViewing(sc.Q, 1);
  check('★★★★★ 最新一版照舊 /edit（佢係要改嗰張）', /\/edit#gid=/.test(latest.url), JSON.stringify(latest));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);

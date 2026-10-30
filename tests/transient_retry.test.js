// 第六十三輪批次 O 組：Google 暫時性錯誤直接顯示英文技術訊息。
// 執行方式：node tests/transient_retry.test.js
//
// 實測「儲存及寄出」第一次撳：「Exception: Service Spreadsheets failed while
// accessing document with id …」，重試即成功。
//
// ⚠️ 只可以重試「未寫入任何東西就失敗」嘅情況。判斷方法：只重試**唯讀**呼叫
// （`callServer()`，`READ_ONLY_APIS` 白名單）；會寫入嘅（`callServerMutating()`）
// 一律唔自動重試。

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 400));
}
const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'Script.html'), 'utf8');
function grab(startMarker, endMarker) {
  const s = html.indexOf(startMarker);
  const e = html.indexOf(endMarker, s);
  return html.slice(s, e);
}
const code = grab('  const TRANSIENT_ERROR_PATTERNS = [', '  /**\n   * 會改變伺服器狀態嘅呼叫')
  + grab('  async function callServerMutating(', '  /**\n   * 讀狀態快取嘅');

let calls = 0;
let failures = [];
const sandbox = {
  READ_ONLY_APIS: ['apiRead'],
  // 第八十七輪 NB 組：callServerMutating 先檢查是不是只可查看
  viewOnly_: false,
  VIEW_ONLY_TEXT: '你只有查看權限',
  dashboardStale_: false,
  setTimeout: function (cb) { cb(); },
  Promise: Promise,
  Error: Error,
  String: String,
  callServerRaw_: function () {
    calls++;
    const f = failures.shift();
    return f ? Promise.reject(new Error(f)) : Promise.resolve('ok');
  }
};
vm.createContext(sandbox);
vm.runInContext(code + '\nthis.callServer = callServer; this.callServerMutating = callServerMutating;'
  + ' this.isTransientServerError_ = isTransientServerError_;', sandbox);

(async function () {
  console.log('\n=== O【核心】唯讀呼叫：暫時性錯誤自動重試一次 ===');
  calls = 0; failures = ['Exception: Service Spreadsheets failed while accessing document with id x'];
  const r = await sandbox.callServer('apiRead');
  check('★★★★★★ 第一次 Service Spreadsheets failed ⇒ 自動再試，成功', r === 'ok' && calls === 2, calls);

  calls = 0; failures = ['Service invoked too many times for one day', 'timed out again'];
  let err = null;
  try { await sandbox.callServer('apiRead'); } catch (e) { err = e; }
  check('★★★★★ 只重試**一次**：再錯就照拋', err && calls === 2, calls);

  calls = 0; failures = ['找不到工作表：Config'];
  err = null;
  try { await sandbox.callServer('apiRead'); } catch (e) { err = e; }
  check('★★★★★ 唔係暫時性錯誤 ⇒ 唔重試', err && calls === 1, calls);

  console.log('\n=== O【核心】會寫入嘅呼叫：唔自動重試 ===');
  calls = 0; failures = ['Exception: Service Spreadsheets failed while accessing document'];
  err = null;
  try { await sandbox.callServerMutating('apiWrite'); } catch (e) { err = e; }
  check('★★★★★★ callServerMutating 唔自動重試——分唔出寫咗幾多，重試可能造多一個版本或寄多一封',
    err && calls === 1, calls);

  console.log('\n=== O：判斷同畫面 ===');
  check('★★★★ 三種訊息都認得', ['Service Spreadsheets failed', 'Service invoked too many times', 'Request timed out']
    .every(function (m) { return sandbox.isTransientServerError_(new Error(m)); }));
  check('★★★★★ 錯誤彈窗第一句用中文講「Google 試算表暫時沒有回應」',
    /if \(!parsed && isTransientServerError_\(err\)\)/.test(html) && /Google 試算表暫時沒有回應/.test(html));

  console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
  process.exit(fail === 0 ? 0 : 1);
})();

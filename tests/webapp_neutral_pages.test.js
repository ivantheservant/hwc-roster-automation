// 第六十七輪批次 AK 組：未獲授權的訪客唔可以見到內部設定名稱。
// 執行方式：node tests/webapp_neutral_pages.test.js
//
// 現場（2026-10-21 無痕視窗開義工個人連結基底、冇參數）：「你沒有權限使用這個頁面。
// 如果你認為這是錯誤，請聯絡系統管理員，在 Config 工作表的 WEBAPP_ALLOWED_EMAILS 加入你的電郵。」
// 義工刪走網址參數就會見到，而且叫佢搵人把自己加入白名單係錯嘅指示。
//
// 呢一份**真嘅執行** `doGet()`（WebApp.gs），HtmlService／Session 換假。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 700));
}

function sandbox(opts) {
  const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'WebApp.gs']);
  const pages = [];
  gas.HtmlService = {
    createHtmlOutput: function (html) {
      const out = { html: html, title: '', setTitle: function (t) { out.title = t; return out; } };
      pages.push(out);
      return out;
    },
    createTemplateFromFile: function () { throw new Error('唔應該渲染 Index'); }
  };
  gas.Session = { getActiveUser: function () { return { getEmail: function () { return opts.email || ''; } }; } };
  gas.getConfig = function (key, d) {
    if (key === gas.CONFIG_KEYS.WEBAPP_ENABLED) return opts.enabled;
    if (key === gas.CONFIG_KEYS.WEBAPP_ALLOWED_EMAILS) return ['staff@example.invalid'];
    return d;
  };
  const logs = [];
  gas.log_ = function (level, msg) { logs.push(level + ' ' + msg); };
  gas.renderPersonalRosterPage_ = function () { throw new Error('唔應該行個人連結'); };
  return { gas: gas, pages: pages, logs: logs };
}

const FORBIDDEN = /Config|WEBAPP_|Apps Script|部署|白名單|工作表/;

console.log('\n=== AK【核心】停用頁：中性句子 ===');
{
  const s = sandbox({ enabled: false, email: 'someone@example.invalid' });
  const out = s.gas.doGet({ parameter: {} });
  check('★★★★★★ 唔提 Config／WEBAPP_／部署', !FORBIDDEN.test(out.html), out.html);
  check('★★★★★ 講「系統暫時停用，請稍後再試或聯絡幹事」', /系統暫時停用/.test(out.html) && /聯絡幹事/.test(out.html), out.html);
  check('★★★★ 詳細原因寫入執行記錄', s.logs.some(function (l) { return /WEBAPP_ENABLED/.test(l); }), s.logs.join('|'));
  check('★★★ 標題冇「（已停用）」之類洩露狀態嘅字', !/停用|無權限/.test(out.title), out.title);
}

console.log('\n=== AK【核心】無權限頁：叫義工用個人專屬連結 ===');
{
  const s = sandbox({ enabled: true, email: 'wrong@example.invalid' });
  const out = s.gas.doGet({ parameter: {} });
  check('★★★★★★ 唔提 Config／WEBAPP_／白名單', !FORBIDDEN.test(out.html), out.html);
  check('★★★★★ 講「這個網址只供幹事使用。如果你是義工，請用電郵內的個人專屬連結。」',
    /這個網址只供幹事使用/.test(out.html) && /個人專屬連結/.test(out.html), out.html);
  check('★★★★ 已登入 ⇒ 多一句「（目前登入：<電郵>）」', /（目前登入：wrong@example\.invalid）/.test(out.html), out.html);
  check('★★★★ 詳細原因寫入執行記錄', s.logs.some(function (l) { return /允許名單/.test(l); }), s.logs.join('|'));

  const anon = sandbox({ enabled: true, email: '' });
  const out2 = anon.gas.doGet({ parameter: {} });
  check('★★★★ 未登入（讀唔到電郵）⇒ 冇「目前登入」嗰句', !/目前登入/.test(out2.html) && !FORBIDDEN.test(out2.html), out2.html);

  const xss = sandbox({ enabled: true, email: '<b>x</b>@example.invalid' });
  check('★★★ 電郵有 < > ⇒ 已逃脫', !/<b>/.test(xss.gas.doGet({ parameter: {} }).html));
}

console.log('\n=== AK：原始碼本身冇留低舊句子 ===');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'WebApp.gs'), 'utf8');
  const body = src.slice(src.indexOf('function doGet('), src.indexOf('function includeHtml('));
  const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('★★★★ doGet 同兩個頁面函式嘅**程式碼**冇 `<code>WEBAPP_`／「加入你的電郵」', !/<code>WEBAPP_|加入你的電郵|WEBAPP_ENABLED<\/code>/.test(code));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);

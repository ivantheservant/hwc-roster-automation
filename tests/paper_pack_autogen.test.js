// 第四十四輪批次 D 組：「寄到自己信箱」欠嘅 PDF 自己補產生。
// 執行方式：node tests/paper_pack_autogen.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 點解要有呢一份
// ═════════════════════════════════════════════════════════════════════
//
// Ivan 撳「處理紙本 ▸ 寄到自己信箱」，收到：
//
//     一份個人 PDF 都找不到。
//     一封都沒有寄出。
//     ・先撳「產生並取得連結」，等它產生好，再撳這一粒
//
// 系統**知道**欠邊幾份（`listPaperPackFiles_()` 逐個列咗出嚟），
// 亦都**有**一個做開呢件事嘅批次（`generatePersonalPdfBatchForPeople_()`，
// 連斷點續做都有），但佢揀咗叫幹事自己去撳另一粒掣。
//
// 呢一份守三件事：
//
//   一、欠嘅**自己補產生**，補完先寄。
//   二、補唔完（六分鐘上限）⇒ **一封都唔寄**，報進度、俾佢接住做。
//       ⚠️ 呢一條唔可以妥協。幹事收到一封夾住 30 份嘅信唔會逐份數，
//       佢會印晒派晒，然後有幾位企喺度冇紙。
//   三、`NameMapping` 查唔到編號嗰種**補極都補唔到**，要分開講——
//       同「未產生過」混埋一齊講，就會叫佢一次又一次撳同一粒掣。

const path = require('path');
const fs = require('fs');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 500));
}

const ROOT = path.join(__dirname, '..');
const ui = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'ScriptSendPaper.html'), 'utf8');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs',
  'WebAppGuards.gs', 'MutationLock.gs', 'PaperPack.gs'
]);

/** 每一個情境重新裝一次替身，順便記低系統做過啲咩。 */
function setup(opts) {
  const log = { sent: [], generatedFor: [], audit: [] };
  gas.assertWebAppRequestAllowed_ = function () {};
  gas.Session = { getActiveUser: function () { return { getEmail: function () { return 'clerk@example.invalid'; } }; } };
  gas.findLatestVersionNo = function () { return 7; };
  gas.buildRosterSheetName_ = function () { return '職事表 2027T3 v7'; };
  gas.buildQuarterLabel_ = function () { return '2027 年第三季'; };
  gas.writeAuditLog_ = function (row) { log.audit.push(row); };
  gas.DriveApp = { getFileById: function () { return { getBlob: function () { return {}; } }; } };
  gas.MailApp = { sendEmail: function (m) { log.sent.push(m); } };
  gas.getConfig = function (_k, d) { return d; };

  // 資料夾入面而家有邊幾份。產生一次就會多幾份。
  const present = {};
  (opts.presentIds || []).forEach(function (id) { present[id] = true; });
  const names = opts.names || {};

  gas.listPaperPackFiles_ = function (_q, versionNo, ids) {
    const files = [];
    const missing = [];
    ids.forEach(function (id) {
      const nameTC = names[id];
      if (!nameTC) {
        missing.push({ personId: id, nameTC: '', reason: 'NameMapping 查不到這個編號。' });
        return;
      }
      if (!present[id]) {
        missing.push({ personId: id, nameTC: nameTC, reason: '找不到「' + nameTC + '.pdf」。' });
        return;
      }
      files.push({ personId: id, nameTC: nameTC, fileName: nameTC + '.pdf',
        url: 'https://drive.example.invalid/d/FILE' + id, sizeBytes: 100 * 1024 });
    });
    return { folderUrl: 'https://drive.example.invalid/folder', files: files, missing: missing };
  };

  gas.generatePersonalPdfBatchForPeople_ = function (_q, _v, ids) {
    log.generatedFor.push(ids.slice());
    // `perRun` ＝ 一次執行做得晒幾多個（模擬六分鐘上限）。
    const perRun = opts.perRun === undefined ? ids.length : opts.perRun;
    const doing = ids.slice(0, perRun);
    doing.forEach(function (id) { present[id] = true; });
    return {
      done: doing.length === ids.length,
      doneCount: doing.length,
      generatedCount: doing.length,
      skippedExistingCount: 0,
      errors: []
    };
  };

  return log;
}

// =====================================================================
console.log('\n=== D【核心】欠嘅自己補產生，補完就寄 ===');
{
  const log = setup({
    names: { P9001: '測試甲', P9002: '測試乙', P9003: '測試丙' },
    presentIds: ['P9001']   // 得一份現成，另外兩份未產生過
  });
  const r = gas.apiEmailPaperPackToSelf_locked_(
    '2027T3', ['P9001', 'P9002', 'P9003'], []);

  check('★★★★★ **有寄出**（修正之前呢一步會拋「一份個人 PDF 都找不到。」）',
    r.sentCount === 1 && log.sent.length === 1, JSON.stringify(r));
  check('★★★★★ 三份都夾齊咗',
    r.fileCount === 3, JSON.stringify(r));
  check('★★★★★ 而且**只補產生欠嗰兩份**'
    + '——連現成嗰份都重做一次，就係白等幾分鐘',
    log.generatedFor.length === 1
    && JSON.stringify(log.generatedFor[0]) === JSON.stringify(['P9002', 'P9003']),
    JSON.stringify(log.generatedFor));
  check('★★★★★ 訊息講明「有幾份係系統補產生嘅」'
    + '——唔講嘅話，幹事下次仲以為自己要先撳「產生並取得連結」',
    r.message.indexOf('2 份是系統在寄之前替你補產生的') !== -1, r.message);
  check('★★★★ 補產生呢件事有入稽核紀錄',
    log.audit.some(function (a) { return a.action === 'PAPER_PACK_AUTO_GENERATED'; }),
    JSON.stringify(log.audit));
  check('★★★★ 寄出嗰件事一樣有入稽核紀錄',
    log.audit.some(function (a) { return a.action === 'PAPER_PACK_EMAILED'; }));
}

// =====================================================================
console.log('\n=== D【核心】一次補唔完 ⇒ **一封都唔寄** ===');
{
  const log = setup({
    names: { P9001: '測試甲', P9002: '測試乙', P9003: '測試丙', P9004: '測試丁' },
    presentIds: [],
    perRun: 2   // 一次執行只做得起兩份
  });
  const r = gas.apiEmailPaperPackToSelf_locked_(
    '2027T3', ['P9001', 'P9002', 'P9003', 'P9004'], []);

  check('★★★★★ **一封都冇寄出**'
    + '——寄一封唔完整嘅信落去，幹事會印晒派晒，'
    + '然後有幾位企喺度冇紙，而佢由頭到尾唔知少咗',
    r.sentCount === 0 && log.sent.length === 0, JSON.stringify(r));
  check('★★★★★ 明確標住 `pending`（畫面靠佢決定用唔用綠色「已寄出」）',
    r.pending === true, JSON.stringify(r));
  check('★★★★★ 講得出「做咗幾多」同「仲差幾多」',
    r.message.indexOf('補產生了 2 份') !== -1
    && r.message.indexOf('還差 2 份') !== -1, r.message);
  check('★★★★★ 明講「一封都未寄出」'
    + '——一句「未完成」唔夠：幹事要即刻知道**而家個信箱係空嘅**',
    r.message.indexOf('一封都未寄出') !== -1, r.message);
  check('★★★★ 講得出下一步係「再撳一次會接住做」',
    r.message.indexOf('接住做') !== -1, r.message);
  check('★★★★ `stillGeneratingCount` 報得準',
    r.stillGeneratingCount === 2, JSON.stringify(r));
}

// =====================================================================
console.log('\n=== D【核心】再撳一次 ⇒ 由停低嗰度接住做，做齊就寄 ===');
{
  const log = setup({
    names: { P9001: '測試甲', P9002: '測試乙', P9003: '測試丙', P9004: '測試丁' },
    presentIds: [],
    perRun: 2
  });
  const ids = ['P9001', 'P9002', 'P9003', 'P9004'];
  const first = gas.apiEmailPaperPackToSelf_locked_('2027T3', ids, []);
  const second = gas.apiEmailPaperPackToSelf_locked_('2027T3', ids, []);

  check('★★★★ 第一次未寄', first.sentCount === 0);
  check('★★★★★ **第二次寄咗**，而且四份齊晒',
    second.sentCount === 1 && second.fileCount === 4, JSON.stringify(second));
  check('★★★★★ 第二次只補餘下嗰兩份（唔係由頭做過）'
    + '——由頭做過就永遠做唔完，因為每次都撞同一個六分鐘上限',
    JSON.stringify(log.generatedFor[1]) === JSON.stringify(['P9003', 'P9004']),
    JSON.stringify(log.generatedFor));
  check('★★★★ 第二次唔再係 pending', !second.pending);
}

// =====================================================================
console.log('\n=== D【核心】`NameMapping` 查唔到嗰種：補極都補唔到，要分開講 ===');
{
  const log = setup({
    names: { P9001: '測試甲' },
    presentIds: []
    // P9998 冇名 ⇒ 永遠產生唔到
  });
  const r = gas.apiEmailPaperPackToSelf_locked_('2027T3', ['P9001', 'P9998'], []);

  check('★★★★★ 補得到嗰個補咗，照樣寄出'
    + '——因為一個查唔到編號嘅人而拉住成批唔寄，係另一種壞',
    r.sentCount === 1 && r.fileCount === 1, JSON.stringify(r));
  check('★★★★★ 只試過補產生 `P9001`，冇試 `P9998`'
    + '——試一個必定失敗嘅，只會浪費一次執行同埋喺紀錄留低一堆假錯',
    JSON.stringify(log.generatedFor[0]) === JSON.stringify(['P9001']),
    JSON.stringify(log.generatedFor));
  check('★★★★★ `P9998` 照樣逐個列出嚟（唔可以靜靜略過）',
    (r.missing || []).length === 1 && r.missing[0].personId === 'P9998',
    JSON.stringify(r.missing));
  check('★★★★ 而且講得出原因係 `NameMapping` 查唔到',
    r.missing[0].reason.indexOf('NameMapping') !== -1, r.missing[0].reason);
}

// =====================================================================
console.log('\n=== D 全部都係補唔到嗰種 ⇒ 拋一個**講得出成因**嘅錯 ===');
{
  setup({ names: {}, presentIds: [] });
  let msg = null;
  try {
    gas.apiEmailPaperPackToSelf_locked_('2027T3', ['P9998', 'P9999'], []);
  } catch (err) { msg = err.message; }

  check('★★★★★ 有拋錯', msg !== null);
  check('★★★★★ **唔再係**舊嗰句「一份個人 PDF 都找不到。」'
    + '——嗰句嘅下一步係「先撳產生並取得連結」，而呢個情況'
    + '撳一百次都冇用',
    msg && msg.indexOf('一份個人 PDF 都找不到') === -1, msg);
  check('★★★★★ 講得出真正成因（`NameMapping` 查唔到）同埋係邊幾個編號',
    msg && msg.indexOf('NameMapping') !== -1
    && msg.indexOf('P9998') !== -1 && msg.indexOf('P9999') !== -1, msg);
  check('★★★★ 講得出下一步係去改 `NameMapping`',
    msg && msg.indexOf('打錯') !== -1, msg);
  check('★★★★ 而且明講一封都冇寄', msg && msg.indexOf('一封都沒有寄出') !== -1, msg);
}

// =====================================================================
console.log('\n=== D 呢一條路而家會寫入 Drive ⇒ 一定要攞互斥鎖 ===');
{
  const src = fs.readFileSync(path.join(ROOT, 'src', 'PaperPack.gs'), 'utf8');
  const shell = src.slice(src.indexOf('function apiEmailPaperPackToSelf(quarterId'),
    src.indexOf('function apiEmailPaperPackToSelf_locked_('));
  check('★★★★★ 薄殼有攞鎖'
    + '——唔攞嘅話，佢會同「產生並取得連結」撞埋一齊寫同一份 PDF',
    /withMutationLock_\('寄紙本到自己信箱'/.test(shell), shell);
  check('★★★★★ 薄殼只做權限檢查同攞鎖，本體喺 `_locked_` 嗰個'
    + '——把 `withMutationLock_()` 塞入原本個函式，就要喺每一個 `return`'
    + '前面記得放鎖，而漏一個就會令整份試算表卡死',
    /assertWebAppRequestAllowed_\(\);/.test(shell)
    && shell.indexOf('listPaperPackFiles_') === -1, shell);
  check('★★★★★ 前端用 `callServerMutating()`（唔係 `callServer()`）'
    + '——佢而家會寫入 Drive，唯讀白名單擋咗就會即刻拒絕',
    /callServerMutating\(\s*\n?\s*'apiEmailPaperPackToSelf'/.test(ui), '');
}

// =====================================================================
console.log('\n=== D 畫面：未寄出唔可以用綠色「已寄出」報 ===');
{
  const uiBare = ui.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('★★★★★ `r.pending` 嗰陣個頭係「還未寄出」而且用 `warn-head`'
    + '——用返 `ok-head` 嗰隻綠，幹事見到就會走去印，而封信根本未到',
    /r\.pending\s*\n?\s*\?\s*\[make\('div', \{ text: '還未寄出——還在補產生 PDF', className: 'warn-head' \}\)/
      .test(uiBare), '');
  check('★★★★★ 未寄完俾一粒「接住做餘下的」，唔使佢由頭撳過',
    /button\('接住做餘下的', \(\) => \{ closeModal\(\); runPaperEmail\(\); \}/.test(uiBare), '');
  check('★★★★★ 確認畫面唔再叫佢「先撳產生並取得連結」'
    + '——嗰句就係 Ivan 撞到嗰個死胡同',
    uiBare.indexOf('如果那幾份 PDF 還未產生過，先撳「產生並取得連結」。') === -1, '');
  check('★★★★★ 改為明講「系統會在寄之前自己補產生」',
    /還未產生的，系統會在寄之前自己補產生/.test(uiBare), '');
  check('★★★★ 而且預先講明「一次可能做不完」'
    + '——唔預先講，佢見到「還未寄出」會以為系統壞咗',
    /一次可能做不完/.test(uiBare), '');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);

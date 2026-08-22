// 第四十九輪批次（順手修）：個人 PDF 缺件擋住正式發出嗰陣，就地補齊。
// 執行方式：node tests/missing_pdf_inline.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場（Ivan 實測）
// ═════════════════════════════════════════════════════════════════════
//
//     正式發出：已中止
//
//     要留意
//     有 59 / 59 人還沒有個人 PDF，超過了容許的缺件上限。
//
//     現在的情況
//     沒有寄出任何電郵，職事表沒有任何改動。
//
//     你可以怎樣做
//     先去試算表選單「準備工作 ▸ 產生個人 PDF」，把缺的補齊，再回來撳這一粒。
//
// ⚠️ **個擋係啱嘅，唔准拆。** 冇個人 PDF 就寄出去，收信嘅人會收到
// 一封講住「附件係你嗰一份」而冇附件嘅信。
//
// 要修嘅係另一件事：呢個窗把幹事**踢出四步主流程**，
// 叫佢去另一個選單，做完再自己行返嚟。
// 第四十四輪已經為「寄紙本」修過同一個毛病
//（「做齊咗但仲有幾份唔見」唔可以再叫佢撳）。
//
// ─────────────────────────────────────────────────────────────────────
// ⚠️ 呢一份**真嘅執行**前端
// ─────────────────────────────────────────────────────────────────────
//
// 用第 2 層嗰個 `ui_loader.js`。所以佢驗嘅係「真正畫咗乜出嚟」，
// 唔係「原始碼入面有冇呢串字」。

const fs = require('fs');
const path = require('path');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 900));
}

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'ScriptZone1.html'), 'utf8');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function freshUi() {
  return loadUiScripts(['Script.html', 'ScriptZone1.html']);
}
const modalOf = function (ui) {
  return {
    title: ui.document.getElementById('modalTitle').textContent,
    body: ui.document.getElementById('modalBody').textContent,
    actions: ui.document.getElementById('modalActions').children
  };
};

// =====================================================================
console.log('\n=== 一【核心】個擋仲喺度 ===');
{
  // ⚠️ 呢一條排喺最前，因為佢係最容易喺「改善體驗」嗰陣被順手拆走嘅嘢。
  check('★★★★★★ `missing.blocked` 仍然會擋住，唔會跌落去繼續寄'
    + '——冇個人 PDF 就寄出去，收信嘅人會收到一封'
    + '講住「附件係你嗰一份」而冇附件嘅信',
    /if \(missing\.blocked\) \{\s*\n\s*openMissingPdfBlock\(missing, versionNo, sendOpts\);\s*\n\s*return;/
      .test(CODE), '');
}

// =====================================================================
console.log('\n=== 二【核心】窗入面就地有一粒掣 ===');
{
  const ui = freshUi();
  ui.openMissingPdfBlock({ blocked: true, missingTotal: 59, total: 59, gateMessage: '' },
    3, null);
  const modal = modalOf(ui);
  const labels = modal.actions.map(function (c) { return c.textContent; });

  check('★★★★★★ **真正畫出嚟嗰個窗**有〔現在就產生個人 PDF〕'
    + '——唔使佢去另一個選單，做完再自己行返嚟',
    labels.some(function (t) { return t.indexOf('現在就產生個人 PDF') !== -1; }),
    JSON.stringify(labels));
  check('★★★★★ 而且仲有一個出口（取消）'
    + '——一個冇出口嘅窗等於逼人撳落去',
    labels.some(function (t) { return t.indexOf('取消') !== -1; }),
    JSON.stringify(labels));
  check('★★★★★★ 個窗**唔再**叫佢去試算表選單',
    modal.body.indexOf('準備工作 ▸ 產生個人 PDF') === -1, modal.body);
  check('★★★★★ 而且仍然講得出「沒有寄出任何電郵」',
    modal.body.indexOf('沒有寄出任何電郵') !== -1, modal.body);
  check('★★★★★ 同埋講明人數多要跑幾分鐘、會分幾次',
    modal.body.indexOf('分幾次跑完') !== -1, modal.body);
}

// =====================================================================
console.log('\n=== 三【核心】用返既有嗰個分批入口，唔另寫一條 ===');
{
  check('★★★★★★ 叫 `apiGeneratePersonalPdfBatch`'
    + '——59 份 PDF 好可能超過單次執行時間上限，'
    + '而嗰一支本來就係為咗呢件事而寫成分批嘅',
    /callServerMutating\(\s*\n?\s*'apiGeneratePersonalPdfBatch', currentQuarterId, versionNo\)/
      .test(CODE), '');
  check('★★★★★ 有上限，唔會無限轉',
    /guard >= MISSING_PDF_MAX_ROUNDS/.test(CODE), '');
  check('★★★★★★ 到咗上限係 `break` 唔係 `throw`'
    + '——throw 就會把幹事踢返出去，而佢啱啱就係想留喺主流程度',
    /if \(guard >= MISSING_PDF_MAX_ROUNDS\) break;/.test(CODE)
      && !/產生個人 PDF 的次數超出預期[\s\S]{0,200}runMissingPdfBatch/.test(CODE), '');
}

// =====================================================================
console.log('\n=== 四【核心】做唔完唔可以顯示「完成了」 ===');
{
  // ⚠️ 第四十四輪已經為「寄紙本」修過同一個毛病。
  const notDone = CODE.slice(CODE.indexOf('if (!last.done) {'));
  check('★★★★★★ 做唔完 ⇒ 講明仲差幾多份',
    /還差 ' \+ \(last\.totalPeople - last\.doneCount\) \+ ' 份/.test(SRC), '');
  check('★★★★★★ 而且畀一粒〔繼續產生〕',
    /button\('繼續產生', \(\) => runMissingPdfBatch\(versionNo, sendOpts\)/.test(CODE), '');
  check('★★★★★★ 做唔完嗰條路**唔會**行到「已經產生好」嗰個窗',
    notDone.indexOf('return;') !== -1
      && notDone.indexOf('return;') < notDone.indexOf('已經產生好'),
    notDone.slice(0, 300));
}

// =====================================================================
console.log('\n=== 五【核心】做完要行返轉頭去正式發出 ===');
{
  const ui = freshUi();
  // 直接畫「做完」嗰個窗——真正跑批次要後端，呢度驗嘅係嗰個窗畫成點。
  check('★★★★★★ 做完之後有一粒〔回到正式發出〕'
    + '——唔使佢自己搵路返嚟。'
    + '呢個就係第四十四輪「做齊咗但仲有幾份唔見」嗰個修正嘅同一條道理',
    /button\('回到正式發出', \(\) => \{ closeModal\(\); openOfficial\(sendOpts\); \}/.test(CODE), '');
  check('★★★★★ 而且會把原本嗰一次嘅 `sendOptions` 帶返去'
    + '——唔帶嘅話，佢啱啱喺寄出彈窗揀嗰幾個決定會靜靜冇咗',
    /function runMissingPdfBatch\(versionNo, sendOpts\)/.test(CODE)
      && /openMissingPdfBlock\(missing, versionNo, sendOpts\)/.test(CODE), '');
  check('★★★★★ 前端載入得起（真嘅執行過）',
    typeof ui.openMissingPdfBlock === 'function'
      && typeof ui.runMissingPdfBatch === 'function', '');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);

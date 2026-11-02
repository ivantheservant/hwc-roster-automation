// 第九十二輪批次 SC 組：錯誤訊息和提示叫幹事去的位置，必須是畫面上真的有的。
// 執行方式：node tests/round92_sc_guidance_targets.test.js
//
//   SC1 src/ 使用者可見字串不得再出現「進階功能」（畫面上的區名是「進階與診斷」）
//   SC2 凡是「進階與診斷 ▸ X」「常用設定 ▸ X」，X 必須是畫面上存在的行名——由原始碼的
//       zone4Row( 和 renderRepublishEntry 的行名讀出，不寫死清單
//   SC3 已經拿走的入口不可以再被指去：手動生成初稿、檢查各版本派工紀錄（只有試算表選單 Menu.gs 有）、回到上一個版本
//   SC4 自我檢查：把一個行名改錯 ⇒ 掃描會報

const fs = require('fs');
const path = require('path');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 1200));
}
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function listSourceFiles() {
  const out = [];
  fs.readdirSync(SRC).forEach((f) => { if (/\.gs$/.test(f)) out.push(path.join(SRC, f)); });
  const uiDir = path.join(SRC, 'ui');
  fs.readdirSync(uiDir).forEach((f) => { if (/\.(html|gs)$/.test(f)) out.push(path.join(uiDir, f)); });
  return out;
}

/** 去掉註解，只留會顯示給使用者的字串所在的程式碼。保留換行，行號不跑掉。 */
function stripComments(text) {
  return text
    .replace(/<!--[\s\S]*?-->/g, (b) => b.replace(/[^\n]/g, ' '))
    .replace(/\/\*[\s\S]*?\*\//g, (b) => b.replace(/[^\n]/g, ' '))
    .replace(/^(\s*)\/\/.*$/gm, '$1');
}

/** 由原始碼讀出兩個區在畫面上的行名。 */
function readScreenRows(files) {
  const rows = { '進階與診斷': new Set(), '常用設定': new Set() };
  const zone4 = fs.readFileSync(path.join(SRC, 'ui', 'ScriptZone4.html'), 'utf8');
  const zone3 = fs.readFileSync(path.join(SRC, 'ui', 'ScriptZone3.html'), 'utf8');
  const rowRe = /zone4Row\(\s*'([^']+)'/g;
  let m;
  while ((m = rowRe.exec(stripComments(zone4))) !== null) rows['進階與診斷'].add(m[1]);
  while ((m = rowRe.exec(stripComments(zone3))) !== null) rows['常用設定'].add(m[1]);
  // 〔重新發佈公開連結〕那一行不是 zone4Row()，是 renderRepublishEntry() 自己畫的，行名在 act-name
  // 畫面上的小標題（例如「匯入人手編好的職事表」）也是畫面上有的位置；只取 renderZone4 畫出來的那幾個
  const body4 = z4Body_(zone4);
  const secRe = /sectionTitle\('([^']+)'\)/g;
  while ((m = secRe.exec(body4)) !== null) rows['進階與診斷'].add(m[1]);
  // 「常用設定」裏開試算表分頁的連結行（settingsSheetLink）
  const linkRe = /settingsSheetLink\(\s*'([^']+)'/g;
  while ((m = linkRe.exec(stripComments(zone3))) !== null) rows['常用設定'].add(m[1]);
  const actRe = /text:\s*'([^']+)',\s*className:\s*'act-name'/g;
  const z4 = stripComments(zone4);
  const republish = z4.slice(z4.indexOf('function renderRepublishEntry'), z4.indexOf('function zone4Row'));
  while ((m = actRe.exec(republish)) !== null) rows['進階與診斷'].add(m[1]);
  return rows;
}

function z4Body_(zone4) {
  const t = stripComments(zone4);
  return t.slice(t.indexOf('function renderZone4'), t.indexOf('function openEnsureFutureQuarters'));
}

/** 掃出所有「區名 ▸ X」的指引。 */
function scanGuidance(files, rows) {
  const problems = [];
  const re = /(進階與診斷|常用設定)\s*▸\s*([^」'"，。、；\n]+)/g;
  files.forEach((file) => {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    const text = stripComments(fs.readFileSync(file, 'utf8'));
    text.split('\n').forEach((line, i) => {
      let m;
      while ((m = re.exec(line)) !== null) {
        const zone = m[1]; const name = m[2].trim();
        if (name === '') continue; // 「▸ 進階與診斷 ▸ 」後面緊接一粒按鈕（按鈕字樣另外驗證）
        if (!rows[zone].has(name)) {
          problems.push(rel + ':' + (i + 1) + '　「' + zone + ' ▸ ' + name + '」→ 畫面上「' + zone + '」沒有這一行');
        }
      }
    });
  });
  return problems;
}

const files = listSourceFiles();
const rows = readScreenRows(files);

console.log('\n=== 前置：由原始碼讀出畫面的行名 ===');
check('★★★★★ 讀到「進階與診斷」至少 15 行（讀不到的話下面全部是假綠燈）', rows['進階與診斷'].size >= 15, JSON.stringify([...rows['進階與診斷']]));
check('★★★★ 包括「系統出問題時怎樣做」「重新發佈公開連結」「建立未來季度」',
  ['系統出問題時怎樣做', '重新發佈公開連結', '建立未來季度'].every((n) => rows['進階與診斷'].has(n)));
check('★★★★★ 「常用設定」有「整季重設」', rows['常用設定'].has('整季重設'), JSON.stringify([...rows['常用設定']]));
check('★★★★ 已經拿走的「回到上一個版本」不在畫面上', !rows['進階與診斷'].has('回到上一個版本'));

console.log('\n=== SC1：「進階功能」 ===');
{
  const hits = [];
  files.forEach((file) => {
    stripComments(fs.readFileSync(file, 'utf8')).split('\n').forEach((line, i) => {
      if (line.indexOf('進階功能') !== -1) hits.push(path.relative(ROOT, file).replace(/\\/g, '/') + ':' + (i + 1) + '　' + line.trim());
    });
  });
  check('★★★★★★ src/ 使用者可見字串沒有「進階功能」', hits.length === 0, hits.join('\n'));
}

console.log('\n=== SC2：指向「進階與診斷」「常用設定」的行名都存在 ===');
{
  const problems = scanGuidance(files, rows);
  check('★★★★★★ 每一處「區名 ▸ 行名」都對得上畫面', problems.length === 0, problems.join('\n'));
  let count = 0;
  const re = /(進階與診斷|常用設定)\s*▸/g;
  files.forEach((f) => { count += (stripComments(fs.readFileSync(f, 'utf8')).match(re) || []).length; });
  check('★★★★ 掃描真的掃到指引（至少 8 處）', count >= 8, String(count));
}

console.log('\n=== SC3：已經拿走或根本不在畫面的入口 ===');
{
  const banned = ['手動生成初稿', '進階與診斷 ▸ 回到上一個版本', '進階與診斷 ▸ 檢查各版本派工紀錄'];
  const hits = [];
  files.forEach((file) => {
    stripComments(fs.readFileSync(file, 'utf8')).split('\n').forEach((line, i) => {
      banned.forEach((b) => { if (line.indexOf(b) !== -1) hits.push(path.relative(ROOT, file) + ':' + (i + 1) + '　' + b); });
    });
  });
  check('★★★★★ 沒有指去「手動生成初稿」「進階與診斷 ▸ 回到上一個版本」「進階與診斷 ▸ 檢查各版本派工紀錄」', hits.length === 0, hits.join('\n'));

  // 「檢查各版本派工紀錄」只有試算表選單（Menu.gs）有；其他使用者可見字串不可以叫人去「檢查各版本派工紀錄」
  const other = [];
  files.forEach((file) => {
    if (/Menu\.gs$/.test(file)) return;
    stripComments(fs.readFileSync(file, 'utf8')).split('\n').forEach((line, i) => {
      if (/去「檢查各版本派工紀錄|或者去「檢查各版本派工紀錄/.test(line)) other.push(path.relative(ROOT, file) + ':' + (i + 1));
    });
  });
  check('★★★★ 幹事介面沒有叫人去「檢查各版本派工紀錄」（畫面沒有這一行）', other.length === 0, other.join('\n'));

  const save = read('src/WebAppSaveConfirm.gs');
  check('★★★★★ 沒有任何版本 ⇒ 指去「主畫面「第 1 步：生成下一季職事表」」；第 1 步的標題真的是這句',
    save.indexOf('在主畫面「第 1 步：生成下一季職事表」自己生成一次') !== -1
    && read('src/ui/ScriptMainFlow.html').indexOf("title: '生成下一季職事表'") !== -1);
  check('★★★★★ 想退回舊版本 ⇒ 指去第 2 步版本清單的〔用這一版作起點〕；這個按鈕真的存在',
    save.indexOf('按〔用這一版作起點〕') !== -1
    && read('src/ui/ScriptMainFlow.html').indexOf("stepButton('用這一版作起點'") !== -1);
}

console.log('\n=== SC4：自我檢查（把行名改錯 ⇒ 要報）===');
{
  const realRead = fs.readFileSync;
  fs.readFileSync = function (p, enc) {
    const t = realRead.apply(fs, arguments);
    if (typeof t === 'string' && /WebAppSaveConfirm\.gs$/.test(String(p))) {
      return t.replace('進階與診斷 ▸ 系統出問題時怎樣做', '進階與診斷 ▸ 系統出問題時怎樣辦');
    }
    return t;
  };
  let problems;
  try { problems = scanGuidance(files, rows); } finally { fs.readFileSync = realRead; }
  check('★★★★★★ 行名改錯（「怎樣辦」）⇒ 掃描報出', problems.length > 0 && /怎樣辦/.test(problems.join()), problems.join('\n'));
}

console.log('\n=== SC5：指南及週報說明（不在 repo 的檔案存在才檢查）===');
{
  const targets = ['guide/指南內容.md', 'guide/快速指南內容.md', 'guide/新功能快速指南內容.md', 'docs/週報系統讀取職事表資料說明.md'];
  let checked = 0;
  targets.forEach((f) => {
    if (!fs.existsSync(path.join(ROOT, f))) return;
    checked++;
    const text = read(f);
    const hits = text.split('\n').map((l, i) => [i + 1, l]).filter((x) => /進階功能|手動生成初稿|進階與診斷 ▸ (回到上一個版本|檢查各版本派工紀錄)/.test(x[1]));
    check('★★★★ ' + f + ' 沒有「進階功能」或不存在的行名', hits.length === 0, hits.map((x) => x[0] + ': ' + x[1]).join('\n'));
  });
  if (checked === 0) console.log('SKIP  指南檔不在 repo，略過');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);

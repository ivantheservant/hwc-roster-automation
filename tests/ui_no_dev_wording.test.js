// 第六十三輪批次 N 組：錯字名稱提示指向不存在嘅位置，而且用咗「下一輪」呢種開發者用語。
// 執行方式：node tests/ui_no_dev_wording.test.js
//
// `ui/ScriptZone1.html`：「去『名單維護 ▸ 人員與電郵 ▸ 別名』加別名
// （下一輪才搬上來，暫時請用試算表的 NameAlias 工作表）」。
// 別名入口其實已經喺「人員與電郵」入面（一粒「別名」掣），而「下一輪」
// 對幹事冇意思。

const fs = require('fs');
const path = require('path');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 600));
}
const UI = path.join(__dirname, '..', 'src', 'ui');
const read = (n) => fs.readFileSync(path.join(UI, n), 'utf8');
// 淨係睇幹事見到嘅字：拆走註解
const visible = (src) => src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

console.log('\n=== N【核心】畫面上冇「下一輪」 ===');
{
  const hits = [];
  fs.readdirSync(UI).filter(function (n) { return /\.html$/.test(n); }).forEach(function (n) {
    visible(read(n)).split('\n').forEach(function (line, i) {
      if (line.indexOf('下一輪') !== -1) hits.push(n + ':' + (i + 1) + '  ' + line.trim().slice(0, 80));
    });
  });
  check('★★★★★ ui/*.html 幹事見到嘅字入面一個「下一輪」都冇（開發者用語，幹事唔知係幾時）',
    hits.length === 0, hits.join('\n'));
}

console.log('\n=== N：錯字提示指去真係存在嘅位置 ===');
{
  const zone1 = visible(read('ScriptZone1.html'));
  const zone3 = read('ScriptZone3.html');
  check('★★★★★ 提示指去「名單維護 ▸ 人員與電郵 ▸ 別名」掣',
    /撳「人員與電郵」，再撳「別名」加一個別名/.test(zone1));
  check('★★★★★ 而嗰兩粒掣真係存在（唔係指去一個唔存在嘅位置）',
    /button\('人員與電郵', \(\) => openPeople\(\)/.test(zone3) && /button\('別名', \(\) => openAliases\(\)/.test(zone3));
  check('★★★★ 唔再叫幹事去改試算表嘅 NameAlias 工作表', zone1.indexOf('暫時請用試算表的 NameAlias') === -1);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);

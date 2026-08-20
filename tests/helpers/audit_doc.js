/**
 * 第三十九輪批次 F 組：讀稽核文件嘅**唯一**入口。
 *
 * ═════════════════════════════════════════════════════════════════════
 * 點解要有呢個 helper
 * ═════════════════════════════════════════════════════════════════════
 *
 * `docs/系統範圍稽核.md` 本來係一個檔，去到第三十九輪已經 8853 行。
 * 呢一輪拆成每十輪一個檔，主檔只留索引同結論。
 *
 * 但係有十幾份測試寫住 `read('docs/系統範圍稽核.md').indexOf('…')`——
 * 拆完之後嗰啲字全部搬咗去分檔，主檔搵唔到，於是嗰啲測試會逐個變紅，
 * **而變紅嗰陣同佢哋要守嗰件事一啲關係都冇**。
 *
 * 逐個檔改成「主檔 ＋ 分檔一齊搵」係錯嘅做法：
 * 下一次再拆（第四十九輪？）又要逐個改一次，而漏改嘅代價係一條假紅燈。
 *
 * 所以改成一個入口：`readAuditDoc()` 一次過讀晒主檔同全部分檔。
 * 之後再點拆，呢一份改一次就得。
 */

const fs = require('fs');
const path = require('path');

const DOCS = path.join(__dirname, '..', '..', 'docs');
const MAIN = '系統範圍稽核.md';

/**
 * 主檔 ＋ 全部分檔嘅內容，接埋一齊。
 *
 * ⚠️ 一個檔都讀唔到嘅時候**要拋錯**，唔可以回一個空字串——
 * 回空字串嘅話，全部「文件有冇寫低理由」嗰類斷言都會靜靜變紅，
 * 而真正嘅成因（讀錯路徑）冇任何線索。
 *
 * @returns {string} 全部內容
 */
function readAuditDoc() {
  const files = [MAIN].concat(
    fs.readdirSync(DOCS).filter(function (f) {
      return /^系統範圍稽核_第\d+-\d+輪\.md$/.test(f);
    }).sort()
  );
  const parts = [];
  files.forEach(function (f) {
    const p = path.join(DOCS, f);
    if (!fs.existsSync(p)) return;
    parts.push(fs.readFileSync(p, 'utf8'));
  });
  if (parts.length === 0) {
    throw new Error('readAuditDoc()：一份稽核文件都讀唔到（' + DOCS + '）。'
      + '係咪拆檔嘅命名規則改咗？');
  }
  return parts.join('\n');
}

module.exports = { readAuditDoc, AUDIT_MAIN: MAIN };

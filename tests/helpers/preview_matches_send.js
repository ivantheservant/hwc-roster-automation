// 第四十七輪批次 B4 組：**事前講「會寄給 N 位」，事後就一定要寄到 N 封。**
//
// ═════════════════════════════════════════════════════════════════════
// 點解要有呢個共用斷言
// ═════════════════════════════════════════════════════════════════════
//
// 現場：同一次操作，兩個畫面前後腳出現——
//
//   確認窗　「會寄給這 3 位」
//   完成窗　「寄出 0 封　模擬 9 封　查無電郵略過 0 位」
//
// **3 ≠ 9。**
//
// 成因唔係其中一個數字算錯咗，而係**同一件事有兩個算法**：
// 事前嗰個數 `EmailRecipients` 上嘅審閱者，事後嗰個行第四十六輪
// 新做嘅收件人池。第四十六輪改咗後者而冇改前者。
//
// 第四十三輪已經立過一條規矩：「對話框報嘅每一個數字，
// 表上都要有對應嘅嘢」。呢一條係嗰條規矩喺**寄出**呢一條路上嘅具體形態。
//
// ⚠️ 呢個 helper 刻意收得好窄：佢淨係比一個數。
// 佢唔會驗「係咪同一批人」——嗰個由 `resolveActualRecipients_()`
// 係唯一來源呢件事本身保證。呢度守嘅係**最容易靜靜漂走嗰樣嘢**：
// 有人日後為咗方便，喺 plan 嗰邊加返一句「順手數一數」。

/**
 * 斷言「事前預覽嘅收件人數」＝「實際寄出嘅總數」。
 *
 * @param {Function} check 測試檔自己嗰個 `check(label, cond, extra)`
 * @param {string} stageLabel 畀人睇嘅階段名（例如「步驟 2 寄給堂委審閱」）
 * @param {number} previewCount `plan*` 回嘅 `recipientCount`
 * @param {Object} result `execute*` 回嘅統計
 * @returns {void}
 */
function assertPreviewMatchesSend(check, stageLabel, previewCount, result) {
  const r = result || {};
  const num = function (v) { return typeof v === 'number' ? v : 0; };
  // ⚠️ 要把**每一種結果**加埋，唔係淨係加 `sent`。
  // 一個查無電郵被略過嘅人，事前一樣有喺名單度出現過——
  // 淨數 `sent` 就會變成「事前 9 位、事後 7 封」，
  // 而嗰個差額冇任何一個畫面解釋得到。
  const total = num(r.sent) + num(r.dryRun) + num(r.skipped)
    + num(r.unchanged) + num(r.failed) + num(r.errorPdf) + num(r.errorPdfMissing);

  check('★★★★★★ ' + stageLabel + '：**事前講嘅收件人數 ＝ 實際寄出嘅總數**'
    + '——現場就係「會寄給這 3 位」對住「模擬 9 封」，'
    + '成因係同一件事有兩個算法',
    previewCount === total,
    '事前 ' + previewCount + ' 位；實際 ' + total + ' 封（'
    + JSON.stringify({
      sent: num(r.sent), dryRun: num(r.dryRun), skipped: num(r.skipped),
      unchanged: num(r.unchanged), failed: num(r.failed),
      errorPdf: num(r.errorPdf), errorPdfMissing: num(r.errorPdfMissing)
    }) + '）');
}

module.exports = { assertPreviewMatchesSend: assertPreviewMatchesSend };

// 第六十二輪批次 A4 組：**扮演「還原嗰個寫入失敗」。**
//
// 用法（由 `tests/verify_red_restore.test.js` 叫）：
//
//   node --require tests/helpers/fail_restore_write.js tools/verify-red.js
//
// ═════════════════════════════════════════════════════════════════════
// 佢做緊乜
// ═════════════════════════════════════════════════════════════════════
//
// `verify-red` 每處理一條突變，就對同一個檔案寫兩次：
//
//   第 1 次　寫入突變版本
//   第 2 次　**還原**返原文　← 就係呢一次喺現場拋過錯
//
// 呢個 preload 攔住 `fs.writeFileSync`，畀第 1 次過，第 2 次拋一個
// 同現場一模一樣嘅錯：
//
//   UNKNOWN: unknown error, open '<檔案>'
//
// 原文（第六十一輪實測，Synology 同步鎖住咗個檔）：
//
//   node:fs:2430
//   Error: UNKNOWN: unknown error, open
//     'C:\HWC\SynologyDrive\Roster\claudecode\src\Mailer.gs'
//       at Object.writeFileSync (node:fs:2430:20)
//       at C:\...\tools\verify-red.js:3638:8
//
// ⚠️ 只攔 `src/` 底下嘅檔案。攔到其他嘢（例如 Node 自己寫暫存檔）
// 就會變成一個測唔到重點而且亂咁死嘅測試。

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', '..', 'src') + path.sep;
const real = fs.writeFileSync;
let srcWrites = 0;

// 第幾次寫 `src/` 嗰陣拋錯。
//   2（預設）＝ 還原嗰一次　　　⇒ A1 接得住，乾淨停低
//   1　　　　＝ 落突變嗰一次　　⇒ **冇人接**，成支工具拋錯死
//
// ⚠️ 第二種先至係「收尾鈎有冇用」嘅真正考驗：A1 嗰個 try／catch
// 喺呢個情況下完全幫唔到手，唯一會行到嘅就係 `process.on('exit')`。
const FAIL_AT = Number(process.env.FAIL_SRC_WRITE_AT) || 2;

fs.writeFileSync = function (file, data, options) {
  const p = String(file);
  if (p.indexOf(SRC_DIR) === 0) {
    srcWrites++;
    if (srcWrites === FAIL_AT) {
      const err = new Error("UNKNOWN: unknown error, open '" + p + "'");
      err.code = 'UNKNOWN';
      err.syscall = 'open';
      err.path = p;
      throw err;
    }
  }
  return real.call(fs, file, data, options);
};

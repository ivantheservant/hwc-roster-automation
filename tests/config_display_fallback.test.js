// 階段 A（第五輪批次）：Config 缺 Key 時，顯示邏輯不可輸出 undefined／null／
// 誤導性空白的回歸測試。
// 執行方式：node tests/config_display_fallback.test.js
// 移植 Config.gs 的 describeConfigValue_()（逐字相同的判斷準則），並模擬
// Diagnostics.gs／Menu.gs 實際組出來的顯示字串，確認任何情況都不會出現
// 字面文字「undefined」或「null」。

// ---- 移植：Config.gs 的 describeConfigValue_()（逐字相同）----
function describeConfigValue_(config, key, fallback) {
  const raw = config[key];
  const usedFallback = raw === undefined || raw === null || raw === '';
  const value = usedFallback ? fallback : raw;
  return {
    value: value,
    usedFallback: usedFallback,
    display: String(value) + (usedFallback ? '（Config 未設定，用預設值）' : '')
  };
}

let fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}
function checkNoLiteralUndefinedOrNull(label, text) {
  const ok = text.indexOf('undefined') === -1 && text.indexOf('null') === -1;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      文字裡出現了 undefined／null 字樣：「${text}」`);
}

console.log('\n=== Config 完全沒有這個 Key（模擬「補建 Config 參數」從未執行過）===');
{
  const emptyConfig = {}; // readConfig() 對一張沒有登記任何 Key 的 Config 工作表就是回傳這樣的物件

  const dryRun = describeConfigValue_(emptyConfig, 'DRY_RUN', true);
  check('★ DRY_RUN 缺 Key → value 用預設值 true（不是 undefined）', dryRun.value, true);
  check('★ DRY_RUN 缺 Key → usedFallback=true', dryRun.usedFallback, true);
  checkNoLiteralUndefinedOrNull('★ DRY_RUN 缺 Key → display 不含「undefined」字樣', dryRun.display);
  check('★ DRY_RUN 缺 Key → display 明確標註用了預設值', dryRun.display.indexOf('用預設值') !== -1, true);

  const webappEnabled = describeConfigValue_(emptyConfig, 'WEBAPP_ENABLED', false);
  check('★ WEBAPP_ENABLED 缺 Key → value 用預設值 false（不是 undefined）', webappEnabled.value, false);
  checkNoLiteralUndefinedOrNull('★ WEBAPP_ENABLED 缺 Key → display 不含「undefined」字樣', webappEnabled.display);

  const sendHour = describeConfigValue_(emptyConfig, 'SEND_HOUR_LOCAL', 9);
  check('★ SEND_HOUR_LOCAL 缺 Key → value 用預設值 9', sendHour.value, 9);
  checkNoLiteralUndefinedOrNull('★ SEND_HOUR_LOCAL 缺 Key → display 不含「undefined」字樣', sendHour.display);

  const allowedEmails = describeConfigValue_(emptyConfig, 'WEBAPP_ALLOWED_EMAILS', []);
  check('★ WEBAPP_ALLOWED_EMAILS 缺 Key → value 用預設值空陣列', allowedEmails.value, []);
  checkNoLiteralUndefinedOrNull('★ WEBAPP_ALLOWED_EMAILS 缺 Key → display 不含「undefined」字樣', allowedEmails.display);
}

console.log('\n=== Config 明確存有這個 Key（正常情況）：不應該標註「用預設值」===');
{
  const fullConfig = { DRY_RUN: false, WEBAPP_ENABLED: true, SEND_HOUR_LOCAL: 21, MAIL_SUBJECT_PREFIX: '假前綴' };

  const dryRun = describeConfigValue_(fullConfig, 'DRY_RUN', true);
  check('★ DRY_RUN=false（明確設定）→ value 就是 false，不是預設值 true', dryRun.value, false);
  check('★ 明確設定時 usedFallback=false', dryRun.usedFallback, false);
  check('★ 明確設定時 display 不含「用預設值」字樣', dryRun.display.indexOf('用預設值') === -1, true);
  check('★ display 正確顯示 false', dryRun.display, 'false');

  const webappEnabled = describeConfigValue_(fullConfig, 'WEBAPP_ENABLED', false);
  check('★ WEBAPP_ENABLED=true（明確設定）→ value 就是 true', webappEnabled.value, true);

  const prefix = describeConfigValue_(fullConfig, 'MAIL_SUBJECT_PREFIX', '');
  check('★ MAIL_SUBJECT_PREFIX 明確設定 → 正確顯示內容', prefix.display, '假前綴');
}

console.log('\n=== 值為空字串（Config 有這一行但 Value 欄留白）：視同缺 Key，一律退回預設值 ===');
{
  const blankValueConfig = { MAIL_SUBJECT_PREFIX: '' };
  const prefix = describeConfigValue_(blankValueConfig, 'MAIL_SUBJECT_PREFIX', '（預設前綴）');
  check('★ 空字串視同缺 Key → 用預設值', prefix.value, '（預設前綴）');
  check('★ usedFallback=true', prefix.usedFallback, true);
}

console.log('\n=== 邊界：DRY_RUN=false 這個「假值」（falsy）不可以被誤判成「缺 Key」===');
{
  // 這是這個判斷邏輯最容易寫錯的地方：如果用 `!raw` 判斷「有沒有設定」，
  // DRY_RUN=false／WEBAPP_ENABLED=false 這些合法的 boolean false 會被誤判成
  // 「沒有設定」，錯誤地套用預設值，可能把幹事明確設定的 FALSE 顯示成別的值。
  // describeConfigValue_() 用嚴格的 `undefined／null／''` 判斷，不會誤傷 false。
  const config = { DRY_RUN: false };
  const dryRun = describeConfigValue_(config, 'DRY_RUN', true);
  check('★ DRY_RUN=false（明確設定的假值）→ 不會被誤判成缺 Key', dryRun.usedFallback, false);
  check('★ value 正確保留 false，不會被預設值 true 覆蓋', dryRun.value, false);

  const config2 = { WEBAPP_ENABLED: false };
  const webappEnabled = describeConfigValue_(config2, 'WEBAPP_ENABLED', true /* 故意給一個跟預期不同的 fallback */);
  check('★ WEBAPP_ENABLED=false（明確設定）→ 不受 fallback 影響，保留 false', webappEnabled.value, false);
}

console.log('\n=== 模擬 Diagnostics.gs／Menu.gs 實際組出來的整段訊息文字：不可含 undefined／null ===');
{
  const emptyConfig = {};
  const dryRun = describeConfigValue_(emptyConfig, 'DRY_RUN', true);
  const webappEnabled = describeConfigValue_(emptyConfig, 'WEBAPP_ENABLED', false);

  // 模擬 Menu.gs 的 runReloadConfig_() 組字串的方式
  const reloadMessage = '已清除 Config 快取，以下是剛從工作表重新讀取的目前值：\n\n'
    + 'DRY_RUN：' + dryRun.display;
  checkNoLiteralUndefinedOrNull('★ 「重新載入設定」訊息文字不含 undefined／null', reloadMessage);

  // 模擬 Diagnostics.gs 的 Config 區塊組出的行
  const diagLines = [
    'Config｜' + 'DRY_RUN' + '｜' + dryRun.display,
    'Config｜' + 'WEBAPP_ENABLED' + '｜' + webappEnabled.display
  ].join('\n');
  checkNoLiteralUndefinedOrNull('★ Diagnostics 的 Config 區塊不含 undefined／null', diagLines);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);

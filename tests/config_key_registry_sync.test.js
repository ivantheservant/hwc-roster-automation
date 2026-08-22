// 第三十三輪批次階段 B2：`CONFIG_KEYS`／`ConfigSeed.gs`／`DEFAULTS` 三方對照。
// 執行方式：node tests/config_key_registry_sync.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 點解要有呢一條（唔係一個漏，係一個 class）
// ═════════════════════════════════════════════════════════════════════
//
// 2026-08-20 實測：Ivan 撳「維護 ▸ 補建 Config 參數」，AuditLog 記錄
// 「1 個新 Key」——只加咗 `WEBAPP_STEWARD_URL`。`REHEARSAL_PROTECTED_QUARTERS`
// 冇加到，全面體檢仍然報佢缺席。
//
// 原因：`REHEARSAL_PROTECTED_QUARTERS` 喺 `Constants.gs` 嘅 `CONFIG_KEYS` 有登記、
// `SeasonRehearsal.gs` 有用，但 `ConfigSeed.gs` 冇對應嘅 row。
// `ConfigSeed.gs` 係一張**人手維護**嘅清單，加 Key 嗰陣漏咗佢。
//
// **任何新 Config Key 只要漏咗 seed row，就永遠建唔出嚟**，
// 而全面體檢會每次都報同一項——變成一個冇人會再理嘅長期警告。
// 呢個就係本專案 bug class 第 3 條：同一個狀態有兩個真相來源，
// 而我只更新咗其中一個。
//
// `src/ConfigSeed.gs` 本身已經有 `checkConfigKeyRegistryGaps_()` 做同一件事，
// **但佢淨係喺選單對話框報告，唔喺 push gate 之內**——所以佢報咗都冇人擋得住。
// 呢一條測試就係要令佢變成一道閘。

const { loadGasSource } = require('./helpers/gas_loader');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log(extra.split('\n').map(function (l) { return '      ' + l; }).join('\n'));
}

// 第四十七輪批次 D／E 組：`ConfigSeed.gs` 嘅 seed 清單引用咗
// `COMBINED_DEFAULT_SKIP_POST_IDS_DEFAULT`（CombinedSkipBackfill.gs）同
// `QUARTER_RESET_BLOCKED_DEFAULT`（QuarterReset.gs）。
// ⚠️ 一樣唔喺呢度手抄——載入真正嗰兩支檔案，等 seed 讀到嘅就係真值。
const gas = loadGasSource([
  'Constants.gs', 'ConfigSeed.gs', 'CombinedSkipBackfill.gs', 'QuarterReset.gs'
]);

// `getConfigKeySeeds_()` 其中一行嘅 defaultValue 係
// `SpreadsheetApp.getActiveSpreadsheet().getId()`（ROSTER_SPREADSHEET_ID），
// 呢個係合理嘅——補建嗰陣本來就要填當前試算表 ID。測試只需要佢唔拋錯。
gas.SpreadsheetApp = { getActiveSpreadsheet: function () { return { getId: function () { return 'mock-spreadsheet-id'; } }; } };
// SeasonRehearsal.gs 冇載入（會拉一大串無關依賴），但 seed 清單引用咗佢一個常數。
//
// ⚠️ 呢個值**由 `src/SeasonRehearsal.gs` 嘅原始碼直接讀出嚟**，唔可以喺呢度
// 手抄一個字面值——手抄嘅話下面「seed 同程式 fallback 一致」嗰條斷言就會
// 變成同義反覆（我自己塞落去、再同自己比），改壞咗 SeasonRehearsal.gs
// 都照樣全綠。呢個正正就係本專案 bug class 第 3 條。
const fsForConst = require('fs');
const pathForConst = require('path');
const seasonRehearsalSrc = fsForConst.readFileSync(
  pathForConst.join(__dirname, '..', 'src', 'SeasonRehearsal.gs'), 'utf8');
const protectedDefaultMatch = seasonRehearsalSrc.match(
  /const\s+SEASON_REHEARSAL_PROTECTED_DEFAULT\s*=\s*'([^']*)'/);
if (!protectedDefaultMatch) {
  console.log('FAIL  ★★★★★ 喺 src/SeasonRehearsal.gs 搵唔到 SEASON_REHEARSAL_PROTECTED_DEFAULT 嘅定義');
  process.exit(1);
}
const SEASON_REHEARSAL_PROTECTED_DEFAULT_EXPECTED = protectedDefaultMatch[1];
gas.SEASON_REHEARSAL_PROTECTED_DEFAULT = SEASON_REHEARSAL_PROTECTED_DEFAULT_EXPECTED;

const seeds = gas.getConfigKeySeeds_();
const seededByKey = {};
seeds.forEach(function (s) { seededByKey[s.key] = s; });

const keyNames = Object.keys(gas.CONFIG_KEYS);
const registeredKeys = keyNames.map(function (n) { return gas.CONFIG_KEYS[n]; });

/* ══════════════════════════════════════════════════════════════
 * 刻意 opt-out 清單
 * ══════════════════════════════════════════════════════════════
 *
 * ⚠️ 每一個 opt-out **一定要喺呢度寫低理由**，唔可以淨係寫 key 名。
 * 一個冇理由嘅 opt-out 同「漏咗」喺讀嘅人眼中完全一樣，
 * 而分辨呢兩者正正就係呢條測試存在嘅原因。
 *
 * 現時係空嘅——即係每一個 CONFIG_KEYS 都要有 seed row。
 */
const SEED_OPT_OUT = {
  // 例：'SOME_KEY': '理由：呢個 Key 由 xxx 自動寫入，唔應該由補建功能建立空白行'
};

console.log('\n=== B2 正方向：CONFIG_KEYS 每一個都要喺 ConfigSeed.gs 有 row ===');
{
  const missing = registeredKeys.filter(function (k) {
    return !seededByKey[k] && !SEED_OPT_OUT[k];
  });
  check(`★★★★★ ${registeredKeys.length} 個 CONFIG_KEYS 全部都有 seed row`,
    missing.length === 0,
    missing.map(function (k) {
      return '`' + k + '` 在 CONFIG_KEYS 有登記但 ConfigSeed.gs 沒有 row，'
        + '補建功能建不出它。請在 ConfigSeed.gs 加一行，或加入 opt-out 清單並寫明理由。';
    }).join('\n'));
}

console.log('\n=== B2 反方向：ConfigSeed.gs 每一個 row 都要喺 CONFIG_KEYS 有登記 ===');
{
  const orphan = seeds
    .map(function (s) { return s.key; })
    .filter(function (k) { return registeredKeys.indexOf(k) === -1; });
  check(`★★★★★ ${seeds.length} 個 seed row 全部都喺 CONFIG_KEYS 有登記`,
    orphan.length === 0,
    orphan.map(function (k) {
      return '`' + k + '` 在 ConfigSeed.gs 有 row 但 CONFIG_KEYS 沒有登記——'
        + '補建功能會把一個沒有任何程式碼會讀的 Key 建到 Config 工作表上。'
        + '請在 Constants.gs 的 CONFIG_KEYS 補登記，或把這一行從 ConfigSeed.gs 移走。';
    }).join('\n'));
}

console.log('\n=== B2：opt-out 清單每一項都要有理由，而且真係仲喺 CONFIG_KEYS ===');
{
  const noReason = Object.keys(SEED_OPT_OUT).filter(function (k) {
    return !String(SEED_OPT_OUT[k] || '').trim();
  });
  check('★★★★ opt-out 清單冇任何一項係「只寫 key 名、冇寫理由」',
    noReason.length === 0, JSON.stringify(noReason));

  const stale = Object.keys(SEED_OPT_OUT).filter(function (k) {
    return registeredKeys.indexOf(k) === -1;
  });
  check('★★★★ opt-out 清單冇過期項目（Key 已經從 CONFIG_KEYS 移除但 opt-out 仲喺度）',
    stale.length === 0, JSON.stringify(stale));

  const pointless = Object.keys(SEED_OPT_OUT).filter(function (k) { return !!seededByKey[k]; });
  check('★★★★ opt-out 清單冇矛盾項目（既 opt-out 又真係有 seed row）',
    pointless.length === 0, JSON.stringify(pointless));
}

console.log('\n=== B2：seed row 本身嘅欄位要齊 ===');
{
  const REQUIRED = ['key', 'type', 'group', 'description'];
  const broken = [];
  seeds.forEach(function (s) {
    REQUIRED.forEach(function (f) {
      if (!String(s[f] === undefined ? '' : s[f]).trim()) broken.push(s.key + ' 缺 ' + f);
    });
    if (s.defaultValue === undefined) broken.push(s.key + ' 缺 defaultValue（留空要明寫成空字串）');
    if (gas.CONFIG_TYPES[s.type] === undefined) broken.push(s.key + ' 嘅 type「' + s.type + '」唔喺 CONFIG_TYPES');
  });
  check('★★★★★ 每個 seed row 嘅 key／type／group／description／defaultValue 都齊而且 type 合法',
    broken.length === 0, broken.join('\n'));
}

console.log('\n=== B2：ConfigSeed.gs 自己嗰個 checkConfigKeyRegistryGaps_() 都要乾淨 ===');
{
  // `src/ConfigSeed.gs` 本身有一個同樣用途嘅自我檢查，但佢淨係喺選單報告。
  // 呢度直接叫佢一次，令兩邊唔會各自漂移——如果將來有人只改咗其中一邊，
  // 呢條會紅。
  const gaps = gas.checkConfigKeyRegistryGaps_();
  check('★★★★★ checkConfigKeyRegistryGaps_() 報告 0 個未預期落差',
    gaps.unexpectedGaps.length === 0, JSON.stringify(gaps.unexpectedGaps));
}

console.log('\n=== B1 回歸：REHEARSAL_PROTECTED_QUARTERS 真係補返咗 ===');
{
  const row = seededByKey[gas.CONFIG_KEYS.REHEARSAL_PROTECTED_QUARTERS];
  check('★★★★★ REHEARSAL_PROTECTED_QUARTERS 有 seed row（2026-08-20 實測揭出嘅缺席）', !!row);
  if (row) {
    check('★★★★ type 係 LIST（逗號分隔嘅季度清單，由 splitList_() 讀）',
      row.type === gas.CONFIG_TYPES.LIST, row.type);
    check('★★★★★ defaultValue 同 SeasonRehearsal.gs 嘅 SEASON_REHEARSAL_PROTECTED_DEFAULT 一致'
      + '（唔一致 ⇒ 補建出嚟嗰個值同程式實際 fallback 唔同 ⇒ 又一個兩個真相來源）',
      row.defaultValue === SEASON_REHEARSAL_PROTECTED_DEFAULT_EXPECTED,
      'seed=' + row.defaultValue + ' vs 期望=' + SEASON_REHEARSAL_PROTECTED_DEFAULT_EXPECTED);
    check('★★★★ description 講到「保護邊啲季度」同「幹事點加」',
      row.description.indexOf('演練') !== -1 && row.description.indexOf('逗號') !== -1,
      row.description);
  }
}

console.log('\n=== B3：DEFAULTS 三方對照——冇任何 `DEFAULTS.X` 會解析成 undefined ===');
{
  // 真正嘅風險唔係「CONFIG_KEYS 有、DEFAULTS 冇同名欄位」——好多 Key 嘅
  // fallback 本來就係喺呼叫點直接寫（例如 `getConfig(CONFIG_KEYS.DRY_RUN, true)`）
  // 或者來自另一組常數（`SCORE_DEFAULTS`）。真正嘅風險係
  // **`getConfig(key, DEFAULTS.X)` 入面嗰個 `DEFAULTS.X` 其實唔存在**
  // ⇒ 傳咗 `undefined` 落去 ⇒ 又一個「缺失被當成正常值」嘅入口。
  // 所以呢度掃嘅係 `src/` 入面實際寫出嚟嘅 `DEFAULTS.` 引用。
  const fs = require('fs');
  const path = require('path');
  const srcDir = path.join(__dirname, '..', 'src');
  const bad = [];
  fs.readdirSync(srcDir).filter(function (f) { return f.endsWith('.gs'); }).forEach(function (f) {
    const text = fs.readFileSync(path.join(srcDir, f), 'utf8');
    // 前面唔可以係識別字字元——否則會誤中 `SCORE_DEFAULTS.` 呢類其他常數。
    const re = /(^|[^A-Za-z0-9_$])DEFAULTS\.([A-Za-z0-9_]+)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (gas.DEFAULTS[m[2]] === undefined) {
        bad.push(f + ':' + text.slice(0, m.index).split('\n').length + '  DEFAULTS.' + m[2]);
      }
    }
  });
  check('★★★★★ src/ 入面每一處 `DEFAULTS.X` 都真係有對應欄位'
    + '（解析成 undefined ⇒ getConfig() 會攞住 undefined 當 fallback）',
    bad.length === 0, bad.join('\n'));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);

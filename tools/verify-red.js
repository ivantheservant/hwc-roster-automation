#!/usr/bin/env node
// 第三十八輪批次 C 組：**一條未見過紅燈的防線，唔算防線。**
// 執行方式：node tools/verify-red.js
//
// ═════════════════════════════════════════════════════════════════════
// 點解要有呢個工具
// ═════════════════════════════════════════════════════════════════════
//
// 第三十六、三十七輪連續兩次出現同一個情況：
//   • 寫咗一條新測試去守住一個啱啱修好嘅 bug
//   • 測試綠燈
//   • 現場一撳，同一個 bug 照樣爆
//
// 成因唔係測試寫錯咗斷言，而係**冇人證明過嗰條測試真係捉得到嗰個 bug**。
// 綠燈可以有兩個來源：
//   (甲) 程式真係啱　　　　　　　　← 想要嘅
//   (乙) 測試根本冇碰到嗰段程式　  ← 假綠燈
// 淨係睇綠燈，兩者分唔開。
//
// ─────────────────────────────────────────────────────────────────────
// 做法
// ─────────────────────────────────────────────────────────────────────
//
// 落面每一項都係一個**特登整壞**：把 `src/` 入面嗰個修正還原返做舊行為，
// 然後跑對應嘅測試，**要求佢變紅**。
//   • 變紅 ⇒ 呢條防線真係踩到嗰段程式，綠燈有意義
//   • 仍然綠 ⇒ 呢條防線係假嘅，即刻報失敗
//
// 跑完一定會把檔案還原（`finally`，連拋錯都會還原）。
// 呢個工具**唔會**留低任何改動——結尾會用 `git diff` 自我核對。

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

// ─────────────────────────────────────────────────────────────────────
// 註冊表：每一項 ＝ 一個修正 ＋ 應該守住佢嘅測試
// ─────────────────────────────────────────────────────────────────────
//
// `find` 一定要係**現行程式碼入面唯一**嘅一段。搵唔到 ⇒ 報失敗
//（唔可以靜靜略過——第三十七輪就係因為 replace 冇 match 到，
//  「還原之後仍然綠」被誤讀成「測試有問題」，浪費咗一整輪）。
const MUTATIONS = [
  {
    id: 'dropdown-allow-invalid',
    why: '把名單下拉選單還原成 `setAllowInvalid(false)`'
      + '——即係「只准揀名單上的」，會把外請講員／新人／借調直接堵死',
    file: 'src/GridNameDropdown.gs',
    find: '.setAllowInvalid(true)',
    replace: '.setAllowInvalid(false)',
    tests: ['tests/main_flow_six_steps.test.js']
  },
  {
    id: 'elig-unresolved-blocks',
    why: '把名單工作表還原成「認不出的名字照樣套用」'
      + '——那個人會被靜靜移出名單，而畫面上什麼都沒有講',
    file: 'src/EligibilitySheetEditor.gs',
    find: '    blocked: unresolved.length > 0,',
    replace: '    blocked: false,',
    tests: ['tests/main_flow_six_steps.test.js']
  },
  {
    id: 'paper-list-keeps-unknown',
    why: '把紙本名單還原成「NameMapping 查不到就略過」'
      + '——幹事會少印一份，而且完全不知道少了誰',
    file: 'src/WebAppMainFlow.gs',
    find: "      nameTC: nameById[id] || ('（NameMapping 查不到這個編號：' + id + '）'),",
    replace: '      nameTC: nameById[id],',
    tests: ['tests/main_flow_six_steps.test.js']
  },
  {
    id: 'generate-target-warns',
    why: '把第 1 步還原成「不理那一季是不是已經開始／已經過去」'
      + '——幹事會在完全沒有提示的情況下生成一個他不打算生成的季度',
    file: 'src/WebAppMainFlow.gs',
    find: '  if (target.endDate && target.endDate < today) {',
    replace: '  if (false) {',
    tests: ['tests/main_flow_six_steps.test.js']
  },
  {
    id: 'classify-free-text',
    why: '把 `classifyGridCell_()` 還原成「淨係睇 personId」——'
      + '即係第三十七輪之前嘅行為：填咗自由文字嘅講員格會跌落「未能安排」',
    file: 'src/Generator.gs',
    find: "if (assignment.personId || freeText) return GRID_CELL_CLASS.ASSIGNED;",
    replace: "if (assignment.personId) return GRID_CELL_CLASS.ASSIGNED;",
    tests: ['tests/version_carry_over_all_paths.test.js']
  },
  {
    id: 'classify-pending-flag',
    why: '把 `classifyGridCell_()` 還原成「要 assignSource = SKIPPED 先算待確認」'
      + '——第三十八輪 E 組查出嘅真 bug：填過講員但個名冇咗嘅格會被講成「未能安排」'
      + '（現場 2027T3 v7 嗰個「37 + 2 = 39」指紋）',
    file: 'src/Generator.gs',
    find: "  if (flags.indexOf(RULE_IDS.NO_AUTO_GENERATE) !== -1) {",
    replace: "  if (assignment.assignSource === ASSIGN_SOURCE.SKIPPED\n    && flags.indexOf(RULE_IDS.NO_AUTO_GENERATE) !== -1) {",
    tests: ['tests/classify_call_sites.test.js']
  },
  {
    id: 'materialise-keep-name',
    why: '把 `materialiseManualEdits_()` 還原成「唔保留上一版嘅 PersonNameSnapshot」'
      + '——即係第三十六輪之前嘅行為：一儲存新版本，自由文字就冇咗',
    file: 'src/StateSource.gs',
    find: "personName: person ? person.nameTC : (s.isManual ? '' : (originalRow.personName || '')),",
    replace: "personName: person ? person.nameTC : '',",
    tests: ['tests/version_carry_over_all_paths.test.js']
  },
  {
    id: 'materialise-keep-source',
    why: '把 `materialiseManualEdits_()` 還原成「一律重算 assignSource」'
      + '——即係第三十七輪之前嘅行為：MANUAL 會被壓成 SKIPPED',
    file: 'src/StateSource.gs',
    find: ": (originalRow.assignSource",
    replace: ": (false && originalRow.assignSource",
    tests: ['tests/version_carry_over_all_paths.test.js']
  },
  {
    id: 'grid-wins-every-path',
    why: '把 `applyRequests_()` 還原成「冇傳清單就當冇 overlap」'
      + '——第三十八輪 F 組查出嘅真 bug：步驟 3 同步驟 5 兩條路完全冇行過'
      + '「grid 贏」嗰段，申報會靜靜蓋過幹事親手改嗰格',
    file: 'src/RequestsApply.gs',
    find: "  if (gridOverriddenSheetRows) {",
    replace: "  if (true) {",
    tests: ['tests/grid_wins_all_request_paths.test.js']
  },
  {
    id: 'rollback-keep-name',
    why: '把 `apiRollbackExecute()` 還原成「唔抄返目標版本嘅 PersonNameSnapshot」'
      + '——回退之後自由文字會變空白',
    file: 'src/WebAppRollback.gs',
    find: "personName: a.personName || '',",
    replace: "personName: '',",
    tests: ['tests/version_carry_over_all_paths.test.js']
  },
  {
    id: 'finetune-report-norepl',
    why: '把 `applyDecisions()` 還原成「找不到替補就靜靜計入 manualKept」'
      + '——幹事只會見到「沿用你的改動 N 項」，以為系統照他意思做了，'
      + '實際上那幾格一格都沒有動過',
    file: 'src/FineTune.gs',
    find: '        noReplacement.push({',
    replace: '        [].push({',
    tests: ['tests/version_carry_over_all_paths.test.js']
  },
  {
    id: 'finetune-keep-source',
    why: '把 `applyDecisions()` 還原成「冇 PersonID 就一律 SKIPPED」'
      + '——第三十八輪 D 組查出嘅真 bug：撳「套用決定」會把講員格由 MANUAL 壓成 SKIPPED',
    file: 'src/FineTune.gs',
    find: ": (originalRow.assignSource || ASSIGN_SOURCE.SKIPPED)),",
    replace: ": ASSIGN_SOURCE.SKIPPED),",
    tests: ['tests/version_carry_over_all_paths.test.js']
  },
  // ⚠️ 冇註冊 `finetune-clear-touched`（`touchedByDecision` 嗰兩條分支）。
  //
  // 第三十八輪 D 組行完真入口之後查到：呢兩條分支**目前搆唔到**。
  //   • `personName`：要 `touchedByDecision` 為真而 `person` 解析唔到。
  //     但 `ACCEPT_SUGGESTED` 有 `&& entry.suggested` 關卡、`REVERT_ORIGINAL`
  //     有 `revertBlocked` 關卡——兩條路都保證 `personId` 係一個解析得到嘅人。
  //   • `ruleFlags`：要一格「有跳過原因」而同時「被提案改動」。
  //     但提案只落喺違反規則嘅格，而有跳過原因嘅格根本冇人派 ⇒ 唔會違反。
  //
  // 即係話呢兩條分支現時係**防守性寫法**，唔係現行行為。
  // 寫一個搆得到佢哋嘅 fixture ＝ 手砌一個真實碼唔會產生嘅狀態，
  // 正正就係 B 組禁止嘅嘢。所以呢度**唔註冊**，改為喺稽核文件記低。
];

// 開跑之前先記低每個會被改嘅檔案——收工用嚟核對有冇還原乾淨。
const ORIGINALS = {};
MUTATIONS.forEach(function (m) {
  if (!ORIGINALS[m.file]) ORIGINALS[m.file] = fs.readFileSync(path.join(ROOT, m.file), 'utf8');
});

let fail = 0;
function report(ok, label, extra) {
  if (!ok) fail++;
  console.log(`${ok ? 'RED OK' : 'FAIL  '}  ${label}`);
  if (!ok && extra) console.log('          ' + String(extra).split('\n').slice(0, 6).join('\n          '));
}

function runTest(rel) {
  try {
    execFileSync(process.execPath, [rel], { cwd: ROOT, stdio: 'pipe' });
    return { passed: true, output: '' };
  } catch (e) {
    return { passed: false, output: String(e.stdout || '') + String(e.stderr || '') };
  }
}

console.log('=== C 組：逐條防線特登整壞，要求佢變紅 ===\n');

MUTATIONS.forEach(function (m) {
  const abs = path.join(ROOT, m.file);
  const before = fs.readFileSync(abs, 'utf8');

  // ⚠️ 先落一個本地變數再用。直接喺樣板字串入面寫「物件點 id」
  //  會被敏感資料掃描當成一個網域而擋住 commit（id 係真嘅頂層網域）。
  const mutationId = m.id;
  const hits = before.split(m.find).length - 1;
  if (hits !== 1) {
    report(false, `[${mutationId}] ${m.why}`,
      `喺 ${m.file} 搵到 ${hits} 次 \`find\`（要求剛好 1 次）。\n`
      + '程式碼改過就要同步更新 tools/verify-red.js 嘅註冊表——'
      + '唔可以由得佢靜靜略過。');
    return;
  }

  try {
    fs.writeFileSync(abs, before.split(m.find).join(m.replace));
    const results = m.tests.map(function (t) { return { t: t, r: runTest(t) }; });
    const stillGreen = results.filter(function (x) { return x.r.passed; });
    report(stillGreen.length === 0, `[${mutationId}] ${m.why}`,
      stillGreen.length > 0
        ? '整壞咗之後呢啲測試**仍然綠燈**：\n  '
          + stillGreen.map(function (x) { return x.t; }).join('\n  ')
          + '\n⇒ 呢條防線根本冇踩到嗰段程式，佢嘅綠燈冇意義。'
        : '');
  } finally {
    fs.writeFileSync(abs, before);
  }
});

// ── 自我核對：一定要還原乾淨 ──────────────────────────────────────
//
// ⚠️ 唔可以用 `git diff` 做呢一項——commit 之前本來就有未提交嘅 src/ 改動，
// 咁樣分唔出「工具留低嘅」同「你自己改緊嘅」，會變成一條日日誤報嘅假警報。
// 改為喺工具**開跑之前**先記低每個會被改嘅檔案嘅內容，跑完逐個字比對。
console.log('\n=== C 組：工具本身唔可以留低任何改動 ===');
{
  const dirty = Object.keys(ORIGINALS).filter(function (rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8') !== ORIGINALS[rel];
  });
  report(dirty.length === 0, 'src/ 冇殘留任何 verify-red 改動',
    dirty.length === 0 ? '' : '呢啲檔案同開跑之前唔一樣：\n' + dirty.join('\n'));
}



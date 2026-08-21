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
    id: 'suggest-keyrow-scan',
    why: '把建議表嘅機器鍵行還原成寫死第 2 行'
      + '——建議表頂有一段圖例，寫死就會讀到一片空白，'
      + '而幹事喺建議表上改嘅嘢會靜靜消失',
    file: 'src/SuggestionSheet.gs',
    find: '    if (hasKey) { keyRow = r; break; }',
    replace: '    if (hasKey) { keyRow = 2; break; }',
    tests: ['tests/suggestion_sheet.test.js']
  },
  {
    id: 'suggest-blocks-unres',
    why: '把「建議表遇到認唔出嘅名字」還原成照樣行落去'
      + '——一個冇 PersonID 嘅名會經由建議表嗰條路溜入正式版本',
    file: 'src/SuggestionSheet.gs',
    find: '  if (analysis.unresolved.length > 0) {',
    replace: '  if (false) {',
    tests: ['tests/suggestion_sheet.test.js']
  },
  {
    id: 'dropdown-auto-on-create',
    why: '把 `createRosterSheet()` 收尾嗰個自動套用拆走'
      + '——每一張新 grid 都冇咗名單選單，而幹事以為有（介面已經冇咗嗰一步）',
    file: 'src/RosterWriter.gs',
    find: '    dropdownResult = applyGridNameDropdowns_(quarterId, versionNo);',
    replace: '    dropdownResult = null;',
    tests: ['tests/main_flow_ui_shape.test.js']
  },
  {
    id: 'dropdown-set-failed-loud',
    why: '把「設唔到資料驗證」還原成靜靜拋出去'
      + '——第三十九輪點名講過呢個情況從來冇喺現場驗過，'
      + '而靜靜失敗嘅後果係「系統話加咗，開表卻冇」',
    file: 'src/GridNameDropdown.gs',
    find: "          reason: 'SET_FAILED', error: err.message",
    replace: "          reason: 'NOT_AUTO'",
    tests: ['tests/main_flow_ui_shape.test.js']
  },
  {
    id: 'redirect-off-is-noop',
    why: '把「冇設定轉寄地址」還原成照樣改收件人'
      + '——正常運作嗰陣每一封信都會寄錯人',
    file: 'src/MailRedirect.gs',
    find: '  if (!target) {',
    replace: '  if (false) {',
    tests: ['tests/mail_redirect.test.js']
  },
  {
    id: 'redirect-uses-new-to',
    why: '把真正寄出還原成用返 `recipient.email`'
      + '——整個轉寄機制冇生效，而畫面同 SendLog 都會話成功，'
      + '即係 Ivan 以為安全咁測試緊，實際上信真係寄咗俾義工',
    file: 'src/Mailer.gs',
    find: '  MailApp.sendEmail(redirected.toEmail, redirected.subject, redirected.bodyPlain, options);',
    replace: "  MailApp.sendEmail(recipient.email, redirected.subject, redirected.bodyPlain, options);",
    tests: ['tests/mail_redirect.test.js']
  },
  {
    id: 'redirect-bad-throws',
    why: '把「轉寄地址填錯」還原成當成冇設定'
      + '——喺應該轉寄嘅時候真係寄咗俾義工',
    file: 'src/MailRedirect.gs',
    find: '  if (!isPlausibleEmail_(value)) {',
    replace: '  if (false) {',
    tests: ['tests/mail_redirect.test.js']
  },
  {
    id: 'send-opts-default-same',
    why: '把寄出選項嘅預設收件範圍改成一律 ALL'
      + '——RESEND 本來係「只寄有改動嘅」，改咗之後幹事乜都唔揀撳落去，'
      + '成班冇改動嘅人都會收到一封內容一模一樣嘅信',
    file: 'src/SendOptions.gs',
    find: '  RESEND: SEND_RECIPIENT_SCOPE.CHANGED_ONLY,',
    replace: '  RESEND: SEND_RECIPIENT_SCOPE.ALL,',
    tests: ['tests/send_options.test.js']
  },
  {
    id: 'send-opts-pick-empty',
    why: '把「揀咗自己揀但一個都冇揀」還原成靜靜當成寄全部'
      + '——佢以為淨係寄俾三個人，實際上成班人收到',
    file: 'src/SendOptions.gs',
    find: '  if (scope === SEND_RECIPIENT_SCOPE.PICK && pickedCount === 0) {',
    replace: '  if (false) {',
    tests: ['tests/send_options.test.js']
  },
  {
    id: 'send-opts-ics-bool',
    why: '把 includeIcs 還原成「truthy 就當 true」'
      + '——傳一個字串（例如前端改壞咗）就會靜靜開咗一樣佢冇揀嘅嘢',
    file: 'src/SendOptions.gs',
    find: '  const includeIcs = (o.includeIcs === true || o.includeIcs === false)',
    replace: '  const includeIcs = (o.includeIcs !== undefined)',
    tests: ['tests/send_options.test.js']
  },
  {
    id: 'permalink-footer-empty',
    why: '把信末永久連結還原成「冇連結都照加嗰一段」'
      + '——收信嘅人會見到「固定連結：」後面一片空白，仲差過唔加',
    file: 'src/Mailer.gs',
    find: '  if (!link) return text;',
    replace: '  if (false) return text;',
    tests: ['tests/permanent_link_footer.test.js']
  },
  {
    id: 'permalink-footer-dup',
    why: '把信末永久連結還原成「唔理範本有冇放，一律加」'
      + '——範本自己有放嘅話，同一條連結會喺一封信入面出現兩次',
    file: 'src/Mailer.gs',
    find: "  if (String(templateSource || '').indexOf('{PublicRosterUrl}') !== -1) return text;",
    replace: '  if (false) return text;',
    tests: ['tests/permanent_link_footer.test.js']
  },
  {
    id: 'generator-stats-assigned',
    why: '把生成完成畫面嘅統計還原成「只認 a.personId」'
      + '——一格填好嘅講員（外請講員冇 PersonID）會被算成「未能安排」，'
      + '而 grid 同一格顯示佢個名',
    file: 'src/Generator.gs',
    find: '    if (cellClass === GRID_CELL_CLASS.ASSIGNED) return;',
    replace: '    if (a.personId) return;',
    tests: ['tests/classify_call_sites.test.js']
  },
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
  {
    id: 'paper-plain-highlight',
    why: '把「不標示名字」嗰一份還原成行個人版嗰條路'
      + '——一份「大家睇嘅表」會標住某一個人嘅名',
    file: 'src/PaperPack.gs',
    find: '  const built = buildFullRosterPdfBlob_(quarterId, versionNo);',
    replace: '  const built = { fileName: \'x.pdf\', blob: null, highlight: 1 };',
    tests: ['tests/paper_print_kinds.test.js']
  },
  {
    id: 'paper-plain-folder',
    why: '把「不標示名字」嗰一份還原成存去總資料夾'
      + '——幹事撳「開啟資料夾」會喺嗰一版嘅子資料夾入面搵唔到自己啱啱做好嗰份',
    file: 'src/PaperPack.gs',
    find: '  const folder = getOrCreateRosterSubfolder_(quarterId, versionNo);\n'
      + '  const file = saveOrOverwriteFile_(folder, built.fileName, built.blob);',
    replace: '  const folder = resolveRosterFolder_();\n'
      + '  const file = saveOrOverwriteFile_(folder, built.fileName, built.blob);',
    tests: ['tests/paper_print_kinds.test.js']
  },
  {
    id: 'paper-full-draws-list',
    why: '拆走「一份大家睇」嗰一種嘅提早 return'
      + '——會畫返個名單出嚟，而嗰個名單喺嗰一種入面撳極都冇作用',
    file: 'src/ui/ScriptSendPaper.html',
    find: "    if (paperKind_ === 'FULL_ONE') {",
    replace: "    if (paperKind_ === 'FULL_ONE' && false) {",
    tests: ['tests/paper_print_kinds.test.js']
  },
  {
    id: 'paper-kind-sticky',
    why: '拆走「每次開彈窗重設返做預設」'
      + '——幹事上次揀咗「不標示」，下次開會以為自己揀緊預設，然後印出一疊冇名嘅表',
    file: 'src/ui/ScriptSendPaper.html',
    find: "      paperKind_ = 'PERSONAL';\n      paperSelection_ = {};",
    replace: '      paperSelection_ = {};',
    tests: ['tests/paper_print_kinds.test.js']
  },
  {
    id: 'paper-list-one-copy',
    why: '把「不標示」嗰一種嘅份數還原成寫死 1'
      + '——幹事揀咗 12 位，系統照樣叫佢印一張',
    file: 'src/ui/ScriptSendPaper.html',
    find: "        button('產生這一份', () => runPlainPaper(selectedPaperIds().length), ''),",
    replace: "        button('產生這一份', () => runPlainPaper(1), ''),",
    tests: ['tests/paper_print_kinds.test.js']
  },
  {
    id: 'paper-pick-duplicated',
    why: '把紙本嗰個名單還原成自己寫一份（唔用共用元件）'
      + '——兩個名單會慢慢長得唔一樣，而幹事會覺得系統時好時壞',
    file: 'src/ui/ScriptSendPaper.html',
    find: '    pickListNodes({\n      items: items,\n      selected: paperSelection_,',
    replace: '    pickListNodesPaperCopy_({\n      items: items,\n      selected: paperSelection_,',
    tests: ['tests/main_flow_ui_shape.test.js']
  },
  {
    id: 'elig-empty-is-all',
    why: '把「一項都冇勾」還原成當成冇傳（`if (!selectedKeys)`）'
      + '——幹事逐項揀走晒之後撳確定，會全部套用',
    file: 'src/EligibilitySheetEditor.gs',
    find: '  if (selectedKeys === null || selectedKeys === undefined) {',
    replace: '  if (!selectedKeys) {',
    tests: ['tests/eligibility_sheet_item_pick.test.js']
  },
  {
    id: 'elig-write-uses-plan',
    why: '把寫入還原成讀返未篩過嘅 `plan.added`'
      + '——畫面會話「略過咗 2 項」而系統照樣寫入，'
      + '即係呢個專案最常出現嗰類 bug：兩個來源，只更新咗一個',
    file: 'src/EligibilitySheetEditor.gs',
    find: '  pick.added.forEach(function (a) {',
    replace: '  plan.added.forEach(function (a) {',
    tests: ['tests/eligibility_sheet_item_pick.test.js']
  },
  {
    id: 'elig-vanished-silent',
    why: '把「勾咗但重算之後冇咗嘅項」還原成靜靜略過'
      + '——幹事以為嗰幾項套用咗，實際上一格都冇動',
    file: 'src/EligibilitySheetEditor.gs',
    find: "    vanished: Object.keys(want).filter(function (k) { return present[k] !== true; })",
    replace: '    vanished: []',
    tests: ['tests/eligibility_sheet_item_pick.test.js']
  },
  {
    id: 'elig-add-duplicated',
    why: '把第 3 步嗰粒〔這是新人，一併加入〕還原成自己另寫一份'
      + '——兩邊嘅撞名提示同冇電郵提示會慢慢長得唔一樣',
    file: 'src/ui/ScriptMainFlow.html',
    find: '              () => openAddUnresolvedPerson(u, openApplyEligibilitySheet), \'\')',
    replace: '              () => openAddPersonForEligibility_(u), \'\')',
    tests: ['tests/eligibility_sheet_item_pick.test.js']
  },
  {
    id: 'elig-skip-sticky',
    why: '拆走「每次重新讀清走上一次嘅勾選」'
      + '——畫面上個勾係打咗開，而實際仲係略過緊嗰一項',
    file: 'src/ui/ScriptMainFlow.html',
    find: '      eligSkip_ = {};\n      renderEligibilitySheetPlan(plan);',
    replace: '      renderEligibilitySheetPlan(plan);',
    tests: ['tests/eligibility_sheet_item_pick.test.js']
  },
  {
    id: 'elig-dates-hidden',
    why: '把「會移走」還原成淨係講一個數字，唔講邊幾個主日'
      + '——一個幹事核對唔到嘅數字，同冇講差唔多',
    file: 'src/EligibilitySheetEditor.gs',
    find: '      assignedDates[key].push(toDateString(row[A.SERVICE_DATE], tz));',
    replace: '      assignedDates[key].push(\'\');',
    tests: ['tests/eligibility_sheet_item_pick.test.js']
  },
  {
    id: 'pdf-cut-off-by-one',
    why: '把「印到邊一行為止」還原成截喺標題嗰一行'
      + '——會少印最後一個主日，而 PDF 上完全睇落正常',
    file: 'src/PdfExport.gs',
    find: '      cut = r - 1;',
    replace: '      cut = r - 2;',
    tests: ['tests/pdf_roster_only_and_widths.test.js']
  },
  // ⚠️ 冇註冊「`if (cut <= 0) return 0;` 拆走」——試過，仍然綠燈。
  // 查落去唔係測試假綠：嗰一句係一個提早出口（省返下面條 while），
  // 而真正守住「搵唔到就唔截」嘅係最尾嗰句 `cut >= 3 ? cut : 0`。
  // 兩句都拆先會出事，而咁樣嘅 mutation 唔係「還原成舊行為」。
  // 所以改為註冊真正嗰一句 ↓
  {
    id: 'pdf-cut-floor',
    why: '拆走「截到第 3 行以下就唔截」嗰個下限'
      + '——一張一個主日都冇嘅表（圖例緊接住機器鍵行）會被截到淨返標題，'
      + '出嚟係一份得標題冇內容嘅 PDF，而畫面會話匯出成功',
    file: 'src/PdfExport.gs',
    find: '  return cut >= 3 ? cut : 0;',
    replace: '  return cut;',
    tests: ['tests/pdf_roster_only_and_widths.test.js']
  },
  {
    id: 'pdf-zero-lastrow',
    why: '拆走「lastRow 係 0 就唔截」——會傳 `r2=0` 落匯出網址，'
      + '出嚟係一份完全空白嘅 PDF，而畫面會話匯出成功',
    file: 'src/PdfExport.gs',
    find: '  if (lastRow <= 0) return undefined;',
    replace: '  if (lastRow < 0) return undefined;',
    tests: ['tests/pdf_roster_only_and_widths.test.js']
  },
  {
    id: 'pdf-personal-not-cut',
    why: '把個人版 PDF 還原成唔截'
      + '——整季版冇圖例而個人版有，幹事會以為系統壞咗',
    file: 'src/PdfExport.gs',
    find: '    const exported = exportSheetAsPdfBlob_(ctx.tempSheet, fileName, ctx.rosterOnlyOpts);',
    replace: '    const exported = exportSheetAsPdfBlob_(ctx.tempSheet, fileName);',
    tests: ['tests/pdf_roster_only_and_widths.test.js']
  },
  {
    id: 'grid-width-week-wide',
    why: '把「週次」欄還原成同人名欄一樣闊'
      + '——`fitw=true` 會按同一個比例縮，結果人名嗰幾欄三個中文字都放唔落，'
      + '而「週次」嗰欄仍然浪費緊位',
    file: 'src/RosterWriter.gs',
    find: 'const GRID_WIDTH_WEEK = 40;',
    replace: 'const GRID_WIDTH_WEEK = 62;',
    tests: ['tests/pdf_roster_only_and_widths.test.js']
  },
  {
    id: 'grid-width-zero-posts',
    why: '拆走「一個崗位都冇就唔設欄寬」'
      + '——`setColumnWidths(4, 0, ...)` 會拋錯，而嗰個會令整個建立版本失敗',
    file: 'src/RosterWriter.gs',
    find: '  const nameColumnCount = layout.keys.length - 3;\n  if (nameColumnCount > 0) {\n    sheet.setColumnWidths(4, nameColumnCount, GRID_WIDTH_NAME);\n  }',
    replace: '  const nameColumnCount = layout.keys.length - 3;\n  sheet.setColumnWidths(4, nameColumnCount, GRID_WIDTH_NAME);',
    tests: ['tests/pdf_roster_only_and_widths.test.js']
  },
  {
    id: 'wording-pick-back',
    why: '把其中一句畫面文字嘅「選擇」改返做「揀」'
      + '——畫面上一半寫「揀」一半寫「選擇」，幹事會以為係兩件唔同嘅事',
    file: 'src/ui/ScriptSendPaper.html',
    find: "['PICK', '自己選擇']",
    replace: "['PICK', '自己揀']",
    tests: ['tests/operator_wording.test.js']
  },
  {
    id: 'wording-err-label',
    why: '把三段式訊息第一段嘅顯示標籤改返做「發生了什麼」'
      + '——好多時嗰一段講嘅係「呢一季仲未有公開連結」呢種前置條件未夠，'
      + '根本冇嘢發生過，而幹事見到嗰四個字會以為系統壞咗',
    file: 'src/ui/Script.html',
    find: "  const ERR_LABEL_WHAT = '要留意';",
    replace: "  const ERR_LABEL_WHAT = '發生了什麼';",
    tests: ['tests/operator_wording.test.js']
  },
  {
    id: 'wording-err-marker',
    why: '把後端嘅機器標記一齊改埋'
      + '——前端拆唔到三段，會退返去顯示原文，而三段式訊息係整套錯誤處理嘅基礎',
    file: 'src/WebAppGuards.gs',
    find: "  return '發生了什麼：' + whatHappened + '\\n'",
    replace: "  return '要留意：' + whatHappened + '\\n'",
    tests: ['tests/operator_wording.test.js']
  },
  {
    id: 'wording-colloquial',
    why: '把一句幹事會見到嘅字改返做口語'
      + '——佢係一個唔熟電腦嘅使用者，畫面上一句口語會令佢覺得'
      + '「呢個系統唔係做俾我用嘅」',
    file: 'src/EligibilitySheetEditor.gs',
    find: "    dropdownNote = '名單已經套用好，但職事表上的下拉選單更新不到（'",
    replace: "    dropdownNote = '名單已經套用好，但職事表上嘅下拉選單更新唔到（'",
    tests: ['tests/operator_wording.test.js']
  },
  {
    id: 'grid-width-no-guard',
    why: '拆走欄寬嗰個 try/catch'
      + '——工作表被保護嘅時候，一張已經排好嘅職事表會因為設唔到欄寬而整個失敗',
    file: 'src/RosterWriter.gs',
    find: '  try {\n    applyGridColumnWidthsForA4_(sheet, layout);\n  } catch (err) {',
    replace: '  applyGridColumnWidthsForA4_(sheet, layout);\n  if (false) {\n'
      + "    const err = { message: '' };",
    tests: ['tests/pdf_roster_only_and_widths.test.js']
  },
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



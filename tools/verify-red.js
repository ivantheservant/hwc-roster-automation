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
    // ⚠️ 第四十四輪批次 E 組改寫咗 `readMailRedirectTarget_()`（支援多個地址），
    // 舊嗰行 `if (!isPlausibleEmail_(value))` 唔再存在。呢一條守嘅嘢冇變：
    // 「Config 填咗一個算唔出任何地址嘅值」**唔可以**當成冇設定——
    // 當成冇設定就會喺應該轉寄嘅時候真係寄咗俾義工。
    find: '  if (parsed.targets.length === 0) {',
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
    find: '  } else if (target.endDate && target.endDate < today) {',
    replace: '  } else if (false) {',
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
    // 第四十三輪批次 F 組喺兩行中間插咗 `paperExtra_` 嘅重設，
    // 所以 `find` 只剩下第一行。
    find: "      paperKind_ = 'PERSONAL';\n",
    replace: '',
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
    // ⚠️ 第四十六輪批次 A 組拆走咗「自己選擇」嗰個收件範圍選項
    //（收件人一律由幹事勾）。呢一條守嘅嘢冇變：畫面唔可以有「揀」。
    find: '撳〔選擇收件人〕選好再撳一次。',
    replace: '撳〔選擇收件人〕揀好再撳一次。',
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
  {
    id: 'suggest-start-snapshot',
    why: '把〔請系統幫我調整〕嘅起點還原成「建議表存在就一律用佢」'
      + '——即係第四十二輪之前嘅行為：幹事撳完〔稍後再決定〕、'
      + '再喺正式表改兩格，第二次調整會當嗰兩格唔存在。'
      + '而建議表上面自己寫住「系統會用你改完之後那一版做起點」',
    file: 'src/SuggestionSheet.gs',
    // ⚠️ 第四十四輪批次 A 組把呢一句包咗入 suggestionStep_()，
    // 所以 find 由 const start = … 改成入面嗰句 return …。
    find: '    return resolveSuggestionStartPoint_(quarterId, versionNo, startFrom);',
    replace: '    return { versionNo: versionNo, needsChoice: false,\n'
      + '      source: SpreadsheetApp.getActiveSpreadsheet().getSheetByName(\n'
      + '        buildSuggestionSheetName_(quarterId, versionNo))\n'
      + '        ? SUGGESTION_START.SUGGESTION : SUGGESTION_START.GRID,\n'
      + '      gridSheetName: buildRosterSheetName_(quarterId, versionNo),\n'
      + '      suggestionSheetName: buildSuggestionSheetName_(quarterId, versionNo) };',
    tests: ['tests/suggestion_start_point.test.js']
  },
  {
    id: 'suggest-both-silent',
    why: '把「兩張表都改過」還原成靜靜揀一張'
      + '——揀錯嗰張就等於靜靜丟咗幹事一批改動，而佢完全唔會知',
    file: 'src/SuggestionSheet.gs',
    find: '  if (gridChanged && suggestionChanged) {',
    replace: '  if (false) {',
    tests: ['tests/suggestion_start_point.test.js']
  },
  {
    id: 'suggest-no-fp-guess',
    why: '把「讀唔到指紋」還原成猜一張'
      + '——舊嘅建議表（呢一輪之前產生嘅）冇指紋，猜錯就會丟咗佢一批改動',
    file: 'src/SuggestionSheet.gs',
    find: '  if (!stored) {',
    replace: '  if (false) {',
    tests: ['tests/suggestion_start_point.test.js']
  },
  {
    id: 'suggest-loose-date',
    why: '把建議表嘅日期判斷還原成寬鬆（唔係空字串就當日期）'
      + '——圖例同最底嗰行指紋會變成假 key，令兩次指紋永遠對唔上，'
      + '結果每次撳調整都問一條冇意義嘅問題',
    file: 'src/SuggestionSheet.gs',
    find: "    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(dateStr)) return;",
    replace: '    if (!dateStr) return;',
    tests: ['tests/suggestion_start_point.test.js']
  },
  {
    id: 'suggest-fp-unsorted',
    why: '把指紋還原成唔排序'
      + '——`Object.keys()` 嘅次序冇保證，同一份內容可以算出兩個指紋，'
      + '於是幹事一格都冇改，系統都會以為佢改過',
    file: 'src/SuggestionSheet.gs',
    find: '  const keys = Object.keys(map || {}).sort();',
    replace: '  const keys = Object.keys(map || {});',
    tests: ['tests/suggestion_start_point.test.js']
  },
  {
    id: 'step1-skips-upcoming',
    why: '把第 1 步挑季度還原成「開始日期最早而又未生成嗰一季」'
      + '——會指去一個兩年前漏咗嘅季度，而唔係眼前呢一季',
    file: 'src/WebAppMainFlow.gs',
    find: '  } else if (upcoming.length > 0) {\n    target = upcoming[0];',
    replace: '  } else if (ungenerated.length > 0) {\n    target = ungenerated[0];',
    tests: ['tests/main_flow_six_steps.test.js']
  },
  {
    id: 'step1-all-generated-date',
    why: '把「全部季度都生成過」還原成照樣算日期警告'
      + '——粒掣灰晒，而下面同時講「已經生成過了」同「仲有 9 天到生成日期」，'
      + '幹事讀出嚟只會覺得系統壞咗',
    file: 'src/WebAppMainFlow.gs',
    find: '  if (allGenerated) {',
    replace: '  if (false) {',
    tests: ['tests/main_flow_six_steps.test.js']
  },
  {
    id: 'diff-same-version',
    why: '拆走「同一個版本一定冇分別」嗰個閘'
      + '——整季每一格都會被算成「某某 → （空白）」，'
      + '幹事會見到一份寫住全體都被清空嘅清單，而實際上一格都冇動過',
    file: 'src/RosterWriter.gs',
    find: '  if (Number(fromVersionNo) === Number(toVersionNo)) return [];',
    replace: '  if (false) return [];',
    tests: ['tests/save_feedback_and_step1.test.js']
  },
  {
    id: 'diff-one-side-keys',
    why: '把兩個版本嘅比對還原成只行其中一邊嘅 key'
      + '——一格由「有人」變成「唔存在」會靜靜漏咗',
    file: 'src/RosterWriter.gs',
    find: '  Object.keys(after).forEach(function (k) { keys[k] = true; });',
    replace: '  // (mutated)',
    tests: ['tests/save_feedback_and_step1.test.js']
  },
  {
    id: 'saved-rows-manual-wins',
    why: '把「同一格幹事同申報都有」還原成申報贏'
      + '——第四十輪定咗幹事親手改嗰啲格申報唔套用，'
      + '畫面反過嚟講就等於講一件事而系統做另一件事',
    file: 'src/Utils.gs',
    find: '    if (seen[key]) return;',
    replace: '    if (false) return;',
    tests: ['tests/save_feedback_and_step1.test.js']
  },
  {
    id: 'flow-steps-hardcoded',
    why: '把頁頂嗰個步數還原成寫死'
      + '——第四十一輪由六步減成五步之後，嗰句足足一輪冇人發現',
    file: 'src/ui/ScriptMainFlow.html',
    find: "    if (sub) sub.textContent = '由上而下做，' + cnNumber(steps.length) + '步';",
    replace: "    if (sub) sub.textContent = '由上而下做，六步';",
    tests: ['tests/save_feedback_and_step1.test.js']
  },
  {
    id: 'flow-marker-leaks',
    why: '把步卡嗰一句還原成唔剝走「發生了什麼：」'
      + '——嗰句講嘅係「呢一季仲未到生成日期」，根本冇嘢發生過，'
      + '而幹事見到嗰五個字會即刻以為系統壞咗',
    file: 'src/ui/ScriptMainFlow.html',
    find: "    return String(text || '').split('\\n')[0].replace(/^發生了什麼：\\s*/, '');",
    replace: "    return String(text || '').split('\\n')[0];",
    tests: ['tests/save_feedback_and_step1.test.js']
  },
  {
    id: 'suggest-colour-shadow',
    why: '把建議表嘅上色還原成「系統改過嘅蓋過幹事改過嘅」'
      + '——對話框報「黃色 1 格」而張表上一格黃色都冇，'
      + '而幹事第一件事就係去表上搵嗰一格',
    file: 'src/SuggestionSheet.gs',
    // ⚠️ 第四十六輪批次 C4 組喺上面多咗一層 `isBlocked`。
    // 呢一條守嘅仍然係「紫色唔可以被藍色蓋走」。
    find: '      } else if (isManual && isSystem) {\n'
      + '        cell.setBackground(SUGGESTION_COLOR_BOTH);\n'
      + '        colourCounts.both++;\n'
      + '      } else if (isSystem) {',
    replace: '      } else if (false) {\n'
      + '        cell.setBackground(SUGGESTION_COLOR_BOTH);\n'
      + '        colourCounts.both++;\n'
      + '      } else if (isSystem) {',
    tests: ['tests/round43_field_fixes.test.js']
  },
  {
    id: 'suggest-count-from-keys',
    why: '把對話框嗰三個數字還原成由 `manualKeys`／`systemKeys` 各自數'
      + '——同一格兩邊都算一次，於是報出嚟嘅數字同表上實際上咗色嘅格數對唔上',
    file: 'src/SuggestionSheet.gs',
    find: '    colourCounts: written.colourCounts,',
    replace: '    colourCounts: { manual: Object.keys(built.manualKeys).length,\n'
      + '      system: Object.keys(built.systemKeys).length, both: 0 },',
    tests: ['tests/round43_field_fixes.test.js']
  },
  {
    id: 'suggest-empty-sheet',
    why: '把「零改動照樣建議表」還原'
      + '——幹事儲存完即刻撳調整，會收到一張接受唔到嘅表，'
      + '而撳〔接受〕就會撞到一句寫俾開發者睇嘅錯',
    file: 'src/SuggestionSheet.gs',
    find: '  if (manualCount === 0 && systemCount === 0) {',
    replace: '  if (false) {',
    tests: ['tests/round43_field_fixes.test.js']
  },
  {
    id: 'suggest-stale-sheets',
    why: '拆走「建立新版本就清走舊版本嘅建議表」'
      + '——幹事開試算表見到兩張「建議」，分唔清邊張係最新',
    file: 'src/RosterWriter.gs',
    find: '    discardStaleSuggestionSheets_(quarterId, versionNo);',
    replace: '    if (false) discardStaleSuggestionSheets_(quarterId, versionNo);',
    tests: ['tests/round43_field_fixes.test.js']
  },
  {
    id: 'gap-fill-off',
    why: '拆走「⚠ 未能安排嗰啲格都試住填」'
      + '——即係第四十三輪之前嘅行為：一格根本冇人唔算違反，'
      + '所以由頭到尾冇被睇過一眼',
    file: 'src/SuggestionSheet.gs',
    find: '  const gap = proposeGapFills_(context, workingState);',
    replace: '  const gap = { proposals: [], unfillable: [], capped: false, gapCount: 0 };',
    tests: ['tests/round43_field_fixes.test.js']
  },
  {
    id: 'gap-fill-preacher',
    why: '把「本來就應該留白」嗰三種還原成照樣派人'
      + '——講員／翻譯／獻花會被自動派人，而嗰個係製造一個錯，唔係修一個錯',
    file: 'src/FineTune.gs',
    find: '  if (f.indexOf(RULE_IDS.NO_AUTO_GENERATE) !== -1) return true;',
    replace: '  if (false) return true;',
    tests: ['tests/round43_field_fixes.test.js']
  },
  {
    id: 'mutation-lock-off',
    why: '把互斥鎖還原成「攞唔到都照做」'
      + '——兩個請求同時改同一批資料，會出現兩行同版本號嘅 RosterVersions，'
      + '或者一個寫咗一半嘅孤兒版本',
    file: 'src/MutationLock.gs',
    find: '  if (!got) {',
    replace: '  if (false) {',
    tests: ['tests/round43_field_fixes.test.js']
  },
  {
    id: 'busy-lock-not-css',
    why: '把畫面嘅忙碌鎖還原成「淨係逐粒 button 設 disabled」'
      + '——動作期間重畫一次，新造出嚟嗰批掣就冇人鎖過，'
      + '而嗰個正正就係現場「畫面好似重新整理咗，我可以自由撳」',
    file: 'src/ui/Script.html',
    find: "    document.body.classList.toggle('is-busy', !!busy);",
    replace: '    // (mutated)',
    tests: ['tests/round43_field_fixes.test.js']
  },
  {
    id: 'busy-lock-no-reapply',
    why: '拆走「重畫完重新鎖一次」'
      + '——鍵盤嗰一層（Tab ＋ Enter）喺重畫之後就冇咗',
    file: 'src/ui/Script.html',
    find: '    reapplyBusyLockIfNeeded_();\n  }\n\n  function renderTop(d) {',
    replace: '  }\n\n  function renderTop(d) {',
    tests: ['tests/round43_field_fixes.test.js']
  },
  {
    id: 'save-blank-fastpath',
    why: '把「仲有格冇人」還原成照樣行快路（唔彈窗）'
      + '——幹事移走幾個名之後直接儲存、跟住寄出，'
      + '收信嗰班人會見到空格，而佢中間一次都冇被提醒過',
    file: 'src/ui/ScriptZone1.html',
    find: '      && (plan.blankCells || []).length === 0;',
    replace: '      && true;',
    tests: ['tests/round43_field_fixes.test.js']
  },
  {
    id: 'extra-email-as-person',
    why: '把幹事自行輸入嘅地址還原成 `PERSON` 收件人'
      + '——下游會去查佢「呢一季有邊幾格」而查唔到，'
      + '然後逐個地方各自處理一次空值',
    file: 'src/SendOptions.gs',
    find: '      type: RECIPIENT_TYPE.LIST,\n      email: email,',
    replace: '      type: RECIPIENT_TYPE.PERSON,\n      email: email,',
    tests: ['tests/round43_field_fixes.test.js']
  },
  // ⚠️ 第四十六輪批次 A 組：`roles-hardcoded` 已經移除。
  // 讀身分嗰段由 `WebAppSendPlan.gs` 搬咗去 `SendRecipients.gs`，
  // 而 `send-roles-ignore-term`（下面）守緊一模一樣嘅嘢，
  // 而且佢嘅測試真係行嗰個函式。留兩條指住同一件事，
  // 只會令下一個人改錯一條，然後以為兩條都仲有效。
  {
    id: 'health-redirect-yellow',
    why: '把全面體檢嗰項轉寄地址還原成黃色（建議處理）'
      + '——留住一個轉寄地址上線，系統會報告「已寄出 51 封」'
      + '而全體義工一封都收唔到',
    file: 'src/FullHealthCheck.gs',
    find: "  'MAIL_REDIRECT_ALL_TO'\n];",
    replace: '];',
    tests: ['tests/round43_field_fixes.test.js']
  },
  {
    id: 'stepbutton-silent-grey',
    why: '拆走「灰掣一定要有解釋」嗰個保底'
      + '——一粒撳唔到而又冇字嘅掣，幹事企喺度唔知係壞咗定係佢做漏咗嘢',
    file: 'src/ui/ScriptMainFlow.html',
    find: '    } else if (opts.disabled) {',
    replace: '    } else if (false) {',
    tests: ['tests/round43_field_fixes.test.js']
  },
  {
    id: 'picklist-disabled',
    why: '令 `pickListNodes()` 唔理 `disabled`'
      + '——後端標咗勾唔到，畫面照樣勾得到，等於後端嗰個標記白做',
    file: 'src/ui/Script.html',
    find: '      if (it.disabled) {',
    replace: '      if (false) {',
    tests: ['tests/send_recipients_pool.test.js']
  },
  {
    id: 'modal-status-blind',
    why: '把「彈窗開住嗰陣講嘅話」還原成只寫畫面最頂嗰條 `#status`'
      + '——嗰條喺 `.modal-backdrop`（fixed／inset 0／z-index 100／半透明黑）'
      + '下面，所以撳〔寄出〕而一位都冇揀，幹事見到嘅係完全冇反應',
    file: 'src/ui/Script.html',
    find: '    if (modalOpen && message) {',
    replace: '    if (false) {',
    tests: ['tests/modal_status_visible.test.js']
  },
  {
    id: 'modal-status-stale',
    why: '拆走「開新彈窗要清走上一個嘅訊息」'
      + '——幹事會喺一個全新彈窗上面見到一句同佢完全無關嘅紅字',
    file: 'src/ui/Script.html',
    find: '    clearModalStatus_();\n    el(\'modalBackdrop\').hidden = false;',
    replace: '    el(\'modalBackdrop\').hidden = false;',
    tests: ['tests/modal_status_visible.test.js']
  },
  {
    id: 'paper-no-autogen',
    why: '拆走「寄之前自己補產生欠嗰幾份」'
      + '——即係回到 Ivan 撞到嗰個死胡同：系統明明知道欠邊幾份、'
      + '明明有工具補得返，卻回一句「一份個人 PDF 都找不到。」',
    file: 'src/PaperPack.gs',
    find: '  if (split.generatable.length > 0) {\n    const needIds',
    replace: '  if (false) {\n    const needIds',
    tests: ['tests/paper_pack_autogen.test.js']
  },
  {
    id: 'paper-partial-send',
    why: '令「補產生未做齊」照樣寄出'
      + '——幹事收到一封夾住三十份嘅信唔會逐份數，佢會印晒派晒，'
      + '然後有幾位企喺度冇紙，而佢由頭到尾唔知少咗邊個',
    file: 'src/PaperPack.gs',
    // ⚠️ 同一輪之內改過：本來嗰行係
    // `if (!autoBatch.done || split.generatable.length > 0)`，
    // 而「做齊咗但仲有幾份唔見」嗰半拆咗出去（見 `paper-endless-pending`）。
    // 呢一條剩返守「一次執行做唔晒」嗰半。
    find: '    if (!autoBatch.done) {',
    replace: '    if (false) {',
    tests: ['tests/paper_pack_autogen.test.js']
  },
  {
    id: 'paper-missing-merged',
    why: '把「`NameMapping` 查唔到」同「未產生過」混返做一種'
      + '——查唔到編號嗰啲補極都補唔到，混埋一齊就會叫幹事'
      + '一次又一次撳同一粒掣',
    file: 'src/PaperPack.gs',
    find: '    if (m && String(m.nameTC || \'\').trim()) generatable.push(m);',
    replace: '    if (m) generatable.push(m);',
    tests: ['tests/paper_pack_autogen.test.js']
  },
  {
    id: 'redirect-single-only',
    why: '把轉寄地址還原成「成串字當一個地址驗」'
      + '——Ivan 填兩個地址用逗號分隔，一撳寄出就收到'
      + '「填了⋯⋯但它看起來不像一個電郵地址」',
    file: 'src/MailRedirect.gs',
    find: '  const pieces = text.split(/[,;、\\s]+/)',
    replace: '  const pieces = [text]',
    tests: ['tests/mail_redirect.test.js']
  },
  {
    id: 'redirect-skip-bad',
    why: '令打錯咗嗰個地址靜靜略過，淨係寄好嗰幾個'
      + '——部分成功喺呢度係最壞嘅結果：幹事見到信到咗就以為設定啱，'
      + '而其實有一個地址由頭到尾收唔到',
    file: 'src/MailRedirect.gs',
    find: '  if (parsed.bad.length > 0) {',
    replace: '  if (false) {',
    tests: ['tests/mail_redirect.test.js']
  },
  {
    id: 'redirect-badge-count',
    why: '把介面標籤還原成只講個數，唔逐個列出'
      + '——呢個標籤唯一嘅用途就係俾幹事一眼認得出「呢個唔係我要嘅設定」，'
      + '淨係講個數，佢要走去 Config 先知係邊幾個',
    file: 'src/MailRedirect.gs',
    find: '  return \'⚠️ 全部信件轉寄至 \' + targets.join(\'、\')',
    replace: '  return \'⚠️ 全部信件轉寄至 \' + (\'\')',
    tests: ['tests/mail_redirect.test.js']
  },
  {
    id: 'generate-skip-ask',
    why: '把「使唔使先改名單」嗰一問由入口搬走'
      + '——即係第四十三輪嘅狀態：三條去生成嘅路只有一條問過，'
      + '而「下一個未生成嘅季度」好多時就係冇問嗰條',
    file: 'src/ui/ScriptZone1.html',
    find: '    askEligibilityFirst(function () { openGenerateDraftAfterAsking_(); });',
    replace: '    openGenerateDraftAfterAsking_();',
    tests: ['tests/generate_asks_eligibility.test.js']
  },
  {
    id: 'generate-ask-noexit',
    why: '把〔先去改名單〕改成淨係關窗，唔帶佢去嗰張表'
      + '——一個叫人「請去某某地方」而唔帶佢去嘅提示，'
      + '對一個唔熟電腦嘅人嚟講等於冇提示',
    file: 'src/ui/ScriptMainFlow.html',
    find: '      onCancel: () => { closeModal(); openEligibilitySheet(); },',
    replace: '      onCancel: () => { closeModal(); },',
    tests: ['tests/generate_asks_eligibility.test.js']
  },
  {
    id: 'annual-dates-blank',
    why: '把年度工具嘅 GenerateOn／OfficialSendOn 還原成一律留空'
      + '——即係 Ivan 撞到嗰個狀態：2028 四季全部冇日期，'
      + '主流程一直顯示「這一季的 Quarters 沒有填生成日期」',
    file: 'src/AnnualQuarters.gs',
    find: '    q[Q.GENERATE_ON] = plan.generateOn || \'\';',
    replace: '    q[Q.GENERATE_ON] = \'\';',
    tests: ['tests/quarter_dates_backfill.test.js']
  },
  {
    id: 'lead-null-as-zero',
    why: '把「前置日數未設定」還原成當成 0'
      + '——`Number(null)` 係 0 唔係 NaN，所以 GenerateOn 會變成開季當日，'
      + '即係「到咗先生成」，而幹事要嘅係提早 35 日',
    file: 'src/QuarterStage.gs',
    find: '  if (leadDays === null || leadDays === undefined || leadDays === \'\') return \'\';',
    replace: '  if (false) return \'\';',
    tests: ['tests/quarter_dates_backfill.test.js']
  },
  {
    id: 'quarter-backfill-all',
    why: '拆走「留空 ＝ 一次過補齊全部欠日期嘅季度」'
      + '——2028 有四季要補，逐季輸入 QuarterID 做四次，'
      + '做少一次就有一季一直顯示「沒有填生成日期」',
    file: 'src/Menu.gs',
    find: '      missing = listQuartersMissingDates_();',
    replace: '      missing = [];',
    tests: ['tests/quarter_dates_backfill.test.js']
  },
  {
    id: 'elig-blank-stops',
    why: '把「空格跳過」改成「撞到空格就當成呢一欄完咗」'
      + '——幹事喺中間留一行空白，下面嗰批人就會被靜靜移走，'
      + '而畫面上完全睇唔出（Ivan 問過兩次嘅正正就係呢件事）',
    file: 'src/EligibilitySheetEditor.gs',
    find: '      if (!text) return;\n      const personId = resolvePersonId(text);',
    replace: '      if (!text) { wanted[postId]._stop = true; return; }\n'
      + '      if (wanted[postId]._stop) return;\n'
      + '      const personId = resolvePersonId(text);',
    tests: ['tests/eligibility_sheet_safety.test.js']
  },
  {
    id: 'elig-unknown-skip',
    why: '把「認唔出嘅名整批擋住」改成靜靜略過'
      + '——幹事打錯一個字，佢以為加咗，而下一次生成先發現嗰個人一格都冇',
    file: 'src/EligibilitySheetEditor.gs',
    find: '    blocked: unresolved.length > 0,',
    replace: '    blocked: false,',
    tests: ['tests/eligibility_sheet_safety.test.js']
  },
  {
    id: 'elig-unknown-post-skip',
    why: '把「崗位代號對唔上」改成當嗰一欄唔存在'
      + '——幹事整欄剪貼錯位，成個崗位嘅名單會被清空，而畫面上睇唔出',
    file: 'src/EligibilitySheetEditor.gs',
    find: '    if (!postNameById[postId]) {',
    replace: '    if (false) {',
    tests: ['tests/eligibility_sheet_safety.test.js']
  },
  {
    id: 'note-reason-tautology',
    why: '把建議格註嘅原因還原成「改成乜」而唔係「點解改」'
      + '——格註會變成「原因：建議改派 試甲」，一句同義反覆；'
      + 'Ivan 明確要求藍色格要講明**為什麼改**',
    file: 'src/SuggestionSheet.gs',
    find: '      reason: [violation.reason, replacement.reason]\n'
      + '        .filter(Boolean).join(\'；\') || violation.ruleId',
    replace: '      reason: replacement.reason || violation.reason || violation.ruleId',
    tests: ['tests/round43_field_fixes.test.js']
  },
  {
    id: 'suggest-no-notes',
    why: '拆走建議表嘅格註'
      + '——幹事見到一格藍色，但唔知系統改咗乜、點解改',
    file: 'src/SuggestionSheet.gs',
    find: '      if (built.notes[cellKey]) cell.setNote(built.notes[cellKey]);',
    replace: '      if (false) cell.setNote(built.notes[cellKey]);',
    tests: ['tests/round43_field_fixes.test.js']
  },
  {
    id: 'paper-endless-pending',
    why: '把「補產生做齊咗但仲有幾份唔見」還原成回 `pending`'
      + '——真正嗰個批次出錯嗰陣會照樣回 `done: true`，'
      + '所以幹事會一直撳「接住做餘下的」而畫面永遠唔會變',
    file: 'src/PaperPack.gs',
    find: '    if (split.generatable.length > 0) {\n      const errorByPerson = {};',
    replace: '    if (false) {\n      const errorByPerson = {};',
    tests: ['tests/paper_pack_autogen.test.js']
  },
  {
    id: 'handler-arg-event',
    why: '把〔請系統幫我調整〕嗰粒掣還原成直接綁 `openBuildSuggestion`'
      + '——佢收到嘅第一個參數會係一個 MouseEvent，跟住原封不動送去'
      + '做第 1 個參數 ⇒ 現場嗰句 `Failed due to illegal value in property: 1`',
    file: 'src/ui/ScriptMainFlow.html',
    find: "stepButton('請系統幫我調整', () => openBuildSuggestion(), {",
    replace: "stepButton('請系統幫我調整', openBuildSuggestion, {",
    tests: ['tests/client_arg_sanitize.test.js']
  },
  {
    id: 'zone1-handler-event',
    why: '把區一四粒大掣還原成直接綁函式名'
      + '——`openReview`／`openOfficial`／`openResend` 三個都收參數，'
      + '所以三粒撳落去送出去嘅第 1 個參數都會係一個 MouseEvent',
    file: 'src/ui/ScriptZone1.html',
    find: '      review: () => openReview(),',
    replace: '      review: openReview,',
    tests: ['tests/client_arg_sanitize.test.js']
  },
  {
    id: 'client-args-unclean',
    why: '把送出嗰行還原成用未清過嗰份參數'
      + '——清完而照樣送舊嗰份，成層防線白做，而且完全睇唔出',
    file: 'src/ui/Script.html',
    find: '        [fnName](...safeArgs);',
    replace: '        [fnName](...args);',
    tests: ['tests/client_arg_sanitize.test.js']
  },
  {
    id: 'client-args-noverify',
    why: '拆走「送出之前逐個參數驗一次」，剩返 `JSON` 一個來回'
      + '——`JSON.stringify()` 會把函式同 `undefined` **靜靜刪走**，'
      + '所以個 bug 會由「拋一句睇唔明嘅英文」變成「靜靜傳咗個 null 上去」',
    file: 'src/ui/Script.html',
    find: "      const hit = findIllegalServerValue_(arg, '參數 ' + i, []);",
    replace: '      const hit = null;',
    tests: ['tests/client_arg_sanitize.test.js']
  },
  {
    id: 'error-title-joined',
    why: '把錯誤視窗嘅標題還原成 `label + \'失敗\'`'
      + '——`label` 係一個「進行中」嘅講法，'
      + '駁埋就會出現現場嗰句「系統調整中，請稍候失敗」',
    file: 'src/ui/Script.html',
    find: '      showErrorModal(actionErrorTitle_(label), err);',
    replace: "      showErrorModal(label + '失敗', err);",
    tests: ['tests/client_arg_sanitize.test.js']
  },
  {
    id: 'send-pool-stage-bound',
    why: '把收件人池還原成「按階段出名單」'
      + '——即係第四十一同四十三輪做錯咗嘅方向：幹事喺 REVIEW 勾一個義工，'
      + '嗰個義工根本唔喺池入面，勾咗都唔會收到，而畫面會話「已選 12 位」',
    file: 'src/SendRecipients.gs',
    find: '  if (decision && decision.recipientScope === SEND_RECIPIENT_SCOPE.PICK) {',
    replace: '  if (false) {',
    tests: ['tests/send_recipients_pool.test.js']
  },
  {
    id: 'send-pool-no-roleholders',
    why: '把「冇服侍嘅身分持有人」由池入面拆走'
      + '——一個堂委好可能呢一季一格都冇派工，而佢正正就係要收審閱本嗰個；'
      + '幹事喺個名單度搵極都搵唔到佢',
    file: 'src/SendRecipients.gs',
    find: '  Object.keys(rolesByPerson).sort().forEach(function (personId) {',
    replace: '  [].forEach(function (personId) {',
    tests: ['tests/send_recipients_pool.test.js']
  },
  {
    id: 'send-roles-ignore-term',
    why: '把身分判斷還原成唔理生效期'
      + '——一個上一屆嘅堂委會被「堂委」呢一組勾中',
    file: 'src/SendRecipients.gs',
    find: '    if (!isEffectiveOn_(r.effectiveFrom, r.effectiveTo, today)) return;',
    replace: '    if (false) return;',
    tests: ['tests/send_recipients_pool.test.js']
  },
  {
    id: 'send-kind-sentence-back',
    why: '把彈窗頂嗰句「這一次是寄給堂委審閱」擺返出嚟'
      + '——收件人由幹事決定之後，嗰句由階段推斷嘅描述同佢實際做緊嘅事對唔上。'
      + 'Ivan 明確講咗嗰句係錯嘅',
    file: 'src/ui/ScriptSendPaper.html',
    find: "        text: '系統只會寄你已經儲存確認的版本'",
    replace: "        text: s.kindSentence + '系統只會寄你已經儲存確認的版本'",
    tests: ['tests/send_recipients_pool.test.js']
  },
  {
    id: 'send-history-no-warn',
    why: '拆走「現時嗰版未寄過」嗰句提醒'
      + '——幹事最容易犯嘅錯就係「以為寄咗」：改完、儲存咗、去做第二件事，'
      + '而嗰一版由頭到尾冇寄過',
    file: 'src/WebAppSendPlan.gs',
    find: '  } else if (!sentVersions[currentVersionNo]) {',
    replace: '  } else if (false) {',
    tests: ['tests/send_recipients_pool.test.js']
  },
  {
    id: 'changed-no-baseline',
    why: '把「有改動」嘅比較基準由「上一次真正寄出嗰版」改成「上一版」'
      + '——唔講明相對邊一版，幹事根本無從判斷「有 4 位改過」係指乜',
    file: 'src/SendRecipients.gs',
    find: '  const history = listSendHistory_(quarterId).filter(function (b) {',
    replace: '  const history = [].filter(function (b) {',
    tests: ['tests/send_recipients_pool.test.js']
  },
  {
    id: 'diff-no-personid',
    why: '把版本比對嘅 `PersonID` 拆走'
      + '——「只寄給安排有改動嘅人」要嘅係收件人；'
      + '冇 `PersonID` 就要另寫一份「邊幾格改過」，'
      + '而兩份一定會出現「畫面數到 4 位、實際寄 5 封」',
    file: 'src/RosterWriter.gs',
    find: "      fromPersonId: beforeId[key] || '',",
    replace: "      fromPersonId: '',",
    tests: ['tests/send_recipients_pool.test.js']
  },
  {
    id: 'suggest-touches-manual',
    why: '令〔請系統幫我調整〕照舊改走幹事親手改過嘅格'
      + '——第四十六輪 C 組嗰條原則：'
      + '系統改壞幹事親手做嘅決定，比排錯更差',
    file: 'src/SuggestionSheet.gs',
    find: '    if (manual[key] && !allowed[key]) {',
    replace: '    if (false) {',
    tests: ['tests/round43_field_fixes.test.js', 'tests/suggestion_start_point.test.js']
  },
  {
    id: 'suggest-allow-default-on',
    why: '把「邊幾格准系統動」嘅預設值由「一格都唔准」改成「全部准」'
      + '——噉樣就等於行返舊行為，而多咗嗰個清單只會變成'
      + '一個幹事唔會細睇嘅畫面',
    file: 'src/ui/ScriptSuggestion.html',
    find: '        cb.checked = false;   // ⚠️ 預設不勾',
    replace: '        cb.checked = true;',
    tests: ['tests/send_recipients_pool.test.js']
  },
  {
    id: 'suggest-no-orange',
    why: '拆走第四種顏色（幹事改過、違反規則、系統冇動）'
      + '——用返黃色嘅話，佢喺表上完全分唔出邊幾格有問題，'
      + '而嗰幾格正正就係佢要親自決定嘅',
    file: 'src/SuggestionSheet.gs',
    find: '      if (isBlocked) {',
    replace: '      if (false) {',
    tests: ['tests/round43_field_fixes.test.js']
  },
  {
    id: 'save-then-send-default',
    why: '把「儲存之後直接去寄出」嘅預設值改成勾好'
      + '——寄出係一個對外嘅動作；預設幫佢揀咗，'
      + '就等於一個唔為意嘅人撳「照樣儲存」之後直接開咗寄出彈窗',
    file: 'src/ui/ScriptZone1.html',
    find: '    thenSendCb.checked = false;',
    replace: '    thenSendCb.checked = true;',
    tests: ['tests/send_recipients_pool.test.js']
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

// ── 結論同退出碼 ────────────────────────────────────────────────
//
// ⚠️ 第四十四輪批次發現：呢個工具本來**冇呢一段**——即係唔論幾多條防線
// 塌咗、幾多條註冊過期，佢都係 exit 0。而佢係推送閘嘅一部分，所以
//「跑咗 verify-red」一直只等於「有人肉眼睇過個輸出」。
//
// 呢個正正就係呢個專案由第一輪殺到而家嗰種錯：**靜靜失敗**。
// 一個永遠回 0 嘅檢查工具，比冇呢個工具更差——因為佢令人以為檢查過。
console.log('\n' + (fail === 0
  ? ('ALL RED OK（' + MUTATIONS.length + ' 條突變）')
  : (fail + ' 條唔合格——唔可以 commit')));
process.exit(fail === 0 ? 0 : 1);



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
    // ⚠️ 第四十七輪批次 A5 組：預設值由 `saveThenSendDefault_` 出。
    // 呢一條守嘅嘢冇變：**平時預設唔勾。**
    find: '  let saveThenSendDefault_ = false;',
    replace: '  let saveThenSendDefault_ = true;',
    tests: ['tests/send_recipients_pool.test.js']
  },
  {
    id: 'unsaved-dialog-dead',
    why: '把「未儲存」嗰段調返去 `NONE` 後面'
      + '——有未儲存改動嗰陣 `kind` 必定係 `NONE`，而 `NONE` 嗰段自己 return，'
      + '所以第四十輪寫嘅嗰段（連〔先去儲存〕）永遠行唔到。'
      + 'Ivan 現場見到嘅就係一個叫佢撳一粒掣、而窗入面冇嗰粒掣嘅畫面',
    file: 'src/ui/ScriptSendPaper.html',
    find: '    if (s.blockedByUnsavedOnly) {\n      renderUnsavedBlocksSend(s);\n      return;\n    }',
    replace: '    if (false) {\n      renderUnsavedBlocksSend(s);\n      return;\n    }',
    tests: ['tests/send_unsaved_gate.test.js']
  },
  {
    id: 'unsaved-no-recalc',
    why: '把「係咪只有未儲存擋住」由重算改成淨睇 `unsaved.hasAny`'
      + '——未儲存 ＋ Stage 都未到嗰陣，會俾咗一粒'
      + '「立即儲存並繼續」而佢儲存完一樣寄唔到',
    file: 'src/WebAppDashboard.gs',
    find: '  const buttons = computeDashboardButtons_(asIfSaved);\n'
      + '  return [\'review\', \'official\', \'resend\'].some(function (k) {\n'
      + '    return !!(buttons[k] && buttons[k].enabled);\n'
      + '  });',
    replace: '  return true;',
    tests: ['tests/send_unsaved_gate.test.js']
  },
  {
    id: 'none-dialog-no-save',
    why: '拆走 `NONE` 窗嗰粒〔立即儲存〕'
      + '——即係回到現場嗰個狀態：叫佢去撳「儲存並確認」，'
      + '而個窗入面冇嗰粒掣',
    file: 'src/ui/ScriptSendPaper.html',
    find: "        acts.push(button('立即儲存', () => { closeModal(); openSaveAndConfirm(); }, ''));",
    replace: '        acts.push(null);',
    tests: ['tests/send_unsaved_gate.test.js']
  },
  {
    id: 'save-send-not-optin',
    why: '把〔立即儲存並繼續〕嗰條路嘅「儲存後直接寄出」改成唔預設勾'
      + '——佢本來就係想寄出，只係被未儲存擋住；'
      + '唔勾嘅話佢儲存完又要自己再搵一次〔寄出〕',
    file: 'src/ui/ScriptZone1.html',
    find: '    saveThenSendDefault_ = !!(opts && opts.thenSend);',
    replace: '    saveThenSendDefault_ = false;',
    tests: ['tests/send_unsaved_gate.test.js']
  },
  {
    id: 'preview-counts-reviewers',
    why: '把步驟 2 嘅事前收件人數改返做 `countReviewerRecipients_()`'
      + '——即係現場嗰個 bug：確認窗講「會寄給這 3 位」，'
      + '而完成窗講「模擬 9 封」',
    file: 'src/FiveStageCore.gs',
    find: '    recipientCount: recipients.length,\n'
      + '    // 第四十七輪批次 B3 組：**列出名字**，唔淨係一個數字。',
    replace: '    recipientCount: countReviewerRecipients_(),\n'
      + '    // 第四十七輪批次 B3 組：**列出名字**，唔淨係一個數字。',
    // ⚠️ **只列 `preview_matches_send.test.js`。**
    // `e2e_five_stage_flow.test.js` 喺呢幾條突變下面仍然綠——
    // 因為佢**冇傳 `sendOptions`**，而冇傳嘅時候兩個算法
    // 啟啟好都退回 `listRecipients_()`。兩者就係喺 `PICK`
    // 之下先至分家，而 Ivan 現場嗰一次正正就係 `PICK`。
    //
    // 列一條捕唔到嘅測試入去，verify-red 會報 FAIL——
    // 而呢個報告本身就係一個有用嘅發現：
    // 那一份 e2e 看不到這一類問題。
    tests: ['tests/preview_matches_send.test.js']
  },
  {
    id: 'step4-ignores-opts',
    why: '把步驟 4 嘅事前收件人數改返做「唔理 `sendOptions`」'
      + '——幹事喺寄出彈窗勾咗人之後，'
      + '個數字仍然係「全部應收嘅人」，同實際寄出唔同',
    file: 'src/FiveStageCore.gs',
    find: '  const recipients = resolveActualRecipients_(\n'
      + '    quarterId, versionNo, MAIL_STAGES.OFFICIAL, sendOptions);',
    replace: '  const recipients = listRecipients_(MAIL_STAGES.OFFICIAL,\n'
      + '    buildMailContext_(quarterId, versionNo, MAIL_STAGES.OFFICIAL));',
    // ⚠️ **只列 `preview_matches_send.test.js`。**
    // `e2e_five_stage_flow.test.js` 喺呢幾條突變下面仍然綠——
    // 因為佢**冇傳 `sendOptions`**，而冇傳嘅時候兩個算法
    // 啟啟好都退回 `listRecipients_()`。兩者就係喺 `PICK`
    // 之下先至分家，而 Ivan 現場嗰一次正正就係 `PICK`。
    //
    // 列一條捕唔到嘅測試入去，verify-red 會報 FAIL——
    // 而呢個報告本身就係一個有用嘅發現：
    // 那一份 e2e 看不到這一類問題。
    tests: ['tests/preview_matches_send.test.js']
  },
  {
    id: 'resend-preview-diverges',
    why: '令步驟 5 嘅事前預覽自己再數一次收件人'
      + '——同真正寄出嗰個算法分家，'
      + '就會出現「事前 3 位、事後 9 封」嗰種對唔上',
    file: 'src/FiveStageCore.gs',
    find: '    recipientCount: recipients.length,\n'
      + '    recipientPreview: summariseRecipientsForPreview_(recipients),\n'
      + '    isDryRun: getConfig(CONFIG_KEYS.DRY_RUN, true) !== false\n'
      + '  };\n}',
    replace: '    recipientCount: changedList.length,\n'
      + '    recipientPreview: summariseRecipientsForPreview_(recipients),\n'
      + '    isDryRun: getConfig(CONFIG_KEYS.DRY_RUN, true) !== false\n'
      + '  };\n}',
    // ⚠️ **只列 `preview_matches_send.test.js`。**
    // `e2e_five_stage_flow.test.js` 喺呢幾條突變下面仍然綠——
    // 因為佢**冇傳 `sendOptions`**，而冇傳嘅時候兩個算法
    // 啟啟好都退回 `listRecipients_()`。兩者就係喺 `PICK`
    // 之下先至分家，而 Ivan 現場嗰一次正正就係 `PICK`。
    //
    // 列一條捕唔到嘅測試入去，verify-red 會報 FAIL——
    // 而呢個報告本身就係一個有用嘅發現：
    // 那一份 e2e 看不到這一類問題。
    tests: ['tests/preview_matches_send.test.js']
  },
  {
    id: 'preview-writes-reason',
    why: '令事前預覽都寫 `notifyReasonByPerson`'
      + '——嗰個係寄信嗰段會讀嘅狀態。'
      + '「睇一眼」改變咗「做出嚟」嘅結果，係最難查嗰種錯',
    file: 'src/ResendFlow.gs',
    find: '    if (previewOnly) return;\n',
    replace: '    if (false) return;\n',
    tests: ['tests/send_options.test.js']
  },
  {
    id: 'sp-header-no-conf',
    why: '把 `Confirmed` 由 header 陣列刪返走'
      + '——即係第四十七輪批次之前嘅原狀：'
      + '`COLUMNS` 有、建表路徑冇，讀出嚟永遠 `undefined`，'
      + '而「未確認的特殊主日」永遠係 0',
    file: 'src/SpecialSundaysSeed.gs',
    find: '\n    C.CONFIRMED\n  ];',
    replace: '\n  ];',
    tests: [
      'tests/special_sundays_schema.test.js',
      // ⚠️ 呢一條要一齊紅。
      // 佢本來手砌咗 header，所以嗰個 bug 由頭到尾綠燈；
      // C4 修完之後，佢先至真係踩到建表路徑。
      'tests/unconfirmed_special_reminder.test.js'
    ]
  },
  {
    id: 'sp-header-tc-len',
    why: '中文標題陣列少一項'
      + '——建出嚟第 1 行同第 2 行會整排錯位，而冇任何嘢會出聲',
    file: 'src/SpecialSundaysSeed.gs',
    find: "  '日期是否已確認（留空＝已確認；只有填 FALSE 才算未確認）'\n];",
    replace: '];',
    tests: ['tests/special_sundays_schema.test.js']
  },
  {
    id: 'setcell-silent-skip',
    why: '把 `setCell()` 改返做 `if (col > 0)` 靜靜略過'
      + '——工具會報「已經標咗未確認」，而張表上面係空白。'
      + '報告講一件事、資料係另一件事，係最難查嗰種錯',
    file: 'src/AnnualCombined.gs',
    find: '      if (col <= 0) {\n        throw new Error(buildThreePartMessage_(\n          \'「\' + SHEETS.SPECIAL_SUNDAYS + \'」這一張工作表沒有「\' + key + \'」這一欄，\'\n            + \'所以這一次要寫進去的內容寫不了。\',\n          \'什麼都沒有寫入——這一次的年度合堂建議整批停下來了。\',\n          [\'去選單「維護 ▸ ⚠️ 補建 SpecialSundays 缺欄」補上這一欄\',\n            \'補完之後再撳一次這個工具\',\n            \'⚠️ 那一支工具只會在最後加欄，不會重排、不會改動任何既有資料\']));\n      }\n',
    replace: '      if (col <= 0) return;\n',
    tests: ['tests/special_sundays_schema.test.js']
  },
  {
    id: 'backfill-fills-values',
    why: '令補欄工具順手替既有列填 `FALSE`'
      + '——邊一行嘅日期真係未確認，只有幹事知；'
      + '猜一個值上去會即刻噴一堆假警報。'
      + '系統改壞幹事親手做嘅決定，比排錯更差',
    file: 'src/SpecialSundaysSeed.gs',
    find: '不會替任何一列填值',
    replace: '會替每一列填 FALSE',
    tests: ['tests/special_sundays_schema.test.js']
  },
  {
    id: 'drift-lint-autofix',
    why: '把「只報告，不修改」呢句拆走'
      + '——一支會順手改嘢嘅 lint，就唔再係「畀 Ivan 拍板」，'
      + '而係「幫你決定咗」',
    file: 'tools/lint-schema-drift.js',
    find: '// ⚠️ 只報告，不修改',
    replace: '// ⚠️ 掃描器',
    tests: ['tests/special_sundays_schema.test.js']
  },
  {
    id: 'combined-skip-overwrites',
    why: '令補填工具連已經填咗嘅 `SkipPostIDs` 都覆寫'
      + '——幹事填咗一個值落去就係佢對嗰一日嘅決定。'
      + '系統改壞幹事親手做嘅決定，比排錯更差',
    file: 'src/CombinedSkipBackfill.gs',
    find: "    if (item.oldValue !== '') { out.alreadyFilled.push(item); return; }",
    replace: "    if (false) { out.alreadyFilled.push(item); return; }",
    tests: ['tests/combined_skip_posts.test.js']
  },
  {
    id: 'cb-touch-protected',
    why: '拆走受保護季度嘅擋格'
      + '——2026T4 係正式上線嗰一季，一格都唔准改',
    file: 'src/CombinedSkipBackfill.gs',
    find: '    if (blocked.indexOf(item.quarterId.toUpperCase()) !== -1) {',
    replace: '    if (false) {',
    tests: ['tests/combined_skip_posts.test.js']
  },
  {
    id: 'cb-touch-inactive',
    why: '令補填工具連 `Active=FALSE` 嗰啲行都補'
      + '——嗰啲係範例列同已停用嘅安排，補落去等於整返生佢哋',
    file: 'src/CombinedSkipBackfill.gs',
    find: '    if (!isTrueValue_(row[C.ACTIVE])) { out.inactive.push(item); return; }',
    replace: '    if (false) { out.inactive.push(item); return; }',
    tests: ['tests/combined_skip_posts.test.js']
  },
  {
    id: 'cb-empty-fallback',
    why: '令 Config 揀成空白嗰陣退回內建嗰五個崗位'
      + '——噉就推翻咗幹事特登清空嗰個決定。'
      + '「空白＝冇設定過」同「空白＝我唔要」，系統分唔到就會做錯',
    file: 'src/CombinedSkipBackfill.gs',
    find: "    if (value === '') return;",
    replace: "    if (false) return;",
    tests: ['tests/combined_skip_posts.test.js']
  },
  {
    id: 'cb-detect-narrow',
    why: '只認 `Type`、唔認 `Title`'
      + '——「產生年度合堂建議」寫嘅係 `Type=合堂`，'
      + '而人手加嘅行成日係 `Title=五月合堂`。'
      + '只認一格就會靜靜漏咗一半，而報告會話「冇嘢要補」',
    file: 'src/CombinedSkipBackfill.gs',
    find: "  const text = (String((row && row[C.TYPE]) || '') + ' '"
      + "\n    + String((row && row[C.TITLE]) || '')).trim();",
    replace: "  const text = String((row && row[C.TYPE]) || '').trim();",
    tests: ['tests/combined_skip_posts.test.js']
  },
  {
    id: 'combined-detect-too-wide',
    why: '把判斷放闊到「有 Type 就算合堂」'
      + '——浸禮主日、宣教主日嗰幾日係**要排人**嘅，'
      + '誤判就會喺唔應該跳嘅日子跳咗五個崗位，而表面睇落好正常',
    file: 'src/CombinedSkipBackfill.gs',
    find: "  if (text.indexOf('合堂') !== -1) return true;",
    replace: '  if (text !== BACKTICK) return true;'.replace('BACKTICK', "''"),
    tests: ['tests/combined_skip_posts.test.js']
  },
  {
    id: 'cb-annual-blank',
    why: '把年度合堂工具改返做「跳過崗位一律留空」'
      + '——今日補完，出年產生 2028 年嘅四次合堂又再一次全部留空',
    file: 'src/AnnualCombined.gs',
    find: '    setCell(C.SKIP_POST_IDS, readCombinedDefaultSkipPostIds_());',
    replace: '',
    tests: ['tests/combined_skip_posts.test.js']
  },
  {
    id: 'cb-share-rehearsal',
    why: '把保護季度改成重用 `REHEARSAL_PROTECTED_QUARTERS`'
      + '——兩件唔同嘅事共用一格，日後有人為咗演練而加減一季，'
      + '就會靜靜連補填工具嘅保護範圍都改埋',
    file: 'src/Constants.gs',
    find: "  COMBINED_BACKFILL_BLOCKED_QUARTERS: 'COMBINED_BACKFILL_BLOCKED_QUARTERS',",
    replace: "  COMBINED_BACKFILL_BLOCKED_QUARTERS: 'REHEARSAL_PROTECTED_QUARTERS',",
    tests: ['tests/combined_skip_posts.test.js']
  },
  {
    id: 'reset-batch-single-only',
    why: '把選單入口改返做「一次只食一個 QuarterID」'
      + '——批次嗰幾支純函式全部寫好、全部綠燈，'
      + '而入口行唔到嗰條路。碼寫得啱而行唔到，等於冇寫過',
    file: 'src/Menu.gs',
    find: '  const parsed = parseQuarterResetBatchInput_(response.getResponseText());',
    replace: '  const parsed = { quarterIds: [normalizeIdInput_(response.getResponseText())],'
      + ' duplicates: [] };',
    tests: ['tests/quarter_reset_batch.test.js']
  },
  {
    id: 'reset-batch-no-blocked',
    why: '拆走受保護季度嗰一步'
      + '——2026T4 係正式上線嗰一季，清走咗係真係冇咗',
    file: 'src/Menu.gs',
    find: '  const split = splitQuarterResetTargets_(parsed.quarterIds, blockedQuarters);',
    replace: '  const split = { allowed: parsed.quarterIds, blocked: [] };',
    tests: ['tests/quarter_reset_batch.test.js']
  },
  {
    id: 'rs-blank-no-guard',
    why: '令 Config 填成空白就變成「乜都唔擋」'
      + '——一格打空咗就冧晒保護。'
      + '呢一支係全系統最危險嘅功能之一，冧咗就係真係清走咗',
    file: 'src/QuarterReset.gs',
    find: "  if (raw === '') raw = QUARTER_RESET_BLOCKED_DEFAULT;",
    replace: '',
    tests: ['tests/quarter_reset_batch.test.js']
  },
  {
    id: 'rs-stops-on-error',
    why: '拆走逐季 try/catch，一季爆咗就成批停低'
      + '——前面清咗一半、後面完全冇做，而幹事唔知停咗喺邊',
    file: 'src/QuarterReset.gs',
    find: '      const result = executeQuarterReset_(plan);' + '\n'
      + "      results.push({ quarterId: quarterId, ok: true, result: result, error: '' });",
    replace: '      const result = executeQuarterReset_(plan);',
    tests: ['tests/quarter_reset_batch.test.js']
  },
  {
    id: 'rs-no-after-audit',
    why: '淨係寫 before、唔寫 after'
      + '——「打算清」同「實際清咗」永遠對唔到帳，'
      + '一季中途爆咗，AuditLog 睇落同成功一模一樣',
    file: 'src/QuarterReset.gs',
    find: "          action: 'QUARTER_RESET_BATCH_AFTER',",
    replace: "          action: 'QUARTER_RESET_BATCH_BEFORE',",
    tests: ['tests/quarter_reset_batch.test.js']
  },
  {
    id: 'rs-dedup-silent',
    why: '靜靜去重，唔講返邊一個重複咗'
      + '——幹事以為佢揀咗三季，而畫面顯示兩季，佢會以為系統食咗一季',
    file: 'src/QuarterReset.gs',
    find: '      if (duplicates.indexOf(id) === -1) duplicates.push(id);',
    replace: '      if (false) duplicates.push(id);',
    tests: ['tests/quarter_reset_batch.test.js']
  },
  {
    id: 'reset-batch-totals-only',
    why: '合併確認畫面淨係印總數，唔印逐季細項'
      + '——幹事睇唔出邊一季會清走乜，'
      + '而佢要判斷嘅正正就係「呢一季係咪真係可以清」',
    file: 'src/Menu.gs',
    find: '    describeQuarterResetPlanLines_(entry.quarterId, entry.plan)'
      + '.forEach(function (l) {',
    replace: '    [].forEach(function (l) {',
    tests: ['tests/quarter_reset_batch.test.js']
  },
  {
    id: 'rs-touch-svc-dates',
    why: '令清理連 `ServiceDates` 都掃'
      + '——2027T1 嗰 13 個主日唔係測試痕跡，係嗰一季本身嘅設定。'
      + '清走咗，主流程即刻顯示「這一季的 Quarters 沒有填生成日期」',
    file: 'src/QuarterReset.gs',
    find: "  plan.pdfFiles.forEach(function (f) {",
    replace: '  deleteRowsMatching_(SHEETS.SERVICE_DATES, function () { return false; }, errors);' + '\n'
      + '  plan.pdfFiles.forEach(function (f) {',
    tests: ['tests/quarter_reset_batch.test.js']
  },
  {
    id: 'unsaved-flag-default-on',
    why: '把 `allowUnsaved` 改成「冇傳就當 true」'
      + '——一個根本冇撳過嗰粒掣嘅寄出會靜靜跳過閘門，'
      + '而嗰個正正就係呢道閘當初要防嗰件事',
    file: 'src/WebAppGuards.gs',
    find: '  return !!sendOptions && sendOptions.allowUnsaved === true;',
    replace: '  return !sendOptions || sendOptions.allowUnsaved !== false;',
    tests: ['tests/send_without_saving.test.js']
  },
  {
    id: 'unsaved-flag-truthy',
    why: '用 `if (flag)` 嗰種 truthy 判斷'
      + '——字串 `\'false\'` 係 truthy，噉樣就會靜靜放行',
    file: 'src/WebAppGuards.gs',
    find: '  return !!sendOptions && sendOptions.allowUnsaved === true;',
    replace: '  return !!(sendOptions && sendOptions.allowUnsaved);',
    tests: ['tests/send_without_saving.test.js']
  },
  {
    id: 'unsaved-allow-unresolved',
    why: '連「有格嘅文字系統認唔出」都放行'
      + '——嗰個唔係「改咗未儲存」，係「表上有系統讀唔明嘅字」。'
      + '寄咗出去之後嗰幾格會變成乜，系統自己都講唔出',
    file: 'src/WebAppGuards.gs',
    find: '  if (s.unresolvedCount > 0) {',
    replace: '  if (false) {',
    tests: ['tests/send_without_saving.test.js']
  },
  {
    id: 'unsaved-allow-pending',
    why: '連「有修改申報未處理」都放行——嗰啲仲未入到表度',
    file: 'src/WebAppGuards.gs',
    find: '  if (s.pendingRequestCount > 0) {',
    replace: '  if (false) {',
    tests: ['tests/send_without_saving.test.js']
  },
  {
    id: 'unsaved-allow-unreadable',
    why: '讀唔到狀態（`-1`）都照放行'
      + '——「查不到」唔等於「冇嘢」。呢個方向估錯咗，'
      + '就係寄一份冇人知內容嘅嘢出去',
    file: 'src/WebAppGuards.gs',
    find: '  if (s.error || s.gridChangeCount < 0 || s.unresolvedCount < 0',
    replace: '  if (false && (s.error || s.gridChangeCount < 0 || s.unresolvedCount < 0',
    tests: ['tests/send_without_saving.test.js']
  },
  {
    id: 'unsaved-ack-prechecked',
    why: '把「我明白」嗰個框改成預設勾住'
      + '——整個確認畫面唯一嘅作用就係逼佢睇一眼，'
      + '預設勾住等於冇咗嗰一眼',
    file: 'src/ui/ScriptSendPaper.html',
    find: '    ackBox.checked = false;',
    replace: '    ackBox.checked = true;',
    tests: ['tests/send_without_saving.test.js']
  },
  {
    id: 'unsaved-no-confirm',
    why: '撳〔寄出但不儲存〕直接去寄，唔出中間嗰個確認畫面'
      + '——真正嘅風險係「幹事以為寄出去嘅係佢啱啱改嗰一版」，'
      + '而嗰個畫面就係唯一講清楚呢件事嘅地方',
    file: 'src/ui/ScriptSendPaper.html',
    find: "        ? [button('寄出但不儲存', () => renderSendWithoutSavingConfirm(s), 'secondary')]",
    replace: "        ? [button('寄出但不儲存', () => renderSendMain(s, { allowUnsaved: true }), 'secondary')]",
    tests: ['tests/send_without_saving.test.js']
  },
  {
    id: 'unsaved-no-banner',
    why: '拆走寄完之後主畫面嗰一句'
      + '——佢撳完寄出、閂咗個窗，五分鐘之後就會唔記得自己揀咗乜，'
      + '而嗰陣佢會以為收信嘅人睇到嘅係佢表上而家嗰個內容',
    file: 'src/WebAppDashboard.gs',
    find: "  return '⚠️ 上一次寄出的是第 ' + release.versionNo + ' 版，'",
    replace: "  if (true) return '';" + '\n'
      + "  return '⚠️ 上一次寄出的是第 ' + release.versionNo + ' 版，'",
    tests: ['tests/send_without_saving.test.js']
  },
  {
    id: 'unsaved-banner-sticks',
    why: '儲存咗之後嗰一句照樣顯示'
      + '——一句永遠關唔甩嘅警告，好快就冇人再讀',
    file: 'src/WebAppDashboard.gs',
    find: "  if (!(grid > 0)) return '';",
    replace: '',
    tests: ['tests/send_without_saving.test.js']
  },
  {
    id: 'unsaved-no-sendlog-note',
    why: '唔把放行紀錄寫入 SendLog'
      + '——日後查「佢點解收到舊版」就要去翻 AuditLog 對時間，'
      + '而一次寄咗幾十封嘅時候實際上對唔到',
    file: 'src/SendOptions.gs',
    find: '  if (!rel) return base;',
    replace: '  if (true) return base;',
    tests: ['tests/send_without_saving.test.js']
  },
  {
    id: 'unsaved-mutates-options',
    why: '直接改呼叫方傳嚟嗰個 `sendOptions`'
      + '——同一個物件之後再用嗰陣會帶住一個唔關佢事嘅標記',
    file: 'src/WebAppFlow.gs',
    find: '  return Object.assign({}, sendOptions || {}, {',
    replace: '  return Object.assign(sendOptions || {}, {',
    tests: ['tests/send_without_saving.test.js']
  },
  {
    id: 'unsaved-cells-not-shared',
    why: '確認畫面自己再格式化一次嗰幾格'
      + '——三個地方講同一件事而各自格式化，一定會分岔，'
      + '而分岔咗之後兩個畫面對住同一格會顯示唔同嘅嘢',
    file: 'src/WebAppSendPlan.gs',
    find: "    rows = buildSavedChangeRows_(resolved.changes, postNameById, 'MANUAL');",
    replace: '    rows = resolved.changes.map(function (c) {' + '\n'
      + '      return { serviceDate: c.serviceDate, postId: c.postId,' + '\n'
      + "        postNameTC: c.postId, fromName: '', toName: '' };" + '\n'
      + '    });',
    tests: ['tests/send_without_saving.test.js']
  },
  {
    id: 'cfg-missing-lies',
    why: '把 `MISSING` 講返做「來自 Config」'
      + '——畫面叫幹事去搵一格根本唔存在嘅嘢，'
      + '而佢會以為自己睇漏咗眼',
    file: 'src/Config.gs',
    find: "  // MISSING：⚠️ 這一句就是整組要修的那一句。" + '\n'
      + "  return '程式內建預設值——「' + key + '」這個 Key 還沒有加進 Config 工作表，'",
    replace: "  return '來自 Config「' + key + '」';" + '\n'
      + "  // eslint-disable-next-line no-unreachable" + '\n'
      + "  return '程式內建預設值——「' + key + '」這個 Key 還沒有加進 Config 工作表，'",
    tests: ['tests/config_value_source.test.js']
  },
  {
    id: 'cfg-missing-eq-def',
    why: '把「張表根本冇嗰一行」同「有行但係空白」當成同一件事'
      + '——前者叫佢跑補建，後者叫佢喺嗰一格填。'
      + '講錯咗，佢就會做一件冇用嘅事',
    file: 'src/Config.gs',
    find: '  const present = Object.prototype.hasOwnProperty.call(config, key);',
    replace: '  const present = true;',
    tests: ['tests/config_value_source.test.js']
  },
  {
    id: 'config-error-eq-missing',
    why: '把型別壞格扮成 `MISSING`'
      + '——叫幹事「去跑補建 Config 參數」對住一個型別壞格完全冇用，'
      + '嗰一行本來就喺度，跑幾多次都一樣',
    file: 'src/Config.gs',
    find: '    return { value: fallback, source: CONFIG_VALUE_SOURCES.ERROR };',
    replace: '    return { value: fallback, source: CONFIG_VALUE_SOURCES.MISSING };',
    tests: ['tests/config_value_source.test.js']
  },
  {
    id: 'blocked-not-first',
    why: '把「受保護季度」嗰個判斷排返去最後'
      + '——`SP-2026-02` 會先被「已經填了值」接走，'
      + '而確認畫面就會報「受保護季度（2026T4）：0 行」。'
      + '一道從來冇響過嘅警報，同冇裝過係一樣嘅',
    file: 'src/CombinedSkipBackfill.gs',
    find: '    if (blocked.indexOf(item.quarterId.toUpperCase()) !== -1) {' + '\n'
      + '      out.blocked.push(item);' + '\n'
      + '      return;' + '\n'
      + '    }' + '\n'
      + '    if (!isCombinedSpecialSunday_(row)) { out.notCombined.push(item); return; }' + '\n'
      + '    if (!isTrueValue_(row[C.ACTIVE])) { out.inactive.push(item); return; }' + '\n'
      + "    if (item.oldValue !== '') { out.alreadyFilled.push(item); return; }",
    replace: '    if (!isCombinedSpecialSunday_(row)) { out.notCombined.push(item); return; }' + '\n'
      + '    if (!isTrueValue_(row[C.ACTIVE])) { out.inactive.push(item); return; }' + '\n'
      + "    if (item.oldValue !== '') { out.alreadyFilled.push(item); return; }" + '\n'
      + '    if (blocked.indexOf(item.quarterId.toUpperCase()) !== -1) {' + '\n'
      + '      out.blocked.push(item);' + '\n'
      + '      return;' + '\n'
      + '    }',
    tests: ['tests/combined_skip_posts.test.js']
  },
  {
    id: 'inv-error-is-ok',
    why: '令一條算唔出嘅不變量報成通過'
      + '——「查不到」當成「冇事」，就係呢個專案由第一輪殺到而家嗰種錯。'
      + '一支「拋咗錯就當成通過」嘅檢查，比冇檢查更差',
    file: 'src/Invariants.gs',
    find: '      results.push(invariantResult_(id, label, INVARIANT_STATUS.ERROR,',
    replace: '      results.push(invariantResult_(id, label, INVARIANT_STATUS.OK,',
    tests: ['tests/invariants.test.js']
  },
  {
    id: 'inv-stops-on-first',
    why: '一條爆咗就成批停低'
      + '——一個細問題會掩蓋晒後面全部',
    file: 'src/Invariants.gs',
    find: '    try {' + '\n'
      + '      const out = fn();',
    replace: '    if (true) {' + '\n'
      + '      const out = fn();',
    tests: ['tests/invariants.test.js']
  },
  {
    id: 'inv-error-not-must',
    why: '把「算唔出」由 MUST 降做資訊'
      + '——「我哋唔知對唔對得上」同「對唔上」一樣咁重要',
    file: 'src/Invariants.gs',
    find: '  const broken = report.failedCount + report.errorCount;',
    replace: '  const broken = report.failedCount;',
    tests: ['tests/invariants.test.js']
  },
  {
    id: 'inv-i08-tautology',
    why: '把 I08 嘅 `verify` 改成抄 `produce` 一份'
      + '——自己同自己比，永遠綠。'
      + '而嗰個正正就係第四十六輪「3 位 vs 9 封」冇被捉到嘅原因',
    file: 'src/Invariants.gs',
    find: '      verify: function (quarterId, sendOptions) {' + '\n'
      + '        // 另一條路：直接由收件人解析器數，唔經 `planStep2_()`。' + '\n'
      + '        const versionNo = findLatestVersionNo(quarterId);' + '\n'
      + '        return resolveActualRecipients_(' + '\n'
      + '          quarterId, versionNo, MAIL_STAGES.REVIEW, sendOptions).length;' + '\n'
      + '      }',
    replace: '      verify: function (quarterId, sendOptions) {' + '\n'
      + '        return planStep2_(quarterId, sendOptions).recipientCount;' + '\n'
      + '      }',
    tests: ['tests/invariants.test.js']
  },
  {
    id: 'inv-i08-no-pick',
    why: '只用「冇揀」嗰一份 `sendOptions` 跑'
      + '——兩個算法喺嗰種情況啱啱好重合，'
      + '而第四十七輪 e2e 就係噉樣由頭綠到尾',
    file: 'src/Invariants.gs',
    find: '      {' + '\n'
      + "        label: '（自己選擇 1 位）'," + '\n'
      + "        options: { recipientScope: SEND_RECIPIENT_SCOPE.PICK, pickedKeys: ['__I08_PROBE__'] }" + '\n'
      + '      }',
    replace: "      { label: '（沒有選項，第二次）', options: null }",
    tests: ['tests/invariants.test.js']
  },
  {
    id: 'inv-writes-back',
    why: '令不變量寫一筆 AuditLog'
      + '——一支唯讀檢查寫嘢落去，就會令佢自己成為佢要驗嗰個狀態嘅一部分',
    file: 'src/Invariants.gs',
    find: 'function runAllInvariants_(quarterId, set) {' + '\n'
      + '  const results = [];',
    replace: 'function runAllInvariants_(quarterId, set) {' + '\n'
      + '  const results = [];' + '\n'
      + "  writeAuditLog_({ action: '跑不變量' });",
    tests: ['tests/invariants.test.js']
  },
  {
    id: 'st-skip-dryrun-gate',
    why: '拆走自測機嘅 `DRY_RUN` 閘'
      + '——自測機會走完整個寄送流程，'
      + 'DRY_RUN=FALSE 嗰陣嗰啲信會真係寄出去畀全體義工',
    file: 'src/SelfTestRunner.gs',
    find: '  if (getConfig(CONFIG_KEYS.DRY_RUN, true) !== true) {',
    replace: '  if (getConfig(CONFIG_KEYS.DRY_RUN, true) === false) {',
    tests: ['tests/selftest_runner.test.js']
  },
  {
    id: 'st-skip-protected',
    why: '拆走「沙盒季度唔可以係受保護季度」嗰道閘'
      + '——自測機每次開跑都會把沙盒季度整季清乾淨。'
      + '行錯咗一季就係真係清咗一季真資料',
    file: 'src/SelfTestRunner.gs',
    find: '  if (inList(readQuarterResetBlockedQuarters_())) {',
    replace: '  if (false) {',
    tests: ['tests/selftest_runner.test.js']
  },
  {
    id: 'st-fake-stage',
    why: '直接寫 `Quarters.Stage` 去造狀態，唔行真實入口'
      + '——噉就係「fixture 造到一個真實 code path 造唔出嘅狀態」，'
      + '即係呢一層要擋嗰件事本身',
    file: 'src/SelfTestRunner.gs',
    find: '/** S02：生成初稿。 */',
    replace: '/** S02：生成初稿。 */' + '\n'
      + '// eslint-disable-next-line' + '\n'
      + "function selfTestFakeStage_(q) { setQuarterStage_(q, 'REVIEW_SENT', '假'); }",
    tests: ['tests/selftest_runner.test.js']
  },
  {
    id: 'st-time-silent-stop',
    why: '時間到靜靜停低，唔標成未跑'
      + '——就會變成「跑完了，全綠」嘅假象，而嗰個假象比冇跑過更差',
    file: 'src/SelfTestRunner.gs',
    // ⚠️ `find` 特登只鎖住 `status:` 嗰一行——上一行寫住嘅
    // 物件屬性存取會被 `scan-staged-secrets.js` 當成一個國碼網域。
    find: '        status: SELFTEST_STATUS.NOT_RUN, checks: [], failedChecks: [],',
    replace: '        status: SELFTEST_STATUS.PASSED, checks: [], failedChecks: [],',
    tests: ['tests/selftest_runner.test.js']
  },
  {
    id: 'st-inv-not-fail',
    why: '情境自己全綠而不變量紅咗嗰陣，整體照樣報綠'
      + '——一個「畫面同表對唔上」會被一份綠色報告蓋住',
    file: 'src/SelfTestRunner.gs',
    find: '      if (caused.length > 0 && outcome.status === SELFTEST_STATUS.PASSED) {',
    replace: '      if (false) {',
    tests: ['tests/selftest_runner.test.js',
      'tests/selftest_invariant_attribution.test.js']
  },
  {
    id: 'st-scenario-throws-all',
    why: '一個情境爆咗就成批停低'
      + '——Ivan 要重跑十次先見得晒十個問題',
    file: 'src/SelfTestRunner.gs',
    find: "      log_('ERROR', '自測機 ' + failedScenarioId + ' 拋錯：' + err.message);",
    replace: '      throw err;',
    tests: ['tests/selftest_runner.test.js']
  },
  {
    id: 'st-record-can-fail',
    why: '令錄影失敗會拋錯'
      + '——錄影係順手做嘅嘢，唔應該有權令一個情境變紅',
    file: 'src/SelfTestRunner.gs',
    find: "    log_('WARN', 'selfTestRecordPayload_ 失敗（' + scenarioId + '／' + apiName",
    replace: "    throw err;" + '\n'
      + "    // eslint-disable-next-line no-unreachable" + '\n'
      + "    log_('WARN', 'selfTestRecordPayload_ 失敗（' + scenarioId + '／' + apiName",
    tests: ['tests/selftest_runner.test.js']
  },
  {
    id: 'mk-uses-math-random',
    why: '亂行機改用 `Math.random()`'
      + '——同一個 seed 就唔會再行同一條路，'
      + '而一個紅咗嘅步驟永遠重現唔到',
    file: 'src/MonkeyRun.gs',
    find: '    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;',
    replace: '    return Math.random();',
    tests: ['tests/monkey_run.test.js']
  },
  {
    id: 'mk-resume-restarts',
    why: '續跑唔快轉過上一次抽咗嘅次數'
      + '——「繼續亂行」會由第一抽再嚟一次，即係行返上一次同一條路，'
      + '而報告寫住「繼續」',
    file: 'src/MonkeyRun.gs',
    find: '  for (let i = 0; i < (Number(skip) || 0); i++) next();',
    replace: '',
    tests: ['tests/monkey_run.test.js']
  },
  {
    id: 'mk-no-path-in-report',
    why: '報告唔印「走到這裡的完整步驟」'
      + '——紅咗都重現唔到，而一個重現唔到嘅 bug 報告等於冇',
    file: 'src/MonkeyRun.gs',
    find: "    lines.push('　 走到這裡的完整步驟：' + (f.path.join(' → ') || '（第一步）'));",
    replace: '',
    tests: ['tests/monkey_run.test.js']
  },
  {
    id: 'mk-no-seed-in-report',
    why: '報告唔印 seed——冇 seed 就重現唔到',
    file: 'src/MonkeyRun.gs',
    find: "    '隨機種子：' + report.seed + '（用同一個種子重跑，會走同一條路）',",
    replace: "    '（隨機）',",
    tests: ['tests/monkey_run.test.js']
  },
  {
    id: 'mk-dryrun-once-only',
    why: '只喺開跑嗰陣驗一次 DRY_RUN，中途唔再驗'
      + '——一次亂行行幾分鐘，中間有人改咗 Config，'
      + '後面嗰幾十步就會真係寄信',
    file: 'src/MonkeyRun.gs',
    find: '      if (getConfig(CONFIG_KEYS.DRY_RUN, true) !== true) {',
    replace: '      if (false) {',
    tests: ['tests/monkey_run.test.js']
  },
  {
    id: 'mk-swallow-throws',
    why: '把合法動作嘅拋錯吞咗'
      + '——一個 `legal` 講得通而執行起上嚟拋錯嘅動作，'
      + '就係「畫面話得而系統話唔得」，嗰個本身就係一個發現',
    file: 'src/MonkeyRun.gs',
    find: "        step: i, kind: '合法動作拋錯',",
    replace: "        step: i, kind: '（略過）',",
    tests: ['tests/monkey_run.test.js']
  },
  {
    id: 'mk-skip-preflight',
    why: '拆走開跑之前嗰套閘'
      + '——亂行機比自測機更危險：佢會用一條冇人預先睇過嘅次序去撳嘢',
    file: 'src/MonkeyRun.gs',
    find: '  const gate = checkSelfTestPreconditions_(quarterId);',
    replace: '  const gate = { ok: true, reasons: [] };',
    tests: ['tests/monkey_run.test.js']
  },
  {
    id: 'mk-no-invariants',
    why: '每一步唔跑不變量'
      + '——亂行機自己冇斷言，佢全部靠不變量出力。'
      + '拆走咗就變成「隨機撳嘢，而冇人睇結果」',
    file: 'src/MonkeyRun.gs',
    find: '      const inv = runAllInvariants_(quarterId);',
    replace: '      const inv = { results: [] };',
    tests: ['tests/monkey_run.test.js']
  },
  {
    id: 'ui-none-before-unsaved',
    why: '**把第四十七輪嗰個死碼種返落去**：'
      + '把 `kind === NONE` 嗰段排返去「未儲存」嗰段前面。'
      + '⚠️ 呢一條就係第 2 層存在嘅唯一理由——'
      + '前面三層全部捉唔到佢，因為佢係 HTML `<script>` 入面'
      + '一個控制流次序問題，而所有測試都只係喺讀原始碼字串',
    file: 'src/ui/ScriptSendPaper.html',
    find: '    // ── 一、只有未儲存擋住 ⇒ 一個救得返自己嘅窗 ────────────────' + '\n'
      + '    if (s.blockedByUnsavedOnly) {' + '\n'
      + '      renderUnsavedBlocksSend(s);' + '\n'
      + '      return;' + '\n'
      + '    }',
    replace: '    // （突變：呢一段被推到 NONE 之後）',
    // ⚠️ 兩份都要紅。
    // `send_unsaved_gate.test.js` 驗嘅係**原始碼次序**；
    // `ui_replay.test.js` 驗嘅係**真正畫咗乜出嚟**。
    // 兩者係唔同層次嘅證據——前者答「排咗喺邊」，
    // 後者答「行唔行得到」。
    tests: ['tests/ui_replay.test.js', 'tests/send_unsaved_gate.test.js']
  },
  {
    id: 'ui-replay-not-real',
    why: '把重播用嘅 `s` 由「後端算出嚟」改成「我打落去」'
      + '——打落去就係喺假設答案，而假設答案就係'
      + '第四十七輪個 bug 冇被捉到嘅原因',
    file: 'tests/ui_replay.test.js',
    find: '    blockedByUnsavedOnly: gas.computeSendBlockedByUnsavedOnly_(f),',
    replace: '    blockedByUnsavedOnly: true,',
    // ⚠️ 呢一條突變改嘅係測試本身。
    // 佢驗嘅係：一份**唔會反映後端改動**嘅 payload，
    // 會令「冇未儲存改動」嗰一條斷言即刻紅。
    tests: ['tests/ui_replay.test.js']
  },
  {
    id: 'pdf-block-sends-menu',
    why: '把「缺個人 PDF」嗰個窗改返做「去試算表選單自己搞掂」'
      + '——嗰個窗把幹事踢出四步主流程，'
      + '而第四十四輪已經為「寄紙本」修過同一個毛病',
    file: 'src/ui/ScriptZone1.html',
    find: '        openMissingPdfBlock(missing, versionNo, sendOpts);',
    replace: "        openModal('正式發出：已中止', ["
      + "errorPart('要留意', '先去試算表選單「準備工作 ▸ 產生個人 PDF」')"
      + "], [button('知道了', () => closeModal(), '')]);",
    tests: ['tests/missing_pdf_inline.test.js']
  },
  {
    id: 'pdf-half-says-done',
    why: '做唔完都顯示「已經產生好」'
      + '——第四十四輪嗰個「做齊咗但仲有幾份唔見」就係同一種錯',
    file: 'src/ui/ScriptZone1.html',
    find: '      if (!last.done) {',
    replace: '      if (false) {',
    tests: ['tests/missing_pdf_inline.test.js']
  },
  {
    id: 'pdf-no-way-back',
    why: '做完之後唔畀路行返轉頭去正式發出'
      + '——佢又要自己搵路返嚟，而嗰個就係本來要修嗰件事',
    file: 'src/ui/ScriptZone1.html',
    find: "        button('回到正式發出', () => { closeModal(); openOfficial(sendOpts); }, ''),",
    replace: "        button('知道了', () => closeModal(), ''),",
    tests: ['tests/missing_pdf_inline.test.js']
  },
  {
    id: 'pdf-block-removed',
    why: '**把個擋拆走**——冇個人 PDF 都照寄。'
      + '收信嘅人會收到一封講住「附件係你嗰一份」而冇附件嘅信',
    file: 'src/ui/ScriptZone1.html',
    find: '      if (missing.blocked) {',
    replace: '      if (false) {',
    tests: ['tests/missing_pdf_inline.test.js']
  },
  {
    id: 'st-s12-really-rolls',
    why: '令 S12 真係執行回退'
      + '——回退會蓋走現況，而後面 S13–S15 全部靠住嗰個現況。'
      + '嗰種假紅最難查：幾個情境驗緊一個佢哋以為冇變過嘅狀態',
    file: 'src/SelfTestRunner.gs',
    find: "  const plan = selfTestCall_('S12', 'apiRollbackPlan',",
    replace: "  apiRollbackExecute(quarterId, target, '');" + '\n'
      + "  const plan = selfTestCall_('S12', 'apiRollbackPlan',",
    tests: ['tests/selftest_runner.test.js']
  },
  {
    id: 'st-s14-fake-special',
    why: '令 S14 唔真嘅寫 `SpecialSundays`'
      + '——喺記憶體造一個 overlay 就係「fixture 造到一個'
      + '真實 code path 造唔出嘅狀態」，即係呢一層要擋嗰件事本身',
    file: 'src/SelfTestRunner.gs',
    find: '  sheet.appendRow(row);\n'
      + "  t.expect('特殊主日那一行真的寫進工作表'",
    replace: "  t.expect('特殊主日那一行真的寫進工作表'",
    tests: ['tests/selftest_runner.test.js']
  },
  {
    id: 'st-resume-only-passed',
    why: '**把死鎖種返落去**：續跑只跳過通過咗嘅情境。'
      + '任何一個早期情境紅咗，後面十三個永遠跑唔到——'
      + '而後面嗰十三個先至係呢部機器存在嘅理由。'
      + 'Ivan 現場撳咗三次，三次報告一模一樣',
    file: 'src/SelfTestRunner.gs',
    find: '      || previous.status === SELFTEST_STATUS.FAILED',
    replace: '      || (false && previous.status === SELFTEST_STATUS.FAILED)',
    tests: ['tests/selftest_resume_deadlock.test.js']
  },
  {
    id: 'st-skip-shows-green',
    why: '跳過嗰陣一律顯示成通過'
      + '——一個紅色情境會變成綠，而嗰個係講大話',
    file: 'src/SelfTestRunner.gs',
    find: '        status: previous.status,',
    replace: '        status: SELFTEST_STATUS.PASSED,',
    tests: ['tests/selftest_resume_deadlock.test.js']
  },
  {
    id: 'st-skip-loses-evidence',
    why: '跳過嗰陣唔帶返上一次嘅證據'
      + '——一個冇證據嘅「紅」等於冇報告過',
    file: 'src/SelfTestRunner.gs',
    find: '        failedChecks: previous.failedChecks || [],',
    replace: '        failedChecks: [],',
    tests: ['tests/selftest_resume_deadlock.test.js']
  },
  {
    id: 'st-next-step-wrong',
    why: '三種情況都印同一句「撳繼續跑自測」'
      + '——其中一種撳咗係冇用嘅，而 Ivan 就係照住嗰一句白撳咗三次',
    file: 'src/SelfTestRunner.gs',
    find: "    lines.push('修好之後撳「測試工具 ▸ ▶️ 只重跑紅色情境」——'",
    replace: "    lines.push('撳「測試工具 ▸ ▶️ 繼續跑自測」——'",
    tests: ['tests/selftest_resume_deadlock.test.js']
  },
  {
    id: 'st-rerun-resets',
    why: '「只重跑紅色情境」順手重設埋沙盒季度'
      + '——呢個入口嘅意思就係「保留現場，只重跑嗰幾個」',
    file: 'src/SelfTestRunner.gs',
    find: "  selfTestMenuEntry_(true, '▶️ 只重跑紅色情境', true);",
    replace: "  selfTestMenuEntry_(false, '▶️ 只重跑紅色情境', true);",
    tests: ['tests/selftest_resume_deadlock.test.js']
  },
  {
    id: 'st-rerun-clears-green',
    why: '「只重跑紅色情境」連通過咗嗰啲都清走'
      + '——噉就同「由頭再跑一次」冇分別，而時間預算又會爆',
    file: 'src/SelfTestRunner.gs',
    find: '    if (status === SELFTEST_STATUS.FAILED || status === SELFTEST_STATUS.ERROR' + '\n'
      + '        || status === SELFTEST_STATUS.BLOCKED) {',
    replace: '    if (true) {',
    tests: ['tests/selftest_resume_deadlock.test.js']
  },
  {
    id: 'st-inv-all-per-scenario',
    why: '每個情境都跑全套不變量'
      + '——I04 掃全表 10,920 行、I08 每條要行一次完整 plan，'
      + '兩個情境就食光時間預算。呢個就係死鎖嘅另一半',
    file: 'src/SelfTestRunner.gs',
    find: '    const inv = runAllInvariants_(quarterId, INVARIANT_SET.PER_SCENARIO);',
    replace: '    const inv = runAllInvariants_(quarterId, INVARIANT_SET.ALL);',
    tests: ['tests/selftest_resume_deadlock.test.js']
  },
  {
    id: 'st-no-timing-line',
    why: '報告唔講時間用喺邊'
      + '——冇呢一行，下次再卡住又要由零查一次',
    file: 'src/SelfTestRunner.gs',
    find: "    lines.push('時間：用了 ' + describeSelfTestDuration_(report.totalMs)",
    replace: "    lines.push('（時間：略）'); if (false) lines.push('時間：用了 '"
      + " + describeSelfTestDuration_(report.totalMs)",
    tests: ['tests/selftest_resume_deadlock.test.js']
  },
  {
    id: 'st-s01-runs-dirty',
    why: '拆走 S01 嘅「只喺全新開跑時有意義」'
      + '——S02 已經生成咗 v0，所以 S01 三條斷言一定紅，'
      + '而嗰三條紅係自測機自己嘅問題，唔係系統嘅問題',
    file: 'src/SelfTestRunner.gs',
    find: '    if (scenario.requiresFreshQuarter) {',
    replace: '    if (false) {',
    tests: ['tests/selftest_resume_deadlock.test.js']
  },
  {
    id: 'st-fresh-by-flag',
    why: '查唔到季度狀態嗰陣當成「全新」'
      + '——噉就會喺一個唔知咩狀態嘅季度上面跑一個假設佢全新嘅情境',
    file: 'src/SelfTestRunner.gs',
    find: "        freshness = { fresh: false, reason: '查不到這一季的狀態：' + err.message };",
    replace: "        freshness = { fresh: true, reason: '' };",
    tests: ['tests/selftest_resume_deadlock.test.js']
  },
  {
    id: 'inv-na-counts-failed',
    why: '把「唔適用」算成失敗'
      + '——Stage 到 REQUESTS_APPLIED 之前每一個情境嘅 I08.step4 都會紅，'
      + '即係 S01 到 S08 全部一定紅，不論系統有冇問題。'
      + '紅色一多就冇人睇，而嗰個就係假警報',
    file: 'src/Invariants.gs',
    find: '        INVARIANT_STATUS.NOT_APPLICABLE, '
      + "'（這個狀態下不適用）', na, na));",
    replace: '        INVARIANT_STATUS.FAILED, '
      + "'（這個狀態下不適用）', na, na));",
    tests: ['tests/sendlog_columns.test.js']
  },
  {
    id: 'inv-na-hides-error',
    why: '把「有版本而其中一條路拋錯」都當成唔適用'
      + '——呢一組就變成「把紅色改成睇唔見」，比修之前更差',
    file: 'src/Invariants.gs',
    find: "          entry.where, INVARIANT_STATUS.ERROR, '兩條路數出同一個數', '算不出來',",
    replace: "          entry.where, INVARIANT_STATUS.NOT_APPLICABLE, "
      + "'兩條路數出同一個數', '算不出來',",
    tests: ['tests/sendlog_columns.test.js']
  },
  {
    id: 'inv-i04-always-full',
    why: '拆走 I04 嘅季度篩選，永遠掃全表'
      + '——自測機每個情境掃 10,920 行，15 個情境就係 16 萬行',
    file: 'src/Invariants.gs',
    find: '    if (only && qid !== only) return;',
    replace: '',
    tests: ['tests/sendlog_columns.test.js']
  },
  {
    id: 'sendlog-no-block',
    why: '轉寄生效而缺 `IntendedEmail` 都照寄'
      + '——SendLog 每一行嘅收件人都會係同一個轉寄地址，'
      + '查唔到邊個收到乜。第四十一輪 H 組要防嘅就係呢件事',
    file: 'src/Mailer.gs',
    find: '  throw new Error(buildThreePartMessage_(' + '\n'
      + "    '轉寄測試地址生效中（' + redirectTargets.join('、') + '），'",
    replace: '  log_(' + "'WARN', " + "'（已略過）'); return;" + '\n'
      + '  // eslint-disable-next-line no-unreachable' + '\n'
      + '  throw new Error(buildThreePartMessage_(' + '\n'
      + "    '轉寄測試地址生效中（' + redirectTargets.join('、') + '），'",
    tests: ['tests/sendlog_columns.test.js']
  },
  {
    id: 'sendlog-block-always',
    why: '轉寄冇生效都照擋'
      + '——把成個寄送流程綁死喺一個歷史遺留問題上。'
      + '轉寄冇生效嗰陣，兩個地址本來就一樣，查得返',
    file: 'src/Mailer.gs',
    find: '  if (redirectTargets.length === 0) {',
    replace: '  if (false) {',
    tests: ['tests/sendlog_columns.test.js']
  },
  {
    id: 'sendlog-unknown-ok',
    why: '讀唔到轉寄設定嗰陣當成「冇生效」'
      + '——「查不到」當成「冇事」，而估錯呢一邊嘅代價'
      + '係一批查唔返嘅寄送紀錄',
    file: 'src/Mailer.gs',
    find: "    redirectTargets = ['（讀不到轉寄設定：' + err.message + '）'];",
    replace: '    redirectTargets = [];',
    tests: ['tests/sendlog_columns.test.js']
  },
  {
    id: 'sendlog-backfill-fills',
    why: '補欄工具順手替既有行填值'
      + '——舊行到底寄咗去邊已經無從得知，猜一個上去就係造假紀錄。'
      + '而一份造假嘅寄送紀錄，比冇紀錄更差：'
      + '冇紀錄你知道自己唔知，假紀錄會令你以為自己知',
    file: 'src/MailRedirect.gs',
    find: '不會替任何一行填值',
    replace: '會替每一行填返個估計值',
    tests: ['tests/sendlog_columns.test.js']
  },
  {
    id: 'lint-quiet-about-gap',
    why: '把 lint 嗰句「掃唔到唔等於冇事」改返做中性免責聲明'
      + '——之前嗰一句讀落似免責聲明，而實際上嗰 19 張入面'
      + '真係有一張缺欄，而且缺咗嗰兩欄係特登為咗一件事而加嘅',
    file: 'tools/lint-schema-drift.js',
    find: "lines.push('⚠️ ⚠️ 上面嗰 ' + uncovered.length + "
      + "' 張，**唔係「查過冇事」，係「查唔到」。**');",
    replace: "lines.push('（以上僅供參考。）');",
    tests: ['tests/sendlog_columns.test.js']
  },
  {
    id: 'st-s03-no-unresolved',
    why: '拆走 S03 嗰條 `unresolvedCount === 0`'
      + '——冇咗佢，一個「最小改動」順手令系統整批擋住，'
      + '而報告上面 S03 仍然係綠。第五十輪就係噉，'
      + '後面七條情境連環倒，主流程一步都冇跑過',
    file: 'src/SelfTestRunner.gs',
    find: "  t.equal('而且 ' + want + ' 格全部認得出（unresolvedCount = 0）'",
    replace: "  if (false) t.equal('而且 ' + want + ' 格全部認得出（unresolvedCount = 0）'",
    tests: ['tests/selftest_mainflow.test.js']
  },
  {
    id: 'st-s10-runs-dirty',
    why: '令 S10 喺污染狀態下照樣硬跑'
      + '——第五十輪嗰次 S10 見到 S03 嘅殘留仍然硬跑，'
      + '而佢報嘅嘢同真正嘅問題無關',
    file: 'src/SelfTestRunner.gs',
    find: '  if (beforeUnsaved.unresolvedCount > 0 || beforeUnsaved.gridChangeCount > 0) {',
    replace: '  if (false) {',
    tests: ['tests/selftest_mainflow.test.js']
  },
  {
    id: 'st-s16-no-cleanup',
    why: '令 S16 唔收拾'
      + '——下一次「只重跑紅色情境」就會喺一個污染狀態下開始，'
      + '而嗰種紅同系統無關',
    file: 'src/SelfTestRunner.gs',
    find: '  selfTestWriteGridCell_(quarterId, versionNo, cell.serviceDate,' + '\n'
      + '    cell.postId, cell.slotIndex, originalName);',
    replace: '  // （突變：唔收拾）',
    tests: ['tests/selftest_mainflow.test.js']
  },
  {
    id: 'st-s04-two-reds',
    why: '拆走 S04 嗰個前置檢查'
      + '——`buildUnsavedSendPreview_()` 喺 `canSendUnsaved=false` 之下'
      + '回空預覽係**啱嘅**，一個根因報成兩條紅會令報告睇落比實際嚴重',
    file: 'src/SelfTestRunner.gs',
    find: '  if (s.canSendUnsaved !== true) {',
    replace: '  if (false) {',
    tests: ['tests/selftest_mainflow.test.js']
  },
  {
    id: 'st-s14-wrong-entry',
    why: '令 S14 用返 `apiGenerateDraftExecute()`'
      + '——嗰一支喺一個已經有版本嘅季度上面只會回 `{ok:false}`，'
      + '乜都唔做。而 S14 唔睇回傳值，繼續攞舊版本去驗',
    file: 'src/SelfTestRunner.gs',
    find: "    regenerated = selfTestCall_('S14', 'apiGenerateRoster'," + '\n'
      + '      function () { return apiGenerateRoster(quarterId); });',
    replace: "    regenerated = selfTestCall_('S14', 'apiGenerateDraftExecute'," + '\n'
      + '      function () { return apiGenerateDraftExecute(quarterId); });',
    tests: ['tests/selftest_mainflow.test.js']
  },
  {
    id: 'st-s14-no-version-check',
    why: '拆走「重新生成真係產生咗新版本」嗰條斷言'
      + '——一個真實入口靜靜噉冇做嘢，而測試照樣往下走，'
      + '正正就係呢個專案由第一輪殺到而家嗰種病',
    file: 'src/SelfTestRunner.gs',
    find: '  if (versionNo !== versionBefore + 1) {',
    replace: '  if (false) {',
    tests: ['tests/selftest_mainflow.test.js']
  },
  {
    id: 'st-s14-runs-late',
    why: '把 S14／S15 排返去最後'
      + '——`apiGenerateRoster()` 要 Stage=DRAFT，'
      + '跑到 S09 之後 Stage 係 OFFICIAL_SENT，嗰陣一定被擋',
    file: 'src/SelfTestRunner.gs',
    find: "    { id: 'S14', title: '特殊主日 SkipPostIDs 生效（要 Stage=DRAFT，所以排在這裡）',",
    replace: "    { id: 'SZZ', title: '（突變：排錯位）',",
    tests: ['tests/selftest_mainflow.test.js']
  },
  {
    id: 'st-s15-no-cleanup',
    why: '令 S15 唔收拾 S14 種落嗰一行'
      + '——下一次由頭跑，`SpecialSundays` 會累積一堆自測留低嘅行',
    file: 'src/SelfTestRunner.gs',
    find: "  const cleanup = selfTestDeactivateSpecialSunday_(quarterId + '-SELFTEST');",
    replace: "  const cleanup = { done: true, detail: '（突變：冇收拾）' };",
    tests: ['tests/selftest_mainflow.test.js']
  },
  {
    id: 'st-no-blocked',
    why: '拆走 `dependsOn` 嘅擋'
      + '——一個根因報成八條紅，而 Ivan 要逐條睇完先知邊幾條係雜訊',
    file: 'src/SelfTestRunner.gs',
    find: '    if (blockedBy.length > 0) {',
    replace: '    if (false) {',
    tests: ['tests/selftest_mainflow.test.js']
  },
  {
    id: 'st-blocked-not-counted',
    why: '報告摘要唔獨立數「被擋住」'
      + '——`BLOCKED` 唔等於通過。只數綠同紅嘅話，'
      + '一份「6 綠 1 紅」嘅報告睇落好似情況唔錯，'
      + '而實際上有幾條根本冇跑過',
    file: 'src/SelfTestRunner.gs',
    find: "    + blockedCount + ' 被擋住　'",
    replace: "    + ''",
    tests: ['tests/selftest_mainflow.test.js']
  },
  {
    id: 'st-rerun-skips-blocked',
    why: '「只重跑紅色情境」唔清走 `BLOCKED`'
      + '——修好上游之後，被擋住嗰幾條仍然唔會跑，'
      + '而嗰幾條先係整件事嘅重點',
    file: 'src/SelfTestRunner.gs',
    find: '        || status === SELFTEST_STATUS.BLOCKED) {',
    replace: '        || (false && status === SELFTEST_STATUS.BLOCKED)) {',
    tests: ['tests/selftest_mainflow.test.js']
  },
  {
    id: 'st-resume-ignores-state',
    why: '續跑嗰陣唔理上一次嘅結論'
      + '——一個「上一次紅、今次跳過」嘅上游就唔會擋到下游，'
      + '於是下游又會喺一個壞狀態下硬跑',
    file: 'src/SelfTestRunner.gs',
    find: '  Object.keys(state).forEach(function (id) { byId[id] = state[id]; });',
    replace: '',
    tests: ['tests/selftest_mainflow.test.js']
  },
  {
    id: 'st-duration-carry',
    why: '把秒數進位改返做舊寫法'
      + '——299.6 秒會印成「4 分 60 秒」。上一輪報告嘅原文',
    file: 'src/SelfTestRunner.gs',
    find: '  const totalSeconds = Math.max(0, Math.round((Number(ms) || 0) / 1000));' + '\n'
      + '  const minutes = Math.floor(totalSeconds / 60);' + '\n'
      + '  const seconds = totalSeconds - minutes * 60;',
    replace: '  const total = Math.max(0, Math.round(Number(ms) || 0) / 1000);' + '\n'
      + '  const minutes = Math.floor(total / 60);' + '\n'
      + '  const seconds = Math.round(total - minutes * 60);',
    tests: ['tests/selftest_mainflow.test.js']
  },
  {
    id: 'st-evidence-twice',
    why: '證據欄把「實際」抄多一次'
      + '——上一輪 S11 嘅「實際」同「證據」係同一段長文字，印咗兩次。'
      + '證據欄應該講呢個值由邊度嚟',
    file: 'src/SelfTestRunner.gs',
    find: "      if (c.evidence && c.evidence !== c.actual) lines.push('　　 證據：' + c.evidence);",
    replace: "      if (c.evidence) lines.push('　　 證據：' + c.evidence);",
    tests: ['tests/selftest_mainflow.test.js']
  },
  // ── 第五十二輪批次 A 組：造完版本冇更新公開連結 ──────────────
  {
    id: 'pub-web-skip',
    why: '「進階功能 ▸ 重新生成初稿」造完版本冇更新公開連結'
      + '——公開連結嘅畫面文案自己寫住「永遠指向最新嗰一版」，'
      + '而堂委開連結見到嘅係舊嗰一版，中間冇任何一個畫面提示過',
    file: 'src/WebApp.gs',
    find: '  const publish = tryPublishPublicRoster_(quarterId);',
    replace: '  const publish = { failed: false, message: \'\' };',
    tests: ['tests/generate_publishes_link.test.js']
  },
  {
    id: 'pub-menu-skip',
    why: '試算表選單嗰個入口造完版本冇更新公開連結'
      + '——舊入口仍然撳得到，而佢造出嚟嘅版本同 Web UI 造嘅一模一樣',
    file: 'src/Menu.gs',
    find: '    const publish = tryPublishPublicRoster_(quarterId);',
    replace: '    const publish = { failed: false, message: \'\' };',
    tests: ['tests/generate_publishes_link.test.js']
  },
  {
    id: 'pub-four-skip',
    why: '四階段流程步驟 1 造完版本冇更新公開連結',
    file: 'src/FourStageFlow.gs',
    find: '    const publish = tryPublishPublicRoster_(quarterId);',
    replace: '    const publish = { failed: false, message: \'\' };',
    tests: ['tests/generate_publishes_link.test.js']
  },
  {
    id: 'pub-fail-silent',
    why: '發佈失敗只寫 log，唔喺畫面講'
      + '——寫 log 等於冇人知：幹事會照樣同堂委講「連結已經更新」',
    file: 'src/WebAppSaveConfirm.gs',
    find: '  if (!publish || !publish.failed) {',
    replace: '  if (true) {',
    tests: ['tests/generate_publishes_link.test.js']
  },
  {
    id: 'pub-fail-nover',
    why: '發佈失敗淨係講「失敗」，唔講「收到連結嘅人而家見到邊一版」'
      + '——幹事唔知嚴唔嚴重',
    file: 'src/WebAppSaveConfirm.gs',
    find: "    + '　 收到連結的人現在看到的仍然是' + publishedVersion + '。" + String.fromCharCode(92) + "n'",
    replace: "    + ''",
    tests: ['tests/generate_publishes_link.test.js']
  },
  {
    id: 'pub-web-noflag',
    why: 'Web UI 嗰個入口唔把發佈失敗帶落回傳值'
      + '——Web UI 冇 `ui.alert()`，唔帶出去就完全冇人知',
    file: 'src/WebApp.gs',
    find: '    publishFailed: !!publish.failed,',
    replace: '    publishFailed: false,',
    tests: ['tests/generate_publishes_link.test.js']
  },

  // ── 第五十二輪批次 B 組：既有嘅不變量失敗污染下游 ────────────
  {
    id: 'inv-blame-all',
    why: '把「開跑之前就已經紅」嗰幾條都算落情境頭上'
      + '——一條既有嘅失敗令之後每一個情境都紅，'
      + '而每一個紅嘅情境又經 `dependsOn` 把下游標成 BLOCKED：'
      + '一個根因，13 條情境一條都跑唔到',
    file: 'src/SelfTestRunner.gs',
    find: '        if (knownFailing[id]) { carried.push(id); }'
      + ' else { caused.push(after.map[id]); }',
    replace: '        caused.push(after.map[id]);',
    tests: ['tests/selftest_invariant_attribution.test.js']
  },
  {
    id: 'inv-base-empty',
    why: '開跑唔影底相，當成「一條都冇紅」'
      + '——噉樣一條既有嘅失敗會被算落第一個情境頭上',
    file: 'src/SelfTestRunner.gs',
    find: '  const baseline = snapshotFailingInvariants_(quarterId);',
    replace: "  const baseline = { map: {}, error: '' };",
    tests: ['tests/selftest_invariant_attribution.test.js']
  },
  {
    id: 'inv-snap-throw',
    why: '影唔到底相就當成「一條都冇紅」'
      + '——影唔到唔可以當冇事，否則歸咎會靜靜噉錯',
    file: 'src/SelfTestRunner.gs',
    find: '    return { map: {}, error: err.message };',
    replace: "    return { map: {}, error: '' };",
    tests: ['tests/selftest_invariant_attribution.test.js']
  },
  {
    id: 'inv-carry-mute',
    why: '既有嘅失敗完全唔提'
      + '——唔算佢頭上係啱，但完全唔提就會令一條開跑就紅嘅不變量'
      + '靜靜噉喺成份報告度消失',
    file: 'src/SelfTestRunner.gs',
    find: '      if (carried.length > 0) {',
    replace: '      if (false) {',
    tests: ['tests/selftest_invariant_attribution.test.js']
  },
  {
    id: 'inv-top-mute',
    why: '報告開頭唔印「開跑就已經存在嘅不變量失敗」'
      + '——嗰幾條係先決條件，唔印嘅話下面每一條嘅綠同紅都冇得打折扣',
    file: 'src/SelfTestRunner.gs',
    find: "    lines.push('⚠️ 開跑的時候已經存在的不變量失敗（'",
    replace: "    lines.push('（'",
    tests: ['tests/selftest_invariant_attribution.test.js']
  },
  {
    id: 'inv-snap-twice',
    why: '每個情境額外再影多一次事前相'
      + '——第五十輪批次嗰個時間預算問題會走回頭路：'
      + '不變量跑多一倍，13 條情境又會變成「未跑」',
    file: 'src/SelfTestRunner.gs',
    find: '      knownFailing = after.map;',
    replace: '      knownFailing = snapshotFailingInvariants_(quarterId).map;',
    tests: ['tests/selftest_invariant_attribution.test.js']
  },

  // ── 第五十二輪批次 C 組：亂行機冇睇回傳值 ────────────────────
  {
    id: 'mky-no-check',
    why: '亂行機叫完真實入口冇睇回傳值'
      + '——一個唔拋錯、但係靜靜噉乜都冇做嘅入口，'
      + '會令亂行機一路行到 50 步，然後交一份綠色報告',
    file: 'src/MonkeyRun.gs',
    find: '      monkeyCheckOutcome_(picked, result, facts, after)'
      + '.forEach(function (complaint) {',
    replace: '      [].forEach(function (complaint) {',
    tests: ['tests/monkey_checks_return_value.test.js']
  },
  {
    id: 'mky-ok-false',
    why: '`legal()` 話做得而系統回 `ok: false`，亂行機唔記低'
      + '——`legal()` 已經話咗做得，呢個拒絕同一個合法動作拋錯係同一級',
    file: 'src/MonkeyRun.gs',
    find: '  if (result && result.ok === false) {',
    replace: '  if (false) {',
    tests: ['tests/monkey_checks_return_value.test.js']
  },
  {
    id: 'mky-gen-flag',
    why: '「生成初稿」唔睇 `versionCreated`'
      + '——嗰一支喺已經有版本嗰陣回 `{ok:false, versionCreated:false}` 而唔拋錯',
    file: 'src/MonkeyRun.gs',
    find: '        if (result && result.versionCreated === false) {',
    replace: '        if (false) {',
    tests: ['tests/monkey_checks_return_value.test.js']
  },
  {
    id: 'mky-gen-ver',
    why: '「生成初稿」只信回傳值，唔核對版本號有冇真係加'
      + '——只信回傳值嘅話，一個講咗大話嘅入口永遠捉唔到',
    file: 'src/MonkeyRun.gs',
    find: '        if (!(after.latestVersionNo > before.latestVersionNo)) {',
    replace: '        if (false) {',
    tests: ['tests/monkey_checks_return_value.test.js']
  },
  {
    id: 'mky-pure-move',
    why: '純算／純讀嘅動作改咗嘢都當冇事'
      + '——一個自稱只係計算嘅入口改咗季度狀態，係一個真發現',
    file: 'src/MonkeyRun.gs',
    find: "  return moved.length === 0 ? ''",
    replace: "  return true ? ''",
    tests: ['tests/monkey_checks_return_value.test.js']
  },
  {
    id: 'mky-same-mute',
    why: '「看一次主畫面」算咗 `same` 但冇人睇'
      + '——呢個動作存在嘅唯一理由就係問「連續讀兩次會唔會唔同」，'
      + '而佢問完之後冇睇答案',
    file: 'src/MonkeyRun.gs',
    find: '        if (result && result.same === false) {',
    replace: '        if (false) {',
    tests: ['tests/monkey_checks_return_value.test.js']
  },
  {
    id: 'mky-expect-eat',
    why: '查證本身爆咗就靜靜噉當佢過'
      + '——靜靜噉當佢過就係呢一組要修嗰件事',
    file: 'src/MonkeyRun.gs',
    find: "      complaints.push('查不到這一步做過什麼：' + err.message);",
    replace: '      complaints.length = complaints.length;',
    tests: ['tests/monkey_checks_return_value.test.js']
  },
  // ── 第五十三輪批次 A 組：S03 揀格嘅次序反咗 ───────────────────
  {
    id: 'pick-key-person',
    why: '違反嘅身分證包埋 `personId`'
      + '——包咗嘅話，一格本來就違反緊嘅嘢換咗個人就會被當成「新違反」，'
      + '於是嗰一格永遠揀唔到',
    file: 'src/SelfTestRunner.gs',
    find: "  return [v.ruleId, v.serviceDate, v.postId, v.slotIndex].join('|');",
    replace: "  return [v.ruleId, v.serviceDate, v.postId, v.slotIndex, v.personId].join('|');",
    tests: ['tests/selftest_safe_cell_pick.test.js']
  },

  // ── 第五十三輪批次 C 組：唔好再撳 ─────────────────────────────
  {
    id: 'rep-no-count',
    why: '唔數「呢一條跑過幾次」'
      + '——呢個已經係第四次 Ivan 撳同一粒掣三次以上而報告一字不差，'
      + '而佢十月返嚟嗰陣係一個人，冇人喺旁邊幫佢數',
    file: 'src/SelfTestRunner.gs',
    find: '    const runCount = history.runCount + 1;',
    replace: '    const runCount = 1;',
    tests: ['tests/selftest_stop_pressing.test.js']
  },
  {
    id: 'rep-no-streak',
    why: '唔數「連續幾多次同一個結果」',
    file: 'src/SelfTestRunner.gs',
    find: '    const sameStreak = (history.fingerprint && history.fingerprint === fingerprint)'
      + '\n' + '      ? history.sameStreak + 1 : 1;',
    replace: '    const sameStreak = 1;',
    tests: ['tests/selftest_stop_pressing.test.js']
  },
  {
    id: 'rep-status-only',
    why: '指紋只睇狀態，唔睇證據'
      + '——一條由「A 斷言紅」變成「B 斷言紅」嘅情境係有進展，'
      + '噉樣會被數成「又係同一樣」而叫人停手',
    file: 'src/SelfTestRunner.gs',
    find: "  const parts = [String(outcome.status || '')];",
    replace: "  return String(outcome.status || '');" + '\n'
      + "  // eslint-disable-next-line no-unreachable" + '\n'
      + "  const parts = [String(outcome.status || '')];",
    tests: ['tests/selftest_stop_pressing.test.js']
  },
  {
    id: 'rep-line-mute',
    why: '逐條唔印「已經重跑 N 次」',
    file: 'src/SelfTestRunner.gs',
    find: '  if (!repeat || Number(repeat.sameStreak) < 2) return \'\';',
    replace: '  if (true) return \'\';',
    tests: ['tests/selftest_stop_pressing.test.js']
  },
  {
    id: 'rep-next-step',
    why: '最尾嗰句仍然叫佢撳「只重跑紅色情境」'
      + '——Ivan 就係照住嗰句撳咗三次',
    file: 'src/SelfTestRunner.gs',
    find: '    if (real.length > 0 && stuck.length === real.length) {',
    replace: '    if (false) {',
    tests: ['tests/selftest_stop_pressing.test.js']
  },
  {
    id: 'rep-no-history',
    why: '「只重跑紅色情境」之後唔讀返歷史'
      + '——嗰個入口會把紅嗰幾條由狀態表清走，'
      + '而嗰幾條正正就係要數次數嗰幾條',
    file: 'src/SelfTestRunner.gs',
    find: '    const persisted = readSelfTestState_();',
    replace: '    const persisted = {};',
    tests: ['tests/selftest_stop_pressing.test.js']
  },
  {
    id: 'rep-skip-summary',
    why: '`SKIPPED` 報成「0 條斷言失敗」'
      + '——嗰句睇落似通過，而佢根本冇跑過',
    file: 'src/SelfTestRunner.gs',
    find: '        : (outcome.status === SELFTEST_STATUS.SKIPPED ? \'跳過\'',
    replace: '        : (false ? \'跳過\'',
    tests: ['tests/selftest_stop_pressing.test.js']
  },

  // ── 第五十三輪批次 B 組：打字放行 ─────────────────────────────
  {
    id: 'rel-no-audit',
    why: '打字放行硬規則違反冇留低任何痕跡'
      + '——一個違反咗硬規則、由人手放行嘅版本，'
      + '事後冇任何方法分得出佢同一個乾淨版本嘅分別',
    file: 'src/WebAppSaveConfirm.gs',
    find: '  if (plan.needsRelease) {',
    replace: '  if (false) {',
    tests: ['tests/selftest_release_scenario.test.js']
  },
  {
    id: 'rel-audit-always',
    why: '每一次儲存都寫一筆「放行」'
      + '——一部乜都記嘅機器同一部乜都唔記嘅機器一樣冇用：'
      + '每一版都有一筆嘅話，「放行」就唔再係一個訊號',
    file: 'src/WebAppSaveConfirm.gs',
    find: '  if (plan.needsRelease) {' + '\n' + '    try {' + '\n'
      + '      writeAuditLog_({',
    replace: '  if (true) {' + '\n' + '    try {' + '\n'
      + '      writeAuditLog_({',
    tests: ['tests/selftest_release_scenario.test.js']
  },
  {
    id: 'rel-pick-any',
    why: '揀一格會多過一條違反嘅'
      + '——S17 就會分唔出係邊條規則攔住佢',
    file: 'src/SelfTestRunner.gs',
    find: '      if (added.length === 1 && added[0].severity === RULE_LEVELS.HARD',
    replace: '      if (added.length >= 1 && added[0].severity === RULE_LEVELS.HARD',
    tests: ['tests/selftest_release_scenario.test.js']
  },
  // ── 第五十四輪批次 A 組：寫三格、問一次、換走犯規嗰幾格 ───────
  {
    id: 'batch-take-any',
    why: '唔理 plan 講乜，一律收貨'
      + '——`needsRelease === false` 而且 `violations.real` 係空陣列'
      + '先係接受條件，而嗰一句就係攔住 S05 嗰道閘自己用嘅判斷',
    file: 'src/SelfTestRunner.gs',
    find: '    if (bad.length === 0 && plan.needsRelease === false) {',
    replace: '    if (true) {',
    tests: ['tests/selftest_batch_pick.test.js']
  },
  {
    id: 'batch-no-swap',
    why: '犯規嗰幾格唔改回原本嘅字'
      + '——留低就等於交一批一定會被攔嘅格畀 S05',
    file: 'src/SelfTestRunner.gs',
    find: '    bad.forEach(function (c) { revert(c, originalByKey); });' + '\n'
      + '    written = good;',
    replace: '    written = good;',
    tests: ['tests/selftest_batch_pick.test.js']
  },
  {
    id: 'batch-drop-clean',
    why: '連乾淨嗰幾格都一齊改回'
      + '——噉就等於重頭嚟過，浪費咗嗰一次好貴嘅 plan',
    file: 'src/SelfTestRunner.gs',
    find: '    written = good;',
    replace: '    written.forEach(function (c) { revert(c, originalByKey); });' + '\n'
      + '    written = [];',
    tests: ['tests/selftest_batch_pick.test.js']
  },
  {
    id: 'batch-no-cap',
    why: '搵格嗰個迴圈冇上限'
      + '——`apiSaveAndConfirmPlan()` 好貴，冇上限就會食光 4.5 分鐘預算，'
      + '退回「時間到、原地打轉」嗰個老問題',
    file: 'src/SelfTestRunner.gs',
    find: 'const SELFTEST_PLAN_SEARCH_ROUNDS = 4;',
    replace: 'const SELFTEST_PLAN_SEARCH_ROUNDS = 99;',
    tests: ['tests/selftest_batch_pick.test.js']
  },
  {
    id: 'batch-same-day',
    why: '幾格落晒喺同一日'
      + '——同一日改幾格會順手撞到同週規則，又係另一種雜訊',
    file: 'src/SelfTestRunner.gs',
    find: '      if (usedDates[c.serviceDate]) continue;',
    replace: '      if (false) continue;',
    tests: ['tests/selftest_batch_pick.test.js']
  },
  {
    id: 'batch-plan-eat',
    why: 'plan 拋錯就靜靜當佢揀唔到格'
      + '——靜靜過嘅話，後面每一條都會喺一個唔知咩狀態嘅季度上面跑',
    file: 'src/SelfTestRunner.gs',
    find: "      planError = 'apiSaveAndConfirmPlan() 拋錯：' + err.message;",
    replace: "      planError = '';",
    tests: ['tests/selftest_batch_pick.test.js']
  },
  {
    id: 'batch-blame-self',
    why: '違反明明唔喺我哋寫嗰幾格，都照當成「換格就得」'
      + '——嗰種情況係呢一版本身帶住違反，點換都改變唔到，'
      + '照換就係燒清四次好貴嘅 plan',
    file: 'src/SelfTestRunner.gs',
    find: '    if (bad.length === 0) {',
    replace: '    if (false) {',
    tests: ['tests/selftest_batch_pick.test.js']
  },
  {
    id: 'batch-elig-filter',
    why: '喺揀候選嗰陣就篩走「Eligibility 冇佢」嘅人'
      + '——嗰個就係自己再實作一次接受條件，而三輪紅嘅根源就係噉：'
      + '第五十一輪撞名字、第五十三輪撞 Eligibility、跟住撞 Roles',
    file: 'src/SelfTestRunner.gs',
    find: '    const chosen = eligibleHere.length > 0 ? eligibleHere[0] : fallback[0];',
    replace: '    const chosen = eligibleHere[0];',
    tests: ['tests/selftest_batch_pick.test.js']
  },
  {
    id: 'batch-slow-drop',
    why: '把 `ANNOUNCE`／`DUTY_CC` **篩走**（唔係排後）'
      + '——排序係優化，篩走就係規則判斷。'
      + '一個只剩嗰兩個崗位嘅季度會變成一格都揀唔到',
    file: 'src/SelfTestRunner.gs',
    find: '      preferred: eligibleHere.length > 0' + '\n'
      + '        && SELFTEST_SLOW_POSTS.indexOf(postId) === -1',
    replace: '      preferred: eligibleHere.length > 0',
    tests: ['tests/selftest_batch_pick.test.js']
  },
  {
    id: 'batch-key-coarse',
    why: '對格嗰個 key 唔夠細（唔分主日）'
      + '——一格犯規就會令**其餘每一格同崗位嘅**都被當成犯規，'
      + '於是乾淨嗰幾格都一齊被改回，白白燒咗一次好貴嘅 plan',
    file: 'src/SelfTestRunner.gs',
    find: "  return String(x.serviceDate) + '|' + String(x.postId) + '|' + String(x.slotIndex);",
    replace: "  return String(x.postId) + '|' + String(x.slotIndex);",
    tests: ['tests/selftest_batch_pick.test.js']
  },
  {
    id: 'batch-fake-confirm',
    why: '收唔到貨都標成 `confirmed`'
      + '——呼叫嗰邊會拎住一份過期嘅 plan 去斷言，'
      + '而嗰份 plan 唔係講緊而家格局',
    file: 'src/SelfTestRunner.gs',
    find: '    plan: lastPlan, planError: planError, preExisting: preExisting,' + '\n'
      + '    confirmed: false };',
    replace: '    plan: lastPlan, planError: planError, preExisting: preExisting,' + '\n'
      + '    confirmed: true };',
    tests: ['tests/selftest_batch_pick.test.js']
  },
  {
    id: 'batch-s03-quiet',
    why: 'S03 唔把揀格嘅過程寫入報告'
      + '——一句「找到 2 格」冇人知佢試過乜、換過邊格、撞過邊條規則，'
      + '而嗰啲正正係下一輪要靠嘅資料',
    file: 'src/SelfTestRunner.gs',
    find: "  t.expect('（過程）' + describeAcceptedPickAttempts_(picked)," + '\n'
      + "    true, '（過程紀錄，不是斷言）'," + '\n'
      + "    'plan ' + picked.planCalls + ' 次'," + '\n'
      + "    '接受條件只有一條：needsRelease === false 而且 violations.real 是空的。');" + '\n'
      + '\n'
      + '  // ── plan 拋錯／被擋住 ⇒ **拋出去，令它報 ERROR 帶住原文** ────',
    replace: '  // ── plan 拋錯／被擋住 ⇒ **拋出去，令它報 ERROR 帶住原文** ────',
    tests: ['tests/selftest_batch_pick.test.js']
  },
  {
    id: 'batch-s03-eat',
    why: 'S03 見到 plan 拋錯都照跑落去'
      + '——一個真實入口靜靜噉冇做事而測試照樣往下走，'
      + '就係呢個專案由第一輪殺到而家嗰種病',
    file: 'src/SelfTestRunner.gs',
    find: "  if (picked.planError) throw new Error('S03 選格時：' + picked.planError);",
    replace: '  if (false) throw new Error(picked.planError);',
    tests: ['tests/selftest_batch_pick.test.js']
  },
  {
    id: 'batch-s03-red',
    why: '湊唔夠格就報紅（唔係跳過）'
      + '——紅會經 `dependsOn` 把 S04–S13 標成 `BLOCKED`，'
      + '而嗰九條先係呢部機器存在嘅理由',
    file: 'src/SelfTestRunner.gs',
    find: "    return t.skip('（跳過）試了 ' + picked.planCalls" + '\n'
      + "      + ' 次都湊不到一格「改了不會被攔」的。'",
    replace: "    return t.result('（不跳過，報紅）') || t.skip('（跳過）試了 '"
      + " + picked.planCalls" + '\n'
      + "      + ' 次都湊不到一格「改了不會被攔」的。'",
    tests: ['tests/selftest_batch_pick.test.js']
  },

  // ── 第五十四輪批次 B 組：被擋住之後次數唔可以歸零 ─────────────
  {
    id: 'rep-blocked-zero',
    why: '被上游擋住之後，重跑次數歸零'
      + '——S05 嘅實況正正就係噉：S03 紅咗、S05 被標 `BLOCKED`，'
      + '於是佢每一次都由零數起，「連續兩次」永遠數唔到，'
      + '而「⛔ 唔好再撳」嗰一句永遠出唔到',
    file: 'src/SelfTestRunner.gs',
    find: '      }, blockedHistory);' + '\n'
      + '      outcome.repeat = {',
    replace: '      });' + '\n'
      + '      outcome.repeat = {',
    tests: ['tests/selftest_stop_pressing.test.js']
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



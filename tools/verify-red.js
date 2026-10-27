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
    // 第七十八輪批次 FC 組：掃描抽成 findGridKeyRowByScan_()（建議表「類型」欄都用）
    find: "    if (row.some(function (v) { return String(v || '').indexOf('#') !== -1; })) return r;",
    replace: "    if (row.some(function (v) { return String(v || '').indexOf('#') !== -1; })) return 2;",
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
    find: "  if (scope === SEND_RECIPIENT_SCOPE.PICK && pickedCount === 0 && extraEmails.length === 0) {",
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
    file: 'src/SheetReader.gs',
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
    find: "personName: person ? person.nameTC : (s.isManual ? manualFreeText : (originalRow.personName || '')),",
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
    // 第六十三輪批次 M 組喺前面加咗 `selectedGenerated` 分支，所以而家係 `} else if`
    find: '  } else if (allGenerated) {',
    replace: '  } else if (false) {',
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
    tests: ["tests/round77_eh_round76_gaps.test.js"]
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
    // 第六十三輪批次 F 組：context 只砌一次，改叫 `resolveActualRecipientsFromContext_()`
    find: '  const recipients = resolveActualRecipientsFromContext_(\n'
      + '    context, MAIL_STAGES.OFFICIAL, sendOptions);',
    replace: '  const recipients = listRecipients_(MAIL_STAGES.OFFICIAL, context);',
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
    find: "  plan.pdfFiles.forEach(function (f) {\n    try {",
    replace: '  deleteRowsMatching_(SHEETS.SERVICE_DATES, function () { return false; }, errors);' + '\n'
      + '  plan.pdfFiles.forEach(function (f) {\n    try {',
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
    id: 'unsaved-no-confirm',
    why: "有未儲存改動撳寄出，唔出「寄出：你有 N 格改動還未儲存」嗰個窗、直接開寄出窗——幹事會以為寄出去嘅係佢啱啱改嗰一版（第七十七輪 EE 組改成兩粒掣嘅窗）",
    file: 'src/ui/ScriptSendPaper.html',
    find: "      renderUnsavedBlocksSend(s);\n      return;",
    replace: "      renderSendMain(s, { allowUnsaved: true });\n      return;",
    tests: ["tests/send_unsaved_gate.test.js", "tests/round77_ee_send_buttons.test.js"]
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
    find: "    '隨機種子：' + report.seed + '（用同一個種子重跑，會走同一條路）'",
    replace: "    '（隨機）'",
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
    find: "        step: absStep, kind: '合法動作拋錯',",
    replace: "        step: absStep, kind: '（略過）',",
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
    find: '      const inv = runAllInvariants_(quarterId,\n'
      + '        isFullSweep ? INVARIANT_SET.ALL : INVARIANT_SET.PER_SCENARIO);',
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
    // 第六十六輪批次 AC／AD 組：「未做完」分支改按 outcome.kind 判斷，突變跟住搬
    find: "      if (outcome.kind === 'INCOMPLETE') {",
    replace: '      if (false) {',
    tests: ['tests/missing_pdf_inline.test.js']
  },
  {
    id: 'pdf-no-way-back',
    why: '做完之後唔畀路行返轉頭去正式發出'
      + '——佢又要自己搵路返嚟，而嗰個就係本來要修嗰件事',
    file: 'src/ui/ScriptZone1.html',
    // 第六十五輪批次 W 組：迴圈抽成共用嘅 `runPdfBatchToCompletion()`
    find: '      onBack: () => { closeModal(); openOfficial(sendOpts); }',
    replace: '      onBack: () => closeModal()',
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
    find: '  if (foundRow > 0) {\n'
      + '    sheet.getRange(foundRow, 1, 1, headers.length).setValues([row]);\n'
      + '  } else {\n'
      + '    sheet.appendRow(row);\n'
      + '  }',
    replace: '  if (false) { sheet.appendRow(row); }',
    tests: ['tests/selftest_reset_and_clock.test.js']
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
    find: "      lines.push('・你沒有改過程式碼，只是修了工作表的資料'",
    replace: "      lines.push('撳「測試工具 ▸ ▶️ 繼續跑自測」——'",
    // ⚠️ `verify-red` 要求**列出嘅每一條**都變紅。
    // `selftest_resume_deadlock` 而家唔再踩呢一行，所以唔可以再列佢。
    tests: ['tests/selftest_reset_and_clock.test.js']
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
    // ⚠️ 唔要搵那個多行條件——中間夾住註釋，而只接一半
    // 會留下一個懸空嘅 `|| …`，嗰樣係語法錯而唔係回歸。
    // 搵住「留綠色嗰一句」就精準得多。
    find: '    kept[id] = state[id];',
    replace: '    clearedIds.push(id);',
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
    find: '        || status === SELFTEST_STATUS.BLOCKED',
    replace: '        || (false && status === SELFTEST_STATUS.BLOCKED)',
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
    tests: ['tests/selftest_violating_pick_key.test.js']
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
    find: "  if (plan.violations.kept.length > 0) {\n    // ⚠️ 第六十七輪批次 AG 組：**機器可讀嘅放行紀錄一定要寫**",
    replace: "  if (false) {\n    // ⚠️ 第六十七輪批次 AG 組：**機器可讀嘅放行紀錄一定要寫**",
    tests: ['tests/selftest_release_scenario.test.js']
  },
  {
    id: 'rel-audit-always',
    why: '每一次儲存都寫一筆「放行」'
      + '——一部乜都記嘅機器同一部乜都唔記嘅機器一樣冇用：'
      + '每一版都有一筆嘅話，「放行」就唔再係一個訊號',
    file: 'src/WebAppSaveConfirm.gs',
    // 第六十七輪批次 AG 組：`if (plan.needsRelease) {` 之後而家先有一段註解＋機器可讀紀錄，
    // 所以錨點改用 `if` 嗰一行本身（檔內只有一處）。
    find: "  if (plan.violations.kept.length > 0) {\n    // ⚠️ 第六十七輪批次 AG 組：**機器可讀嘅放行紀錄一定要寫**",
    replace: "  if (true) {\n    // ⚠️ 第六十七輪批次 AG 組：**機器可讀嘅放行紀錄一定要寫**",
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
    find: "    if (bad.length === 0 && plan.needsDecision !== true) {",
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
    find: '    if (foreign.length > 0) {',
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
    find: "  t.expect('（過程）' + describeAcceptedPickAttempts_(picked),\n    true, '（過程紀錄，不是斷言）',\n    'plan ' + picked.planCalls + ' 次',\n    '接受條件只有一條：needsDecision 不是 true 而且 violations.real 是空的。');\n\n  // ── plan 拋錯／被擋住 ⇒ **拋出去，令它報 ERROR 帶住原文** ────",
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
  // ── 第五十五輪批次 A 組：造版本嘅路有六條，發佈漏咗兩條 ────────
  {
    id: 'pub-apply-req',
    why: '套用修改申報造完版本冇發佈'
      + '——實測 I09：v3 係步驟 3 造嘅，而 PublicLinks 仍然停喺 v2，'
      + '收到連結嘅人開連結見到嘅係舊版',
    file: 'src/RequestsApply.gs',
    find: '  const publish = tryPublishPublicRoster_(plan.quarterId);',
    replace: '  const publish = { failed: false, message: \'\' };',
    tests: ['tests/every_version_publishes.test.js']
  },
  {
    id: 'pub-apply-dec',
    why: '微調 ▸ 套用決定造完版本冇發佈'
      + '——呢一條由「某支函式嘅 caller」數起嗰陣完全見唔到，'
      + '要由「邊個會喺 RosterVersions 加行」數起先數得到',
    file: 'src/FineTune.gs',
    find: '  const publish = tryPublishPublicRoster_(quarterId);',
    replace: '  const publish = { failed: false, message: \'\' };',
    tests: ['tests/every_version_publishes.test.js']
  },
  {
    id: 'pub-skip-blind',
    why: '查唔到公開連結而家係邊一版就當成「已經發咗」'
      + '——當成已經發咗嘅話，收到連結嘅人會一直見住舊版，'
      + '而冇任何一個畫面提示過。呢個係最差嗰種錯',
    file: 'src/WebAppSaveConfirm.gs',
    find: '  } catch (err) {' + '\n'
      + '    // 查唔到 ⇒ 照發。' + '\n'
      + "    log_('WARN', '查不到公開連結目前是哪一版，照樣發佈一次：' + err.message);"
      + '\n' + '  }',
    replace: '  } catch (err) {' + '\n'
      + "    return { failed: false, message: '', skipped: true };" + '\n'
      + '  }',
    tests: ['tests/every_version_publishes.test.js']
  },
  {
    id: 'pub-skip-always',
    why: '一律當成「已經發咗」，永遠唔發'
      + '——一部乜都唔發嘅機器同冇呢個功能一樣',
    file: 'src/WebAppSaveConfirm.gs',
    // 第六十三輪批次 A 組：「最新」改由 `evaluatePublicLinkFreshness_()` 判斷
    find: '  return f.latestVersionNo >= 0 && f.rowExists && !f.stale;',
    replace: '  return true;',
    tests: ['tests/every_version_publishes.test.js']
  },
  {
    id: 'pub-skip-never',
    why: '拆走「已經係最新就唔使再發」嗰一道'
      + '——最常撳嗰粒掣（儲存並確認，有申報嗰條路）會發佈兩次，'
      + '而發佈要開／寫一個外部試算表，唔係平嘢',
    file: 'src/WebAppSaveConfirm.gs',
    find: '    if (publicLinkAlreadyAtLatest_(quarterId)) {',
    replace: '    if (false) {',
    tests: ['tests/every_version_publishes.test.js']
  },
  {
    id: 'pub-retry-skips',
    why: '幹事撳「重試發佈」嗰粒都經埋「已經係最新就唔使再發」'
      + '——一個「發佈失敗但版本號啱」嘅情況就永遠重試唔到',
    file: 'src/WebAppGuards.gs',
    find: '    publishPublicRoster_(quarterId);' + '\n'
      + '    const state = readPublicLinkState_(quarterId);',
    replace: '    tryPublishPublicRoster_(quarterId);' + '\n'
      + '    const state = readPublicLinkState_(quarterId);',
    tests: ['tests/every_version_publishes.test.js']
  },

  // ── 第五十五輪批次 B 組：S07 寫申報用咗 PostID ─────────────────
  {
    id: 's07-post-id',
    why: 'S07 寫申報嗰陣崗位欄填 PostID'
      + '——張表收嘅係中文名稱，三筆會全部跌落 needsInput，'
      + '而「套用申報」呢條路一格都冇真正走過（第五十四輪就係噉）',
    file: 'src/SelfTestRunner.gs',
    find: '    put(R.POST_NAME, postNameById[c.postId]);',
    replace: '    put(R.POST_NAME, c.postId);',
    tests: ['tests/selftest_request_rows.test.js']
  },
  {
    id: 's07-no-name-ok',
    why: '揀埋啲喺 Posts 冇中文名嘅崗位'
      + '——嗰啲申報唔到，揀咗就一定跌落 needsInput',
    file: 'src/SelfTestRunner.gs',
    find: '    if (!postNameById[c.postId]) return;',
    replace: '    if (false) return;',
    tests: ['tests/selftest_request_rows.test.js']
  },
  {
    id: 's07-applied-zero',
    why: '拆走 `appliedCount >= 1` 嗰條'
      + '——冇咗佢，一次「三筆全部跌落 needsInput」嘅執行照樣綠，'
      + '而「套用申報」由頭到尾一格都冇走過',
    file: 'src/SelfTestRunner.gs',
    find: "  t.expect('至少有 1 筆真的套用了（appliedCount ≥ 1）'",
    replace: "  if (false) t.expect('至少有 1 筆真的套用了（appliedCount ≥ 1）'",
    tests: ['tests/selftest_request_rows.test.js']
  },
  {
    id: 's07-same-day',
    why: '三筆申報落晒喺同一日'
      + '——同一日抽三個崗位會令替補人選重疊，一次過走三筆嘅成功率低好多',
    file: 'src/SelfTestRunner.gs',
    find: '    if (usedDates[c.serviceDate]) return;' + '\n'
      + '    usedDates[c.serviceDate] = true;',
    replace: '    if (false) return;' + '\n'
      + '    usedDates[c.serviceDate] = true;',
    tests: ['tests/selftest_request_rows.test.js']
  },
  {
    id: 's07-record-red',
    why: '把「Stage advanced／appliedCount」嗰條記錄變成真斷言'
      + '——A3 嗰個決策點未覆之前唔應該判斷佢嘅對錯，'
      + '判斷咗就係代 Ivan 拍板',
    file: 'src/SelfTestRunner.gs',
    find: "  t.expect('（記錄，不是斷言）Stage advanced=' + applied.advanced" + '\n'
      + "    + '，而 appliedCount=' + applied.appliedCount," + '\n'
      + '    true,',
    replace: "  t.expect('（記錄，不是斷言）Stage advanced=' + applied.advanced" + '\n'
      + "    + '，而 appliedCount=' + applied.appliedCount," + '\n'
      + '    Number(applied.appliedCount) > 0,',
    tests: ['tests/selftest_request_rows.test.js']
  },

  // ── 第五十五輪批次 C 組：回退預覽 ─────────────────────────────
  {
    id: 'rb-no-warning',
    why: '`apiRollbackPlan()` 唔再帶嗰段「不要用試算表版本記錄還原」'
      + '——冇警告嘅回退，幹事會當成「睇一睇」噉撳落去',
    file: 'src/WebAppRollback.gs',
    find: '    outdatedPersonCount: outdatedPersonCount,' + '\n'
      + '    sheetsHistoryWarning: ROLLBACK_SHEETS_HISTORY_WARNING',
    replace: '    outdatedPersonCount: outdatedPersonCount,' + '\n'
      + "    sheetsHistoryWarning: ''",
    tests: ['tests/rollback_preview_replay.test.js']
  },
  {
    id: 'rb-ui-drop-warn',
    why: '前端唔再畫嗰段警告'
      + '——API 有嗰個欄位，同幹事真係見到，係兩件事',
    file: 'src/ui/ScriptRollback.html',
    find: '    nodes.push(buildSheetsHistoryWarning(plan.sheetsHistoryWarning));',
    replace: '    // nodes.push(buildSheetsHistoryWarning(plan.sheetsHistoryWarning));',
    tests: ['tests/rollback_preview_replay.test.js']
  },
  {
    id: 'rb-no-typing',
    why: '回退唔使打字確認'
      + '——回退會蓋走現況，撳一下就做嘅話，'
      + '幹事會當成「睇一睇」噉撳落去',
    file: 'src/ui/ScriptRollback.html',
    // 第六十三輪批次 T 組第 3 點喺中間加咗 typingHint（同註解）
    find: '      requireTyping: true,' + '\n'
      + '      // ⚠️ 第六十三輪批次 T 組第 3 點：**回退唔係不可逆。**',
    replace: '      requireTyping: false,' + '\n'
      + '      // ⚠️ 第六十三輪批次 T 組第 3 點：**回退唔係不可逆。**',
    tests: ['tests/rollback_preview_replay.test.js']
  },
  {
    id: 'rb-check-fail-hid',
    why: '規則檢查查唔到嗰陣扮「冇問題」'
      + '——「檢查過，冇問題」同「檢查唔到」係兩件事，'
      + '而後者被顯示成前者係最難察覺嗰種錯',
    file: 'src/ui/ScriptRollback.html',
    find: '      plan.violationCheckFailed' + '\n'
      + '        ? make(',
    replace: '      false' + '\n'
      + '        ? make(',
    tests: ['tests/rollback_preview_replay.test.js']
  },
  // ── 第五十六輪批次 A 組：`appliedCount = 0` 唔造版本 ──────────
  {
    id: 'zero-apply-makes-ver',
    why: '一筆都套用唔到都照造版本'
      + '——造出嚟嗰個同上一版逐格一樣，回退預覽出「0 格改動」，'
      + '版本號白白通脹',
    file: 'src/RequestsApply.gs',
    find: '  if (wroteNothing) {',
    replace: '  if (false) {',
    tests: ['tests/zero_apply_no_version.test.js']
  },
  {
    id: 'zero-apply-only-count',
    why: '「冇任何格被寫」只睇 `appliedCount`'
      + '——幹事喺 grid 親手改過嗰幾格要跟住新版本入 version of record，'
      + '唔造版本嘅話就會蒸發咗',
    file: 'src/RequestsApply.gs',
    find: '  const wroteNothing = appliedCount === 0' + '\n'
      + "    && (plan.manualChanges || []).length === 0",
    replace: '  const wroteNothing = appliedCount === 0' + '\n'
      + '    && true',
    tests: ['tests/zero_apply_no_version.test.js']
  },
  {
    id: 'zero-apply-eat-outcome',
    why: '零套用嗰條路唔寫返 outcomes'
      + '——同一批申報下次會再被當成「未處理」，'
      + '而幹事會見到同一批嘢彈返出嚟',
    file: 'src/RequestsApply.gs',
    find: '  if (wroteNothing) {' + '\n'
      + '    writeRequestOutcomes_(outcomes, plan.quarterId);',
    replace: '  if (wroteNothing) {',
    tests: ['tests/zero_apply_no_version.test.js']
  },
  {
    id: 'zero-apply-fake-ver',
    why: '零套用嗰條路回一個幻想出嚟嘅新版本號'
      + '——呼叫端會攞住佢去讀一張唔存在嘅表',
    file: 'src/RequestsApply.gs',
    find: '      versionNo: plan.baseVersionNo,' + '\n'
      + '      baseVersionNo: plan.baseVersionNo,',
    replace: '      versionNo: newVersionNo,' + '\n'
      + '      baseVersionNo: plan.baseVersionNo,',
    tests: ['tests/zero_apply_no_version.test.js']
  },

  // ── 第五十六輪批次 B1 組：清理唔可以食時間預算 ────────────────
  {
    id: 'clock-before-reset',
    why: '起錶排喺清理之前'
      + '——清 546 行派工要幾分鐘，預算被食光，'
      + '重設完即刻停、17 個情境全部「未跑」，而報告寫「用了 2 秒」。'
      + 'Ivan 見過至少兩次，每次都以為部機器壞咗',
    file: 'src/SelfTestRunner.gs',
    find: '  const resetMs = new Date().getTime() - machineStartedAt;' + '\n'
      + '  selfTestStartedAt_ = new Date().getTime();',
    replace: '  const resetMs = new Date().getTime() - machineStartedAt;',
    tests: ['tests/selftest_reset_and_clock.test.js']
  },
  {
    id: 'clock-sum-drift',
    why: '總數另外量一次，唔係由三段砌返出嚟'
      + '——兩個數會唔對，而幹事會問邊個先啱',
    file: 'src/SelfTestRunner.gs',
    find: '  const totalMs = resetMs + scenarioMs + invariantMs;',
    replace: '  const totalMs = loopMs;',
    tests: ['tests/selftest_reset_and_clock.test.js']
  },
  {
    id: 'clock-no-reset-seg',
    why: '報告嗰行唔印「清理」嗰一段'
      + '——時間去咗邊完全睇唔到，而清理正正就係食得最多嗰一段',
    file: 'src/SelfTestRunner.gs',
    find: "      + '（清理 ' + describeSelfTestDuration_(report.resetMs || 0)",
    replace: "      + '（",
    tests: ['tests/selftest_reset_and_clock.test.js']
  },

  // ── 第五十六輪批次 B2 組：尾句唔好估 ──────────────────────────
  {
    id: 'nextstep-guess',
    why: '尾句只印「撳只重跑紅色情境」一句'
      + '——部機器睇唔到使用者有冇 clasp push 過，'
      + '估唔到就唔好扮估到。指示錯咗兩次，Ivan 照住撳，白撳',
    file: 'src/SelfTestRunner.gs',
    find: "      lines.push('・你改過程式碼（有 clasp push 過）'" + '\n'
      + "        + ' ⇒ 撳「⚠️ 跑自測」重頭跑');",
    replace: '      // （拆走咗）',
    tests: ['tests/selftest_reset_and_clock.test.js']
  },

  // ── 第五十六輪批次 B3／C 組：自測機自己收身 ──────────────────
  {
    id: 'reset-keeps-junk',
    why: '重設嗰陣唔清走自測機自己種落去嘅殘留'
      + '——每次全新跑 append 多一行 -SELFTEST，'
      + '實測已經積咗 3 行，生成嗰陣出「2／3 個特殊主日未確認」',
    file: 'src/SelfTestRunner.gs',
    find: '      const extra = selfTestResetOwnSheets_(quarterId);',
    replace: '      const extra = { specialSundayRowsDeleted: 0, payloadRowsDeleted: 0 };',
    tests: ['tests/selftest_reset_and_clock.test.js']
  },
  {
    id: 'reset-delete-any-quarter',
    why: '刪 SpecialSundays 嗰陣唔對季度'
      + '——一行喺**第二個季度**嘅 -SELFTEST 都會被刪走。'
      + '呢個係刪資料嘅動作，寧可漏刪都唔可以錯刪',
    file: 'src/SelfTestRunner.gs',
    find: '    if (rowQuarter !== quarterId) return;',
    replace: '    if (false) return;',
    tests: ['tests/selftest_reset_and_clock.test.js']
  },
  {
    id: 'reset-delete-any-id',
    why: '刪 SpecialSundays 嗰陣唔對 `-SELFTEST`'
      + '——沙盒季度入面**每一行**特殊主日都會被刪走，'
      + '包括幹事自己加落去嘅真資料',
    file: 'src/SelfTestRunner.gs',
    find: "    if (specialId.slice(-9) !== '-SELFTEST') return;",
    replace: '    if (false) return;',
    tests: ['tests/selftest_reset_and_clock.test.js']
  },
  {
    id: 'reset-delete-topdown',
    why: '由上而下刪行'
      + '——刪完一行之後下面每一行都會向上移一格，'
      + '而之後嗰幾個行號就全部錯晒：會刪錯行',
    // 第六十五輪批次 AA 組：逐行刪改成共用 deleteSheetRowsInRuns_()（Utils.gs），
    // 「由下而上」嗰個迴圈搬咗去嗰度——突變跟住搬，仍然用自測重設嗰支測試驗
    file: 'src/Utils.gs',
    find: '  for (let i = runs.length - 1; i >= 0; i--) {',
    replace: '  for (let i = 0; i < runs.length; i++) {',
    tests: ['tests/selftest_reset_and_clock.test.js']
  },
  {
    id: 'payload-clear-no-trace',
    why: '清 payloads 之前唔留低摘要'
      + '——清咗就冇得追返，而「上一次到底叫過幾多個 API」'
      + '係一條事後會想知嘅資料',
    file: 'src/SelfTestRunner.gs',
    find: '    writeAuditLog_({\n'
      + "      action: '清走上一次自測的回傳值紀錄',",
    replace: '    const unusedSummary = ({\n'
      + "      action: '',",
    tests: ['tests/selftest_reset_and_clock.test.js']
  },
  {
    id: 'payload-trim-newest',
    why: '剪 payloads 嗰陣由最新嗰邊剪起'
      + '——剪走嘅正正係今次跑嗰批，而下一輪要靠嗰批原文',
    file: 'src/SelfTestRunner.gs',
    find: '  sheet.deleteRows(2, rowCount - SELFTEST_PAYLOAD_MAX_ROWS);',
    replace: '  sheet.deleteRows(SELFTEST_PAYLOAD_MAX_ROWS + 2,' + '\n'
      + '    rowCount - SELFTEST_PAYLOAD_MAX_ROWS);',
    tests: ['tests/selftest_reset_and_clock.test.js']
  },
  {
    id: 'reset-own-throws',
    why: '收身嗰步拋錯就令成次自測跑唔到'
      + '——清理係收身動作，唔應該擋住 17 條情境',
    file: 'src/SelfTestRunner.gs',
    find: "    log_('WARN', '清不走自測用的特殊主日：' + err.message);",
    replace: '    throw err;',
    tests: ['tests/selftest_reset_and_clock.test.js']
  },
  // ── 第五十七輪批次：讀緊一個 API 根本冇嘅欄位 ──────
  {
    id: 's07-plan-results',
    why: 'S07 讀回 `apiStep3Plan().results`'
      + '——嗰支 API 根本冇那個欄位（`results` 係內部嘅，'
      + '`mapPendingPlanForClient_()` 把佢拆成 applyList／confirmList／'
      + 'needsInputList 先至交出嘅）。數永遠係 0，'
      + '而系統其實完全正確',
    file: 'src/SelfTestRunner.gs',
    find: '  const applyList = plan.applyList || [];',
    replace: '  const applyList = plan.results || [];',
    tests: ['tests/selftest_reads_real_api_fields.test.js']
  },
  {
    id: 's07-plan-no-mode',
    why: 'S07 不先驗 `mode === HAS_PENDING`'
      + '——其餘 mode 之下那三個陣列根本唔會出現嗺回傳入面，'
      + '驗幾多都係嗺度數一個 undefined',
    file: 'src/SelfTestRunner.gs',
    find: "  t.equal('步驟 3 見到有待處理的申報（mode = HAS_PENDING）'",
    replace: "  if (false) t.equal('步驟 3 見到有待處理的申報（mode = HAS_PENDING）'",
    tests: ['tests/selftest_reads_real_api_fields.test.js']
  },
  {
    id: 's07-total-not-apply',
    why: 'S07 驗「三個陣列加埋夠數」而唔係驗 `applyList`'
      + '——一筆跌落 needsInput 嘅話總數照樣夠，'
      + '而問題要等到下面 `appliedCount` 先爆，'
      + '嗰陣就分唔出係「寫錯格式」定係「套用邏輯壞咗」',
    file: 'src/SelfTestRunner.gs',
    find: '    applyList.length >= want,',
    replace: '    applyList.length + (plan.confirmList || []).length'
      + ' + needsInputList.length >= want,',
    tests: ['tests/selftest_reads_real_api_fields.test.js']
  },
  {
    id: 's10-changed-list',
    why: 'S10 讀回 `apiStep5Plan().changedList`'
      + '——嗰支 API 回嘅係 `changed`。'
      + '讀錯咗嘅話：「名單裡面沒有我沒有碰過的人」'
      + '嗺空陣列之下**永遠綠**（假綠），'
      + '而「真的有人被算進去」**永遠紅**',
    file: 'src/SelfTestRunner.gs',
    find: '  const changedIds = (plan.changed || []).map(function (c) { return c.personId; });',
    replace: '  const changedIds = (plan.changedList || []).map(function (c) { return c.personId; });',
    tests: ['tests/selftest_reads_real_api_fields.test.js']
  },
  // ── 第五十八輪批次：S08 未做完唔可以報綠 ──────
  {
    id: 'inc-settled',
    why: '把 `INCOMPLETE` 加落 `settled` 清單'
      + '——續跑會永遠跳過 S08，PDF 永遠補唔齊，'
      + 'S09 永遠被擋。即係第五十輪嗰種死鎖翻生',
    file: 'src/SelfTestRunner.gs',
    find: '      || previous.status === SELFTEST_STATUS.SKIPPED);',
    replace: '      || previous.status === SELFTEST_STATUS.SKIPPED\n'
      + '      || previous.status === SELFTEST_STATUS.INCOMPLETE);',
    tests: ['tests/selftest_incomplete_status.test.js']
  },
  {
    id: 'inc-s08-accepts',
    why: 'S08 又接受「未做完」為合格'
      + '——做咗 7 份就報綠收工，而 S09 會 ERROR：'
      + '「缺個人 PDF 的人數是 51 / 58（87.9%）」',
    file: 'src/SelfTestRunner.gs',
    find: "  if (!(done && done.done === true)) {",
    replace: '  if (false) {',
    tests: ['tests/selftest_incomplete_status.test.js']
  },
  {
    id: 'inc-s08-cap',
    why: '把 `rounds` 硬上限加回'
      + '——58 份分批做，20 批唔一定夠',
    file: 'src/SelfTestRunner.gs',
    find: '  while (true) {',
    replace: '  while (rounds < 20) {',
    tests: ['tests/selftest_incomplete_status.test.js']
  },
  {
    id: 'inc-s08-stall',
    why: '拆走「一批都冇前進就停手」道門'
      + '——一個永遠唔 done 又永遠唔前進嘅批次入口'
      + '會食光成個時間預算，然後報 INCOMPLETE，'
      + '而下一次續跑一樣。嗬個係死循環，唔係進度',
    file: 'src/SelfTestRunner.gs',
    find: '    if (nowCount <= lastCount) { stalledAt = nowCount; break; }',
    replace: '    if (false) { stalledAt = nowCount; break; }',
    tests: ['tests/selftest_incomplete_status.test.js']
  },
  {
    id: 'inc-block-skip',
    why: '上游 `INCOMPLETE` 唔擋住下游'
      + '——S09 會嗺一個 PDF 未產齊嘅現場下硬跑，'
      + '然後把一個啱嘅攛截記成佢自己嘅紅',
    file: 'src/SelfTestRunner.gs',
    find: '        || r.status === SELFTEST_STATUS.INCOMPLETE);',
    replace: '        || false);',
    tests: ['tests/selftest_incomplete_status.test.js']
  },
  {
    id: 'inc-block-same-note',
    why: '上游未做完同上游紅咗用同一句註記'
      + '——講成「修好上游」嘅話，Ivan 會去搵一個'
      + '唔存在嘅 bug，而佢真正要做嘅只係再搳一次續跑',
    file: 'src/SelfTestRunner.gs',
    find: '        note: incompleteUp.length > 0',
    replace: '        note: false',
    tests: ['tests/selftest_incomplete_status.test.js']
  },
  {
    id: 'inc-not-cleared',
    why: '「只重跑紅色情境」唔清走 `INCOMPLETE`'
      + '——修完碼之後佢唔會重跑，'
      + '而佢正正就係要接住做嗰條',
    file: 'src/SelfTestRunner.gs',
    find: '        || status === SELFTEST_STATUS.INCOMPLETE) {',
    replace: '        || false) {',
    tests: ['tests/selftest_incomplete_status.test.js']
  },
  {
    id: 'inc-summary-hides',
    why: '摘要行唔數「未完成」'
      + '——一份「2 綠 0 紅」嘅報告睇落情況良好，'
      + '而實際上有一條未做完、一條被佢擋住',
    file: 'src/SelfTestRunner.gs',
    find: "    + incompleteCount + ' 未完成　'",
    replace: "    + ''",
    tests: ['tests/selftest_incomplete_status.test.js']
  },
  {
    id: 'inc-nextstep-gone',
    why: '尾句唔印「還有 N 條未做完」'
      + '——Ivan 會照住後面嘸句搳「只重跑紅色情境」，'
      + '而嗰粒會把 INCOMPLETE 清走再由頭產一次 58 份',
    file: 'src/SelfTestRunner.gs',
    find: '  if (incompleteCount > 0) {',
    replace: '  if (false) {',
    tests: ['tests/selftest_incomplete_status.test.js']
  },
  // ── 第五十九輪批次：自測機把自己鎖死嗺門外 ────
  {
    id: 'gate-locks-self-out',
    why: '沙盒季度到咗 OFFICIAL_SENT 就拒絕跑'
      + '——S09 做嘅事**就係**把季度推到嗰度，'
      + '於是 S11／S12／S13／S16／S17 五條永遠跑唔到',
    file: 'src/SelfTestRunner.gs',
    find: '    if (upper !== sandboxId) {',
    replace: '    if (true) {',
    tests: ['tests/selftest_gate_official_sent.test.js']
  },
  {
    id: 'gate-lets-real-through',
    why: '不再數 SendLog 裏面有冇真信'
      + '——兩個呼叫端都係傳沙盒季度 ID 入嘅，'
      + '所以「係唔係沙盒季度」單獨用嘅話係一句恆真句。'
      + '拆走嗰條，一個 `SELFTEST_QUARTER_ID` 填錯成真季度嘅'
      + '情況就會被放行，而自測機開跑第一件事就係清乾淨',
    file: 'src/SelfTestRunner.gs',
    find: '    } else if (realSends !== 0) {',
    replace: '    } else if (false) {',
    tests: ['tests/selftest_gate_official_sent.test.js']
  },
  {
    id: 'gate-unreadable-ok',
    why: '讀唔到 SendLog 就當成「冇寄過信」'
      + '——「查不到」同「查到係 0」係兩件事，'
      + '而估錯嗰邊嘅代價係一個真季度被清乾淨',
    file: 'src/SelfTestRunner.gs',
    find: "      + ' 有沒有真的寄過信：' + err.message);\n    return -1;",
    replace: "      + ' 有沒有真的寄過信：' + err.message);\n    return 0;",
    tests: ['tests/selftest_gate_official_sent.test.js']
  },
  {
    id: 'gate-counts-dryrun',
    why: '數 SendLog 嗰陣連 `DRY_RUN` 都數入去'
      + '——嗰部機器一定嗺 DRY_RUN 之下跑，'
      + '數埋嘅話沙盒季度永遠被攛住',
    file: 'src/SelfTestRunner.gs',
    find: "        && String(row[C.STATUS] || '').trim().toUpperCase() === MAIL_STATUS.SENT;",
    replace: '        && true;',
    tests: ['tests/selftest_gate_official_sent.test.js']
  },
  {
    id: 'gate-counts-all-quarters',
    why: '數 SendLog 嗰陣唔分季度'
      + '——第二季寄過信就會連沙盒季度一齊攛住',
    file: 'src/SelfTestRunner.gs',
    find: "      return String(row[C.QUARTER_ID] || '').trim().toUpperCase() === upper",
    replace: '      return true',
    tests: ['tests/selftest_gate_official_sent.test.js']
  },
  {
    id: 'gate-a3-line-gone',
    why: '報告開頭唔講「Stage=OFFICIAL_SENT（S09 造成，正常）」'
      + '——下次見到嗰個 Stage 又會以為部機器壞咗',
    file: 'src/SelfTestRunner.gs',
    find: '  if (report.stageAtStart === QUARTER_STAGE.OFFICIAL_SENT) {',
    replace: '  if (false) {',
    tests: ['tests/selftest_gate_official_sent.test.js']
  },
  // ── 第六十輪批次：亂行機喺沙盒度原地打轉 ──────────────────────
  {
    id: 'mky-writes-garbage',
    why: '「改 grid」寫返「亂行N」'
      + '——一個系統認唔出嘅名，寫咗之後儲存整批拒絕、寄出封鎖、'
      + '套用申報行唔到，於是每一步只剩「改 grid」合法，'
      + '亂行機一直寫更多，永遠出唔到個坑'
      + '（第五十四輪 S03 嗰個修正冇套到亂行機）',
    file: 'src/MonkeyRun.gs',
    find: '        const picked = selfTestPickAcceptedCells_(\n'
      + '          quarterId, versionNo, howMany, MONKEY_SCENARIO_ID);',
    replace: '        const picked = { cells: [], planCalls: 0 };\n'
      + '        selfTestPickCells_(quarterId, versionNo, howMany)\n'
      + '          .forEach(function (c, i) {\n'
      + '            selfTestWriteGridCell_(quarterId, versionNo, c.serviceDate,\n'
      + "              c.postId, c.slotIndex, '亂行' + (i + 1));\n"
      + '          });',
    tests: ['tests/monkey_no_spin.test.js']
  },
  {
    id: 'mky-grid-unresolved-mute',
    why: '寫完之後仲有認唔出嘅名，「改 grid」唔出聲'
      + '——正正就係今輪嗰個坑：報告一句都冇講，'
      + '而部機器已經行緊 50 步無效動作',
    file: 'src/MonkeyRun.gs',
    find: '        if (Number(after.unresolvedCount || 0) > 0) {',
    replace: '        if (false) {',
    tests: ['tests/monkey_no_spin.test.js']
  },
  {
    id: 'mky-facts-unres-zero',
    why: '`monkeyReadFacts_()` 寫死 `unresolvedCount: 0`'
      + '——上面嗰條斷言就永遠唔會 fire，'
      + '而一條永遠 true 嘅斷言同冇斷言係同一件事',
    file: 'src/MonkeyRun.gs',
    find: '    unresolvedCount: (state.unsaved || {}).unresolvedCount || 0,',
    replace: '    unresolvedCount: 0,',
    tests: ['tests/monkey_no_spin.test.js']
  },
  {
    id: 'mky-no-spin-guard',
    why: '拆走防打轉閘'
      + '——亂行機嘅本質就係會撞到冇人諗過嘅狀態，'
      + '佢一定要有自己爬得出嚟嘅能力，否則每撞一個新坑都要人手救',
    file: 'src/MonkeyRun.gs',
    find: '    if (sameFingerprintRun >= MONKEY_SPIN_LIMIT) {',
    replace: '    if (false) {',
    tests: ['tests/monkey_no_spin.test.js']
  },
  {
    id: 'mky-spin-silent',
    why: '偵測到打轉之後靜靜停低，唔記成失敗'
      + '——一份「跑咗 5 步、0 項失敗」嘅報告睇落好似冇事',
    file: 'src/MonkeyRun.gs',
    find: "      failures.push({\n"
      + "        step: absStep, kind: '偵測到原地打轉，已停止',",
    replace: "      [].push({\n"
      + "        step: absStep, kind: '偵測到原地打轉，已停止',",
    tests: ['tests/monkey_no_spin.test.js']
  },
  {
    id: 'mky-spin-not-printed',
    why: '報告唔印「偵測到原地打轉，已停止」'
      + '——嗰句係「點解跑到一半就停」嘅唯一答案',
    file: 'src/MonkeyRun.gs',
    find: '  if (report.spinning) {',
    replace: '  if (false) {',
    tests: ['tests/monkey_no_spin.test.js']
  },
  {
    id: 'mky-fingerprint-grid',
    why: '狀態指紋包埋 `gridChangeCount`'
      + '——一部一路寫更多「亂行N」嘅機器每一步個數都加一，'
      + '於是指紋每步都唔同，防打轉閘永遠唔會 fire，'
      + '今輪個 bug 原封不動',
    file: 'src/MonkeyRun.gs',
    find: '  return [facts.stage, facts.latestVersionNo,\n'
      + "    Number(facts.unresolvedCount || 0)].join('|');",
    replace: '  return [facts.stage, facts.latestVersionNo,\n'
      + "    Number(facts.unresolvedCount || 0),\n"
      + "    facts.gridChangeCount].join('|');",
    tests: ['tests/monkey_no_spin.test.js']
  },
  {
    id: 'mky-spin-limit-one',
    why: '連續 1 步就當打轉'
      + '——一部乜都當打轉嘅機器同一部乜都唔停嘅機器一樣冇用',
    file: 'src/MonkeyRun.gs',
    find: 'const MONKEY_SPIN_LIMIT = 5;',
    replace: 'const MONKEY_SPIN_LIMIT = 1;',
    tests: ['tests/monkey_no_spin.test.js']
  },
  {
    id: 'mky-rare-no-revert',
    why: '寫完認唔出嘅名之後唔改返原值'
      + '——即係親手種返今輪嗰個坑：下一步開始系統乜都唔准做',
    file: 'src/MonkeyRun.gs',
    find: '        const reverted = selfTestWriteGridCell_(quarterId, versionNo,'
      + ' cell.serviceDate,\n'
      + '          cell.postId, cell.slotIndex, originalName);',
    replace: '        const reverted = true;',
    tests: ['tests/monkey_no_spin.test.js']
  },
  {
    id: 'mky-rare-block-mute',
    why: '寫咗個認唔出嘅名，儲存冇擋住都唔出聲'
      + '——嗰個係系統最嚴厲嗰一道閘，佢失效嘅話'
      + '一個認唔出嘅名會靜靜噉入咗版本',
    file: 'src/MonkeyRun.gs',
    find: "        if (result.blockReason !== 'NEEDS_NAME_DECISION') {",
    replace: '        if (false) {',
    tests: ['tests/monkey_no_spin.test.js']
  },
  {
    id: 'mky-rare-weight-normal',
    why: '「寫一格認不出的名字」用返一般權重'
      + '——呢類順手探一探嘅動作經常做會蓋過其餘動作嘅覆蓋率，'
      + '而 S16 已經有一條完整情境專門驗呢件事',
    file: 'src/MonkeyRun.gs',
    find: '      weight: MONKEY_RARE_WEIGHT,',
    replace: '      weight: MONKEY_DEFAULT_WEIGHT,',
    tests: ['tests/monkey_no_spin.test.js']
  },
  {
    id: 'mky-weight-ignored',
    why: '加權揀動作嗰陣唔加權重，每個當一份'
      + '——低權重嗰個會變成永遠揀唔中，'
      + '而「順手探一探」嘅價值就係偶然真係會撞到',
    file: 'src/MonkeyRun.gs',
    find: '    total += Math.max(1, Number(a.weight) || MONKEY_DEFAULT_WEIGHT);',
    replace: '    total += 1;',
    tests: ['tests/monkey_no_spin.test.js']
  },
  // ── 第六十一輪批次：亂行機跑得郁，但太慢 ──────────────────────
  {
    id: 'mky-inv-all-per-step',
    why: '每一步都跑全套不變量'
      + '——入面有 I04（`RosterAssignments` 成萬行）同 I08'
      + '（每條要行一次完整 plan）。一批 4.5 分鐘得 2 步，樽頸就係呢度',
    file: 'src/MonkeyRun.gs',
    find: '        isFullSweep ? INVARIANT_SET.ALL : INVARIANT_SET.PER_SCENARIO);',
    replace: '        INVARIANT_SET.ALL);',
    tests: ['tests/monkey_speed.test.js']
  },
  {
    id: 'mky-inv-never-full',
    why: '慳到唔再跑全套'
      + '——慳時間唔可以變成唔驗。I04／I08 只喺全套嗰批，'
      + '唔跑嘅話「有重複嘅格」呢類問題永遠捉唔到',
    file: 'src/MonkeyRun.gs',
    find: '    const isFullSweep = (i % MONKEY_FULL_INVARIANT_EVERY === 0)'
      + ' || (i === total);',
    replace: '    const isFullSweep = false;',
    tests: ['tests/monkey_speed.test.js']
  },
  {
    id: 'mky-no-tail-sweep',
    why: '收尾唔補跑全套'
      + '——迴圈會因為時間到／原地打轉／冇合法動作而中途 break，'
      + '省咗嘅話最尾嗰段改動一次全套都冇驗過',
    file: 'src/MonkeyRun.gs',
    find: '  if (ranSteps > 0 && lastFullSweepStep !== stepLog[ranSteps - 1].step) {',
    replace: '  if (false) {',
    tests: ['tests/monkey_speed.test.js']
  },
  {
    id: 'mky-sweep-label-gone',
    why: '唔再分「逐步」同「全套」'
      + '——一條只喺全套先驗到嘅不變量紅咗，係喺前面某幾步之內壞嘅，'
      + '唔標明嘅話人會淨係盯住最後嗰一步',
    file: 'src/MonkeyRun.gs',
    find: "          sweep: isFullSweep ? '全套' : '逐步',",
    replace: "          sweep: '逐步',",
    tests: ['tests/monkey_speed.test.js']
  },
  {
    id: 'mky-sweep-not-printed',
    why: '報告唔講「可能是前面幾步之內壞的」'
      + '——揾錯方向嘅代價係由頭再查一次',
    file: 'src/MonkeyRun.gs',
    find: "      + (f.sweep === '全套' ? '（全套那一次驗到；可能是前面幾步之內壞的）'",
    replace: "      + (false ? '（全套那一次驗到；可能是前面幾步之內壞的）'",
    tests: ['tests/monkey_speed.test.js']
  },
  {
    id: 'mky-slow-hardcoded',
    why: '慢動作寫死跳過，唔讀 Config'
      + '——Ivan 明確講過之後要改得返。寫死咗就改唔返',
    file: 'src/MonkeyRun.gs',
    find: '  return getConfig(CONFIG_KEYS.MONKEY_SKIP_SLOW_ACTIONS, true) === true;',
    replace: '  return true;',
    tests: ['tests/monkey_speed.test.js']
  },
  {
    id: 'mky-slow-marker-gone',
    why: '拆走「正式發出給全體（模擬）」嗰個 `slow` 標記'
      + '——冇標記就冇得跳，開關變成一個乜都唔做嘅開關',
    file: 'src/MonkeyRun.gs',
    find: "      slow: '要逐個收件人（≈58 位）砌信同查個人 PDF；'",
    replace: "      slowDisabled: '要逐個收件人（≈58 位）砌信同查個人 PDF；'",
    tests: ['tests/monkey_speed.test.js']
  },
  {
    id: 'mky-slow-not-printed',
    why: '報告唔印「已跳過的慢動作」'
      + '——一份「跑咗 50 步、零失敗」而冇講跳過乜嘅報告，'
      + '會令人以為嗰條路驗過',
    file: 'src/MonkeyRun.gs',
    find: '  if (report.skipSlow && (report.skippedSlow || []).length > 0) {',
    replace: '  if (false) {',
    tests: ['tests/monkey_speed.test.js']
  },
  {
    id: 'mky-slow-side-mute',
    why: '唔講跳過嘅連帶後果'
      + '——Stage 上唔到「已正式發出」，所以「改動後重發」亦都抽唔到。'
      + '唔講嘅話，下次會以為嗰一步壞咗',
    file: 'src/MonkeyRun.gs',
    find: "    lines.push('　 ⚠️ 連帶：Stage 上不到「已正式發出」，'",
    replace: "    if (false) lines.push('　 ⚠️ 連帶：Stage 上不到「已正式發出」，'",
    tests: ['tests/monkey_speed.test.js']
  },
  {
    id: 'mky-no-legal-silent',
    why: '冇合法動作就靜靜 break，唔記成失敗'
      + '——報告會寫「跑了 1 / 20 步，0 項失敗」，'
      + '而冇人知道點解得 1 步、亦都重現唔到',
    file: 'src/MonkeyRun.gs',
    find: "      failures.push({\n"
      + "        step: absStep, kind: '這個狀態下沒有任何合法動作',",
    replace: "      [].push({\n"
      + "        step: absStep, kind: '這個狀態下沒有任何合法動作',",
    tests: ['tests/monkey_speed.test.js']
  },
  {
    id: 'mky-no-legal-not-printed',
    why: '報告唔印「這個狀態下沒有任何合法動作」'
      + '——嗰句係「點解跑到一半就停」嘅答案',
    file: 'src/MonkeyRun.gs',
    find: '  if (report.noLegalAction) {',
    replace: '  if (false) {',
    tests: ['tests/monkey_speed.test.js']
  },
  {
    id: 'mky-speed-line-gone',
    why: '報告唔印時間分佈'
      + '——落一輪又要重新估樽頸喺邊',
    file: 'src/MonkeyRun.gs',
    find: '  lines.push(monkeyDescribeSpeed_(report));',
    replace: '  lines.push(\'\');',
    tests: ['tests/monkey_speed.test.js']
  },
  {
    id: 'mky-speed-no-split',
    why: '時間只印一個總數，唔分動作／不變量'
      + '——樽頸喺邊就要靠估',
    file: 'src/MonkeyRun.gs',
    find: "    + '（動作 ' + monkeyFormatDuration_(report.actionMs)\n"
      + "    + '／不變量 ' + monkeyFormatDuration_(report.invariantMs) + '）';",
    replace: "    + '';",
    tests: ['tests/monkey_speed.test.js']
  },
  {
    id: 'mky-fast-ids-guessed',
    why: '快嗰批嘅 id 喺亂行機度另寫一份清單'
      + '——`INVARIANT_SET.PER_SCENARIO` 日後加減一條，'
      + '報告就會講一個唔存在嘅事實，而冇人會發現',
    file: 'src/MonkeyRun.gs',
    // ⚠️ `find` 特登唔寫到成句完——寫齊嘅話，句字面量入面會有一串
    // 「物件.屬性」，而嗰個屬性名啱啱好係一個真實 TLD，
    // 於是 `scan-staged-secrets.js` 會當佢係網域擋住 commit。
    find: '        fastInvariantIds = inv.results.map(function (r) {',
    // ⚠️ 保留後半截，句嘢先至仍然係合法 JS：
    //   `['I01', …] || inv.results.map(function (r) { … });`
    // 左邊永遠 truthy，所以真正效果就係「另寫一份清單」。
    replace: "        fastInvariantIds = ['I01', 'I05', 'I09', 'I10']"
      + " || inv.results.map(function (r) {",
    tests: ['tests/monkey_speed.test.js']
  },
  {
    id: 'mky-sweep-count-wrong',
    why: '唔數全套跑咗幾多次'
      + '——報告會講「全套跑了 0 次」，而實際跑過；'
      + '一個講錯咗嘅數字比冇數字更差',
    file: 'src/MonkeyRun.gs',
    find: '        fullSweepCount++;\n        lastFullSweepStep = absStep;',
    replace: '        lastFullSweepStep = absStep;',
    tests: ['tests/monkey_speed.test.js']
  },
  // ── 第六十二輪批次 B 組：步數計錯，永遠撳唔到 50/50 ────────────
  {
    id: 'mky-state-batch-steps',
    why: '`MonkeyState` 寫返當前批次嘅步數（唔係累計）'
      + '——實測 10→32→70 抽數一路加，而步數 2→4→3 跌返落去。'
      + '報告嗰句「跑了 N / 50 步」用嘅就係佢，'
      + '所以撳幾多次分子都喺 2–4 之間浮動，永遠去唔到 50',
    file: 'src/MonkeyRun.gs',
    find: '  sheet.appendRow([report.seed, report.drawnCount, report.totalSteps,',
    replace: '  sheet.appendRow([report.seed, report.drawnCount, report.ranSteps,',
    tests: ['tests/monkey_total_steps.test.js']
  },
  {
    id: 'mky-state-no-total',
    why: '`readMonkeyState_()` 唔讀返累計步數'
      + '——寫落表冇人讀，就等於冇寫。舊寫法就係噉',
    file: 'src/MonkeyRun.gs',
    find: "    totalSteps: pick('累計步數')",
    replace: '    totalSteps: 0',
    tests: ['tests/monkey_total_steps.test.js']
  },
  {
    id: 'mky-state-by-index',
    why: '`MonkeyState` 照位置讀唔照欄名'
      + '——舊表第 3 欄叫「已跑步數」（只計當前批次），'
      + '照位置讀會把一個批次數當成累計。'
      + '一個講錯咗嘅數字比冇數字更差',
    file: 'src/MonkeyRun.gs',
    find: '    const at = headers.indexOf(name);',
    replace: '    const at = MONKEY_STATE_HEADERS.indexOf(name);',
    tests: ['tests/monkey_total_steps.test.js']
  },
  {
    id: 'mky-resume-no-prior',
    why: '續跑唔傳累計步數落 `runMonkey_()`'
      + '——每批嘅步號都由 1 開始，而累計永遠等於當前批次',
    file: 'src/MonkeyRun.gs',
    find: '    report = runMonkey_(steps, state.seed, state.drawnCount, state.totalSteps);',
    replace: '    report = runMonkey_(steps, state.seed, state.drawnCount);',
    // ⚠️ 續跑入口喺一個選單函式入面（要 `SpreadsheetApp.getUi()`），
    // 離線行唔到，所以守佢嗰條斷言喺 monkey_run 嗰邊做原始碼形狀檢查。
    tests: ['tests/monkey_run.test.js']
  },
  {
    id: 'mky-abs-step-is-batch',
    why: '步號用返批次序號，唔加上之前跑過嘅'
      + '——`MonkeyLog` 會出現 1,2,3 之後又 1,2,3，跨批路徑砌唔返',
    file: 'src/MonkeyRun.gs',
    find: '    const absStep = priorStepCount + i;',
    replace: '    const absStep = i;',
    tests: ['tests/monkey_total_steps.test.js']
  },
  {
    id: 'mky-log-clears',
    why: '`MonkeyLog` 每批覆寫'
      + '——實測續跑之後成張 log 只剩 3 行，而之前明明跑過 4 步。'
      + '一份會自己刪走歷史嘅紀錄等於冇紀錄',
    file: 'src/MonkeyRun.gs',
    find: '  const freshRun = Number(report.priorSteps || 0) === 0;',
    replace: '  const freshRun = true;',
    tests: ['tests/monkey_total_steps.test.js']
  },
  {
    id: 'mky-log-no-cap',
    why: '`MonkeyLog` append 而冇上限'
      + '——跑得耐就會撐爆張表',
    file: 'src/MonkeyRun.gs',
    find: '  if (dataRows > MONKEY_LOG_MAX_ROWS) {',
    replace: '  if (false) {',
    tests: ['tests/monkey_total_steps.test.js']
  },
  {
    id: 'mky-log-trims-new',
    why: '剪走嘅係最新嗰幾行，唔係最舊'
      + '——一跑滿上限就再冇最近嘅紀錄，而最近嗰啲先至係查緊嗰批',
    file: 'src/MonkeyRun.gs',
    find: '    sheet.deleteRows(2, dataRows - MONKEY_LOG_MAX_ROWS);',
    replace: '    sheet.deleteRows(MONKEY_LOG_MAX_ROWS + 2,'
      + ' dataRows - MONKEY_LOG_MAX_ROWS);',
    tests: ['tests/monkey_total_steps.test.js']
  },
  {
    id: 'mky-headline-batch',
    why: '報告第一句用返當前批次嘅步數'
      + '——就係呢一句令人以為部機器打緊轉。'
      + '一個會歸零嘅進度計數器比冇計數器更差',
    file: 'src/MonkeyRun.gs',
    find: "    '亂行機：累計 ' + report.totalSteps + ' / ' + report.requestedSteps",
    replace: "    '亂行機：累計 ' + report.ranSteps + ' / ' + report.requestedSteps",
    tests: ['tests/monkey_total_steps.test.js']
  },
  {
    id: 'mky-no-step-range',
    why: '「這一批」唔講步號範圍'
      + '——連續兩批各三步睇落一模一樣，分唔出有冇行前過',
    file: 'src/MonkeyRun.gs',
    find: "    ? '（第 ' + report.firstStepNo + ' – ' + report.lastStepNo + ' 步）'",
    replace: "    ? ''",
    tests: ['tests/monkey_total_steps.test.js']
  },
  {
    id: 'mky-duration-raw-sec',
    why: '時間唔轉「X 分 Y 秒」'
      + '——`252.0 秒` 讀落要自己心算',
    file: 'src/MonkeyRun.gs',
    find: "  return Math.floor(total / 60) + ' 分 ' + (total % 60) + ' 秒';",
    replace: "  return total + ' 秒';",
    tests: ['tests/monkey_total_steps.test.js']
  },
  {
    id: 'mky-fails-unlabelled',
    why: '報告唔講明失敗數只計當前批次'
      + '——一個累計 10 步而今批 0 失敗嘅報告，'
      + '會被當成「10 步都冇失敗過」',
    file: 'src/MonkeyRun.gs',
    find: "      + report.failures.length + ' 項失敗（這一批）',",
    replace: "      + report.failures.length + ' 項失敗',",
    tests: ['tests/monkey_total_steps.test.js']
  },
  // ── 第六十三輪批次 K 組：人手填嘅講員／翻譯／獻花被當成硬規則違反 ──
  {
    id: 'k-helper-ignores-source',
    why: '`isNoAutoGenerateViolation_()` 唔理來源，凡有人就報'
      + '——現場：經「填講員／翻譯／獻花」填咗 3 格獻花，'
      + '「儲存及寄出」話佢違反「要你自己填」，每次儲存都要打字放行',
    file: 'src/Generator.gs',
    find: '  return HUMAN_ASSIGN_SOURCES.indexOf(assignSource) === -1;',
    replace: '  return true;',
    tests: ['tests/manual_fill_not_violation.test.js']
  },
  {
    id: 'k-findstate-own-check',
    why: '`findStateViolations_()` 唔叫共用判斷，自己寫返「冇 AutoGenerate 就報」'
      + '——儲存、套用申報、提案、回退四條路全部打回原形',
    file: 'src/FineTune.gs',
    find: '        && isNoAutoGenerateViolation_(post, sourceOf(cell))) {',
    replace: '        && post && !post.autoGenerate) {',
    tests: ['tests/manual_fill_not_violation.test.js']
  },
  {
    id: 'k-verify-own-check',
    why: '「核對職事表」唔叫共用判斷'
      + '——同一格喺儲存確認冇事、喺核對報告就話違反，兩個講法',
    file: 'src/Verify.gs',
    find: '    if (isNoAutoGenerateViolation_(post, a.assignSource || null)) {',
    replace: '    if (post && !post.autoGenerate) {',
    tests: ['tests/manual_fill_not_violation.test.js']
  },
  {
    id: 'k-carry-src-new-person',
    why: '換咗人都照搬上一版嘅來源'
      + '——上一版係人手填嘅講員，系統試放另一個人就會被當成人手，'
      + '於是系統會自己建議一個講員',
    file: 'src/FineTune.gs',
    find: '    if (o && o.personId === cell.personId) return o.assignSource || null;',
    replace: '    if (o) return o.assignSource || null;',
    tests: ['tests/manual_fill_not_violation.test.js']
  },
  {
    id: 'k-substitute-no-source',
    why: '`substituteCell_()` 唔講明係系統揀嘅人'
      + '——搵替補試放嘅格就要靠「換咗人」嗰條後備判斷，一層防線變冇',
    file: 'src/FineTune.gs',
    find: '      assignSource: ASSIGN_SOURCE.FINE_TUNED\n    };',
    replace: '    };',
    tests: ['tests/manual_fill_not_violation.test.js']
  },
  {
    id: 'k-requests-no-source',
    why: '套用申報之後重跑檢查嘅狀態唔帶來源'
      + '——申報指定一位會友做獻花，套用完就話佢違反「要你自己填」',
    file: 'src/RequestsApply.gs',
    find: '      // 第六十三輪批次 K 組：申報指定嘅人係 MANUAL，唔係違反\n'
      + '      assignSource: a.assignSource\n',
    replace: '',
    tests: ['tests/manual_fill_not_violation.test.js']
  },
  {
    id: 'k-record-state-no-source',
    why: '已定案版本嘅狀態唔帶來源'
      + '——寄出、回退預覽要靠上一版估，估錯就會亂報',
    file: 'src/StateSource.gs',
    find: '          // 第六十三輪批次 K 組：`NO_AUTO_GENERATE` 要分系統排定人手放\n'
      + '          assignSource: a.assignSource\n',
    replace: '',
    tests: ['tests/manual_fill_not_violation.test.js']
  },
  // ── 第六十三輪批次 H 組：一條只喺 LF 行尾下會紅嘅測試 ──────────
  {
    id: 'h-pace-uses-pair-count',
    why: '引擎嘅進度控制真係用咗 `adjacentPairCount_()`'
      + '——呢條係「唔准改」嘅嘢；舊測試用跨函式邊界嘅正則，'
      + '結果由行尾決定，同程式啱唔啱無關',
    file: 'src/Generator.gs',
    find: '  return count < target * weeksCounted;',
    replace: '  return count < target * adjacentPairCount_(weeksCounted);',
    tests: ['tests/adjacent_pair_denominator_gap.test.js']
  },
  // ── 第六十三輪批次 P 組：改動後重發漏咗「被整個換走」嘅人 ──────
  {
    id: 'p-pool-skips-dropped',
    why: '收件人池唔加返「呢一版 0 格」而又有改動嘅人'
      + '——現場：「有 3 位的安排改過」但「只寄給安排有改動的人」得 2 位，'
      + '被換走嗰位揀都揀唔到，永遠收唔到「你嗰兩格已經改由別人負責」',
    file: 'src/WebAppSendPlan.gs',
    find: "  addChangedPersonsMissingFromPool_(pool, changedByPerson, context.peopleById);\n",
    replace: '',
    tests: ['tests/resend_dropped_person.test.js']
  },
  {
    id: 'p-zero-list-no-targets',
    why: '完成訊息嘅「已通知」名單唔理有冇真係寄'
      + '——幹事冇揀佢都話「已通知」，即係講大話',
    file: 'src/ResendFlow.gs',
    find: '    return !c.hasAssignments && wanted[c.personId] === true;',
    replace: '    return !c.hasAssignments;',
    tests: ['tests/resend_dropped_person.test.js']
  },
  {
    id: 'p-done-no-zero-list',
    why: '完成訊息唔帶零派工嗰幾位'
      + '——幹事只見到一個總數，睇唔出被換走嘅人有冇收到',
    file: 'src/WebAppFlow.gs',
    // 第六十三輪批次 A 組喺後面加咗 publicLinkRepublished
    find: '    zeroAssignmentPeople: zeroAssignmentPeople,\n'
      + '    publicLinkRepublished: !!sendResult.publicLinkRepublished\n',
    replace: '    publicLinkRepublished: !!sendResult.publicLinkRepublished\n',
    tests: ['tests/resend_dropped_person.test.js']
  },
  {
    id: 'p-ui-no-dropped-note',
    why: '揀人畫面寫返「這一季 0 格」'
      + '——幹事會以為佢本來就冇份，唔知佢係被換走',
    file: 'src/ui/ScriptSendPaper.html',
    find: "        : (c.noAssignmentThisVersion ? '（這一版沒有任何安排）'\n"
      + "          : ('（這一季 ' + c.cellCount + ' 格）')))",
    replace: "        : ('（這一季 ' + c.cellCount + ' 格）'))",
    tests: ['tests/resend_dropped_person.test.js']
  },
  {
    id: 'p-confirm-implicit-none',
    why: '確認框零派工嗰行靠 currentSummary 啱啱係空字串'
      + '——日後摘要格式一改，被換走嘅人就會顯示一句古怪嘢',
    file: 'src/ui/ScriptZone1.html',
    // 第六十五輪批次 Y 組：抽成 resendCurrentText()
    find: "    return '現在：' + (c.hasAssignments === false\n"
      + "      ? '這一季沒有安排' : (c.currentSummary || '（現在的安排沒有記錄）'));",
    replace: "    return '現在：' + (c.currentSummary || '（現在的安排沒有記錄）');",
    tests: ['tests/resend_dropped_person.test.js']
  },
  // ── 第六十三輪批次 Q 組：補寄用最新版本查寄出紀錄 ──────────────
  {
    id: 'q-plan-latest-only',
    why: '補寄預覽返返去只睇最新版本嘅寄出紀錄'
      + '——現場：全體收咗第 2 版、存咗第 3 版，預覽話「這 53 位還沒有收到」，'
      + '連收過嗰位都喺入面；照撳全體會再收一封正式發出',
    file: 'src/MakeupSend.gs',
    // 第六十五輪批次 X 組：改為經 `buildQuarterNoticeReceivedIndex_()`
    find: '  const recordByKey = buildQuarterNoticeReceivedIndex_(quarterId, stage);',
    replace: '  const recordByKey = buildQuarterNoticeReceivedIndex_(quarterId, stage,'
      + ' readSheet(SHEETS.SEND_LOG).filter(function (r) {'
      + ' return Number(r[COLUMNS.SEND_LOG.VERSION_NO]) === versionNo; }));',
    tests: ['tests/makeup_any_version.test.js']
  },
  {
    id: 'q-exec-latest-only',
    why: '執行補寄嗰陣重新篩返去只睇最新版本'
      + '——預覽啱咗，但撳落去嗰一刻照樣寄畀收過嘅人',
    file: 'src/MakeupSend.gs',
    // 第六十五輪批次 X 組：改為經 `buildQuarterNoticeReceivedIndex_()`
    find: '  const recordByKey = buildQuarterNoticeReceivedIndex_(plan.quarterId, plan.stage);',
    replace: '  const recordByKey = buildQuarterNoticeReceivedIndex_(plan.quarterId, plan.stage,'
      + ' readSheet(SHEETS.SEND_LOG).filter(function (r) {'
      + ' return Number(r[COLUMNS.SEND_LOG.VERSION_NO]) === plan.versionNo; }));',
    tests: ['tests/makeup_any_version.test.js']
  },
  {
    id: 'q-fail-erases-received',
    why: '收過之後再失敗一次就當返「未收到」'
      + '——一次補寄失敗會令一個早已收過嘅人再收一封',
    file: 'src/MakeupSend.gs',
    find: '    if (prev && MAKEUP_RECEIVED_STATUSES.indexOf(prev.status) !== -1\n'
      + '        && MAKEUP_RECEIVED_STATUSES.indexOf(status) === -1) return;\n',
    replace: '',
    tests: ['tests/makeup_any_version.test.js']
  },
  {
    id: 'q-preview-no-attach',
    why: '補寄預覽唔講附甚麼'
      + '——幹事唔知收件人會收到乜',
    file: 'src/MakeupSend.gs',
    find: '    attachType: attachType,\n',
    replace: "    attachType: '',\n",
    tests: ['tests/makeup_any_version.test.js']
  },
  {
    id: 'q-preview-no-list-label',
    why: '補寄預覽唔標「名單收件人」'
      + '——現場：名單頭兩個係「教會辦公室」「系統管理」，冇說明',
    file: 'src/WebAppZone4.gs',
    find: '          isListRecipient: r.type === RECIPIENT_TYPE.LIST,\n',
    replace: '',
    tests: ['tests/makeup_any_version.test.js']
  },
  {
    id: 'q-preview-no-cannot-send',
    why: '補寄預覽唔列冇電郵嘅人'
      + '——佢哋補寄一樣寄唔到，要另外通知，淨係一個數字幹事唔知係邊個',
    file: 'src/WebAppZone4.gs',
    find: '      cannotSend: plan.cannotSend.map(function (r) {',
    replace: '      cannotSend: [].map(function (r) {',
    tests: ['tests/makeup_any_version.test.js']
  },
  // ── 第六十三輪批次 A 組：填講員之後，公開連結同個人 PDF 都冇跟上 ──
  {
    id: 'a-link-version-only',
    why: '公開連結「過期」只比版本號，唔比改動時間'
      + '——現場：生成 → 填講員 → 一個月後開連結，13 週講員全部「待確認」',
    file: 'src/WebAppSaveConfirm.gs',
    find: '  if (lastEditAt > publishedAt) {',
    replace: '  if (false) {',
    tests: ['tests/stale_after_fill.test.js']
  },
  {
    id: 'a-try-publish-skips',
    why: '`tryPublishPublicRoster_()` 返返去「版本號一樣就當最新」'
      + '——有人叫佢發佈都會略過，即係舊病',
    file: 'src/WebAppSaveConfirm.gs',
    find: '  return f.latestVersionNo >= 0 && f.rowExists && !f.stale;',
    replace: '  return f.latestVersionNo >= 0 && f.rowExists'
      + ' && f.publishedVersionNo === f.latestVersionNo;',
    tests: ['tests/stale_after_fill.test.js']
  },
  {
    id: 'a-step2-no-ensure',
    why: '寄給堂委審閱之前唔確保公開連結係最新'
      + '——審閱信信末嗰條連結開出嚟，講員一欄全部「待確認」',
    file: 'src/FiveStageCore.gs',
    find: '  const fresh = ensurePublicLinkFreshBeforeSend_(quarterId);\n'
      + '  const result = sendStage(quarterId, versionNo, MAIL_STAGES.REVIEW, sendOptions);',
    replace: '  const fresh = { republished: false };\n'
      + '  const result = sendStage(quarterId, versionNo, MAIL_STAGES.REVIEW, sendOptions);',
    tests: ['tests/stale_after_fill.test.js']
  },
  {
    id: 'a-step4-no-ensure',
    why: '正式發出之前唔確保公開連結係最新',
    file: 'src/FiveStageCore.gs',
    find: '  const fresh = ensurePublicLinkFreshBeforeSend_(quarterId);\n'
      + '  const result = sendStage(quarterId, versionNo, MAIL_STAGES.OFFICIAL, sendOptions);',
    replace: '  const fresh = { republished: false };\n'
      + '  const result = sendStage(quarterId, versionNo, MAIL_STAGES.OFFICIAL, sendOptions);',
    tests: ['tests/stale_after_fill.test.js']
  },
  {
    id: 'a-step5-no-ensure',
    why: '改動後重發之前唔確保公開連結係最新',
    file: 'src/FiveStageCore.gs',
    find: '  const fresh = ensurePublicLinkFreshBeforeSend_(quarterId);\n'
      + '  const result = sendResendStage_(quarterId, versionNo,',
    replace: '  const fresh = { republished: false };\n'
      + '  const result = sendResendStage_(quarterId, versionNo,',
    tests: ['tests/stale_after_fill.test.js']
  },
  {
    id: 'a-ensure-ignores-fail',
    why: '重發佈失敗都照寄'
      + '——收件人開連結見到嘅係舊內容，而畫面冇任何提示',
    file: 'src/WebAppSaveConfirm.gs',
    find: '  const publish = tryPublishPublicRoster_(quarterId);\n  if (publish.failed) {\n'
      + '    throw new Error(buildThreePartMessage_(\n'
      + "      '公開連結未更新到最新內容（'",
    replace: '  const publish = tryPublishPublicRoster_(quarterId);\n  if (false) {\n'
      + '    throw new Error(buildThreePartMessage_(\n'
      + "      '公開連結未更新到最新內容（'",
    tests: ['tests/stale_after_fill.test.js']
  },
  {
    id: 'a-dash-no-stale',
    why: 'Dashboard 唔講公開連結過期'
      + '——幹事可能已經把連結貼咗出去，佢要知',
    file: 'src/WebAppDashboard.gs',
    find: '    publicLink.stale = !!(freshness.hasLink && freshness.stale);',
    replace: '    publicLink.stale = false;',
    tests: ['tests/stale_after_fill.test.js']
  },
  {
    id: 'a-pdf-gen-ignores-stale',
    why: '產生個人 PDF 照樣把過期嘅檔當「已存在」'
      + '——先產 PDF、後填講員 ⇒ 57 份 PDF 永遠印住「待確認」',
    file: 'src/PdfBatch.gs',
    find: '    const alreadyExists = !!existing && existing.sizeBytes >= minBytes && !staleExisting;',
    replace: '    const alreadyExists = !!existing && existing.sizeBytes >= minBytes;',
    tests: ['tests/stale_after_fill.test.js']
  },
  {
    id: 'a-pdf-missing-no-stale',
    why: '寄前缺件檢查唔計過期'
      + '——正式發出會寄一份印住舊內容嘅 PDF，冇任何警告',
    file: 'src/PdfBatch.gs',
    find: '    if (isPersonalPdfStale_(info.lastUpdated, stamp.updatedAt, stamp.timezone)) stale.push(p);',
    replace: '    if (false) stale.push(p);',
    tests: ['tests/stale_after_fill.test.js']
  },
  {
    id: 'a-mail-ignores-stale',
    why: '寄信嗰刻唔理 PDF 過期'
      + '——最後一道防線冇咗',
    file: 'src/Mailer.gs',
    find: '  if (isPersonalPdfStale_(file.getLastUpdated(), stamp.updatedAt, stamp.timezone)) {',
    replace: '  if (false) {',
    tests: ['tests/stale_after_fill.test.js']
  },
  {
    id: 'a-stale-judge-false',
    why: '`isPersonalPdfStale_()` 永遠話唔過期'
      + '——三個入口一齊失效',
    file: 'src/PdfBatch.gs',
    find: '  return fileAt < contentUpdatedAt;',
    replace: '  return false;',
    tests: ['tests/stale_after_fill.test.js']
  },
  {
    id: 'a-normalize-date-raw',
    why: '時間值唔統一，Date 直接轉字串'
      + '——試算表自動把字串認成日期之後，兩邊比較會靜靜錯',
    file: 'src/Utils.gs',
    find: "    return Utilities.formatDate(value, timezone, 'yyyy-MM-dd HH:mm:ss');\n"
      + '  }\n  const text = String(value).trim();\n  if (text === \'\') return null;',
    replace: '    return String(value);\n'
      + '  }\n  const text = String(value).trim();\n  if (text === \'\') return null;',
    tests: ['tests/stale_after_fill.test.js']
  },
  // ── 第六十三輪批次 B 組：特別主日 SkipPostIDs 對講員／翻譯無效 ──────
  {
    id: 'b-skip-after-no-auto',
    why: '`getSkipReason_()` 把 NO_AUTO 排返去特別主日前面'
      + '——現場：合堂嗰週 SkipPostIDs 有 PREACHER，講員照樣「待確認」',
    file: 'src/Generator.gs',
    find: '  if (special.skipPostIds.indexOf(post.postId) !== -1) {\n'
      + '    // 階段 A：獨立的 ruleId（不共用 NO_AUTO_GENERATE），讓顯示層可以把「這個崗位',
    replace: '  if (!post.autoGenerate && isRuleEnabled_(rules, RULE_IDS.NO_AUTO_GENERATE)) {\n'
      + "    return { ruleId: RULE_IDS.NO_AUTO_GENERATE, reason: 'x' };\n  }\n"
      + '  if (special.skipPostIds.indexOf(post.postId) !== -1) {\n'
      + '    // 階段 A：獨立的 ruleId（不共用 NO_AUTO_GENERATE），讓顯示層可以把「這個崗位',
    tests: ['tests/special_skip_preacher.test.js']
  },
  {
    id: 'b-pending-lists-skipped',
    why: '填講員畫面照列特別主日跳過嘅格'
      + '——叫幹事去填一個本來唔設嘅講員',
    file: 'src/PreacherTranslationFill.gs',
    find: '    if (splitList_(row[COLUMNS.ROSTER_ASSIGNMENTS.RULE_FLAGS])\n'
      + '      .indexOf(RULE_IDS.SPECIAL_SUNDAY_SKIP) !== -1) return;\n',
    replace: '',
    tests: ['tests/special_skip_preacher.test.js']
  },
  {
    id: 'b-checklist-counts-skip',
    why: '「講員未填」照計特別主日唔設講員嗰週'
      + '——永遠多數一週，幹事清極都清唔到零',
    file: 'src/WebAppPreQuarter.gs',
    find: '      if (isSkipped(d.serviceDate, postId)) return false;\n',
    replace: '',
    tests: ['tests/special_skip_preacher.test.js']
  },
  {
    id: 'b-special-ignores-active',
    why: '特別主日 Active=FALSE 都當生效'
      + '——幹事已經決定唔用嗰一列，系統照樣跳過崗位',
    file: 'src/SheetReader.gs',
    find: '    .filter(function (row) { return isTrueValue_(row[S.ACTIVE]); })\n'
      + '    .forEach(function (row) {\n'
      + '      const dateStr = toDateString(row[S.SERVICE_DATE], timezone);\n'
      + '      if (!dateStr) return;',
    replace: '    .forEach(function (row) {\n'
      + '      const dateStr = toDateString(row[S.SERVICE_DATE], timezone);\n'
      + '      if (!dateStr) return;',
    tests: ['tests/special_skip_preacher.test.js']
  },
  // ── 第六十三輪批次 C／D 組：會改資料嘅入口要攞鎖；側邊欄逐格依次 ──
  {
    id: 'c-step4-no-lock',
    why: '正式發出唔攞鎖——並發兩次 ⇒ 真寄時全體收兩封',
    file: 'src/WebAppFlow.gs',
    find: "  return withMutationLock_('正式發出給全體', function () {\n"
      + '    return apiStep4Confirm_locked_(quarterId, sendOptions);\n  });',
    replace: '  return apiStep4Confirm_locked_(quarterId, sendOptions);',
    tests: ['tests/mutation_lock_coverage.test.js']
  },
  {
    id: 'c-fill-no-lock',
    why: '填講員唔攞鎖——同儲存並確認並發會寫亂長表同 grid',
    file: 'src/PreacherTranslationFill.gs',
    find: "  return withMutationLock_('填講員／翻譯／獻花', function () {\n"
      + '    return apiSavePreacherTranslationEntry_locked_(quarterId, serviceDate, postId, slotIndex, name);\n  });',
    replace: '  return apiSavePreacherTranslationEntry_locked_(quarterId, serviceDate, postId, slotIndex, name);',
    tests: ['tests/mutation_lock_coverage.test.js']
  },
  {
    id: 'd-saveall-parallel',
    why: '側邊欄「一次過儲存全部」返返去一次過發晒——有鎖之後大半格會被擋',
    file: 'src/ui/PreacherFillSidebar.html',
    find: '      return chain.then(function () {',
    replace: '      chain.then(function () {}); return Promise.resolve().then(function () {',
    tests: ['tests/mutation_lock_coverage.test.js']
  },
  // ── 第六十三輪批次 E 組：QuarterID 空白或打錯 ⇒ 申報被靜靜吞掉 ──
  {
    id: 'e-quarter-raw-compare',
    why: 'QuarterID 唔正規化就比'
      + '——小寫、全形、前後有不可見字元嘅申報對唔上',
    file: 'src/RequestsApply.gs',
    find: '    const writtenQuarter = normalizeIdInput_(row[qCol]).toUpperCase();',
    replace: "    const writtenQuarter = String(row[qCol] || '').trim();",
    tests: ['tests/requests_quarter_id.test.js']
  },
  {
    id: 'e-other-q-swallowed',
    why: 'QuarterID 對唔上就靜靜略過（舊寫法）'
      + '——空白嗰筆唔套用、唔計略過數、唔顯示 NEEDS_INPUT',
    file: 'src/RequestsApply.gs',
    find: '      if (!byDate.ok || !quarterDates[byDate.dateStr]) return;',
    replace: '      return;',
    tests: ['tests/requests_quarter_id.test.js']
  },
  {
    id: 'e-mismatch-applied',
    why: 'QuarterID 同日期所屬季度對唔上都照樣套用'
      + '——系統自己估咗邊個寫錯',
    file: 'src/RequestsApply.gs',
    find: '  if (req.quarterMismatch) {\n'
      + "    return { category: 'NEEDS_INPUT', reason: req.quarterMismatch };\n  }\n",
    replace: '',
    tests: ['tests/requests_quarter_id.test.js']
  },
  {
    id: 'e-no-quarter-note',
    why: '按日期判斷季度而處理結果唔講'
      + '——幹事唔知系統幫佢估咗',
    file: 'src/RequestsApply.gs',
    find: "    if (quarterNoteByRow[o.sheetRow]) o.resultNote = quarterNoteByRow[o.sheetRow] + '；' + o.resultNote;\n",
    replace: '',
    tests: ['tests/requests_quarter_id.test.js']
  },
  {
    id: 'e-no-quarter-dropdown',
    why: 'QuarterID 欄冇下拉——打錯字嘅機會冇人擋',
    file: 'src/RequestsSheet.gs',
    find: '  applyWarningListValidation_(sheet, quarterCol, dataRowCount, quarterOptions);\n',
    replace: '',
    tests: ['tests/requests_quarter_id.test.js']
  },
  // ── 第六十三輪批次 F 組（＋ T1）：只揀部分人仍然講「已正式發出給全體」──
  {
    id: 'f-reach-counts-failed',
    why: '「已收」連 FAILED 都計'
      + '——寄失敗嘅人當成收咗，補寄提示就少咗佢',
    // 第六十五輪批次 X 組：「收過」嘅判斷搬咗去共用嘅 `isNoticeReceivedRecord_()`
    file: 'src/MakeupSend.gs',
    find: '  return !!record && MAKEUP_RECEIVED_STATUSES.indexOf(record.status) !== -1;',
    replace: '  return !!record;',
    tests: ['tests/official_partial_send.test.js', 'tests/notice_received_index.test.js']
  },
  {
    id: 'f-no-shortfall-line',
    why: '完成結論唔講「應收 M 位、未寄 K 位」'
      + '——現場：寄咗 2／57 位，結論話「沒有任何一位漏掉」',
    file: 'src/FiveStageCore.gs',
    find: "  if (!reach || !(reach.notReached > 0)) return '';",
    replace: "  return '';",
    tests: ['tests/official_partial_send.test.js']
  },
  {
    id: 'f-status-ignores-reach',
    why: '狀態卡照寫「已正式發出給全體。」'
      + '——其餘 55 位只能靠補寄，但畫面冇提示要去嗰度',
    file: 'src/WebAppDashboard.gs',
    find: '  if (stage === QUARTER_STAGE.OFFICIAL_SENT && extras && extras.officialReach\n'
      + '      && extras.officialReach.expected > 0) {',
    replace: '  if (false) {',
    tests: ['tests/official_partial_send.test.js']
  },
  {
    id: 'f-status-no-unsent',
    why: '狀態卡唔講最新一版未寄過'
      + '——寄出彈窗有講，狀態卡就冇，兩個畫面講兩件事',
    file: 'src/WebAppDashboard.gs',
    find: "  const unsent = extras && extras.unsentWarn ? ' ' + extras.unsentWarn : '';",
    replace: "  const unsent = '';",
    tests: ['tests/official_partial_send.test.js']
  },
  {
    id: 'f-preview-no-partial',
    why: '確認框唔警告「只揀了 2／57 位」'
      + '——寄出後正式發出就鎖住，幹事唔知其餘要用補寄',
    file: 'src/FiveStageCore.gs',
    find: '  const partial = selectedCount < expectedCount;',
    replace: '  const partial = false;',
    tests: ['tests/official_partial_send.test.js']
  },
  {
    id: 't-contents-hardcoded',
    why: '確認框嘅附件寫死個人版 PDF'
      + '——現場：幹事揀咗整季 PDF，確認框照寫「附自己那份 PDF」',
    file: 'src/FiveStageCore.gs',
    find: "    attachLine: '附件：' + (names[decision.attachType] || decision.attachType)",
    replace: "    attachLine: '附件：' + names[ATTACH_TYPE.PERSONAL_PDF]",
    tests: ['tests/official_partial_send.test.js']
  },
  // ── 第六十三輪批次 G 組：改 Config 唔會自動清快取 ────────────────
  {
    id: 'g-onedit-any-sheet',
    why: '`onEdit` 改乜表都清 Config 快取——每改一格都要重讀 Config',
    file: 'src/Config.gs',
    find: '    if (!sheet || sheet.getName() !== SHEETS.CONFIG) return;',
    replace: '    if (!sheet) return;',
    tests: ['tests/config_onedit.test.js']
  },
  {
    id: 'g-onedit-no-reload',
    why: '`onEdit` 唔清快取'
      + '——DRY_RUN 改返 TRUE 之後五分鐘之內寄送路徑仍然讀到 FALSE',
    file: 'src/Config.gs',
    find: "    reloadConfigCache();\n  } catch (err) {\n    log_('WARN', 'onEdit",
    replace: "  } catch (err) {\n    log_('WARN', 'onEdit",
    tests: ['tests/config_onedit.test.js']
  },
  // ── 第六十三輪批次 I 組：跨季「連續兩週」讀到未登記版本 ──────────
  {
    id: 'i-prior-unregistered',
    why: '`readPriorWeeks_()` 唔核對 `RosterVersions`'
      + '——一個寫咗一半嘅孤兒版本會被當成上一季嘅最終安排',
    file: 'src/Generator.gs',
    find: '    return registered[registeredVersionKey_(\n'
      + '      row[COLUMNS.ROSTER_ASSIGNMENTS.QUARTER_ID], row[COLUMNS.ROSTER_ASSIGNMENTS.VERSION_NO])] === true;',
    replace: '    return true;',
    tests: ['tests/prior_weeks_registered.test.js']
  },
  // ── 第六十三輪批次 J 組：孤兒版本（偵測 ＋ 受保護嘅清理）─────────
  {
    id: 'j-orphan-no-registry',
    why: '偵測唔理 `RosterVersions`，凡有派工紀錄就當孤兒'
      + '——清理工具會連已登記嘅版本一齊刪',
    file: 'src/OrphanVersions.gs',
    find: '    if (registered[registeredVersionKey_(quarterId, versionNo)]) return;\n'
      + '    touch(quarterId, versionNo).assignmentRows++;',
    replace: '    touch(quarterId, versionNo).assignmentRows++;',
    tests: ['tests/orphan_versions.test.js']
  },
  {
    id: 'j-cleanup-no-recheck',
    why: '執行嗰刻唔重新算——預覽之後有人登記咗某一版都照刪',
    file: 'src/OrphanVersions.gs',
    find: '  if (freshKeys !== planKeys) {',
    replace: '  if (false) {',
    tests: ['tests/orphan_versions.test.js']
  },
  {
    id: 'j-grid-only-missed',
    why: '淨係得一張 grid（冇派工紀錄）嘅孤兒搵唔到'
      + '——佢一樣會令下一次造版本撞名',
    file: 'src/OrphanVersions.gs',
    find: '    touch(m[1], m[2]).gridExists = true;',
    replace: '    if (byKey[registeredVersionKey_(m[1], m[2])]) touch(m[1], m[2]).gridExists = true;',
    tests: ['tests/orphan_versions.test.js']
  },
  // ── 第六十三輪批次 L 組：儲存確認畫面嘅違規行顯示英文 PostID ──────
  {
    id: 'l-plan-no-names',
    why: '儲存確認嘅違規唔補中文崗位名同人名'
      + '——現場：「儲存及寄出」確認畫面寫 FLOWER，冇人名',
    file: 'src/WebAppSaveConfirm.gs',
    find: '  const allViolations = decorateViolations_(rawViolations, context);',
    replace: '  const allViolations = rawViolations;',
    tests: ['tests/save_confirm_violation_names.test.js']
  },
  {
    id: 'l-rollback-no-names',
    why: '回退預覽嘅違規唔補中文崗位名——同儲存確認兩個講法',
    file: 'src/WebAppRollback.gs',
    find: '      quarterId, target, decorateViolations_(rawViolations, context));',
    replace: '      quarterId, target, rawViolations);',
    tests: ['tests/save_confirm_violation_names.test.js']
  },
  // ── 第六十三輪批次 M 組：第 1 步嘅掣指向另一季（正式上線季）──────
  {
    id: 'm-selected-redirects',
    why: '揀住嘅季度已生成就自動改指「最早未生成」嗰季'
      + '——現場：選單係 2028年4-6月，掣寫「生成2027年1-3月職事表」（正式上線季）',
    file: 'src/WebAppMainFlow.gs',
    find: '  } else if (selected) {',
    replace: '  } else if (false) {',
    tests: ['tests/main_flow_six_steps.test.js']
  },
  // ── 第六十三輪批次 N 組：錯字名稱提示指向不存在嘅位置 ──────────────
  {
    id: 'n-alias-dev-wording',
    why: '錯字提示寫返「下一輪才搬上來」——開發者用語，而且位置早已搬咗上嚟',
    file: 'src/ui/ScriptZone1.html',
    // 第七十五輪批次 CA 組：提示改為直接指去 NameAlias 工作表（「名單維護」整區拿走）
    find: "在試算表的「NameAlias」工作表加一行（原本的名字＋這個寫法），回來再撳一次' }));",
    replace: "去「名單維護 ▸ 人員與電郵 ▸ 別名」加別名（下一輪才搬上來，暫時請用試算表的 NameAlias 工作表）' }));",
    tests: ['tests/ui_no_dev_wording.test.js']
  },
  // ── 第六十三輪批次 O 組：Google 暫時性錯誤 ───────────────────────────
  {
    id: 'o-read-no-retry',
    why: '唯讀呼叫撞到 Google 暫時性錯誤唔重試——幹事見到一句英文，而重試一次就得',
    file: 'src/ui/Script.html',
    find: '    return withTransientRetry_(() => callServerRaw_(fnName, ...args));',
    replace: '    return callServerRaw_(fnName, ...args);',
    tests: ['tests/transient_retry.test.js']
  },
  {
    id: 'o-retry-any-error',
    why: '乜錯都重試——一個真錯誤會被做多一次，而且延遲幹事見到原因',
    file: 'src/ui/Script.html',
    find: '      if (!isTransientServerError_(err)) throw err;\n',
    replace: '',
    tests: ['tests/transient_retry.test.js']
  },
  {
    id: 'o-modal-english',
    why: '暫時性錯誤嘅彈窗照顯示英文技術訊息做第一句',
    file: 'src/ui/Script.html',
    find: '    if (!parsed && isTransientServerError_(err)) {',
    replace: '    if (false) {',
    tests: ['tests/transient_retry.test.js']
  },
  // ── 第六十三輪批次 R 組：重發確認框用 hash 基準，上次冇收到嘅人當成「改咗」──
  {
    id: 'r-no-hash-is-changed',
    why: '冇舊 hash 都當「安排改咗」——現場：只寄咗 2 位，確認框寫「這 54 個人的安排改了」',
    file: 'src/ResendFlow.gs',
    find: '  return !!(c && c.oldHash) && c.oldHash !== c.newHash;',
    replace: '  return !!c && c.oldHash !== c.newHash;',
    tests: ['tests/resend_partial_baseline.test.js']
  },
  {
    id: 'r-ui-title-total',
    why: '確認框標題照用總數——上次冇收到嘅人都算入「安排改了」',
    file: 'src/ui/ScriptZone1.html',
    // 第六十六輪批次 AE 組：數字改由 countResendWillSendKinds_(g.willSend) 出，突變跟住搬
    find: "    const kinds = countResendWillSendKinds_(g.willSend);",
    replace: "    const kinds = { changed: plan.changed.length, notReceived: 0 };",
    tests: ['tests/resend_partial_baseline.test.js', 'tests/resend_confirm_kind_tags.test.js']
  },
  {
    id: 'r-ui-no-split',
    why: '確認框唔分兩段——上次冇收到嘅人都放入「真的想改這麼多人」嗰句警告',
    file: 'src/ui/ScriptZone1.html',
    find: '      (c.arrangementChanged === false ? out.notReceived : out.changed).push(c);',
    replace: '      out.changed.push(c);',
    tests: ['tests/resend_partial_baseline.test.js']
  },
  {
    id: 'r-dash-total',
    why: '狀態卡掣 4 文字照用總數——講「有 54 個人的安排改了」',
    file: 'src/WebAppDashboard.gs',
    find: '    ? s.arrangementChangedCount : s.changedPersonCount;',
    replace: '    ? s.changedPersonCount : s.changedPersonCount;',
    tests: ['tests/resend_partial_baseline.test.js']
  },
  // ── 第六十三輪批次 T 組第 2、3 點：畫面文字 ──────────────────────────
  {
    id: 't-busy-fixed-secs',
    why: '等候牌照講「通常要三十幾秒」——儲存實測 70–160 秒、PDF 約 10 分鐘，幹事以為壞咗',
    file: 'src/ui/Script.html',
    find: "  const BUSY_SLOW_HINT_TEXT = '系統仍在處理。有些步驟要等幾分鐘，請不要關掉這一頁。';",
    replace: "  const BUSY_SLOW_HINT_TEXT = '這一步通常要三十幾秒，不要關掉這一頁。';",
    tests: ['tests/ui_wording_t_group.test.js']
  },
  {
    id: 't-rollback-irreversible',
    why: '回退確認框用返預設「這個動作不可逆」——同一個框又話「仍然可以再回去」',
    file: 'src/ui/ScriptRollback.html',
    find: "      typingHint: '確定的話，請在下面輸入「' + CONFIRM_PHRASE + '」兩個字：',\n",
    replace: '',
    tests: ['tests/ui_wording_t_group.test.js']
  },
  // ── 第六十三輪批次 S 組：第 2 步提示同寄出閘讀到唔同嘅未儲存改動（重現測試＋診斷）──
  {
    id: 's-dash-reads-other-ver',
    why: '狀態卡讀咗另一個版本嘅 grid——第 2 步寫「未偵測到」而寄出閘攔到 1 格',
    file: 'src/WebAppDashboard.gs',
    find: '  const unsaved = readDashboardUnsavedState_(quarterId, versionNo);',
    replace: '  const unsaved = readDashboardUnsavedState_(quarterId, Math.max(0, versionNo - 1));',
    tests: ['tests/dashboard_unsaved_consistency.test.js']
  },
  {
    id: 's-diag-not-logged',
    why: '成功讀到都唔寫診斷 log——下次現場再撞到就冇嘢可以對照',
    file: 'src/WebAppDashboard.gs',
    find: '  logDashboardUnsavedDiag_(quarterId, versionNo, state, diagStartedAtMs, skippedIncompleteCount);\n',
    replace: '',
    tests: ['tests/dashboard_unsaved_consistency.test.js']
  },
  // ── 第六十四輪批次 U 組：寄出彈窗收件摘要加起來多過總數 ───────────────
  {
    id: 'u-join-plus',
    why: '收件摘要用「＋」串各組——令人以為係加數（5＋6＋2＝13，總數 6）',
    file: 'src/ui/ScriptSendPaper.html',
    find: "      + (bits.length > 0 ? ('：' + bits.join('、')) : '')",
    replace: "      + (bits.length > 0 ? ('：' + bits.join(' ＋ ')) : '')",
    tests: ['tests/send_selection_sentence.test.js']
  },
  {
    id: 'u-count-twice',
    why: '一個人喺每一組都數一次——各組加埋多過總數',
    file: 'src/ui/ScriptSendPaper.html',
    find: '      const n = keys.filter((k) => !counted[k] && byKey[k]',
    replace: '      const n = keys.filter((k) => byKey[k]',
    tests: ['tests/send_selection_sentence.test.js']
  },
  // ── 第六十四輪批次 V 組：改動後重發為「不會收到信的人」產生個人 PDF ────
  {
    id: 'v-api-all-changed',
    why: '產生 PDF 照用全部 changedList——幹事只揀 3 位卻要等五十多人（約 10 分鐘）',
    file: 'src/WebAppFlow.gs',
    find: '    quarterId, changed.versionNo, changed.changedList, pdfTargets);',
    replace: '    quarterId, changed.versionNo, changed.changedList);',
    tests: ['tests/resend_pdf_targets.test.js']
  },
  {
    id: 'v-no-picked-filter',
    why: '要產 PDF 嘅名單唔跟收件範圍，直接用 changedList',
    file: 'src/ResendFlow.gs',
    find: '  return resolveResendTargetPersonIds_(context, decision, changedPersonIds || [], true)\n',
    replace: '  return (changedPersonIds || []).slice()\n',
    tests: ['tests/resend_pdf_targets.test.js']
  },
  {
    id: 'v-no-assign-intersect',
    why: '拆走「這一版有派工」嘅交集——零派工嘅人亦被叫去產 PDF',
    file: 'src/ResendFlow.gs',
    find: '      return ((context.assignmentsByPerson || {})[id] || []).length > 0;',
    replace: '      return true;',
    tests: ['tests/resend_pdf_targets.test.js']
  },
  {
    id: 'v-ignore-attach-type',
    why: '附件揀咗「不附」仍然產生個人 PDF',
    file: 'src/ResendFlow.gs',
    find: '  if (decision.attachType !== ATTACH_TYPE.PERSONAL_PDF) return [];\n',
    replace: '',
    tests: ['tests/resend_pdf_targets.test.js']
  },
  {
    id: 'v-preview-writes-reason',
    why: '預覽順手寫 notifyReasonByPerson——「看一眼」改變咗「做出來」嘅結果',
    file: 'src/ResendFlow.gs',
    find: '  return resolveResendTargetPersonIds_(context, decision, changedPersonIds || [], true)\n',
    replace: '  return resolveResendTargetPersonIds_(context, decision, changedPersonIds || [], false)\n',
    tests: ['tests/resend_pdf_targets.test.js']
  },
  {
    id: 'v-empty-falls-back',
    why: '指定空名單時退回全部 changedList——「不附」會變成全部重產',
    file: 'src/FiveStageCore.gs',
    find: '  const peopleNeedingPdf = Array.isArray(pdfPersonIds)',
    replace: '  const peopleNeedingPdf = (Array.isArray(pdfPersonIds) && pdfPersonIds.length > 0)',
    tests: ['tests/resend_pdf_targets.test.js']
  },
  {
    id: 'v-ui-no-send-opts',
    why: '前端產生 PDF 嗰個呼叫唔傳 sendOpts——後端睇唔到幹事揀咗邊個',
    file: 'src/ui/ScriptZone1.html',
    find: "callServerMutating('apiStep5GeneratePdfs', currentQuarterId, releaseText, sendOpts);",
    replace: "callServerMutating('apiStep5GeneratePdfs', currentQuarterId, releaseText);",
    tests: ['tests/resend_pdf_targets.test.js']
  },
  // ── 第六十五輪批次 W 組：補寄唔補產生缺嘅個人 PDF，完成窗吞掉缺件 ──
  {
    id: 'w-exec-no-pdf-guard',
    why: '拆走後端「缺個人 PDF 就唔寄」——現場：預覽 53 位，寄出 4 封，'
      + '49 位 ERROR_PDF_MISSING，完成窗淨係出綠色',
    file: 'src/MakeupSend.gs',
    find: '  if (pdfGaps.people.length > 0) {\n    const gapErr',
    replace: '  if (false) {\n    const gapErr',
    tests: ['tests/makeup_pdf_gap.test.js']
  },
  {
    id: 'w-gaps-all-people',
    why: '缺件名單唔限於這一次要寄嘅人——唔關事嘅人都要等佢哋嘅 PDF（V 組原則）',
    file: 'src/MakeupSend.gs',
    find: '  const pick = function (p) { return !!wanted[p.personId]; };',
    replace: '  const pick = function () { return true; };',
    tests: ['tests/makeup_pdf_gap.test.js']
  },
  {
    id: 'w-plan-no-gap-gate',
    why: '預覽有缺件都照畀〔確定補寄〕——撳落去就係現場嗰 49 位收唔到',
    file: 'src/ui/ScriptZone4.html',
    find: '    if (plan.pdfGaps && plan.pdfGaps.count > 0) {',
    replace: '    if (false) {',
    tests: ['tests/makeup_pdf_gap.test.js']
  },
  {
    id: 'w-result-no-missing-cnt',
    why: '完成窗唔顯示「PDF 缺件 N」——現場就係只寫「失敗 0」',
    file: 'src/ui/ScriptZone4.html',
    find: "        text: '失敗 ' + failed + '　PDF 失敗 ' + errorPdf + '　PDF 缺件 ' + missing,",
    replace: "        text: '失敗 ' + failed,",
    tests: ['tests/makeup_pdf_gap.test.js']
  },
  {
    id: 'w-result-no-conclusion',
    why: '有缺件都冇結論句——幹事以為補寄完成，49 位一封都冇收到',
    file: 'src/ui/ScriptZone4.html',
    find: '    if (missing > 0) {',
    replace: '    if (false) {',
    tests: ['tests/makeup_pdf_gap.test.js']
  },
  {
    id: 'w-api-drops-missing',
    why: '網頁執行入口唔回傳 errorPdfMissing——畫面想顯示都冇數',
    file: 'src/WebAppZone4.gs',
    find: '      errorPdfMissing: result.errorPdfMissing,\n',
    replace: '',
    tests: ['tests/makeup_pdf_gap.test.js']
  },
  // ── 第六十五輪批次 X 組：「收過沒有」有兩個定義 ─────────────────────
  {
    id: 'x-index-official-only',
    why: '「收過」返返去只睇 OFFICIAL——現場：改動後重發收過第 3 版嘅兩位，'
      + '補寄預覽照列「還沒有收到」，照撳會收兩次',
    file: 'src/MakeupSend.gs',
    find: '    ? [MAIL_STAGES.OFFICIAL, MAIL_STAGES.RESEND]',
    replace: '    ? [MAIL_STAGES.OFFICIAL]',
    tests: ['tests/notice_received_index.test.js']
  },
  {
    id: 'x-reach-own-official',
    why: '狀態卡自己另外只睇 OFFICIAL——同補寄講兩個唔同嘅「已收」數',
    file: 'src/FiveStageCore.gs',
    find: '  const received = buildQuarterNoticeReceivedIndex_(quarterId, MAIL_STAGES.OFFICIAL);',
    replace: '  const received = buildSendStatusByRecipient_('
      + 'readSheet(SHEETS.SEND_LOG), quarterId, MAIL_STAGES.OFFICIAL);',
    tests: ['tests/notice_received_index.test.js']
  },
  {
    id: 'x-plan-own-official',
    why: '補寄預覽自己另外只睇 OFFICIAL',
    file: 'src/MakeupSend.gs',
    find: '  const recordByKey = buildQuarterNoticeReceivedIndex_(quarterId, stage);',
    replace: '  const recordByKey = buildSendStatusByRecipient_(readSheet(SHEETS.SEND_LOG), quarterId, stage);',
    tests: ['tests/notice_received_index.test.js']
  },
  {
    id: 'x-review-counts-resend',
    why: '審閱信嘅補寄連正式／重發都當收過——審閱信係另一封信',
    file: 'src/MakeupSend.gs',
    find: '    : [stage];',
    replace: '    : [stage, MAIL_STAGES.RESEND, MAIL_STAGES.OFFICIAL];',
    tests: ['tests/notice_received_index.test.js']
  },
  // ── 第六十五輪批次 AA 組：逐行刪除，有超時風險 ─────────────────────
  {
    id: 'aa-runs-per-row',
    why: '唔合併連續區段，一行一次 deleteRows——現場：2184 行用咗 30 多分鐘',
    file: 'src/Utils.gs',
    find: '    if (last && r === last.start + last.count) last.count++;',
    replace: '    if (false) last.count++;',
    tests: ['tests/delete_rows_in_runs.test.js']
  },
  {
    id: 'aa-runs-top-down',
    why: '由上而下刪區段——刪咗上面一段，下面嗰幾段嘅行號全部移位，刪錯行',
    file: 'src/Utils.gs',
    find: '  for (let i = runs.length - 1; i >= 0; i--) {',
    replace: '  for (let i = 0; i < runs.length; i++) {',
    tests: ['tests/delete_rows_in_runs.test.js']
  },
  {
    id: 'aa-reset-per-row',
    why: '重設季度返返去逐行 deleteRow——撞 Apps Script 時間上限，停喺半途',
    file: 'src/QuarterReset.gs',
    find: '    return deleteSheetRowsInRuns_(sheet, targetRows);',
    replace: '    targetRows.sort(function (a, b) { return b - a; });\n'
      + '    targetRows.forEach(function (r) { sheet.deleteRow(r); });\n'
      + '    return targetRows.length;',
    tests: ['tests/delete_rows_in_runs.test.js']
  },
  // ── 第六十五輪批次 Y 組：改動後重發確認框逐個列出全部未收人 ───────
  {
    id: 'y-notrecv-listed',
    why: '上次冇收到、這一次都唔寄嘅人逐個列出——現場：54 位逐行，要捲好長先見到輸入格',
    file: 'src/WebAppGuards.gs',
    find: '    if (c.arrangementChanged === false) {\n      notReceivedNotSentNames.push',
    replace: '    if (false) {\n      notReceivedNotSentNames.push',
    tests: ['tests/resend_confirm_groups.test.js']
  },
  {
    id: 'y-willsend-from-changed',
    why: '最上面一段列成個「有改動」名單而唔係這一次會寄嘅人——接手人又會藏喺幾十人入面',
    file: 'src/ui/ScriptZone1.html',
    find: '    g.willSend.forEach((c) => list.appendChild(resendConfirmPersonItem(c, false)));',
    replace: '    (plan.changed || []).forEach((c) => list.appendChild(resendConfirmPersonItem(c, false)));',
    tests: ['tests/resend_confirm_groups.test.js']
  },
  {
    id: 'y-no-change-notes',
    why: '冇舊 hash 嘅人唔帶版本比較——接手人淨係見「現在：…」，睇唔出改咗乜',
    file: 'src/WebAppGuards.gs',
    find: '      changeNotes: (c.personId && notes[c.personId]) ? notes[c.personId].slice() : []',
    replace: '      changeNotes: []',
    tests: ['tests/resend_confirm_groups.test.js']
  },
  {
    id: 'y-names-not-collapsed',
    why: '未收人嘅名單攤開——同一個長名單問題返返嚟',
    file: 'src/ui/ScriptZone1.html',
    find: "      const names = make('details', {}, [make('summary', { text: '顯示名單' })]);",
    replace: "      const names = make('div', {}, [make('div', { text: '顯示名單' })]);",
    tests: ['tests/resend_confirm_groups.test.js']
  },
  // ── 第六十五輪批次 Z 組：替補人選永遠揀 PersonID 最細嗰個 ──────────
  {
    id: 'z-rank-by-id-only',
    why: '替補返返去按 PersonID 揀第一個——現場兩次都揀咗同日做主席嘅人去做司事',
    file: 'src/FineTune.gs',
    find: '  const pool = ranking.order;',
    replace: '  const pool = (context.eligibility.byPost[violation.postId] || []).slice().sort();',
    tests: ['tests/replacement_ranking.test.js']
  },
  {
    id: 'z-ignore-same-day',
    why: '唔理同日有冇其他崗位——一人一日兩個崗位',
    file: 'src/FineTune.gs',
    find: '  const busy = function (id) { return sameDay[id] && sameDay[id].length > 0 ? 1 : 0; };',
    replace: '  const busy = function () { return 0; };',
    tests: ['tests/replacement_ranking.test.js']
  },
  {
    id: 'z-ignore-load',
    why: '唔理這一季格數——替補永遠落喺同一批人身上',
    file: 'src/FineTune.gs',
    find: '    const dq = (quarterCount[a] || 0) - (quarterCount[b] || 0);',
    replace: '    const dq = 0;',
    tests: ['tests/replacement_ranking.test.js']
  },
  {
    id: 'z-partner-is-busy',
    why: '主席兼報告嘅拍檔崗位都當「同日有其他崗位」——規則鼓勵嘅配搭被推到最後',
    file: 'src/FineTune.gs',
    find: '    if (partner && s.postId === partner) return;\n',
    replace: '',
    tests: ['tests/replacement_ranking.test.js']
  },
  {
    id: 'z-no-same-day-note',
    why: '揀咗同日有崗位嘅人都唔講——幹事唔知一人一日做兩樣',
    file: 'src/FineTune.gs',
    find: '    const sameDayNote = describeSameDayDuty_(name, sameDayPostIds, context);',
    replace: "    const sameDayNote = '';",
    tests: ['tests/replacement_ranking.test.js']
  },
  {
    id: 'z-save-no-note-call',
    why: '儲存完成畫面唔標「同日亦擔任」——申報帶嚟嘅雙崗位靜靜過咗',
    file: 'src/WebAppSaveConfirm.gs',
    find: '    noteRequestSameDayDuties_(fromRequests, diffs, quarterId, newVersionNo, postNames);\n',
    replace: '',
    tests: ['tests/replacement_ranking.test.js']
  },
  // ── 第六十五輪批次 AB 組：四個細位 ───────────────────────────────
  {
    id: 'ab-api-no-quarter-note',
    why: '後端唔再把 quarterNote 帶去前端——儲存確認畫面唔知嗰筆係按日期認出季度',
    file: 'src/WebAppFlow.gs',
    find: "    quarterNote: r.quarterNote || ''",
    replace: "    quarterNote: ''",
    tests: ['tests/ab_ui_details.test.js']
  },
  {
    id: 'ab-row-no-quarter-note',
    why: '「會自動套用的修改申報」嗰行唔顯示「（QuarterID 空白，按日期判斷為…）」',
    file: 'src/ui/ScriptZone1.html',
    find: "        + (r.quarterNote ? '（' + r.quarterNote + '）' : ''),",
    replace: "        + '',",
    tests: ['tests/ab_ui_details.test.js']
  },
  {
    id: 'ab-step1-stale-count',
    why: '第 1 步「現時有 N 個版本」用返快取——儲存新版本之後唔更新',
    file: 'src/ui/ScriptMainFlow.html',
    find: '      t.versionCount = Number(d.latestVersion.versionNo) + 1;',
    replace: '      t.versionCount = t.versionCount;',
    tests: ['tests/ab_ui_details.test.js']
  },
  {
    id: 'ab-busy-over-result',
    why: '開咗結果窗都等刷新完先收處理中牌——「寄送中」疊住補寄完成窗成分鐘',
    file: 'src/ui/Script.html',
    find: '      if (resultShown) busyHide();',
    replace: '      if (false) busyHide();',
    tests: ['tests/ab_ui_details.test.js']
  },
  // ── 第六十六輪批次 AC 組：個人 PDF 產生失敗唔可以被吞咗 ──────────
  {
    id: 'ac-failed-counted-ok',
    why: '失敗嗰份照計入 generatedCount——自測 S08 報「59／59」而 Drive 淨係 58 個檔',
    file: 'src/PdfBatch.gs',
    find: '    } else if (!outcome.error) {',
    replace: '    } else {',
    tests: ['tests/pdf_failure_not_swallowed.test.js']
  },
  {
    id: 'ac-no-auto-retry',
    why: '一批做完唔再自動試失敗嗰幾份——暫時性匯出錯誤要幹事自己撳',
    file: 'src/PdfBatch.gs',
    find: '  for (let i = 0; i < failedIds.length; i++) {',
    replace: '  for (let i = 0; i < 0; i++) {',
    tests: ['tests/pdf_failure_not_swallowed.test.js']
  },
  {
    id: 'ac-retry-ignored',
    why: '再試成功都當失敗——errors 唔清走、generatedCount 唔加',
    file: 'src/PdfBatch.gs',
    find: '    if (outcome.error) continue;',
    replace: '    continue;',
    tests: ['tests/pdf_failure_not_swallowed.test.js']
  },
  {
    id: 'ac-api-drops-errors',
    why: '全體版 Web API 回傳冇 failedCount／errors——前端同自測機見唔到失敗',
    file: 'src/WebAppZone4.gs',
    find: '    pdfBatchClientFields_(result));',
    replace: '    {});',
    tests: ['tests/pdf_failure_not_swallowed.test.js']
  },
  {
    id: 'ac-makeup-drops-errors',
    why: '補寄用嘅指定人版 API 回傳冇 failedCount／errors',
    file: 'src/WebAppZone4.gs',
    find: '    }, pdfBatchClientFields_(result));',
    replace: '    }, {});',
    tests: ['tests/pdf_failure_not_swallowed.test.js']
  },
  {
    id: 'ac-resend-drops-errors',
    why: '改動後重發嘅 PDF API 回傳冇 failedCount／errors',
    file: 'src/WebAppFlow.gs',
    find: '  }, pdfBatchClientFields_(pdfResult));',
    replace: '  }, {});',
    tests: ['tests/pdf_failure_not_swallowed.test.js']
  },
  {
    id: 'ac-ui-failed-is-done',
    why: '完成窗有失敗都照出「已完成 N / N」綠色——拆走失敗分支',
    file: 'src/ui/ScriptZone1.html',
    find: '    if (failed.length > 0) {\n      const names',
    replace: '    if (false) {\n      const names',
    tests: ['tests/pdf_batch_tally_ui.test.js']
  },
  {
    id: 'ac-resend-sends-anyway',
    why: '改動後重發：PDF 有失敗都照寄——寄出去嗰幾位 ERROR_PDF_MISSING 而完成窗唔講',
    file: 'src/ui/ScriptZone1.html',
    find: "    if (pdfOutcome.kind === 'FAILED') {",
    replace: '    if (false) {',
    tests: ['tests/pdf_batch_tally_ui.test.js']
  },
  {
    id: 'ac-selftest-green',
    why: '自測 S08 有失敗都報綠——紅燈跑去下游 S09，S10／S11 被擋住',
    file: 'src/SelfTestRunner.gs',
    find: '  if (failedCount > 0) {',
    replace: '  if (false) {',
    tests: ['tests/pdf_failure_not_swallowed.test.js']
  },
  // ── 第六十六輪批次 AD 組：「先產生 PDF」完成窗報整次操作嘅累計 ────
  {
    id: 'ad-total-last-only',
    why: '開頭人數取最後一次回傳——補寄 48 位分三輪，完成窗寫「8 / 8」',
    file: 'src/ui/ScriptZone1.html',
    find: '    if (tally.total === null) tally.total = Number(res.totalPeople) || 0;',
    replace: '    tally.total = Number(res.totalPeople) || 0;',
    tests: ['tests/pdf_batch_tally_ui.test.js']
  },
  {
    id: 'ad-generated-last-only',
    why: '新產生份數唔累加（取最後一次）——完成窗「新產生 8 份」',
    file: 'src/ui/ScriptZone1.html',
    find: '    tally.generated += Number(res.callGeneratedCount !== undefined\n      ? res.callGeneratedCount : res.generatedCount) || 0;',
    replace: '    tally.generated = Number(res.generatedCount) || 0;',
    tests: ['tests/pdf_batch_tally_ui.test.js']
  },
  {
    id: 'ad-call-not-delta',
    why: '後端交出嘅「呢一次增量」其實係累計——前端累加就會多算',
    file: 'src/PdfBatch.gs',
    find: '    callGeneratedCount: (progress.generatedCount || 0) - before.generated,',
    replace: '    callGeneratedCount: progress.generatedCount || 0,',
    tests: ['tests/pdf_failure_not_swallowed.test.js']
  },
  // ── 第六十六輪批次 AE 組：重發確認框兩個數字要一致 ────────────
  {
    id: 'ae-no-kind-tag',
    why: '確認框每人旁邊唔標「安排改了」／「上次沒有收到」',
    file: 'src/ui/ScriptZone1.html',
    find: "    if (kind) head.appendChild(make('span', { text: kind, className: 'tag' }));",
    replace: '    if (false) head.appendChild(null);',
    tests: ['tests/resend_confirm_kind_tags.test.js']
  },
  {
    id: 'ae-kind-not-listed',
    why: '「上次沒有收到」嘅人唔計入段首句（又變返 1 同 2 對唔上）',
    file: 'src/ui/ScriptZone1.html',
    find: "      else if (k === '上次沒有收到') out.notReceived++;",
    replace: '      else if (k === "x") out.notReceived++;',
    tests: ['tests/resend_confirm_kind_tags.test.js']
  },
  // ── 第六十七輪批次 AK 組：未獲授權頁面只講中性句子 ────────────
  {
    id: 'ak-disabled-old-text',
    why: '停用頁又提 Config／WEBAPP_ENABLED——義工見到內部設定名稱',
    file: 'src/WebApp.gs',
    find: '    return renderWebAppDisabledPage_();',
    replace: "    return HtmlService.createHtmlOutput('<p>請在 Config 工作表把 WEBAPP_ENABLED 設為 TRUE</p>').setTitle('x');",
    tests: ['tests/webapp_neutral_pages.test.js']
  },
  {
    id: 'ak-forbidden-old-text',
    why: '無權限頁又叫人「在 Config 工作表加入你的電郵」',
    file: 'src/WebApp.gs',
    find: '    return renderWebAppForbiddenPage_();',
    replace: "    return HtmlService.createHtmlOutput('<p>請聯絡管理員在 Config 工作表加入你的電郵</p>').setTitle('x');",
    tests: ['tests/webapp_neutral_pages.test.js']
  },
  {
    id: 'ak-no-current-email',
    why: '已登入嘅幹事見唔到「（目前登入：…）」——用錯帳戶都唔知',
    file: 'src/WebApp.gs',
    find: "      + (escaped ? '<p>（目前登入：' + escaped + '）</p>' : '')",
    replace: "      + ''",
    tests: ['tests/webapp_neutral_pages.test.js']
  },
  // ── 第六十七輪批次 AG 組：放行整季記住 ──────────────────────────
  {
    id: 'ag-mainflow-no-log',
    why: '主流程放行唔寫機器可讀紀錄（拆走第 1 點）——每次儲存都要重新打字',
    file: 'src/WebAppSaveConfirm.gs',
    find: "      logHardViolationRelease_(quarterId, 'apiSaveAndConfirmExecute（儲存：勾選保留）',\n        plan.violations.kept, created.versionNo);",
    replace: '      void 0;',
    tests: ['tests/hard_release_remembered.test.js']
  },
  {
    id: 'ag-no-version-line',
    why: '放行紀錄唔寫版本——畫面講唔出「第 X 版放行」',
    file: 'src/FourStageFlow.gs',
    find: "        ? '' : '\\n' + HARD_RELEASE_VERSION_PREFIX + Number(versionNo))",
    replace: "        ? '' : '')",
    tests: ['tests/hard_release_remembered.test.js']
  },
  {
    id: 'ag-legacy-ignored',
    why: '唔認主流程舊格式放行紀錄——第五十三至六十六輪放行過嘅全部要重新打字',
    file: 'src/HardViolationClass.gs',
    find: '  const mainFlowLegacy = readMainFlowLegacyReleasedInfo_(auditRows, quarterId);',
    replace: '  const mainFlowLegacy = {};',
    tests: ['tests/hard_release_remembered.test.js']
  },
  {
    id: 'ag-legacy-no-person',
    why: '舊格式紀錄唔用紀錄上嗰一版核對、改用最新版——指向舊版本嗰格另一個人都當已放行',
    file: 'src/HardViolationClass.gs',
    find: "      const personId = personByVersionCell[versionNo + '|' + m[1] + '|' + m[2] + '|' + m[3]];",
    replace: "      const personId = personByVersionCell[findLatestVersionNo(quarterId) + '|' + m[1] + '|' + m[2] + '|' + m[3]];",
    tests: ['tests/hard_release_remembered.test.js']
  },
  {
    id: 'ag-suggest-releasd-off',
    why: '「請系統幫我調整」唔認已放行——建議改走幹事放行咗嘅格',
    file: 'src/SuggestionSheet.gs',
    find: '    const releasedItem = isReleased(violation);',
    replace: '    const releasedItem = null;',
    tests: ['tests/hard_release_remembered.test.js']
  },
  {
    id: 'ag-api-no-released',
    why: '回前端嗰陣唔帶 released——畫面照畫勾選框',
    file: 'src/SuggestionSheet.gs',
    find: '        released: u.released === true,',
    replace: '        released: false,',
    tests: ['tests/hard_release_remembered.test.js']
  },
  {
    id: 'ag-ui-released-cb',
    why: '結果窗已放行嘅格照畫勾選框、冇「已放行」標籤',
    file: 'src/ui/ScriptSuggestion.html',
    find: "            + (u.released ? ('（已放行'",
    replace: "            + (false ? ('（已放行'",
    tests: ['tests/hard_release_remembered.test.js']
  },
  // ── 第六十七輪批次 AH 組：寄出前講空格 ──────────────────────────
  {
    id: 'ah-blank-not-counted',
    why: '寄出前唔數空格——義工收到有空格嘅表而幹事冇被提醒',
    file: 'src/SendWarnings.gs',
    find: '    const blanks = listGenuineBlankCells_(state, context).map(function (b) {',
    replace: '    const blanks = [].map(function (b) {',
    tests: ['tests/hard_release_remembered.test.js']
  },
  {
    id: 'ah-step2-no-warn',
    why: '寄審閱確認框冇空格／已放行資料',
    file: 'src/FiveStageCore.gs',
    find: "    alreadySentCount: countAlreadySentForStage_(quarterId, versionNo, MAIL_STAGES.REVIEW),\n    // 第六十七輪批次 AG／AH 組：空格同已放行嘅違反（三個寄出確認框同一支）\n    sendWarnings: summariseVersionSendWarnings_(quarterId, versionNo)",
    replace: "    alreadySentCount: countAlreadySentForStage_(quarterId, versionNo, MAIL_STAGES.REVIEW),\n    sendWarnings: { blank: { count: 0, items: [], moreCount: 0 }, released: { count: 0, items: [], moreCount: 0 }, error: '' }",
    tests: ['tests/hard_release_remembered.test.js']
  },
  {
    id: 'ah-step4-no-warn',
    why: '正式發出確認框冇空格／已放行資料',
    file: 'src/FiveStageCore.gs',
    find: "    alreadySentCount: countAlreadySentForStage_(quarterId, versionNo, MAIL_STAGES.OFFICIAL),\n    // 第六十七輪批次 AG／AH 組\n    sendWarnings: summariseVersionSendWarnings_(quarterId, versionNo)",
    replace: "    alreadySentCount: countAlreadySentForStage_(quarterId, versionNo, MAIL_STAGES.OFFICIAL),\n    sendWarnings: { blank: { count: 0, items: [], moreCount: 0 }, released: { count: 0, items: [], moreCount: 0 }, error: '' }",
    tests: ['tests/hard_release_remembered.test.js']
  },
  {
    id: 'ah-step5-no-warn',
    why: '改動後重發確認框冇空格／已放行資料',
    file: 'src/WebAppFlow.gs',
    find: '    sendWarnings: summariseVersionSendWarnings_(quarterId, changedPlan.versionNo)',
    replace: "    sendWarnings: { blank: { count: 0, items: [], moreCount: 0 }, released: { count: 0, items: [], moreCount: 0 }, error: '' }",
    tests: ['tests/hard_release_remembered.test.js']
  },
  {
    id: 'ah-dashboard-no-warn',
    why: '狀態卡冇空格／已放行資料',
    file: 'src/WebAppDashboard.gs',
    find: '    sendWarnings: versionExists ? summariseVersionSendWarnings_(quarterId, versionNo)',
    replace: '    sendWarnings: !versionExists ? summariseVersionSendWarnings_(quarterId, versionNo)',
    tests: ['tests/hard_release_remembered.test.js']
  },
  {
    id: 'ah-ui-no-blank-head',
    why: '畫面唔講「這一版還有 N 格沒有人」',
    file: 'src/ui/Script.html',
    find: "          text: '⚠ 這一版還有 ' + blank.count + ' 格沒有人，收到的人會見到空格。',",
    replace: "          text: '',",
    tests: ['tests/hard_release_remembered.test.js']
  },
  {
    id: 'ah-ui-no-released-head',
    why: '畫面唔講「這一季有 N 格是你放行的違反規則安排」',
    file: 'src/ui/Script.html',
    find: "          text: '這一季有 ' + released.count + ' 格是你放行的違反規則安排。',",
    replace: "          text: '',",
    tests: ['tests/hard_release_remembered.test.js']
  },
  {
    id: 'ah-review-box-no-call',
    why: '寄審閱確認框唔叫共用函式——三個框各自一套',
    file: 'src/ui/ScriptZone1.html',
    find: "      if (preview.contents) nodes.push(sendContentsBox(preview.contents));\n      // 第六十七輪批次 AG／AH 組：空格同已放行（三個確認框同一支）\n      buildSendWarningNodes(preview.sendWarnings).forEach((n) => nodes.push(n));",
    replace: '      if (preview.contents) nodes.push(sendContentsBox(preview.contents));',
    tests: ['tests/hard_release_remembered.test.js']
  },
  {
    id: 'ah-resend-box-no-call',
    why: '改動後重發確認框唔叫共用函式',
    file: 'src/ui/ScriptZone1.html',
    find: "    // 第六十七輪批次 AG／AH 組：空格同已放行（三個確認框同一支）\n    buildSendWarningNodes(plan.sendWarnings).forEach((n) => nodes.push(n));\n",
    replace: '',
    tests: ['tests/hard_release_remembered.test.js']
  },
  // ── 第六十七輪批次 AI 組：改完名單要知道哪幾格要重排 ────────────
  {
    id: 'ai-batch-no-impact',
    why: '名單維護儲存完唔算受影響格——幹事唔知要重排',
    file: 'src/WebAppEligibility.gs',
    find: '    eligibilityImpact: q ? summariseEligibilityImpact_(q) : null };\n}',
    replace: '    eligibilityImpact: null };\n}',
    tests: ['tests/eligibility_impact.test.js']
  },
  {
    id: 'ai-wrong-rule',
    why: '只睇錯咗嘅規則——永遠 0 格',
    file: 'src/SendWarnings.gs',
    find: '      return v.ruleId === RULE_IDS.ELIGIBILITY;',
    replace: '      return v.ruleId !== RULE_IDS.ELIGIBILITY;',
    tests: ['tests/eligibility_impact.test.js']
  },
  {
    id: 'ai-apply-no-impact',
    why: '開季前第 0 步套用名單唔帶受影響格',
    file: 'src/EligibilitySheetEditor.gs',
    find: '    eligibilityImpact: summariseEligibilityImpact_(quarterId),',
    replace: "    eligibilityImpact: { versionNo: -1, count: 0, items: [], moreCount: 0, error: '' },",
    tests: ['tests/eligibility_impact.test.js']
  },
  {
    id: 'ai-dashboard-no-impact',
    why: '狀態卡／第 2 步唔帶受影響格——兩個數字對唔上',
    file: 'src/WebAppDashboard.gs',
    find: '    eligibilityImpact: versionExists ? summariseEligibilityImpact_(quarterId)',
    replace: '    eligibilityImpact: !versionExists ? summariseEligibilityImpact_(quarterId)',
    tests: ['tests/eligibility_impact.test.js']
  },
  {
    id: 'ai-ui-no-head',
    why: '畫面唔講「名單改了之後，這一版有 N 格的人已經不在該崗位的名單上」',
    file: 'src/ui/Script.html',
    find: "            ? ('名單改了之後，這一版有 ' + impact.count + ' 格的人已經不在該崗位的名單上。')",
    replace: "            ? ('')",
    tests: ['tests/eligibility_impact.test.js']
  },
  {
    id: 'ai-ui-no-button',
    why: '結果窗冇〔請系統幫我調整〕出口',
    file: 'src/ui/Script.html',
    find: "      if (withButton) {\n        box.appendChild(make('div', { className: 'row' }, [\n          button('請系統幫我調整', () => { closeModal(); openBuildSuggestion(); }, '')\n        ]));\n      }",
    replace: '',
    tests: ['tests/eligibility_impact.test.js']
  },
  {
    id: 'ai-zone3-no-quarter',
    why: '名單維護儲存唔傳季度——後端算唔到、結果窗永遠唔出',
    file: 'src/ui/ScriptZone3.html',
    find: "          const res = await callServerMutating('apiSaveEligibilityBatch', changes, currentQuarterId);",
    replace: "          const res = await callServerMutating('apiSaveEligibilityBatch', changes);",
    tests: ['tests/eligibility_impact.test.js']
  },
  // ── 第六十七輪批次 AJ 組：可編輯副本＋系統出問題時怎樣做 ──────────
  {
    id: 'aj-name-no-version',
    why: '副本檔名漏版本號——幹事分唔出邊一份係邊一版',
    file: 'src/EditableCopy.gs',
    find: "  return String(quarterId).trim() + '_第' + Number(versionNo) + '版_' + EDITABLE_COPY_FILE_LABEL",
    replace: "  return String(quarterId).trim() + '_' + EDITABLE_COPY_FILE_LABEL",
    tests: ['tests/editable_copy.test.js']
  },
  {
    id: 'aj-copy-not-moved',
    why: '副本留喺 My Drive 根，唔搬入 Shared Drive 嘅 <季度>/可編輯副本/',
    file: 'src/EditableCopy.gs',
    find: '  file.moveTo(folder);\n',
    replace: '',
    tests: ['tests/editable_copy.test.js']
  },
  {
    id: 'aj-rename-original',
    why: '改名改咗原表而唔係副本——原表一格都唔准動',
    file: 'src/EditableCopy.gs',
    find: '  copied.setName(sheetName);',
    replace: '  sheet.setName(sheetName + \'_副本\');',
    tests: ['tests/editable_copy.test.js']
  },
  {
    id: 'aj-blank-sheet-kept',
    why: '新檔留住自帶嘅空白第一張——幹事開檔第一眼係空表',
    file: 'src/EditableCopy.gs',
    find: '    if (s.getSheetId() !== copied.getSheetId()) copy.deleteSheet(s);',
    replace: '    if (false) copy.deleteSheet(s);',
    tests: ['tests/editable_copy.test.js']
  },
  {
    id: 'aj-autocopy-rethrows',
    why: '自動副本失敗令整次正式發出拋錯——信已經寄咗出去',
    file: 'src/EditableCopy.gs',
    find: "    log_('WARN', '正式發出之後自動建立可編輯副本失敗（' + quarterId + ' v' + versionNo + '）：' + err.message);",
    replace: '    throw err;',
    tests: ['tests/editable_copy.test.js']
  },
  {
    id: 'aj-no-autocopy',
    why: '正式發出之後唔自動做副本',
    file: 'src/FiveStageCore.gs',
    find: '    result.editableCopy = tryCreateEditableCopyAfterSend_(quarterId, versionNo);\n',
    replace: '',
    tests: ['tests/editable_copy.test.js']
  },
  {
    id: 'aj-api-drops-copy',
    why: '前端收唔到自動副本結果——完成窗一句都冇',
    file: 'src/WebAppFlow.gs',
    find: '    editableCopy: result.editableCopy || null',
    replace: '    editableCopy: null',
    tests: ['tests/editable_copy.test.js']
  },
  {
    id: 'aj-links-create-dir',
    why: '「系統出問題時怎樣做」唔應該建資料夾（唯讀）',
    file: 'src/EditableCopy.gs',
    find: "  const quarterFolders = root.getFoldersByName(q);\n  const quarterFolder = quarterFolders.hasNext() ? quarterFolders.next() : null;",
    replace: '  const quarterFolder = findOrCreateChildFolder_(root, q);',
    tests: ['tests/editable_copy.test.js']
  },
  {
    id: 'aj-links-oldest-copy',
    why: '可編輯副本連結揀咗最舊一份',
    file: 'src/EditableCopy.gs',
    // 第七十輪批次 AW 組：改成按建立時間揀之後，同一建立時間先比版本號——呢度整壞嗰一步
    find: '      if (ev > bv) best = e;',
    replace: '      if (ev < bv) best = e;',
    tests: ['tests/editable_copy.test.js']
  },
  {
    id: 'aj-ui-no-copy-line',
    why: '正式發出完成窗唔講自動副本',
    file: 'src/ui/ScriptZone1.html',
    find: "    if (r.editableCopy && r.editableCopy.ok) {",
    replace: "    if (false) {",
    tests: ['tests/editable_copy.test.js']
  },
  // ── 第六十七輪批次 AF 組：匯入人手編好嘅職事表 ─────────────────
  {
    id: 'af-unresolved-no-block',
    why: '認唔出嘅名字唔擋——嗰格靜靜變成空白',
    file: 'src/RosterImport.gs',
    find: '    blocked: unresolved.length > 0,',
    replace: '    blocked: false,',
    tests: ['tests/roster_import.test.js']
  },
  {
    id: 'af-basis-not-import',
    why: '匯入嘅版本 Basis 寫錯做 FINE_TUNE——狀態卡講唔出係匯入',
    file: 'src/RosterImport.gs',
    find: '  registerVersion(q, versionNo, sheetName, VERSION_VALUES.BASIS_IMPORT,',
    replace: '  registerVersion(q, versionNo, sheetName, VERSION_VALUES.BASIS_FINE_TUNE,',
    tests: ['tests/roster_import.test.js']
  },
  {
    id: 'af-ext-not-received',
    why: 'EXTERNAL 唔算「收過」——補寄會把全體再寄一次',
    file: 'src/MakeupSend.gs',
    find: "  MAIL_STATUS.SENT, MAIL_STATUS.DRY_RUN, MAIL_STATUS.SKIPPED_UNCHANGED,\n  // 第六十七輪批次 AF 組：匯入時聲明「已在系統外寄給全體」——收過\n  MAIL_STATUS.EXTERNAL\n",
    replace: '  MAIL_STATUS.SENT, MAIL_STATUS.DRY_RUN, MAIL_STATUS.SKIPPED_UNCHANGED\n',
    tests: ['tests/roster_import.test.js']
  },
  {
    id: 'af-ext-not-baseline',
    why: 'EXTERNAL 唔係步驟 5 嘅比對基準——改 1 格會寄給全體',
    file: 'src/Constants.gs',
    find: '  MAIL_STATUS.SKIPPED_UNCHANGED,\n  MAIL_STATUS.EXTERNAL\n];',
    replace: '  MAIL_STATUS.SKIPPED_UNCHANGED\n];',
    tests: ['tests/roster_import.test.js']
  },
  {
    id: 'af-no-release-log',
    why: '匯入放行唔寫 AG 組格式紀錄——之後儲存又要打字',
    file: 'src/RosterImport.gs',
    find: "    logHardViolationRelease_(q, 'apiImportRosterExecute（匯入人手編好的職事表）', plan.violations.real, versionNo);",
    replace: '    void 0;',
    tests: ['tests/roster_import.test.js']
  },
  {
    id: 'af-na-not-grey',
    why: '特別主日跳過嘅格唔標灰「—」——幹事會照填',
    file: 'src/RosterImport.gs',
    find: "        return layout.naByKey[cellKey_(d.serviceDate, r.postId, r.slotIndex)] ? IMPORT_NA_MARK : '';",
    replace: "        return '';",
    tests: ['tests/roster_import.test.js']
  },
  {
    id: 'af-slots-ignored',
    why: '範本唔理崗位位置數——司事 2 個位置只得 1 行',
    file: 'src/RosterImport.gs',
    find: '    for (let slot = 1; slot <= (post.slotCount || 1); slot++) {',
    replace: '    for (let slot = 1; slot <= 1; slot++) {',
    tests: ['tests/roster_import.test.js']
  },
  {
    id: 'af-not-manual',
    why: '匯入嘅格唔標 MANUAL——之後系統調整會當佢哋係自己排嘅而改走',
    file: 'src/RosterImport.gs',
    find: "        assignSource: ASSIGN_SOURCE.MANUAL, ruleFlags: flags\n      }));",
    replace: "        assignSource: ASSIGN_SOURCE.AUTO, ruleFlags: flags\n      }));",
    tests: ['tests/roster_import.test.js']
  },
  {
    id: 'af-no-typed-confirm',
    why: '唔使打字就匯入——一撳就多一個版本',
    file: 'src/RosterImport.gs',
    find: '  if (typed !== plan.confirmText) {',
    replace: '  if (false) {',
    tests: ['tests/roster_import.test.js']
  },
  {
    id: 'af-ext-no-stage',
    why: '聲明已寄出但 Stage 唔推到 OFFICIAL_SENT——步驟 5 用唔到',
    file: 'src/RosterImport.gs',
    find: "    setQuarterStage_(q, QUARTER_STAGE.OFFICIAL_SENT, '匯入人手編好的職事表：幹事聲明已在系統外寄給全體');\n    stage = QUARTER_STAGE.OFFICIAL_SENT;",
    replace: '    stage = QUARTER_STAGE.OFFICIAL_SENT;',
    tests: ['tests/roster_import.test.js']
  },
  {
    id: 'af-ui-no-entry',
    why: '區四冇「檢查並匯入」入口',
    file: 'src/ui/ScriptZone4.html',
    find: "      zone4Row('檢查並匯入',",
    replace: "      zone4Row('檢查並匯入（停用）',",
    tests: ['tests/roster_import.test.js']
  },
  {
    id: 'al-list-no-external',
    why: '匯入選「已在系統外寄出」只記人、唔記名單收件人——補寄預覽照列辦公室等',
    file: 'src/RosterImport.gs',
    find: '    .filter(function (r) { return r.type === RECIPIENT_TYPE.LIST && r.email; })',
    replace: '    .filter(function () { return false; })',
    tests: ['tests/roster_import.test.js']
  },
  {
    id: 'al-list-wrong-key',
    why: '名單收件人 EXTERNAL 行冇寫 Email 鍵——buildSendStatusByRecipient_ 對唔上',
    file: 'src/RosterImport.gs',
    find: "        personId: '',\n        email: r.email,\n        displayName: r.displayName || r.email,",
    replace: "        personId: '',\n        email: '',\n        displayName: r.displayName || r.email,",
    tests: ['tests/roster_import.test.js']
  },
  {
    id: 'am-counts-released',
    why: '已放行嘅格照計入「不在名單上」提示——幹事明知而放行嘅格又被提示一次',
    file: 'src/SendWarnings.gs',
    find: '      if (releasedKeys[key]) return;\n',
    replace: '',
    tests: ['tests/eligibility_impact.test.js']
  },
  {
    id: 'am-ui-assumes-edit',
    why: '狀態卡／第 2 步又假設「名單改了之後」——匯入放行嘅格都被講成名單改動',
    file: 'src/ui/Script.html',
    find: '          text: withButton\n            ? (\'名單改了之後，這一版有 \' + impact.count + \' 格的人已經不在該崗位的名單上。\')\n            : (\'這一版有 \' + impact.count + \' 格的人不在該崗位的名單上（你已放行的不計在內）。\'),',
    replace: '          text: (\'名單改了之後，這一版有 \' + impact.count + \' 格的人已經不在該崗位的名單上。\'),',
    tests: ['tests/eligibility_impact.test.js']
  },
  {
    id: 'am-ui-saved-no-lead',
    why: '剛儲存完名單嘅結果窗唔再講「名單改了之後」',
    file: 'src/ui/Script.html',
    find: '          text: withButton\n            ? (\'名單改了之後，這一版有 \' + impact.count + \' 格的人已經不在該崗位的名單上。\')',
    replace: '          text: withButton\n            ? (\'這一版有 \' + impact.count + \' 格的人已經不在該崗位的名單上。\')',
    tests: ['tests/eligibility_impact.test.js']
  },
  {
    id: 'an-na-keeps-dropdown',
    why: '匯入表灰格仍然套下拉驗證——每格出「不在清單內」紅色小三角',
    file: 'src/RosterImport.gs',
    find: '            sheet.getRange(rowNo, IMPORT_LABEL_COLUMNS + 1 + j).clearDataValidations();',
    replace: '            void 0;',
    tests: ['tests/roster_import.test.js']
  },
  {
    id: 'an-clears-whole-row',
    why: '清灰格驗證時把整行嘅驗證都清走——普通格冇下拉',
    file: 'src/RosterImport.gs',
    find: '            sheet.getRange(rowNo, IMPORT_LABEL_COLUMNS + 1 + j).clearDataValidations();',
    replace: '            sheet.getRange(rowNo, IMPORT_LABEL_COLUMNS + 1, 1, dateCount).clearDataValidations();',
    tests: ['tests/roster_import.test.js']
  },
  {
    id: 'ao-legend-auto-text',
    why: '圖例第一行又話「系統自動安排」——匯入（人手編好）嘅版本都被講成系統排嘅',
    file: 'src/RosterWriter.gs',
    find: '    [\'（姓名）\', \'已排定人選\', countText(GRID_CELL_CLASS.ASSIGNED)],',
    replace: '    [\'（姓名）\', \'系統自動安排，已排定人選\', countText(GRID_CELL_CLASS.ASSIGNED)],',
    tests: ['tests/grid_cell_presentation.test.js']
  },
  {
    id: 'ap-ui-old-entry-name',
    why: '「系統出問題」彈窗指引仍叫「匯入人手職事表」——同實際入口名稱對唔上',
    file: 'src/ui/ScriptZone4.html',
    find: '用「進階與診斷 ▸ 匯入人手編好的職事表」把副本讀回系統',
    replace: '用「進階與診斷 ▸ 匯入人手職事表」把副本讀回系統',
    tests: ['tests/roster_import.test.js']
  },
  {
    id: 'ap-lock-old-name',
    why: '匯入嘅鎖標籤（撞鎖時畫面會顯示）仍叫舊名稱',
    file: 'src/RosterImport.gs',
    find: '  return withMutationLock_(\'匯入人手編好的職事表\', function () {',
    replace: '  return withMutationLock_(\'匯入人手職事表\', function () {',
    tests: ['tests/roster_import.test.js']
  },
  {
    id: 'aq-remain-has-released',
    why: '「系統改完之後仍然違反」又把已放行嘅格計入——同「已放行」段重複列出',
    file: 'src/SuggestionSheet.gs',
    find: "      return !releasedCellKeys[k] && !keptKeys[k];",
    replace: "      return !keptKeys[k];",
    tests: ['tests/hard_release_remembered.test.js']
  },
  {
    id: 'ar-released-no-version',
    why: '儲存確認畫面已放行分組唔寫「（第 N 版放行）」',
    file: 'src/ui/Script.html',
    find: '          ? \'\' : \'（第 \' + x.releasedVersionNo + \' 版放行）\'),',
    replace: '          ? \'\' : \'\'),',
    tests: ['tests/hard_release_remembered.test.js']
  },
  {
    id: 'ar-legacy-writes-null',
    why: '舊格式紀錄（冇版本號）都寫「第 null 版放行」',
    file: 'src/ui/Script.html',
    find: '        text: describe(x) + ((x.releasedVersionNo === null || x.releasedVersionNo === undefined)\n          ? \'\' :',
    replace: '        text: describe(x) + (false\n          ? \'\' :',
    tests: ['tests/hard_release_remembered.test.js']
  },
  {
    id: 'at-no-fixed-group',
    why: '「選擇收件人」冇「辦公室等固定收件人」呢一組',
    file: 'src/SendRecipients.gs',
    find: '  { key: SEND_SOURCE.FIXED, label: \'辦公室等固定收件人\' },\n',
    replace: '',
    tests: ['tests/send_fixed_recipients.test.js']
  },
  {
    id: 'at-fixed-wrong-stage',
    why: '固定收件人唔跟階段，永遠用正式發出嗰份名單',
    file: 'src/SendRecipients.gs',
    find: '  listRecipients_(stage, context).forEach(function (r) {\n    if (r.type !== RECIPIENT_TYPE.LIST) return;',
    replace: '  listRecipients_(MAIL_STAGES.OFFICIAL, context).forEach(function (r) {\n    if (r.type !== RECIPIENT_TYPE.LIST) return;',
    tests: ['tests/send_fixed_recipients.test.js']
  },
  {
    id: 'at-api-ignores-kind',
    why: '後端唔理前端傳嚟嘅階段',
    file: 'src/WebAppSendPlan.gs',
    find: "  const poolStage = sendKindToStage_(kind) || MAIL_STAGES.OFFICIAL;",
    replace: "  const poolStage = MAIL_STAGES.OFFICIAL;",
    tests: ['tests/send_fixed_recipients.test.js']
  },
  {
    id: 'at-members-unmasked',
    why: '固定收件人嗰組列出完整電郵（冇遮蔽）',
    file: 'src/WebAppSendPlan.gs',
    find: 'emailMasked: maskEmailForPreview_(m.email) };',
    replace: 'emailMasked: m.email };',
    tests: ['tests/send_fixed_recipients.test.js']
  },
  {
    id: 'at-ui-default-dropped',
    why: '前端收到預設勾嘅人但唔加入 pickedKeys',
    file: 'src/ui/ScriptSendPaper.html',
    find: '        (r.defaultPickedKeys || []).forEach((k) => { picked[k] = true; });\n',
    replace: '',
    tests: ['tests/send_fixed_recipients.test.js']
  },
  {
    id: 'at-ui-default-reapply',
    why: '幹事取消咗之後再開窗，預設又被加返',
    file: 'src/ui/ScriptSendPaper.html',
    find: '      if (!sendOptions_.defaultPickedApplied) {',
    replace: '      if (true) {',
    tests: ['tests/send_fixed_recipients.test.js']
  },
  {
    id: 'at-ui-no-kind',
    why: '前端攞池唔傳階段',
    file: 'src/ui/ScriptSendPaper.html',
    find: 'callServer(\'apiGetSendRecipientPool\', currentQuarterId, s.kind);',
    replace: 'callServer(\'apiGetSendRecipientPool\', currentQuarterId);',
    tests: ['tests/send_fixed_recipients.test.js']
  },
  {
    id: 'au-batch-not-latest',
    why: '最近一批揀錯（揀最早一批，唔係最近一次審閱）',
    file: 'src/SendRecipients.gs',
    find: '    if (bestSort === null || b.sortKey >= bestSort) { bestSort = b.sortKey; bestKey = key; }',
    replace: '    if (bestSort === null) { bestSort = b.sortKey; bestKey = key; }',
    tests: ['tests/review_same_batch.test.js']
  },
  {
    id: 'au-batch-all-statuses',
    why: '失敗／略過嘅都當成「收過」',
    file: 'src/SendRecipients.gs',
    find: '    if (status !== MAIL_STATUS.SENT && status !== MAIL_STATUS.DRY_RUN) return;',
    replace: '    if (!status) return;',
    tests: ['tests/review_same_batch.test.js']
  },
  {
    id: 'au-batch-any-stage',
    why: '連正式發出都當成審閱批次',
    file: 'src/SendRecipients.gs',
    find: '    if (String(row[C.STAGE] || \'\').trim() !== MAIL_STAGES.REVIEW) return;',
    replace: '    if (!String(row[C.STAGE] || \'\').trim()) return;',
    tests: ['tests/review_same_batch.test.js']
  },
  {
    id: 'au-api-drop-silent',
    why: '已唔喺池嘅人靜靜略過，唔點數',
    file: 'src/WebAppSendPlan.gs',
    find: '      if (inPool[personId]) pickedKeys.push(personId); else droppedCount++;',
    replace: '      if (inPool[personId]) pickedKeys.push(personId);',
    tests: ['tests/review_same_batch.test.js']
  },
  {
    id: 'au-api-extra-lost',
    why: '上次自己輸入嘅地址丟咗',
    file: 'src/WebAppSendPlan.gs',
    find: '      else extraEmails.push(email);',
    replace: '      else droppedCount += 0;',
    tests: ['tests/review_same_batch.test.js']
  },
  {
    id: 'au-ui-button-default',
    why: '〔改為再寄一次審閱本〕又叫返冇參數嘅 openReview()',
    file: 'src/ui/ScriptSendPaper.html',
    find: 'closeModal(); openReviewSameBatch(); }, \'secondary\'));',
    replace: 'closeModal(); openReview(); }, \'secondary\'));',
    tests: ['tests/review_same_batch.test.js']
  },
  {
    id: 'au-ui-sentence-fixed',
    why: '句子又寫死「同一批人」（讀唔到上一批都照寫）',
    file: 'src/ui/ScriptZone1.html',
    find: '    if (meta && meta.lookupFailed) {\n      return \'查不到上一次的收件人，這一次會寄給預設的審閱名單。\';\n    }',
    replace: '    if (meta && meta.lookupFailed) {\n      return \'上次在 \' + last + \' 寄過，會再寄一次給同一批人。\';\n    }',
    tests: ['tests/review_same_batch.test.js']
  },
  {
    id: 'au-dash-text-fixed',
    why: '儀表板文字又寫死「重新寄給同一批人」',
    file: 'src/WebAppDashboard.gs',
    find: '      ? (\'上次在 \' + last + \' 寄過（\' + batch.count + \' 位）。\' + defaultText)',
    replace: '      ? (\'上次在 \' + last + \' 寄過。再撳一次會重新寄給同一批人。\')',
    tests: ['tests/review_same_batch.test.js', 'tests/webapp_dashboard_state.test.js']
  },
  {
    id: 'av-note-has-code',
    why: '批註又寫返規則代號（會印到義工 PDF 腳註）',
    file: 'src/RosterWriter.gs',
    find: '      notes[r][c] = cellWarnings.map(function (w) {\n        return w.reason;',
    replace: '      notes[r][c] = cellWarnings.map(function (w) {\n        return w.ruleId + \': \' + w.reason;',
    tests: ['tests/no_rule_code_on_screen.test.js']
  },
  {
    id: 'av-pdf-shownotes',
    why: 'PDF 匯出網址冇 shownotes=false',
    file: 'src/PdfExport.gs',
    find: '    \'shownotes=false\',\n',
    replace: '',
    tests: ['tests/no_rule_code_on_screen.test.js']
  },
  {
    id: 'av-pdf-printnotes',
    why: 'PDF 匯出網址冇 printnotes=false',
    file: 'src/PdfExport.gs',
    find: '    \'printnotes=false\',\n',
    replace: '',
    tests: ['tests/no_rule_code_on_screen.test.js']
  },
  {
    id: 'av-ui-unknown-code',
    why: '對唔上嘅規則代號又直接印英文代號',
    file: 'src/ui/Script.html',
    find: '    return RULE_SENTENCE[ruleId] || \'這一格有一條排表規則沒有符合\';',
    replace: '    return RULE_SENTENCE[ruleId] || ruleId;',
    tests: ['tests/no_rule_code_on_screen.test.js']
  },
  {
    id: 'av-zone4-rule-code',
    why: '匯入規則審閱表又印規則代號',
    file: 'src/ui/ScriptZone4.html',
    find: '          text: h.ruleText + \'　堂委：\' + h.decision',
    replace: '          text: h.ruleId + \'　\' + h.ruleText + \'　堂委：\' + h.decision',
    tests: ['tests/no_rule_code_on_screen.test.js']
  },
  {
    id: 'av-menu-report-code',
    why: '選單違反報告又印規則代號',
    file: 'src/FourStageFlow.gs',
    find: '      + \'　\' + v.personName + \'　\' + v.reason;',
    replace: '      + \'　\' + v.personName + \'　\' + v.ruleId + \'：\' + v.reason;',
    tests: ['tests/no_rule_code_on_screen.test.js']
  },
  {
    id: 'av-prelaunch-code',
    why: '開季前檢查清單又印規則代號',
    file: 'src/PreLaunchChecklist.gs',
    find: '        + \' \' + (v.reason || \'\')',
    replace: '        + \' \' + v.ruleId + \'：\' + (v.reason || \'\')',
    tests: ['tests/no_rule_code_on_screen.test.js']
  },
  {
    id: 'aw-pick-by-name',
    why: '最新一份又唔按建立時間揀',
    file: 'src/EditableCopy.gs',
    find: '    if (e.createdMs !== best.createdMs) {',
    replace: '    if (false) {',
    tests: ['tests/recovery_and_reset_copies.test.js']
  },
  {
    id: 'aw-pick-tie-lower',
    why: '同一時間揀版本號較細嗰份',
    file: 'src/EditableCopy.gs',
    find: '      if (ev > bv) best = e;',
    replace: '      if (ev < bv) best = e;',
    tests: ['tests/recovery_and_reset_copies.test.js']
  },
  {
    id: 'aw-copies-not-planned',
    why: '重設季度唔清可編輯副本',
    file: 'src/QuarterReset.gs',
    find: '      if (f.versionNo >= 0 && (versionNosToClear[f.versionNo] ||',
    replace: '      if (false && (versionNosToClear[f.versionNo] ||',
    tests: ['tests/recovery_and_reset_copies.test.js']
  },
  {
    id: 'aw-copies-ignore-prot',
    why: '可編輯副本唔理受保護版本，一律清',
    file: 'src/QuarterReset.gs',
    find: '      if (f.versionNo >= 0 && (versionNosToClear[f.versionNo] ||',
    replace: '      if (true || (versionNosToClear[f.versionNo] ||',
    tests: ['tests/recovery_and_reset_copies.test.js']
  },
  {
    id: 'aw-folders-not-planned',
    why: '清走 PDF 後變空嘅版本資料夾唔列入計畫',
    file: 'src/QuarterReset.gs',
    find: '    plan.pdfFolders = listEmptyVersionFoldersForReset_(quarterId, versionNosToClear, plannedIds, registeredVersionNos);',
    replace: '    plan.pdfFolders = [];',
    tests: ['tests/recovery_and_reset_copies.test.js']
  },
  {
    id: 'aw-folder-nonempty',
    why: '入面有其他檔案嘅資料夾都當成空',
    file: 'src/EditableCopy.gs',
    find: '        if (!plannedFileIds[files.next().getId()]) { willBeEmpty = false; break; }',
    replace: '        if (files.next() && false) { willBeEmpty = false; break; }',
    tests: ['tests/recovery_and_reset_copies.test.js']
  },
  {
    id: 'aw-folder-any-version',
    why: '受保護版本嘅空資料夾都清',
    file: 'src/EditableCopy.gs',
    find: '      if (!versionNosToClear[vNo] && !isOrphan) continue;',
    replace: '',
    tests: ['tests/recovery_and_reset_copies.test.js']
  },
  {
    id: 'aw-exec-no-recheck',
    why: '執行時唔再確認資料夾仲係咪空',
    file: 'src/QuarterReset.gs',
    find: '      if (folder.getFiles().hasNext() || folder.getFolders().hasNext()) {',
    replace: '      if (false) {',
    tests: ['tests/recovery_and_reset_copies.test.js']
  },
  {
    id: 'aw-exec-copies-skipped',
    why: '執行時冇真係移副本去垃圾桶（只計數）',
    file: 'src/QuarterReset.gs',
    find: '.setTrashed(true);\n      result.editableCopiesTrashed++;',
    replace: ';\n      result.editableCopiesTrashed++;',
    tests: ['tests/recovery_and_reset_copies.test.js']
  },
  {
    id: 'aw-guide-docs-again',
    why: '空白時又叫幹事睇 docs/',
    file: 'src/EditableCopy.gs',
    find: '    guideSentence: \'詳細步驟見《職事表系統使用指南》「系統出問題時」一章。\',',
    replace: '    guideSentence: \'詳細步驟在公開文件 docs/系統出問題時手動繼續.md。\',',
    tests: ['tests/recovery_and_reset_copies.test.js']
  },
  {
    id: 'aw-guide-url-ignored',
    why: '有 USER_GUIDE_URL 都唔改句子',
    file: 'src/EditableCopy.gs',
    find: '    if (out.guideUrl) out.guideSentence = \'詳細步驟見使用指南。\';',
    replace: '',
    tests: ['tests/recovery_and_reset_copies.test.js']
  },
  {
    id: 'aw-ui-guide-no-link',
    why: '畫面有 USER_GUIDE_URL 都唔畫連結',
    file: 'src/ui/ScriptZone4.html',
    find: '      if (r.guideUrl) {\n        const g = make(\'a\'',
    replace: '      if (false) {\n        const g = make(\'a\'',
    tests: ['tests/recovery_and_reset_copies.test.js']
  },
  {
    id: 'aw-total-copies-lost',
    why: '批次總數唔計可編輯副本',
    file: 'src/QuarterReset.gs',
    find: '    totals.editableCopies += item.editableCopies;\n',
    replace: '',
    tests: ['tests/recovery_and_reset_copies.test.js']
  },
  {
    id: 'aw-nothing-ignore-copy',
    why: '只有副本要清都當成冇嘢做',
    file: 'src/QuarterReset.gs',
    find: "\n    && totals.editableCopies === 0 && totals.pdfFolders === 0\n    && totals.unavailableInQuarterRows === 0",
    replace: "\n    && totals.unavailableInQuarterRows === 0",
    tests: ['tests/recovery_and_reset_copies.test.js']
  },
  {
    id: 'ax-hint-all-stages',
    why: '所有進度都出「意見收齊」提示',
    file: 'src/WebAppSendPlan.gs',
    find: '  return stage === QUARTER_STAGE.REVIEW_SENT ? SEND_REVIEW_SENT_HINT : \'\';',
    replace: '  return SEND_REVIEW_SENT_HINT;',
    tests: ['tests/review_sent_hint.test.js']
  },
  {
    id: 'ax-hint-not-in-data',
    why: '寄出窗資料冇帶提示',
    file: 'src/WebAppSendPlan.gs',
    find: '      reviewSentHint: buildReviewSentHint_(state.stage),',
    replace: '      reviewSentHint: \'\',',
    tests: ['tests/review_sent_hint.test.js']
  },
  {
    id: 'ax-ui-hint-not-drawn',
    why: '畫面收到提示但唔畫',
    file: 'src/ui/ScriptSendPaper.html',
    find: '    if (s.reviewSentHint) {',
    replace: '    if (false) {',
    tests: ['tests/review_sent_hint.test.js']
  },
  {
    id: 'ax-hint-wrong-step',
    why: '提示寫錯步驟（叫人撳〔儲存〕而唔係〔儲存及寄出〕）',
    file: 'src/WebAppSendPlan.gs',
    find: "  + '請先在第 2 步撳〔儲存〕（沒有改動也可以撳），'",
    replace: "  + '請先在第 2 步撳〔儲存〕，'",
    tests: ['tests/review_sent_hint.test.js']
  },
  {
    id: 'ay-finetune-old-text',
    why: '微調違反原因又寫返內部表名',
    file: 'src/FineTune.gs',
    find: 'add(cell, RULE_IDS.ELIGIBILITY, \'不在這個崗位的名單上\');',
    replace: 'add(cell, RULE_IDS.ELIGIBILITY, \'不在 Eligibility 名單內\');',
    tests: ['tests/screen_text_wording.test.js']
  },
  {
    id: 'ay-verify-old-text',
    why: '核對報告原因又寫返內部表名',
    file: 'src/Verify.gs',
    find: 'notEligible.push(mk(a, RULE_IDS.ELIGIBILITY, \'不在這個崗位的名單上\'));',
    replace: 'notEligible.push(mk(a, RULE_IDS.ELIGIBILITY, \'不在 Eligibility 名單內\'));',
    tests: ['tests/screen_text_wording.test.js']
  },
  {
    id: 'ay-verify-old-label',
    why: '核對報告分組標題又寫返內部表名',
    file: 'src/Verify.gs',
    find: '{ label: \'不在這個崗位的名單上\', items: notEligible },',
    replace: '{ label: \'不在 Eligibility 名單內\', items: notEligible },',
    tests: ['tests/screen_text_wording.test.js']
  },
  {
    id: 'ay-gen-old-text',
    why: '生成器原因又寫返內部表名',
    file: 'src/Generator.gs',
    find: 'reason: \'此崗位在名單上沒有任何在職的合資格人選\'',
    replace: 'reason: \'此崗位在 Eligibility 中沒有任何在職的合資格人選\'',
    tests: ['tests/screen_text_wording.test.js']
  },
  {
    id: 'ay-title-old-nochange',
    why: '沒有改動窗標題又係「儲存並確認」',
    file: 'src/ui/ScriptZone1.html',
    find: "    openModal('儲存', [\n      para('沒有偵測到任何改動，不需要儲存。'",
    replace: "    openModal('儲存並確認', [\n      para('沒有偵測到任何改動，不需要儲存。'",
    tests: ['tests/screen_text_wording.test.js']
  },
  {
    id: 'ay-title-old-zero-done',
    why: '零改動完成窗標題又係「儲存並確認」',
    file: 'src/ui/ScriptZone1.html',
    find: "      openModal('儲存', [\n        make('div', { text: result.message, className: 'ok-line' })",
    replace: "      openModal('儲存並確認', [\n        make('div', { text: result.message, className: 'ok-line' })",
    tests: ['tests/screen_text_wording.test.js']
  },
  {
    id: 'ay-name-old-sentence',
    why: '認不到名字又用舊句子',
    file: 'src/RequestsApply.gs',
    find: 'reason: \'名單上找不到「\' + req.personNameText + \'」。如果是新人，請先用「新增人員」加入；如果是舊人，請留意同音字或異體字。\' };',
    replace: 'reason: \'「\' + req.personNameText + \'」不在 NameMapping，請先用「新增人員」加入\' };',
    tests: ['tests/screen_text_wording.test.js']
  },
  {
    id: 'ay-name-paths-split',
    why: '「不能服侍」唔經 NameAlias 認名',
    file: 'src/RequestsApply.gs',
    find: '  const personId = resolvePersonId(req.personNameText);\n  if (!personId) {\n    return { category: \'NEEDS_INPUT\', reason: \'名單上找不到',
    replace: '  const personId = (req.requestType === REQUEST_TYPE.CANNOT_SERVE ? null : resolvePersonId(req.personNameText));\n  if (!personId) {\n    return { category: \'NEEDS_INPUT\', reason: \'名單上找不到',
    tests: ['tests/screen_text_wording.test.js']
  },
  {
    id: 'aw-orphan-copy-kept',
    why: '版本冇登記嘅孤兒副本（上一次重設前留低嘅）重設時唔清',
    file: 'src/QuarterReset.gs',
    find: '|| registeredVersionNos[f.versionNo] !== true)',
    replace: '|| false)',
    tests: ['tests/recovery_and_reset_copies.test.js']
  },
  {
    id: 'aw-orphan-clears-prot',
    why: '登記咗但受保護／唔清嘅版本副本都當孤兒清走',
    file: 'src/QuarterReset.gs',
    find: '|| registeredVersionNos[f.versionNo] !== true)',
    replace: '|| true)',
    tests: ['tests/recovery_and_reset_copies.test.js']
  },
  {
    id: 'aw-orphan-folder-kept',
    why: '孤兒空資料夾（版本冇登記）唔清',
    file: 'src/EditableCopy.gs',
    find: 'const isOrphan = !!registeredVersionNos && registeredVersionNos[vNo] !== true;',
    replace: 'const isOrphan = false;',
    tests: ['tests/recovery_and_reset_copies.test.js']
  },
  {
    id: 'aw-orphan-folder-prot',
    why: '受保護版本嘅空資料夾都當孤兒清',
    file: 'src/EditableCopy.gs',
    find: 'const isOrphan = !!registeredVersionNos && registeredVersionNos[vNo] !== true;',
    replace: 'const isOrphan = true;',
    tests: ['tests/recovery_and_reset_copies.test.js']
  },
  {
    id: "ba-pdf-no-gate",
    why: "產生 PDF 那一步還原成「有硬規則違反就擋」——改動後重發又會因已放行／未放行的格死胡同（第七十一輪 s47b）",
    file: "src/WebAppFlow.gs",
    find: "  // `releaseText` 參數保留（前端仍會傳），但唔再用。\n",
    replace: "  // `releaseText` 參數保留（前端仍會傳），但唔再用。\n  if (!resolveHardViolationRelease_(recomputeLatestVersionViolations_(quarterId, 5), releaseText)) { return { blocked: true }; }\n",
    tests: ["tests/resend_no_hard_gate.test.js"]
  },
  {
    id: "ba-send-no-gate",
    why: "寄送那一步遇到未放行嘅違反就擋——改動後重發不應該比正式發出更嚴",
    file: "src/WebAppFlow.gs",
    find: "    logUnreleasedHardViolationsAtSend_(quarterId, '步驟 5：改動後重發（Web UI，寄送）', changed.versionNo, unreleased);\n",
    replace: "    logUnreleasedHardViolationsAtSend_(quarterId, '步驟 5：改動後重發（Web UI，寄送）', changed.versionNo, unreleased);\n    if (unreleased.length > 0) { return { blocked: true, violations: [] }; }\n",
    tests: ["tests/resend_no_hard_gate.test.js"]
  },
  {
    id: "ba-swallow-off",
    why: "提醒紀錄算唔到就令重發拋錯——提醒不可以變成新阻擋",
    file: "src/WebAppFlow.gs",
    find: "    log_('WARN', '改動後重發：未放行硬規則違反的提醒紀錄算不到，照常寄出：' + err.message);\n",
    replace: "    throw err;\n",
    tests: ["tests/resend_no_hard_gate.test.js"]
  },
  {
    id: "ba-log-as-release",
    why: "提醒紀錄用放行嘅 Action——下次會被當成幹事已放行，整季靜靜記住",
    file: "src/HardViolationClass.gs",
    find: "      action: HARD_UNRELEASED_AT_SEND_ACTION,\n",
    replace: "      action: HARD_RELEASE_ACTION,\n",
    tests: ["tests/resend_no_hard_gate.test.js"]
  },
  {
    id: "ba-unreleased-all",
    why: "「未放行」清單唔剔走已放行嘅格——全部已放行嘅重發都會寫提醒",
    file: "src/HardViolationClass.gs",
    find: "    return classified.real;\n  } catch (err) {\n    log_('WARN', 'listUnreleasedHardViolations_",
    replace: "    return judgeable;\n  } catch (err) {\n    log_('WARN', 'listUnreleasedHardViolations_",
    tests: ["tests/resend_no_hard_gate.test.js"]
  },
  {
    id: "ba-warn-no-field",
    why: "確認窗資料唔帶 unreleased——黃框永遠出唔到",
    file: "src/SendWarnings.gs",
    find: "    out.unreleased = limitSendWarningList_(unreleased);\n",
    replace: "    out.unreleased = empty;\n",
    tests: ["tests/resend_no_hard_gate.test.js"]
  },
  {
    id: "ba-box-hidden",
    why: "確認窗唔畫未放行黃框",
    file: "src/ui/Script.html",
    find: "    if (unreleased.count > 0 && !compact) {\n",
    replace: "    if (unreleased.count > 0 && !compact && false) {\n",
    tests: ["tests/resend_no_hard_gate.test.js"]
  },
  {
    id: "ba-box-in-card",
    why: "狀態卡（compact）都畫未放行黃框",
    file: "src/ui/Script.html",
    find: "    if (unreleased.count > 0 && !compact) {\n",
    replace: "    if (unreleased.count > 0) {\n",
    tests: ["tests/resend_no_hard_gate.test.js"]
  },
  {
    id: "ba-menu-gate",
    why: "選單版改動後重發還原成要打字「確認放行」",
    file: "src/FourStageFlow.gs",
    find: "    remindUnreleasedHardViolations_(ui, quarterId, '步驟 5：改動後重發', applyResult.violations);\n",
    replace: "    if (!confirmHardViolationOverride_(ui, quarterId, '步驟 5：改動後重發', applyResult.violations, STEP5_HARD_VIOLATION_CONSEQUENCE)) return;\n",
    tests: ["tests/resend_no_hard_gate.test.js"]
  },
  {
    id: "ba-ui-stale-text",
    why: "前端 blocked 防衛還原成指去「儲存並確認」",
    file: "src/ui/ScriptZone1.html",
    find: "        showErrorModal('改動後重發', new Error('系統沒有執行這一步，尚未寄出任何電郵。請重新整理再試一次。'));\n        return;\n      }\n      if (r.noChanges) {",
    replace: "        showErrorModal('改動後重發', new Error('這一版仍然有違反規則的安排，需要先在「儲存並確認」處理。'));\n        return;\n      }\n      if (r.noChanges) {",
    tests: ["tests/resend_no_hard_gate.test.js", "tests/screen_text_wording.test.js"]
  },
  {
    id: "bb-fine-eligible",
    why: "儲存／檢查我的改動／請系統幫我調整對人手填崗位照查名單",
    file: "src/FineTune.gs",
    find: "isRuleEnabled_(rules, RULE_IDS.ELIGIBILITY) && isEligibilityCheckedPost_(post)",
    replace: "isRuleEnabled_(rules, RULE_IDS.ELIGIBILITY)",
    tests: ["tests/manual_post_no_eligibility.test.js"]
  },
  {
    id: "bb-verify-eligible",
    why: "核對職事表對人手填崗位照查名單",
    file: "src/Verify.gs",
    find: "isEligibilityCheckedPost_(post) && pool.indexOf(a.personId) === -1",
    replace: "pool.indexOf(a.personId) === -1",
    tests: ["tests/manual_post_no_eligibility.test.js"]
  },
  {
    id: "bb-helper-always",
    why: "判斷函式永遠要查名單",
    file: "src/Generator.gs",
    find: "  return !post || !!post.autoGenerate;\n",
    replace: "  return true;\n",
    tests: ["tests/manual_post_no_eligibility.test.js"]
  },
  {
    id: "bb-helper-hardcode",
    why: "判斷函式寫死一個崗位——Posts 改咗就唔跟",
    file: "src/Generator.gs",
    find: "  return !post || !!post.autoGenerate;\n",
    replace: "  return !post || !!post.autoGenerate || post.postId === 'TRANSLATE';\n",
    tests: ["tests/manual_post_no_eligibility.test.js"]
  },
  {
    id: "bb-helper-nopost",
    why: "搵唔到崗位資料時唔查名單（應該保守照查）",
    file: "src/Generator.gs",
    find: "  return !post || !!post.autoGenerate;\n",
    replace: "  return !!post && !!post.autoGenerate;\n",
    tests: ["tests/manual_post_no_eligibility.test.js"]
  },
  {
    id: "txt-guards-oldname",
    why: "擋住寄出嘅訊息還原成舊名「儲存並確認」",
    file: "src/WebAppGuards.gs",
    find: "      ['先撳「儲存」，把表上的東西處理好，之後再撳「' + actionName + '」',",
    replace: "      ['先撳「儲存並確認」，把表上的東西處理好，之後再撳「' + actionName + '」',",
    tests: ["tests/screen_text_wording.test.js"]
  },
  {
    id: "txt-dash-oldname",
    why: "狀態卡掣提示還原成舊名「儲存並確認」",
    file: "src/WebAppDashboard.gs",
    find: "        ? '要先撳「寄給堂委審閱」，收齊意見之後再撳「儲存」，這一粒才會著。'",
    replace: "        ? '要先撳「寄給堂委審閱」，收齊意見之後再撳「儲存並確認」，這一粒才會著。'",
    tests: ["tests/screen_text_wording.test.js", "tests/webapp_dashboard_state.test.js"]
  },
  {
    id: "bc-save-rewrites",
    why: "已通知過人嘅版本仍然改寫 RosterAssignments",
    file: "src/PreacherTranslationFill.gs",
    find: "  if (!sheetOnly) {\n    const sheet =",
    replace: "  if (true) {\n    const sheet =",
    tests: ["tests/fill_after_official.test.js"]
  },
  {
    id: "bc-sent-never",
    why: "永遠當「未通知過人」——填格工具照舊改寫已寄出嘅版本",
    file: "src/PreacherTranslationFill.gs",
    find: "  const sheetOnly = isVersionNoticeSent_(quarterId, versionNo);\n",
    replace: "  const sheetOnly = false;\n",
    tests: ["tests/fill_after_official.test.js"]
  },
  {
    id: "bc-no-write-guard",
    why: "工作表寫唔到嗰格仍然當成功",
    file: "src/PreacherTranslationFill.gs",
    find: "  if (sheetOnly && !gridCellWritten) {",
    replace: "  if (false) {",
    tests: ["tests/fill_after_official.test.js"]
  },
  {
    id: "bc-failed-counts",
    why: "寄失敗（冇人收到）都當已通知過人",
    file: "src/SheetReader.gs",
    find: "    return isNoticeReceivedRecord_({ status: String(row[C.STATUS] || '').trim() });",
    replace: "    return true;",
    tests: ["tests/fill_after_official.test.js"]
  },
  {
    id: "bc-review-counts",
    why: "只寄過審閱本都當已正式發出",
    file: "src/SheetReader.gs",
    find: "    if (stage !== MAIL_STAGES.OFFICIAL && stage !== MAIL_STAGES.RESEND) return false;\n",
    replace: "",
    tests: ["tests/fill_after_official.test.js"]
  },
  {
    id: "bc-any-version",
    why: "唔按版本判斷（舊版寄過就當最新版都寄過）",
    file: "src/SheetReader.gs",
    find: "    if (Number(row[C.VERSION_NO]) !== Number(versionNo)) return false;\n",
    replace: "",
    tests: ["tests/fill_after_official.test.js"]
  },
  {
    id: "bc-list-no-sheet",
    why: "彈窗讀唔到工作表上嘅值（見到舊值／空格）",
    file: "src/PreacherTranslationFill.gs",
    find: "    ? readGridFilledManualCells_(quarterId, versionNo, targetPostIds, timezone) : {};",
    replace: "    ? {} : {};",
    tests: ["tests/fill_after_official.test.js"]
  },
  {
    id: "bc-list-flag-off",
    why: "彈窗資料永遠唔報 writesToSheetOnly",
    file: "src/PreacherTranslationFill.gs",
    find: "    writesToSheetOnly: writesToSheetOnly,",
    replace: "    writesToSheetOnly: false,",
    tests: ["tests/fill_after_official.test.js"]
  },
  {
    id: "bc-free-unresolved",
    why: "外請自由文字當「認不出的名」而擋住儲存",
    file: "src/FineTune.gs",
    find: "    if (normalizedGrid !== '' && !resolvedId && !isManualPost) {",
    replace: "    if (normalizedGrid !== '' && !resolvedId) {",
    tests: ["tests/fill_after_official.test.js"]
  },
  {
    id: "bc-free-text-lost",
    why: "新一版把自由文字名字蒸發成空字串",
    file: "src/StateSource.gs",
    find: "(s.isManual ? manualFreeText : (originalRow.personName || ''))",
    replace: "(s.isManual ? '' : (originalRow.personName || ''))",
    tests: ["tests/fill_after_official.test.js"]
  },
  {
    id: "bc-free-text-source",
    why: "自由文字嗰格新一版來源變 SKIPPED",
    file: "src/StateSource.gs",
    find: "((s.personId || manualFreeText) ? ASSIGN_SOURCE.MANUAL : ASSIGN_SOURCE.SKIPPED)",
    replace: "(s.personId ? ASSIGN_SOURCE.MANUAL : ASSIGN_SOURCE.SKIPPED)",
    tests: ["tests/fill_after_official.test.js"]
  },
  {
    id: "cn-import-back",
    why: "第 1 步還原〔用「匯入」〕掣",
    file: "src/ui/ScriptMainFlow.html",
    find: "    // 匯入功能只留喺「進階與診斷 ▸ 匯入人手編好的職事表」。\n    return card;",
    replace: "    card.querySelector('.step-body').appendChild(make('div', { className: 'row' }, [\n      make('span', { text: '已經用舊方法排好？', className: 'muted' }),\n      button('用「匯入」', () => openImportRoster(), 'secondary')\n    ]));\n    return card;",
    tests: ["tests/round75_cn_no_import_step1.test.js"]
  },
  {
    id: "cn-zone4-import-gone",
    why: "連進階與診斷嘅「檢查並匯入」都拿走（功能唔見咗）",
    file: "src/ui/ScriptZone4.html",
    find: "      zone4Row('檢查並匯入',",
    replace: "      zone4Row('檢查匯入（停用）',",
    tests: ["tests/round75_cn_no_import_step1.test.js"]
  },
  {
    id: "ck-full-one-back",
    why: "下載及匯出還原「一份整季表」選項",
    file: "src/ui/ScriptSendPaper.html",
    find: "      // ⚠️ 第七十五輪批次 CK 組：只剩上面兩種。\n",
    replace: "      ['FULL_ONE', '一份整季表，印一張大家看', '同上面那一種是同一個檔。'],\n",
    tests: ["tests/round75_ck_paper_two_kinds.test.js"]
  },
  {
    id: "ck-copy-btn-gone",
    why: "系統出問題時怎樣做冇〔建立可編輯副本〕",
    file: "src/ui/ScriptZone4.html",
    find: "        button('建立可編輯副本', () => runEditableCopy(), 'secondary'),\n",
    replace: "",
    tests: ["tests/round75_ck_paper_two_kinds.test.js"]
  },
  {
    id: "ca-zone3-old-title",
    why: "區三標題還原成「名單維護」",
    file: "src/ui/Index.html",
    find: "      <span class=\"zone-title\">常用設定</span>",
    replace: "      <span class=\"zone-title\">名單維護</span>",
    tests: ["tests/round75_ca_layout.test.js"]
  },
  {
    id: "ca-settings-same-tab",
    why: "常用設定嘅工作表連結唔喺新分頁開（取代咗幹事介面）",
    file: "src/ui/ScriptZone3.html",
    find: "    const a = make('a', { text: label, className: 'bigLink' });\n    a.href = url;\n    a.target = '_blank';",
    replace: "    const a = make('a', { text: label, className: 'bigLink' });\n    a.href = url;\n    a.target = '_self';",
    tests: ["tests/round75_ca_layout.test.js"]
  },
  {
    id: "ca-unavail-not-zone2",
    why: "開季前準備冇〔不能服侍的日期〕",
    file: "src/ui/ScriptZone2.html",
    find: "      button('不能服侍的日期', () => openUnavailable(), ''),\n",
    replace: "",
    tests: ["tests/round75_ca_layout.test.js"]
  },
  {
    id: "ca-weights-not-step2",
    why: "開季前準備冇〔排表偏好〕（第七十七輪 EA 組由第 2 步搬過嚟）",
    file: "src/ui/ScriptZone2.html",
    find: "      button('排表偏好', () => openWeights(), '')\n",
    replace: "",
    tests: ["tests/round75_ca_layout.test.js", "tests/round77_ea_weight_scope.test.js"]
  },
  {
    id: "ca-hints-not-zone4",
    why: "進階與診斷冇〔名單檢查〕",
    file: "src/ui/ScriptZone4.html",
    find: "      zone4Row('名單檢查',",
    replace: "      zone4Row('人員提示',",
    tests: ["tests/round75_ca_layout.test.js"]
  },
  {
    id: "ca-links-hardcoded",
    why: "常用設定網址唔再由工作表實時問（gid 錯）",
    file: "src/WebAppDashboard.gs",
    find: "    people: buildGridSheetUrl_(SHEETS.NAME_MAPPING),",
    replace: "    people: buildGridSheetUrl_(SHEETS.ROLES),",
    tests: ["tests/round75_ca_layout.test.js"]
  },
  {
    id: "cm-no-overlap-check",
    why: "後端唔再判斷同季度重疊（全部當本季）",
    file: "src/WebAppUnavailable.gs",
    find: "  return from <= range.end && to >= range.start;",
    replace: "  return true;",
    tests: ["tests/round75_cm_unavailable_quarter.test.js"]
  },
  {
    id: "cm-ui-no-filter",
    why: "前端預設照舊列出全部季度",
    file: "src/ui/ScriptZone3.html",
    find: "    const current = showAll ? unavailableData.current : unavailableData.current.filter(inQ);",
    replace: "    const current = unavailableData.current;",
    tests: ["tests/round75_cm_unavailable_quarter.test.js"]
  },
  {
    id: "cm-default-today",
    why: "新增預設日期唔理季度",
    file: "src/ui/ScriptZone3.html",
    find: "    return (t >= s && t <= e) ? t : s;",
    replace: "    return t;",
    tests: ["tests/round75_cm_unavailable_quarter.test.js"]
  },
  {
    id: "cl-edit-url",
    why: "公開連結還原成 /edit（可以直接改公開版）",
    file: "src/PublicRoster.gs",
    find: "const PUBLIC_LINK_VIEW_SUFFIX = '/preview';",
    replace: "const PUBLIC_LINK_VIEW_SUFFIX = '/edit';",
    tests: ["tests/round75_cl_public_readonly.test.js"]
  },
  {
    id: "cl-old-row-raw",
    why: "舊紀錄嘅 /edit 原樣回傳，唔轉唯讀網址",
    file: "src/PublicRoster.gs",
    find: "        fileUrl: buildPublicViewUrl_(rows[i][C.FILE_ID], rows[i][C.FILE_URL]),",
    replace: "        fileUrl: String(rows[i][C.FILE_URL] || '').trim(),",
    tests: ["tests/round75_cl_public_readonly.test.js"]
  },
  {
    id: "cl-no-enforce",
    why: "發佈時唔再收窄分享、唔加保護",
    file: "src/PublicRoster.gs",
    find: "  enforcePublicRosterReadOnly_(resolved.spreadsheet);\n",
    replace: "",
    tests: ["tests/round75_cl_public_readonly.test.js"]
  },
  {
    id: "cl-keep-editors",
    why: "保護唔移走其他編輯者",
    file: "src/PublicRoster.gs",
    find: "      protection.removeEditors(protection.getEditors());\n      if (scriptAccount) protection.addEditor(scriptAccount);\n      if (protection.canDomainEdit()) protection.setDomainEdit(false);\n      out.protectedSheets++;",
    replace: "      if (scriptAccount) protection.addEditor(scriptAccount);\n      if (protection.canDomainEdit()) protection.setDomainEdit(false);\n      out.protectedSheets++;",
    tests: ["tests/round75_cl_public_readonly.test.js"]
  },
  {
    id: "cb-include-started",
    why: "連已經開始咗嘅季度都建（範圍下限冇咗）",
    file: "src/AnnualQuarters.gs",
    find: "      if (p.startDate > today && p.startDate <= horizon) plans.push(p);",
    replace: "      if (p.startDate <= horizon) plans.push(p);",
    tests: ["tests/round75_cb_quarter_lookahead.test.js"]
  },
  {
    id: "cb-whole-batch",
    why: "一次過寫晒（唔再逐季、唔逐季記 AuditLog）",
    file: "src/AnnualQuarters.gs",
    find: "  picked.plans.forEach(function (plan) {\n    const result = executeAnnualQuarters_([plan]);",
    replace: "  [picked.plans[0]].filter(Boolean).forEach(function (plan) {\n    const result = executeAnnualQuarters_(picked.plans);",
    tests: ["tests/round75_cb_quarter_lookahead.test.js"]
  },
  {
    id: "cb-bad-config-zero",
    why: "Config 唔啱當成 0（靜靜熄咗）",
    file: "src/AnnualQuarters.gs",
    find: "    return DEFAULTS.QUARTER_LOOKAHEAD_MONTHS;\n  }\n  return n;",
    replace: "    return 0;\n  }\n  return n;",
    tests: ["tests/round75_cb_quarter_lookahead.test.js"]
  },
  {
    id: "cb-no-load-ensure",
    why: "載入幹事介面時唔再自動建立",
    file: "src/ui/Script.html",
    find: "      await callServerMutating('apiEnsureFutureQuarters');\n    } catch (err) { /* 見上：唔阻住載入 */ }",
    replace: "    } catch (err) { /* 見上：唔阻住載入 */ }",
    tests: ["tests/round75_cb_quarter_lookahead.test.js"]
  },
  {
    id: "cb-no-daily-ensure",
    why: "每日排程唔再自動建立",
    file: "src/Trigger.gs",
    find: "      const ahead = ensureLookaheadQuarters_('dailyAutomationCheck_');",
    replace: "      const ahead = { created: [] };",
    tests: ["tests/round75_cb_quarter_lookahead.test.js"]
  },
  {
    id: "cc-read-special-always",
    why: "特別主日關咗都照讀（生成會跳過崗位）",
    file: "src/SheetReader.gs",
    find: "  if (!isSpecialSundaysEnabled_()) return [];\n  return readSheet(SHEETS.SPECIAL_SUNDAYS).filter(function (row) {",
    replace: "  return readSheet(SHEETS.SPECIAL_SUNDAYS).filter(function (row) {",
    tests: ["tests/round75_cc_special_off_week_title.test.js"]
  },
  {
    id: "cc-checklist-special",
    why: "開季前準備清單照列特別主日兩項",
    file: "src/WebAppPreQuarter.gs",
    find: "  const specialItems = input.specialEnabled === false ? [] : [",
    replace: "  const specialItems = false ? [] : [",
    tests: ["tests/round75_cc_special_off_week_title.test.js"]
  },
  {
    id: "cc-legend-special",
    why: "圖例照列「特殊主日」",
    file: "src/RosterWriter.gs",
    find: "  ].filter(function (r) { return showSpecialRow || r[0] !== labels.specialSkip; });",
    replace: "  ];",
    tests: ["tests/round75_cc_special_off_week_title.test.js"]
  },
  {
    id: "cc-title-not-detected",
    why: "「類型」欄改動偵測唔到",
    file: "src/SheetReader.gs",
    find: "    if (now !== want) out.push({ serviceDate: d, fromTitle: want, toTitle: now });",
    replace: "    if (false) out.push({ serviceDate: d, fromTitle: want, toTitle: now });",
    tests: ["tests/round75_cc_special_off_week_title.test.js"]
  },
  {
    id: "cc-title-not-written",
    why: "儲存時唔寫 ServiceDates.Title",
    file: "src/WebAppSaveConfirm.gs",
    find: "      writeWeekTitles_(quarterId, titleChanges, context.timezone, 'apiSaveAndConfirmExecute');",
    replace: "      // 冇寫",
    tests: ["tests/round75_cc_special_off_week_title.test.js"]
  },
  {
    id: "cc-grid-ignores-title",
    why: "新一版「類型」欄唔用每週標題",
    file: "src/RosterWriter.gs",
    find: "      resolveWeekTypeText_(d.serviceType, specialTitleByDate[d.serviceDate], d.weekTitle)];",
    replace: "      resolveWeekTypeText_(d.serviceType, specialTitleByDate[d.serviceDate], '')];",
    tests: ["tests/round75_cc_special_off_week_title.test.js"]
  },
  {
    id: "cc-title-only-no-ver",
    why: "只改標題唔建立新一版",
    file: "src/StateSource.gs",
    find: "  if ((!changes || changes.length === 0) && titleChangeCount === 0) {",
    replace: "  if (!changes || changes.length === 0) {",
    tests: ["tests/round75_cc_special_off_week_title.test.js"]
  },
  {
    id: "cc-title-no-clear",
    why: "改返預設唔清空 Title",
    file: "src/SheetReader.gs",
    find: "    const newTitle = (change.toTitle === '' || change.toTitle === defaultText) ? '' : change.toTitle;",
    replace: "    const newTitle = change.toTitle;",
    tests: ["tests/round75_cc_special_off_week_title.test.js"]
  },
  {
    id: "cd-manual-skip-again",
    why: "人手崗位嘅 grid 改動又整格略過（偵測唔到）",
    file: "src/FineTune.gs",
    find: "    const isManualPost = context.gridRender.autoGenerateByPostId[a.postId] === false;\n",
    replace: "    const isManualPost = context.gridRender.autoGenerateByPostId[a.postId] === false;\n    if (isManualPost) return Object.assign({}, base, { personId: a.personId, isManual: false });\n",
    tests: ["tests/round75_cd_manual_posts_in_sheet.test.js"]
  },
  {
    id: "cd-outside-unresolved",
    why: "外請講員當成「認不出」",
    file: "src/FineTune.gs",
    find: "    if (normalizedGrid !== '' && !resolvedId && !isManualPost) {",
    replace: "    if (normalizedGrid !== '' && !resolvedId) {",
    tests: ["tests/round75_cd_manual_posts_in_sheet.test.js"]
  },
  {
    id: "cd-no-manual-dropdown",
    why: "人手崗位冇名單選單",
    file: "src/GridNameDropdown.gs",
    find: "      const isManualPost = post.autoGenerate === false;\n",
    replace: "      const isManualPost = post.autoGenerate === false;\n      if (isManualPost) { skipped.push({ postId: postId, postNameTC: post.postNameTC, reason: 'NOT_AUTO' }); return; }\n",
    tests: ["tests/round75_cd_manual_posts_in_sheet.test.js"]
  },
  {
    id: "cd-checklist-from-ra",
    why: "未填計數唔睇職事表工作表（照舊只睇長表）",
    file: "src/WebAppPreQuarter.gs",
    find: "  if (gridExists) {\n    const onSheet = readGridFilledManualCells_(",
    replace: "  if (false) {\n    const onSheet = readGridFilledManualCells_(",
    tests: ["tests/round75_cd_manual_posts_in_sheet.test.js"]
  },
  {
    id: "cd-fill-btn-back",
    why: "開季前準備還原〔填講員／翻譯／獻花〕",
    file: "src/ui/ScriptZone2.html",
    find: "      button('排表偏好', () => openWeights(), '')\n    ]));",
    replace: "      button('排表偏好', () => openWeights(), ''),\n      button('填講員／翻譯／獻花', () => {}, '')\n    ]));",
    tests: ["tests/round75_cd_manual_posts_in_sheet.test.js"]
  },
  {
    id: "ce-unresolved-blocks",
    why: "請系統幫我調整又因為未決定嘅名而整個拒絕",
    file: "src/SuggestionSheet.gs",
    find: "  const undecidedNames = decisionItems.names.filter(function (n) { return !n.checked; });\n",
    replace: "  const undecidedNames = decisionItems.names.filter(function (n) { return !n.checked; });\n  if (undecidedNames.length > 0) return { blocked: true, versionNo: versionNo, unresolved: analysis.unresolved, message: 'x' };\n",
    tests: ["tests/round75_cefg_decisions_save.test.js"]
  },
  {
    id: "ce-temp-name-lost",
    why: "建議表上臨時幫手／未決定嘅名蒸發",
    file: "src/SuggestionSheet.gs",
    find: "      personName: person ? person.nameTC : (String(s.freeText || '').trim() || (s.isManual ? '' : (orig.personName || ''))),",
    replace: "      personName: person ? person.nameTC : (s.isManual ? '' : (orig.personName || '')),",
    tests: ["tests/round75_cefg_decisions_save.test.js"]
  },
  {
    id: "ce-free-text-blank",
    why: "有名冇 PersonID 嘅格當成空格",
    file: "src/FineTune.gs",
    find: "    if (isCellFilled_(s.personId, s.freeText)) return false;\n",
    replace: "    if (s.personId) return false;\n",
    tests: ["tests/round75_cefg_decisions_save.test.js"]
  },
  {
    id: "ce-temp-any-text",
    why: "臨時幫手決定換咗名都照算（唔失效）",
    file: "src/SheetReader.gs",
    find: "      && byKind[k] === normalizeDecisionText_(text);",
    replace: "      && true;",
    tests: ["tests/round75_cefg_decisions_save.test.js"]
  },
  {
    id: "cf-kept-ignored",
    why: "勾咗「保留我的安排」嘅格系統照樣調整",
    file: "src/SuggestionSheet.gs",
    find: "  decisionItems.rules.forEach(function (r) { if (r.checked) keptKeys[r.key] = true; });",
    replace: "  decisionItems.rules.forEach(function (r) { if (false) keptKeys[r.key] = true; });",
    tests: ["tests/round75_cefg_decisions_save.test.js"]
  },
  {
    id: "cf-old-manual-rule",
    why: "還原「親手改過一律唔動」（冇勾都唔調整）",
    file: "src/SuggestionSheet.gs",
    find: "    const untouchable = keptKeys ? !!keptKeys[key] : (manual[key] && !allowed[key]);",
    replace: "    const untouchable = !!(keptKeys && keptKeys[key]) || (manual[key] && !allowed[key]);",
    tests: ["tests/round75_cefg_decisions_save.test.js"]
  },
  {
    id: "cf-no-persist",
    why: "勾選唔即時記住（冇叫 apiSetCellDecisions）",
    file: "src/ui/Script.html",
    find: "      await callServerMutating('apiSetCellDecisions', currentQuarterId, payloads);",
    replace: "      await Promise.resolve(payloads);",
    tests: ["tests/round75_cfg_ui.test.js"]
  },
  {
    id: "cf-check-all-no-ask",
    why: "〔全部勾選〕唔先問一句",
    file: "src/ui/Script.html",
    find: "      nodes.push(row([button('全部勾選', () => { confirmBox.hidden = false; }, 'secondary')]));",
    replace: "      nodes.push(row([button('全部勾選', () => { boxes.forEach((b) => { b.cb.checked = true; state[sk(b.item)] = true; }); changed(); }, 'secondary')]));",
    tests: ["tests/round75_cfg_ui.test.js"]
  },
  {
    id: "cf-no-revert-on-fail",
    why: "記唔到都唔還原勾選框",
    file: "src/ui/Script.html",
    find: "        if (!ok) { cb.checked = !want; state[sk(it)] = !want; changed(); }",
    replace: "        if (!ok) { changed(); }",
    tests: ["tests/round75_cfg_ui.test.js"]
  },
  {
    id: "cg-no-decision-gate",
    why: "未決定都照樣儲存（後端唔驗）",
    file: "src/WebAppSaveConfirm.gs",
    find: "  if (plan.needsDecision) {\n    throw new Error(buildThreePartMessage_(",
    replace: "  if (false) {\n    throw new Error(buildThreePartMessage_(",
    tests: ["tests/round75_cefg_decisions_save.test.js"]
  },
  {
    id: "cg-kept-no-release-log",
    why: "勾咗保留嘅一定要遵守違反唔寫放行紀錄",
    file: "src/WebAppSaveConfirm.gs",
    find: "  if (plan.violations.kept.length > 0) {\n",
    replace: "  if (false) {\n",
    tests: ["tests/round75_cefg_decisions_save.test.js"]
  },
  {
    id: "cg-unresolved-blocks",
    why: "儲存計劃又因認唔出嘅名即時擋",
    file: "src/WebAppSaveConfirm.gs",
    find: "  const undecidedNames = decisionItems.names.filter(function (n) { return !n.checked; });\n",
    replace: "  const undecidedNames = decisionItems.names.filter(function (n) { return !n.checked; });\n  if (undecidedNames.length > 0) return blocked('UNRESOLVED_NAMES', { message: 'x' });\n",
    tests: ["tests/round75_cefg_decisions_save.test.js"]
  },
  {
    id: "cg-save-btn-always-on",
    why: "未決定都畀撳〔儲存〕",
    file: "src/ui/ScriptZone1.html",
    find: "    saveBtn.disabled = !!decisions && !decisions.allDecided();",
    replace: "    saveBtn.disabled = false;",
    tests: ["tests/round75_cfg_ui.test.js"]
  },
  {
    id: "cg-done-no-adjust",
    why: "儲存完成窗冇〔請系統幫我調整〕",
    file: "src/ui/ScriptZone1.html",
    find: "    const doneActs = [button('知道了', () => closeModalAndRefresh(), ''), adjustBtn];",
    replace: "    const doneActs = [button('知道了', () => closeModalAndRefresh(), '')];",
    tests: ["tests/round75_cfg_ui.test.js"]
  },
  {
    id: "cg-name-renamed-back",
    why: "第 2 步掣還原叫「儲存及寄出」",
    file: "src/ui/ScriptMainFlow.html",
    find: "    const saveBtn = stepButton('儲存', () => openSaveAndConfirm(), {",
    replace: "    const saveBtn = stepButton('儲存及寄出', () => openSaveAndConfirm(), {",
    tests: ["tests/send_recipients_pool.test.js"]
  },
  {
    id: "ch-no-picker",
    why: "第 2 步冇版本下拉",
    file: "src/ui/ScriptMainFlow.html",
    find: "    acts.push((d.versionChoices || []).length > 0 ? buildVersionPicker(d.versionChoices, openNode) : openNode);",
    replace: "    acts.push(openNode);",
    tests: ["tests/round75_ch_version_picker.test.js"]
  },
  {
    id: "ch-old-shows-edit",
    why: "揀舊版本仍然只顯示〔查看／修改職事表〕",
    file: "src/ui/ScriptMainFlow.html",
    find: "      if (!chosen || chosen.isLatest) {\n        pickedVersionNo_ = null;",
    replace: "      if (true) {\n        pickedVersionNo_ = null;",
    tests: ["tests/round75_ch_version_picker.test.js"]
  },
  {
    id: "ch-start-no-ask",
    why: "〔用這一版作起點〕唔先問就寫入",
    file: "src/ui/ScriptMainFlow.html",
    find: "      slot.appendChild(stepButton('用這一版作起點', () => openUseVersionAsStartPoint(chosen), {",
    replace: "      slot.appendChild(stepButton('用這一版作起點', () => callServerMutating('apiUseVersionAsStartPoint', currentQuarterId, chosen.versionNo), {",
    tests: ["tests/round75_ch_version_picker.test.js"]
  },
  {
    id: "ch-titles-from-sheet",
    why: "每週標題照抄工作表（其實係下一版嘅字）",
    file: "src/WebAppRollback.gs",
    find: "  const titles = readVersionWeekTitles_(quarterId, sourceVersionNo, renderContext, auditRows);",
    replace: "  const titles = readGridTypeColumn_(sheet.getName(), timezone);",
    tests: ["tests/round75_ch_version_picker.test.js"]
  },
  {
    id: "ch-title-no-replay",
    why: "唔睇 AuditLog 標題改動，一律用現在嘅標題",
    file: "src/WebAppRollback.gs",
    find: "    if (String(r[C.ACTION] || '') !== 'WEEK_TITLE_CHANGED') continue;",
    replace: "    continue;",
    tests: ["tests/round75_ch_version_picker.test.js"]
  },
  {
    id: "ch-no-titles",
    why: "作起點唔寫每週標題",
    file: "src/WebAppRollback.gs",
    find: "  if (typeCol !== -1) {\n    Object.keys(titles).forEach(function (d) {",
    replace: "  if (false) {\n    Object.keys(titles).forEach(function (d) {",
    tests: ["tests/round75_ch_version_picker.test.js"]
  },
  {
    id: "ch-basis-not-marked",
    why: "儲存後來源冇寫「以第 M 版作起點」",
    file: "src/WebAppSaveConfirm.gs",
    find: "        startPointBasis || VERSION_VALUES.BASIS_FINE_TUNE, plan.baseVersionNo,",
    replace: "        VERSION_VALUES.BASIS_FINE_TUNE, plan.baseVersionNo,",
    tests: ["tests/round75_ch_version_picker.test.js"]
  },
  {
    id: "ch-marker-sticky",
    why: "起點標記之後每次儲存都沿用",
    file: "src/SheetReader.gs",
    find: "    if (Number(r[C.OLD_VALUE]) !== Number(baseVersionNo)) return;\n",
    replace: "",
    tests: ["tests/round75_ch_version_picker.test.js"]
  },
  {
    id: "ch-view-no-protect",
    why: "〔查看這一版〕唔設唯讀",
    file: "src/WebAppRollback.gs",
    find: "      if (existing.length === 0) {\n        sheet.protect().setDescription('第 ' + target + ' 版（舊版本），只供查看')",
    replace: "      if (false) {\n        sheet.protect().setDescription('第 ' + target + ' 版（舊版本），只供查看')",
    tests: ["tests/round75_ch_version_picker.test.js"]
  },
  {
    id: "ch-view-no-restore",
    why: "〔查看這一版〕顯示嘅係下一版改過嘅字",
    file: "src/WebAppRollback.gs",
    find: "      const r = writeVersionContentIntoSheet_(quarterId, target, sheet, timezone);\n      restoredCells",
    replace: "      const r = { cellCount: 0, titleCount: 0 };\n      restoredCells",
    // 第七十八輪批次 FB 組：儲存嗰陣已經還原，呢條改由「儲存時還原唔到、查看時再試」守
    tests: ["tests/round78_fb_base_sheet_restore.test.js"]
  },
  {
    id: "ch-view-latest-locked",
    why: "查看最新一版都加保護",
    file: "src/WebAppRollback.gs",
    find: "  if (target !== findLatestVersionNo(quarterId)) {\n    try {\n      const r = writeVersionContentIntoSheet_",
    replace: "  if (true) {\n    try {\n      const r = writeVersionContentIntoSheet_",
    tests: ["tests/round75_ch_version_picker.test.js"]
  },
  {
    id: "ch-author-full-email",
    why: "「由誰」顯示成條電郵",
    file: "src/WebAppRollback.gs",
    find: "    return at > 0 ? e.slice(0, at) : e;",
    replace: "    return e;",
    tests: ["tests/round75_ch_version_picker.test.js"]
  },
  {
    id: "ch-no-regen-label",
    why: "重新生成都寫成「系統生成」",
    file: "src/WebAppDashboard.gs",
    find: "  if (basis === VERSION_VALUES.BASIS_AUTO_GENERATE && parent !== '') return '重新生成';\n",
    replace: "",
    tests: ["tests/round75_ch_version_picker.test.js"]
  },
  {
    id: "ch-suggest-as-manual",
    why: "接受建議表嘅版本寫成人手調整",
    file: "src/SuggestionSheet.gs",
    find: "    VERSION_VALUES.BASIS_SUGGESTION, versionNo, 0, false,",
    replace: "    VERSION_VALUES.BASIS_FINE_TUNE, versionNo, 0, false,",
    tests: ["tests/round75_ch_version_picker.test.js"]
  },
  {
    id: "ch-zone4-rollback-back",
    why: "進階與診斷〔回到上一個版本〕還原",
    file: "src/ui/ScriptZone4.html",
    find: "    // 第七十五輪批次 CH 組：〔回到上一個版本〕拿走——第 2 步嘅版本下拉〔用這一版作起點〕取代佢。\n",
    replace: "    body.appendChild(renderRollbackEntry());\n",
    tests: ["tests/round75_ch_version_picker.test.js"]
  },
  // 第八十二輪批次 ID 組：CI 組「儲存偏好之後問要唔要重新生成」整段拿走（Ivan），
  // 原本 4 條突變（ci-no-ask-after-save／ci-regen-no-typing／ci-later-regenerates／ci-ask-without-version）
  // 冇咗目標，由下面 id- 突變取代。
  {
    id: "cj-temp-not-listed",
    why: "臨時幫手冇列入收不到電郵",
    file: "src/WebAppFlow.gs",
    find: "\n      .concat(split.tempHelpers.map(function (t) { return { name: t.nameTC, reason: '臨時幫手' }; }));",
    replace: ";",
    tests: ["tests/round75_cj_unreachable.test.js"]
  },
  {
    id: "cj-noemail-not-listed",
    why: "名單上冇電郵嘅人冇列出",
    file: "src/WebAppFlow.gs",
    find: "    out.people = split.noEmail.map(function (p) { return { name: p.nameTC, reason: '沒有電郵' }; })",
    replace: "    out.people = [].map(function (p) { return { name: p.nameTC, reason: '沒有電郵' }; })",
    tests: ["tests/round75_cj_unreachable.test.js"]
  },
  {
    id: "cj-external-listed",
    why: "外請講員都逐個列名",
    file: "src/SheetReader.gs",
    find: "    if (autoByPost[String(row[A.POST_ID] || '').trim()] === true) tempCount[name] = (tempCount[name] || 0) + 1;",
    replace: "    if (true) tempCount[name] = (tempCount[name] || 0) + 1;",
    tests: ["tests/round75_cj_unreachable.test.js"]
  },
  {
    id: "cj-error-as-clear",
    why: "查唔到當成全部收到",
    file: "src/ui/Script.html",
    find: "    if (u.error) {\n      return [make('div', { text: '查不到哪幾位收不到電郵（'",
    replace: "    if (false) {\n      return [make('div', { text: '查不到哪幾位收不到電郵（'",
    tests: ["tests/round75_cj_unreachable.test.js"]
  },
  {
    id: "cj-no-external-line",
    why: "冇講另有幾個名字不在名單上",
    file: "src/ui/Script.html",
    find: "    if (u.externalNameCount > 0) {\n      nodes.push(make('div', {\n        text: '另有 '",
    replace: "    if (false) {\n      nodes.push(make('div', {\n        text: '另有 '",
    tests: ["tests/round75_cj_unreachable.test.js"]
  },
  {
    id: "cj-review-confirm-off",
    why: "寄給堂委審閱確認窗冇列",
    file: "src/ui/ScriptZone1.html",
    find: "      // 第七十五輪批次 CJ 組\n      buildUnreachableNodes(preview.unreachable).forEach((n) => nodes.push(n));\n      // 第七十七輪批次 EG 組：上次讀唔到出席系統 ⇒ 講一句（電郵係上次嘅）\n      if (preview.hwcasNotice) nodes.push(make('div', { className: 'warnbox' }, [make('div', { text: preview.hwcasNotice, className: 'lines' })]));\n\n      if (preview.alreadySentCount > 0) {\n        nodes.push(make('div', { className: 'warnbox' }, [\n          make('div', {\n            text: '注意：這個版本已經有 ' + preview.alreadySentCount + ' 位收件人收過信，'",
    replace: "      // 第七十五輪批次 CJ 組\n      // 第七十七輪批次 EG 組：上次讀唔到出席系統 ⇒ 講一句（電郵係上次嘅）\n      if (preview.hwcasNotice) nodes.push(make('div', { className: 'warnbox' }, [make('div', { text: preview.hwcasNotice, className: 'lines' })]));\n\n      if (preview.alreadySentCount > 0) {\n        nodes.push(make('div', { className: 'warnbox' }, [\n          make('div', {\n            text: '注意：這個版本已經有 ' + preview.alreadySentCount + ' 位收件人收過信，'",
    tests: ["tests/round75_cj_unreachable.test.js"]
  },
  {
    id: "cj-review-done-off",
    why: "寄給堂委審閱完成窗冇列",
    file: "src/ui/ScriptZone1.html",
    find: "    // 第七十五輪批次 CJ 組：完成窗同樣列出\n    buildUnreachableNodes(r.unreachable).forEach((n) => nodes.push(n));\n\n    // 規格 2.5 最後一段",
    replace: "\n    // 規格 2.5 最後一段",
    tests: ["tests/round75_cj_unreachable.test.js"]
  },
  {
    id: "cj-official-off",
    why: "正式發出確認窗冇列",
    file: "src/ui/ScriptZone1.html",
    find: "      // 第七十五輪批次 CJ 組\n      buildUnreachableNodes(preview.unreachable).forEach((n) => nodes.push(n));\n      // 第七十七輪批次 EG 組：上次讀唔到出席系統 ⇒ 講一句（電郵係上次嘅）\n      if (preview.hwcasNotice) nodes.push(make('div', { className: 'warnbox' }, [make('div', { text: preview.hwcasNotice, className: 'lines' })]));\n\n      if (preview.alreadySentCount > 0) {\n        nodes.push(make('div', { className: 'warnbox' }, [\n          make('div', {\n            text: '注意：這個版本已經有 ' + preview.alreadySentCount + ' 個人收過信，'",
    replace: "      // 第七十五輪批次 CJ 組\n      // 第七十七輪批次 EG 組：上次讀唔到出席系統 ⇒ 講一句（電郵係上次嘅）\n      if (preview.hwcasNotice) nodes.push(make('div', { className: 'warnbox' }, [make('div', { text: preview.hwcasNotice, className: 'lines' })]));\n\n      if (preview.alreadySentCount > 0) {\n        nodes.push(make('div', { className: 'warnbox' }, [\n          make('div', {\n            text: '注意：這個版本已經有 ' + preview.alreadySentCount + ' 個人收過信，'",
    tests: ["tests/round75_cj_unreachable.test.js"]
  },
  {
    id: "cj-preview-no-data",
    why: "寄給堂委審閱預覽冇帶收不到電郵資料",
    file: "src/WebAppFlow.gs",
    find: "  plan.unreachable = buildUnreachablePeople_(quarterId, plan.versionNo);",
    replace: "",
    tests: ["tests/round75_cj_unreachable.test.js"]
  },
  {
    id: "cp-unavail-only-request",
    why: "完全喺季內嘅人手 Unavailable 唔清",
    file: "src/QuarterReset.gs",
    find: "        if (isUnavailableFullyInQuarter_(dateFrom, dateTo, quarterStart, quarterEnd)) return true;\n",
    replace: "",
    tests: ["tests/round75_cp_reset_thorough.test.js"]
  },
  {
    id: "cp-unavail-cross-gone",
    why: "跨季嘅人手 Unavailable 都清走",
    file: "src/QuarterReset.gs",
    find: "  return !!dateFrom && dateFrom >= quarterStart && to <= quarterEnd && to >= dateFrom;",
    replace: "  return !!dateFrom && dateFrom >= quarterStart;",
    tests: ["tests/round75_cp_reset_thorough.test.js"]
  },
  {
    id: "cp-unavail-not-listed",
    why: "確認清單冇列會清走嘅 Unavailable",
    file: "src/Menu.gs",
    find: "  if ((plan.unavailableInQuarterDetails || []).length > 0) {\n    lines.push('', '會清走的不能服侍日期（完全在這一季之內）：');",
    replace: "  if (false) {\n    lines.push('', '會清走的不能服侍日期（完全在這一季之內）：');",
    tests: ["tests/round75_cp_reset_thorough.test.js"]
  },
  {
    id: "cp-decisions-kept",
    why: "重設唔清逐格決定",
    file: "src/QuarterReset.gs",
    find: "  if ((plan.cellDecisionRows || 0) > 0) {\n    result.cellDecisionRowsDeleted",
    replace: "  if (false) {\n    result.cellDecisionRowsDeleted",
    tests: ["tests/round75_cp_reset_thorough.test.js"]
  },
  {
    id: "cp-decisions-all-q",
    why: "清決定連其他季度都清",
    file: "src/QuarterReset.gs",
    find: "    result.cellDecisionRowsDeleted = deleteRowsMatching_(SHEETS.CELL_DECISIONS, function (record) {\n      return String(record[COLUMNS.CELL_DECISIONS.QUARTER_ID] || '').trim() === plan.quarterId;",
    replace: "    result.cellDecisionRowsDeleted = deleteRowsMatching_(SHEETS.CELL_DECISIONS, function (record) {\n      return true;",
    tests: ["tests/round75_cp_reset_thorough.test.js"]
  },
  {
    id: "cp-release-survives",
    why: "重設之後舊放行仍然生效",
    file: "src/HardViolationClass.gs",
    find: "  (auditRows || []).forEach(function (row, i) {\n    if (i <= after) return;\n    if (String(row[C.ACTION] || '') !== HARD_RELEASE_ACTION) return;\n    if (String(row[C.TARGET_KEY] || '') !== quarterId) return;\n\n    const notes = String(row[C.NOTES] || '');\n    const at = notes.indexOf(HARD_RELEASE_KEY_PREFIX);",
    replace: "  (auditRows || []).forEach(function (row, i) {\n    if (String(row[C.ACTION] || '') !== HARD_RELEASE_ACTION) return;\n    if (String(row[C.TARGET_KEY] || '') !== quarterId) return;\n\n    const notes = String(row[C.NOTES] || '');\n    const at = notes.indexOf(HARD_RELEASE_KEY_PREFIX);",
    tests: ["tests/round75_cp_reset_thorough.test.js"]
  },
  {
    id: "cp-reset-any-quarter",
    why: "重設標記唔分季度",
    file: "src/SheetReader.gs",
    find: "    if (String(row[C.ACTION] || '') === QUARTER_RESET_AUDIT_ACTION\n      && String(row[C.TARGET_KEY] || '').trim() === quarterId) at = i;",
    replace: "    if (String(row[C.ACTION] || '') === QUARTER_RESET_AUDIT_ACTION) at = i;",
    tests: ["tests/round75_cp_reset_thorough.test.js"]
  },
  {
    id: "cp-extra-sheets-kept",
    why: "匯入／核對／建議表唔刪",
    file: "src/QuarterReset.gs",
    find: "    plan.extraSheetNames = listQuarterResetExtraSheetNames_(quarterId, ss.getSheets());",
    replace: "    plan.extraSheetNames = [];",
    tests: ["tests/round75_cp_reset_thorough.test.js"]
  },
  {
    id: "cp-extra-loose-match",
    why: "名字相似嘅建議表都刪",
    file: "src/QuarterReset.gs",
    find: "    if (name.indexOf(rosterPrefix) === 0 && /^\\d+_建議$/.test(name.slice(rosterPrefix.length))) out.push(name);",
    replace: "    if (name.indexOf(rosterPrefix) === 0 && /_建議/.test(name)) out.push(name);",
    tests: ["tests/round75_cp_reset_thorough.test.js"]
  },
  {
    id: "cp-titles-kept",
    why: "每週標題唔清",
    file: "src/QuarterReset.gs",
    find: "          sheet.getRange(i + 3, tCol + 1).setValue('');",
    replace: "          void 0;",
    tests: ["tests/round75_cp_reset_thorough.test.js"]
  },
  {
    id: "cp-no-person-notes",
    why: "確認清單冇列會影響這一季的人員設定",
    file: "src/QuarterReset.gs",
    find: "        plan.personSettingNotes.push((names[id] || id) + '　暫不擔任 '",
    replace: "        void (names[id] || id) + ('　暫不擔任 '",
    tests: ["tests/round75_cp_reset_thorough.test.js"]
  },
  {
    id: "cp-person-notes-expired",
    why: "已過期嘅人員設定都列出",
    file: "src/QuarterReset.gs",
    find: "        if (to && to < quarterStart) return;\n",
    replace: "",
    tests: ["tests/round75_cp_reset_thorough.test.js"]
  },
  {
    id: "da-blank-id-only",
    why: "清空只有名字嘅格當成冇改動（淨睇 PersonID）",
    file: "src/FineTune.gs",
    find: "    if (normalizedGrid === '' && !a.personId && !originalFreeText_(a)) {",
    replace: "    if (normalizedGrid === '' && !a.personId) {",
    tests: ["tests/round76_da_clear_name_cells.test.js"]
  },
  {
    id: "da-label-as-name",
    why: "顯示標籤（待填）被當成人名存入新版本",
    file: "src/FineTune.gs",
    find: "  return [labels.pending, labels.na, labels.specialSkip, labels.gap].indexOf(t) !== -1 ? '' : t;",
    replace: "  return t;",
    tests: ["tests/round76_da_clear_name_cells.test.js"]
  },
  {
    id: "da-clear-shows-gap",
    why: "清空講員格變成「⚠ 未能安排」",
    file: "src/StateSource.gs",
    find: "          && context.gridRender.autoGenerateByPostId[s.postId] === false) ? [RULE_IDS.NO_AUTO_GENERATE] : [])",
    replace: "          && false) ? [RULE_IDS.NO_AUTO_GENERATE] : [])",
    tests: ["tests/round76_da_clear_name_cells.test.js"]
  },
  {
    id: "da-req-clear-gap",
    why: "有申報嗰條儲存路清空講員格冇補原因",
    file: "src/RequestsApply.gs",
    find: "        ? [RULE_IDS.NO_AUTO_GENERATE] : (ruleFlagsByKey[key] || [])",
    replace: "        ? (ruleFlagsByKey[key] || []) : (ruleFlagsByKey[key] || [])",
    tests: ["tests/round76_da_clear_name_cells.test.js"]
  },
  {
    id: "db-send-no-name",
    why: "寄出確認窗把有名字嘅格當成沒有人",
    file: "src/SendWarnings.gs",
    find: "      freeText: originalFreeText_(a),\n",
    replace: "",
    tests: ["tests/round76_db_named_cells_not_blank.test.js"]
  },
  {
    id: "db-filled-id-only",
    why: "「有冇人」淨睇 PersonID",
    file: "src/SheetReader.gs",
    find: "  return String(name === null || name === undefined ? '' : name).trim() !== '';",
    replace: "  return false;",
    tests: ["tests/round76_db_named_cells_not_blank.test.js"]
  },
  {
    id: "db-pending-id-only",
    why: "待補格子淨睇 PersonID",
    file: "src/RequestsApply.gs",
    find: "    if (isCellFilled_(row[C.PERSON_ID], row[C.PERSON_NAME_SNAPSHOT]) || row[C.ASSIGN_SOURCE] !== ASSIGN_SOURCE.SKIPPED) return;",
    replace: "    if (row[C.PERSON_ID] || row[C.ASSIGN_SOURCE] !== ASSIGN_SOURCE.SKIPPED) return;",
    tests: ["tests/round76_db_named_cells_not_blank.test.js"]
  },
  {
    id: "db-import-no-name",
    why: "匯入預覽嘅外請講員冇帶名",
    file: "src/RosterImport.gs",
    find: "personId: '', freeText: typed, isManual: true",
    replace: "personId: '', isManual: true",
    tests: ["tests/round76_db_named_cells_not_blank.test.js"]
  },
  {
    id: "dc-temp-not-in-paper",
    why: "第 4 步名單冇臨時幫手",
    file: "src/WebAppMainFlow.gs",
    find: "      tempHelpers: split.tempHelpers,",
    replace: "      tempHelpers: [],",
    tests: ["tests/round76_dc_temp_helper_paper.test.js"]
  },
  {
    id: "dc-temp-not-preselect",
    why: "臨時幫手冇預設勾選",
    file: "src/ui/ScriptSendPaper.html",
    find: "      (s.tempHelpers || []).forEach((p) => { paperSelection_[p.personId] = true; });\n",
    replace: "",
    tests: ["tests/round76_dc_temp_helper_paper.test.js"]
  },
  {
    id: "dc-ui-no-temp-label",
    why: "名單冇標明臨時幫手",
    file: "src/ui/ScriptSendPaper.html",
    find: "      warn: '⚠ 臨時幫手，收不到電郵'",
    replace: "      warn: '⚠ 查不到電郵'",
    tests: ["tests/round76_dc_temp_helper_paper.test.js"]
  },
  {
    id: "dc-locate-by-id-only",
    why: "個人 PDF 搵唔到臨時幫手嗰幾格（淨睇 PersonID）",
    file: "src/PdfExport.gs",
    find: "    if (tempName) return !String(row[C.PERSON_ID] || '').trim() && String(row[C.PERSON_NAME_SNAPSHOT] || '').trim() === tempName;\n",
    replace: "",
    tests: ["tests/round76_dc_temp_helper_paper.test.js"]
  },
  {
    id: "dc-lookup-key-as-name",
    why: "臨時幫手檔名用咗「NAME:」鍵",
    file: "src/PdfExport.gs",
    find: "  if (tempName) return tempName;\n  const people",
    replace: "  const people",
    tests: ["tests/round76_dc_temp_helper_paper.test.js"]
  },
  {
    id: "dc-files-unfixable",
    why: "臨時幫手 PDF 被當成「NameMapping 查不到」",
    file: "src/PaperPack.gs",
    find: "    const nameTC = nameById[id] || tempHelperNameFromPaperKey_(id);",
    replace: "    const nameTC = nameById[id] || '';",
    tests: ["tests/round76_dc_temp_helper_paper.test.js"]
  },
  {
    id: "dc-count-mismatch",
    why: "寄出窗同第 4 步唔係同一份名單（收不到電郵漏咗臨時幫手）",
    file: "src/SheetReader.gs",
    find: "    if (autoByPost[String(row[A.POST_ID] || '').trim()] === true) tempCount[name] = (tempCount[name] || 0) + 1;\n    else external[name] = true;",
    replace: "    if (autoByPost[String(row[A.POST_ID] || '').trim()] === true) return;\n    else external[name] = true;",
    tests: ["tests/round76_dc_temp_helper_paper.test.js"]
  },
  {
    id: "ea-ongoing-beats-qtr",
    why: "長期行蓋過只限某一季嘅行（只限行應該優先）",
    file: "src/PersonPostWeight.gs",
    find: "  if (a.scope !== b.scope) return a.scope === WEIGHT_SCOPE.QUARTER;",
    replace: "  if (a.scope !== b.scope) return a.scope === WEIGHT_SCOPE.ONGOING;",
    tests: ["tests/round77_ea_weight_scope.test.js"]
  },
  {
    id: "ea-zero-row-skipped",
    why: "只限某一季嘅 Adjust=0 行被略過，蓋唔到長期偏好",
    file: "src/PersonPostWeight.gs",
    find: "    const key = personId + '|' + postId;\n    if (!candidates[key] || weightRowOutranks_(candidate, candidates[key])) candidates[key] = candidate;",
    replace: "    const key = personId + '|' + postId;\n    if (adjust === 0) return;\n    if (!candidates[key] || weightRowOutranks_(candidate, candidates[key])) candidates[key] = candidate;",
    tests: ["tests/round77_ea_weight_scope.test.js"]
  },
  {
    id: "ea-qtr-row-no-end",
    why: "只限這一季寫成長期行（冇 EffectiveTo）",
    file: "src/WebAppWeightEdit.gs",
    find: "        effectiveFrom: quarter.startDate, effectiveTo: quarter.endDate,",
    replace: "        effectiveFrom: quarter.startDate, effectiveTo: '',",
    tests: ["tests/round77_ea_weight_scope.test.js"]
  },
  {
    id: "ea-release-on-start",
    why: "之後各季都用：解除舊行填季初（唔係季初前一日），上一季會受影響",
    file: "src/WebAppWeightEdit.gs",
    find: "        wasAdjust: r.adjust, effectiveTo: dayBefore,",
    replace: "        wasAdjust: r.adjust, effectiveTo: quarter.startDate,",
    tests: ["tests/round77_ea_weight_scope.test.js"]
  },
  {
    id: "ea-matrix-ref-today",
    why: "偏好畫面用今日做參考日期（應該係所揀季度嘅開始日）",
    file: "src/WebAppWeightEdit.gs",
    find: "    const referenceDate = scope ? scope.startDate : today;",
    replace: "    const referenceDate = today;",
    tests: ["tests/round77_ea_weight_scope.test.js"]
  },
  {
    id: "ea-ui-default-future",
    why: "「也用於之後的季度」預設勾咗（Ivan：預設不勾）",
    file: "src/ui/ScriptZone3.html",
    find: "    futureBox.checked = weightApplyFuture;",
    replace: "    futureBox.checked = true;",
    tests: ["tests/round77_ea_weight_scope.test.js"]
  },
  {
    id: "ea-ui-no-scope-opts",
    why: "儲存時冇傳季度同範圍（後端會當冇季度）",
    file: "src/ui/ScriptZone3.html",
    find: "          const res = await callServerMutating('apiSavePersonPostWeightBatch', changes,\n            { quarterId: currentQuarterId, applyToFuture: weightApplyFuture === true });",
    replace: "          const res = await callServerMutating('apiSavePersonPostWeightBatch', changes);",
    tests: ["tests/round77_ea_weight_scope.test.js"]
  },
  {
    id: "eb-view-url-edit",
    why: "〔查看這一版〕嘅唯讀顯示網址砌成 /edit（擁有人可以改舊版本）",
    file: "src/WebAppDashboard.gs",
    find: "const GRID_SHEET_VIEW_SUFFIX = '/preview';",
    replace: "const GRID_SHEET_VIEW_SUFFIX = '/edit';",
    tests: ["tests/round77_eb_view_version_readonly.test.js"]
  },
  {
    id: "eb-choices-old-edit",
    why: "版本下拉舊版本嘅網址用 /edit",
    file: "src/WebAppRollback.gs",
    find: "        sheetUrl: versionNo === latestVersionNo\n          ? buildGridSheetUrl_(String(row[V.SHEET_NAME] || '').trim())\n          : buildGridSheetViewUrl_(String(row[V.SHEET_NAME] || '').trim()),",
    replace: "        sheetUrl: buildGridSheetUrl_(String(row[V.SHEET_NAME] || '').trim()),",
    tests: ["tests/round77_eb_view_version_readonly.test.js"]
  },
  {
    id: "eb-open-returns-edit",
    why: "apiOpenVersionForViewing 回 /edit 網址",
    file: "src/WebAppRollback.gs",
    find: "    url: target === findLatestVersionNo(quarterId)\n      ? buildGridSheetUrl_(found.sheetName) : buildGridSheetViewUrl_(found.sheetName),",
    replace: "    url: buildGridSheetUrl_(found.sheetName),",
    tests: ["tests/round77_eb_view_version_readonly.test.js"]
  },
  {
    id: "ec-counts-not-saved",
    why: "registerVersion 冇寫 ChangeCounts（版本來源永遠冇格數）",
    file: "src/RosterWriter.gs",
    find: "  record[C.CHANGE_COUNTS] = formatVersionChangeCounts_(changeCounts || null);",
    replace: "  record[C.CHANGE_COUNTS] = '';",
    tests: ["tests/round77_ec_version_source_counts.test.js"]
  },
  {
    id: "ec-no-header-ensure",
    why: "舊試算表冇 ChangeCounts 欄嗰陣唔補欄（數字靜靜被丟）",
    file: "src/RosterWriter.gs",
    find: "  if (headers.indexOf(C.CHANGE_COUNTS) === -1) {",
    replace: "  if (false) {",
    tests: ["tests/round77_ec_version_source_counts.test.js"]
  },
  {
    id: "ec-text-drops-system",
    why: "來源文字漏咗「系統調整 M 格」",
    file: "src/WebAppDashboard.gs",
    find: "  const system = counts.system > 0 ? '系統調整 ' + counts.system + ' 格' : '';",
    replace: "  const system = '';",
    tests: ["tests/round77_ec_version_source_counts.test.js"]
  },
  {
    id: "ec-start-counts-all",
    why: "用舊版本作起點嗰陣，起點寫入嘅格全部當成人手改動",
    file: "src/WebAppSaveConfirm.gs",
    find: "      : countManualChangesBeyondStartPoint_(quarterId, startPointNo, resolved.changes, context),",
    replace: "      : resolved.changes.length,",
    tests: ["tests/round77_ec_version_source_counts.test.js"]
  },
  {
    id: "ec-accept-no-counts",
    why: "接受建議嗰陣冇把人手／系統格數寫入版本",
    file: "src/SuggestionSheet.gs",
    // 第七十八輪批次 FC 組：人手格數加咗類型改動
    find: "  const changeCounts = fp && fp.counts\n    ? { manual: fp.counts.manual + titleChanges.length, system: fp.counts.system, startPoint: null } : null;",
    replace: "  const changeCounts = null;",
    tests: ["tests/round77_ec_version_source_counts.test.js"]
  },
  {
    id: "ec-fp-no-counts",
    why: "建立建議表嗰陣冇記低幹事改咗幾多格",
    file: "src/SuggestionSheet.gs",
    find: "  const manual = counts ? Math.round(Number(counts.manual)) || 0 : '';",
    replace: "  const manual = '';",
    tests: ["tests/round77_ec_version_source_counts.test.js"]
  },
  {
    id: "ec-dash-old-text",
    why: "狀態卡仍然用舊嘅來源文字（同版本下拉唔一致）",
    file: "src/WebAppDashboard.gs",
    find: "      basisText: row ? buildVersionSourceText_(row) : '（沒有說明）',",
    replace: "      basisText: row ? buildVersionBasisText_(row[V.BASIS]) : '（沒有說明）',",
    tests: ["tests/round77_ec_version_source_counts.test.js"]
  },
  {
    id: "ed-save-secondary",
    why: "〔儲存〕又變返灰色次要按鈕（Ivan：要同〔查看／修改職事表〕一樣顯眼）",
    file: "src/ui/ScriptMainFlow.html",
    find: "      className: 'primary-big',\n      title: save.enabled ? '' : (save.disabledReason || '')",
    replace: "      className: 'secondary',\n      title: save.enabled ? '' : (save.disabledReason || '')",
    tests: ["tests/round77_ed_save_button_primary.test.js"]
  },
  {
    id: "ed-save-small",
    why: "〔儲存〕字體內距同〔查看／修改職事表〕唔一樣",
    file: "src/ui/ScriptMainFlow.html",
    find: "    saveBtn.style.fontSize = 'var(--fs-lg)';\n    saveBtn.style.padding = '12px 22px';\n",
    replace: "",
    tests: ["tests/round77_ed_save_button_primary.test.js"]
  },
  {
    id: "ee-pick-empty-extra",
    why: "只填自行輸入電郵、一位都冇勾 ⇒ 又變返「一位都沒有選」寄唔出",
    file: "src/SendOptions.gs",
    find: "  if (scope === SEND_RECIPIENT_SCOPE.PICK && pickedCount === 0 && extraEmails.length === 0) {",
    replace: "  if (scope === SEND_RECIPIENT_SCOPE.PICK && pickedCount === 0) {",
    tests: ["tests/round77_ee_send_buttons.test.js"]
  },
  {
    id: "ee-all-no-reason",
    why: "〔給所有人〕喺正式發出之後冇俾每人一個理由（內容冇變嘅會被 SKIPPED_UNCHANGED 擋走）",
    file: "src/ResendFlow.gs",
    find: "          context.notifyReasonByPerson[key] = decision.sendMode === SEND_MODE.ALL\n            ? '幹事選擇寄給所有人（包括安排沒有改動的人）'\n            : '幹事指定要寄給這一位';",
    replace: "          context.notifyReasonByPerson[key] = '幹事指定要寄給這一位';",
    tests: ["tests/round77_ee_send_buttons.test.js", "tests/send_options.test.js"]
  },
  {
    id: "ee-allkind-none",
    why: "正式發出之後、冇人改過 ⇒〔給所有人〕變成「現在沒有可以寄的東西」",
    file: "src/WebAppSendPlan.gs",
    find: "  if (state && state.stage === QUARTER_STAGE.OFFICIAL_SENT && !unsaved) return SEND_KIND.RESEND;",
    replace: "  if (false) return SEND_KIND.RESEND;",
    tests: ["tests/round77_ee_send_buttons.test.js"]
  },
  {
    id: "ee-all-drops-noemail",
    why: "〔給所有人〕唔講有幾多位冇電郵（第 4 步要印紙本嘅人靜靜消失）",
    file: "src/WebAppSendPlan.gs",
    find: "      noEmailCount: noEmail.length,",
    replace: "      noEmailCount: 0,",
    tests: ["tests/round77_ee_send_buttons.test.js"]
  },
  {
    id: "ee-default-fixed-again",
    why: "〔選擇其他〕又預設勾返固定收件人（唔係有改動嗰組）",
    file: "src/WebAppSendPlan.gs",
    find: "      defaultPickedKeys: defaultPickedKeysForChanged_(snap.pool, snap.lastSent),",
    replace: "      defaultPickedKeys: defaultPickedKeysForStage_(sendKindToStage_(kind) || MAIL_STAGES.OFFICIAL, snap.fixedMembers),",
    tests: ["tests/send_fixed_recipients.test.js"]
  },
  {
    id: "ee-changed-incl-notrecv",
    why: "〔變動的人〕把「上一次沒有收到」嘅人都列入（寄出窗同確認窗人數唔一致）",
    file: "src/WebAppSendPlan.gs",
    find: "    const people = (plan.changed || []).filter(function (c) { return c.arrangementChanged; }).map(function (c) {",
    replace: "    const people = (plan.changed || []).filter(function (c) { return true; }).map(function (c) {",
    tests: ["tests/round77_ee_send_buttons.test.js"]
  },
  {
    id: "ee-official-once-narrow",
    why: "officialSentOnce 只認 OFFICIAL（改動後重發／系統外寄出過都唔算正式發出過）",
    file: "src/WebAppDashboard.gs",
    find: "    if (stage === MAIL_STAGES.OFFICIAL || stage === MAIL_STAGES.RESEND\n        || String(row[C.STATUS] || '').trim().toUpperCase() === MAIL_STATUS.EXTERNAL) {\n      officialSentOnce = true;\n    }",
    replace: "    if (stage === MAIL_STAGES.OFFICIAL) officialSentOnce = true;",
    tests: ["tests/round77_ee_send_buttons.test.js"]
  },
  {
    id: "ee-step5-ignores-all",
    why: "改動後重發嘅計劃入口唔認〔給所有人〕（冇人改過就當 NO_CHANGES）",
    file: "src/WebAppFlow.gs",
    find: "  if (changedPlan.changed.length > 0 || resendHasExplicitRecipients_(sendOptions)) {",
    replace: "  if (changedPlan.changed.length > 0) {",
    tests: ["tests/round77_ee_send_buttons.test.js"]
  },
  {
    id: "ee-config-default-false",
    why: "SEND_ALL_INCLUDES_FIXED 種子預設 FALSE（辦公室收唔到正式發出）",
    file: "src/ConfigSeed.gs",
    find: "      key: CONFIG_KEYS.SEND_ALL_INCLUDES_FIXED, type: CONFIG_TYPES.BOOL, group: 'MAIL',\n      defaultValue: 'TRUE',",
    replace: "      key: CONFIG_KEYS.SEND_ALL_INCLUDES_FIXED, type: CONFIG_TYPES.BOOL, group: 'MAIL',\n      defaultValue: 'FALSE',",
    tests: ["tests/round77_ee_send_buttons.test.js"]
  },
  {
    id: "ee-ui-save-continue",
    why: "未儲存窗又出返〔立即儲存並繼續〕、冇〔寄出上一個版本〕",
    file: "src/ui/ScriptSendPaper.html",
    find: "      acts.push(button('寄出上一個版本（' + versionText + '）', () => {\n        closeModal();\n        // ⚠️ `allowUnsaved: true` —— **布林 `true`，唔係字串**。後端 `resolveAllowUnsavedFlag_()` 只認布林。\n        renderSendMain(s, { allowUnsaved: true });\n      }, 'secondary'));",
    replace: "      acts.push(button('立即儲存並繼續', () => { closeModal(); openSaveAndConfirm(); }, ''));",
    tests: ["tests/round77_ee_send_buttons.test.js"]
  },
  {
    id: "ee-ui-all-has-picker",
    why: "〔給所有人〕主窗仲有〔選擇收件人〕",
    file: "src/ui/ScriptSendPaper.html",
    find: "    if (sendMode_ === 'ALL') {\n      const d = sendModeData_ || {};\n      if (d.noEmailCount > 0) {",
    replace: "    if (sendMode_ === 'ALL' && false) {\n      const d = sendModeData_ || {};\n      if (d.noEmailCount > 0) {",
    tests: ["tests/round77_ee_send_buttons.test.js"]
  },
  {
    id: "ee-ui-no-auto-picker",
    why: "〔選擇其他〕唔會自動打開〔選擇收件人〕",
    file: "src/ui/ScriptSendPaper.html",
    find: "    if (!pickerAutoOpened_) {\n      pickerAutoOpened_ = true;\n      openSendRecipients(s);\n    }\n",
    replace: "",
    tests: ["tests/round77_ee_send_buttons.test.js"]
  },
  {
    id: "ee-ui-old-list-label",
    why: "收件人視窗嗰粒掣仲叫〔用這一份名單〕",
    file: "src/ui/ScriptSendPaper.html",
    find: "        button('確認', () => {\n          sendOptions_.pickedKeys = Object.keys(selected).filter((k) => selected[k] === true);",
    replace: "        button('用這一份名單', () => {\n          sendOptions_.pickedKeys = Object.keys(selected).filter((k) => selected[k] === true);",
    tests: ["tests/round77_ee_send_buttons.test.js"]
  },
  {
    id: "ee-ui-changed-always",
    why: "〔變動的人〕未正式發出都可以撳",
    file: "src/ui/ScriptMainFlow.html",
    find: "          disabled: !has || !officialOnce,",
    replace: "          disabled: !has,",
    tests: ["tests/round77_ee_send_buttons.test.js"]
  },
  {
    id: "ee-ui-resend-all-text",
    why: "〔給所有人〕嘅改動後重發確認窗冇寫明「全部 N 位都會收到」",
    file: "src/ui/ScriptZone1.html",
    find: "      if (plan.sendMode === 'ALL') {\n        nodes.unshift(",
    replace: "      if (false) {\n        nodes.unshift(",
    tests: ["tests/round77_ee_send_buttons.test.js"]
  },
  {
    id: "ef-zone3-collapsed",
    why: "常用設定一開始又係摺埋（Ivan：預設展開）",
    file: "src/ui/Index.html",
    find: "    <button class=\"zone-head\" id=\"zone3Head\" type=\"button\" aria-expanded=\"true\">",
    replace: "    <button class=\"zone-head\" id=\"zone3Head\" type=\"button\" aria-expanded=\"false\">",
    tests: ["tests/round77_ef_settings_zone.test.js"]
  },
  {
    id: "ef-zone3-not-rerender",
    why: "重新整理／換季度之後常用設定唔會再展開重畫",
    file: "src/ui/Script.html",
    find: "    if (typeof renderZone3Always === 'function') renderZone3Always(dashboardState_);\n",
    replace: "",
    tests: ["tests/round77_ef_settings_zone.test.js"]
  },
  {
    id: "ef-people-link-back",
    why: "〔人員與電郵〕又出返嚟",
    file: "src/ui/ScriptZone3.html",
    find: "    body.appendChild(row([\n      settingsSheetLink('身分（堂委／執事）', links.roles, 'Roles'),",
    replace: "    body.appendChild(row([\n      settingsSheetLink('人員與電郵', links.people, 'NameMapping'),\n      settingsSheetLink('身分（堂委／執事）', links.roles, 'Roles'),",
    tests: ["tests/round77_ef_settings_zone.test.js"]
  },
  {
    id: "ef-active-sentence",
    why: "「Active 改成 FALSE」嗰句又出返嚟",
    file: "src/ui/ScriptZone3.html",
    find: "      + '身分和固定收件人在試算表那一張工作表改（會在新分頁打開）。'));",
    replace: "      + '身分和固定收件人在試算表那一張工作表改（會在新分頁打開）。不再服侍的人請把「Active」改成 FALSE。'));",
    tests: ["tests/round77_ef_settings_zone.test.js"]
  },
  {
    id: "eg-sync-overwrites-name",
    why: "同步嗰陣連 NameTC 都改成出席系統嘅寫法（Ivan：名字保留職事表寫法）",
    file: "src/HwcasSync.gs",
    find: "    if (Object.keys(updates).length === 0) return;\n    updates[M.SYNCED_AT] = now;",
    replace: "    updates[M.NAME_TC] = h['name'];\n    updates[M.SYNCED_AT] = now;",
    tests: ["tests/round77_eg_hwcas_method_a.test.js"]
  },
  {
    id: "eg-sync-keeps-old-email",
    why: "出席系統空白嗰陣唔清空（電郵應該跟出席系統）",
    file: "src/HwcasSync.gs",
    find: "    const emailChanged = oldEmail !== h.email;",
    replace: "    const emailChanged = oldEmail !== h.email && h.email !== '';",
    tests: ["tests/round77_eg_hwcas_method_a.test.js"]
  },
  {
    id: "eg-dup-no-still-syncs",
    why: "兩行同一個編號都照改（應該列入「重複」、兩位都唔改）",
    file: "src/HwcasSync.gs",
    find: "    if (people.length > 1) {\n      // 兩行用同一個編號 ⇒ 唔知邊一行先係佢，一律唔改，列出嚟\n      duplicates.push({ memberNo: no, people: people.map(function (p) { return { personId: p.personId, nameTC: p.nameTC }; }) });\n      return;\n    }",
    replace: "    if (people.length > 1) {\n      duplicates.push({ memberNo: no, people: people.map(function (p) { return { personId: p.personId, nameTC: p.nameTC }; }) });\n    }",
    tests: ["tests/round77_eg_hwcas_method_a.test.js"]
  },
  {
    id: "eg-no-10min-skip",
    why: "寄出前每次都重讀出席系統（10 分鐘內應該略過）",
    file: "src/SheetReader.gs",
    find: "  if (o.force !== true && status.lastAtMs > 0 && Date.now() - status.lastAtMs < HWCAS_SYNC_MIN_INTERVAL_MS) {",
    replace: "  if (false) {",
    tests: ["tests/round77_eg_hwcas_method_a.test.js"]
  },
  {
    id: "eg-read-fail-throws",
    why: "讀唔到出席系統就拋錯（會令主畫面／寄出失敗）",
    file: "src/SheetReader.gs",
    find: "  } catch (err) {\n    log_('WARN', '出席系統同步失敗（照用上次的電郵）：' + err.message);",
    replace: "  } catch (err) {\n    throw err;",
    tests: ["tests/round77_eg_hwcas_method_a.test.js"]
  },
  {
    id: "eg-link-changes-name",
    why: "〔連結勾了的人〕順手把名字改成出席系統嘅寫法",
    file: "src/WebAppHwcas.gs",
    find: "    updates[M.MEMBER_NO] = memberNo.value;\n    const derived = deriveCongregationAndType_(key, prefixMap);",
    replace: "    updates[M.MEMBER_NO] = memberNo.value;\n    updates[M.NAME_TC] = hwcas.byNo[key].name + '（出席系統）';\n    const derived = deriveCongregationAndType_(key, prefixMap);",
    tests: ["tests/round77_eg_hwcas_method_a.test.js"]
  },
  {
    id: "eg-link-no-sync-after",
    why: "連結完唔即時更新電郵",
    file: "src/WebAppHwcas.gs",
    find: "  const sync = linked.length > 0 ? runHwcasSyncSafely_({ force: true }) : null;",
    replace: "  const sync = null;",
    tests: ["tests/round77_eg_hwcas_method_a.test.js"]
  },
  {
    id: "eg-add-uses-hwcas-name",
    why: "〔加入名單〕新行用出席系統嘅名（應該用職事表寫法）",
    file: "src/WebAppHwcas.gs",
    find: "  record[M.NAME_TC] = nameTC;                    // ⚠️ 職事表上嘅寫法，唔係出席系統嘅",
    replace: "  record[M.NAME_TC] = entry['name'];",
    tests: ["tests/round77_eg_hwcas_method_a.test.js"]
  },
  {
    id: "eg-add-dup-member-no",
    why: "編號已經喺名單上都照新增多一個人",
    file: "src/WebAppHwcas.gs",
    find: "  if (existing) {\n    return {\n      ok: false, existing: existing, canAlias: existing.nameTC !== nameTC,",
    replace: "  if (false) {\n    return {\n      ok: false, existing: existing, canAlias: existing.nameTC !== nameTC,",
    tests: ["tests/round77_eg_hwcas_method_a.test.js"]
  },
  {
    id: "eg-add-not-in-hwcas",
    why: "出席系統搵唔到都照新增（應該唔可以）",
    file: "src/WebAppHwcas.gs",
    find: "  const entry = hwcas.byNo[key];\n  if (!entry) {",
    replace: "  const entry = hwcas.byNo[key] || { name: '', email: '', names: [] };\n  if (false) {",
    tests: ["tests/round77_eg_hwcas_method_a.test.js"]
  },
  {
    id: "eg-dash-no-sync-line",
    why: "主畫面冇「電郵已由出席系統更新（…）」／「讀不到出席系統」嗰句",
    file: "src/WebAppDashboard.gs",
    find: "    hwcasSync: describeHwcasSyncForDashboard_(),",
    replace: "    hwcasSync: { line: '', errorText: '', syncedAtText: '' },",
    tests: ["tests/round77_eg_hwcas_method_a.test.js"]
  },
  {
    id: "eg-send-no-presync",
    why: "寄出路寄信之前唔同步",
    file: "src/WebAppFlow.gs",
    find: "  logSendWithUnsavedRelease_(quarterId, '正式發出給全體', guard);\n  // 第七十七輪批次 EG 組：寄之前由出席系統更新電郵\n  syncPeopleFromHwcasBeforeSend_();",
    replace: "  logSendWithUnsavedRelease_(quarterId, '正式發出給全體', guard);",
    tests: ["tests/round77_eg_hwcas_method_a.test.js"]
  },
  {
    id: "eg-ui-manual-email",
    why: "〔加入名單〕畫面又有人手打電郵嘅格",
    file: "src/ui/ScriptZone1.html",
    find: "      if (!r.ok) {\n        nodes.push(make('div', { className: 'warnbox' }, [make('div', { text: r.message || '讀不到出席系統。', className: 'warn-head' })]));",
    replace: "      const emailInput = document.createElement('input'); emailInput.type = 'text'; emailInput.placeholder = '電郵'; nodes.push(emailInput);\n      if (!r.ok) {\n        nodes.push(make('div', { className: 'warnbox' }, [make('div', { text: r.message || '讀不到出席系統。', className: 'warn-head' })]));",
    tests: ["tests/round77_eg_hwcas_method_a.test.js"]
  },
  {
    id: "eg-ui-no-load-sync",
    why: "幹事介面載入時唔叫出席系統同步",
    file: "src/ui/ScriptBoot.html",
    find: "  runAction('載入中', async () => { await loadQuarters(); syncHwcasOnLoad(); });",
    replace: "  runAction('載入中', loadQuarters);",
    tests: ["tests/round77_eg_hwcas_method_a.test.js"]
  },
  {
    id: "eh-f1-no-ts-guard",
    why: "起點標記唔睇時間（重設前留低嘅舊標記又會變成今次嘅起點）",
    file: "src/SheetReader.gs",
    find: "    if (ts) {\n      if (g.versionCreatedAt && ts < g.versionCreatedAt) return;\n      if (g.lastResetAt && ts < g.lastResetAt) return;\n    }\n",
    replace: "",
    tests: ["tests/round77_eh_round76_gaps.test.js"]
  },
  {
    id: "eh-f1-no-reset-guard",
    why: "起點標記唔理該季最後一次重設",
    file: "src/SheetReader.gs",
    find: "      if (g.lastResetAt && ts < g.lastResetAt) return;\n",
    replace: "",
    tests: ["tests/round77_eh_round76_gaps.test.js"]
  },
  {
    id: "eh-f2-flags-only",
    why: "「沒有人」又靠上一版旗標判斷（清空嘅講員／獻花被當成空格）",
    file: "src/FineTune.gs",
    find: "    if (autoByPost && autoByPost[s.postId] === false) return false;\n",
    replace: "",
    tests: ["tests/round77_eh_round76_gaps.test.js"]
  },
  {
    id: "eh-f3-no-temp-helper",
    why: "第 4 步卡片標題又漏計臨時幫手",
    file: "src/WebAppMainFlow.gs",
    find: "  return split.noEmail.concat(split.tempHelpers || []);",
    replace: "  return split.noEmail;",
    tests: ["tests/round77_eh_round76_gaps.test.js"]
  },
  {
    id: "eh-wording-no-ranges",
    why: "版本號唔合併（又係「第 1 及第 2 及第 3…」）",
    file: "src/WebAppSendPlan.gs",
    find: "    const ranges = formatVersionNoRanges_(tail);",
    replace: "    const ranges = tail.map(String);",
    tests: ["tests/round77_eh_round76_gaps.test.js"]
  },
  // ── 第七十八輪批次 FA 組：〔給所有人〕確認窗每一位都有現時安排 ──
  {
    id: "fa-no-current-summary",
    why: "唔喺改動名單入面嘅收件人冇「現在」摘要（又變成「這一季沒有安排」）",
    file: "src/WebAppGuards.gs",
    find: "      currentSummary = now ? now.currentSummary : '';",
    replace: "      currentSummary = '';",
    tests: ["tests/round78_fa_sendall_current.test.js"]
  },
  {
    id: "fa-has-assign-false",
    why: "唔喺改動名單入面嘅收件人一律當冇崗位",
    file: "src/WebAppGuards.gs",
    find: "      hasAssignments = currentByPerson ? !!now : null;",
    replace: "      hasAssignments = false;",
    tests: ["tests/round78_fa_sendall_current.test.js"]
  },
  {
    id: "fa-flow-no-current",
    why: "apiStep5Plan() 冇把每一位嘅現時安排傳入確認窗",
    file: "src/WebAppFlow.gs",
    find: "readResendChangeNotes_(quarterId, changedPlan.versionNo), changedPlan.currentByPerson);",
    replace: "readResendChangeNotes_(quarterId, changedPlan.versionNo));",
    tests: ["tests/round78_fa_sendall_current.test.js"]
  },
  {
    id: "fa-unknown-as-none",
    why: "攞唔到「現在」資料嗰陣扮冇安排",
    file: "src/ui/ScriptZone1.html",
    find: "      ? '這一季沒有安排' : (c.currentSummary || '（現在的安排沒有記錄）'));",
    replace: "      ? '這一季沒有安排' : (c.currentSummary || '（這一季沒有安排）'));",
    tests: ["tests/round78_fa_sendall_current.test.js"]
  },
  {
    id: "fa-ui-no-unchanged",
    why: "冇改動嘅人冇寫「安排沒有改動」",
    file: "src/ui/ScriptZone1.html",
    find: "      item.appendChild(make('div', { text: '安排沒有改動', className: 'vio-row muted' }));\n",
    replace: "",
    tests: ["tests/round78_fa_sendall_current.test.js"]
  },
  // ── 第七十八輪批次 FB 組：儲存新版本時還原舊表；〔查看這一版〕先準備、後開啟 ──
  {
    id: "fb-save-no-restore",
    why: "〔儲存〕之後舊表留住人手改動（查看舊版本見到嘅唔係嗰一版）",
    file: "src/WebAppSaveConfirm.gs",
    find: "    : restoreBaseSheetAfterNewVersion_(quarterId, plan.baseVersionNo, 'apiSaveAndConfirmExecute').failed;",
    replace: "    : '';",
    tests: ["tests/round78_fb_base_sheet_restore.test.js"]
  },
  {
    id: "fb-accept-no-restore",
    why: "接受建議之後舊表留住人手改動",
    file: "src/SuggestionSheet.gs",
    find: "  const baseSheetRestore = restoreBaseSheetAfterNewVersion_(quarterId, versionNo, 'apiAcceptSuggestion');",
    replace: "  const baseSheetRestore = { restoredCells: 0, failed: '' };",
    tests: ["tests/round78_fb_base_sheet_restore.test.js"]
  },
  {
    id: "fb-requests-no-restore",
    why: "套用修改申報（步驟 3、5、〔儲存〕有申報）之後舊表冇還原",
    file: "src/RequestsApply.gs",
    find: "  const baseSheetRestore = restoreBaseSheetAfterNewVersion_(plan.quarterId, plan.baseVersionNo, 'applyRequests_');",
    replace: "  const baseSheetRestore = { restoredCells: 0, failed: '' };",
    tests: ["tests/round78_fb_base_sheet_restore.test.js"]
  },
  {
    id: "fb-restore-fail-throws",
    why: "舊表還原唔到就令成個儲存失敗（新版本其實已經建立咗）",
    file: "src/SheetReader.gs",
    find: "    out.failed = String((err && err.message) || err);\n",
    replace: "    throw err;\n",
    tests: ["tests/round78_fb_base_sheet_restore.test.js"]
  },
  {
    id: "fb-view-fire-forget",
    why: "〔查看這一版〕又變返射後不理（未還原完就開網址）",
    file: "src/ui/ScriptMainFlow.html",
    find: "      const r = await callServerMutating('apiOpenVersionForViewing', currentQuarterId, v.versionNo);",
    replace: "      const r = {}; callServerMutating('apiOpenVersionForViewing', currentQuarterId, v.versionNo);",
    tests: ["tests/round78_fb_base_sheet_restore.test.js"]
  },
  {
    id: "fb-view-no-warnbox",
    why: "〔查看這一版〕還原失敗時沉默（冇黃框）",
    file: "src/ui/ScriptMainFlow.html",
    find: "      if (r && r.restoreFailed) {",
    replace: "      if (false) {",
    tests: ["tests/round78_fb_base_sheet_restore.test.js"]
  },
  {
    id: "fb-done-no-warnbox",
    why: "儲存完成窗唔講舊表還原唔到",
    file: "src/ui/Script.html",
    find: "    if (!result || !result.baseSheetRestoreFailed) return null;",
    replace: "    return null;",
    tests: ["tests/round78_fb_base_sheet_restore.test.js"]
  },
  // ── 第七十八輪批次 FC 組：接受建議時帶入「類型」改動；人手格數包括類型 ──
  {
    id: "fc-accept-drop-title",
    why: "接受建議時類型改動靜靜丟咗（新一版返返原本嘅類型）",
    file: "src/SuggestionSheet.gs",
    find: "  if (titleChanges.length > 0) {\n    writeWeekTitles_(quarterId, titleChanges, timezone, 'apiAcceptSuggestion');\n  }\n",
    replace: "",
    tests: ["tests/round78_fc_title_on_accept.test.js"]
  },
  {
    id: "fc-accept-manual-no-ttl",
    why: "接受建議嘅人手格數唔計類型（同〔檢查我的改動〕對唔上）",
    file: "src/SuggestionSheet.gs",
    find: "    ? { manual: fp.counts.manual + titleChanges.length, system: fp.counts.system, startPoint: null } : null;",
    replace: "    ? { manual: fp.counts.manual, system: fp.counts.system, startPoint: null } : null;",
    tests: ["tests/round78_fc_title_on_accept.test.js"]
  },
  {
    id: "fc-save-manual-no-ttl",
    why: "〔儲存〕嘅人手格數唔計類型",
    file: "src/WebAppSaveConfirm.gs",
    find: "      ? resolved.changes.length + titleChanges.length\n",
    replace: "      ? resolved.changes.length\n",
    tests: ["tests/round78_fc_title_on_accept.test.js"]
  },
  {
    id: "fc-sug-title-ignored",
    why: "建議表上改嘅類型冇帶入（唔係以建議表為準）",
    file: "src/SuggestionSheet.gs",
    find: "  (fromSuggestion || []).forEach(function (c) { byDate[c.serviceDate] = c; });\n",
    replace: "",
    tests: ["tests/round78_fc_title_on_accept.test.js"]
  },
  {
    id: "fc-done-no-title-row",
    why: "接受建議完成窗冇列類型嗰一行",
    file: "src/SuggestionSheet.gs",
    find: "      }), acceptPostNames, 'MANUAL').concat(buildWeekTitleChangeRows_(titleChanges)),",
    replace: "      }), acceptPostNames, 'MANUAL'),",
    tests: ["tests/round78_fc_title_on_accept.test.js"]
  },
  // ── 第七十八輪批次 FD 組：〔儲存〕確認窗嘅字眼 ──
  {
    id: "fd-spec-old-wording",
    why: "介面規格又寫返「儲存前的確認窗」（一切正常其實唔出）",
    file: "docs/幹事介面規格.md",
    find: "  （當時：確認畫面多了一個 ☐ 儲存之後直接去寄出，**預設不勾**；",
    replace: "  儲存前的確認窗多了一個 ☐ 儲存之後直接去寄出，**預設不勾**；",
    tests: ["tests/round78_fd_save_wording.test.js"]
  },
  {
    id: "fd-scan-misses-old",
    why: "靜態檢查捉唔到「儲存前的確認窗」",
    file: "tools/scan-static-risks.js",
    find: "  /儲存前的確認窗/,\n",
    replace: "",
    tests: ["tests/round78_fd_save_wording.test.js"]
  },
  // ── 第七十八輪批次 FE 組：快路只睇今次帶出嘅「盡量避免」──
  {
    id: "fe-ui-all-semi-hard",
    why: "上一版已存嘅「盡量避免」又令每次儲存都彈確認窗",
    file: "src/ui/ScriptZone1.html",
    find: "      && (Array.isArray(v.semiHardNew) ? v.semiHardNew : (v.semiHard || [])).length === 0",
    replace: "      && (v.semiHard || []).length === 0",
    tests: ["tests/round78_fe_semi_hard_new.test.js"]
  },
  {
    id: "fe-new-ignores-base",
    why: "唔同上一版比，全部「盡量避免」都當新",
    file: "src/WebAppSaveConfirm.gs",
    // 第八十一輪批次 HA 組：比較抽咗做 `filterNewSinceBase_()`（保留格共用）
    find: "  return filterNewSinceBase_(list, index);\n}",
    replace: "  return list.slice();\n}",
    tests: ["tests/round78_fe_semi_hard_new.test.js"]
  },
  {
    id: "fe-new-drops-all",
    why: "今次帶出嘅「盡量避免」都當舊（快路靜靜儲存）",
    file: "src/WebAppSaveConfirm.gs",
    find: "  return filterNewSinceBase_(list, index);\n}",
    replace: "  return [];\n}",
    tests: ["tests/round78_fe_semi_hard_new.test.js"]
  },
  {
    id: "fe-fail-not-safe",
    why: "上一版算唔到就當冇新違反",
    file: "src/WebAppSaveConfirm.gs",
    find: "  if (!baseIndex) return l.slice();",
    replace: "  if (!baseIndex) return [];",
    tests: ["tests/round78_fe_semi_hard_new.test.js"]
  },
  // ── 第七十九輪批次 GA 組：個人 PDF 缺件檢查跟這一次揀嘅附件 ──
  {
    id: "ga-ui-no-sendopts",
    why: "前端問缺件檢查冇帶寄出窗揀嘅附件（揀「不附」都要等產生 PDF）",
    file: "src/ui/ScriptZone1.html",
    find: "'apiStep4GetMissingPdfWarnings', currentQuarterId, versionNo, sendOpts);",
    replace: "'apiStep4GetMissingPdfWarnings', currentQuarterId, versionNo);",
    tests: ["tests/round79_ga_pdf_gate_by_attach.test.js"]
  },
  {
    id: "ga-attach-from-template",
    why: "缺件檢查淨係睇範本，唔睇幹事今次揀嘅附件",
    file: "src/PdfBatch.gs",
    find: "  if (sendOptions && typeof sendOptions === 'object') {\n    const decision",
    replace: "  if (false && sendOptions && typeof sendOptions === 'object') {\n    const decision",
    tests: ["tests/round79_ga_pdf_gate_by_attach.test.js"]
  },
  {
    id: "ga-gate-loosened",
    why: "揀咗個人版 PDF 都唔查缺件（放寬）",
    file: "src/PdfBatch.gs",
    find: "    return decision.attachType === ATTACH_TYPE.PERSONAL_PDF;",
    replace: "    return false;",
    tests: ["tests/round79_ga_pdf_gate_by_attach.test.js"]
  },
  {
    id: "ga-send-gate-no-opts",
    why: "後端寄出閘門唔跟幹事揀嘅附件",
    file: "src/FiveStageCore.gs",
    find: "    checkMissingPersonalPdfs_(quarterId, versionNo, MAIL_STAGES.OFFICIAL, sendOptions));",
    replace: "    checkMissingPersonalPdfs_(quarterId, versionNo, MAIL_STAGES.OFFICIAL));",
    tests: ["tests/round79_ga_pdf_gate_by_attach.test.js"]
  },
  {
    id: "ga-plan-no-opts",
    why: "前端問嘅缺件計劃冇傳附件落去檢查",
    file: "src/FiveStageCore.gs",
    find: "  const result = checkMissingPersonalPdfs_(quarterId, versionNo, MAIL_STAGES.OFFICIAL, sendOptions);",
    replace: "  const result = checkMissingPersonalPdfs_(quarterId, versionNo, MAIL_STAGES.OFFICIAL);",
    tests: ["tests/round79_ga_pdf_gate_by_attach.test.js"]
  },
  {
    id: "ga-api-drops-opts",
    why: "網頁入口收咗 sendOptions 但冇交俾缺件計劃",
    file: "src/WebAppFlow.gs",
    find: "  const missingCheck = planStep4MissingPdf_(quarterId, versionNo, sendOptions);",
    replace: "  const missingCheck = planStep4MissingPdf_(quarterId, versionNo);",
    tests: ["tests/round79_ga_pdf_gate_by_attach.test.js"]
  },
  {
    id: "ga-makeup-no-attach",
    why: "補寄缺件檢查唔用這一次實際附件（範本寫另一種就當唔需要）",
    file: "src/MakeupSend.gs",
    find: "  const check = checkMissingPersonalPdfs_(plan.quarterId, plan.versionNo, plan.stage,\n    { attachType: ATTACH_TYPE.PERSONAL_PDF });",
    replace: "  const check = checkMissingPersonalPdfs_(plan.quarterId, plan.versionNo, plan.stage);",
    tests: ["tests/round79_ga_pdf_gate_by_attach.test.js"]
  },
  {
    id: "ga-menu-ignores-template",
    why: "冇傳 sendOptions（選單版）都唔再照範本",
    file: "src/PdfBatch.gs",
    find: "  return !!template && String(template.attachType || '').toUpperCase() === ATTACH_TYPE.PERSONAL_PDF;",
    replace: "  return false;",
    tests: ["tests/round79_ga_pdf_gate_by_attach.test.js"]
  },
  // ── 第八十一輪批次 HA／HB 組 ──
  {
    id: "ha-ui-ignores-reasons",
    why: "前端唔睇後端嘅「為甚麼」，照舊自己判斷（舊放行格又令每次儲存彈窗）",
    file: "src/ui/ScriptZone1.html",
    find: "    if (Array.isArray(plan.confirmReasons)) return plan.confirmReasons.length === 0;\n",
    replace: "",
    tests: ["tests/round81_ha_kept_new.test.js"]
  },
  {
    id: "ha-released-all-new",
    why: "上一版已放行嘅格都當新",
    file: "src/WebAppSaveConfirm.gs",
    find: "  violations.releasedNew = filterNewSinceBase_(violations.released, baseIndex);",
    replace: "  violations.releasedNew = violations.released.slice();",
    tests: ["tests/round81_ha_kept_new.test.js"]
  },
  {
    id: "ha-kept-never-new",
    why: "今次新保留嘅格都當舊（靜靜直接儲存）",
    file: "src/WebAppSaveConfirm.gs",
    find: "  violations.keptNew = filterNewSinceBase_(violations.kept, baseIndex);",
    replace: "  violations.keptNew = [];",
    tests: ["tests/round81_ha_kept_new.test.js"]
  },
  {
    id: "ha-temp-never-new",
    why: "今次新標記嘅臨時幫手都當舊",
    file: "src/WebAppSaveConfirm.gs",
    find: "  return list.filter(function (t) { return oldNameByKey[t.key] !== t.text; });",
    replace: "  return [];",
    tests: ["tests/round81_ha_kept_new.test.js"]
  },
  {
    id: "ha-base-fail-empty",
    why: "上一版算唔到就當冇違反（全部當舊）",
    file: "src/WebAppSaveConfirm.gs",
    find: "    log_('WARN', (who || 'buildBaseViolationIndex_') + ' 算不到上一版的違反，全部當新：' + err.message);\n    return null;",
    replace: "    log_('WARN', (who || 'buildBaseViolationIndex_') + ' 算不到上一版的違反，全部當新：' + err.message);\n    return {};",
    tests: ["tests/round81_ha_kept_new.test.js"]
  },
  {
    id: "ha-key-no-person",
    why: "保留格換咗另一個人都當舊",
    file: "src/WebAppSaveConfirm.gs",
    find: "  return violationKey_(v) + '|' + (v.personId || '');",
    replace: "  return violationKey_(v);",
    tests: ["tests/round81_ha_kept_new.test.js"]
  },
  {
    id: "ha-reason-no-semi",
    why: "「為甚麼」漏咗今次帶來嘅盡量避免",
    file: "src/WebAppSaveConfirm.gs",
    find: "  add('SEMI_HARD_NEW', n.semiHardNewCount || 0,",
    replace: "  add('SEMI_HARD_NEW', 0,",
    tests: ["tests/round81_ha_kept_new.test.js"]
  },
  {
    id: "ha-reason-no-kept",
    why: "「為甚麼」漏咗新保留嘅格",
    file: "src/WebAppSaveConfirm.gs",
    find: "  add('KEPT_NEW', n.keptNewCount || 0,",
    replace: "  add('KEPT_NEW', 0,",
    tests: ["tests/round81_ha_kept_new.test.js"]
  },
  {
    id: "ha-why-not-shown",
    why: "確認窗冇顯示「為甚麼要你看一看」",
    file: "src/ui/ScriptZone1.html",
    find: "    const why = buildSaveWhySection(plan.confirmReasons);",
    replace: "    const why = null;",
    tests: ["tests/round81_ha_kept_new.test.js"]
  },
  {
    id: "ha-reasons-not-in-plan",
    why: "儲存計劃冇帶「為甚麼」出去",
    file: "src/WebAppSaveConfirm.gs",
    find: "    confirmReasons: confirmReasons,\n    requests: requests,",
    replace: "    requests: requests,",
    tests: ["tests/round81_ha_kept_new.test.js"]
  },
  {
    id: "hb-no-new-joiner",
    why: "冇舊 hash 嘅人一律當漏收（新加入嘅人收唔到通知）",
    file: "src/ResendFlow.gs",
    find: "      && !baseline.assignedById[personId] && !baseline.everSentById[personId];",
    replace: "      && false;",
    tests: ["tests/round81_hb_new_joiner_resend.test.js"]
  },
  {
    id: "hb-classify-ignores",
    why: "新加入唔算「安排有改動」",
    file: "src/ResendFlow.gs",
    find: "  if (c && c.newJoiner === true) return true;\n",
    replace: "",
    tests: ["tests/round81_hb_new_joiner_resend.test.js"]
  },
  {
    id: "hb-pdf-drop-new",
    why: "改動後重發唔為新加入嘅人產生 PDF",
    file: "src/ResendFlow.gs",
    find: "      return ((context.assignmentsByPerson || {})[id] || []).length > 0;",
    replace: "      return ((context.assignmentsByPerson || {})[id] || []).length > 0 && !!(context.lastHashByPerson || {})[id];",
    tests: ["tests/round81_hb_new_joiner_resend.test.js"]
  },
  {
    id: "hb-baseline-any-stage",
    why: "基準版本連審閱本都計",
    file: "src/Mailer.gs",
    find: "    if (stage !== MAIL_STAGES.OFFICIAL && stage !== MAIL_STAGES.RESEND && status !== MAIL_STATUS.EXTERNAL) return;",
    replace: "    if (false) return;",
    tests: ["tests/round81_hb_new_joiner_resend.test.js"]
  },
  {
    id: "hb-prev-summary-blank",
    why: "新加入嘅人「原本」寫成「沒有記錄」",
    file: "src/WebAppGuards.gs",
    find: "    if (c.newJoiner) c.previousSummary = RESEND_NEW_JOINER_PREVIOUS_TEXT;",
    replace: "    if (c.newJoiner) c.previousSummary = '';",
    tests: ["tests/round81_hb_new_joiner_resend.test.js"]
  },
  {
    id: "hb-context-no-baseline",
    why: "改動後重發嘅 context 冇讀基準版本",
    file: "src/Mailer.gs",
    find: "    resendBaseline: stage === MAIL_STAGES.RESEND ? readResendBaselineSafe_(quarterId) : null,",
    replace: "    resendBaseline: null,",
    tests: ["tests/round81_hb_new_joiner_resend.test.js"]
  },
  {
    id: "hb-reason-not-new",
    why: "新加入嘅人冇自己嘅上游理由",
    file: "src/ResendFlow.gs",
    find: "      notifyReason: newJoiner\n        ? RESEND_NOTIFY_REASON.NEW_ASSIGNMENT",
    replace: "      notifyReason: false\n        ? RESEND_NOTIFY_REASON.NEW_ASSIGNMENT",
    tests: ["tests/round81_hb_new_joiner_resend.test.js"]
  },
  // ── 第八十二輪批次 IF 組：用舊版本作起點再儲存一定建立新一版 ──
  {
    id: "if-start-zero-change",
    why: "起點唔計改動 ⇒ grid 冇差異就行零改動路",
    file: "src/WebAppSaveConfirm.gs",
    find: "    && titleChanges.length === 0 && !startPoint;",
    replace: "    && titleChanges.length === 0;",
    tests: ["tests/round82_if_start_point_save.test.js"]
  },
  {
    id: "if-materialise-guard",
    why: "起點冇偵測到差異 ⇒ 建立版本拋錯",
    file: "src/StateSource.gs",
    find: "titleChangeCount === 0 && !hasStartPoint) {",
    replace: "titleChangeCount === 0) {",
    tests: ["tests/round82_if_start_point_save.test.js"]
  },
  {
    id: "if-no-start-reason",
    why: "儲存窗唔講起點",
    file: "src/WebAppSaveConfirm.gs",
    find: "  if (n.startPointVersionNo !== null && n.startPointVersionNo !== undefined) {",
    replace: "  if (false) {",
    tests: ["tests/round82_if_start_point_save.test.js"]
  },
  {
    id: "if-cells-empty",
    why: "起點嗰幾格冇列出",
    file: "src/WebAppSaveConfirm.gs",
    find: "    cells = listStartPointCellDiffs_(quarterId, no, baseVersionNo, context, postNameById);",
    replace: "    cells = [];",
    tests: ["tests/round82_if_start_point_save.test.js"]
  },
  {
    id: "if-result-no-start",
    why: "完成窗唔講起點",
    file: "src/WebAppSaveConfirm.gs",
    find: "    startPointVersionNo: startPointNo,\n    startPointCells:",
    replace: "    startPointVersionNo: null,\n    startPointCells:",
    tests: ["tests/round82_if_start_point_save.test.js"]
  },
  // ── 第八十二輪批次 IA 組：勾選撞鎖自動再試、排隊、寫唔到就還原 ──
  {
    id: "ia-no-retry",
    why: "撞鎖唔再試",
    file: "src/ui/Script.html",
    find: "        if (!isMutationLockBusyError(err) || attempt >= DECISION_RETRY_MAX_ATTEMPTS) return { ok: false, err: err };",
    replace: "        return { ok: false, err: err };",
    tests: ["tests/round82_ia_decision_retry.test.js"]
  },
  {
    id: "ia-retry-forever",
    why: "冇上限，一直等",
    file: "src/ui/Script.html",
    find: "  const DECISION_RETRY_MAX_ATTEMPTS = 11;",
    replace: "  const DECISION_RETRY_MAX_ATTEMPTS = 40;",
    tests: ["tests/round82_ia_decision_retry.test.js"]
  },
  {
    id: "ia-no-queue",
    why: "唔排隊，連續勾會互相撞",
    file: "src/ui/Script.html",
    find: "    const run = decisionQueue_.then(() => writeDecisionsWithRetry(payloads, onWaiting));",
    replace: "    const run = writeDecisionsWithRetry(payloads, onWaiting);",
    tests: ["tests/round82_ia_decision_retry.test.js"]
  },
  {
    id: "ia-no-revert",
    why: "寫唔到都保持已勾",
    file: "src/ui/Script.html",
    find: "          cb.checked = !want; state[sk(it)] = !want; changed();\n          note.textContent = '　這一格未記住，請再勾一次';",
    replace: "          note.textContent = '　這一格未記住，請再勾一次';",
    tests: ["tests/round82_ia_decision_retry.test.js"]
  },
  {
    id: "ia-no-note",
    why: "嗰一行唔講未記住",
    file: "src/ui/Script.html",
    find: "          note.textContent = '　這一格未記住，請再勾一次';\n          note.className",
    replace: "          note.textContent = '';\n          note.className",
    tests: ["tests/round82_ia_decision_retry.test.js"]
  },
  // ── 第八十二輪批次 IH 組：冇改動〔儲存〕變灰；切返嚟自動檢查 ──
  {
    id: "ih-save-always-on",
    why: "冇改動都亮",
    file: "src/WebAppDashboard.gs",
    find: "  const enabled = !!s.versionExists && hasWork;",
    replace: "  const enabled = !!s.versionExists;",
    tests: ["tests/round82_ih_save_grey_recheck.test.js"]
  },
  {
    id: "ih-no-start-point",
    why: "起點未儲存唔算有嘢要存",
    file: "src/WebAppDashboard.gs",
    find: "  const hasWork = !!u.hasAny || Number(u.unresolvedCount) > 0 || !!s.startPointPending;",
    replace: "  const hasWork = !!u.hasAny || Number(u.unresolvedCount) > 0;",
    tests: ["tests/round82_ih_save_grey_recheck.test.js"]
  },
  {
    id: "ih-no-throttle",
    why: "10 秒內重覆檢查",
    file: "src/ui/ScriptMainFlow.html",
    find: "    if (now - saveRecheckAt_ < SAVE_RECHECK_MIN_MS) return false;",
    replace: "",
    tests: ["tests/round82_ih_save_grey_recheck.test.js"]
  },
  {
    id: "ih-no-apply",
    why: "檢查完唔更新畫面",
    file: "src/ui/ScriptMainFlow.html",
    find: "      applySaveButtonState(step2SaveRefs_, r && r.save);",
    replace: "",
    tests: ["tests/round82_ih_save_grey_recheck.test.js"]
  },
  {
    id: "ih-modal-recheck",
    why: "彈窗開住都郁畫面",
    file: "src/ui/ScriptMainFlow.html",
    find: "    if (!step2SaveRefs_ || !currentQuarterId || modalOpen) return false;",
    replace: "    if (!step2SaveRefs_ || !currentQuarterId) return false;",
    tests: ["tests/round82_ih_save_grey_recheck.test.js"]
  },
  // ── 第八十二輪批次 ID 組：儲存排表偏好之後唔再問要唔要重新生成 ──
  {
    id: "id-ask-regenerate",
    why: "儲存偏好之後又問重新生成",
    file: "src/ui/ScriptZone3.html",
    find: "    ], [button('知道了', () => closeModalAndRefresh(), '')]);\n  }",
    replace: "    ], [button('重新生成', () => { closeModal(); openRegenerate(); }, ''),\n      button('之後再說', () => closeModalAndRefresh(), 'secondary')]);\n  }",
    tests: ["tests/round82_id_weights_saved_notice.test.js"]
  },
  {
    id: "id-no-notice",
    why: "儲存偏好之後冇完成訊息",
    file: "src/ui/ScriptZone3.html",
    find: "          showWeightsSavedNotice(res);",
    replace: "          closeModal();",
    tests: ["tests/round82_id_weights_saved_notice.test.js"]
  },
  {
    id: "id-no-adjust-hint",
    why: "完成訊息冇指去請系統幫我調整",
    file: "src/ui/ScriptZone3.html",
    find: "          + '要用新偏好調整現有的職事表，撳第 2 步〔請系統幫我調整〕；還未生成的話，生成時會自動用。',",
    replace: "          + '',",
    tests: ["tests/round82_id_weights_saved_notice.test.js"]
  }
];

/**
 * 第六十二輪批次 A2 組：**比對之前先把 CRLF 正規化成 LF。**
 *
 * ⚠️ 呢個 repo 係 `core.autocrlf=true` 而且（第六十二輪之前）冇
 * `.gitattributes`，所以任何一次 `git checkout` 都會令工作區嘅檔案
 * 變成 CRLF。而突變表入面有一批**跨行**嘅 `find`，佢哋寫嘅係 `\n`。
 *
 * 實測（第六十一輪）：`git checkout -- src/Mailer.gs` 之後，
 * `sendlog-no-block` 報「喺 src/Mailer.gs 搵到 0 次 find（要求剛好 1 次）」
 * ——程式一個字都冇改過，而推送閘紅咗。
 *
 * ⚠️ **只喺比對同突變嗰陣正規化，還原一律寫返原文。**
 * 正規化寫入檔案就變成「一個檢查工具順手改咗你成個 repo 嘅行尾」。
 *
 * @param {string} text 原文
 * @returns {string} LF 版本
 */
function normalizeEol_(text) {
  return String(text).replace(/\r\n/g, '\n');
}

// 開跑之前先記低每個會被改嘅檔案——收工用嚟核對有冇還原乾淨。
//
// ⚠️ 記嘅係**原文**（連原本嘅行尾），因為還原要一個字都唔差。
const ORIGINALS = {};
MUTATIONS.forEach(function (m) {
  if (!ORIGINALS[m.file]) ORIGINALS[m.file] = fs.readFileSync(path.join(ROOT, m.file), 'utf8');
});

let fail = 0;

/**
 * 第六十二輪批次 A1 組：還原失敗嘅現場。
 *
 * `null` ＝ 未出過事。
 */
let restoreFailure = null;

/* ═════════════════════════════════════════════════════════════════════
 * ⚠️⚠️ 第六十二輪批次 A1 組：**收尾檢查要無論點死都跑到。**
 * ═════════════════════════════════════════════════════════════════════
 *
 * 現場（第六十一輪實測，兩次）：
 *
 *   node:fs:2430
 *   Error: UNKNOWN: unknown error, open
 *     'C:\HWC\SynologyDrive\Roster\claudecode\src\Mailer.gs'
 *       at Object.writeFileSync (node:fs:2430:20)
 *       at C:\...\tools\verify-red.js:3638:8
 *
 * 嗰一下係**還原**嗰個寫入拋錯（Synology 同步鎖住咗個檔）。
 * 程式就噉死咗，`src/Mailer.gs` 留住突變版本——
 * 而下面嗰道「src/ 冇殘留」自我檢查**排喺最尾，根本跑唔到**。
 *
 * ⚠️ 即係「最需要佢嗰陣佢唔喺度」。
 *
 * 所以改成掛喺 `process.on('exit')`：正常收工、拋錯死、
 * `process.exit()` 都一樣會行一次。實測過喺 `exit` 事件入面
 * 設 `process.exitCode` 係生效嘅。
 */
let finalCheckDone = false;

function finalResidueCheck_() {
  if (finalCheckDone) return;
  finalCheckDone = true;

  console.log('\n=== C 組：工具本身唔可以留低任何改動 ===');

  let dirty = [];
  try {
    dirty = Object.keys(ORIGINALS).filter(function (rel) {
      return fs.readFileSync(path.join(ROOT, rel), 'utf8') !== ORIGINALS[rel];
    });
  } catch (err) {
    dirty = Object.keys(ORIGINALS);
    console.log('（連核對都讀唔到檔案：' + err.message + '——當成全部有嫌疑）');
  }

  if (!restoreFailure && dirty.length === 0) {
    console.log('RED OK  src/ 冇殘留任何 verify-red 改動');
    return;
  }

  // ⚠️ 呢一段要**極顯眼**。一個被改壞嘅 src/ commit 咗上去，
  // 係呢個工具可以造成嘅最大傷害。
  process.exitCode = 1;
  const bar = '━'.repeat(66);
  console.log('\n' + bar);
  console.log('⛔⛔ 停手：src/ 可能仲留住 verify-red 改壞咗嘅內容');
  console.log(bar);
  if (restoreFailure) {
    console.log('還原失敗嘅檔案：' + restoreFailure.file);
    console.log('原本嘅錯誤：' + restoreFailure.message);
    console.log('（出事嗰條突變：' + restoreFailure.mutationId + '）');
  }
  if (dirty.length > 0) {
    console.log('同開跑之前唔一樣嘅檔案：');
    dirty.forEach(function (rel) { console.log('  ・' + rel); });
  }
  console.log('');
  console.log('點樣救——逐個檔案跑：');
  (dirty.length > 0 ? dirty
    : [restoreFailure ? restoreFailure.file : '<檔案>']).forEach(function (rel) {
    console.log('  git checkout -- ' + rel);
  });
  console.log('');
  console.log('⚠️ 救返之後先再 commit。呢一刻嘅 src/ **唔可以** commit。');
  console.log(bar);
}

// ⚠️ 一定要喺呢度掛，唔可以等到最尾——中間拋錯就登記唔到。
process.on('exit', finalResidueCheck_);
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

// ⚠️ 用 `for` 唔用 `forEach`——還原失敗嗰陣要**即刻停低成支工具**，
// 而 `forEach` 停唔到。繼續跑落去嘅話，下一條突變會喺一個
// 已經改壞咗嘅檔案上面再改一次，越搞越亂。
for (let mi = 0; mi < MUTATIONS.length; mi++) {
  if (restoreFailure) break;
  const m = MUTATIONS[mi];
  const abs = path.join(ROOT, m.file);

  // ⚠️ `raw` 係還原用（一個字都唔差）；`before` 係比對同突變用
  //（CRLF 正規化過）。兩者唔可以掉亂：
  //   ・用 `before` 還原　⇒ 一個檢查工具順手改咗你成個 repo 嘅行尾
  //   ・用 `raw` 比對　　⇒ 跨行嘅 `find` 喺 CRLF 檔案上面永遠搵唔到
  const raw = fs.readFileSync(abs, 'utf8');
  const before = normalizeEol_(raw);

  // ⚠️ 先落一個本地變數再用。直接喺樣板字串入面寫「物件點 id」
  //  會被敏感資料掃描當成一個網域而擋住 commit（id 係真嘅頂層網域）。
  const mutationId = m.id;
  const hits = before.split(m.find).length - 1;
  if (hits !== 1) {
    report(false, `[${mutationId}] ${m.why}`,
      `喺 ${m.file} 搵到 ${hits} 次 \`find\`（要求剛好 1 次）。\n`
      + '程式碼改過就要同步更新 tools/verify-red.js 嘅註冊表——'
      + '唔可以由得佢靜靜略過。');
    continue;
  }

  let mutated = false;
  try {
    fs.writeFileSync(abs, before.split(m.find).join(m.replace));
    mutated = true;
    const results = m.tests.map(function (t) { return { t: t, r: runTest(t) }; });
    const stillGreen = results.filter(function (x) { return x.r.passed; });
    report(stillGreen.length === 0, `[${mutationId}] ${m.why}`,
      stillGreen.length > 0
        ? '整壞咗之後呢啲測試**仍然綠燈**：\n  '
          + stillGreen.map(function (x) { return x.t; }).join('\n  ')
          + '\n⇒ 呢條防線根本冇踩到嗰段程式，佢嘅綠燈冇意義。'
        : '');
  } finally {
    // ⚠️⚠️ 第六十二輪批次 A1 組：**還原嗰個寫入會失敗。**
    //
    // 實測撞過兩次：`UNKNOWN: unknown error, open …src\Mailer.gs`
    //（Synology 同步鎖住個檔）。舊寫法冇包 try／catch，所以拋錯
    // 直接殺死成支工具，而個檔案就噉留住突變版本。
    if (mutated) {
      try {
        fs.writeFileSync(abs, raw);
      } catch (err) {
        restoreFailure = {
          file: m.file, mutationId: mutationId, message: err.message
        };
        fail++;
        console.log('FAIL    [' + mutationId + '] 還原唔到 ' + m.file
          + '：' + err.message);
      }
    }
  }
}

// ── 結論同退出碼 ────────────────────────────────────────────────
//
// ⚠️ 第四十四輪批次發現：呢個工具本來**冇呢一段**——即係唔論幾多條防線
// 塌咗、幾多條註冊過期，佢都係 exit 0。而佢係推送閘嘅一部分，所以
//「跑咗 verify-red」一直只等於「有人肉眼睇過個輸出」。
//
// 呢個正正就係呢個專案由第一輪殺到而家嗰種錯：**靜靜失敗**。
// 一個永遠回 0 嘅檢查工具，比冇呢個工具更差——因為佢令人以為檢查過。
// ⚠️ 用 `process.exitCode` 唔用 `process.exit()`——
// `process.exit()` 會即刻走，而我哋要畀上面嗰個 `exit` 鈎
// 行完最後嗰道「src/ 有冇殘留」檢查先。
if (restoreFailure) {
  console.log('\n⛔ 因為還原失敗，已經停低，冇跑晒 ' + MUTATIONS.length + ' 條突變。');
} else {
  console.log('\n' + (fail === 0
    ? ('ALL RED OK（' + MUTATIONS.length + ' 條突變）')
    : (fail + ' 條唔合格——唔可以 commit')));
}
process.exitCode = fail === 0 ? 0 : 1;



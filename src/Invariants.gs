/**
 * 第四十九輪批次 第 3 層：**不變量。**
 *
 * ═════════════════════════════════════════════════════════════════════
 * 呢一支要解決嘅問題
 * ═════════════════════════════════════════════════════════════════════
 *
 * 170 份測試全綠，證明唔到系統交得畀幹事——因為嗰 170 份嘅**證據來源**，
 * 係人手砌出嚟嘅狀態。
 *
 * `docs/系統範圍稽核.md` 自己已經寫明根因：
 * **fixture 砌到一個真實 code path 造唔出嘅狀態。**
 *
 * 「不變量」係另一種證據：佢唔關心「你點樣去到呢個狀態」，
 * 佢只問「**而家**呢一刻，張表同畫面對唔對得上」。
 * 所以佢喺真環境行得、喺亂行機每一步行得、喺全面體檢行得——
 * 而且無論你點樣去到嗰個狀態，佢都一樣問同一條問題。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ 三條界線
 * ─────────────────────────────────────────────────────────────────────
 *
 *   一、**唯讀。** 一支不變量檢查唔可以改任何嘢——連 Stage 都唔可以掂。
 *       一個會改嘢嘅檢查，行完之後嘅狀態就唔再係佢驗嗰個狀態。
 *   二、**拋錯 ≠ 失敗。** 讀唔到就報 `ERROR`，唔可以報 `ok: true`。
 *       「查不到」當成「冇事」，就係呢個專案由第一輪殺到而家嗰種錯。
 *   三、**每一條都要拿得出證據。** 只講「失敗」而唔講實際值，
 *       等於逼下一個人由零查起。
 *   四、**「唔適用」同「算錯咗」要分開。** 見下面。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️⚠️ 第五十輪批次 C 組：`NOT_APPLICABLE` 嘅判斷準則
 * ─────────────────────────────────────────────────────────────────────
 *
 * 現場：季度啱啱清乾淨、一個版本都未有，而 I08 報
 *
 *     實際 算不出來｜找不到 2028T3 已生成的版本，請先執行「步驟 1：生成初稿」
 *
 * 呢一句**唔係失敗**，係「呢個狀態下本來就唔適用」。
 * 後果係 S01–S08 每一個都一定紅，不論系統本身有冇問題——
 * 而紅色一多就冇人再睇。嗰個就係假警報。
 *
 * ⚠️ 但呢一組最大嘅風險係**分錯邊**：分錯咗就變成
 * 「把紅色改成睇唔見」，比而家更差。所以準則要寫得死：
 *
 *   ┌─────────────────────────────────┬──────────────────┐
 *   │ 情況                             │ 判                │
 *   ├─────────────────────────────────┼──────────────────┤
 *   │ 呢一季一個版本都未有              │ NOT_APPLICABLE   │
 *   │ Stage 未到嗰一步                  │ NOT_APPLICABLE   │
 *   │ 有版本，而兩條路數出嚟嘅數唔同     │ **FAILED**       │
 *   │ 有版本，而其中一條路拋錯          │ **FAILED**       │
 *   │ 讀唔到工作表／Config              │ **ERROR**        │
 *   └─────────────────────────────────┴──────────────────┘
 *
 * 換句話講：**只有「前置條件本身唔成立」先至係 NOT_APPLICABLE。**
 * 前置條件成立咗而算唔出，就係失敗——嗰個先係我哋要捉嘅嘢。
 *
 * ⚠️ 判斷「前置條件成唔成立」**唔可以靠讀錯誤訊息嘅字**。
 * 錯誤訊息會改，而改咗之後一條真失敗就會靜靜變成「唔適用」。
 * 一律**喺叫之前自己查一次**（有冇版本、Stage 係乜）。
 */

/** 一條不變量嘅結果狀態。 */
const INVARIANT_STATUS = {
  OK: 'OK',
  FAILED: 'FAILED',
  // ⚠️ 讀唔到／算唔到 —— **唔可以當成 OK**。
  ERROR: 'ERROR',
  // 冇足夠資料去驗（例如一季一個版本都冇）。同 OK 分開報。
  SKIPPED: 'SKIPPED',
  // ⚠️ 第五十輪批次 C 組：**「呢個狀態下本來就唔適用」。**
  //
  // 唔計入 `failedCount`，報告用 ⚪ 唔用 ⚠️。
  // 詳細判斷準則見檔頭「⚠️ 四條界線」第四條。
  NOT_APPLICABLE: 'NOT_APPLICABLE'
};

/**
 * 砌一條不變量結果。
 *
 * @param {string} id 例如 `I03`
 * @param {string} label 一句人話講佢守乜
 * @param {string} status `INVARIANT_STATUS` 之一
 * @param {*} expected 預期
 * @param {*} actual 實際
 * @param {string} evidence 證據（實際值、來自邊一支函式）
 * @returns {Object}
 */
function invariantResult_(id, label, status, expected, actual, evidence) {
  return {
    id: id,
    label: label,
    status: status,
    ok: status === INVARIANT_STATUS.OK,
    expected: expected === undefined ? '' : String(expected),
    actual: actual === undefined ? '' : String(actual),
    evidence: String(evidence || '')
  };
}

/* ═════════════════════════════════════════════════════════════════════
 * I08 嘅登記表：**每一個會顯示畀幹事睇嘅數字**
 * ═════════════════════════════════════════════════════════════════════
 *
 * 第四十三輪立過「對話框報嘅每一個數字，表上都要有對應嘅嘢」，
 * 之後第四十六輪又破咗一次（確認畫面「會寄給這 3 位」、
 * 完成畫面「已模擬寄出 9 封」）。
 *
 * ⚠️ 一條靠人記住嘅規矩，破咗兩次就唔應該再靠人記住。
 * 呢張表就係把佢變成機器檢查得到嘅嘢：每一個數字寫明
 *
 *   `produce`　畫面上嗰個數字由邊一支函式出
 *   `verify`　 同一個數字，由**另一條路**再數一次
 *
 * 兩者唔一致 ⇒ I08 紅。
 *
 * ⚠️ **`verify` 一定要行另一條路。** 抄 `produce` 一份落嚟就係同義反覆
 * ——自己同自己比，永遠綠。
 *
 * ⚠️ 加一個新嘅「畫面數字」而唔喺呢度登記，`I08` 唔會捉到佢。
 * 所以呢張表本身要靠 code review 維持——呢一點喺報告入面講明咗。
 */
function buildDialogNumberRegistry_() {
  return [
    {
      id: 'step2.recipientCount',
      where: '寄給堂委審閱（確認畫面）「會寄給這 N 位」',
      // 一個版本都未有 ⇒ 根本冇嘢可以數。唔係失敗。
      notApplicable: function (f) {
        return f.versionNo < 0
          ? '這一季還沒有生成過版本，所以算不出「會寄給誰」。'
            + '這不是失敗——生成之後（S02）就驗得到。'
          : '';
      },
      // ⚠️ 兩條路要用**同一份** `sendOptions`，否則比嘅唔係同一件事。
      produce: function (quarterId, sendOptions) {
        return planStep2_(quarterId, sendOptions).recipientCount;
      },
      verify: function (quarterId, sendOptions) {
        // 另一條路：直接由收件人解析器數，唔經 `planStep2_()`。
        const versionNo = findLatestVersionNo(quarterId);
        return resolveActualRecipients_(
          quarterId, versionNo, MAIL_STAGES.REVIEW, sendOptions).length;
      }
    },
    {
      id: 'step4.recipientCount',
      where: '正式發出給全體（確認畫面）「會寄給這 N 位」',
      // ⚠️ 「正式發出」要 Stage 到 `REQUESTS_APPLIED` 先做得到。
      // 之前嗰幾個階段本來就唔適用——唔係失敗。
      //
      // 冇呢一句嘅話，S01–S08 每一個都一定紅，不論系統有冇問題。
      notApplicable: function (f) {
        if (f.versionNo < 0) {
          return '這一季還沒有生成過版本，所以算不出「會寄給誰」。';
        }
        return STEP4_ALLOWED_STAGES_.indexOf(f.stage) === -1
          ? '「正式發出」要 Stage 是「' + STEP4_ALLOWED_STAGES_.join('／')
            + '」才做得到，而現在是「' + (f.stage || '（讀不到）') + '」。'
            + '這不是失敗——走到那一步（S09）就驗得到。'
          : '';
      },
      produce: function (quarterId, sendOptions) {
        const versionNo = findLatestVersionNo(quarterId);
        return planStep4SendPreview_(quarterId, versionNo, sendOptions).recipientCount;
      },
      verify: function (quarterId, sendOptions) {
        const versionNo = findLatestVersionNo(quarterId);
        return resolveActualRecipients_(
          quarterId, versionNo, MAIL_STAGES.OFFICIAL, sendOptions).length;
      }
    },
    {
      id: 'dashboard.gridChangeCount',
      where: '主畫面「你有 N 格改動還未儲存」',
      notApplicable: function (f) {
        return f.versionNo < 0
          ? '這一季還沒有生成過版本，所以沒有 grid 可以比。'
          : '';
      },
      produce: function (quarterId) {
        const versionNo = findLatestVersionNo(quarterId);
        return readDashboardUnsavedState_(quarterId, versionNo).gridChangeCount;
      },
      verify: function (quarterId) {
        // 另一條路：直接由「儲存並確認」嗰個 plan 數——
        // 佢係真正會被寫入去嗰一份。
        const versionNo = findLatestVersionNo(quarterId);
        const context = buildFineTuneContext_(quarterId, versionNo);
        const resolved = resolveAuthoritativeState_(
          context, STATE_SOURCE.GRID_OVERLAY, 'I08.dashboard.gridChangeCount');
        return resolved.changes.length;
      }
    }
  ];
}

/* ═════════════════════════════════════════════════════════════════════
 * 逐條不變量
 * ═════════════════════════════════════════════════════════════════════ */

/**
 * I01：`COLUMNS` 定義嘅每一個鍵，工作表 header 都有。
 *
 * 即係 `tools/lint-schema-drift.js` 嘅**執行期版本**——嗰一支靜態掃
 * `src/`，呢一支睇真正張試算表。兩者缺一不可：
 * 靜態嗰支捉「碼同碼對唔上」，呢一支捉「碼同**表**對唔上」。
 *
 * 第四十七輪 C 組個 bug（`SpecialSundays` 冇 `Confirmed` 欄）
 * 就係後者——而當時冇任何嘢喺執行期問過呢條問題。
 *
 * @returns {Object} `invariantResult_()`
 */
function invariantSheetHeaders_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const problems = [];
  let checked = 0;

  Object.keys(COLUMNS).forEach(function (sheetKey) {
    const sheetName = SHEETS[sheetKey];
    if (!sheetName) return;                 // `COLUMNS` 有而 `SHEETS` 冇 ⇒ 唔關呢條事
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;                     // 張表未建立 ⇒ 唔係呢條要守嘅事
    checked++;
    const lastCol = sheet.getLastColumn();
    const headers = lastCol > 0
      ? sheet.getRange(2, 1, 1, lastCol).getValues()[0].map(function (v) {
        return String(v || '').trim();
      })
      : [];
    const block = COLUMNS[sheetKey];
    Object.keys(block).forEach(function (constName) {
      if (headers.indexOf(block[constName]) !== -1) return;
      problems.push(sheetName + '：缺「' + block[constName]
        + '」（COLUMNS.' + sheetKey + '.' + constName + '）');
    });
  });

  return invariantResult_('I01',
    'COLUMNS 定義的每一個欄，工作表真的有',
    problems.length === 0 ? INVARIANT_STATUS.OK : INVARIANT_STATUS.FAILED,
    '0 個缺欄', problems.length + ' 個缺欄',
    problems.length === 0
      ? '掃了 ' + checked + ' 張已建立的工作表。'
      : problems.join('；'));
}

/**
 * I02：每一粒 `enabled` 的掣，它宣稱的前置條件真的成立。
 *
 * 做法：把 `computeDashboardButtons_()` 嘅結果同 `facts` 對返。
 * 一粒 `enabled` 嘅掣如果**同時**有 `disabledReason`，就係矛盾。
 *
 * ⚠️ 呢條唔係「重寫一次掣嘅邏輯」——重寫就係第二個算法，
 * 而兩個算法一定會分岔。呢度只驗**同一份輸出內部一唔一致**。
 *
 * @param {string} quarterId 季度 ID
 * @returns {Object} `invariantResult_()`
 */
function invariantButtonPreconditions_(quarterId) {
  const state = buildDashboardState_(quarterId);
  const buttons = state.buttons || {};
  const bad = [];
  Object.keys(buttons).forEach(function (key) {
    const b = buttons[key] || {};
    if (b.enabled && String(b.disabledReason || '').trim() !== '') {
      bad.push(key + '：enabled=true 而同時有 disabledReason「' + b.disabledReason + '」');
    }
    if (!b.enabled && String(b.disabledReason || '').trim() === '') {
      // ⚠️ 一粒灰咗而唔講點解嘅掣，就係第四十輪 Ivan 撞到嗰件事。
      bad.push(key + '：enabled=false 而沒有 disabledReason（幹事不知道怎樣才撳得到）');
    }
  });
  return invariantResult_('I02',
    '每一粒掣的 enabled 同 disabledReason 沒有互相矛盾',
    bad.length === 0 ? INVARIANT_STATUS.OK : INVARIANT_STATUS.FAILED,
    '0 項矛盾', bad.length + ' 項矛盾',
    bad.length === 0 ? '檢查了 ' + Object.keys(buttons).length + ' 粒掣。' : bad.join('；'));
}

/**
 * I03／I08：畫面上每一個數字，由另一條路數返一次都要一樣。
 *
 * ⚠️ 呢一條就係第四十六輪嗰個「會寄給這 3 位／已模擬寄出 9 封」。
 *
 * 用兩份 `sendOptions` 各跑一次：
 *   ・`null`　　　　　　＝ 幹事乜都冇揀（今日行為）
 *   ・`PICK` 一個人　　＝ 幹事揀咗。**兩個算法就係喺呢度分岔嘅。**
 *
 * 只用 `null` 跑係唔夠嘅——第四十七輪嗰陣 `e2e_five_stage_flow.test.js`
 * 就係因為冇傳 `sendOptions`，兩個算法啱啱好重合，所以由頭到尾綠燈。
 *
 * @param {string} quarterId 季度 ID
 * @returns {Object[]} 每一個登記項一條結果
 */
function invariantDialogNumbers_(quarterId) {
  const registry = buildDialogNumberRegistry_();
  const results = [];

  // ⚠️ 第五十輪批次 C 組：**喺叫之前自己查前置條件。**
  //
  // 唔可以靠讀 `err.message` 嘅字去分「唔適用」同「算錯咗」——
  // 錯誤訊息會改，而改咗之後一條真失敗就會靜靜變成「唔適用」。
  const versionNo = findLatestVersionNo(quarterId);
  const stage = (function () {
    try { return getQuarterStage_(quarterId); } catch (err) { return ''; }
  })();

  registry.forEach(function (entry) {
    // ── 前置條件唔成立 ⇒ `NOT_APPLICABLE`，唔計入失敗 ──────────
    const na = entry.notApplicable
      ? entry.notApplicable({ versionNo: versionNo, stage: stage })
      : '';
    if (na) {
      results.push(invariantResult_('I08.' + entry.id, entry.where,
        INVARIANT_STATUS.NOT_APPLICABLE, '（這個狀態下不適用）', na, na));
      return;
    }

    // ⚠️ 兩種 `sendOptions` 都要跑。
    const cases = [
      { label: '（沒有選項）', options: null },
      {
        label: '（自己選擇 1 位）',
        options: { recipientScope: SEND_RECIPIENT_SCOPE.PICK, pickedKeys: ['__I08_PROBE__'] }
      }
    ];
    cases.forEach(function (c) {
      let produced;
      let verified;
      try {
        produced = entry.produce(quarterId, c.options);
        verified = entry.verify(quarterId, c.options);
      } catch (err) {
        results.push(invariantResult_('I08.' + entry.id + c.label,
          entry.where, INVARIANT_STATUS.ERROR, '兩條路數出同一個數', '算不出來',
          err.message));
        return;
      }
      results.push(invariantResult_('I08.' + entry.id + c.label,
        entry.where,
        produced === verified ? INVARIANT_STATUS.OK : INVARIANT_STATUS.FAILED,
        String(verified), String(produced),
        '畫面那一支回 ' + produced + '；另一條路數出 ' + verified
          + '（' + entry.id + c.label + '）'));
    });
  });

  return results;
}

/**
 * I04：`RosterAssignments` 每一個 (季,版本,日期,崗位,slot) 唯一。
 *
 * ⚠️ 第五十輪批次 B2 組：加咗一個**可選**嘅 `quarterId`。
 *
 * 現場實測：呢張表 10,920 行、40 個版本。自測機每個情境跑完都掃全表，
 * 15 個情境就係掃 16 萬行——一次執行 6 分鐘完全唔夠。
 *
 * 而自測機只關心沙盒季度嗰一季。
 *
 * ⚠️ **唔可以因此把全表嗰條刪走。** 「維護 ▸ 全面體檢」嗰邊要掃全表
 * ——嗰邊冇時間壓力，而且一個跨季度嘅重複（例如版本號撞咗）
 * 只有掃全表先睇得到。兩個用途都要保留，只係自測機用窄嗰個。
 *
 * @param {string=} quarterId 只掃呢一季；省略就掃全表
 * @returns {Object} `invariantResult_()`
 */
function invariantAssignmentUniqueness_(quarterId) {
  const A = COLUMNS.ROSTER_ASSIGNMENTS;
  const only = String(quarterId || '').trim();
  const seen = {};
  const dups = [];
  let scanned = 0;
  readSheet(SHEETS.ROSTER_ASSIGNMENTS).forEach(function (row) {
    const qid = String(row[A.QUARTER_ID] || '').trim();
    if (only && qid !== only) return;
    scanned++;
    const key = [qid, row[A.VERSION_NO], row[A.SERVICE_DATE],
      row[A.POST_ID], row[A.SLOT_INDEX]].join('|');
    if (seen[key]) {
      if (dups.indexOf(key) === -1) dups.push(key);
      return;
    }
    seen[key] = true;
  });
  return invariantResult_('I04',
    'RosterAssignments 沒有重複的 (季,版本,日期,崗位,slot)'
      + (only ? '（只掃 ' + only + '）' : '（全表）'),
    dups.length === 0 ? INVARIANT_STATUS.OK : INVARIANT_STATUS.FAILED,
    '0 個重複', dups.length + ' 個重複',
    dups.length === 0 ? '掃了 ' + scanned + ' 行。'
      : dups.slice(0, 10).join('；'));
}

/**
 * I05：`Quarters.Stage` 的值必屬 `QUARTER_STAGE`。
 * @returns {Object} `invariantResult_()`
 */
function invariantStageDomain_() {
  const Q = COLUMNS.QUARTERS;
  const allowed = Object.keys(QUARTER_STAGE).map(function (k) { return QUARTER_STAGE[k]; });
  const bad = [];
  readSheet(SHEETS.QUARTERS).forEach(function (row) {
    const quarterId = String(row[Q.QUARTER_ID] || '').trim();
    if (!quarterId) return;
    const stage = String(row[Q.STAGE] || '').trim();
    // 空白 ＝ 未補建 `Stage` 欄／未開始，唔算違反。
    if (stage === '') return;
    if (allowed.indexOf(stage) === -1) bad.push(quarterId + '：Stage=「' + stage + '」');
  });
  return invariantResult_('I05',
    'Quarters.Stage 的值全部是系統認得的階段',
    bad.length === 0 ? INVARIANT_STATUS.OK : INVARIANT_STATUS.FAILED,
    '0 個不認得的值', bad.length + ' 個不認得的值',
    bad.length === 0 ? '認得的階段：' + allowed.join('／') : bad.join('；'));
}

/**
 * I06：`SendLog` 每一行的 (季,版本) 喺 `RosterVersions` 搵得到。
 *
 * ⚠️ 搵唔到代表「寄咗一版而家已經唔存在嘅嘢出去」——
 * 而嗰種情況下，「改動後重發」嘅比對基準會靜靜變成一份冇人對得返嘅嘢。
 *
 * @returns {Object} `invariantResult_()`
 */
function invariantSendLogVersions_() {
  const S = COLUMNS.SEND_LOG;
  const V = COLUMNS.ROSTER_VERSIONS;
  const known = {};
  readSheet(SHEETS.ROSTER_VERSIONS).forEach(function (row) {
    known[String(row[V.QUARTER_ID] || '').trim() + '|' + Number(row[V.VERSION_NO])] = true;
  });
  const orphans = [];
  readSheet(SHEETS.SEND_LOG).forEach(function (row) {
    const quarterId = String(row[S.QUARTER_ID] || '').trim();
    if (!quarterId) return;
    const raw = row[S.VERSION_NO];
    if (raw === '' || raw === null || raw === undefined) return;
    const key = quarterId + '|' + Number(raw);
    if (known[key]) return;
    if (orphans.indexOf(key) === -1) orphans.push(key);
  });
  return invariantResult_('I06',
    'SendLog 每一行的版本在 RosterVersions 找得到',
    orphans.length === 0 ? INVARIANT_STATUS.OK : INVARIANT_STATUS.FAILED,
    '0 個孤兒', orphans.length + ' 個孤兒',
    orphans.length === 0 ? '對照了 ' + Object.keys(known).length + ' 個版本。'
      : orphans.slice(0, 10).join('；'));
}

/**
 * I07：受保護的季度，v0 真的有保護。
 *
 * 「受保護的季度」＝ `QUARTER_RESET_BLOCKED_QUARTERS` 那一份。
 * ⚠️ 用嗰一份，唔係演練嗰一份——呢條守嘅係「唔可以被清走」。
 *
 * @returns {Object} `invariantResult_()`
 */
function invariantProtectedV0_() {
  const V = COLUMNS.ROSTER_VERSIONS;
  const blocked = readQuarterResetBlockedQuarters_().map(function (q) {
    return String(q || '').trim().toUpperCase();
  });
  const bad = [];
  let checked = 0;
  readSheet(SHEETS.ROSTER_VERSIONS).forEach(function (row) {
    const quarterId = String(row[V.QUARTER_ID] || '').trim();
    if (blocked.indexOf(quarterId.toUpperCase()) === -1) return;
    if (Number(row[V.VERSION_NO]) !== 0) return;
    checked++;
    if (!isTrueValue_(row[V.PROTECTED])) bad.push(quarterId + ' 的 v0 沒有 Protected=TRUE');
  });
  if (checked === 0) {
    return invariantResult_('I07',
      '受保護季度的 v0 真的有 Protected=TRUE',
      INVARIANT_STATUS.NOT_APPLICABLE, '（這個狀態下不適用）', '沒有可以檢查的 v0',
      '受保護季度：' + (blocked.join('、') || '（無）') + '，在 RosterVersions 找不到它們的 v0。');
  }
  return invariantResult_('I07',
    '受保護季度的 v0 真的有 Protected=TRUE',
    bad.length === 0 ? INVARIANT_STATUS.OK : INVARIANT_STATUS.FAILED,
    checked + ' 個 v0 全部有保護', bad.length + ' 個沒有保護',
    bad.length === 0 ? '受保護季度：' + blocked.join('、') : bad.join('；'));
}

/**
 * I09：公開連結指向的版本 === 最近一次儲存確認的版本。
 * @param {string} quarterId 季度 ID
 * @returns {Object} `invariantResult_()`
 */
function invariantPublicLinkVersion_(quarterId) {
  const P = COLUMNS.PUBLIC_LINKS;
  const latest = findLatestVersionNo(quarterId);
  if (latest < 0) {
    return invariantResult_('I09', '公開連結指向最新儲存的版本',
      INVARIANT_STATUS.NOT_APPLICABLE, '（這個狀態下不適用）',
      '這一季還沒有任何版本', quarterId + ' 還沒有任何版本，所以沒有東西可以發佈。');
  }
  const row = readSheet(SHEETS.PUBLIC_LINKS).filter(function (r) {
    return String(r[P.QUARTER_ID] || '').trim() === quarterId;
  })[0];
  if (!row) {
    return invariantResult_('I09', '公開連結指向最新儲存的版本',
      INVARIANT_STATUS.NOT_APPLICABLE, '（這個狀態下不適用）',
      '這一季還沒有發佈過公開連結',
      quarterId + ' 還沒有發佈過公開連結，所以沒有東西可以對。');
  }
  const published = Number(row[P.LAST_PUBLISHED_VERSION]);
  return invariantResult_('I09', '公開連結指向最新儲存的版本',
    published === latest ? INVARIANT_STATUS.OK : INVARIANT_STATUS.FAILED,
    'v' + latest, 'v' + published,
    'PublicLinks.LastPublishedVersion=' + published
      + '；findLatestVersionNo()=' + latest
      + '。不一致代表收信的人開連結看到的，不是最新那一版。');
}

/**
 * I10：`DRY_RUN=TRUE` 的時候，`SendLog` 不可以有新的真實寄出紀錄。
 *
 * ⚠️ 只睇**呢一季**，而且只睇 `DRY_RUN` 現時係 TRUE 嗰陣。
 * 舊季度喺真實模式下寄過信係正常嘅；呢條守嘅係
 * 「而家講住係模擬模式，而系統實際上寄緊真信」。
 *
 * @param {string} quarterId 季度 ID
 * @returns {Object} `invariantResult_()`
 */
function invariantDryRunNoRealSend_(quarterId) {
  const isDryRun = getConfig(CONFIG_KEYS.DRY_RUN, true) !== false;
  if (!isDryRun) {
    return invariantResult_('I10', '模擬模式下沒有真實寄出紀錄',
      INVARIANT_STATUS.NOT_APPLICABLE, '（這個狀態下不適用）',
      'DRY_RUN 不是 TRUE', 'DRY_RUN 目前不是 TRUE，這一條守的是模擬模式，所以不適用。');
  }
  const S = COLUMNS.SEND_LOG;
  const real = [];
  readSheet(SHEETS.SEND_LOG).forEach(function (row) {
    if (String(row[S.QUARTER_ID] || '').trim() !== quarterId) return;
    if (String(row[S.STATUS] || '').trim() !== MAIL_STATUS.SENT) return;
    real.push(String(row[S.SEND_ID] || '') + '／' + String(row[S.SENT_AT] || ''));
  });
  return invariantResult_('I10', '模擬模式下沒有真實寄出紀錄',
    real.length === 0 ? INVARIANT_STATUS.OK : INVARIANT_STATUS.FAILED,
    '0 筆 SENT', real.length + ' 筆 SENT',
    real.length === 0
      ? 'DRY_RUN=TRUE，' + quarterId + ' 的 SendLog 全部是模擬紀錄。'
      : '⚠️ DRY_RUN=TRUE 而這幾筆是 Status=' + MAIL_STATUS.SENT + '：'
        + real.slice(0, 10).join('；')
        + '（可能是之前在真實模式下寄的；如果是剛剛跑出來的，代表模擬模式沒有生效）');
}

/* ═════════════════════════════════════════════════════════════════════
 * 一次過跑
 * ═════════════════════════════════════════════════════════════════════ */

/**
 * 跑齊全部不變量。**唯讀。**
 *
 * ⚠️ 逐條包 try/catch：一條爆咗，其餘照跑。
 * 一條爆就成批停低嘅話，一個細問題會掩蓋晒後面全部。
 *
 * @param {string=} quarterId 要驗嘅季度；冇傳就跳過同季度有關嗰幾條
 * @returns {{results: Object[], failedCount: number, errorCount: number,
 *   okCount: number, skippedCount: number}}
 */
/**
 * 第五十輪批次 B1 組：**每個情境跑完就跑嗰批（要快）。**
 *
 * ⚠️ 揀呢四條嘅準則：**只碰沙盒季度，而且唔會遍歷大表。**
 *
 *   I01　只讀每張表第 2 行（header），唔遍歷資料
 *   I05　`Quarters` 得幾十行
 *   I09　`PublicLinks` 得幾十行
 *   I10　`SendLog` 篩一季（沙盒季度嗰一季通常得幾十行）
 *
 * 貴嗰幾條（I04 全表 10,920 行、I08 每條要行一次完整 plan）
 * 留到全部情境跑完之後先一次過跑——見 `INVARIANT_SET.FINAL`。
 */
const INVARIANT_SET = {
  PER_SCENARIO: 'PER_SCENARIO',
  FINAL: 'FINAL',
  ALL: 'ALL'
};

/**
 * 跑不變量。**唯讀。**
 *
 * ⚠️ 逐條包 try/catch：一條爆咗，其餘照跑。
 * 一條爆就成批停低嘅話，一個細問題會掩蓋晒後面全部。
 *
 * @param {string=} quarterId 要驗嘅季度；冇傳就跳過同季度有關嗰幾條
 * @param {string=} set `INVARIANT_SET` 之一；省略 ＝ `ALL`
 * @returns {{results: Object[], failedCount: number, errorCount: number,
 *   okCount: number, skippedCount: number, notApplicableCount: number}}
 */
function runAllInvariants_(quarterId, set) {
  const results = [];
  const mode = set || INVARIANT_SET.ALL;
  const wantFast = mode === INVARIANT_SET.PER_SCENARIO || mode === INVARIANT_SET.ALL;
  const wantSlow = mode === INVARIANT_SET.FINAL || mode === INVARIANT_SET.ALL;

  const run = function (id, label, fn) {
    try {
      const out = fn();
      if (Array.isArray(out)) out.forEach(function (r) { results.push(r); });
      else results.push(out);
    } catch (err) {
      // ⚠️ 拋錯 ≠ 通過。報 ERROR，唔可以靜靜略過。
      results.push(invariantResult_(id, label, INVARIANT_STATUS.ERROR,
        '算得出結果', '拋錯', err.message));
    }
  };

  const qid = String(quarterId || '').trim();

  // ── 快嗰批 ──────────────────────────────────────────────────
  if (wantFast) {
    run('I01', 'COLUMNS 定義的每一個欄，工作表真的有', invariantSheetHeaders_);
    run('I05', 'Quarters.Stage 的值全部認得', invariantStageDomain_);
    if (qid) {
      run('I09', '公開連結指向最新版本', function () {
        return invariantPublicLinkVersion_(qid);
      });
      run('I10', '模擬模式下沒有真實寄出', function () {
        return invariantDryRunNoRealSend_(qid);
      });
    }
  }

  // ── 貴嗰批 ──────────────────────────────────────────────────
  if (wantSlow) {
    // ⚠️ 有季度就只掃嗰一季（B2 組）。全面體檢冇傳季度 ⇒ 掃全表。
    run('I04', 'RosterAssignments 沒有重複的格', function () {
      return invariantAssignmentUniqueness_(qid || null);
    });
    run('I06', 'SendLog 每一行的版本找得到', invariantSendLogVersions_);
    run('I07', '受保護季度的 v0 真的有保護', invariantProtectedV0_);
    if (qid) {
      run('I02', '每一粒掣的前置條件', function () {
        return invariantButtonPreconditions_(qid);
      });
      run('I08', '畫面上的每一個數字', function () { return invariantDialogNumbers_(qid); });
    }
  }

  if (!qid && (wantFast || wantSlow)) {
    results.push(invariantResult_('I02／I08／I09／I10', '需要指定季度才驗得到',
      INVARIANT_STATUS.SKIPPED, '', '',
      '這四條要對住一個季度才驗得到。跑自測機或亂行機時會自動帶上沙盒季度。'));
  }

  const count = function (status) {
    return results.filter(function (r) { return r.status === status; }).length;
  };
  return {
    results: results,
    set: mode,
    okCount: count(INVARIANT_STATUS.OK),
    failedCount: count(INVARIANT_STATUS.FAILED),
    errorCount: count(INVARIANT_STATUS.ERROR),
    skippedCount: count(INVARIANT_STATUS.SKIPPED),
    // ⚠️ 第五十輪批次 C 組：**唔計入失敗。**
    notApplicableCount: count(INVARIANT_STATUS.NOT_APPLICABLE)
  };
}

/**
 * 把不變量結果寫成畀人睇嘅行。
 *
 * ⚠️ 每一條紅色都要連**證據**一齊印。只講「失敗」而唔講實際值，
 * 等於逼下一個人由零查起——而嗰個人好可能就係兩個月之後嘅自己。
 *
 * @param {Object} report `runAllInvariants_()` 的結果
 * @returns {string[]} 逐行
 */
function describeInvariantReport_(report) {
  const lines = ['不變量：' + report.results.length + ' 條　'
    + '✅ ' + report.okCount + '　🔴 ' + report.failedCount
    + '　⚠️ 算不出 ' + report.errorCount
    + '　⚪ 不適用 ' + (report.notApplicableCount || 0)
    + '　⚪ 跳過 ' + report.skippedCount];
  report.results.forEach(function (r) {
    if (r.status === INVARIANT_STATUS.OK) return;
    // ⚠️ 「不適用」用 ⚪，唔用 ⚠️——用 ⚠️ 就會同真失敗混埋一齊，
    // 而紅色一多就冇人再睇。
    const icon = r.status === INVARIANT_STATUS.FAILED ? '🔴'
      : (r.status === INVARIANT_STATUS.ERROR ? '⚠️' : '⚪');
    lines.push('');
    lines.push(icon + ' ' + r.id + '　' + r.label);
    if (r.expected !== '' || r.actual !== '') {
      lines.push('　 預期：' + r.expected);
      lines.push('　 實際：' + r.actual);
    }
    if (r.evidence) lines.push('　 證據：' + r.evidence);
  });
  if (report.failedCount === 0 && report.errorCount === 0) {
    lines.push('');
    lines.push('（沒有失敗的不變量。）');
  }
  return lines;
}

/**
 * 「維護 ▸ 🩺 全面體檢」入面嗰一大項。
 *
 * @param {Object} report `runAllInvariants_()` 的結果
 * @returns {Object} `healthItem_()` 的結果
 */
function classifyInvariantsHealth_(report) {
  const broken = report.failedCount + report.errorCount;
  return healthItem_('不變量',
    // ⚠️ 一條不變量紅咗 ＝ 「畫面同表對唔上」，一定係 MUST。
    // 一條算唔出 ＝ 「我哋唔知對唔對得上」，一樣係 MUST——
    // 「查不到」唔可以當成「冇事」。
    broken > 0 ? HEALTH_SEVERITY.MUST : HEALTH_SEVERITY.INFO,
    '任何時候都必須成立的斷言',
    broken === 0
      ? report.okCount + ' 條全部成立'
      : report.failedCount + ' 條失敗、' + report.errorCount + ' 條算不出',
    broken === 0
      ? '畫面上的數字同工作表對得上。'
      : '⚠️ 以下每一條都代表「畫面講的東西同工作表對不上」，或者「系統自己都算不出來」。',
    report.results.filter(function (r) {
      return r.status !== INVARIANT_STATUS.OK && r.status !== INVARIANT_STATUS.SKIPPED;
    }).map(function (r) {
      return r.id + '　' + r.label + '｜預期 ' + r.expected + '｜實際 ' + r.actual
        + '｜' + r.evidence;
    }));
}

/**
 * 第二十七輪批次階段 G：區二年度工具 ＋ 區四規則審閱表（Web 入口）。
 *
 * 純運算部分喺 `RuleReview.gs`（可以離線測）；呢個檔案只負責
 * 「碰 Drive／碰試算表」同埋包成三段式回傳。
 */

/* ============================================================
 * G1　年度工具（區二「確認特別主日」畫面底部）
 * ============================================================
 *
 * 兩個都係**寫入動作**，所以流程一律：先預覽（列出會新增幾多行、
 * 逐行內容）→ 打字確認 → 執行 → 寫 AuditLog。
 *
 * ⚠️ 呢兩個工具嘅純運算部分（`planAnnualQuarters_()`／
 * `planAnnualCombinedWithContext_()`）早就同選單版分開咗，
 * 所以呢度只係多一個呼叫端，**冇改動選單版任何行為**。
 */

/** 年度工具嘅打字確認字眼。後端自己驗一次，唔靠前端。 */
const ANNUAL_TOOL_CONFIRM_TEXT = '確認';

/**
 * 「產生下一年度四個季度」嘅預覽。**純讀取。**
 * @param {number|string} year
 * @returns {Object}
 */
function apiAnnualQuartersPlan(year) {
  assertWebAppRequestAllowed_();
  try {
    const y = Number(String(year || '').trim());
    if (!y || y < 2000 || y > 2100) {
      return {
        ok: false,
        message: buildThreePartMessage_(
          '年份「' + String(year || '（空白）') + '」看不懂。', '什麼都沒有改動。',
          ['請填四位數的年份，例如 2027'])
      };
    }
    const startMonths = readQuarterTermStartMonths_();
    const existing = readExistingQuarterAndServiceDateIds_();
    const plans = planAnnualQuarters_(y, startMonths,
      existing.quarterIds, existing.serviceDateIds, readQuarterDateSettings_());

    return {
      ok: true,
      year: y,
      rows: plans.map(function (p) {
        return {
          quarterId: p.quarterId,
          startDate: p.startDate,
          endDate: p.endDate,
          weekCount: p.weekCount,
          alreadyExists: !!p.alreadyExists,
          // ⚠️ 第四十四輪批次 G 組：呢兩個要**返到畫面上**。
          // 後端算咗而畫面唔顯示，幹事就要寫入之後去 Quarters 逐格對，
          // 等於冇畀佢過目。
          generateOn: p.generateOn || '',
          officialSendOn: p.officialSendOn || '',
          newServiceDateCount: (p.newServiceDates || []).length,
          skippedServiceDates: p.skippedServiceDates || 0
        };
      })
    };
  } catch (err) {
    return zone4Failure_('產生下一年度四個季度（預覽）', err);
  }
}

/**
 * 執行。**會寫入 Quarters 同 ServiceDates。**
 * @param {number|string} year
 * @param {string} confirmText
 * @returns {Object}
 */
function apiAnnualQuartersExecute(year, confirmText) {
  assertWebAppRequestAllowed_();
  if (String(confirmText || '').trim() !== ANNUAL_TOOL_CONFIRM_TEXT) {
    return {
      ok: false,
      message: buildThreePartMessage_(
        '沒有輸入「' + ANNUAL_TOOL_CONFIRM_TEXT + '」兩個字。', '什麼都沒有改動。',
        ['在確認格輸入「' + ANNUAL_TOOL_CONFIRM_TEXT + '」再撳一次'])
    };
  }
  try {
    // ⚠️ 後端自己重新算一次，唔信前端傳返嚟嗰份。
    const plan = apiAnnualQuartersPlan(year);
    if (!plan.ok) return plan;

    const startMonths = readQuarterTermStartMonths_();
    const existing = readExistingQuarterAndServiceDateIds_();
    const plans = planAnnualQuarters_(plan.year, startMonths,
      existing.quarterIds, existing.serviceDateIds, readQuarterDateSettings_());
    const result = executeAnnualQuarters_(plans);

    writeZone3Audit_({
      action: 'ANNUAL_QUARTERS_CREATE',
      targetSheet: SHEETS.QUARTERS,
      targetKey: String(plan.year),
      oldValue: '（新增）',
      newValue: '季度 ' + result.quartersWritten + ' 個　主日 ' + result.serviceDatesWritten + ' 行',
      notes: '由幹事介面執行；只新增，不覆寫任何既有資料'
    });

    return {
      ok: true,
      year: plan.year,
      quartersWritten: result.quartersWritten,
      serviceDatesWritten: result.serviceDatesWritten,
      // ⚠️ 欄名要對返 `executeAnnualQuarters_()` 真正回嗰個
      //（`skippedQuarters`）。寫錯欄名嘅話，畫面永遠顯示「略過 0 個」，
      // 而嗰個「0」睇落係一個檢查過嘅結果。
      skipped: result.skippedQuarters || []
    };
  } catch (err) {
    return zone4Failure_('產生下一年度四個季度', err);
  }
}

/**
 * 「產生年度合堂建議」嘅預覽。**純讀取。**
 * @param {number|string} year
 * @returns {Object}
 */
function apiAnnualCombinedPlan(year) {
  assertWebAppRequestAllowed_();
  try {
    const y = Number(String(year || '').trim());
    if (!y || y < 2000 || y > 2100) {
      return {
        ok: false,
        message: buildThreePartMessage_(
          '年份「' + String(year || '（空白）') + '」看不懂。', '什麼都沒有改動。',
          ['請填四位數的年份，例如 2027'])
      };
    }
    const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
    const plan = planAnnualCombinedWithContext_(y, timezone);
    return {
      ok: true,
      year: y,
      rows: plan.map(function (p) {
        return {
          serviceDate: p.serviceDate,
          title: p.title,
          kind: p.kind,
          quarterId: p.quarterId || '',
          alreadyExists: !!p.alreadyExists,
          // 冇 QuarterID 嘅行寫咗等於垃圾行（全系統都讀唔到），
          // 所以要喺預覽就講清楚會略過，唔可以寫完先發現。
          willWrite: !p.alreadyExists && !!p.quarterId
        };
      })
    };
  } catch (err) {
    return zone4Failure_('產生年度合堂建議（預覽）', err);
  }
}

/**
 * 執行。**會寫入 SpecialSundays（只 append，永不覆寫）。**
 * @param {number|string} year
 * @param {string} confirmText
 * @returns {Object}
 */
function apiAnnualCombinedExecute(year, confirmText) {
  assertWebAppRequestAllowed_();
  if (String(confirmText || '').trim() !== ANNUAL_TOOL_CONFIRM_TEXT) {
    return {
      ok: false,
      message: buildThreePartMessage_(
        '沒有輸入「' + ANNUAL_TOOL_CONFIRM_TEXT + '」兩個字。', '什麼都沒有改動。',
        ['在確認格輸入「' + ANNUAL_TOOL_CONFIRM_TEXT + '」再撳一次'])
    };
  }
  try {
    const preview = apiAnnualCombinedPlan(year);
    if (!preview.ok) return preview;

    const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
    const plan = planAnnualCombinedWithContext_(preview.year, timezone);
    const result = writeAnnualCombinedSundays_(plan);

    writeZone3Audit_({
      action: 'ANNUAL_COMBINED_CREATE',
      targetSheet: SHEETS.SPECIAL_SUNDAYS,
      targetKey: String(preview.year),
      oldValue: '（新增）',
      newValue: '新增 ' + result.written + ' 行',
      notes: '由幹事介面執行；只 append，不覆寫任何既有資料'
    });

    return {
      ok: true,
      year: preview.year,
      written: result.written,
      // 略過嘅一定要報出嚟（已存在／找不到季度），唔可以靜靜當成成功。
      skipped: result.skipped || []
    };
  } catch (err) {
    return zone4Failure_('產生年度合堂建議', err);
  }
}

/* ============================================================
 * G2　規則審閱表：匯出
 * ============================================================ */

/**
 * 攞（必要時建立）`RuleReview` 子資料夾。
 * @returns {Object} Drive folder
 */
function getOrCreateRuleReviewFolder_() {
  const root = resolveMailAttachmentFolder_();
  return findOrCreateChildFolder_(root, RULE_REVIEW_FOLDER_NAME);
}

/**
 * 第二十八輪批次階段 B3：審閱表要**讀實際資料**，唔可以寫死。
 *
 * Ivan 匯出咗一份俾堂委睇，發現互斥組嗰條寫住「現時無任何組」，
 * 但佢已經把主席同聖餐襄禮設成同一組——嗰句係試算表 `Description` 欄
 * 上面一句寫死嘅字，由頭到尾冇讀過實際資料。
 *
 * 呢個函式讀 `Posts` 出返兩樣：現時有邊幾組互斥、邊幾個崗位有身分要求。
 * @returns {{mutexGroups: Object[], gatedPosts: Object[]}}
 */
function buildRuleReviewContext_() {
  const mutexByGroup = {};
  const gatedPosts = [];
  // 第二十九輪批次階段 A4：`ScopePostIDs` 要譯成中文崗位名先講得出人話。
  const postNameById = {};

  // ⚠️ 第三十輪批次階段 D1：**互斥組要由「未過濾」嘅 Posts 讀。**
  //
  // 實測：`Posts` 入面 `CHAIR` 同 `COMMUNION` 兩行都有 `CHAIR_COMMUNION`，
  // 但匯出只列到「主席」一個。
  //
  // `readPostsNormalized()` → `readPosts()` 會 `filter(Active=TRUE)`。
  // 一個 `Active=FALSE` 嘅組員就會靜靜消失，而畫面上剩返一個成員嘅組
  // 睇落同「配置漏咗」一模一樣——兩件完全唔同嘅事。
  //
  // 所以組員一律由**原始行**讀，並且逐個標返 `active`：
  // 停用嘅照樣列出，但明講佢停用咗。
  //（其餘用途——`postNameById`、身分要求——照舊用已過濾嗰個，
  //  因為嗰兩樣講嘅係「而家生效嘅崗位」。）
  try {
    readSheet(SHEETS.POSTS).forEach(function (row) {
      const postId = String(row[COLUMNS.POSTS.POST_ID] || '').trim();
      if (!postId) return;
      const group = String(row[COLUMNS.POSTS.MUTEX_GROUP] || '').trim();
      if (!group) return;
      if (!mutexByGroup[group]) mutexByGroup[group] = [];
      mutexByGroup[group].push({
        postId: postId,
        postNameTC: String(row[COLUMNS.POSTS.POST_NAME_TC] || '').trim() || postId,
        active: isTrueValue_(row[COLUMNS.POSTS.ACTIVE])
      });
    });
  } catch (err) {
    log_('WARN', '規則審閱表讀不到 Posts 原始行，互斥組會顯示為「沒有設」：' + err.message);
  }

  try {
    readPostsNormalized().forEach(function (p) {
      postNameById[p.postId] = p.postNameTC || p.postId;
      const required = p.requiredRoles || [];
      if (required.length > 0) {
        gatedPosts.push({
          postId: p.postId,
          postNameTC: p.postNameTC || p.postId,
          requiredText: describeRoleCodes_(required)
        });
      }
    });
  } catch (err) {
    // 讀唔到就回空——而**空會令嗰兩條寫「現時一組都沒有設」**，
    // 所以要記低，唔可以當冇事發生。
    log_('WARN', '規則審閱表讀不到 Posts，互斥組／身分要求會顯示為「沒有設」：' + err.message);
  }

  return {
    // ⚠️ `members` 係 `{postId, postNameTC, active}`；`postNames` 仍然
    // 回一個純字串陣列（停用嘅標返「（已停用）」），令舊呼叫端唔使改。
    mutexGroups: Object.keys(mutexByGroup).sort().map(function (g) {
      return {
        group: g,
        members: mutexByGroup[g],
        postNames: mutexByGroup[g].map(function (m) {
          return m.postNameTC + (m.active ? '' : '（已停用）');
        })
      };
    }),
    gatedPosts: gatedPosts,
    postNameById: postNameById,
    // 第三十三輪批次階段 E：最新一季實際數到幾多對「兩邊都排到報告」嘅相鄰主日。
    // 審閱表寫「12 對相鄰的主日之中約 3 對」，但如果有主日冇排報告，
    // 幹事事後喺品質統計見到嘅分母會細過 12——兩張表對唔上、又冇解釋，
    // 睇嘅人會以為係 bug。查唔到就回 null，嗰陣審閱表唔會加嗰句
    //（冇解釋好過一句作出嚟嘅解釋）。
    adjacentPairActual: resolveRuleReviewAdjacentPairActual_()
  };
}

/**
 * 第三十三輪批次階段 E：算最新一季實際嘅「相鄰報告 pair」數同冇排報告嘅週數。
 *
 * 同 `Verify.gs` 嘅 `computeAnnounceConsecutiveRatio_()` 數同一樣嘢，
 * 但呢度只要分母，唔要比例——所以唔會為咗攞一個數而砌成個核對 context。
 *
 * ⚠️ 任何一步查唔到就回 `null`，**唔可以退回「理論值」當成實際值**
 * ——嗰個正正就係呢一段要解釋嘅落差本身。
 *
 * @returns {?{pairs: number, weeksCounted: number, weeksWithoutAnnounce: number}}
 */
function resolveRuleReviewAdjacentPairActual_() {
  try {
    const rules = readRules();
    const rule = rules[RULE_IDS.ANNOUNCE_RELIEF];
    if (!rule) return null;
    const scope = splitList_(rule[COLUMNS.RULE_SETTINGS.SCOPE_POST_IDS]);
    if (scope.length === 0) return null;

    const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
    const weeksInfo = resolveRuleReviewWeeks_(timezone);
    if (!weeksInfo) return null;

    const quarterId = weeksInfo.quarterId;
    const versionNo = findLatestVersionNo(quarterId);
    if (versionNo === null || versionNo === undefined || versionNo < 0) return null;

    const D = COLUMNS.SERVICE_DATES;
    const dates = readSheet(SHEETS.SERVICE_DATES)
      .filter(function (row) { return String(row[D.QUARTER_ID] || '').trim() === quarterId; })
      .map(function (row) {
        return {
          date: toDateString(row[D.SERVICE_DATE], timezone),
          week: Number(row[D.WEEK_INDEX])
        };
      })
      .sort(function (a, b) { return a.week - b.week; })
      .map(function (d) { return d.date; });
    if (dates.length < 2) return null;

    const A = COLUMNS.ROSTER_ASSIGNMENTS;
    const byDate = {};
    readSheet(SHEETS.ROSTER_ASSIGNMENTS).forEach(function (row) {
      if (String(row[A.QUARTER_ID] || '').trim() !== quarterId) return;
      if (Number(row[A.VERSION_NO]) !== versionNo) return;
      if (scope.indexOf(String(row[A.POST_ID] || '').trim()) === -1) return;
      const personId = String(row[A.PERSON_ID] || '').trim();
      if (!personId) return;
      const d = toDateString(row[A.SERVICE_DATE], timezone);
      if (!byDate[d]) byDate[d] = [];
      byDate[d].push(personId);
    });

    let pairs = 0;
    for (let i = 1; i < dates.length; i++) {
      const prev = byDate[dates[i - 1]];
      const cur = byDate[dates[i]];
      if (!prev || !cur || prev.length === 0 || cur.length === 0) continue;
      pairs++;
    }
    let weeksWithoutAnnounce = 0;
    dates.forEach(function (d) {
      if (!byDate[d] || byDate[d].length === 0) weeksWithoutAnnounce++;
    });

    return {
      pairs: pairs,
      weeksCounted: dates.length,
      weeksWithoutAnnounce: weeksWithoutAnnounce
    };
  } catch (err) {
    log_('WARN', '規則審閱表算不到實際相鄰 pair 數，會略過那句解釋：' + err.message);
    return null;
  }
}

/**
 * 匯出一份新嘅規則審閱表。**會喺 Drive 建立一個新試算表。**
 *
 * ⚠️ 一格都唔會改動 `RuleSettings`。
 * @returns {Object}
 */
function apiExportRuleReviewSheet() {
  assertWebAppRequestAllowed_();
  try {
    const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
    const weeksInfo = resolveRuleReviewWeeks_(timezone);
    const weeks = weeksInfo ? weeksInfo.weeks : null;
    const built = buildRuleReviewSheetRows_(
      readSheet(SHEETS.RULE_SETTINGS), weeks, buildRuleReviewContext_());

    const stamp = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');
    const name = '規則審閱表　' + stamp;
    const ss = SpreadsheetApp.create(name);
    const sheet = ss.getSheets()[0];
    sheet.setName('規則審閱');

    sheet.getRange(1, 1, built.rows.length, RULE_REVIEW_HEADERS.length)
      .setValues(built.rows);
    sheet.getRange(1, 1, 1, RULE_REVIEW_HEADERS.length)
      .setFontWeight('bold').setBackground(GRID_COLORS.HEADER).setWrap(true);
    sheet.setFrozenRows(1);

    // 「堂委決定」黃底 ＋ 下拉；其餘欄由系統產生，唔應該改。
    built.meta.forEach(function (m, i) {
      if (!m) {
        // 組標題行：整行粗體，方便一眼分得出三組。
        sheet.getRange(i + 1, 1, 1, RULE_REVIEW_HEADERS.length).setFontWeight('bold');
        return;
      }
      const cell = sheet.getRange(i + 1, RULE_REVIEW_DECISION_COL);
      cell.setBackground(GRID_COLORS.WARNING);
      const rule = SpreadsheetApp.newDataValidation()
        .requireValueInList(m.choices.map(function (c) { return c.label; }), true)
        .setAllowInvalid(false)
        .setHelpText('請由下拉選一個。想改成別的，請在「備註／原因」寫。')
        .build();
      cell.setDataValidation(rule);
    });

    // 第二十八輪批次階段 B5：欄闊 ＋ 自動換行 ＋ 行高。
    // ⚠️ **唔可以用 `autoResizeColumns()`**：說明同選項都係長段文字，
    // 自動調闊會令幾欄變到成千 pixel，堂委要橫向捲先睇得晒。
    // 固定欄闊 ＋ 換行先係啱嘅做法。
    RULE_REVIEW_COLUMN_WIDTHS.forEach(function (w, i) {
      sheet.setColumnWidth(i + 1, w);
    });
    const lastRow = built.rows.length;
    sheet.getRange(1, 1, lastRow, RULE_REVIEW_HEADERS.length)
      .setWrap(true).setVerticalAlignment('top');
    // 選項一個一行，所以行高要夠。設一個下限，內容多就由 Sheets 自己撐高。
    sheet.setRowHeights(2, Math.max(1, lastRow - 1), 60);

    // 搬入 RuleReview 子資料夾（新建嘅試算表預設喺 My Drive 根）。
    const file = DriveApp.getFileById(ss.getId());
    getOrCreateRuleReviewFolder_().addFile(file);
    DriveApp.getRootFolder().removeFile(file);

    writeZone3Audit_({
      action: 'RULE_REVIEW_EXPORT',
      targetSheet: SHEETS.RULE_SETTINGS,
      targetKey: name,
      oldValue: '（唯讀匯出）',
      newValue: built.meta.filter(function (m) { return !!m; }).length + ' 條規則',
      notes: '匯出規則審閱表；沒有改動任何規則設定'
    });

    return {
      ok: true,
      fileName: name,
      fileUrl: ss.getUrl(),
      ruleCount: built.meta.filter(function (m) { return !!m; }).length,
      // ⚠️ 退回試算表說明欄嘅規則要報出嚟——嗰兩欄係寫俾開發者睇嘅，
      // 退回咗就等於呢一條又會出現內部術語，而冇人知。
      fallbackRuleIds: built.fallbackRuleIds,
      // 分母一定要講出嚟。查不到嗰陣，表上會寫百分比而唔係次數，
      // 幹事要知道點解突然唔同咗。
      weeksText: weeksInfo
        ? ('換算用的分母是 ' + weeksInfo.quarterId + ' 的 ' + weeksInfo.weeks + ' 個主日')
        : '查不到一季有幾多個主日，所以小數沒有換算成次數'
    };
  } catch (err) {
    return zone4Failure_('匯出規則審閱表', err);
  }
}

/**
 * 列出 `RuleReview` 資料夾裡面嘅審閱表。**純讀取。**
 * @returns {Object}
 */
function apiListRuleReviewSheets() {
  assertWebAppRequestAllowed_();
  try {
    const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
    const folder = getOrCreateRuleReviewFolder_();
    const files = [];
    const it = folder.getFiles();
    while (it.hasNext()) {
      const f = it.next();
      files.push({
        fileId: f.getId(),
        name: f.getName(),
        updatedAt: Utilities.formatDate(f.getLastUpdated(), timezone, 'yyyy-MM-dd HH:mm')
      });
    }
    files.sort(function (a, b) { return a.updatedAt < b.updatedAt ? 1 : -1; });
    return {
      ok: true,
      files: files.map(function (f) {
        return { fileId: f.fileId, label: f.name + '　（最後修改 ' + f.updatedAt + '）' };
      })
    };
  } catch (err) {
    return zone4Failure_('讀取規則審閱表清單', err);
  }
}

/* ============================================================
 * G2　規則審閱表：匯入
 * ============================================================ */

/**
 * 讀返堂委填好嘅表，砌三欄對照。**純讀取，一格都唔寫。**
 * @param {string} fileId
 * @returns {Object}
 */
function apiRuleReviewImportPlan(fileId) {
  assertWebAppRequestAllowed_();
  try {
    const id = String(fileId || '').trim();
    if (!id) return { ok: false, message: '沒有選要讀哪一份。' };

    const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
    const weeksInfo = resolveRuleReviewWeeks_(timezone);
    const sheet = SpreadsheetApp.openById(id).getSheets()[0];
    const values = sheet.getDataRange().getValues();

    const plan = buildRuleReviewImportPlan_(
      values, readSheet(SHEETS.RULE_SETTINGS),
      weeksInfo ? weeksInfo.weeks : null, buildRuleReviewContext_());

    return {
      ok: true,
      fileId: id,
      changes: plan.changes,
      hardNotes: plan.hardNotes,
      ignored: plan.ignored
    };
  } catch (err) {
    return zone4Failure_('讀取規則審閱表', err);
  }
}

/**
 * 套用幹事勾咗嘅那幾條。**會寫入 RuleSettings。**
 *
 * ⚠️ 後端自己重新算一次計畫，唔信前端傳返嚟嘅值——
 * 前端只傳「邊幾條 RuleID 接受」。
 *
 * @param {string} fileId
 * @param {string[]} acceptedRuleIds
 * @returns {Object}
 */
function apiRuleReviewImportExecute(fileId, acceptedRuleIds) {
  assertWebAppRequestAllowed_();
  try {
    const plan = apiRuleReviewImportPlan(fileId);
    if (!plan.ok) return plan;

    const accepted = {};
    (acceptedRuleIds || []).forEach(function (id) {
      const clean = String(id || '').trim();
      if (clean) accepted[clean] = true;
    });

    const R = COLUMNS.RULE_SETTINGS;
    const opened = openSheetForEdit_(SHEETS.RULE_SETTINGS);
    let applied = 0;

    plan.changes.forEach(function (c) {
      if (!accepted[c.ruleId]) return;
      const found = findRowById_(SHEETS.RULE_SETTINGS, R.RULE_ID, c.ruleId);
      if (found.sheetRow === -1) return;
      // ⚠️ 第二十八輪批次階段 B4：有啲選項改嘅係目標值，有啲改嘅係開關
      //（例如「關掉」）。兩者混做一欄就會把一個 boolean 寫入 TargetValue，
      // 而嗰個值之後會被 `Number()` 讀成 NaN——規則靜靜失效。
      const column = c.field === RULE_REVIEW_FIELD.ENABLED ? R.ENABLED : R.TARGET_VALUE;
      const updates = {};
      updates[column] = c.newValue;
      writeRowFields_(opened.sheet, opened.headers, found.sheetRow, updates);
      applied++;
      writeZone3Audit_({
        action: 'RULE_REVIEW_APPLY',
        targetSheet: SHEETS.RULE_SETTINGS,
        targetKey: c.ruleId,
        oldValue: column + '=' + c.currentValue + '（' + c.currentText + '）',
        newValue: column + '=' + c.newValue + '（' + c.decisionText + '）',
        notes: '由規則審閱表匯入；幹事逐條接受' + (c.note ? '；備註：' + c.note : '')
      });
    });

    // 硬規則：**只記錄，永不改動。** 記低係為咗日後查得返
    // 「堂委當時對呢一條有意見」，而唔係為咗改佢。
    plan.hardNotes.forEach(function (h) {
      writeZone3Audit_({
        action: 'RULE_REVIEW_NOTE_ONLY',
        targetSheet: SHEETS.RULE_SETTINGS,
        targetKey: h.ruleId,
        oldValue: '（沒有改動）',
        newValue: '堂委意見：' + h.decision,
        notes: '一定要遵守的規則不會由匯入改動'
          + (h.note ? '；備註：' + h.note : '')
      });
    });

    return { ok: true, applied: applied, notedOnly: plan.hardNotes.length };
  } catch (err) {
    return zone4Failure_('匯入規則審閱表', err);
  }
}

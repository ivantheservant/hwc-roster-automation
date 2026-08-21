/**
 * 第三十八輪批次 G 組：**逐季逐版清點格子分類（唯讀）。**
 *
 * ═════════════════════════════════════════════════════════════════════
 * 這個工具為什麼存在
 * ═════════════════════════════════════════════════════════════════════
 *
 * 第三十四到三十八輪一連五輪，修的都是同一類毛病：建立新版本的時候，
 * 有些欄位沒有帶過去（`PersonNameSnapshot`／`AssignSource`／`RuleFlags`），
 * 於是那些格子的**分類**變了，圖例上的數字就跟著變。
 *
 * 程式已經修好，但**已經建立出來的版本裡面，壞掉的資料仍然壞著**——
 * 修正只影響「之後再建立的版本」，不會回頭去改舊版本。
 *
 * 所以需要一個工具，可以一次過看清楚：**哪一季、哪一版有問題。**
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ 這個工具**只看，不改**
 * ─────────────────────────────────────────────────────────────────────
 *
 * 它不會改任何一格派工、不會建立版本、不會刪任何東西。
 * 它唯一會寫的是一張自己的報告表（`VersionCellAudit`），同名會重建。
 *
 * **這裡刻意沒有寫自動修復。** 理由：
 *
 *   • 「個名不見了」這件事，系統修不回來——那個名本來就沒有留在
 *     任何地方（舊版本被覆寫的時候就沒有了）。能修回來的只有幹事，
 *     因為只有他知道那一天請的是哪一位講員。
 *   • 一個會自動改舊版本的工具，等於多開一條「不經任何檢查就寫進
 *     RosterAssignments」的路。本專案五輪的教訓正正就是「寫入的路
 *     愈多，愈難保證每一條都對」。
 *
 * 看完之後怎麼辦，寫在 `docs/污染版本處理指引.md`。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 那個「指紋」
 * ─────────────────────────────────────────────────────────────────────
 *
 * 2026-08-20 現場見到的是：`未能安排 ＝ 總格數 − 有派人`（273 − 194 = 79）。
 * 這條等式成立，代表**所有沒有人的格子都被算成「系統排不出」**——
 * 即是「這一週不設」「特殊主日」「待確認」三種原因整批不見了。
 * 這是資料壞掉的訊號，不是排程結果差。
 *
 * 另一個指紋要**比較相鄰兩版**先睇得出：上一版有名字、這一版變成空白。
 * 光看一版的五個桶分不出「從來沒填過」跟「填過但名字掉了」——兩者都是
 * 「待確認」。看上一版就分得出，而且一併給出補救的路：上一版還留著
 * 那個名字，抄回來就是了。
 */

/**
 * ⚠️ 第三十九輪批次（順手）：**這個工具要有自己的時限。**
 *
 * 上一輪的報告自己提過：它一次過讀晒 `RosterAssignments`，
 * 真實資料量（多季 × 多版 × 幾百格）之下可能撞 Apps Script 的六分鐘上限。
 *
 * 撞到的後果不是「慢」，是**執行被切斷**——寫報告那一步根本行不到，
 * 幹事只會見到一個超時錯誤，完全不知道已經看過幾多季。
 *
 * 所以加一條自己的死線：夠鐘就停，把**已經清點好的那部分**照樣寫成報告，
 * 並且明明白白講「還有 N 個版本未看」。
 * 看了一半而講得出看了一半，比什麼都沒有有用得多。
 */
const VERSION_CELL_AUDIT_DEADLINE_MS = 4 * 60 * 1000;

/** 報告工作表的名稱。同名會被重建。 */
const VERSION_CELL_AUDIT_SHEET = 'VersionCellAudit';

/** 報告表的欄位標題。 */
const VERSION_CELL_AUDIT_TITLES = [
  '季度', '版本', '總格數', '有派人', '待確認', '這一週不設', '特殊主日', '未能安排', '判斷'
];

/**
 * 清點一個版本的五種格子分類。**唯讀。**
 *
 * ⚠️ 分類一律經 `classifyGridCell_()`——全系統唯一的分類來源。
 * 這裡不可以自己再寫一套判斷，否則這個工具會跟 grid／PDF 講不同的話，
 * 而幹事會信哪一邊完全沒有道理可言。
 *
 * @param {Object[]} rows 該版本在 RosterAssignments 的所有列（已篩好）
 * @returns {{total: number, counts: Object}} 清點結果
 */
function countVersionCellClasses_(rows) {
  const C = COLUMNS.ROSTER_ASSIGNMENTS;
  const counts = {};
  Object.keys(GRID_CELL_CLASS).forEach(function (k) { counts[GRID_CELL_CLASS[k]] = 0; });

  rows.forEach(function (row) {
    const flags = splitList_(row[C.RULE_FLAGS]);
    const cellClass = classifyGridCell_({
      personId: row[C.PERSON_ID],
      // ⚠️ 一定要傳 `personName`——外請講員沒有 PersonID，只有這個欄位。
      // 漏傳的話這個工具會把填好的講員格報成「未能安排」，
      // 即是它自己製造出它要找的那個症狀（第三十七輪的教訓）。
      personName: row[C.PERSON_NAME_SNAPSHOT],
      assignSource: row[C.ASSIGN_SOURCE],
      ruleFlags: flags
    });
    counts[cellClass]++;
  });

  return { total: rows.length, counts: counts };
}

/**
 * 比較同一季相鄰兩版，找出**上一版有名字、這一版變成空白**的格子。
 *
 * ⚠️ 這一項是這個工具最有用的地方。
 *
 * 光看一版的五個桶，分不出「這一格從來沒有填過」跟「這一格填過但名字掉了」
 * ——兩者長得一模一樣（都是「待確認」）。要分得出，唯一辦法是**看上一版**。
 *
 * 而且這樣一併給出補救的路：上一版還留著那個名字，抄回來就是了。
 * 這比任何自動修復都可靠，因為由幹事親眼確認過才寫回去。
 *
 * @param {Object[]} prevRows 上一版的所有列
 * @param {Object[]} rows 這一版的所有列
 * @param {string} timezone 時區
 * @returns {Object[]} 每筆含 serviceDate／postId／lostName
 */
function findLostNamesBetweenVersions_(prevRows, rows, timezone) {
  const C = COLUMNS.ROSTER_ASSIGNMENTS;
  const keyOf = function (row) {
    return toDateString(row[C.SERVICE_DATE], timezone)
      + '|' + row[C.POST_ID] + '|' + row[C.SLOT_INDEX];
  };
  const nameOf = function (row) {
    return String(row[C.PERSON_NAME_SNAPSHOT] || '').trim();
  };

  const prevByKey = {};
  prevRows.forEach(function (row) { prevByKey[keyOf(row)] = row; });

  const lost = [];
  rows.forEach(function (row) {
    const prev = prevByKey[keyOf(row)];
    if (!prev) return;
    if (!nameOf(prev)) return;               // 上一版本來就冇名 ⇒ 唔關事
    if (nameOf(row)) return;                 // 呢一版仲有名 ⇒ 冇丟失
    if (String(row[C.PERSON_ID] || '')) return;  // 有 PersonID ⇒ 名淨係冇快照，另一件事

    // 這一格變成空白，可能是幹事自己清走的（正常操作）。
    // 但如果它同時仍然帶著「這一格不由系統排」的旗標，那就不是清走，
    // 而是搬版本的時候掉了——因為清走那條路會一併把旗標處理掉。
    const flags = splitList_(row[C.RULE_FLAGS]);
    if (flags.indexOf(RULE_IDS.NO_AUTO_GENERATE) === -1) return;

    lost.push({
      serviceDate: toDateString(row[C.SERVICE_DATE], timezone),
      postId: row[C.POST_ID],
      slotIndex: row[C.SLOT_INDEX],
      lostName: nameOf(prev)
    });
  });
  return lost;
}

/**
 * 判斷一個版本像不像「資料壞掉」，並寫成一句人話。
 * @param {Object} c `countVersionCellClasses_()` 的結果
 * @param {Object[]} lost `findLostNamesBetweenVersions_()` 的結果（第 0 版傳空陣列）
 * @param {number} prevVersionNo 上一版的版本號（第 0 版傳 -1）
 * @returns {{level: string, note: string}} level 為 OK／WARN／BAD
 */
function judgeVersionCellCounts_(c, lost, prevVersionNo) {
  const assigned = c.counts[GRID_CELL_CLASS.ASSIGNED];
  const gap = c.counts[GRID_CELL_CLASS.GENUINE_GAP];

  if (c.total === 0) return { level: 'WARN', note: '這一版沒有任何派工紀錄。' };

  // 指紋一：所有沒有人的格都被算成「排不出」。
  // 這代表「這一週不設」「特殊主日」「待確認」三種原因整批不見了。
  if (gap > 0 && gap === c.total - assigned) {
    return {
      level: 'BAD',
      note: '未能安排（' + gap + '）剛好等於 總格數（' + c.total + '）減 有派人（' + assigned + '）。'
        + '即是「這一週不設」「特殊主日」「待確認」三種原因整批不見了，'
        + '不是排得差，是這一版的資料壞掉。'
    };
  }

  // 指紋二：上一版有名字、這一版變成空白。
  // ⚠️ 這一項光看桶是看不出來的——掉了名字的格跟從來沒填過的格
  // 在五個桶裡面長得一模一樣（都是「待確認」）。
  if (lost && lost.length > 0) {
    const sample = lost.slice(0, 3).map(function (l) {
      return l.serviceDate + ' ' + l.postId + '（' + l.lostName + '）';
    }).join('、');
    return {
      level: 'BAD',
      note: '有 ' + lost.length + ' 格在第 ' + prevVersionNo + ' 版還有名字，到這一版變成空白：'
        + sample + (lost.length > 3 ? ' 等' : '') + '。'
        + '第 ' + prevVersionNo + ' 版還留著那些名字，可以抄回來。'
    };
  }

  if (gap > 0) {
    return { level: 'OK', note: '有 ' + gap + ' 格系統真的排不出，需要人手補。這是正常的排程結果。' };
  }
  return { level: 'OK', note: '沒有發現異常。' };
}

/**
 * 掃描所有季度的所有版本，回傳逐版的清點結果。**唯讀，不改任何資料。**
 * @returns {Object[]} 逐版一筆，含 quarterId／versionNo／counts／level／note
 */
function auditAllVersionCellClasses() {
  const C = COLUMNS.ROSTER_ASSIGNMENTS;
  const all = readSheet(SHEETS.ROSTER_ASSIGNMENTS);

  const byVersion = {};
  const order = [];
  all.forEach(function (row) {
    const q = String(row[C.QUARTER_ID] || '');
    if (!q) return;
    const v = Number(row[C.VERSION_NO]);
    if (isNaN(v)) return;
    const key = q + '|' + v;
    if (!byVersion[key]) { byVersion[key] = []; order.push({ key: key, quarterId: q, versionNo: v }); }
    byVersion[key].push(row);
  });

  order.sort(function (a, b) {
    if (a.quarterId !== b.quarterId) return a.quarterId < b.quarterId ? -1 : 1;
    return a.versionNo - b.versionNo;
  });

  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const startedAt = Date.now();
  const results = [];
  let stoppedEarly = false;

  order.forEach(function (o, i) {
    // ⚠️ 夠鐘就停，但**已經做好那些照樣回**（見檔頭）。
    if (!stoppedEarly && Date.now() - startedAt > VERSION_CELL_AUDIT_DEADLINE_MS) {
      stoppedEarly = true;
    }
    if (stoppedEarly) return;
    const counted = countVersionCellClasses_(byVersion[o.key]);

    // 上一版 ＝ 同一季、緊接住嘅前一個版本號。
    // ⚠️ 一定要核對季度——排序之後，跨季度嘅相鄰兩筆會係唔同季。
    const prev = order[i - 1];
    const hasPrev = !!(prev && prev.quarterId === o.quarterId);
    const lost = hasPrev
      ? findLostNamesBetweenVersions_(byVersion[prev.key], byVersion[o.key], timezone)
      : [];
    const judged = judgeVersionCellCounts_(counted, lost, hasPrev ? prev.versionNo : -1);

    results.push({
      quarterId: o.quarterId,
      versionNo: o.versionNo,
      total: counted.total,
      counts: counted.counts,
      lostNames: lost,
      level: judged.level,
      note: judged.note
    });
  });

  // ⚠️ 停早了**一定要講**。不講的話，一份少了幾季的報告看起來
  // 跟一份完整的報告一模一樣，而幹事會以為那幾季沒有問題。
  results.stoppedEarly = stoppedEarly;
  results.notCheckedCount = order.length - results.length;
  return results;
}

/**
 * 把清點結果寫進 `VersionCellAudit` 工作表。同名工作表會被重建。
 *
 * ⚠️ 這是這個工具唯一會寫的東西。它**不會**碰 RosterAssignments、
 * RosterVersions、任何 grid 工作表，也不會碰任何一季的資料。
 *
 * @param {Object[]} results `auditAllVersionCellClasses()` 的結果
 * @returns {string} 工作表名稱
 */
function writeVersionCellAuditSheet_(results) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const existing = ss.getSheetByName(VERSION_CELL_AUDIT_SHEET);
  if (existing) ss.deleteSheet(existing);
  const sheet = ss.insertSheet(VERSION_CELL_AUDIT_SHEET);

  const values = [VERSION_CELL_AUDIT_TITLES].concat(results.map(function (r) {
    return [
      r.quarterId,
      'v' + r.versionNo,
      r.total,
      r.counts[GRID_CELL_CLASS.ASSIGNED],
      r.counts[GRID_CELL_CLASS.MANUAL_PENDING],
      r.counts[GRID_CELL_CLASS.STRUCTURAL_NA],
      r.counts[GRID_CELL_CLASS.SPECIAL_SKIP],
      r.counts[GRID_CELL_CLASS.GENUINE_GAP],
      r.note
    ];
  }));

  const width = VERSION_CELL_AUDIT_TITLES.length;
  sheet.getRange(1, 1, values.length, width).setValues(values);
  sheet.getRange(1, 1, 1, width).setFontWeight('bold').setBackground(GRID_COLORS.HEADER);

  const backgrounds = results.map(function (r) {
    const colour = r.level === 'BAD' ? GRID_COLORS.WARNING
      : (r.level === 'WARN' ? GRID_COLORS.STATS_HEADER : null);
    const row = [];
    for (let i = 0; i < width; i++) row.push(colour);
    return row;
  });
  if (backgrounds.length > 0) {
    sheet.getRange(2, 1, backgrounds.length, width).setBackgrounds(backgrounds);
  }

  sheet.setFrozenRows(1);
  sheet.getRange(1, width, values.length, 1).setWrap(true);
  return VERSION_CELL_AUDIT_SHEET;
}

/**
 * 第四十輪批次 F5：**把結果同時寫入 `Diagnostics` 同 `AuditLog`。**
 *
 * ⚠️ 2026-08-21 實測撞到：這個工具跑過，但 Ivan
 *   ・讀不到報告（它只寫自己那一張 `VersionCellAudit`，他不知道要去哪裡看）
 *   ・`AuditLog` 一行紀錄都沒有（它根本沒有寫）
 *
 * 兩者加起來的效果是：**跑過等於沒有跑過。**
 * 一個「做完之後查不到自己做過什麼」的診斷工具，比沒有更差——
 * 下一次出事的時候，沒有人答得出「上一次清點是什麼時候、看到什麼」。
 *
 * 所以：
 *   `Diagnostics`　一份摘要（幾多個版本、幾多個看來壞了）——那是全系統
 *                   其他診斷工具都會寫的地方，幹事本來就知道去那裡看
 *   `AuditLog`　　 一行「跑過了」，連同結論
 *   `VersionCellAudit`　逐版明細（本來就有，不變）
 *
 * ⚠️ `Diagnostics` 有總行數上限（`DIAGNOSTICS_MAX_ROWS_TOTAL`），
 * **不會為了這一份而調高**。所以只寫摘要同「看來壞了」那幾個版本，
 * 不逐版寫——逐版寫會把其他報告擠走。
 *
 * @param {Object[]} results `auditAllVersionCellClasses()` 的結果
 * @param {string} sheetName 明細寫在哪一張表
 * @returns {{diagnosticsOk: boolean, diagnosticsError: string}}
 */
function recordVersionCellAudit_(results, sheetName) {
  const bad = results.filter(function (r) { return r.level === 'BAD'; });
  const warn = results.filter(function (r) { return r.level === 'WARN'; });

  const rows = [
    diagRow_('清點格子分類', '清點了幾多個版本', results.length,
      '明細在「' + sheetName + '」'),
    diagRow_('清點格子分類', '看來資料壞掉的版本', bad.length,
      bad.length > 0 ? '見下面逐項' : '沒有'),
    diagRow_('清點格子分類', '要看一眼的版本', warn.length, ''),
    diagRow_('清點格子分類', '這一次有沒有看完',
      results.stoppedEarly ? '沒有' : '有',
      results.stoppedEarly
        ? ('時間不夠，還有 ' + results.notCheckedCount + ' 個版本沒有看')
        : '')
  ];
  // 只列「看來壞了」那幾個，而且有上限——不可以為了這一份把其他報告擠走。
  bad.slice(0, 20).forEach(function (r) {
    rows.push(diagRow_('清點格子分類',
      r.quarterId + ' v' + r.versionNo, '看來壞了', r.note));
  });
  if (bad.length > 20) {
    rows.push(diagRow_('清點格子分類', '（其餘）',
      bad.length - 20, '完整名單在「' + sheetName + '」'));
  }

  const written = tryWriteDiagnosticsDetailed_('清點格子分類', rows);

  // ⚠️ AuditLog **一定要寫**，而且要喺 Diagnostics 寫唔到嗰陣都寫得到。
  // 佢係自由文字、冇行數上限，係「跑過乜嘢」唯一保證查得返嘅地方。
  writeAuditLog_({
    action: 'VERSION_CELL_AUDIT',
    targetSheet: sheetName,
    targetKey: '',
    oldValue: '',
    newValue: '清點了 ' + results.length + ' 個版本：看來壞了 ' + bad.length
      + ' 個、要看一眼 ' + warn.length + ' 個'
      + (results.stoppedEarly
        ? ('（時間不夠，還有 ' + results.notCheckedCount + ' 個沒有看）') : ''),
    source: 'runVersionCellAudit_',
    notes: written.ok ? '摘要已寫入 Diagnostics' : ('Diagnostics 寫不到：' + written.error)
  });

  return { diagnosticsOk: written.ok, diagnosticsError: written.error || '' };
}

/**
 * 選單入口：清點所有季度所有版本的格子分類，寫成報告表。**唯讀。**
 */
function runVersionCellAudit_() {
  const ui = SpreadsheetApp.getUi();
  let results;
  try {
    results = auditAllVersionCellClasses();
  } catch (err) {
    log_('ERROR', 'runVersionCellAudit_ 失敗: ' + err.message);
    ui.alert('清點格子分類', '讀取失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  if (results.length === 0) {
    ui.alert('清點格子分類', '找不到任何版本的派工紀錄。', ui.ButtonSet.OK);
    return;
  }

  const sheetName = writeVersionCellAuditSheet_(results);
  // 第四十輪批次 F5：同時寫 Diagnostics 同 AuditLog（見上面的說明）。
  const recorded = recordVersionCellAudit_(results, sheetName);
  const bad = results.filter(function (r) { return r.level === 'BAD'; });
  const warn = results.filter(function (r) { return r.level === 'WARN'; });

  const lines = [
    '已清點 ' + results.length + ' 個版本，報告寫在「' + sheetName + '」。',
    '',
    '這個工具只看，沒有改動任何資料。',
    '',
    // ⚠️ 寫唔寫得入 Diagnostics 一定要講。第三十輪撞過同一件事：
    // 對話框話「已寫入」，而嗰張表根本冇——真正原因喺 Logger，而 Ivan 讀唔到。
    recorded.diagnosticsOk
      ? '摘要已經寫入「Diagnostics」，逐版明細在「' + sheetName + '」。'
      : ('⚠ 摘要寫不進「Diagnostics」（' + recorded.diagnosticsError
        + '），但逐版明細已經寫在「' + sheetName + '」，而且 AuditLog 有紀錄。')
  ];
  // ⚠️ 沒有看完一定要講在最前面——一份少了幾季的報告，
  // 看起來跟一份完整的報告一模一樣。
  if (results.stoppedEarly) {
    lines.splice(1, 0,
      '',
      '⚠ 時間不夠，還有 ' + results.notCheckedCount + ' 個版本沒有看。',
      '　報告上面那些是真的，只是不齊。再撳一次會由頭再看一遍。');
  }
  if (bad.length > 0) {
    lines.push('');
    lines.push('看來資料壞掉的版本（' + bad.length + ' 個）：');
    bad.slice(0, 10).forEach(function (r) {
      lines.push('　' + r.quarterId + ' v' + r.versionNo);
    });
    if (bad.length > 10) lines.push('　……其餘 ' + (bad.length - 10) + ' 個見報告表');
  }
  if (warn.length > 0) {
    lines.push('');
    lines.push('要看一眼的版本：' + warn.length + ' 個（報告表上有底色）');
  }
  if (bad.length === 0 && warn.length === 0) {
    lines.push('');
    lines.push('全部版本看來都正常。');
  } else {
    lines.push('');
    lines.push('接下來怎麼辦，見 docs/污染版本處理指引.md。');
  }

  ui.alert('清點格子分類', lines.join('\n'), ui.ButtonSet.OK);
}

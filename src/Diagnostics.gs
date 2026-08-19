/**
 * Diagnostics 工作表：把「查看 ▸」各個唯讀工具的報告同時寫入一張細小、結構化的
 * 工作表，方便用 Google Drive connector 一次過完整讀取。
 *
 * 存在的理由：SendLog、AuditLog、RosterAssignments 三張表太大，connector 讀取一定
 * 被截斷，核對系統狀態只能靠人手逐張截圖，這是整個開發流程最慢的一環。
 * 這張表只放「統計與摘要」，不放原始資料，所以永遠夠細，可以被完整讀到。
 *
 * ⚠️ 這個改動令「查看 ▸」由「零寫入」變成「只寫 Diagnostics」。
 * 除了 Diagnostics 這一張表之外，「查看 ▸」底下所有工具仍然不會改動任何其他工作表、
 * 不會改動職事表資料、不會產生版本、不會寄電郵。選單標題已改為
 * 「查看（唯讀，只寫 Diagnostics）」，各個工具的對話框也會註明這一點。
 *
 * 每次執行同一個工具，會先刪走該工具上一次的紀錄再寫入新的，不會無限累積。
 */

/**
 * Diagnostics 單一報告最多保留的行數；超出的部分截斷並附一行說明。
 *
 * ⚠️ 第三十一輪批次階段 C3：由 250 收窄到 240。
 *
 * 揀呢個數嘅根據（唔係拍腦袋）：
 *   實測「全季流程演練」報告　　　　　　　　186 行
 *   ＋ 階段 B1 新加嘅步驟 3.5（前置條件 ＋ 結果 ＋ 12 個 detail 欄）　約 15 行
 *   ＝ 預計約 201 行
 *
 * 240 ＝ 預計值再留約兩成餘裕（人數增加、特殊主日增加都會令佢再長）。
 * **唔敢收到 200**：186 加咗新一步之後已經超過 200，一收就會把
 * 目前唯一一份大報告斬走尾巴——而嗰條尾正正係「清理」同「PDF 逐個檔案」
 * 兩段，即係演練完之後最需要睇嗰兩段。
 *
 * 同時 240 仍然明顯細過 `DIAGNOSTICS_MAX_ROWS_TOTAL`（380），
 * 所以一份大報告唔會單獨迫爆成張表。
 */
const DIAGNOSTICS_MAX_ROWS_PER_REPORT = 240;

/**
 * Diagnostics 整張表最多保留的行數；超出時由最舊的報告開始整份丟棄。
 *
 * ⚠️ 第三十一輪批次階段 C：由 800 收窄到 380。
 *
 * 800 由頭到尾**都係一個定錯咗嘅數**。呢張表存在嘅唯一理由，
 * 係要俾 Google Drive connector **一次過完整讀晒**——而 connector
 * 大約 400 行就會截斷。設成 800 即係：呢張表可以合法地脹到
 * connector 讀唔完，而**佢完全唔會出聲**，讀嗰個人以為自己睇咗全部。
 *
 * 一個「防止讀唔完」嘅上限，設到比讀得完嘅極限大一倍，等於冇設。
 *
 * 380 ＝ 貼住 400 但留返少少餘裕（標題兩行 ＋ 下面「（表格狀態）」自我警告行）。
 */
const DIAGNOSTICS_MAX_ROWS_TOTAL = 380;

/**
 * Google Drive connector 大約讀到幾多行就會截斷。
 * ⚠️ 呢個係**外部工具嘅限制**，唔係我哋設嘅上限——所以獨立寫一個常數，
 * 而唔係喺註解入面提一句。上面兩個上限都要對住佢嚟定。
 */
const DIAGNOSTICS_CONNECTOR_ROW_LIMIT = 400;

/** 自我警告行嘅分區名。寫成常數係因為寫入同清走兩邊都要用同一個值。 */
const DIAGNOSTICS_STATUS_SECTION = '（表格狀態）';

/** 第 1 行的中文標題，對應 COLUMNS.DIAGNOSTICS 的機器鍵次序。 */
const DIAGNOSTICS_TITLES_TC = ['報告名稱', '執行時間', '分區', '項目', '數值', '備註'];

/**
 * 組出一行 Diagnostics 紀錄。純粹是可讀性包裝，省得每處都寫物件字面值。
 * @param {string} section 分區名稱（例如 'Quarters'／'SendLog'）
 * @param {string} item 項目名稱（例如季度 ID、批次 ID）
 * @param {*} value 數值
 * @param {string=} note 備註
 * @returns {{section: string, item: string, value: *, note: string}} 一行紀錄
 */
function diagRow_(section, item, value, note) {
  return { section: section, item: item, value: value, note: note || '' };
}

/**
 * 「（表格狀態）」自我警告行。**純函式**，可以離線測。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ 第三十一輪批次階段 C2：一張表要講得出自己有幾大
 * ─────────────────────────────────────────────────────────────────────
 *
 * 呢張表存在嘅唯一理由，係要俾 Google Drive connector 一次過完整讀晒。
 * 但 connector 讀唔完嗰陣**唔會出聲**——佢淨係少俾你一截。
 *
 * 所以呢張表要自己講：而家幾多行、極限幾多行、夠唔夠位。
 * 冇呢一行嘅話，「讀漏咗」同「本來就係咁多」喺畫面上完全一樣。
 *
 * @param {number} totalRows 包括呢一行自己在內嘅資料行總數
 * @returns {{section: string, item: string, value: string, note: string}}
 */
function buildDiagnosticsStatusRow_(totalRows) {
  const limit = DIAGNOSTICS_CONNECTOR_ROW_LIMIT;

  // ⚠️ **一定要喺 `Number()` 之前擋走 `null`／`undefined`／空字串。**
  //
  // `Number(null)` ＝ 0、`Number('')` ＝ 0、`Number('  ')` ＝ 0。
  // 即係「冇傳到行數落嚟」會靜靜變成「呢張表有 0 行」，
  // 然後備註會好肯定咁話「仲有 400 行空間」——一個完全錯、
  // 但睇落完全正常嘅答案。
  //
  // 呢一行嘅全部用途就係防止「靜靜讀漏咗」，佢自己踩中同一個 bug class
  // 就最諷刺。呢個 check 係先寫測試先發現嘅。
  const total = toFiniteNumberOrNull_(totalRows);

  // ⚠️ 算唔到就要嘈，唔可以印一個似模似樣嘅 0。
  if (total === null || total < 0) {
    return diagRow_(DIAGNOSTICS_STATUS_SECTION, '這張表目前的資料行數', '（算不出來）',
      '收到的行數是「' + totalRows + '」，不是一個數目。'
      + '請把這件事告訴開發者——這一行的用途正是防止「讀漏了」無聲無息發生，'
      + '它自己壞掉時更加不可以靜靜過去。');
  }

  const remaining = limit - total;
  let note;
  if (remaining < 0) {
    note = '⚠️⚠️ 已經超過 connector 大約 ' + limit + ' 行的讀取極限 '
      + (-remaining) + ' 行。用 connector 讀這張表會被截斷，'
      // ⚠️ 呢一句唔可以寫 markdown 粗體——Diagnostics 一格入面
      // 唔會渲染，寫咗就係一堆星號。
      + '而且不會有任何提示——你會以為自己看到了全部。'
      + '請先執行想看的那一個工具，再讀這張表。';
  } else if (remaining <= 40) {
    note = '⚠️ 距離 connector 大約 ' + limit + ' 行的讀取極限只剩 ' + remaining + ' 行。'
      + '再多寫一份報告很可能就會讀不完。';
  } else {
    note = 'connector 大約 ' + limit + ' 行就會截斷，目前還有 ' + remaining + ' 行空間。'
      + '整張表上限 ' + DIAGNOSTICS_MAX_ROWS_TOTAL + ' 行，'
      + '單一報告上限 ' + DIAGNOSTICS_MAX_ROWS_PER_REPORT + ' 行。';
  }
  return diagRow_(DIAGNOSTICS_STATUS_SECTION, '這張表目前的資料行數', total + ' 行', note);
}

/**
 * 取得（必要時建立）Diagnostics 工作表，並確保第 1、2 行的標題正確。
 * 沿用全專案的慣例：第 1 行中文標題、第 2 行機器鍵、資料由第 3 行開始。
 * @returns {Sheet} Diagnostics 工作表
 */
function ensureDiagnosticsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEETS.DIAGNOSTICS);
  if (!sheet) sheet = ss.insertSheet(SHEETS.DIAGNOSTICS);

  const C = COLUMNS.DIAGNOSTICS;
  const keys = [C.REPORT_NAME, C.GENERATED_AT, C.SECTION, C.ITEM, C.VALUE, C.NOTE];

  const existingKeys = sheet.getLastColumn() > 0
    ? sheet.getRange(2, 1, 1, Math.max(sheet.getLastColumn(), keys.length)).getValues()[0]
    : [];
  const headerOk = keys.every(function (k, i) { return existingKeys[i] === k; });

  if (!headerOk) {
    sheet.getRange(1, 1, 1, DIAGNOSTICS_TITLES_TC.length).setValues([DIAGNOSTICS_TITLES_TC])
      .setFontWeight('bold').setBackground(GRID_COLORS.HEADER);
    sheet.getRange(2, 1, 1, keys.length).setValues([keys]).setFontWeight('bold');
    sheet.setFrozenRows(2);
    sheet.setColumnWidth(1, 200);
    sheet.setColumnWidth(2, 150);
    sheet.setColumnWidth(3, 140);
    sheet.setColumnWidth(4, 220);
    sheet.setColumnWidth(5, 200);
    sheet.setColumnWidth(6, 380);
  }
  return sheet;
}

/**
 * 把一份報告寫入 Diagnostics：先刪走同名報告上一次的全部紀錄，再寫入這一次的。
 *
 * 「同名覆蓋」而不是「一直附加」是刻意的——這張表的唯一用途是讓 connector 一次過
 * 讀到目前狀態，累積歷史紀錄只會令它變大到讀不完，反而失去意義。需要歷史紀錄的
 * 場合請看 AuditLog／SendLog，那才是紀錄用的表。
 *
 * @param {string} reportName 報告名稱，同名視為同一份報告
 * @param {Object[]} rows diagRow_() 產生的行陣列
 * @returns {number} 實際寫入的行數
 */
function writeDiagnosticsReport_(reportName, rows) {
  const sheet = ensureDiagnosticsSheet_();
  const C = COLUMNS.DIAGNOSTICS;
  const keys = [C.REPORT_NAME, C.GENERATED_AT, C.SECTION, C.ITEM, C.VALUE, C.NOTE];
  const now = nowTimestamp_();

  let incoming = (rows || []).slice();
  let truncatedNote = null;
  if (incoming.length > DIAGNOSTICS_MAX_ROWS_PER_REPORT) {
    const dropped = incoming.length - DIAGNOSTICS_MAX_ROWS_PER_REPORT;
    incoming = incoming.slice(0, DIAGNOSTICS_MAX_ROWS_PER_REPORT);
    truncatedNote = diagRow_('（截斷）', '超出單一報告上限',
      dropped + ' 行未寫入',
      '單一報告上限 ' + DIAGNOSTICS_MAX_ROWS_PER_REPORT + ' 行，避免這張表大到 connector 讀不完。');
    incoming.push(truncatedNote);
  }

  // 保留其他報告的既有紀錄，只換走同名那一份
  const lastRow = sheet.getLastRow();
  const lastCol = Math.max(sheet.getLastColumn(), keys.length);
  const existing = lastRow >= 3
    ? sheet.getRange(3, 1, lastRow - 2, lastCol).getValues()
      .filter(function (row) {
        if (String(row[0] || '').trim() === '') return false;
        if (String(row[0]) === reportName) return false;
        // ⚠️ 階段 C2：別份報告留低嘅「（表格狀態）」行要丟走。
        // 唔丟嘅話，每份報告各留一行，而**每一行講嘅數都係佢寫入嗰一刻嘅舊數**——
        // 一張用嚟講「而家幾多行」嘅表，同時印住三個唔同嘅答案，
        // 比冇答案更差。下面會統一重新寫一行。
        return String(row[2] || '') !== DIAGNOSTICS_STATUS_SECTION;
      })
    : [];

  const fresh = incoming.map(function (r) {
    return [reportName, now, r.section, r.item,
      (r.value === null || r.value === undefined) ? '' : r.value, r.note];
  });

  let combined = existing.concat(fresh);

  // 總量安全網：超出上限時，由最舊的報告開始整份丟棄（同一份報告不會被斬半）
  if (combined.length > DIAGNOSTICS_MAX_ROWS_TOTAL) {
    const orderByReport = [];
    const seen = {};
    combined.forEach(function (row) {
      const name = String(row[0]);
      if (!seen[name]) { seen[name] = true; orderByReport.push(name); }
    });
    // 目前這一份永遠保留，其餘由排在最前（最舊寫入）的開始丟
    while (combined.length > DIAGNOSTICS_MAX_ROWS_TOTAL && orderByReport.length > 0) {
      const victim = orderByReport.shift();
      if (victim === reportName) continue;
      combined = combined.filter(function (row) { return String(row[0]) !== victim; });
    }
  }

  // ── 自我警告行 ────────────────────────────────────────────
  //
  // ⚠️ 第三十一輪批次階段 C2：**呢張表要講得出自己有幾大。**
  //
  // 之前嘅情況：上限設成 800，而 connector 大約 400 行就截斷。
  // 即係呢張表可以合法地脹到讀唔完，而**讀嗰個人完全睇唔出**——
  // 佢見到嘅嘢會靜靜少咗一截，冇任何提示。
  //
  // 呢一行永遠寫喺最尾，屬於當前報告（下次執行會連同舊嗰行一齊換走）。
  const statusRow = buildDiagnosticsStatusRow_(combined.length + 1);
  combined = combined.concat([[reportName, now, statusRow.section, statusRow.item,
    statusRow.value, statusRow.note]]);

  // 先清空資料區再重寫，避免舊資料殘留在後面
  if (lastRow >= 3) sheet.getRange(3, 1, lastRow - 2, lastCol).clearContent();
  if (combined.length > 0) {
    const width = keys.length;
    const normalized = combined.map(function (row) {
      const out = row.slice(0, width);
      while (out.length < width) out.push('');
      return out;
    });
    sheet.getRange(3, 1, normalized.length, width).setValues(normalized);
  }
  return fresh.length;
}

/**
 * 供各個唯讀工具呼叫的安全包裝：寫入 Diagnostics 失敗時只記 Logger，不影響工具本身
 * 顯示報告。工具的主要用途是給幹事看對話框，寫 Diagnostics 只是順帶方便 connector
 * 讀取，不應該因為後者失敗而令前者也用不到。
 * @param {string} reportName 報告名稱
 * @param {Object[]} rows diagRow_() 產生的行陣列
 * @returns {boolean} 是否成功寫入
 */
function tryWriteDiagnostics_(reportName, rows) {
  return tryWriteDiagnosticsDetailed_(reportName, rows).ok;
}

/**
 * 同 `tryWriteDiagnostics_()`，但**把失敗原因帶返出嚟**。
 *
 * ⚠️ 第三十輪批次階段 C2-2：實測撞到「對話框話已寫入 Diagnostics，
 * 但嗰張表根本冇嗰份報告」。真正原因喺 `Logger`，而
 * **Ivan 讀唔到 `Logger`**——要走去 Apps Script 執行記錄先搵到。
 *
 * 一個「失敗咗但唔講原因」嘅包裝，等於把問題藏起嚟。
 * 呼叫端想講返原因就用呢個；只想知成唔成功就用上面嗰個。
 *
 * @param {string} reportName
 * @param {Object[]} rows
 * @returns {{ok: boolean, error: string}}
 */
function tryWriteDiagnosticsDetailed_(reportName, rows) {
  try {
    writeDiagnosticsReport_(reportName, rows);
    return { ok: true, error: '' };
  } catch (err) {
    log_('WARN', 'writeDiagnosticsReport_(' + reportName + ') 失敗（不影響工具本身）：' + err.message);
    return { ok: false, error: err.message };
  }
}

/* ============================================================
 * 「匯出關鍵狀態」——一次過把最常需要核對的狀態寫入 Diagnostics
 * ============================================================ */

/**
 * 收集全系統最常需要核對的狀態，回傳 Diagnostics 用的行陣列。只讀取，不改動任何東西。
 *
 * 刻意只出「統計與摘要」，不出原始資料：SendLog 只出每個批次的各 Status 數目、
 * Requests 只出 Status 與是否已指派 RequestID（不出 ResultNote 全文），
 * RosterAssignments 完全不出（那張表太大，需要時請用「檢查各版本派工紀錄」）。
 * 目的是令這份報告永遠細到可以被 connector 一次過完整讀到。
 *
 * 每一區都各自 try/catch：其中一張表有問題（例如未建立、欄位缺失）只會在該區寫一行
 * 錯誤說明，不會令整份報告產生不到。
 *
 * @returns {Object[]} diagRow_() 產生的行陣列
 */
function collectKeyStateRows_() {
  const rows = [];
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);

  const section = function (name, fn) {
    try {
      fn();
    } catch (err) {
      rows.push(diagRow_(name, '（讀取失敗）', 'ERROR', err.message));
    }
  };

  // ---- Quarters：每季的 Stage、StageUpdatedAt、最新版本號、版本總數、
  // GenerateOn、OfficialSendOn（階段 E 擴充：原本沒有版本資訊與這兩個排程日期，
  // 要另外去 RosterVersions 分頁才看得到，現在一次過在這裡列齊）----
  section('Quarters', function () {
    const Q = COLUMNS.QUARTERS;
    const V = COLUMNS.ROSTER_VERSIONS;
    const quarters = readSheet(SHEETS.QUARTERS);
    if (quarters.length === 0) rows.push(diagRow_('Quarters', '（沒有資料）', '', ''));

    const versionsByQuarter = {};
    readSheet(SHEETS.ROSTER_VERSIONS).forEach(function (v) {
      const qId = String(v[V.QUARTER_ID] || '').trim();
      if (!qId) return;
      if (!versionsByQuarter[qId]) versionsByQuarter[qId] = [];
      versionsByQuarter[qId].push(Number(v[V.VERSION_NO]));
    });

    quarters.forEach(function (q) {
      const quarterId = String(q[Q.QUARTER_ID] || '').trim();
      if (!quarterId) return;
      const versionNos = versionsByQuarter[quarterId] || [];
      const latestVersionNo = versionNos.length > 0 ? Math.max.apply(null, versionNos) : -1;
      rows.push(diagRow_('Quarters', quarterId,
        String(q[Q.STAGE] || '（空白，視同 DRAFT）'),
        'StageUpdatedAt=' + (toDateString(q[Q.STAGE_UPDATED_AT], timezone) || String(q[Q.STAGE_UPDATED_AT] || '（空白）'))
          + '　StartDate=' + toDateString(q[Q.START_DATE], timezone)
          + '　EndDate=' + toDateString(q[Q.END_DATE], timezone)
          + '　GenerateOn=' + (toDateString(q[Q.GENERATE_ON], timezone) || '（空白，執行時退回 LEAD_DAYS_GENERATE 推算）')
          + '　OfficialSendOn=' + (toDateString(q[Q.OFFICIAL_SEND_ON], timezone) || '（空白，執行時退回 LEAD_DAYS_OFFICIAL 推算）')
          + '　最新版本=' + (latestVersionNo >= 0 ? 'v' + latestVersionNo : '（尚未生成）')
          + '　版本總數=' + versionNos.length));
    });
  });

  // ---- RosterVersions：最新五個版本 ----
  section('RosterVersions', function () {
    const V = COLUMNS.ROSTER_VERSIONS;
    const versions = readSheet(SHEETS.ROSTER_VERSIONS).filter(function (v) {
      return String(v[V.QUARTER_ID] || '').trim() !== '';
    });
    rows.push(diagRow_('RosterVersions', '（全表版本總數）', versions.length, ''));

    versions.sort(function (a, b) {
      const qa = String(a[V.QUARTER_ID]), qb = String(b[V.QUARTER_ID]);
      if (qa !== qb) return qa < qb ? 1 : -1;
      return Number(b[V.VERSION_NO]) - Number(a[V.VERSION_NO]);
    });
    // 第二十二輪批次階段 C：呢一行三個位都有同一個 bug class（`|| ''` 吞咗
    // 有意義嘅假值）——Protected 係 boolean，FALSE 會印成 "Protected="；
    // ParentVersionNo 係數字，v1 嘅 Parent 係 v0 時（合法值 0）會印成
    // "Parent=v"；CreatedAt 直接 String(Date) 會印出成串英文長格式，
    // 唔係 yyyy-MM-dd。三個都改用 B1／B2 建立嘅 helper。
    versions.slice(0, 5).forEach(function (v) {
      rows.push(diagRow_('RosterVersions',
        String(v[V.QUARTER_ID]) + ' v' + v[V.VERSION_NO],
        'Basis=' + String(v[V.BASIS] || ''),
        'WarningCount=' + String(v[V.WARNING_COUNT] || 0)
          + '　Parent=v' + displayCellValue_(v[V.PARENT_VERSION_NO])
          + '　Protected=' + displayCellValue_(v[V.PROTECTED])
          + '　CreatedAt=' + toDateString(v[V.CREATED_AT], timezone)));
    });
  });

  // ---- SendLog：每個批次的統計（不逐行） ----
  section('SendLog', function () {
    const S = COLUMNS.SEND_LOG;
    const logs = readSheet(SHEETS.SEND_LOG);
    rows.push(diagRow_('SendLog', '（全表紀錄總數）', logs.length, ''));

    const batches = {};
    const order = [];
    logs.forEach(function (row) {
      const sendId = String(row[S.SEND_ID] || '').trim();
      if (!sendId) return;
      // SendID 格式為 "季度-vN-階段-時間戳-序號"，去掉最後的序號就是批次
      const batchId = sendId.replace(/-\d+$/, '');
      if (!batches[batchId]) {
        batches[batchId] = { count: 0, stage: String(row[S.STAGE] || ''), statuses: {} };
        order.push(batchId);
      }
      const b = batches[batchId];
      b.count++;
      const status = String(row[S.STATUS] || '（空白）');
      b.statuses[status] = (b.statuses[status] || 0) + 1;
    });

    if (order.length === 0) rows.push(diagRow_('SendLog', '（沒有資料）', '', ''));
    order.forEach(function (batchId) {
      const b = batches[batchId];
      const statusText = Object.keys(b.statuses).sort().map(function (s) {
        return s + '=' + b.statuses[s];
      }).join('　');
      rows.push(diagRow_('SendLog', batchId, b.count + ' 筆',
        'Stage=' + b.stage + '　' + statusText));
    });

    // 階段 E 新增：按「季度＋階段」再聚合一次（上面是按「批次」，同一季同一階段
    // 可能因為改動後重發等原因有多個批次；這裡直接答「這一季這個階段總共寄了
    // 幾多封、各 Status 各幾多」這個更常被問到的問題，一樣只出統計，不逐行）。
    const byQuarterStage = {};
    const qsOrder = [];
    logs.forEach(function (row) {
      const quarterId = String(row[S.QUARTER_ID] || '').trim();
      const stage = String(row[S.STAGE] || '').trim();
      if (!quarterId || !stage) return;
      const key = quarterId + '｜' + stage;
      if (!byQuarterStage[key]) { byQuarterStage[key] = { count: 0, statuses: {} }; qsOrder.push(key); }
      byQuarterStage[key].count++;
      const status = String(row[S.STATUS] || '（空白）');
      byQuarterStage[key].statuses[status] = (byQuarterStage[key].statuses[status] || 0) + 1;
    });
    qsOrder.sort().forEach(function (key) {
      const g = byQuarterStage[key];
      const statusText = Object.keys(g.statuses).sort().map(function (s) {
        return s + '=' + g.statuses[s];
      }).join('　');
      rows.push(diagRow_('SendLog（按季度＋階段彙總）', key, g.count + ' 筆', statusText));
    });
  });

  // ---- Requests：待處理筆數、各 Status 筆數（階段 E 改為只出統計，不逐行輸出
  // 內容——逐行會把 Requests 裡的日期／崗位／姓名／類型細節整批倒進 Diagnostics，
  // 這張表的定位是「統計與摘要」，不是「原始資料備份」，跟 SendLog／
  // RosterAssignments 刻意不逐行是同一個理由）----
  section('Requests', function () {
    const R = COLUMNS.REQUESTS;
    let requests;
    try {
      requests = readSheet(SHEETS.REQUESTS);
    } catch (err) {
      rows.push(diagRow_('Requests', '（工作表不存在）', '', '請先執行「維護 ▸ 建立 Requests 工作表」'));
      return;
    }

    let pendingCount = 0;
    let blankCount = 0;
    const statusCounts = {};
    const quarterCounts = {};
    requests.forEach(function (r) {
      const dateText = toDateString(r[R.SERVICE_DATE], timezone);
      const person = String(r[R.PERSON_NAME] || '').trim();
      const post = String(r[R.POST_NAME] || '').trim();
      const type = String(r[R.REQUEST_TYPE] || '').trim();
      if (!dateText && !person && !post && !type) { blankCount++; return; } // 整行空白
      const hasId = String(r[R.REQUEST_ID] || '').trim() !== '';
      if (!hasId) pendingCount++;
      const status = String(r[R.STATUS] || '（空白）');
      statusCounts[status] = (statusCounts[status] || 0) + 1;
      const quarterId = String(r[R.QUARTER_ID] || '（空白）').trim() || '（空白）';
      quarterCounts[quarterId] = (quarterCounts[quarterId] || 0) + 1;
    });

    rows.push(diagRow_('Requests', '（資料列總數）', requests.length,
      '空白列（不計入以下統計）＝' + blankCount));
    rows.push(diagRow_('Requests', '待處理筆數（未指派 RequestID）', pendingCount, ''));
    Object.keys(statusCounts).sort().forEach(function (s) {
      rows.push(diagRow_('Requests（按 Status）', s, statusCounts[s], ''));
    });
    Object.keys(quarterCounts).sort().forEach(function (q) {
      rows.push(diagRow_('Requests（按季度）', q, quarterCounts[q], ''));
    });
  });

  // ---- Unavailable：全部行（這張表細） ----
  section('Unavailable', function () {
    const U = COLUMNS.UNAVAILABLE;
    const unavailable = readSheet(SHEETS.UNAVAILABLE);
    rows.push(diagRow_('Unavailable', '（資料列總數）', unavailable.length, ''));
    unavailable.forEach(function (u) {
      const personId = String(u[U.PERSON_ID] || '').trim();
      if (!personId) return;
      rows.push(diagRow_('Unavailable', personId,
        toDateString(u[U.DATE_FROM], timezone) + ' → ' + toDateString(u[U.DATE_TO], timezone),
        'AppliesTo=' + String(u[U.APPLIES_TO] || '')
          + '　PostIDs=' + String(u[U.POST_IDS] || '（空白）')
          + '　Source=' + String(u[U.SOURCE] || '')
          + '　Status=' + String(u[U.STATUS] || '')));
    });
  });

  // ---- RosterPDF 資料夾：每個版本的 PDF 數目、最小檔案大小（階段 E 起就有，
  // 用於偵測截斷／空白檔案）；階段 C（第五輪批次）新增總容量與「是否已非
  // 該季度最新版本」（重用 scanPdfStatsByQuarterVersion_()，跟「上線前檢查」
  // 如果日後也用到這個統計，兩邊保證一致，不是各自重複一份分組邏輯）----
  section('RosterPDF', function () {
    const folder = resolveMailAttachmentFolder_();
    const sizes = listExistingFileSizes_(folder);
    rows.push(diagRow_('RosterPDF', '（資料夾名稱）', folder.getName(), ''));
    rows.push(diagRow_('RosterPDF', '（檔案總數）', sizes.size, ''));

    const byVersion = {};
    sizes.forEach(function (size, name) {
      const match = /^(.+?)_v(\d+)_/.exec(name);
      const key = match ? match[1] + ' v' + match[2] : '（不符合命名慣例）';
      if (!byVersion[key]) byVersion[key] = { count: 0, minSize: null };
      byVersion[key].count++;
      if (byVersion[key].minSize === null || size < byVersion[key].minSize) byVersion[key].minSize = size;
    });
    const minBytes = Math.max(0, Math.round(getConfig(CONFIG_KEYS.PDF_MIN_SIZE_BYTES, DEFAULTS.PDF_MIN_SIZE_BYTES)));
    Object.keys(byVersion).sort().forEach(function (key) {
      const v = byVersion[key];
      const flag = (v.minSize !== null && v.minSize < minBytes) ? '⚠️ 低於門檻 ' + minBytes + ' bytes' : '';
      rows.push(diagRow_('RosterPDF', key, v.count + ' 個',
        '最小檔案 ' + v.minSize + ' bytes　' + flag));
    });

    const stats = scanPdfStatsByQuarterVersion_(folder, sizes);
    rows.push(diagRow_('RosterPDF', '（總容量）', formatFileSize_(stats.totalSizeBytes), ''));
    stats.groups.forEach(function (g) {
      const label = g.quarterId ? g.quarterId + ' v' + g.versionNo : '（不符合命名慣例）';
      rows.push(diagRow_('RosterPDF（按季度＋版本容量）', label,
        formatFileSize_(g.sizeBytes),
        g.fileCount + ' 個檔案　' + (g.isLatestVersion ? '目前最新版本' : '⚠️ 已非最新版本（可考慮清理）')));
    });
  });

  // ---- EmailRecipients：每個 Active 收件人的 Role 與實際適用階段（階段 E 新增，
  // 重用階段 C2 的 buildRecipientRoleStageMatrix_()，跟「上線前檢查」顯示的內容
  // 保證一致，不是另外複製一份判斷邏輯）----
  section('EmailRecipients', function () {
    const matrix = buildRecipientRoleStageMatrix_();
    rows.push(diagRow_('EmailRecipients', '（Active 收件人數）', matrix.length, ''));
    matrix.forEach(function (r) {
      rows.push(diagRow_('EmailRecipients', r.displayName + '（' + (r.recipientId || '無 ID') + '）',
        'Role=' + r.role,
        '實際會收：' + (r.effectiveStages.length > 0 ? r.effectiveStages.join('、') : '（不會收到任何階段的信）')
          + '　Stage 欄原始值=' + r.stageRaw));
    });
  });

  // ---- 自動排程 trigger：目前數量，以及應有的樣子（階段 E 新增；階段 A（第五輪
  // 批次）改用 describeConfigValue_() 顯示 SEND_HOUR_LOCAL／SYS_TIMEZONE，
  // 統一標註「Config 未設定，用預設值」，不再是這裡自己一套 undefined 判斷）----
  section('自動排程 Trigger', function () {
    const triggers = listAutomationTriggers_();
    const config = readConfig();
    const sendHour = describeConfigValue_(config, CONFIG_KEYS.SEND_HOUR_LOCAL, 9);
    const tz = describeConfigValue_(config, CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
    rows.push(diagRow_('自動排程 Trigger', '（目前安裝數量）', triggers.length,
      triggers.length === 0 ? '未安裝，自動排程目前不會執行任何動作' : ''));
    rows.push(diagRow_('自動排程 Trigger', '（應有的樣子）',
      '函式=' + AUTOMATION_TRIGGER_FUNCTION + '　頻率=每日一次',
      '執行時間=' + sendHour.display + ':00　時區=' + tz.display));
  });

  // ---- Config：關鍵開關現值（階段 E 擴充加入 WEBAPP_ENABLED 與提醒相關三個
  // Key；階段 A（第五輪批次）全部改用 describeConfigValue_()——原本 DRY_RUN／
  // WEBAPP_ENABLED 兩個是直接 String(config[KEY])，Config 工作表沒有登記這個
  // Key 時會顯示字面文字「undefined」，行為本身安全（其他地方都是用
  // getConfig() 取得正確的生效值），但這份報告顯示的內容具誤導性。現在統一
  // 顯示「實際生效的值」，並在使用了程式碼預設值時明確標註，不會再有任何一個
  // 值顯示成 undefined／null／看起來空白卻沒有說明）----
  // ---- PersonPostWeight：排表偏好（第二十七輪批次階段 B1）----
  //
  // ⚠️ 張表未建立係**正常**嘅（可選表），所以要分得出「未建立」同
  // 「已建立但空白」——前者代表功能未開，後者代表堂委未決定過任何嘢。
  // 兩者都係「零項生效」，但下一步要做嘅事完全唔同。
  section('PersonPostWeight', function () {
    const W = COLUMNS.PERSON_POST_WEIGHT;
    const exists = !!SpreadsheetApp.getActiveSpreadsheet()
      .getSheetByName(SHEETS.PERSON_POST_WEIGHT);
    if (!exists) {
      rows.push(diagRow_('PersonPostWeight', '（工作表尚未建立）', '',
        '這是可選的表。未建立時排表結果同加入這個機制之前一模一樣。'
        + '要用的話：選單「維護 ▸ 補建排表偏好工作表」。'));
      return;
    }

    const today = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');
    const active = readActivePersonPostWeights_(today, timezone);
    const all = readOptionalSheet_(SHEETS.PERSON_POST_WEIGHT);
    rows.push(diagRow_('PersonPostWeight', '（資料列總數）', all.length,
      '生效中 ' + active.rows.length + ' 項　超出範圍而完全沒有生效 '
      + active.invalid.length + ' 項'));

    active.rows.forEach(function (w) {
      rows.push(diagRow_('PersonPostWeight', w.personId + '｜' + w.postId,
        'Adjust=' + (w.adjust > 0 ? '+' : '') + w.adjust,
        'Reason=' + (w.reason || '（空白）')));
    });
    active.invalid.forEach(function (bad) {
      rows.push(diagRow_('PersonPostWeight', bad.personId + '｜' + bad.postId,
        '⚠️ Adjust=' + bad.rawAdjust, bad.reason + '（這一行完全沒有生效）'));
    });
    // 已解除嘅只出總數——保留紀錄係為咗日後查「當時點決定」，
    // 唔係為咗每次都印一次。
    const released = all.filter(function (row) {
      return toDateString(row[W.EFFECTIVE_TO], timezone) !== '';
    });
    rows.push(diagRow_('PersonPostWeight', '（已解除，保留紀錄）', released.length,
      '解除＝填了 EffectiveTo，不是刪行'));
  });

  section('Config', function () {
    const config = readConfig();
    const dryRun = describeConfigValue_(config, CONFIG_KEYS.DRY_RUN, true);
    rows.push(diagRow_('Config', CONFIG_KEYS.DRY_RUN, dryRun.display,
      dryRun.value === false ? '⚠️ FALSE 代表會真正寄出電郵' : 'TRUE 代表不會真正寄出'));

    const subjectPrefix = describeConfigValue_(config, CONFIG_KEYS.MAIL_SUBJECT_PREFIX, '');
    rows.push(diagRow_('Config', CONFIG_KEYS.MAIL_SUBJECT_PREFIX,
      subjectPrefix.value === '' ? '（空白）' : subjectPrefix.display, ''));

    const webappEnabled = describeConfigValue_(config, CONFIG_KEYS.WEBAPP_ENABLED, false);
    rows.push(diagRow_('Config', CONFIG_KEYS.WEBAPP_ENABLED, webappEnabled.display,
      webappEnabled.value === true ? 'TRUE 代表 Web UI 已啟用' : 'FALSE 代表 Web UI 已停用'));

    const allowedEmails = describeConfigValue_(config, CONFIG_KEYS.WEBAPP_ALLOWED_EMAILS, []);
    const allowedList = Array.isArray(allowedEmails.value) ? allowedEmails.value.filter(Boolean) : [];
    rows.push(diagRow_('Config', CONFIG_KEYS.WEBAPP_ALLOWED_EMAILS,
      allowedList.length > 0 ? allowedList.join('、') : '（空白）'
        + (allowedEmails.usedFallback ? '　Config 未設定，用預設值（空清單，退回只允許 SCRIPT_ACCOUNT_EMAIL）' : ''),
      ''));

    const stuckDays = describeConfigValue_(config, CONFIG_KEYS.REMIND_STUCK_DAYS, DEFAULTS.REMIND_STUCK_DAYS);
    rows.push(diagRow_('Config', CONFIG_KEYS.REMIND_STUCK_DAYS, stuckDays.display, '「停滯時間」提醒門檻（天）'));

    const stuckMax = describeConfigValue_(config, CONFIG_KEYS.REMIND_STUCK_MAX_COUNT, DEFAULTS.REMIND_STUCK_MAX_COUNT);
    rows.push(diagRow_('Config', CONFIG_KEYS.REMIND_STUCK_MAX_COUNT, stuckMax.display, '同一「季度＋Stage」最多提醒幾次'));

    const deadlineDays = describeConfigValue_(config, CONFIG_KEYS.REMIND_DEADLINE_DAYS, DEFAULTS.REMIND_DEADLINE_DAYS);
    rows.push(diagRow_('Config', CONFIG_KEYS.REMIND_DEADLINE_DAYS, deadlineDays.display,
      '「死線接近」提醒門檻（距離 OfficialSendOn 幾天內）'));
  });

  return rows;
}

/**
 * 第二十一輪批次階段 A：硬規則違反嘅**三分類**。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 問題（2026-08-17 真實環境實測）
 * ─────────────────────────────────────────────────────────────────────
 *
 * 三個工具各自報咗一項「睇落係 bug、其實唔係 bug」嘅違反：
 *
 * | 工具 | 報告 | 真實成因 |
 * |---|---|---|
 * | 核對職事表 | 「硬規則違反：1 項 ← 這是 bug」 | 幹事已經用打字「確認放行」放行咗，AuditLog 有紀錄，但工具唔讀放行紀錄 |
 * | 上線前檢查 | 「硬規則違反：6 項」 | 版本生成之後先落實嘅崗位身分要求（`Posts.RequiredRoles`），追溯判定 |
 * | 自我測試 | 測試 7 未通過（違反 Unavailable）| 版本生成之後先套用嘅申報寫入咗一行 `Unavailable`，追溯判定 |
 *
 * 三個都唔係排表演算法出錯，但三個都用同一句「這是 bug」講出嚟。
 * 結果係：**真嘅 bug 同呢啲雜訊混埋一齊，睇報告嘅人分唔出。**
 *
 * ─────────────────────────────────────────────────────────────────────
 * 已否決嘅做法：按版本 CreatedAt 過濾規則與申報
 * ─────────────────────────────────────────────────────────────────────
 *
 * 曾經考慮「驗舊版本時，只用嗰個版本生成當日已經存在嘅規則同申報」。
 * **已否決，唔好實作。**
 *
 * 理由：**向前看嘅檢查必須用今日嘅規則。** 如果某人今日已經唔係堂委，
 * 噉一張即將寄出嘅職事表把報告派畀佢就係真問題，同呢張表幾時生成
 * 完全無關。按生成時間過濾，會喺最需要示警嗰一刻把真問題藏起嚟
 * ——呢個正正就係本專案已經踩過三次嘅同一個 bug class：
 * **把「過時」或者「缺失」當成「冇事」。**
 *
 * 所以：判斷邏輯唔變、「必須處理」嘅門檻唔變，**只喺顯示層加分類**。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 第 3 類嘅誠實界線（重要）
 * ─────────────────────────────────────────────────────────────────────
 *
 * 只有喺**來源資料本身帶時間戳**嘅情況下先可以歸入第 3 類：
 *
 * | 來源 | 有冇時間戳 | 可唔可以判斷 |
 * |---|---|---|
 * | `Unavailable.CreatedAt` | ✅ 有 | **可以** |
 * | `Roles.EffectiveFrom` / `EffectiveTo` | ✅ 有 | 現行按服侍日判斷嘅邏輯已經啱，**唔改** |
 * | `Posts.RequiredRoles` | ❌ 冇 | **唔可以** |
 * | `RuleSettings` | ❌ 冇 | **唔可以** |
 *
 * ⚠️ **唔好為「規則定義幾時改」發明任何啟發式判斷。**
 * 上面 2027T1 嗰 6 項按今日規則就係**真違反**，維持第 1 類、維持
 * 「需要處理」。佢哋會喺重新生成嗰陣自然消失，嗰個先係正確嘅解法。
 *
 * （如果覺得值得為 `Posts` 同 `RuleSettings` 加時間戳欄位——
 *   已寫入 `HANDOFF.md` 作為建議，本輪唔實作，因為會改動試算表 schema。）
 */

/** 硬規則違反嘅三種分類。 */
const HARD_VIOLATION_CLASS = {
  /** 按今日規則確實違反，而且冇放行紀錄。**只有呢一類會觸發「需要處理」。** */
  REAL: 'REAL',
  /** AuditLog 有對應嘅「硬規則放行」紀錄。 */
  RELEASED: 'RELEASED',
  /** 造成違反嗰行 `Unavailable` 嘅 `CreatedAt` 晚過該版本嘅 `CreatedAt`。 */
  LATE_UNAVAILABLE: 'LATE_UNAVAILABLE'
};

/** 三分類嘅中文名，報告同對話框共用，唔好各自寫一套。 */
const HARD_VIOLATION_CLASS_LABEL = {
  REAL: '真違反',
  RELEASED: '已放行',
  LATE_UNAVAILABLE: '版本生成後才新增的申報'
};

/**
 * 放行紀錄喺 AuditLog `Notes` 欄嘅機器可讀前綴。
 *
 * 前綴後面係用「；」分隔嘅 key 清單，每個 key 由
 * `buildHardViolationKey_()` 產生。
 *
 * 點解要有一個明確前綴：`Notes` 同時要畀人睇，所以會有人類語句；
 * 冇前綴就要靠猜邊一段係 key，等於返返去「靠訊息文字比對」。
 */
const HARD_RELEASE_KEY_PREFIX = 'RELEASED_KEYS:';

/**
 * 造一個違反項目嘅比對 key。
 *
 * ⚠️ **一定要用結構化欄位，唔可以用顯示文字。** 顯示文字係會改嘅
 * （第十七輪就改過一次違規訊息措辭），一改就會同舊紀錄對唔上，
 * 然後所有已放行嘅項目靜靜咁變返「真違反」。
 *
 * @param {string} quarterId 季度 ID
 * @param {Object} v 結構化違反項目
 * @returns {string} `季度|服侍日期|PostID|SlotIndex|PersonID|RuleID`
 */
function buildHardViolationKey_(quarterId, v) {
  return [
    quarterId,
    v.serviceDate,
    v.postId,
    v.slotIndex === null || v.slotIndex === undefined ? '' : String(v.slotIndex),
    v.personId || '',
    v.ruleId || ''
  ].join('|');
}

/**
 * 由 AuditLog 讀出某季度已放行嘅違反 key。
 *
 * @param {Array[]} auditRows `readSheet(SHEETS.AUDIT_LOG)` 嘅結果
 * @param {string} quarterId 季度 ID
 * @returns {Object.<string, boolean>} 已放行嘅 key 集合
 */
function readReleasedHardViolationKeys_(auditRows, quarterId) {
  const C = COLUMNS.AUDIT_LOG;
  const released = {};

  (auditRows || []).forEach(function (row) {
    if (String(row[C.ACTION] || '') !== HARD_RELEASE_ACTION) return;
    if (String(row[C.TARGET_KEY] || '') !== quarterId) return;

    const notes = String(row[C.NOTES] || '');
    const at = notes.indexOf(HARD_RELEASE_KEY_PREFIX);
    if (at === -1) return;   // 舊格式，見下面 readLegacyReleasedHardViolations_()

    notes.slice(at + HARD_RELEASE_KEY_PREFIX.length)
      .split('；')
      .forEach(function (key) {
        const trimmed = key.trim();
        if (trimmed) released[trimmed] = true;
      });
  });

  return released;
}

/**
 * 讀**舊格式**（第二十一輪之前）嘅放行紀錄。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 點解要有呢個相容層，同埋佢嘅界線喺邊
 * ─────────────────────────────────────────────────────────────────────
 *
 * 第二十一輪之前，`logHardViolationRelease_()` 只把被放行嘅項目寫成
 * 一句人類可讀嘅句子，格式係：
 *
 *     `{服侍日期} {崗位中文名或 PostID}#{SlotIndex} {人名} {RuleID}`
 *
 * 入面**冇 PersonID**（只有人名），而且崗位可能係中文名而唔係 PostID。
 * 所以舊紀錄**砌唔出完整嘅 6 欄 key**。
 *
 * 取捨：
 *
 * | 做法 | 問題 |
 * |---|---|
 * | 完全唔理舊紀錄 | 2026T4 v1 嗰項已經放行過嘅違反會變返「真違反」，幹事要再放行一次先會對——等於話佢之前做嘅嘢唔算數 |
 * | 靠訊息文字模糊比對 | 正正就係要避免嘅嘢：訊息一改就靜靜對唔上 |
 * | **解析已知格式，用縮減 key 比對**（採用）| 精確度較低，但係**確定性**嘅解析，唔係模糊比對 |
 *
 * 採用第三個。縮減 key 係「服侍日期 ＋ RuleID」——呢兩個喺舊格式入面
 * 一定準確（日期係系統寫、RuleID 係常數）。崗位同人名唔入 key，
 * 因為崗位可能係中文名、人名可能有別名。
 *
 * ⚠️ **代價（要講清楚）**：同一日、同一條規則、唔同崗位嘅兩項違反，
 * 舊紀錄只放行咗其中一項嘅話，另一項都會被當成已放行。
 * 呢個係舊資料本身資訊不足造成嘅，唔係做法揀錯。
 * 新格式冇呢個問題——由本輪起寫入嘅紀錄一律係完整 6 欄 key。
 *
 * @param {Array[]} auditRows `readSheet(SHEETS.AUDIT_LOG)` 嘅結果
 * @param {string} quarterId 季度 ID
 * @returns {Object.<string, boolean>} 已放行嘅**縮減** key（`日期|RuleID`）集合
 */
function readLegacyReleasedHardViolations_(auditRows, quarterId) {
  const C = COLUMNS.AUDIT_LOG;
  const released = {};

  (auditRows || []).forEach(function (row) {
    if (String(row[C.ACTION] || '') !== HARD_RELEASE_ACTION) return;
    if (String(row[C.TARGET_KEY] || '') !== quarterId) return;

    const notes = String(row[C.NOTES] || '');
    if (notes.indexOf(HARD_RELEASE_KEY_PREFIX) !== -1) return;   // 新格式，唔使行呢度

    notes.split('；').forEach(function (part) {
      // 舊格式每段係 `yyyy-MM-dd 崗位#slot 人名 RULE_ID`
      const m = /^\s*(\d{4}-\d{2}-\d{2})\s.*?\s([A-Z][A-Z0-9_]+)\s*$/.exec(part);
      if (m) released[m[1] + '|' + m[2]] = true;
    });
  });

  return released;
}

/** AuditLog 入面「硬規則放行」嘅 Action 值，寫入同讀取共用一個常數。 */
const HARD_RELEASE_ACTION = '硬規則放行';

/**
 * 把硬規則違反分成三類。**純函式**，離線測得到。
 *
 * @param {Object[]} violations 結構化違反項目（`checkHardRuleViolations_()` 出品）
 * @param {Object} context 分類所需資料，欄位見下面嘅檢查
 * @returns {{items: Object[], real: Object[], released: Object[],
 *   lateUnavailable: Object[], needsAction: boolean, summary: string}}
 */
function classifyHardViolations_(violations, context) {
  // 沿用第十八輪嘅 API 收緊原則：缺欄位一律拋錯，唔可以靜默預設。
  // 靜默預設嘅後果喺呢度特別嚴重——`releasedKeys` 當成空 `{}` 嘅話，
  // 所有已放行項目都會變返「真違反」，而報告會照樣言之鑿鑿咁講出嚟。
  requireHardClassField_(context, 'quarterId', 'string');
  requireHardClassField_(context, 'releasedKeys', 'object');
  requireHardClassField_(context, 'legacyReleasedKeys', 'object');
  requireHardClassField_(context, 'unavailableCreatedAtByPerson', 'object');
  requireHardClassField_(context, 'versionCreatedAtMs', 'numberOrNull');

  const items = (violations || []).map(function (v) {
    const key = buildHardViolationKey_(context.quarterId, v);

    if (context.releasedKeys[key]) {
      return decorateHardViolation_(v, HARD_VIOLATION_CLASS.RELEASED, key, '已由幹事打字放行');
    }
    const legacyKey = v.serviceDate + '|' + (v.ruleId || '');
    if (context.legacyReleasedKeys[legacyKey]) {
      return decorateHardViolation_(v, HARD_VIOLATION_CLASS.RELEASED, key,
        '已由幹事打字放行（舊格式紀錄，按「日期＋規則」比對）');
    }

    // 第 3 類：只對 Unavailable 成立，而且**兩邊都要有時間戳**先判斷得到。
    //
    // 用 epoch 毫秒比較，唔用格式化字串——時間戳格式係 Config 可調嘅
    // （`SYS_TIMESTAMP_FORMAT`），用字串比較會隨住格式改動而靜靜失效。
    if (v.ruleId === RULE_IDS.UNAVAILABLE && context.versionCreatedAtMs !== null) {
      const createdMs = context.unavailableCreatedAtByPerson[
        v.personId + '|' + v.serviceDate];
      if (typeof createdMs === 'number' && createdMs > context.versionCreatedAtMs) {
        return decorateHardViolation_(v, HARD_VIOLATION_CLASS.LATE_UNAVAILABLE, key,
          '這一行 Unavailable 是版本生成之後才新增的'
          + '（申報時間 ' + new Date(createdMs).toISOString().slice(0, 16).replace('T', ' ')
          + '，版本生成 ' + new Date(context.versionCreatedAtMs).toISOString().slice(0, 16).replace('T', ' ') + '）');
      }
    }

    return decorateHardViolation_(v, HARD_VIOLATION_CLASS.REAL, key, '');
  });

  const pick = function (cls) {
    return items.filter(function (i) { return i.violationClass === cls; });
  };
  const real = pick(HARD_VIOLATION_CLASS.REAL);
  const released = pick(HARD_VIOLATION_CLASS.RELEASED);
  const lateUnavailable = pick(HARD_VIOLATION_CLASS.LATE_UNAVAILABLE);

  return {
    items: items,
    real: real,
    released: released,
    lateUnavailable: lateUnavailable,
    // ⚠️ 「需要處理」只由**真違反**決定。已放行同第 3 類照樣列出嚟，
    // 但唔會令流程卡住——佢哋唔係要人做嘢嘅嘢。
    needsAction: real.length > 0,
    summary: buildHardViolationSummary_(items.length, real.length,
      released.length, lateUnavailable.length)
  };
}

/**
 * 檢查 `classifyHardViolations_()` 嘅 context 欄位，缺就拋錯。
 * @param {Object} context context 物件
 * @param {string} field 欄位名
 * @param {string} kind 'string'／'object'／'stringOrNull'
 * @returns {void}
 */
function requireHardClassField_(context, field, kind) {
  const value = context ? context[field] : undefined;
  const ok = kind === 'string' ? typeof value === 'string'
    : kind === 'numberOrNull' ? (value === null || typeof value === 'number')
      : (value !== null && typeof value === 'object');
  if (ok) return;

  throw new Error(
    '硬規則違反分類缺少 `' + field + '` 欄位（classifyHardViolations_ 需要它）。\n\n'
    + '收到的值是：' + (value === undefined ? 'undefined（欄位完全不存在）' : JSON.stringify(value)) + '\n\n'
    + '⚠️ 這個欄位不可以省略。如果靜默當成空值，後果是'
    + '「所有已放行的項目都會被當成真違反」——\n'
    + '而報告會照樣言之鑿鑿地把它們列成需要處理，'
    + '幹事之前做過的放行等於白做。\n\n'
    + '請用 `buildHardViolationClassContext_()`（HardViolationClass.gs）產生這個 context，'
    + '不要自己拼。'
  );
}

/**
 * 把分類結果貼返落項目上，保留原本全部欄位。
 * @param {Object} v 違反項目
 * @param {string} violationClass 分類
 * @param {string} key 比對 key
 * @param {string} note 分類理由（畀人睇）
 * @returns {Object} 加咗分類欄位嘅副本
 */
function decorateHardViolation_(v, violationClass, key, note) {
  return Object.assign({}, v, {
    violationClass: violationClass,
    violationKey: key,
    classNote: note,
    classLabel: HARD_VIOLATION_CLASS_LABEL[violationClass]
  });
}

/**
 * 摘要句。三個工具共用同一句寫法，唔好各自寫一套。
 *
 * ⚠️ 特登**冇**「← 這是 bug」嗰句。原本嗰句對三類項目一視同仁，
 * 而其中兩類根本唔係 bug（一類係幹事自己決定放行、一類係版本生成之後
 * 先出現嘅申報）。一句講錯嘅結論，比冇結論更差。
 *
 * @param {number} total 合計
 * @param {number} real 真違反
 * @param {number} released 已放行
 * @param {number} late 版本生成後才新增的申報
 * @returns {string} 摘要句
 */
function buildHardViolationSummary_(total, real, released, late) {
  if (total === 0) return '硬規則違反：0 項 ✓';

  const parts = [];
  parts.push(HARD_VIOLATION_CLASS_LABEL.REAL + ' ' + real);
  if (released > 0) parts.push(HARD_VIOLATION_CLASS_LABEL.RELEASED + ' ' + released);
  if (late > 0) parts.push(HARD_VIOLATION_CLASS_LABEL.LATE_UNAVAILABLE + ' ' + late);

  const head = '硬規則違反：' + total + ' 項（' + parts.join('、') + '）';
  if (real === 0) {
    return head + '\n　沒有真違反——其餘各項是已知情況，不需要處理。';
  }
  return head + '\n　其中 ' + real + ' 項需要在正式發出前處理，或明確放行。';
}

/**
 * 收齊 `classifyHardViolations_()` 需要嘅 context。四個呼叫點共用。
 *
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {Object[]} unavailableRows 已正規化嘅 Unavailable（要有 `createdAt`）
 * @returns {Object} 供 `classifyHardViolations_()` 使用嘅 context
 */
function buildHardViolationClassContext_(quarterId, versionNo, unavailableRows) {
  const auditRows = readOptionalSheetRows_(SHEETS.AUDIT_LOG);

  // 逐個 (人, 日期) 記低嗰行 Unavailable 幾時建立。同一個人同一日
  // 有多行嘅話取**最早**嗰個——最早嗰行先係「呢個違反本來就存在」
  // 嘅證據；取最晚會把一個舊申報誤判成新加。
  const createdAtByPerson = {};
  (unavailableRows || []).forEach(function (u) {
    const ms = toEpochMillis_(u.createdAt);
    if (ms === null || !u.personId) return;
    eachDateInRange_(u.dateFrom, u.dateTo, function (dateStr) {
      const key = u.personId + '|' + dateStr;
      if (createdAtByPerson[key] === undefined || ms < createdAtByPerson[key]) {
        createdAtByPerson[key] = ms;
      }
    });
  });

  return {
    quarterId: quarterId,
    releasedKeys: readReleasedHardViolationKeys_(auditRows, quarterId),
    legacyReleasedKeys: readLegacyReleasedHardViolations_(auditRows, quarterId),
    unavailableCreatedAtByPerson: createdAtByPerson,
    versionCreatedAtMs: readVersionCreatedAtMs_(quarterId, versionNo)
  };
}

/**
 * 把試算表讀返嚟嘅時間值轉成 epoch 毫秒。
 * Date 物件、可 parse 嘅字串都收；其餘一律 null（＝「唔知」，唔係 0）。
 * @param {*} value 時間值
 * @returns {?number} epoch 毫秒；判斷唔到回傳 null
 */
function toEpochMillis_(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return isNaN(t) ? null : t;
  }
  const parsed = new Date(String(value));
  const t = parsed.getTime();
  return isNaN(t) ? null : t;
}

/**
 * 讀某個版本嘅 `CreatedAt`（`RosterVersions`）。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {?number} epoch 毫秒；搵唔到回傳 null
 */
function readVersionCreatedAtMs_(quarterId, versionNo) {
  const C = COLUMNS.ROSTER_VERSIONS;
  const rows = readOptionalSheetRows_(SHEETS.ROSTER_VERSIONS);
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][C.QUARTER_ID] !== quarterId) continue;
    if (Number(rows[i][C.VERSION_NO]) !== Number(versionNo)) continue;
    return toEpochMillis_(rows[i][C.CREATED_AT]);
  }
  return null;
}

/**
 * 讀一張工作表，唔存在就當空——分類係附加資訊，唔應該因為缺表而拋錯。
 * @param {string} sheetName 工作表名
 * @returns {Array[]} 資料列
 */
function readOptionalSheetRows_(sheetName) {
  try {
    return readSheet(sheetName) || [];
  } catch (err) {
    log_('WARN', 'buildHardViolationClassContext_: 讀 ' + sheetName + ' 失敗，當作沒有紀錄。' + err.message);
    return [];
  }
}

/**
 * 逐日走一個日期範圍。`dateTo` 空白時當成只有 `dateFrom` 一日。
 * @param {string} dateFrom 起日 yyyy-MM-dd
 * @param {string} dateTo 迄日 yyyy-MM-dd
 * @param {function(string):void} fn 逐日回呼
 * @returns {void}
 */
function eachDateInRange_(dateFrom, dateTo, fn) {
  if (!dateFrom) return;
  const end = dateTo || dateFrom;
  let cursor = dateFrom;
  // 上限 400 日：防止資料出錯（例如 dateTo 打錯成 2099）令迴圈變成無限
  for (let guard = 0; guard < 400 && cursor <= end; guard++) {
    fn(cursor);
    cursor = shiftDateString_(cursor, 1);
  }
}

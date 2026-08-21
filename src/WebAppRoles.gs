/**
 * 第二十七輪批次階段 C：區三畫面七——身分（堂委／執事）。
 *
 * 對應 `docs/幹事介面規格.md` 第 4.3 節。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 呢個畫面最重要嘅功能係「換屆」，唔係逐個改
 * ─────────────────────────────────────────────────────────────────────
 *
 * 身分名單平時幾乎唔會動。真正會用到呢個畫面嘅時刻只有一個：**換屆**。
 * 而換屆嗰陣最容易做錯嘅事，就係**把舊嘅行刪走**。
 *
 * 刪走之後會發生咩：`Roles` 係按日期判斷「嗰一日佢係咪堂委」嘅。
 * 刪咗舊行，系統就會當佢**由頭到尾都唔係堂委**——於是上一季、上上季
 * 嘅職事表全部會被追溯判成違反「報告限堂委」嗰條硬規則。
 * 而嗰啲季度早就寄咗信、印咗 PDF、做咗事，改唔到亦唔應該改。
 *
 * 所以換屆要做嘅係：**把現任嗰批填上「生效至」＝卸任日**，然後加新一屆。
 * 呢個畫面把嗰件事做成一粒掣（`apiRolesTermChangePlan` ／ `Execute`），
 * 令「做啱」比「做錯」更方便。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 四條區三規矩（見 WebAppRoster3Common.gs）呢度全部適用
 * ─────────────────────────────────────────────────────────────────────
 * 唔刪行／只改該行該欄／每次寫 AuditLog／儲存前確認。
 */

/**
 * 換屆嘅打字確認字眼。同前端 `CONFIRM_PHRASE` 一樣，但**後端唔靠前端**
 * ——前端嗰層只係提早俾回饋，真正嘅關卡喺呢度。
 */
const ROLES_TERM_CHANGE_CONFIRM_TEXT = '確認';

/** 畫面下拉嘅身分選項。**永遠唔顯示英文碼**，只顯示中文。 */
function listRoleChoices_() {
  return Object.keys(ROLE_CODES).map(function (k) {
    return { roleCode: ROLE_CODES[k], label: ROLE_LABELS_TC[ROLE_CODES[k]] || ROLE_CODES[k] };
  });
}

/**
 * 列出身分名單，**按人分組**。
 *
 * 一個人可以有多行（同時是堂委又是執事、或者卸任之後再連任），
 * 所以唔可以一行一個人噉樣顯示。
 *
 * @param {string=} keyword 姓名／編號搜尋
 * @returns {Object} {ok, today, roleChoices, people:[{personId,nameTC,rows:[…]}], posts…}
 */
function apiListRoles(keyword) {
  assertWebAppRequestAllowed_();
  beginSheetReadMemo_();
  try {
    const R = COLUMNS.ROLES;
    const M = COLUMNS.NAME_MAPPING;
    const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
    const today = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');

    let raw = [];
    let sheetExists = true;
    try {
      raw = readOptionalSheet_(SHEETS.ROLES);
    } catch (err) {
      sheetExists = false;
      log_('INFO', 'Roles 工作表未建立：' + err.message);
    }

    const nameIndex = buildPersonNameIndex_();

    // 全部人（供「新增一行」嘅下拉用）——只列在職嘅，但**唔會**因此
    // 隱藏已停用者本來就有嘅身分行（歷史紀錄一律照顯示）。
    const allPeople = [];
    readSheet(SHEETS.NAME_MAPPING).forEach(function (row) {
      const id = String(row[M.PERSON_ID] || '').trim();
      if (!id) return;
      if (!isTrueValue_(row[M.ACTIVE])) return;
      allPeople.push({ personId: id, nameTC: String(row[M.NAME_TC] || '').trim() || id });
    });
    allPeople.sort(function (a, b) { return a.nameTC < b.nameTC ? -1 : 1; });

    const byPerson = {};
    const order = [];
    raw.forEach(function (row) {
      const personId = String(row[R.PERSON_ID] || '').trim();
      if (!personId) return;
      const nameTC = nameIndex[personId] || personId;
      if (!matchesPeopleSearch_(keyword, [nameTC, personId])) return;

      const from = toDateString(row[R.EFFECTIVE_FROM], timezone);
      const to = toDateString(row[R.EFFECTIVE_TO], timezone);
      const active = isTrueValue_(row[R.ACTIVE]);
      const roleCode = String(row[R.ROLE_CODE] || '').trim().toUpperCase();

      if (!byPerson[personId]) {
        byPerson[personId] = { personId: personId, nameTC: nameTC, rows: [] };
        order.push(personId);
      }
      byPerson[personId].rows.push({
        roleAssignmentId: String(row[R.ROLE_ASSIGNMENT_ID] || '').trim(),
        roleCode: roleCode,
        // 畫面永遠顯示中文。認唔出嘅代號原樣顯示 ＋ 標記，**唔可以靜靜當成
        // 一個已知身分**——打錯字嘅話規則會靜靜失效，而畫面睇落正常。
        roleLabel: ROLE_LABELS_TC[roleCode] || roleCode,
        unknownRoleCode: !ROLE_LABELS_TC[roleCode],
        effectiveFrom: from,
        effectiveTo: to,
        active: active,
        // ⚠️ `notes` 係**原值**，畀「修改」欄位用。唔可以喺呢度清走——
        // 清走嘅話幹事一撳「儲存」就會把試算表嗰個值抹咗。
        notes: String(row[R.NOTES] || '').trim(),
        // `notesDisplay` 先係畫面用嗰個（階段 E1：備註同個名一樣就唔顯示）。
        notesDisplay: displayableNote_(row[R.NOTES], nameTC),
        // 「現任」＝ Active 而且今日喺生效期內
        current: active && (!from || from <= today) && (!to || to >= today)
      });
    });

    const people = order.map(function (id) { return byPerson[id]; });
    people.sort(function (a, b) { return a.nameTC < b.nameTC ? -1 : 1; });

    return {
      ok: true,
      sheetExists: sheetExists,
      today: today,
      roleChoices: listRoleChoices_(),
      people: people,
      allPeople: allPeople,
      currentCount: people.reduce(function (n, p) {
        return n + p.rows.filter(function (r) { return r.current; }).length;
      }, 0)
    };
  } finally {
    endSheetReadMemo_();
  }
}

/**
 * 共用：驗一行身分嘅輸入。
 * @param {Object} p {personId, roleCode, effectiveFrom, effectiveTo}
 * @param {string} timezone
 * @returns {{ok: boolean, message: string, values: Object}}
 */
function validateRoleInput_(p, timezone) {
  const bad = function (what, actions) {
    return { ok: false, message: buildThreePartMessage_(what, '什麼都沒有改動。', actions), values: {} };
  };

  const personId = String(p.personId || '').trim();
  if (!personId) return bad('沒有選人。', ['在上面的下拉選一位']);

  const roleCode = String(p.roleCode || '').trim().toUpperCase();
  if (!ROLE_LABELS_TC[roleCode]) {
    return bad('身分不是「堂委」或者「執事」。',
      ['在下拉重新選一次', '如果這裡應該有第三種身分，要先在程式碼加入，不能只在表上打字']);
  }

  // 生效日**可以留空**（＝一直以來都是），同 Roles.gs 嘅讀取邏輯一致。
  let from = '';
  if (String(p.effectiveFrom || '').trim() !== '') {
    const parsed = parseOfficerDateInput_(p.effectiveFrom, timezone);
    if (!parsed.ok) {
      return bad('生效日「' + (parsed.rawText || String(p.effectiveFrom)) + '」看不懂。',
        ['請用 2026-11-08 這種寫法（年-月-日）', '留空代表「一直以來都是」']);
    }
    from = parsed.dateStr;
  }

  let to = '';
  if (String(p.effectiveTo || '').trim() !== '') {
    const parsed = parseOfficerDateInput_(p.effectiveTo, timezone);
    if (!parsed.ok) {
      return bad('生效至「' + (parsed.rawText || String(p.effectiveTo)) + '」看不懂。',
        ['請用 2026-11-08 這種寫法（年-月-日）', '留空代表「仍然在任」']);
    }
    to = parsed.dateStr;
  }

  if (from && to && from > to) {
    return bad('生效日（' + from + '）比生效至（' + to + '）遲。',
      ['把兩個日期調轉', '如果他仍然在任，把「生效至」留空']);
  }

  return {
    ok: true,
    message: '',
    values: { personId: personId, roleCode: roleCode, effectiveFrom: from, effectiveTo: to }
  };
}

/** `RoleAssignmentID` 用 `ROLE-<時間戳>-<序號>`，同其他表嘅 ID 風格一致。 */
function allocateRoleAssignmentId_(existingIds) {
  const base = 'ROLE-' + compactTimestamp_();
  let n = 1;
  while (existingIds[base + '-' + n]) n++;
  return base + '-' + n;
}

/** 讀出全部已用嘅 `RoleAssignmentID`（用嚟避免撞號）。 */
function readExistingRoleIds_() {
  const R = COLUMNS.ROLES;
  const ids = {};
  try {
    readOptionalSheet_(SHEETS.ROLES).forEach(function (row) {
      const id = String(row[R.ROLE_ASSIGNMENT_ID] || '').trim();
      if (id) ids[id] = true;
    });
  } catch (err) {
    log_('INFO', 'Roles 工作表未建立，視為沒有任何 ID：' + err.message);
  }
  return ids;
}

/**
 * 新增一行身分。**會寫入。**
 * @param {Object} payload {personId, roleCode, effectiveFrom, effectiveTo, notes}
 * @returns {Object}
 */
function apiAddRole(payload) {
  assertWebAppRequestAllowed_();
  const p = payload || {};
  const R = COLUMNS.ROLES;
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);

  const check = validateRoleInput_(p, timezone);
  if (!check.ok) return { ok: false, message: check.message };
  const v = check.values;

  const opened = openSheetForEdit_(SHEETS.ROLES);
  const roleId = allocateRoleAssignmentId_(readExistingRoleIds_());

  const record = {};
  record[R.ROLE_ASSIGNMENT_ID] = roleId;
  record[R.PERSON_ID] = v.personId;
  record[R.ROLE_CODE] = v.roleCode;
  record[R.EFFECTIVE_FROM] = v.effectiveFrom;
  record[R.EFFECTIVE_TO] = v.effectiveTo;
  record[R.ACTIVE] = true;
  record[R.NOTES] = String(p.notes || '').trim();

  appendRowFields_(opened.sheet, opened.headers, record);
  const nameIndex = buildPersonNameIndex_();
  writeZone3Audit_({
    action: 'ROLE_ADD',
    targetSheet: SHEETS.ROLES,
    targetKey: roleId,
    oldValue: '（新增）',
    newValue: describeFields_(record,
      [R.PERSON_ID, R.ROLE_CODE, R.EFFECTIVE_FROM, R.EFFECTIVE_TO, R.ACTIVE]),
    notes: (nameIndex[v.personId] || v.personId) + '　' + (ROLE_LABELS_TC[v.roleCode] || v.roleCode)
  });

  return {
    ok: true,
    roleAssignmentId: roleId,
    nameTC: nameIndex[v.personId] || v.personId,
    roleLabel: ROLE_LABELS_TC[v.roleCode] || v.roleCode
  };
}

/**
 * 改一行身分。**會寫入。**
 *
 * ⚠️ 冇「刪除」。停用就係 `Active` 取消勾選，卸任就係填「生效至」。
 * @param {Object} payload {roleAssignmentId, personId, roleCode, effectiveFrom, effectiveTo, active, notes}
 * @returns {Object}
 */
function apiSaveRole(payload) {
  assertWebAppRequestAllowed_();
  const p = payload || {};
  const R = COLUMNS.ROLES;
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);

  const roleId = String(p.roleAssignmentId || '').trim();
  if (!roleId) {
    return {
      ok: false,
      message: buildThreePartMessage_('沒有指定要改哪一行。', '什麼都沒有改動。',
        ['重新整理這一頁再試一次'])
    };
  }

  const check = validateRoleInput_(p, timezone);
  if (!check.ok) return { ok: false, message: check.message };
  const v = check.values;

  // ⚠️ 用 ID 重新搵列號，**唔信前端傳嚟嗰個**（見 findRowById_ 嘅說明）。
  const found = findRowById_(SHEETS.ROLES, R.ROLE_ASSIGNMENT_ID, roleId);
  if (found.sheetRow === -1) {
    return {
      ok: false,
      message: buildThreePartMessage_(
        '找不到要改的那一行（' + roleId + '）。',
        '什麼都沒有改動。',
        ['重新整理這一頁再試一次', '可能有人剛剛在試算表改動過這張工作表'])
    };
  }

  const opened = openSheetForEdit_(SHEETS.ROLES);
  const FIELDS = [R.PERSON_ID, R.ROLE_CODE, R.EFFECTIVE_FROM, R.EFFECTIVE_TO, R.ACTIVE, R.NOTES];

  const newValues = {};
  newValues[R.PERSON_ID] = v.personId;
  newValues[R.ROLE_CODE] = v.roleCode;
  newValues[R.EFFECTIVE_FROM] = v.effectiveFrom;
  newValues[R.EFFECTIVE_TO] = v.effectiveTo;
  newValues[R.ACTIVE] = p.active !== false;
  newValues[R.NOTES] = String(p.notes || '').trim();

  writeRowFields_(opened.sheet, opened.headers, found.sheetRow, newValues);
  writeZone3Audit_({
    action: 'ROLE_UPDATE',
    targetSheet: SHEETS.ROLES,
    targetKey: roleId,
    oldValue: describeFields_(found.record, FIELDS),
    newValue: describeFields_(newValues, FIELDS)
  });

  return { ok: true, roleAssignmentId: roleId };
}

/* ============================================================
 * 換屆（批次動作）——本畫面最重要嘅功能
 * ============================================================ */

/**
 * 換屆嘅**預覽**。純讀取，一格都唔寫。
 *
 * ⚠️ 一定要列出**全部**會被改嘅行，唔可以只講數目。
 * 呢一步係幹事唯一一次可以用人眼確認「係咪真係想改咁多人」嘅關口。
 *
 * @param {string} endDateRaw 卸任日期
 * @returns {Object} {ok, endDate, rows:[…], message}
 */
function apiRolesTermChangePlan(endDateRaw) {
  assertWebAppRequestAllowed_();
  const R = COLUMNS.ROLES;
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);

  const parsed = parseOfficerDateInput_(endDateRaw, timezone);
  if (!parsed.ok) {
    return {
      ok: false,
      message: buildThreePartMessage_(
        '卸任日期「' + (parsed.rawText || String(endDateRaw || '（空白）')) + '」看不懂。',
        '什麼都沒有改動。',
        ['請用 2026-11-08 這種寫法（年-月-日）',
          '這一日之後，這一屆的人就不再算是堂委／執事'])
    };
  }
  const endDate = parsed.dateStr;

  let raw = [];
  try {
    raw = readOptionalSheet_(SHEETS.ROLES);
  } catch (err) {
    return {
      ok: false,
      message: buildThreePartMessage_(
        '找不到身分名單（' + SHEETS.ROLES + '）。', '什麼都沒有改動。',
        ['先執行選單的「維護 ▸ 補建身分名單工作表」'])
    };
  }

  const nameIndex = buildPersonNameIndex_();
  const today = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');
  const rows = [];

  raw.forEach(function (row) {
    const personId = String(row[R.PERSON_ID] || '').trim();
    if (!personId) return;
    if (!isTrueValue_(row[R.ACTIVE])) return;
    const from = toDateString(row[R.EFFECTIVE_FROM], timezone);
    const to = toDateString(row[R.EFFECTIVE_TO], timezone);
    // 已經有「生效至」嘅唔會再掂——佢哋已經卸任過，唔應該被改成另一個日期。
    if (to) return;
    // 生效日仲未到嘅都唔掂（例如已經預先加咗下一屆）。
    if (from && from > today) return;

    const roleCode = String(row[R.ROLE_CODE] || '').trim().toUpperCase();
    rows.push({
      roleAssignmentId: String(row[R.ROLE_ASSIGNMENT_ID] || '').trim(),
      personId: personId,
      nameTC: nameIndex[personId] || personId,
      roleCode: roleCode,
      roleLabel: ROLE_LABELS_TC[roleCode] || roleCode,
      effectiveFrom: from,
      // 卸任日比生效日早 ⇒ 一定係打錯日期。標出嚟，唔可以靜靜寫落去。
      startsAfterEnd: !!(from && from > endDate)
    });
  });

  rows.sort(function (a, b) { return a.nameTC < b.nameTC ? -1 : 1; });

  const invalid = rows.filter(function (r) { return r.startsAfterEnd; });
  return {
    ok: true,
    endDate: endDate,
    rows: rows,
    invalidCount: invalid.length,
    // 有問題就唔俾執行——寫落去就會出現「生效日比生效至遲」嘅行，
    // 而嗰種行喺日期判斷入面永遠唔成立，即係嗰個人靜靜咁冇咗身分。
    blocked: invalid.length > 0,
    message: invalid.length > 0
      ? buildThreePartMessage_(
        '有 ' + invalid.length + ' 行的生效日比你填的卸任日期還要遲。',
        '什麼都沒有改動。',
        ['檢查卸任日期有沒有打錯（是不是打了去年）',
          '或者先在下面把那幾行的生效日改正'])
      : ''
  };
}

/**
 * 換屆嘅**執行**。逐行填 `EffectiveTo`，逐行寫 `AuditLog`。
 *
 * ⚠️ **唔刪任何一行。** 見檔頭：刪咗舊行，舊季度嘅職事表就會被追溯
 * 判成違反「報告限堂委」，而嗰啲季度早就寄咗信、印咗 PDF。
 *
 * @param {string} endDateRaw 卸任日期
 * @param {string} confirmText 打字確認
 * @returns {Object}
 */
function apiRolesTermChangeExecute(endDateRaw, confirmText) {
  assertWebAppRequestAllowed_();

  if (String(confirmText || '').trim() !== ROLES_TERM_CHANGE_CONFIRM_TEXT) {
    return {
      ok: false,
      message: buildThreePartMessage_(
        '沒有輸入「' + ROLES_TERM_CHANGE_CONFIRM_TEXT + '」兩個字。',
        '什麼都沒有改動。',
        ['在確認格輸入「' + ROLES_TERM_CHANGE_CONFIRM_TEXT + '」再撳一次'])
    };
  }

  // ⚠️ **後端自己重新算一次計畫**，唔信前端傳返嚟嗰份。
  // 前端嗰份係幾秒前算嘅，期間可能有人喺試算表改過。
  const plan = apiRolesTermChangePlan(endDateRaw);
  if (!plan.ok) return { ok: false, message: plan.message };
  if (plan.blocked) return { ok: false, message: plan.message };
  if (plan.rows.length === 0) {
    return {
      ok: false,
      message: buildThreePartMessage_(
        '沒有任何現任的身分行需要處理。', '什麼都沒有改動。',
        ['可能已經換過屆了（每一行都已經有「生效至」）',
          '先看一次上面的清單再決定'])
    };
  }

  const R = COLUMNS.ROLES;
  const opened = openSheetForEdit_(SHEETS.ROLES);
  let written = 0;
  const failed = [];

  plan.rows.forEach(function (r) {
    // 逐行用 ID 重新搵列號——批次動作中途插行嘅風險同單行一樣。
    const found = findRowById_(SHEETS.ROLES, R.ROLE_ASSIGNMENT_ID, r.roleAssignmentId);
    if (found.sheetRow === -1) {
      failed.push(r.nameTC + '（' + r.roleAssignmentId + '）');
      return;
    }
    const updates = {};
    updates[R.EFFECTIVE_TO] = plan.endDate;
    writeRowFields_(opened.sheet, opened.headers, found.sheetRow, updates);
    written++;
    writeZone3Audit_({
      action: 'ROLE_TERM_CHANGE',
      targetSheet: SHEETS.ROLES,
      targetKey: r.roleAssignmentId,
      oldValue: R.EFFECTIVE_TO + '=（空白，仍然在任）',
      newValue: R.EFFECTIVE_TO + '=' + plan.endDate,
      notes: r.nameTC + '　' + r.roleLabel + '　換屆卸任'
    });
  });

  return {
    ok: true,
    endDate: plan.endDate,
    written: written,
    // 搵唔返嘅一定要報出嚟。靜靜略過就係「做咗一半但報告話全部成功」。
    failed: failed
  };
}

/**
 * 唯讀提示：接 `buildRoleOverviewRows_()`，顯示各身分人數、
 * 同埋 `Posts.RequiredRoles` 有冇引用到零人持有嘅身分代號。
 *
 * ⚠️ 「零人持有」係一個**靜靜失效**嘅情況：嗰個崗位會永遠排唔到人，
 * 而畫面上只會見到一格空白，唔會有任何錯誤。
 * @returns {Object} {ok, rows:[{section,item,value,note}]}
 */
function apiRoleOverview() {
  assertWebAppRequestAllowed_();
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const today = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');
  try {
    const overview = collectRoleOverview_(timezone, today);
    const rows = buildRoleOverviewRows_(overview).map(function (r) {
      // `diagRow_()` 出嚟嘅欄名係 Diagnostics 用嘅，前端唔應該識得
      // 嗰套欄名——喺呢度轉成畫面自己嘅名。
      return {
        section: r[COLUMNS.DIAGNOSTICS.SECTION],
        item: r[COLUMNS.DIAGNOSTICS.ITEM],
        value: displayCellValue_(r[COLUMNS.DIAGNOSTICS.VALUE], ''),
        note: displayCellValue_(r[COLUMNS.DIAGNOSTICS.NOTE], '')
      };
    });
    return { ok: true, rows: rows };
  } catch (err) {
    log_('WARN', '身分總覽讀不到：' + err.message);
    return {
      ok: false,
      message: buildThreePartMessage_(
        '讀不到身分總覽（' + err.message + '）。',
        '什麼都沒有改動。上面的名單仍然可以用。',
        ['重新整理這一頁再試一次',
          '如果一直失敗，用選單的「查看（唯讀，只寫 Diagnostics）▸ 身分名單概況（唯讀）」看同樣的內容'])
    };
  }
}

/**
 * 第二十五輪批次階段 E2：區三畫面二——人員與電郵（`NameMapping`）＋別名（`NameAlias`）。
 *
 * 對應 `docs/幹事介面規格.md` 第 4.2 節。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️⚠️ 呢張表最危險嗰件事：名字相似 ≠ 同一個人
 * ─────────────────────────────────────────────────────────────────────
 *
 * 名單入面**真係有**兩位姓名只差最尾一個字、而且嗰兩個字同音嘅弟兄姊妹。
 * 佢哋**係兩個唔同嘅人**。
 *
 * （呢度特登唔舉真實例子——本專案嘅敏感資料掃描會捉到，而且呢個 repo
 * 係公開嘅。要睇實際係邊兩位，去試算表 `NameMapping` 自己搵。）
 *
 * 呢個系統**永遠唔會**自動合併相似嘅名——合併錯咗就會寄錯人：
 * 甲收到乙嘅職事表，而乙永遠收唔到自己嗰份，兩邊都唔知發生咗咩事。
 * 重複名一律列出嚟**交幹事人手判斷**，程式唔會替佢決定。
 *
 * 同一個人因為異體字或者輸入法寫成兩個名（「恒／恆」、「珮／佩」呢類），
 * 係喺 `NameAlias` 處理——嗰個係**幹事明確講「呢兩個係同一個人」**，
 * 唔係程式估。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 其他容易做錯嘅位
 * ─────────────────────────────────────────────────────────────────────
 *
 * - **`MemberNo` 嘅前導零會被試算表食走。** `01234` 入到去會變 `1234`。
 *   所以一律當文字寫入（`setValue()` 之前加 `'`，或者確保個值本身係字串
 *   而格式係文字）——見 `normalizeMemberNo_()`。
 * - **`PersonID` 唔可以改。** 佢係全系統嘅外鍵（`Eligibility`、
 *   `Unavailable`、`RosterAssignments`、`SendLog` 全部靠佢）。改一個就會
 *   令嗰個人喺歷史紀錄入面「消失」。介面上顯示做灰字，唔係輸入格。
 * - **`Active=FALSE` 唔係刪除。** 已經排好嘅職事表唔受影響，
 *   只係之後唔會再被自動排入。呢一句要喺畫面上講。
 */

/**
 * 列出全部人。**純讀取。**
 * @param {string=} keyword 搜尋字（中文名／英文名／PersonID）
 * @returns {Object} 見規格 4.2
 */
function apiListPeople(keyword) {
  assertWebAppRequestAllowed_();

  beginSheetReadMemo_();
  try {
    const M = COLUMNS.NAME_MAPPING;
    const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);

    // 重複中文名——**只係提示，唔會自動處理任何嘢。**
    const nameCount = {};
    readSheet(SHEETS.NAME_MAPPING).forEach(function (row) {
      const n = String(row[M.NAME_TC] || '').trim();
      if (n) nameCount[n] = (nameCount[n] || 0) + 1;
    });

    const people = [];
    readSheet(SHEETS.NAME_MAPPING).forEach(function (row) {
      const personId = String(row[M.PERSON_ID] || '').trim();
      if (!personId) return;
      const nameTC = String(row[M.NAME_TC] || '').trim();
      const nameEN = String(row[M.NAME_EN] || '').trim();
      if (!matchesPeopleSearch_(keyword, [nameTC, nameEN, personId])) return;

      const email = String(row[M.EMAIL] || '').trim();
      people.push({
        personId: personId,
        nameTC: nameTC,
        nameEN: nameEN,
        // 前導零：讀出嚟一律當文字，唔可以 Number() 一次（會再食走一次）。
        memberNo: String(row[M.MEMBER_NO] === null || row[M.MEMBER_NO] === undefined
          ? '' : row[M.MEMBER_NO]).trim(),
        email: email,
        hasEmail: email !== '',
        emailSource: String(row[M.EMAIL_SOURCE] || '').trim(),
        emailVerifiedAt: toDateString(row[M.EMAIL_VERIFIED_AT], timezone),
        active: isTrueValue_(row[M.ACTIVE]),
        maxPerQuarter: String(row[M.MAX_PER_QUARTER] === null || row[M.MAX_PER_QUARTER] === undefined
          ? '' : row[M.MAX_PER_QUARTER]).trim(),
        hasToken: String(row[M.PERSONAL_LINK_TOKEN] || '').trim() !== '',
        // 重複名淨係標示出嚟。**唔會自動合併**——見檔頭。
        duplicateNameCount: nameTC ? (nameCount[nameTC] || 0) : 0
      });
    });

    people.sort(function (a, b) { return a.nameTC < b.nameTC ? -1 : 1; });
    return { people: people, total: people.length };
  } finally {
    endSheetReadMemo_();
  }
}

/**
 * 改一個人嘅資料。**會寫入。只改傳入嗰幾欄。**
 * @param {Object} payload {personId, nameTC, nameEN, memberNo, email, active, maxPerQuarter}
 * @returns {Object}
 */
function apiSavePerson(payload) {
  assertWebAppRequestAllowed_();
  const p = payload || {};
  const M = COLUMNS.NAME_MAPPING;

  const personId = String(p.personId || '').trim();
  if (!personId) {
    return { ok: false, message: buildThreePartMessage_(
      '沒有收到 PersonID。', '什麼都沒有改動。', ['重新整理這一頁再試一次']) };
  }

  const nameTC = String(p.nameTC || '').trim();
  if (!nameTC) {
    return { ok: false, message: buildThreePartMessage_(
      '中文名不可以留空。',
      '什麼都沒有改動。',
      ['填回中文名', '如果這個人已經不再服侍，請把「啟用」取消勾選，不要清空名字']) };
  }

  const emailRaw = String(p.email || '').trim();
  // ⚠️ 第二十六輪批次階段 D3：格式唔啱**唔阻擋儲存**，改為要幹事再確認一次。
  //
  // 點解唔阻擋：世上有奇怪但合法嘅地址，一條 regex 擋錯咗就會令幹事
  // 完全入唔到一個真實存在嘅電郵，而佢冇任何辦法繞過。
  // 點解要確認：實測撞到一個結尾多咗句號嘅電郵——嗰位弟兄姊妹
  // **永遠收唔到通知**，而畫面睇落完全正常。要有一個位攔一攔。
  if (emailRaw && !isPlausibleEmail_(emailRaw) && p.confirmedBadEmail !== true) {
    return {
      ok: false,
      needsEmailConfirm: true,
      email: emailRaw,
      message: '這個電郵格式看起來不對，寄出時可能會失敗。確定要儲存嗎？'
    };
  }

  const memberNo = normalizeMemberNo_(p.memberNo);
  if (memberNo.error) return { ok: false, message: memberNo.error };

  const found = findRowById_(SHEETS.NAME_MAPPING, M.PERSON_ID, personId);
  if (found.sheetRow === -1) {
    return { ok: false, message: buildThreePartMessage_(
      '名單上找不到 ' + personId + '。',
      '什麼都沒有改動。',
      ['重新整理這一頁再試一次', '可能有人剛剛在試算表改動過這張表']) };
  }

  const oldEmail = String(found.record[M.EMAIL] || '').trim();
  const updates = {};
  updates[M.NAME_TC] = nameTC;
  updates[M.NAME_EN] = String(p.nameEN || '').trim();
  updates[M.MEMBER_NO] = memberNo.value;
  updates[M.EMAIL] = emailRaw;
  updates[M.ACTIVE] = p.active === false ? BOOLEAN_TEXT.FALSE : BOOLEAN_TEXT.TRUE;
  updates[M.MAX_PER_QUARTER] = String(p.maxPerQuarter === null || p.maxPerQuarter === undefined
    ? '' : p.maxPerQuarter).trim();

  // 電郵真係改咗先動 EmailSource／EmailVerifiedAt——冇改就唔好把
  // 一個由出席系統同步返嚟嘅來源標記改成「手動」（會令下次同步邏輯判斷錯）。
  if (emailRaw !== oldEmail) {
    updates[M.EMAIL_SOURCE] = '手動';
    updates[M.EMAIL_VERIFIED_AT] = Utilities.formatDate(
      new Date(), getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE), 'yyyy-MM-dd');
  }

  const opened = openSheetForEdit_(SHEETS.NAME_MAPPING);
  const FIELDS = [M.NAME_TC, M.NAME_EN, M.MEMBER_NO, M.EMAIL, M.ACTIVE, M.MAX_PER_QUARTER];
  writeRowFields_(opened.sheet, opened.headers, found.sheetRow, updates);
  writeZone3Audit_({
    action: 'PERSON_UPDATE',
    targetSheet: SHEETS.NAME_MAPPING,
    targetKey: personId,
    oldValue: describeFields_(found.record, FIELDS),
    newValue: describeFields_(updates, FIELDS),
    notes: emailRaw !== oldEmail ? '電郵有改動，EmailSource 設為「手動」' : ''
  });

  return {
    ok: true,
    personId: personId,
    emailChanged: emailRaw !== oldEmail,
    deactivated: p.active === false && isTrueValue_(found.record[M.ACTIVE])
  };
}

/**
 * 新增一個人。`PersonID` 由系統編，**唔畀幹事自己打**。
 * @param {Object} payload {nameTC, nameEN, memberNo, email}
 * @returns {Object} `duplicateWarning` 有值時代表撞名——**唔阻擋**，只提示
 */
function apiAddPerson(payload) {
  assertWebAppRequestAllowed_();
  const p = payload || {};
  const M = COLUMNS.NAME_MAPPING;

  const nameTC = String(p.nameTC || '').trim();
  if (!nameTC) {
    return { ok: false, message: buildThreePartMessage_(
      '中文名不可以留空。', '什麼都沒有加入。', ['填寫中文名再試一次']) };
  }

  const emailRaw = String(p.email || '').trim();
  if (emailRaw && !isPlausibleEmail_(emailRaw)) {
    return { ok: false, message: buildThreePartMessage_(
      '電郵「' + emailRaw + '」看起來不像一個電郵地址。',
      '什麼都沒有加入。',
      ['檢查有沒有打漏 @ 或者網域', '如果暫時沒有電郵，把這一格留空就可以']) };
  }

  const memberNo = normalizeMemberNo_(p.memberNo);
  if (memberNo.error) return { ok: false, message: memberNo.error };

  // ⚠️ 撞名**只警告，唔阻擋**。真係有兩個同名嘅人（唔同人、同一個名）
  // 係完全正常嘅事，阻擋咗就會令幹事加唔到第二個人。
  const existingIds = {};
  let duplicateWarning = '';
  readSheet(SHEETS.NAME_MAPPING).forEach(function (row) {
    const id = String(row[M.PERSON_ID] || '').trim();
    if (id) existingIds[id] = true;
    if (String(row[M.NAME_TC] || '').trim() === nameTC) {
      duplicateWarning = '名單上已經有一個「' + nameTC + '」（' + id + '）。'
        + '如果是同一個人，請取消這次新增，改為修改原本那一行。'
        + '如果真的是兩個不同的人（同名同姓），繼續加入沒有問題——'
        + '系統不會把他們合併。';
    }
  });

  const personId = allocatePersonId_(existingIds);
  const record = {};
  record[M.PERSON_ID] = personId;
  record[M.NAME_TC] = nameTC;
  record[M.NAME_EN] = String(p.nameEN || '').trim();
  record[M.MEMBER_NO] = memberNo.value;
  record[M.EMAIL] = emailRaw;
  record[M.ACTIVE] = BOOLEAN_TEXT.TRUE;
  if (emailRaw) {
    record[M.EMAIL_SOURCE] = '手動';
    record[M.EMAIL_VERIFIED_AT] = Utilities.formatDate(
      new Date(), getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE), 'yyyy-MM-dd');
  }

  const opened = openSheetForEdit_(SHEETS.NAME_MAPPING);
  appendRowFields_(opened.sheet, opened.headers, record);
  writeZone3Audit_({
    action: 'PERSON_ADD',
    targetSheet: SHEETS.NAME_MAPPING,
    targetKey: personId,
    oldValue: '（新增）',
    newValue: describeFields_(record, [M.NAME_TC, M.NAME_EN, M.MEMBER_NO, M.EMAIL]),
    notes: duplicateWarning ? '注意：與現有行同名，幹事已確認是不同的人' : ''
  });

  return {
    ok: true, personId: personId, nameTC: nameTC, duplicateWarning: duplicateWarning
  };
}

/**
 * 重新產生一個人嘅個人專屬連結。**會寫入，而且舊連結即刻失效。**
 * @param {string} personId PersonID
 * @returns {Object}
 */
function apiReissueToken(personId) {
  assertWebAppRequestAllowed_();
  const id = normalizeIdInput_(personId);
  if (!id) {
    return { ok: false, message: buildThreePartMessage_(
      '沒有收到 PersonID。', '什麼都沒有改動。', ['重新整理這一頁再試一次']) };
  }
  try {
    // 重用選單版嗰個實作，唔喺呢度另寫一次 token 產生邏輯——
    // 兩套 token 邏輯就一定有一日產生格式唔同嘅 token。
    const result = reissuePersonalLinkToken_(id);
    writeZone3Audit_({
      action: 'PERSONAL_TOKEN_REISSUE',
      targetSheet: SHEETS.NAME_MAPPING,
      targetKey: id,
      oldValue: '（舊連結已失效）',
      newValue: '（已產生新連結）',
      notes: '幹事介面重新產生個人專屬連結：' + (result.nameTC || id)
    });
    return { ok: true, personId: id, nameTC: result.nameTC || '' };
  } catch (err) {
    return { ok: false, message: buildThreePartMessage_(
      '重新產生連結失敗（' + err.message + '）。',
      // 唔可以喺輸出字串寫 markdown 粗體——畫面上只會顯示成一堆星號
      // （第二十一輪已經清過一次同類問題）。
      '舊連結可能仍然有效，也可能已經失效——請自己核對一次。',
      ['重新整理這一頁，看看那一行是不是已經有新連結',
        '如果一直失敗，把這句錯誤訊息交給開發者']) };
  }
}

/* ============================================================
 * 別名（NameAlias）
 * ============================================================ */

/**
 * 列出全部別名。**純讀取。**
 * @returns {Object}
 */
function apiListAliases() {
  assertWebAppRequestAllowed_();
  const A = COLUMNS.NAME_ALIAS;
  const nameIndex = buildPersonNameIndex_();
  const aliases = readSheet(SHEETS.NAME_ALIAS)
    .filter(function (row) { return String(row[A.ALIAS] || '').trim() !== ''; })
    .map(function (row) {
      const personId = String(row[A.PERSON_ID] || '').trim();
      return {
        aliasId: String(row[A.ALIAS_ID] || '').trim(),
        alias: String(row[A.ALIAS] || '').trim(),
        personId: personId,
        personName: nameIndex[personId] || '（名單上找不到 ' + personId + '）',
        active: isTrueValue_(row[A.ACTIVE])
      };
    });
  aliases.sort(function (a, b) { return a.alias < b.alias ? -1 : 1; });
  return { aliases: aliases };
}

/**
 * 新增或者更新一個別名。**會寫入。**
 * @param {Object} payload {aliasId, alias, personId, active}
 * @returns {Object}
 */
function apiSaveAlias(payload) {
  assertWebAppRequestAllowed_();
  const p = payload || {};
  const A = COLUMNS.NAME_ALIAS;

  const alias = String(p.alias || '').trim();
  const personId = String(p.personId || '').trim();
  if (!alias || !personId) {
    return { ok: false, message: buildThreePartMessage_(
      '別名同對應的人兩樣都要填。',
      '什麼都沒有改動。',
      ['填寫別名（例如異體字的另一種寫法）', '在下拉選這個別名對應哪一位']) };
  }

  const nameIndex = buildPersonNameIndex_();
  if (!nameIndex[personId]) {
    return { ok: false, message: buildThreePartMessage_(
      '名單上找不到 ' + personId + '。',
      '什麼都沒有改動。',
      ['重新整理這一頁再試一次']) };
  }

  const opened = openSheetForEdit_(SHEETS.NAME_ALIAS);
  const updates = {};
  updates[A.ALIAS] = alias;
  updates[A.PERSON_ID] = personId;
  updates[A.ACTIVE] = p.active === false ? BOOLEAN_TEXT.FALSE : BOOLEAN_TEXT.TRUE;
  const FIELDS = [A.ALIAS, A.PERSON_ID, A.ACTIVE];

  const existingId = String(p.aliasId || '').trim();
  if (existingId) {
    const found = findRowById_(SHEETS.NAME_ALIAS, A.ALIAS_ID, existingId);
    if (found.sheetRow === -1) {
      return { ok: false, message: buildThreePartMessage_(
        '找不到要改的那一個別名。', '什麼都沒有改動。', ['重新整理這一頁再試一次']) };
    }
    writeRowFields_(opened.sheet, opened.headers, found.sheetRow, updates);
    writeZone3Audit_({
      action: 'ALIAS_UPDATE',
      targetSheet: SHEETS.NAME_ALIAS,
      targetKey: existingId,
      oldValue: describeFields_(found.record, FIELDS),
      newValue: describeFields_(updates, FIELDS),
      notes: '幹事介面改動別名：' + alias + ' → ' + nameIndex[personId]
    });
    return { ok: true, aliasId: existingId, created: false };
  }

  const newId = 'ALIAS-' + compactTimestamp_();
  updates[A.ALIAS_ID] = newId;
  updates[A.SOURCE] = WEBUI_AUDIT_SOURCE;
  appendRowFields_(opened.sheet, opened.headers, updates);
  writeZone3Audit_({
    action: 'ALIAS_ADD',
    targetSheet: SHEETS.NAME_ALIAS,
    targetKey: newId,
    oldValue: '（新增）',
    newValue: describeFields_(updates, FIELDS),
    notes: '幹事介面新增別名：' + alias + ' → ' + nameIndex[personId]
  });
  return { ok: true, aliasId: newId, created: true };
}

/* ============================================================
 * 小工具
 * ============================================================ */

/**
 * `MemberNo` 正規化。
 *
 * ⚠️ **前導零會被試算表食走。** `01234` 直接 `setValue()` 入去，
 * 試算表會當成數字，變成 `1234`——而會友編號嘅前導零係有意義嘅。
 * 所以一律回**字串**，而且喺前面加一個單引號強制試算表當文字。
 *
 * （單引號係試算表嘅「當文字」前綴，唔會顯示喺格入面，
 * 亦唔會出現喺 `getValue()` 讀返出嚟嘅值。）
 * @param {*} raw 使用者輸入
 * @returns {{value: string, error: string}}
 */
function normalizeMemberNo_(raw) {
  const text = String(raw === null || raw === undefined ? '' : raw).trim();
  if (text === '') return { value: '', error: '' };
  if (!/^\d{5}$/.test(text)) {
    return {
      value: '',
      error: buildThreePartMessage_(
        '會友編號「' + text + '」不是 5 位數字。',
        '什麼都沒有改動。',
        ['會友編號一定是 5 位數字（例如 01234）', '如果暫時沒有編號，把這一格留空就可以'])
    };
  }
  // 前導零：加單引號前綴，令試算表當文字存。
  return { value: "'" + text, error: '' };
}

/**
 * 電郵格式檢查。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ 第二十六輪批次階段 D3：收緊咗
 * ─────────────────────────────────────────────────────────────────────
 *
 * Ivan 實測撞到：名單上有一位嘅電郵**結尾多咗一個句號**，
 * 舊嗰條 regex（`[^\s@]+@[^\s@]+\.[^\s@]+`）放行咗——因為
 * `example.com.` 入面「`.` 之後仲有 `com.`」呢個條件係成立嘅。
 *
 * 呢種錯會令嗰位弟兄姊妹**永遠收唔到通知**，而畫面睇落完全正常。
 *
 * 收緊咗五樣（每一樣都對應一種真實會打錯嘅方式）：
 *   `@` 前後都要有嘢
 *   `@` 之後要有至少一個 `.`
 *   **結尾唔可以係 `.`**（實測撞到嗰種）
 *   唔可以有連續兩個 `.`（打字手快撳兩次）
 *   唔可以有空白（複製貼上帶咗尾隨空格）
 *
 * ⚠️ 仍然**唔會阻擋儲存**——世上有奇怪但合法嘅地址，而我哋唔想因為
 * 一條 regex 而令幹事完全入唔到一個真實存在嘅電郵。改為黃色警告 ＋
 * 要幹事再撳一次確認（見前端 `confirmEmailFormat()`）。
 *
 * @param {string} email 電郵
 * @returns {boolean} 格式睇落啱唔啱
 */
function isPlausibleEmail_(email) {
  const value = String(email || '').trim();
  if (value === '') return false;
  if (/\s/.test(value)) return false;            // 任何空白
  if (value.indexOf('..') !== -1) return false;  // 連續兩個點
  if (value.charAt(value.length - 1) === '.') return false;   // 結尾句號（實測撞到）

  const at = value.split('@');
  if (at.length !== 2) return false;             // 冇 @ 或者多過一個
  if (at[0].length === 0 || at[1].length === 0) return false;
  if (at[1].indexOf('.') === -1) return false;   // 網域冇點
  if (at[1].charAt(0) === '.' || at[1].charAt(0) === '-') return false;
  return true;
}

/**
 * 編一個未用過嘅 `PersonID`。
 *
 * ⚠️ 用 `P` ＋ 遞增數字，而唔係時間戳——`PersonID` 會出現喺
 * `Eligibility`／`Unavailable`／`RosterAssignments` 好多張表，
 * 短同可讀好緊要（幹事有時要喺試算表用肉眼對）。
 * @param {Object.<string, boolean>} existingIds 已經用咗嘅 ID
 * @returns {string}
 */
function allocatePersonId_(existingIds) {
  let maxNo = 0;
  Object.keys(existingIds).forEach(function (id) {
    const m = /^P(\d+)$/.exec(id);
    if (m) maxNo = Math.max(maxNo, Number(m[1]));
  });
  let candidate = maxNo + 1;
  // 防守：萬一有人手加咗一個唔跟格式但撞號嘅 ID。
  while (existingIds['P' + candidate]) candidate++;
  return 'P' + candidate;
}

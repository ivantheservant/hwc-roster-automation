/**
 * 第二十七輪批次階段 E：從出席系統（HWCAS）補電郵——Web 版。
 *
 * 對應 `docs/幹事介面規格.md` 第 4.2 節。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 同選單版嘅分別
 * ─────────────────────────────────────────────────────────────────────
 *
 * 選單版係兩步：`syncHwcasEmails()` 產生 `NameMapping_Draft` 工作表，
 * 之後 `applyHwcasDraft()` 把「可套用」嗰批**整批**寫入。
 *
 * Web 版合併成三步：**預覽差異 → 逐行勾選 → 套用**。
 *
 * ⚠️⚠️ **絕對不可以整批自動套用。**
 * HWCAS 係一個唯讀外部來源，配對靠姓名。配對錯咗嘅後果係
 * **把甲嘅電郵寫入乙嘅資料**——之後乙收到甲嘅職事表，甲永遠收唔到。
 * 而畫面上完全睇唔出：兩個人都有電郵，職事表照樣印住兩個名。
 *
 * 所以：**預設全部唔勾。** 幹事要逐個睇過先勾。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ 對 HWCAS 一律唯讀
 * ─────────────────────────────────────────────────────────────────────
 * 呢個檔案完全冇任何對 HWCAS 試算表嘅寫入呼叫。讀取行為完全重用
 * `HwcasSync.gs` 嘅 `readHwcasMembers_()`（佢只讀 Config 列明嘅欄）。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 預覽唔會寫 `NameMapping_Draft`
 * ─────────────────────────────────────────────────────────────────────
 * 選單版會把初稿寫落一張工作表。Web 版**唔寫**——預覽就應該係唯讀。
 * 寫咗嘅話，「我只係想睇下」就會靜靜咁改咗試算表，
 * 而且會同選單版嗰張表互相覆蓋。
 */

/**
 * 預覽 HWCAS 同名單嘅差異。**純讀取，一格都唔寫。**
 *
 * @returns {Object} {ok, rows:[…], counts, message}
 */
function apiHwcasPreview() {
  assertWebAppRequestAllowed_();

  const config = readConfig();
  const spreadsheetId = String(config[CONFIG_KEYS.HWCAS_SPREADSHEET_ID] || '').trim();
  if (!spreadsheetId) {
    // 規格 4.2：呢句要講人話，唔可以拋一個 `Config 的 X 未設定`。
    return {
      ok: false,
      notConfigured: true,
      message: '還沒有設定出席系統的試算表位置。請先在 Config 填 HWCAS_SPREADSHEET_ID。'
    };
  }

  let source;
  try {
    source = readHwcasMembers_(config);
  } catch (err) {
    return {
      ok: false,
      message: buildThreePartMessage_(
        '讀不到出席系統的資料（' + err.message + '）。',
        '什麼都沒有改動，名單完全沒有動過。',
        ['檢查 Config 的 HWCAS_SPREADSHEET_ID 是不是正確',
          '檢查這個帳號有沒有那個試算表的閱讀權限',
          '如果一直失敗，先用試算表選單的「從 HWCAS 取電郵（產生初稿）」看看同樣的錯誤'])
    };
  }

  const fieldColumns = readHwcasFieldColumns_(config);
  // ⚠️ 重用選單版嗰個 `buildHwcasDraft_()`，**唔另寫一份配對邏輯**。
  // 兩份配對邏輯就會有一日一邊認得、一邊認唔得，
  // 而「兩邊講唔同嘅嘢」係本專案撞過最多次嗰類問題。
  const draft = buildHwcasDraft_(source.records, fieldColumns, source.headers);
  const nameIndex = buildPersonNameIndex_();

  const rows = draft
    // `MISSING_IN_HWCAS` ＝ 名單有、HWCAS 冇。呢類冇嘢可以補，唔應該
    // 佔住畫面——幹事要逐行睇，每多一行冇用嘅行就多一分睇漏嘅機會。
    .filter(function (d) { return d.matchType !== HWCAS_MATCH.MISSING_IN_HWCAS; })
    .map(function (d) { return buildHwcasPreviewRow_(d, nameIndex); });

  const counts = {
    total: rows.length,
    canApply: rows.filter(function (r) { return r.canApply; }).length,
    needsCare: rows.filter(function (r) { return r.riskLevel === 'HIGH'; }).length,
    noChange: rows.filter(function (r) { return r.noChange; }).length
  };

  return { ok: true, rows: rows, counts: counts, message: '' };
}

/**
 * 把一行初稿轉成畫面要嘅樣。
 *
 * ⚠️ **風險分級喺後端做**，唔係前端。前端只負責畫紅色。
 * 判斷邏輯留喺一處，將來加多一種風險唔使兩邊改。
 *
 * @param {Object} d `buildHwcasDraft_()` 出嚟嘅一行
 * @param {Object.<string, string>} nameIndex PersonID → 中文名
 * @returns {Object}
 */
function buildHwcasPreviewRow_(d, nameIndex) {
  const hwcasEmail = String(d.hwcasEmail || '').trim();
  const existingEmail = String(d.existingEmail || '').trim();
  const rosterName = String(d.nameTC || '').trim()
    || (d.personId ? (nameIndex[d.personId] || d.personId) : '');

  const sameEmail = hwcasEmail !== '' && existingEmail !== ''
    && hwcasEmail.toLowerCase() === existingEmail.toLowerCase();

  const warnings = [];
  let riskLevel = 'LOW';

  if (d.matchType === HWCAS_MATCH.AMBIGUOUS) {
    // ⚠️ 名單入面真係有幾位姓名只差最尾一個同音字嘅弟兄姊妹。
    //（呢度特登唔舉真實例子——名單係真人資料，而呢個 repo 係公開嘅。）
    // 佢哋係**唔同嘅人**，絕對唔可以自動合併。
    riskLevel = 'HIGH';
    warnings.push('名單上有多於一位同名的人，系統分不出是哪一位。'
      + '名字相似不代表是同一個人——不要靠猜。');
  }
  if (d.matchType === HWCAS_MATCH.NONE) {
    riskLevel = 'HIGH';
    warnings.push('名單上找不到這個名字。可能是新來的，也可能是寫法不同。');
  }
  if (d.matchType === HWCAS_MATCH.ALIAS) {
    // 靠別名對上嘅，係人手登記過嘅，但仍然值得指出「唔係逐字一樣」。
    warnings.push('是靠「別名」對上的（兩邊寫法不同）。請確認真的是同一位。');
  }
  if (existingEmail && hwcasEmail && !sameEmail) {
    riskLevel = 'HIGH';
    warnings.push('這個人現在已經有一個不同的電郵。勾了就會蓋掉現在那個。');
  }

  const matchedOk = d.matchType === HWCAS_MATCH.EXACT || d.matchType === HWCAS_MATCH.ALIAS;
  const noChange = matchedOk && (hwcasEmail === '' || sameEmail);

  return {
    // ⚠️ 用 PersonID 做 key，**唔用列號**。前端傳返嚟嗰陣，
    // 試算表可能已經有人插咗行——列號就會指去第二個人。
    personId: d.personId || '',
    rosterName: rosterName,
    hwcasName: String(d.hwcasName || ''),
    memberNo: displayCellValue_(d.memberNo, ''),
    hwcasEmail: hwcasEmail,
    existingEmail: existingEmail,
    matchType: d.matchType,
    riskLevel: riskLevel,
    warnings: warnings,
    noChange: noChange,
    // 可以套用 ＝ 對得上人、HWCAS 有電郵、而且真係有改動。
    // 認唔出人／同名多人一律唔可以套用（連勾都唔畀勾）。
    canApply: matchedOk && !!d.personId && hwcasEmail !== '' && !sameEmail,
    note: String(d.note || '')
  };
}

/**
 * 套用幹事勾咗嘅行。**會寫入 NameMapping。**
 *
 * ⚠️ **後端唔信前端傳嚟嘅任何值。** 前端只傳 `personId` 清單，
 * 電郵、會眾編號等一律由後端自己重新讀一次 HWCAS。
 * 信前端傳嘅電郵，就等於畫面上顯示一個、寫入另一個都冇人發現。
 *
 * @param {string[]} personIds 幹事勾咗嗰批
 * @returns {Object} {ok, written, skipped:[…], message}
 */
function apiHwcasApplySelected(personIds) {
  assertWebAppRequestAllowed_();

  const wanted = {};
  (personIds || []).forEach(function (id) {
    const clean = String(id || '').trim();
    if (clean) wanted[clean] = true;
  });
  if (Object.keys(wanted).length === 0) {
    return {
      ok: false,
      message: buildThreePartMessage_('一行都沒有勾。', '什麼都沒有改動。',
        ['勾選你確認過的行再撳一次', '這裡刻意預設全部不勾——每一行都要你親眼看過'])
    };
  }

  const preview = apiHwcasPreview();
  if (!preview.ok) return { ok: false, message: preview.message };

  const targets = [];
  const skipped = [];
  preview.rows.forEach(function (r) {
    if (!wanted[r.personId]) return;
    // 再驗一次。前端嗰份預覽可能係幾分鐘前攞嘅，期間 HWCAS 或者名單
    // 都可能改過。唔可以因為「幹事勾咗」就當佢仍然安全。
    if (!r.canApply) {
      skipped.push({ personId: r.personId, nameTC: r.rosterName, reason: describeHwcasSkip_(r) });
      return;
    }
    targets.push(r);
  });

  if (targets.length === 0) {
    return {
      ok: false,
      skipped: skipped,
      message: buildThreePartMessage_(
        '你勾的 ' + Object.keys(wanted).length + ' 行，現在一行都不能套用。',
        '什麼都沒有改動。',
        ['重新整理再看一次預覽——出席系統或者名單可能剛剛改過',
          '下面列出了每一行的原因'])
    };
  }

  const opened = openSheetForEdit_(SHEETS.NAME_MAPPING);
  const C = COLUMNS.NAME_MAPPING;
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const today = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');

  let written = 0;
  targets.forEach(function (t) {
    // 用 PersonID 重新搵列號（同區三其他畫面一致）。
    const found = findRowById_(SHEETS.NAME_MAPPING, C.PERSON_ID, t.personId);
    if (found.sheetRow === -1) {
      skipped.push({ personId: t.personId, nameTC: t.rosterName, reason: '名單上找不到這個編號' });
      return;
    }

    const updates = {};
    updates[C.EMAIL] = t.hwcasEmail;
    updates[C.EMAIL_SOURCE] = EMAIL_SOURCE_HWCAS;
    updates[C.EMAIL_VERIFIED_AT] = today;
    // 會眾編號只喺 HWCAS 真係有值嗰陣先寫——空白覆蓋落去就係
    // 用一個「冇資料」洗走一個真實資料。
    if (t.memberNo) updates[C.MEMBER_NO] = normalizeMemberNo_(t.memberNo);

    writeRowFields_(opened.sheet, opened.headers, found.sheetRow, updates);
    written++;
    writeZone3Audit_({
      action: 'HWCAS_EMAIL_APPLY',
      targetSheet: SHEETS.NAME_MAPPING,
      targetKey: t.personId,
      oldValue: C.EMAIL + '=' + (t.existingEmail || '（空白）'),
      newValue: C.EMAIL + '=' + t.hwcasEmail + '　' + C.EMAIL_SOURCE + '=' + EMAIL_SOURCE_HWCAS,
      notes: t.rosterName + '　由出席系統「' + t.hwcasName + '」對上（'
        + t.matchType + '），幹事逐行勾選'
    });
  });

  return {
    ok: true,
    written: written,
    // 略過嘅一定要報返出嚟——靜靜略過就係「勾咗 10 個，寫咗 7 個，冇人知」。
    skipped: skipped
  };
}

/**
 * 一行點解唔可以套用。
 * @param {Object} r `buildHwcasPreviewRow_()` 出嚟嘅一行
 * @returns {string}
 */
function describeHwcasSkip_(r) {
  if (r.matchType === HWCAS_MATCH.AMBIGUOUS) return '名單上有多於一位同名的人，系統分不出是哪一位';
  if (r.matchType === HWCAS_MATCH.NONE) return '名單上找不到這個名字';
  if (!r.personId) return '沒有對應的名單編號';
  if (!r.hwcasEmail) return '出席系統那邊沒有電郵';
  if (r.noChange) return '電郵跟現在的一樣，不用改';
  return '現在的狀態跟你看到的預覽不同了，請重新整理';
}

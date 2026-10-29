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
        '甚麼都沒有改動，名單完全沒有動過。',
        ['檢查 Config 的 HWCAS_SPREADSHEET_ID 是不是正確',
          '檢查這個帳戶有沒有那個試算表的閱讀權限',
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
    // ⚠️ 但數目要出返（見下面 `notInHwcas`），唔可以靜靜掉咗。
    .filter(function (d) { return d.matchType !== HWCAS_MATCH.MISSING_IN_HWCAS; })
    .map(function (d) { return buildHwcasPreviewRow_(d, nameIndex); });

  const counts = {
    total: rows.length,
    canApply: rows.filter(function (r) { return r.bucket === HWCAS_BUCKET.APPLY; }).length,
    needsAction: rows.filter(function (r) { return r.bucket === HWCAS_BUCKET.NEEDS_ACTION; }).length,
    notRelevant: rows.filter(function (r) { return r.bucket === HWCAS_BUCKET.NOT_RELEVANT; }).length,
    noChange: rows.filter(function (r) { return r.bucket === HWCAS_BUCKET.NO_CHANGE; }).length,
    // 名單有、HWCAS 冇——冇列出嚟，但要出個數，否則「513 行入面只見到
    // 89 行」會令幹事以為漏咗嘢。
    notInHwcas: draft.filter(function (d) {
      return d.matchType === HWCAS_MATCH.MISSING_IN_HWCAS;
    }).length
  };

  return { ok: true, rows: rows, counts: counts, message: '' };
}

/**
 * 第二十八輪批次階段 D：差異畫面三分類。
 *
 * ─────────────────────────────────────────────────────────────────────
 * Ivan 實測
 * ─────────────────────────────────────────────────────────────────────
 *
 *   共 513 行　可以套用 2 行　需要特別小心 434 行　沒有改動 79 行
 *
 * HWCAS 有 513 位會友，但職事表名單只有 89 位。
 * 「需要特別小心」嗰 434 行入面，真正有用嘅大概只有 8 行
 * （職事表有呢個名但系統分唔清係邊一位），
 * 其餘四百幾行係「HWCAS 有呢個人，但佢根本唔喺職事表」——**唔關事**。
 *
 * **幹事要碌 513 行先搵到嗰 2 行有用嘅。**
 *
 * ⚠️ 呢個唔係「顯示得靚啲」嘅問題：一個要逐行睇嘅畫面，
 * 每多一行唔關事嘅行，就多一分**睇漏真正要睇嗰行**嘅機會。
 * 而睇漏嘅後果係把甲嘅電郵寫入乙嘅資料。
 */
const HWCAS_BUCKET = {
  /** 名單有、電郵唔同 ⇒ 逐行列，可以勾（預設唔勾） */
  APPLY: 'APPLY',
  /** 名單有呢個人，但系統唔敢決定係邊一位 ⇒ 逐行列，唔能勾 */
  NEEDS_ACTION: 'NEEDS_ACTION',
  /** HWCAS 有、職事表名單完全冇 ⇒ 預設摺埋 */
  NOT_RELEVANT: 'NOT_RELEVANT',
  /** 對得上而且冇嘢要改 ⇒ 摺埋 */
  NO_CHANGE: 'NO_CHANGE'
};

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
  const canApply = matchedOk && !!d.personId && hwcasEmail !== '' && !sameEmail;

  // 第二十八輪批次階段 D：三分類。
  //
  // ⚠️ **`NONE` 同 `AMBIGUOUS` 唔可以歸埋一類。**
  //   `AMBIGUOUS` ＝ 名單上真係有呢個名（而且唔止一位）⇒ **要人手決定**
  //   `NONE`      ＝ 名單上根本冇呢個名 ⇒ HWCAS 有個唔喺職事表嘅會友，
  //                  **同排職事表完全無關**
  // 上一輪兩者都標成「需要特別小心」，所以四百幾行唔關事嘅行
  // 淹沒咗嗰八行真正要處理嘅。
  let bucket;
  if (canApply) bucket = HWCAS_BUCKET.APPLY;
  else if (d.matchType === HWCAS_MATCH.NONE) bucket = HWCAS_BUCKET.NOT_RELEVANT;
  else if (noChange) bucket = HWCAS_BUCKET.NO_CHANGE;
  else bucket = HWCAS_BUCKET.NEEDS_ACTION;

  return {
    bucket: bucket,
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
    canApply: canApply,
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
      message: buildThreePartMessage_('一行都沒有勾。', '甚麼都沒有改動。',
        ['勾選你確認過的行再按一次', '這裏刻意預設全部不勾——每一行都要你親眼看過'])
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
        '甚麼都沒有改動。',
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

/* ═════════════════════════════════════════════════════════════════════
 * 第七十七輪批次 EG 組：方法 A 嘅網頁入口
 * ═════════════════════════════════════════════════════════════════════ */

/**
 * 幹事介面載入時叫一次（前端畫好主畫面之後先叫，唔拖慢主畫面）。**會寫入 NameMapping。**
 * 拿唔到鎖（另一個動作在跑）⇒ 略過今次，唔等、唔報錯。讀唔到出席系統 ⇒ `ok=false`＋一句，唔拋。
 * @param {{force: boolean}=} options `force=true`＝唔理 10 分鐘限制（載入時用）
 * @returns {Object}
 */
function apiSyncPeopleFromHwcas(options) {
  assertWebAppRequestAllowed_();
  const o = options || {};
  let lock = null;
  try {
    lock = LockService.getDocumentLock();
    if (!lock.tryLock(0)) return { ok: true, skipped: 'locked', updated: 0, notice: '' };
  } catch (err) {
    return { ok: true, skipped: 'locked', updated: 0, notice: '' };
  }
  try {
    return runHwcasSyncSafely_({ force: o.force === true });
  } finally {
    try { lock.releaseLock(); } catch (err) { /* 放鎖失敗唔可以蓋過結果 */ }
  }
}

/** 出席系統未設定嗰陣畫面要講嘅一句（同 `apiHwcasPreview()` 同一句）。 */
function hwcasNotConfiguredResult_() {
  return {
    ok: false,
    notConfigured: true,
    message: '還沒有設定出席系統的試算表位置。請先在 Config 填 HWCAS_SPREADSHEET_ID。'
  };
}

function hwcasReadFailureResult_(err) {
  return {
    ok: false,
    message: buildThreePartMessage_(
      '讀不到出席系統的資料（' + err.message + '）。',
      '甚麼都沒有改動，名單完全沒有動過。',
      ['檢查 Config 的 HWCAS_SPREADSHEET_ID 是不是正確',
        '檢查這個帳戶有沒有那個試算表的閱讀權限'])
  };
}

/**
 * 進階與診斷 ▸〔出席系統連結〕嘅四段。**純讀取。**
 *   一、沒有會眾編號嘅人（附出席系統嘅候選人——重用 `buildHwcasDraft_()` 嘅姓名配對，**預設不勾**）
 *   二、出席系統找不到編號嘅人　三、重複編號　四、出席系統沒有電郵嘅人
 * @returns {Object}
 */
function apiHwcasLinkPreview() {
  assertWebAppRequestAllowed_();
  const config = readConfig();
  if (!String(config[CONFIG_KEYS.HWCAS_SPREADSHEET_ID] || '').trim()) return hwcasNotConfiguredResult_();
  let hwcas;
  try {
    hwcas = readHwcasByMemberNo_(config);
  } catch (err) {
    return hwcasReadFailureResult_(err);
  }
  const analysis = analyseHwcasLinks_(hwcas);
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);

  // 候選人：按姓名（NameTC＋NameAlias）對——同舊「從出席系統補電郵」同一支配對，唔另寫
  const draft = buildHwcasDraft_(hwcas.records, hwcas.fieldColumns, hwcas.headers);
  const candidatesByPerson = {};
  draft.forEach(function (d) {
    if (!d.personId || d.matchType === HWCAS_MATCH.MISSING_IN_HWCAS) return;
    const no = memberNoKey_(d.memberNo);
    if (!no) return;
    if (!candidatesByPerson[d.personId]) candidatesByPerson[d.personId] = [];
    candidatesByPerson[d.personId].push({
      memberNo: no,
      hwcasName: String(d.hwcasName || ''),
      emailMasked: maskEmailForPreview_(d.hwcasEmail),
      hasEmail: !!String(d.hwcasEmail || '').trim(),
      lastAttendance: toDateString(d.lastAttendance, timezone),
      matchType: d.matchType,
      note: String(d.note || '')
    });
  });
  const usedNos = {};
  analysis.linked.concat(analysis.notFound).forEach(function (p) { usedNos[p.memberNo] = p.nameTC; });
  analysis.duplicates.forEach(function (d) { usedNos[d.memberNo] = d.people.map(function (p) { return p.nameTC; }).join('、'); });

  return {
    ok: true,
    unlinked: analysis.unlinked.map(function (p) {
      return {
        personId: p.personId, nameTC: p.nameTC, active: p.active,
        candidates: (candidatesByPerson[p.personId] || []).map(function (c) {
          return Object.assign({}, c, { usedBy: usedNos[c.memberNo] || '' });
        })
      };
    }),
    notFound: analysis.notFound.map(function (p) { return { personId: p.personId, nameTC: p.nameTC, memberNo: p.memberNo }; }),
    duplicates: analysis.duplicates,
    noEmailInHwcas: analysis.noEmailInHwcas.map(function (p) { return { personId: p.personId, nameTC: p.nameTC, memberNo: p.memberNo }; }),
    counts: {
      linked: analysis.linked.length,
      unlinked: analysis.unlinked.length,
      notFound: analysis.notFound.length,
      duplicates: analysis.duplicates.length,
      noEmailInHwcas: analysis.noEmailInHwcas.length
    },
    sync: describeHwcasSyncForDashboard_()
  };
}

/**
 * 〔連結勾了的人〕：只寫 `MemberNo`（同由編號推出嘅 `Congregation`／`MemberType`），之後即時同步一次電郵。
 * **會寫入 NameMapping。** 名字一律唔改（保留職事表寫法）。
 * @param {Object[]} links 每項 {personId, memberNo}
 * @returns {Object} {ok, linked, skipped, sync}
 */
function apiHwcasLinkSelected(links) {
  assertWebAppRequestAllowed_();
  return withMutationLock_('連結出席系統', function () {
    return hwcasLinkSelected_locked_(links);
  });
}

function hwcasLinkSelected_locked_(links) {
  const list = (links || []).filter(function (l) { return l && String(l.personId || '').trim(); });
  if (list.length === 0) {
    return { ok: false, message: buildThreePartMessage_('一位都沒有勾。', '甚麼都沒有改動。',
      ['勾選你確認過的人再按一次', '這裏刻意預設全部不勾——按姓名配對錯了就會寄錯人']) };
  }
  const config = readConfig();
  if (!String(config[CONFIG_KEYS.HWCAS_SPREADSHEET_ID] || '').trim()) return hwcasNotConfiguredResult_();
  let hwcas;
  try {
    hwcas = readHwcasByMemberNo_(config);
  } catch (err) {
    return hwcasReadFailureResult_(err);
  }
  const M = COLUMNS.NAME_MAPPING;
  const prefixMap = readCongregationPrefixMap_();
  const opened = openSheetForEdit_(SHEETS.NAME_MAPPING);
  const analysis = analyseHwcasLinks_(hwcas);
  const usedNos = {};
  analysis.linked.concat(analysis.notFound).forEach(function (p) { usedNos[p.memberNo] = p; });
  analysis.duplicates.forEach(function (d) { usedNos[d.memberNo] = d; });

  const linked = [];
  const skipped = [];
  list.forEach(function (l) {
    const personId = String(l.personId).trim();
    const memberNo = normalizeMemberNo_(l.memberNo);
    if (memberNo.error || !memberNo.value) {
      skipped.push({ personId: personId, reason: '會眾編號不是 5 位數字' });
      return;
    }
    const key = memberNoKey_(memberNo.value);
    if (!hwcas.byNo[key]) { skipped.push({ personId: personId, reason: '出席系統找不到編號 ' + key }); return; }
    if (usedNos[key]) { skipped.push({ personId: personId, reason: '編號 ' + key + ' 已經是名單上另一位的' }); return; }
    const found = findRowById_(SHEETS.NAME_MAPPING, M.PERSON_ID, personId);
    if (found.sheetRow === -1) { skipped.push({ personId: personId, reason: '名單上找不到這個編號' }); return; }
    if (memberNoKey_(found.record[M.MEMBER_NO])) { skipped.push({ personId: personId, reason: '這一位已經有會眾編號' }); return; }
    const updates = {};
    updates[M.MEMBER_NO] = memberNo.value;
    const derived = deriveCongregationAndType_(key, prefixMap);
    if (derived.congregation) updates[M.CONGREGATION] = derived.congregation;
    if (derived.memberType) updates[M.MEMBER_TYPE] = derived.memberType;
    writeRowFields_(opened.sheet, opened.headers, found.sheetRow, updates);
    usedNos[key] = true;
    writeZone3Audit_({
      action: 'HWCAS_LINK',
      targetSheet: SHEETS.NAME_MAPPING,
      targetKey: personId,
      oldValue: M.MEMBER_NO + '=（空白）',
      newValue: M.MEMBER_NO + '=' + key,
      notes: String(found.record[M.NAME_TC] || '') + '　幹事確認連結出席系統「' + hwcas.byNo[key].name + '」（名字保留職事表寫法）'
    });
    linked.push({ personId: personId, nameTC: String(found.record[M.NAME_TC] || ''), memberNo: key });
  });

  // 連結完即時按編號更新一次電郵（已經喺鎖入面）
  const sync = linked.length > 0 ? runHwcasSyncSafely_({ force: true }) : null;
  return { ok: true, linked: linked, skipped: skipped, sync: sync };
}

/**
 * 〔加入名單〕：喺出席系統搜尋（姓名欄 `HWCAS_COL_NAME`＋`NameAlias`，或者會眾編號）。**純讀取。**
 * @param {string} keyword 職事表上嗰個名（預設填入）或者會眾編號
 * @returns {Object} {ok, keyword, candidates:[{memberNo, hwcasName, congregation, memberType, emailMasked, hasEmail, lastAttendance, existingPersonId, existingNameTC}]}
 */
function apiHwcasSearchPeople(keyword) {
  assertWebAppRequestAllowed_();
  const kw = String(keyword || '').trim();
  const config = readConfig();
  if (!String(config[CONFIG_KEYS.HWCAS_SPREADSHEET_ID] || '').trim()) return hwcasNotConfiguredResult_();
  if (!kw) return { ok: true, keyword: '', candidates: [] };
  let hwcas;
  try {
    hwcas = readHwcasByMemberNo_(config);
  } catch (err) {
    return hwcasReadFailureResult_(err);
  }
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const prefixMap = readCongregationPrefixMap_();

  // 名單上已經有呢個編號嘅人
  const M = COLUMNS.NAME_MAPPING;
  const existingByNo = {};
  readSheet(SHEETS.NAME_MAPPING).forEach(function (row) {
    const no = memberNoKey_(row[M.MEMBER_NO]);
    if (no && !existingByNo[no]) existingByNo[no] = { personId: String(row[M.PERSON_ID] || '').trim(), nameTC: String(row[M.NAME_TC] || '').trim() };
  });

  // 搜尋字串：本身 ＋ 佢係別名嘅話，正名都一齊搵
  const terms = [kw];
  try {
    const aliasMap = readNameAlias();
    const nameIndex = buildPersonNameIndex_();
    if (aliasMap[kw] && nameIndex[aliasMap[kw]] && terms.indexOf(nameIndex[aliasMap[kw]]) === -1) terms.push(nameIndex[aliasMap[kw]]);
  } catch (err) { /* 別名讀唔到就只用原字 */ }

  const isNo = /^\d+$/.test(kw.replace(/^'/, ''));
  const candidates = hwcas.all.filter(function (e) {
    if (isNo) return e.memberNo === memberNoKey_(kw);
    return e.names.some(function (n) { return terms.some(function (t) { return n.indexOf(t) !== -1; }); });
  }).slice(0, 20).map(function (e) {
    const derived = deriveCongregationAndType_(e.memberNo, prefixMap);
    const ex = existingByNo[e.memberNo] || null;
    return {
      memberNo: e.memberNo,
      hwcasName: e.name,
      congregation: derived.congregation,
      memberType: derived.memberType,
      emailMasked: maskEmailForPreview_(e.email),
      hasEmail: !!e.email,
      lastAttendance: toDateString(e.lastAttendance, timezone),
      existingPersonId: ex ? ex.personId : '',
      existingNameTC: ex ? ex.nameTC : ''
    };
  });
  return { ok: true, keyword: kw, candidates: candidates };
}

/**
 * 〔加入名單〕揀咗一位 ⇒ 新增 `NameMapping`：`NameTC`＝**職事表上嘅寫法**、`MemberNo`、堂會／身分由編號推、
 * 電郵由出席系統來（`EmailSource=HWCAS`）。**會寫入。** 唔可以人手打電郵。
 * 嗰個編號已經喺名單上 ⇒ 唔新增，回 `existing`（前端提供〔加一個別名〕）。
 * @param {Object} payload {nameTC, memberNo, postId, alsoEligible}
 * @returns {Object}
 */
function apiAddPersonFromHwcas(payload) {
  assertWebAppRequestAllowed_();
  return withMutationLock_('由出席系統加入名單', function () {
    return addPersonFromHwcas_locked_(payload);
  });
}

function addPersonFromHwcas_locked_(payload) {
  const p = payload || {};
  const M = COLUMNS.NAME_MAPPING;
  const nameTC = String(p.nameTC || '').trim();
  if (!nameTC) {
    return { ok: false, message: buildThreePartMessage_('中文名不可以留空。', '甚麼都沒有加入。', ['用職事表上的寫法填中文名']) };
  }
  const memberNo = normalizeMemberNo_(p.memberNo);
  if (memberNo.error || !memberNo.value) {
    return { ok: false, message: buildThreePartMessage_('沒有收到會眾編號。', '甚麼都沒有加入。', ['在出席系統的搜尋結果選一位再按']) };
  }
  const key = memberNoKey_(memberNo.value);
  const config = readConfig();
  if (!String(config[CONFIG_KEYS.HWCAS_SPREADSHEET_ID] || '').trim()) return hwcasNotConfiguredResult_();
  let hwcas;
  try {
    hwcas = readHwcasByMemberNo_(config);
  } catch (err) {
    return hwcasReadFailureResult_(err);
  }
  const entry = hwcas.byNo[key];
  if (!entry) {
    return { ok: false, notInHwcas: true, message: '出席系統找不到編號 ' + key + '。請辦公室先在出席系統加入他，之後再按〔加入名單〕。' };
  }

  // 編號已經喺名單上（另一個寫法）⇒ 唔新增人
  const existingIds = {};
  let existing = null;
  readSheet(SHEETS.NAME_MAPPING).forEach(function (row) {
    const id = String(row[M.PERSON_ID] || '').trim();
    if (id) existingIds[id] = true;
    if (!existing && memberNoKey_(row[M.MEMBER_NO]) === key) {
      existing = { personId: id, nameTC: String(row[M.NAME_TC] || '').trim() };
    }
  });
  if (existing) {
    return {
      ok: false, existing: existing, canAlias: existing.nameTC !== nameTC,
      message: '這是名單上的「' + existing.nameTC + '」（' + existing.personId + '）。'
        + (existing.nameTC !== nameTC ? '可以把「' + nameTC + '」記成他的別名，之後系統就認得。' : '')
    };
  }

  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const today = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');
  const derived = deriveCongregationAndType_(key, readCongregationPrefixMap_());
  const personId = allocatePersonId_(existingIds);
  const record = {};
  record[M.PERSON_ID] = personId;
  record[M.NAME_TC] = nameTC;                    // ⚠️ 職事表上嘅寫法，唔係出席系統嘅
  record[M.NAME_EN] = '';
  record[M.MEMBER_NO] = memberNo.value;
  if (derived.congregation) record[M.CONGREGATION] = derived.congregation;
  if (derived.memberType) record[M.MEMBER_TYPE] = derived.memberType;
  record[M.EMAIL] = entry.email;
  record[M.EMAIL_SOURCE] = EMAIL_SOURCE_HWCAS;
  if (entry.email) record[M.EMAIL_VERIFIED_AT] = today;
  const la = toDateString(entry.lastAttendance, timezone);
  if (la) record[M.LAST_ATTENDANCE] = la;
  const mp = String(entry.meetingPoint === null || entry.meetingPoint === undefined ? '' : entry.meetingPoint).trim();
  if (mp) record[M.MEETING_POINT] = mp;
  record[M.ACTIVE] = BOOLEAN_TEXT.TRUE;
  record[M.SYNCED_AT] = nowTimestamp_();

  const opened = openSheetForEdit_(SHEETS.NAME_MAPPING);
  appendRowFields_(opened.sheet, opened.headers, record);
  writeZone3Audit_({
    action: 'PERSON_ADD_FROM_HWCAS',
    targetSheet: SHEETS.NAME_MAPPING,
    targetKey: personId,
    oldValue: '（新增）',
    newValue: M.NAME_TC + '=' + nameTC + '　' + M.MEMBER_NO + '=' + key + '　' + M.EMAIL + '=' + (maskEmailForPreview_(entry.email) || '（空白）'),
    notes: '由出席系統「' + entry.name + '」加入；名字保留職事表寫法'
  });

  // （可選）讓他可以做那一個崗位——同以前〔加入名單〕一樣，用返同一條路
  const postId = String(p.postId || '').trim();
  let eligibilityAdded = 0;
  if (postId && p.alsoEligible !== false) {
    const r = apiSaveEligibilityBatch([{ personId: personId, postId: postId, eligible: true }]);
    eligibilityAdded = (r && r.added) || 0;
  }
  const noEmailNote = entry.email ? '' : '出席系統沒有這一位的電郵，所以他收不到信。記得在第 4 步印紙本給他。';
  return {
    ok: true,
    personId: personId,
    nameTC: nameTC,
    memberNo: key,
    hasEmail: !!entry.email,
    eligibilityAdded: eligibilityAdded,
    noEmailNote: noEmailNote,
    message: '已經加入「' + nameTC + '」（' + personId + '）' + (entry.email ? '，電郵已由出席系統讀取' : '') + '。'
      + (eligibilityAdded > 0 ? '而且他現在可以做那一個崗位。' : '')
  };
}

/**
 * 第六十七輪批次 AJ 組：**系統出問題時，喺 Drive 搵到最新版自己手動繼續。**
 *
 * ═════════════════════════════════════════════════════════════════════
 * 點解要有呢一支
 * ═════════════════════════════════════════════════════════════════════
 *
 * Ivan 嘅要求（功能 4）：「系統出問題時，可以在 Google Drive 找到最新版自己手動繼續。」
 * 之前有嘅：公開連結試算表（唯讀分享、每次儲存更新）、每版完整版 PDF。
 * **冇嘅**：一份可以直接打字改嘅試算表。幹事出事嗰刻要自己開一張新表逐格抄。
 *
 * 所以：把最新版本嘅 grid 工作表（連格式、圖例、本季服侍次數統計）`copyTo()` 入一個
 * **獨立**新試算表，放喺 PDF 根資料夾（`ROSTER_DRIVE_FOLDER_ID`，已驗係 Shared Drive）
 * 下面 `<季度>/可編輯副本/`。兩個入口：
 *
 *   1. 第 4 步「下載及匯出 ▸ 可編輯的試算表副本（最新版本）」——`apiCreateEditableRosterCopy()`
 *   2. 正式發出成功之後**自動**做一份（`executeStep4Send_()`）——**失敗唔影響寄出**
 *
 * ⚠️ 副本只係快照。之後系統再改動唔會更新佢；畫面一定要講明。
 * ⚠️ 原本嗰張 grid 工作表**一格都唔動**（`copyTo()` 係讀）。
 *
 * 手動改完之後點樣返返系統：見 `docs/系統出問題時手動繼續.md`（AF 組嘅匯入）。
 */

/**
 * 副本檔名：`<季度>_第<N>版_職事表_可編輯副本_<yyyyMMdd-HHmm>`。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {Date} now 建立時間
 * @param {string} timezone 時區
 * @returns {string}
 */
function buildEditableCopyFileName_(quarterId, versionNo, now, timezone) {
  return String(quarterId).trim() + '_第' + Number(versionNo) + '版_' + EDITABLE_COPY_FILE_LABEL
    + '_' + Utilities.formatDate(now, timezone, EDITABLE_COPY_TIMESTAMP_FORMAT);
}

/**
 * 攞（冇就建）`<季度>/可編輯副本/`。同 `getOrCreateRosterSubfolder_()` 一樣用 LockService
 * 包住「查有冇 → 冇就建」——Drive 容許同名資料夾，兩個人同時做會建出兩個。
 * @param {string} quarterId 季度 ID
 * @returns {Folder}
 */
function getOrCreateEditableCopyFolder_(quarterId) {
  const root = resolveMailAttachmentFolder_();   // 已經驗過係 Shared Drive
  const quarterName = String(quarterId || '').trim();
  if (!quarterName) throw new Error('getOrCreateEditableCopyFolder_ 需要 quarterId。');
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(PDF_FOLDER_LOCK_WAIT_MS);
  } catch (err) {
    throw new Error('現在有另一個動作正在建立資料夾，請等一分鐘再試一次。');
  }
  try {
    const quarterFolder = findOrCreateChildFolder_(root, quarterName);
    return findOrCreateChildFolder_(quarterFolder, EDITABLE_COPY_FOLDER_NAME);
  } finally {
    lock.releaseLock();
  }
}

/**
 * 把某一版 grid 工作表複製成一份獨立試算表，放入 `<季度>/可編輯副本/`。
 *
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {string} source 邊個叫（寫入 AuditLog）
 * @returns {{versionNo: number, sheetName: string, fileName: string, fileId: string,
 *   fileUrl: string, folderUrl: string}}
 */
function createEditableRosterCopy_(quarterId, versionNo, source) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = buildRosterSheetName_(quarterId, versionNo);
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('找不到工作表「' + sheetName + '」，做不到副本。');

  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const fileName = buildEditableCopyFileName_(quarterId, versionNo, new Date(), timezone);
  const folder = getOrCreateEditableCopyFolder_(quarterId);

  // 新檔先建喺 My Drive 根（`SpreadsheetApp.create()` 只可以噉做），再搬入 Shared Drive 資料夾。
  const copy = SpreadsheetApp.create(fileName);
  const copied = sheet.copyTo(copy);
  copied.setName(sheetName);
  // 新檔自帶嘅空白第一張要刪走——留住嘅話幹事開檔第一眼係一張空表
  copy.getSheets().forEach(function (s) {
    if (s.getSheetId() !== copied.getSheetId()) copy.deleteSheet(s);
  });
  // 第 2 行機器鍵喺原表係隱藏嘅；副本一樣隱藏（人手改嗰陣唔會誤改）
  try { copied.hideRows(2); } catch (err) { /* 冇第 2 行就算 */ }

  const file = DriveApp.getFileById(copy.getId());
  file.moveTo(folder);

  writeAuditLog_({
    action: 'EDITABLE_COPY_CREATED',
    targetSheet: sheetName,
    targetKey: quarterId,
    oldValue: '',
    newValue: fileName,
    source: source || '',
    notes: '可編輯副本（快照）已放入 ' + String(quarterId).trim() + '/' + EDITABLE_COPY_FOLDER_NAME + '/'
  });

  return {
    versionNo: Number(versionNo),
    sheetName: sheetName,
    fileName: fileName,
    fileId: copy.getId(),
    fileUrl: copy.getUrl(),
    folderUrl: folder.getUrl()
  };
}

/**
 * 供前端呼叫：第 4 步「下載及匯出 ▸ 可編輯的試算表副本（最新版本）」。**會寫入 Drive。**
 * @param {string} quarterId 季度 ID
 * @returns {Object} `createEditableRosterCopy_()` 嘅結果＋`message`
 */
function apiCreateEditableRosterCopy(quarterId) {
  assertWebAppRequestAllowed_();
  return withMutationLock_('建立可編輯副本', function () {
    const versionNo = findLatestVersionNo(quarterId);
    if (versionNo < 0) {
      throw new Error(buildThreePartMessage_(
        '這一季還沒有生成過任何版本。', '什麼都沒有產生。', ['先在第 1 步生成職事表']));
    }
    const out = createEditableRosterCopy_(quarterId, versionNo, 'apiCreateEditableRosterCopy');
    out.message = '這一份只是現時第 ' + versionNo + ' 版的快照。之後你在系統裡再改動，'
      + '這一份不會跟著變；要最新的就再做一份。';
    return out;
  });
}

/**
 * 正式發出成功之後自動做一份副本。**任何失敗都唔可以令寄出變成失敗**——
 * 信已經寄咗出去，呢度只係多一份保險。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @returns {{ok: boolean, fileName: string, fileUrl: string, message: string}}
 */
function tryCreateEditableCopyAfterSend_(quarterId, versionNo) {
  try {
    const out = createEditableRosterCopy_(quarterId, versionNo, '正式發出之後自動');
    return { ok: true, fileName: out.fileName, fileUrl: out.fileUrl, folderUrl: out.folderUrl, message: '' };
  } catch (err) {
    log_('WARN', '正式發出之後自動建立可編輯副本失敗（' + quarterId + ' v' + versionNo + '）：' + err.message);
    return { ok: false, fileName: '', fileUrl: '', folderUrl: '',
      message: '這一次做不到自動副本（' + err.message + '）。寄出不受影響；要的話去第 4 步「下載及匯出」自己做一份。' };
  }
}

/**
 * 第七十輪批次 AW 組：副本檔名入面嘅版本號（`<季度>_第<N>版_…`）；認唔出回 -1。
 * @param {string} name 檔名
 * @returns {number} 版本號
 */
function parseEditableCopyVersion_(name) {
  const m = /第(\d+)版/.exec(String(name || ''));
  return m ? Number(m[1]) : -1;
}

/**
 * 第七十輪批次 AW 組：揀「最新一份」可編輯副本。
 *
 * 現場：重設季度再重新走一季之後，彈窗寫「最新一份：2028T3_第4版_…_20261021-1608」——
 * 那是重設之前留下的舊副本；真正最新的是後來正式發出時自動建立的第 2 版副本。
 * 舊寫法按檔名（版本號）揀，版本號大不等於較新。
 *
 * 規矩：**按建立時間**；同一時間先比版本號，最後比檔名。純函式。
 *
 * @param {Array<{name: string, createdMs: number}>} entries 副本（可以帶任何其他欄位）
 * @returns {?Object} 最新嗰項；空陣列回 null
 */
function pickLatestEditableCopy_(entries) {
  let best = null;
  (entries || []).forEach(function (e) {
    if (!best) { best = e; return; }
    if (e.createdMs !== best.createdMs) {
      if (e.createdMs > best.createdMs) best = e;
      return;
    }
    const ev = parseEditableCopyVersion_(e.name);
    const bv = parseEditableCopyVersion_(best.name);
    if (ev !== bv) {
      if (ev > bv) best = e;
      return;
    }
    if (String(e.name) > String(best.name)) best = e;
  });
  return best;
}

/** 檔案建立時間（毫秒）；讀唔到當 0（唔會令整個彈窗冧）。 */
function readFileCreatedMs_(file) {
  try {
    const d = file.getDateCreated();
    const ms = (d && typeof d.getTime === 'function') ? d.getTime() : Number(d);
    return isNaN(ms) ? 0 : ms;
  } catch (err) {
    return 0;
  }
}

/**
 * 第七十輪批次 AW 組：一個季度「可編輯副本」資料夾入面嘅全部檔案（重設季度清理用）。
 * **只讀。** 資料夾唔存在就回空陣列，唔建任何嘢。
 *
 * @param {string} quarterId 季度 ID
 * @returns {Array<{id: string, name: string, sizeBytes: number, versionNo: number}>}
 */
function listEditableCopyFilesForQuarter_(quarterId) {
  const root = resolveMailAttachmentFolder_();
  const out = [];
  const quarterFolders = root.getFoldersByName(String(quarterId || '').trim());
  while (quarterFolders.hasNext()) {
    const qf = quarterFolders.next();
    const copyFolders = qf.getFoldersByName(EDITABLE_COPY_FOLDER_NAME);
    while (copyFolders.hasNext()) {
      const files = copyFolders.next().getFiles();
      while (files.hasNext()) {
        const f = files.next();
        out.push({ id: f.getId(), name: f.getName(), sizeBytes: f.getSize(),
          versionNo: parseEditableCopyVersion_(f.getName()) });
      }
    }
  }
  return out;
}

/**
 * 第七十輪批次 AW 組：重設季度清走 PDF 之後會變空嘅「版本 PDF 資料夾」（`v3` 之類）。
 *
 * 現場：版本 PDF 資料夾內嘅 PDF 移到垃圾桶之後，空資料夾仍然留住。
 * 只計**要清嘅版本**嘅資料夾；入面仲有任何唔喺清理計畫嘅檔案或子資料夾 ⇒ 唔計（唔係空）。
 * **只讀。**
 *
 * @param {string} quarterId 季度 ID
 * @param {Object.<number, boolean>} versionNosToClear 要清嘅版本號
 * @param {Object.<string, boolean>} plannedFileIds 已列入清理計畫嘅檔案 ID
 * @returns {Array<{id: string, name: string, versionNo: number}>}
 */
function listEmptyVersionFoldersForReset_(quarterId, versionNosToClear, plannedFileIds) {
  const root = resolveMailAttachmentFolder_();
  const out = [];
  const quarterFolders = root.getFoldersByName(String(quarterId || '').trim());
  const pattern = new RegExp('^' + escapeRegExp_(PDF_VERSION_FOLDER_PREFIX) + '(\\d+)$');
  while (quarterFolders.hasNext()) {
    const vfs = quarterFolders.next().getFolders();
    while (vfs.hasNext()) {
      const vf = vfs.next();
      const m = pattern.exec(vf.getName());
      if (!m || !versionNosToClear[Number(m[1])]) continue;
      if (vf.getFolders().hasNext()) continue;
      let willBeEmpty = true;
      const files = vf.getFiles();
      while (files.hasNext()) {
        if (!plannedFileIds[files.next().getId()]) { willBeEmpty = false; break; }
      }
      if (willBeEmpty) out.push({ id: vf.getId(), name: vf.getName(), versionNo: Number(m[1]) });
    }
  }
  return out;
}

/**
 * 供前端呼叫：「進階與診斷 ▸ 系統出問題時怎樣做」要顯示嘅三個位置。**唯讀**，
 * 冇就講冇，唔會建資料夾。連結一律由程式讀出，唔寫死。
 *
 * @param {string} quarterId 季度 ID
 * @returns {{quarterId: string, versionNo: number, guideDoc: string,
 *   publicLink: {url: string, note: string},
 *   fullPdf: {url: string, note: string},
 *   editableCopy: {url: string, folderUrl: string, note: string}}}
 */
function apiGetRecoveryLinks(quarterId) {
  assertWebAppRequestAllowed_();
  const q = String(quarterId || '').trim();
  const versionNo = findLatestVersionNo(q);
  const out = {
    quarterId: q,
    versionNo: versionNo,
    guideDoc: RECOVERY_GUIDE_DOC_NAME,
    // 第七十輪批次 AW 組：幹事打唔開 repo，所以唔再叫佢去睇 `docs/…`。
    // Config 有 USER_GUIDE_URL ⇒ 畫連結；冇 ⇒ 寫指南章名。
    guideUrl: '',
    guideSentence: '詳細步驟見《職事表系統使用指南》「系統出問題時」一章。',
    publicLink: { url: '', note: '' },
    fullPdf: { url: '', note: '' },
    editableCopy: { url: '', folderUrl: '', note: '' }
  };

  try {
    out.guideUrl = String(getConfig(CONFIG_KEYS.USER_GUIDE_URL, DEFAULTS.USER_GUIDE_URL) || '').trim();
    if (out.guideUrl) out.guideSentence = '詳細步驟見使用指南。';
  } catch (err) {
    // 讀唔到 Config 唔應該令整個彈窗冧：照寫章名
  }

  try {
    const row = findPublicLinkRow_(q);
    if (row && row.fileUrl) {
      out.publicLink.url = row.fileUrl;
      out.publicLink.note = '唯讀；每次儲存都會更新到最新內容。';
    } else {
      out.publicLink.note = '這一季還沒有發佈過公開連結。';
    }
  } catch (err) {
    out.publicLink.note = '現在查不到公開連結：' + err.message;
  }

  let root = null;
  try {
    root = resolveMailAttachmentFolder_();
  } catch (err) {
    out.fullPdf.note = '現在開不到 Drive 資料夾：' + err.message;
    out.editableCopy.note = out.fullPdf.note;
    return out;
  }

  const quarterFolders = root.getFoldersByName(q);
  const quarterFolder = quarterFolders.hasNext() ? quarterFolders.next() : null;

  // 完整版 PDF：最新一版嘅版本資料夾（有先講）
  try {
    if (quarterFolder && versionNo >= 0) {
      const vf = quarterFolder.getFoldersByName(PDF_VERSION_FOLDER_PREFIX + versionNo);
      if (vf.hasNext()) {
        const folder = vf.next();
        const files = folder.getFilesByName(buildAttachmentName_(q, versionNo, GRID_LABELS.FULL_VERSION));
        out.fullPdf.url = files.hasNext() ? files.next().getUrl() : folder.getUrl();
        out.fullPdf.note = files.hasNext() ? '第 ' + versionNo + ' 版的完整版 PDF。'
          : '第 ' + versionNo + ' 版的 PDF 資料夾（完整版 PDF 還沒有產生）。';
      }
    }
    if (!out.fullPdf.url) {
      out.fullPdf.url = root.getUrl();
      out.fullPdf.note = '這一版還沒有產生過 PDF；這是 PDF 根資料夾。';
    }
  } catch (err) {
    out.fullPdf.note = '現在查不到 PDF：' + err.message;
  }

  // 可編輯副本：資料夾＋最新一份
  try {
    if (quarterFolder) {
      const cf = quarterFolder.getFoldersByName(EDITABLE_COPY_FOLDER_NAME);
      if (cf.hasNext()) {
        const folder = cf.next();
        out.editableCopy.folderUrl = folder.getUrl();
        // 第七十輪批次 AW 組：按建立時間揀（唔係按檔名／版本號）——見 pickLatestEditableCopy_()
        const entries = [];
        const iter = folder.getFiles();
        while (iter.hasNext()) {
          const f = iter.next();
          entries.push({ file: f, name: String(f.getName()), createdMs: readFileCreatedMs_(f) });
        }
        const picked = pickLatestEditableCopy_(entries);
        const latest = picked ? picked.file : null;
        if (latest) {
          out.editableCopy.url = latest.getUrl();
          out.editableCopy.note = '最新一份：' + latest.getName() + '（快照，之後的改動不會更新它）。';
        } else {
          out.editableCopy.note = '資料夾在，但還沒有任何副本。';
        }
      }
    }
    if (!out.editableCopy.folderUrl) {
      out.editableCopy.note = '這一季還沒有做過可編輯副本。去第 4 步「下載及匯出」可以做一份。';
    }
  } catch (err) {
    out.editableCopy.note = '現在查不到可編輯副本：' + err.message;
  }
  return out;
}

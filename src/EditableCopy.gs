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
    publicLink: { url: '', note: '' },
    fullPdf: { url: '', note: '' },
    editableCopy: { url: '', folderUrl: '', note: '' }
  };

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
        let latest = null;
        const iter = folder.getFiles();
        while (iter.hasNext()) {
          const f = iter.next();
          if (!latest || String(f.getName()) > String(latest.getName())) latest = f;   // 檔名尾係時間戳
        }
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

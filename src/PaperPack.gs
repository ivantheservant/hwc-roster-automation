/**
 * 第三十九輪批次 D 組：**沒有電郵的人要印紙本。**
 *
 * ═════════════════════════════════════════════════════════════════════
 * 這一步要解決什麼
 * ═════════════════════════════════════════════════════════════════════
 *
 * 寄完信之後，總有幾位查不到電郵。他們**照樣要服侍**，只是收不到信。
 * 現在這件事只會在寄送報告裡面出現一行數字，然後就沒有下文——
 * 幹事要自己去記住是誰、自己去產生 PDF、自己去印。
 *
 * 這一步把它接上：一粒掣，列出是誰，兩個出口。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ 為什麼不是 zip
 * ─────────────────────────────────────────────────────────────────────
 *
 * Apps Script 的 `Utilities.zip()` 做得到，但**幹事拿不到那個檔案**：
 * Web App 沒有辦法直接把一個 blob 交給瀏覽器下載
 * （`google.script.run` 只回傳得到可以 JSON 化的東西）。
 * 唯一的路是先把 zip 存去 Drive、再給一條連結——而那樣做，
 * 跟直接給那個**已經放著全部個人 PDF 的資料夾連結**比較，
 * 只是多了一個會過期、會累積、要清理的中間檔。
 *
 * 所以「下載」這個出口做成：**產生齊 PDF，然後給資料夾連結**。
 * Google Drive 本身的「下載資料夾」就會打包成 zip，
 * 那是幹事本來就熟悉的操作。
 *
 * 逐個人的連結亦一併給出來，只想印其中一兩位的時候用。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ 「寄到自己信箱」同 DRY_RUN 的關係
 * ─────────────────────────────────────────────────────────────────────
 *
 * 收件人**永遠**是現在正在操作的那個人自己
 * （`Session.getActiveUser().getEmail()`），不接受任何參數。
 *
 * 所以就算系統仍然在模擬模式，這一封都會真的寄出——DRY_RUN 要守住的是
 * 「不會有義工收到一封他不預期的信」，而寄給自己不會違反這一點。
 * 這件事會在確認畫面明明白白講一次，不會讓幹事以為是模擬。
 */

/**
 * 一封信最多夾多少 bytes 的附件。Gmail 的上限是 25MB，
 * 這裡刻意留一大截：信件本身、編碼膨脹（base64 大約 +33%）都要算進去。
 */
const PAPER_PACK_MAX_ATTACH_BYTES = 15 * 1024 * 1024;

/** 一封信最多夾多少個檔。太多附件有些郵件程式會顯示不了。 */
const PAPER_PACK_MAX_ATTACH_COUNT = 20;

/**
 * 供前端呼叫：把揀好的那批人的個人 PDF 產生出來，回傳資料夾同逐個檔的連結。
 *
 * ⚠️ **會寫入**（產生檔案去 Drive），前端要用 `callServerMutating()`。
 *
 * ⚠️ 分批：`generatePersonalPdfBatchForPeople_()` 本身有斷點續做的機制
 * （一次執行做不完就記住做到哪，下次接住做）。這裡照用，並且把
 * `done` 誠實回傳——**沒有做完就要講**，不可以回一個看起來成功的結果。
 *
 * @param {string} quarterId 季度 ID
 * @param {string[]} personIds 要印的人
 * @returns {Object} 結果
 */
function apiGeneratePaperPack(quarterId, personIds) {
  assertWebAppRequestAllowed_();
  const ids = (personIds || []).map(function (x) { return String(x || '').trim(); })
    .filter(function (x) { return x !== ''; });
  if (ids.length === 0) {
    throw new Error(buildThreePartMessage_(
      '一位都沒有選。',
      '什麼都沒有產生。',
      ['在上面的名單勾選要印的人，再撳一次']));
  }

  const versionNo = findLatestVersionNo(quarterId);
  if (versionNo < 0) {
    throw new Error(buildThreePartMessage_(
      '這一季還沒有生成過任何版本。',
      '什麼都沒有產生。',
      ['先在第 1 步生成職事表']));
  }

  const batch = generatePersonalPdfBatchForPeople_(quarterId, versionNo, ids);
  const files = listPaperPackFiles_(quarterId, versionNo, ids);

  writeAuditLog_({
    action: 'PAPER_PACK_GENERATED',
    targetSheet: buildRosterSheetName_(quarterId, versionNo),
    targetCell: '',
    oldValue: '',
    newValue: '為 ' + ids.length + ' 位產生紙本 PDF（完成 ' + batch.doneCount + '）'
  });

  return {
    done: !!batch.done,
    versionNo: versionNo,
    requested: ids.length,
    doneCount: batch.doneCount,
    generatedCount: batch.generatedCount,
    skippedExistingCount: batch.skippedExistingCount,
    errors: batch.errors || [],
    folderUrl: files.folderUrl,
    files: files.files,
    missing: files.missing,
    // 一次執行做不完是正常的（Apps Script 有六分鐘上限）。**要講出來**，
    // 否則幹事會以為已經齊了，然後少印幾份。
    message: batch.done
      ? '全部產生好了。'
      : ('這一次做了 ' + batch.doneCount + ' ／ 共 ' + ids.length
        + ' 位。再撳一次會由上次停低的位置接住做。')
  };
}

/**
 * 列出那批人的個人 PDF 檔案。**純讀取 Drive。**
 *
 * ⚠️ 找不到檔案的人要放進 `missing` 逐個列出——**不可以靜靜略過**。
 * 略過的話幹事會少印一份，而且完全不知道少了誰。
 *
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {string[]} personIds 要找的人
 * @returns {{folderUrl: string, files: Object[], missing: Object[]}}
 */
function listPaperPackFiles_(quarterId, versionNo, personIds) {
  const folder = getOrCreateRosterSubfolder_(quarterId, versionNo);
  const N = COLUMNS.NAME_MAPPING;
  const nameById = {};
  readPeople().forEach(function (row) {
    const id = String(row[N.PERSON_ID] || '').trim();
    if (id) nameById[id] = String(row[N.NAME_TC] || '').trim();
  });

  const files = [];
  const missing = [];
  personIds.forEach(function (id) {
    const nameTC = nameById[id] || '';
    if (!nameTC) {
      missing.push({ personId: id, nameTC: '', reason: 'NameMapping 查不到這個編號。' });
      return;
    }
    const fileName = buildAttachmentName_(quarterId, versionNo, nameTC);
    const found = folder.getFilesByName(fileName);
    if (!found.hasNext()) {
      missing.push({ personId: id, nameTC: nameTC, reason: '找不到「' + fileName + '」。' });
      return;
    }
    const file = found.next();
    files.push({
      personId: id, nameTC: nameTC, fileName: fileName,
      url: file.getUrl(), sizeBytes: file.getSize()
    });
  });

  return { folderUrl: folder.getUrl(), files: files, missing: missing };
}

/**
 * 供前端呼叫：把那批人的個人 PDF 全部寄一封（或幾封）給**操作的人自己**。
 *
 * ⚠️ 收件人不接受任何參數，永遠是 `Session.getActiveUser().getEmail()`。
 * 這不是為了方便——是為了令這一條路**結構上不可能**被用來寄給義工。
 *
 * @param {string} quarterId 季度 ID
 * @param {string[]} personIds 要印的人
 * @returns {Object} 寄了幾封、夾了幾個檔、哪幾位找不到檔
 */
function apiEmailPaperPackToSelf(quarterId, personIds) {
  assertWebAppRequestAllowed_();
  const ids = (personIds || []).map(function (x) { return String(x || '').trim(); })
    .filter(function (x) { return x !== ''; });
  if (ids.length === 0) {
    throw new Error(buildThreePartMessage_(
      '一位都沒有選。', '一封都沒有寄出。', ['在上面的名單勾選要印的人，再撳一次']));
  }

  const to = Session.getActiveUser().getEmail();
  if (!to) {
    throw new Error(buildThreePartMessage_(
      '查不到你自己的電郵地址。',
      '一封都沒有寄出。',
      ['重新載入這一頁再試一次',
        '如果一直查不到，改用「下載」那一個出口——它會給你一條資料夾連結']));
  }

  const versionNo = findLatestVersionNo(quarterId);
  if (versionNo < 0) {
    throw new Error(buildThreePartMessage_(
      '這一季還沒有生成過任何版本。', '一封都沒有寄出。', ['先在第 1 步生成職事表']));
  }

  const found = listPaperPackFiles_(quarterId, versionNo, ids);
  if (found.files.length === 0) {
    throw new Error(buildThreePartMessage_(
      '一份個人 PDF 都找不到。',
      '一封都沒有寄出。',
      ['先撳「產生並取得連結」，等它產生好，再撳這一粒']));
  }

  // ── 按大小同數量分批 ─────────────────────────────────────────
  //
  // ⚠️ 不分批的話，人數一多就會撞 Gmail 的附件上限，
  // 而失敗訊息（"Attachment size exceeds the allowable limit"）
  // 對幹事完全沒有意義。分批之後每一封都在安全範圍內。
  const batches = [];
  let current = [];
  let currentBytes = 0;
  found.files.forEach(function (f) {
    const tooBig = current.length >= PAPER_PACK_MAX_ATTACH_COUNT
      || (current.length > 0 && currentBytes + f.sizeBytes > PAPER_PACK_MAX_ATTACH_BYTES);
    if (tooBig) { batches.push(current); current = []; currentBytes = 0; }
    current.push(f);
    currentBytes += f.sizeBytes;
  });
  if (current.length > 0) batches.push(current);

  const quarterLabel = buildQuarterLabel_(quarterId);
  let sentCount = 0;
  batches.forEach(function (batchFiles, i) {
    const blobs = batchFiles.map(function (f) {
      return DriveApp.getFileById(extractDriveFileId_(f.url)).getBlob();
    });
    const partText = batches.length > 1 ? ('（第 ' + (i + 1) + ' 封／共 ' + batches.length + ' 封）') : '';
    const lines = [
      quarterLabel + ' 　第 ' + versionNo + ' 版',
      '',
      '這一封夾住 ' + batchFiles.length + ' 份個人職事表，是要印紙本給沒有電郵的人的。',
      '',
      batchFiles.map(function (f) { return '　・' + f.nameTC; }).join('\n'),
      '',
      '這一封是系統寄給你自己的，沒有任何一位義工會收到。'
    ];
    MailApp.sendEmail({
      to: to,
      subject: '要印紙本的個人職事表：' + quarterLabel + partText,
      body: lines.join('\n'),
      attachments: blobs
    });
    sentCount++;
  });

  writeAuditLog_({
    action: 'PAPER_PACK_EMAILED',
    targetSheet: buildRosterSheetName_(quarterId, versionNo),
    targetCell: '',
    oldValue: '',
    newValue: '寄了 ' + sentCount + ' 封給操作者自己，共 ' + found.files.length + ' 份'
  });

  return {
    sentCount: sentCount,
    fileCount: found.files.length,
    missing: found.missing,
    // ⚠️ 收件人不寫出完整地址（這是一個公開 repo 的稽核紀錄會經過的路），
    // 但畫面要講得出「寄咗去你自己個信箱」。
    message: '已經寄出 ' + sentCount + ' 封到你自己的信箱，共 ' + found.files.length + ' 份。'
      + (found.missing.length > 0
        ? '另外有 ' + found.missing.length + ' 位找不到 PDF，沒有夾進去——下面有名單。'
        : '')
  };
}

/**
 * 由 Drive 檔案連結抽出檔案 ID。
 *
 * ⚠️ 抽不到**一定要拋錯**，不可以回空字串——回空字串的話
 * `DriveApp.getFileById('')` 會拋一個完全看不出成因的錯。
 * @param {string} url Drive 檔案連結
 * @returns {string} 檔案 ID
 */
function extractDriveFileId_(url) {
  const m = /\/d\/([A-Za-z0-9_-]+)/.exec(String(url || ''))
    || /[?&]id=([A-Za-z0-9_-]+)/.exec(String(url || ''));
  if (!m) throw new Error('看不懂這一條 Drive 連結，抽不出檔案編號：' + url);
  return m[1];
}

/**
 * 第四十一輪批次 G 組：**不標示名字的那一份紙本。**
 *
 * ═════════════════════════════════════════════════════════════════════
 * ⚠️ 先講一件必須誠實講的事
 * ═════════════════════════════════════════════════════════════════════
 *
 * 「個人版 PDF」實際上就是**整張職事表，加上那個人自己那幾格的底色**
 *（見 `buildPersonalPdfBlob_()`：它複製整張 grid，只有 highlight 那一步
 * 是逐人不同的）。所以一旦不標示名字，**每一個人那一份的內容會一模一樣**。
 *
 * 那麼「每人一份、不標示」同「一份大家看」在檔案層面是同一件事，
 * 分別只在於**印幾多份**。
 *
 * 系統因此只做一個檔，然後告訴幹事要印幾多份。
 * 為 12 個人做 12 個內容完全相同的 PDF，只會多花十幾分鐘、
 * 撞爆 Apps Script 的六分鐘上限，而印出來一模一樣。
 *
 * ⚠️ 這一點會在畫面上直接寫出來，不是藏在這裡。
 * 幹事撳之前就會見到「每一份都一樣，所以只做一個檔，你印 N 份」。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ 為什麼不是叫 `exportRosterPdf()`
 * ─────────────────────────────────────────────────────────────────────
 *
 * `exportRosterPdf()` 存去 `ROSTER_DRIVE_FOLDER_ID` 那個總資料夾。
 * 紙本這條路的其他檔全部在**那一版自己的子資料夾**裡面，
 * 幹事撳「開啟資料夾」見到的是那一個。存去兩個不同地方的話，
 * 他會在資料夾裡面找不到自己剛剛做好的那一份。
 *
 * blob 本身仍然是 `buildFullRosterPdfBlob_()` 做的——**沒有另寫一套匯出**。
 * 那條路本來就完全沒有經過 highlight。
 */

/**
 * 供前端呼叫：產生一份**沒有任何標示**的整季 PDF。
 *
 * ⚠️ **會寫入**（產生檔案去 Drive），前端要用 `callServerMutating()`。
 *
 * @param {string} quarterId 季度 ID
 * @param {number=} copies 幹事打算印幾多份（只影響回傳的提示文字，不影響檔案）
 * @returns {Object} 檔名、連結、要印幾多份
 */
function apiGeneratePlainPaper(quarterId, copies) {
  assertWebAppRequestAllowed_();

  const versionNo = findLatestVersionNo(quarterId);
  if (versionNo < 0) {
    throw new Error(buildThreePartMessage_(
      '這一季還沒有生成過任何版本。',
      '什麼都沒有產生。',
      ['先在第 1 步生成職事表']));
  }

  const built = buildFullRosterPdfBlob_(quarterId, versionNo);
  const folder = getOrCreateRosterSubfolder_(quarterId, versionNo);
  const file = saveOrOverwriteFile_(folder, built.fileName, built.blob);

  const wanted = Math.max(1, Math.floor(Number(copies) || 1));

  writeAuditLog_({
    action: 'PLAIN_PAPER_GENERATED',
    targetSheet: buildRosterSheetName_(quarterId, versionNo),
    targetCell: '',
    oldValue: '',
    newValue: '產生不標示名字的紙本（建議印 ' + wanted + ' 份）'
  });

  return {
    versionNo: versionNo,
    fileName: file.getName(),
    fileUrl: file.getUrl(),
    folderUrl: folder.getUrl(),
    copies: wanted,
    // ⚠️ 一定要講明「每一份都一樣」。不講的話，幹事會以為系統漏做了
    // 其他人那幾份，然後再撳多幾次。
    message: '這一份沒有任何標示，每一個人拿到的都一樣，所以只做一個檔。'
  };
}

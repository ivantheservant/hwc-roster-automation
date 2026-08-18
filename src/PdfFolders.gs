/**
 * 第二十六輪批次階段 B：PDF 按「季度 ▸ 版本」分資料夾。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 點解要分
 * ─────────────────────────────────────────────────────────────────────
 *
 * 現時全部 PDF 平舖喺一個 Drive 資料夾。算一算：
 * 58 人 × 每季約 3 個版本 × 4 季 ＝ **每年約 700 個檔**，加埋完整版。
 * 做多一年就冇人搵得到。
 *
 * 新結構：
 *   RosterPDF（ROSTER_DRIVE_FOLDER_ID，根，不變）
 *   └── 2027T1
 *       └── v0
 *           ├── 2027T1_v0_粵語堂職事表_完整版.pdf
 *           └── （每人一份個人版）
 *
 * 資料夾名用 `2027T1`／`v0`，唔用中文——同 grid 工作表名
 * （`Roster_2027T1_v0`）睇齊，日後對數容易。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ 舊檔一個都唔會搬、唔會刪
 * ─────────────────────────────────────────────────────────────────────
 *
 * 已經寄出去嘅信入面有 Drive 連結，搬檔案唔會斷連結（Drive 用 file ID），
 * 但**搬嘢本身就係一個會出錯嘅動作**，而收益只係「睇落靚啲」。
 * 舊檔留喺根資料夾，新檔入子資料夾，兩邊共存。
 *
 * 所以每個掃描工具都要**同時睇根資料夾同子資料夾**——見
 * `listRosterPdfFilesForQuarter_()`，全部工具一律經嗰一個入口。
 */

/** 版本資料夾名嘅前綴。同 grid 工作表名嘅 `_v0` 一致。 */
const PDF_VERSION_FOLDER_PREFIX = 'v';

/** 建資料夾嘅鎖等幾耐（毫秒）。 */
const PDF_FOLDER_LOCK_WAIT_MS = 15000;

/**
 * 攞（冇就建）某一季某一版嘅 PDF 資料夾。**呢個係唯一入口。**
 *
 * ⚠️ **用 `LockService` 包住「查有冇 → 冇就建」。**
 * 冇鎖嘅話，兩個人同時生成兩個版本，兩邊都會「查到冇」然後各自建一個
 * 同名資料夾——Drive **容許同名資料夾**，所以之後就會有兩個 `2027T1`，
 * 一半檔案入咗其中一個、一半入咗另一個，而且**兩個都睇落正常**。
 *
 * ⚠️ 呼叫端一批 PDF **只應該叫一次**，唔好每個檔叫一次——
 * 每次都要攞鎖 ＋ 兩次 Drive 查詢，58 個檔就係 58 次。
 * 見 `PdfBatch.gs` 嘅呼叫方式。
 *
 * @param {string} quarterId 季度 ID，例如 `2027T1`
 * @param {number} versionNo 版本號
 * @returns {Folder} 版本資料夾
 */
function getOrCreateRosterSubfolder_(quarterId, versionNo) {
  const root = resolveMailAttachmentFolder_();   // 已經驗過係 Shared Drive
  const quarterName = String(quarterId || '').trim();
  if (!quarterName) throw new Error('getOrCreateRosterSubfolder_ 需要 quarterId。');
  const versionName = PDF_VERSION_FOLDER_PREFIX + Number(versionNo);

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(PDF_FOLDER_LOCK_WAIT_MS);
  } catch (err) {
    // 攞唔到鎖唔可以照建——嗰個正正係會建出兩個同名資料夾嘅情況。
    throw new Error('現在有另一個動作正在建立 PDF 資料夾，請等一分鐘再試一次。'
      + '（如果一直失敗，代表上一個動作可能未正常結束。）');
  }
  try {
    const quarterFolder = findOrCreateChildFolder_(root, quarterName);
    const versionFolder = findOrCreateChildFolder_(quarterFolder, versionName);
    // 子資料夾繼承 Shared Drive 位置，但仍然驗一次——
    // 萬一有人手動搬過，我哋要即刻知，唔好靜靜存落 My Drive。
    if (isPersonalMyDriveFolder_(versionFolder)) {
      throw new Error('PDF 版本資料夾「' + quarterName + '/' + versionName
        + '」不在 Shared Drive 裡面。請檢查有沒有人手動搬過資料夾。');
    }
    return versionFolder;
  } finally {
    lock.releaseLock();
  }
}

/**
 * 喺一個資料夾下面搵（冇就建）指定名嘅子資料夾。
 *
 * ⚠️ 呢個函式**唔自己攞鎖**——一定要由已經攞咗鎖嘅呼叫端叫
 * （見 `getOrCreateRosterSubfolder_()`）。喺呢度攞鎖會變成巢狀攞同一把鎖。
 * @param {Folder} parent 父資料夾
 * @param {string} name 子資料夾名
 * @returns {Folder}
 */
function findOrCreateChildFolder_(parent, name) {
  const existing = parent.getFoldersByName(name);
  if (existing.hasNext()) return existing.next();
  return parent.createFolder(name);
}

/**
 * 列出某一季**全部** PDF——根資料夾嘅舊檔 ＋ 子資料夾嘅新檔。
 *
 * ⚠️ **全部掃描／清理／檢查工具一律經呢一個入口。**
 *
 * 點解要一個共用入口：加咗子資料夾之後，任何一個「自己 `folder.getFiles()`」
 * 嘅工具都會**只睇到一半檔案**——而佢唔會報錯，只會少報幾十個檔。
 * 「清理舊 PDF」少報 ＝ 清唔乾淨（可接受）；
 * 「檢查個人 PDF 完整性」少報 ＝ **報告話缺件，但其實檔案喺度**（好差）。
 *
 * 只行「已知位置」——根 ＋ `{quarterId}/v*`，唔係無限遞迴亂行，
 * 所以唔會因為有人喺 Drive 亂建資料夾而慢或者出錯。
 *
 * @param {string} quarterId 季度 ID
 * @returns {Object[]} 每項 {id, name, sizeBytes, folderName, inSubfolder, versionFolderId}
 */
function listRosterPdfFilesForQuarter_(quarterId) {
  const root = resolveMailAttachmentFolder_();
  const quarterName = String(quarterId || '').trim();
  const out = [];

  const collect = function (folder, inSubfolder, versionFolderId) {
    const iter = folder.getFiles();
    while (iter.hasNext()) {
      const file = iter.next();
      out.push({
        id: file.getId(),
        name: file.getName(),
        sizeBytes: file.getSize(),
        folderName: folder.getName(),
        inSubfolder: inSubfolder,
        versionFolderId: versionFolderId || ''
      });
    }
  };

  // 1. 根資料夾（舊檔平舖喺呢度，一個都冇搬）
  collect(root, false, '');

  // 2. {quarterId}/v* 子資料夾
  const quarterFolders = root.getFoldersByName(quarterName);
  while (quarterFolders.hasNext()) {
    const qf = quarterFolders.next();
    const versionFolders = qf.getFolders();
    while (versionFolders.hasNext()) {
      const vf = versionFolders.next();
      collect(vf, true, vf.getId());
    }
    // 直接擺喺季度資料夾（唔喺版本資料夾）嘅檔案都要計——
    // 唔計嘅話，如果有人手動擺咗檔喺嗰度，清理工具就會當佢唔存在。
    collect(qf, true, '');
  }

  return out;
}

/**
 * `listRosterPdfFilesForQuarter_()` 嘅 Map 版本，介面同舊
 * `listExistingFileSizes_(folder)` 一樣（檔名 → 大小），方便直接換過去。
 *
 * ⚠️ 同名檔案（根同子資料夾各有一份）**保留較大嗰個**——
 * 呢個判斷服務嘅係「有冇一份可用嘅 PDF」，而 0 bytes 嘅殘檔
 * 唔應該蓋過一份正常嘅。
 * @param {string} quarterId 季度 ID
 * @returns {Map<string, number>}
 */
function listRosterPdfSizesForQuarter_(quarterId) {
  const sizes = new Map();
  listRosterPdfFilesForQuarter_(quarterId).forEach(function (f) {
    const existing = sizes.get(f.name);
    if (existing === undefined || f.sizeBytes > existing) sizes.set(f.name, f.sizeBytes);
  });
  return sizes;
}

/**
 * 喺「新結構」同「舊平舖」兩處搵一個 PDF 檔名。
 *
 * ⚠️ **一定要兩處都搵。** 呢一輪之前生成嘅 PDF（例如 2026T4 全部）
 * 平舖喺根資料夾，一個都冇搬。淨係搵子資料夾嘅話，
 * **重發舊季度就會全部變成「缺件」**，而畫面上只會顯示一個
 * 令人摸不著頭腦嘅「找不到 PDF」。
 *
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {string} fileName 要搵嘅檔名
 * @returns {?File} 搵唔到回 null
 */
function findRosterPdfFile_(quarterId, versionNo, fileName) {
  // 1. 新結構（唔會建資料夾——淨係搵）
  const root = resolveMailAttachmentFolder_();
  const quarterFolders = root.getFoldersByName(String(quarterId || '').trim());
  while (quarterFolders.hasNext()) {
    const qf = quarterFolders.next();
    const versionFolders = qf.getFoldersByName(PDF_VERSION_FOLDER_PREFIX + Number(versionNo));
    while (versionFolders.hasNext()) {
      const hit = versionFolders.next().getFilesByName(fileName);
      if (hit.hasNext()) return hit.next();
    }
  }
  // 2. 舊平舖（呢一輪之前生成嘅）
  const legacy = root.getFilesByName(fileName);
  return legacy.hasNext() ? legacy.next() : null;
}

/**
 * 清理完之後，把**空咗嘅**版本資料夾刪走，唔好留一堆空 `v0`。
 *
 * ⚠️ **只刪真係空嘅資料夾**（冇檔案、冇子資料夾）。
 * 入面仲有嘢嘅一律唔掂——寧可留一個唔應該留嘅空殼，
 * 都好過刪走一個入面有嘢嘅資料夾。
 *
 * ⚠️ 亦**唔會刪季度資料夾**，就算佢空咗。季度資料夾好平，
 * 而佢嘅存在本身就係「呢一季做過嘢」嘅一個痕跡。
 *
 * @param {string} quarterId 季度 ID
 * @returns {string[]} 實際刪走嘅資料夾名
 */
function removeEmptyVersionFolders_(quarterId) {
  const root = resolveMailAttachmentFolder_();
  const removed = [];
  const quarterFolders = root.getFoldersByName(String(quarterId || '').trim());
  while (quarterFolders.hasNext()) {
    const qf = quarterFolders.next();
    const versionFolders = qf.getFolders();
    while (versionFolders.hasNext()) {
      const vf = versionFolders.next();
      if (vf.getFiles().hasNext()) continue;      // 仲有檔案 ⇒ 唔掂
      if (vf.getFolders().hasNext()) continue;    // 仲有子資料夾 ⇒ 唔掂
      const name = qf.getName() + '/' + vf.getName();
      vf.setTrashed(true);
      removed.push(name);
    }
  }
  return removed;
}

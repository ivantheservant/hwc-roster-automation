// 第二十六輪批次階段 B：PDF 按「季度 ▸ 版本」分資料夾。
// 執行方式：node tests/pdf_folder_structure.test.js
//
// ─────────────────────────────────────────────────────────────────────
// ⚠️ 一個要記住嘅前提落差
// ─────────────────────────────────────────────────────────────────────
//
// 本輪嘅任務書假設咗有一張 `RosterPDF` 工作表存住 file ID，
// 並且要求清理工具改成「以嗰張表為準」。
//
// **嗰張表唔存在。** 全專案冇任何 `SHEETS.ROSTER_PDF`，PDF 從來都係
// 靠掃 Drive 資料夾 ＋ 解析檔名（`{QuarterID}_v{N}_...`）認出嚟。
//
// 所以改成：**一個共用入口 `listRosterPdfFilesForQuarter_()`**，
// 佢會同時掃根資料夾（舊平舖檔）同 `{quarterId}/v*` 子資料夾。
// 效果同任務書想要嘅一樣（單一權威存取點、冇工具會漏掃），
// 只係背後係 Drive 而唔係一張唔存在嘅工作表。

const fs = require('fs');
const path = require('path');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const folders = read('src/PdfFolders.gs');
const batch = read('src/PdfBatch.gs');
const exportSrc = read('src/PdfExport.gs');
const mailer = read('src/Mailer.gs');
const reset = read('src/QuarterReset.gs');

function bodyOf(src, fnName) {
  const start = src.indexOf('function ' + fnName);
  if (start === -1) return '';
  const rest = src.slice(start);
  const end = rest.indexOf('\n}\n');
  return end === -1 ? rest : rest.slice(0, end + 3);
}

console.log('\n=== B1：路徑組成 ===');
{
  check('★★★★★ 有單一入口 getOrCreateRosterSubfolder_(quarterId, versionNo)',
    /function getOrCreateRosterSubfolder_\(quarterId, versionNo\)/.test(folders));
  const body = bodyOf(folders, 'getOrCreateRosterSubfolder_');
  check('★★★★ 兩層：季度資料夾 ▸ 版本資料夾',
    /findOrCreateChildFolder_\(root, quarterName\)/.test(body)
    && /findOrCreateChildFolder_\(quarterFolder, versionName\)/.test(body));
  check('★★★★ 版本資料夾名係 v ＋ 數字（同 grid 工作表名嘅 _v0 睇齊）',
    /PDF_VERSION_FOLDER_PREFIX \+ Number\(versionNo\)/.test(body));
  check('★★★★ 根資料夾用返 resolveMailAttachmentFolder_()（已經驗過 Shared Drive）',
    /resolveMailAttachmentFolder_\(\)/.test(body));
}

console.log('\n=== B2【核心】競態：用 LockService 包住「查有冇 → 冇就建」 ===');
{
  const body = bodyOf(folders, 'getOrCreateRosterSubfolder_');
  check('★★★★★ 有攞鎖', /LockService\.getScriptLock\(\)/.test(body));
  check('★★★★★ 而且喺 finally 放鎖（拋錯都要放，否則之後全部人都攞唔到）',
    /finally \{\s*\n\s*lock\.releaseLock\(\);/.test(body));
  check('★★★★★ 攞唔到鎖**唔會照建**'
    + '——Drive 容許同名資料夾，照建就會出現兩個 2027T1，'
    + '一半檔案入咗其中一個、一半入咗另一個，而且兩個都睇落正常',
    /catch \(err\) \{[\s\S]{0,200}?throw new Error/.test(body));
  check('★★★★ 而且錯誤訊息係人話（唔係 LockService timeout 嗰串英文）',
    body.indexOf('請等一分鐘再試一次') !== -1);

  const childBody = bodyOf(folders, 'findOrCreateChildFolder_');
  check('★★★★★ findOrCreateChildFolder_ **唔會自己再攞鎖**'
    + '（巢狀攞同一把鎖會死鎖）',
    !/LockService/.test(childBody));
}

console.log('\n=== B2 Shared Drive：唔可以跌落個人 My Drive ===');
{
  const body = bodyOf(folders, 'getOrCreateRosterSubfolder_');
  check('★★★★★ 子資料夾都要再驗一次（萬一有人手動搬過）',
    /isPersonalMyDriveFolder_\(versionFolder\)/.test(body));
}

console.log('\n=== B2【核心】一批只解析一次資料夾 ===');
{
  ['generatePersonalPdfBatch_', 'generatePersonalPdfBatchForPeople_'].forEach(function (fn) {
    const body = bodyOf(batch, fn);
    const calls = (body.match(/getOrCreateRosterSubfolder_\(/g) || []).length;
    check('★★★★★ ' + fn + ' 只叫一次 getOrCreateRosterSubfolder_()'
      + '——嗰個函式要攞鎖，逐個檔叫一次就係 58 次攞鎖',
      calls === 1, '叫咗 ' + calls + ' 次');
  });
}

console.log('\n=== B2【核心】舊檔一個都唔搬、唔刪 ===');
{
  const all = folders + batch + exportSrc + mailer + reset;
  check('★★★★★ 全部相關檔案冇任何 moveTo／setParents 之類嘅搬檔呼叫'
    + '——搬嘢本身就係一個會出錯嘅動作，而收益只係「睇落靚啲」',
    !/\.moveTo\(|setParents\(|removeFile\(/.test(all));

  check('★★★★★ 附件查找**新舊兩處都搵**'
    + '——淨係搵新子資料夾，重發舊季度就會全部變成「缺件」而寄唔出',
    /function findRosterPdfFile_/.test(folders));
  const findBody = bodyOf(folders, 'findRosterPdfFile_');
  check('★★★★★ 而且第二步真係去根資料夾搵（舊平舖檔）',
    /root\.getFilesByName\(fileName\)/.test(findBody));
  check('★★★★ Mailer 用咗嗰個共用查找，唔係自己 getFilesByName',
    /findRosterPdfFile_\(context\.quarterId, context\.versionNo, fileName\)/.test(mailer));
}

console.log('\n=== B3【核心】掃描／清理工具一律經共用入口 ===');
{
  check('★★★★★ 有共用入口 listRosterPdfFilesForQuarter_()',
    /function listRosterPdfFilesForQuarter_/.test(folders));
  const body = bodyOf(folders, 'listRosterPdfFilesForQuarter_');
  check('★★★★★ 根資料夾同子資料夾都掃',
    /collect\(root, false/.test(body) && /getFoldersByName\(quarterName\)/.test(body));
  check('★★★★ 只行已知位置（唔係無限遞迴亂行）',
    !/getFolders\(\)[\s\S]{0,60}?getFolders\(\)[\s\S]{0,60}?getFolders\(\)/.test(body));

  [['PdfExport.gs scanNonLatestPdfs_', bodyOf(exportSrc, 'scanNonLatestPdfs_')],
    ['PdfExport.gs planQuarterPdfCleanup_', bodyOf(exportSrc, 'planQuarterPdfCleanup_')],
    ['PdfBatch.gs diagnosePersonalPdfVersions_', bodyOf(batch, 'diagnosePersonalPdfVersions_')]
  ].forEach(function (pair) {
    check('★★★★★ ' + pair[0] + ' 用共用入口，冇自己 folder.getFiles()'
      + '——自己掃就會**只睇到一半檔案**，而且唔會報錯，只會少報',
      /listRosterPdfFilesForQuarter_\(/.test(pair[1])
      && !/folder\.getFiles\(\)/.test(pair[1]), pair[1].slice(0, 300));
  });

  check('★★★★★ 季度重設嘅 PDF 段落亦經共用入口'
    + '——漏掃嘅話，重設之後舊 PDF 會留低，下次生成就會撈亂新舊',
    /listRosterPdfFilesForQuarter_\(quarterId\)/.test(reset));

  check('★★★★★ 缺件檢查用 listRosterPdfSizesForQuarter_()'
    + '——舊季度嘅檔平舖喺根，淨係睇子資料夾會全部報「缺件」，'
    + '而「報告話缺、實際唔缺」比漏報更難查',
    /listRosterPdfSizesForQuarter_\(quarterId\)/.test(batch));
}

console.log('\n=== B3 清理之後只刪**空**資料夾 ===');
{
  check('★★★★ 有 removeEmptyVersionFolders_()',
    /function removeEmptyVersionFolders_/.test(folders));
  const body = bodyOf(folders, 'removeEmptyVersionFolders_');
  check('★★★★★ 有檔案 ⇒ 唔掂', /if \(vf\.getFiles\(\)\.hasNext\(\)\) continue;/.test(body));
  check('★★★★★ 有子資料夾 ⇒ 亦唔掂'
    + '——寧可留一個唔應該留嘅空殼，都好過刪走一個入面有嘢嘅資料夾',
    /if \(vf\.getFolders\(\)\.hasNext\(\)\) continue;/.test(body));
  check('★★★★ 用 setTrashed（可復原），唔係永久刪除',
    /vf\.setTrashed\(true\)/.test(body));
  check('★★★★★ **唔會刪季度資料夾**，就算佢空咗'
    + '（佢嘅存在本身就係「呢一季做過嘢」嘅痕跡）',
    !/qf\.setTrashed/.test(body));

  const cleanupBody = bodyOf(exportSrc, 'executeQuarterPdfCleanup_');
  check('★★★★ 清理完之後有叫收拾空資料夾',
    /removeEmptyVersionFolders_\(/.test(cleanupBody));
  check('★★★★★ 而且包 try/catch——收唔到空資料夾唔應該令一次成功嘅清理變成失敗',
    /try \{[\s\S]{0,200}?removeEmptyVersionFolders_[\s\S]{0,200}?catch/.test(cleanupBody));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);

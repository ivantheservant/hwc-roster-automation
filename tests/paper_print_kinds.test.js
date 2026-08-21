// 第四十一輪批次 G 組：紙本三揀一（標示名字／不標示／一份大家看）。
// 執行方式：node tests/paper_print_kinds.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 呢一份守住咩
// ═════════════════════════════════════════════════════════════════════
//
// Ivan 要求紙本彈窗加一個三揀一：
//   每人一份、標示自己個名（現狀，預設）
//   每人一份、**唔標示名字**
//   一份整季表，印一張大家睇
//
// ⚠️ 呢度有一件必須誠實講嘅事：
// 「個人版 PDF」實際上就係**成張職事表 ＋ 嗰個人自己嗰幾格嘅底色**
//（見 `buildPersonalPdfBlob_()`）。所以一唔標示名字，
// 每一個人嗰一份嘅**內容會一模一樣**。
//
// 即係話，第二同第三種喺檔案層面係同一件事，分別只在於印幾多份。
// 系統因此只做一個檔——為 12 個人做 12 個一模一樣嘅 PDF，
// 只會多花十幾分鐘、撞爆六分鐘上限，而印出嚟一模一樣。
//
// **而呢一點一定要喺畫面上寫出嚟**，唔可以靜靜噉做。
// 幹事撳之前就要見到「每一份都一樣，所以只做一個檔，你印 N 份」，
// 否則佢會以為系統漏做咗其他人嗰幾份，然後再撳多幾次。
//
// 呢一份斷言嘅就係「有冇寫出嚟」同「有冇另寫一套匯出」。

const fs = require('fs');
const path = require('path');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 400));
}

const ROOT = path.join(__dirname, '..');
const ui = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'ScriptSendPaper.html'), 'utf8');
const paperPack = fs.readFileSync(path.join(ROOT, 'src', 'PaperPack.gs'), 'utf8');

// 剝走註解先做比對。斷言撞正註解入面嗰句就會綠燈，而實際嗰行碼可以係壞嘅
// ——呢個系統之前中過四次。
const uiBare = ui.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const packBare = paperPack.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// =====================================================================
console.log('\n=== G【核心】三揀一真係有三個 ===');
{
  ['PERSONAL', 'PLAIN', 'FULL_ONE'].forEach(function (kind) {
    check('★★★★★ 有 `' + kind + '` 呢一種',
      new RegExp("'" + kind + "'").test(uiBare), '');
  });
  check('★★★★★ 預設係「標示自己個名」（現狀）'
    + '——預設變咗嘅話，幹事乜都唔撳就會印出一疊冇名嘅表',
    /let paperKind_ = 'PERSONAL'/.test(uiBare), '');
  check('★★★★★ 每次開彈窗都重設返做預設'
    + '（留住上一次嘅選擇，佢下次會以為自己揀緊預設）',
    /paperKind_ = 'PERSONAL';\s*\n\s*paperSelection_ = \{\};/.test(uiBare), '');
}

console.log('\n=== G【核心】「每一份都一樣」呢件事要講出嚟 ===');
{
  check('★★★★★ 「不標示」嗰個選項下面明講**只做一個檔**'
    + '——唔講嘅話，幹事會以為系統漏做咗其他人嗰幾份，然後再撳多幾次',
    /每一份內容都一模一樣，所以系統只做一個檔/.test(ui), '');
  check('★★★★★ 而且明講「選了多少位 ＝ 要印多少份」'
    + '（唔講嘅話，個名單喺嗰一種入面睇落好似冇作用）',
    /選了多少位，就是要印多少份/.test(ui), '');
  check('★★★★★ 「一份大家看」嗰個選項明講同上面嗰種係同一個檔',
    /同上面那一種是同一個檔/.test(ui), '');
  check('★★★★★ 後端回傳嘅訊息都講一次'
    + '（幹事撳完之後見到嘅係嗰句，唔係彈窗嗰句）',
    /每一個人拿到的都一樣，所以只做一個檔/.test(packBare), '');
}

console.log('\n=== G【核心】「揀幾多位」喺唔標示嗰種要有意義 ===');
{
  check('★★★★★ `PLAIN` 仍然畫個名單（份數 ＝ 揀咗幾多位）'
    + '——收埋個名單嘅話，幹事就冇任何地方講得出要印幾多份',
    /if \(paperKind_ === 'PLAIN'\) \{[\s\S]{0,400}selectedPaperIds\(\)\.length/.test(uiBare),
    uiBare.slice(uiBare.indexOf("if (paperKind_ === 'PLAIN')"), 400));
  // ⚠️ 只切 `renderPaperDialog()` 呢一個函式嘅本體。切成份檔嘅話，
  // `indexOf('pickListNodes')` 會撞到「寄出 ▸ 自己選擇」嗰個名單
  //（佢排喺前面），噉個斷言就會永遠綠燈而乜都冇驗到。
  const dlgAt = uiBare.indexOf('function renderPaperDialog');
  const dlg = uiBare.slice(dlgAt, uiBare.indexOf('\n  function selectedPaperIds', dlgAt));
  check('★★★★★ 而 `FULL_ONE` **唔畫**名單，並且喺畫名單之前就 return'
    + '——一個撳落去冇作用嘅控制項，就係呢個專案一直喺度殺嗰樣嘢',
    dlgAt !== -1 && dlg.indexOf("if (paperKind_ === 'FULL_ONE')") !== -1
      && dlg.indexOf("if (paperKind_ === 'FULL_ONE')") < dlg.indexOf('pickListNodes('),
    dlg.slice(0, 200));
  check('★★★★ `FULL_ONE` 傳 1 份，唔係傳揀咗幾多位',
    /runPlainPaper\(1\)/.test(uiBare), '');
  check('★★★★★ 而 `PLAIN` 傳嘅係揀咗幾多位',
    /runPlainPaper\(selectedPaperIds\(\)\.length\)/.test(uiBare), '');
  check('★★★★ 份數超過一份嗰陣，結果畫面直接講「份數選 N」'
    + '（唔係要幹事自己數返個名單）',
    /份數選 ' \+ r\.copies/.test(uiBare), '');
}

console.log('\n=== G【核心】唔標示嗰一份真係冇 highlight ===');
{
  check('★★★★★ 後端用返 `buildFullRosterPdfBlob_()`'
    + '——嗰條路本來就完全冇經過 highlight',
    /const built = buildFullRosterPdfBlob_\(quarterId, versionNo\)/.test(packBare), '');
  const fn = packBare.slice(packBare.indexOf('function apiGeneratePlainPaper'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  check('★★★★★ 而且 `apiGeneratePlainPaper()` 本身冇叫過任何 highlight'
    + '（叫咗嘅話，一份「大家睇嘅表」會標住某一個人嘅名）',
    !/highlight/i.test(body), body.slice(0, 300));
  check('★★★★★ 冇另寫一套匯出（`exportSheetAsPdfBlob_` 唔應該喺呢度出現）',
    !/exportSheetAsPdfBlob_/.test(body), body.slice(0, 300));
}

console.log('\n=== G：檔案要存喺幹事搵得返嗰個資料夾 ===');
{
  // ⚠️ `exportRosterPdf()` 存去 ROSTER_DRIVE_FOLDER_ID 嗰個總資料夾，
  // 而紙本其他檔全部喺**嗰一版自己嘅子資料夾**。存去兩個地方嘅話，
  // 幹事撳「開啟資料夾」會搵唔到自己啱啱做好嗰一份。
  const fn = packBare.slice(packBare.indexOf('function apiGeneratePlainPaper'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  check('★★★★★ 存去嗰一版自己嘅子資料夾，唔係總資料夾',
    /getOrCreateRosterSubfolder_\(quarterId, versionNo\)/.test(body), body.slice(0, 400));
  check('★★★★★ 同名會覆蓋，唔會每撳一次多一個檔',
    /saveOrOverwriteFile_\(folder, built\.fileName, built\.blob\)/.test(body), '');
  check('★★★★ 冇版本嗰陣要擋，唔可以匯出一張唔存在嘅表',
    /if \(versionNo < 0\)/.test(body), '');
  check('★★★★★ 有寫審計紀錄（Drive 多咗個檔，一定要查得返係邊個幾時做）',
    /action: 'PLAIN_PAPER_GENERATED'/.test(body), '');
}

console.log('\n=== G：既有嘅「標示名字」那一條路一格都冇改 ===');
{
  // ⚠️ Ivan 講到明呢一種係**現狀**。加多兩種嘅時候整爛咗佢，
  // 就等於用一個新功能換走一個佢日日用嘅功能。
  check('★★★★★ `runPaperGenerate()` 仍然走 `apiGeneratePaperPack`',
    /callServerMutating\('apiGeneratePaperPack', currentQuarterId, ids\)/.test(uiBare), '');
  check('★★★★★ 「寄到自己信箱」仍然喺 `PERSONAL` 嗰種出現',
    /寄到自己信箱/.test(ui) && /runPaperEmail\(\)/.test(uiBare), '');
  check('★★★★★ 冇電郵嗰批仍然預設全部勾好',
    /s\.noEmail\.forEach\(\(p\) => \{ paperSelection_\[p\.personId\] = true; \}\)/.test(uiBare), '');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);

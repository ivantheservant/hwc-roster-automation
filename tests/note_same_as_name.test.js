// 第二十八輪批次階段 E1：備註淨係一個名，等於冇備註。
// 執行方式：node tests/note_same_as_name.test.js
//
// ─────────────────────────────────────────────────────────────────────
// Ivan 實測
// ─────────────────────────────────────────────────────────────────────
//
// `Roles` 好多行嘅 `Notes` 就係嗰個人自己個名（當初匯入資料嗰陣順手填嘅）。
// 「身分（堂委／執事）」畫面每一行就會變成：
//
//   當值堂委　2026-01-01 至 現在　在任
//   備註：（同一個名，而個名已經喺上面一行）
//
// ⚠️ **只改顯示，唔改試算表。** 一個「順手幫你清理資料」嘅動作，
// 係喺幹事冇要求、冇確認、冇得反悔嘅情況下改人哋啲資料。
//
// ⚠️ 而且個陷阱喺呢度：「修改」欄位係用同一個 `notes` 值預填嘅。
// 如果後端讀出嚟嗰陣就清走，幹事一撳「儲存」就會把試算表嗰格抹咗——
// 一個「只改顯示」嘅需求，會靜靜變成一個刪資料嘅動作。
// 所以原值同顯示值要係**兩個唔同嘅欄位**。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'WebAppGuards.gs',
  'WebAppRoster3Common.gs'
]);

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const roles = read('src/WebAppRoles.gs');
const zone3 = read('src/ui/ScriptZone3.html');

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// ⚠️ 假名一律明顯係假。
const NAME = '測試甲';

console.log('\n=== E1【核心】備註同個名一模一樣 ⇒ 唔顯示 ===');
{
  check('★★★★★ 一模一樣 ⇒ 空字串',
    gas.displayableNote_(NAME, NAME) === '');
  check('★★★★★ 前後有多餘空白都當成一樣（試算表好易有）',
    gas.displayableNote_('  ' + NAME + '  ', NAME) === ''
    && gas.displayableNote_(NAME, '  ' + NAME + '  ') === '');
}

console.log('\n=== E1【核心】判斷特登收窄：含住個名唔等於冇資訊 ===');
{
  check('★★★★★ 「<名>（暫代）」照樣顯示'
    + '——「含住個名」同「淨係得個名」係兩件事，'
    + '用 indexOf 就會靜靜食咗真正嘅備註',
    gas.displayableNote_(NAME + '（暫代）', NAME) === NAME + '（暫代）');
  check('★★★★★ 「<名>' + '　' + '<名>」（重複兩次）照樣顯示'
    + '——唔一樣就唔關呢條規則事',
    gas.displayableNote_(NAME + '　' + NAME, NAME) === NAME + '　' + NAME);
  check('★★★★ 完全唔同嘅備註照樣顯示',
    gas.displayableNote_('由堂委會 2026 年會議通過', NAME)
      === '由堂委會 2026 年會議通過');
}

console.log('\n=== E1 邊界：空值、缺值、非字串 ===');
{
  check('★★★★★ 空備註 ⇒ 空字串（本來就唔顯示）',
    gas.displayableNote_('', NAME) === '' && gas.displayableNote_('   ', NAME) === '');
  check('★★★★★ `null`／`undefined` 唔會變成字面上嘅 null'
    + '——試算表空格讀出嚟係咩型別唔由我哋話事',
    gas.displayableNote_(null, NAME) === ''
    && gas.displayableNote_(undefined, NAME) === '');
  check('★★★★★ 個名讀唔到（空）嗰陣**唔會**把所有備註當成雜訊'
    + '——「查唔到個名」唔等於「備註等於個名」',
    gas.displayableNote_('一段真正的備註', '') === '一段真正的備註'
    && gas.displayableNote_('一段真正的備註', null) === '一段真正的備註');
  check('★★★★ 數字型備註唔會拋錯',
    gas.displayableNote_(2026, NAME) === '2026');
}

console.log('\n=== E1【核心】唔可以改試算表：原值同顯示值要分開 ===');
{
  check('★★★★★ 後端仍然回原值 `notes`（畀「修改」欄位預填用）',
    /notes: String\(row\[R\.NOTES\] \|\| ''\)\.trim\(\),/.test(roles));
  check('★★★★★ 另外回一個 `notesDisplay` 畀畫面用',
    /notesDisplay: displayableNote_\(row\[R\.NOTES\], nameTC\),/.test(roles));
  check('★★★★★ 畫面印嘅係 `notesDisplay`',
    /r\.notesDisplay\) \{[\s\S]{0,160}?'備註：' \+ r\.notesDisplay/.test(zone3));
  check('★★★★★ 而「修改」欄位預填嘅仍然係 `e.notes` 原值'
    + '——預填成 `notesDisplay` 嘅話，撳「儲存」就會把試算表嗰格抹咗',
    /const notesInput = textField\(e\.notes, '備註（可留空）'\);/.test(zone3));
  check('★★★★★ 畫面唔會再直接印 `r.notes`',
    !/'備註：' \+ r\.notes[^D]/.test(stripComments(zone3)));

  check('★★★★★ `displayableNote_()` 本身冇任何寫入'
    + '——一個叫做「顯示用」嘅函式一旦寫嘢，就冇人會想到要查佢',
    !/setValue|writeRowFields_|appendRowFields_|getRange/
      .test(stripComments(read('src/WebAppRoster3Common.gs'))
        .split('function displayableNote_')[1] || ''));
}

console.log('\n=== E1 範圍：PersonPostExclusions 嗰邊而家根本冇顯示備註 ===');
{
  // ⚠️ 誠實記低範圍：限制清單只顯示「原因」，從來冇顯示過 `Notes`，
  // 所以嗰邊今日冇嘢可以收起。呢個 check 係守住呢個前提——
  // 將來有人喺嗰邊加返備註顯示，呢個 check 會着，提佢行返 `displayableNote_()`。
  const exclusions = stripComments(read('src/WebAppExclusions.gs'));
  check('★★★★ 限制清單後端冇 `notesDisplay`（因為前端冇顯示備註）',
    exclusions.indexOf('notesDisplay') === -1);
  check('★★★★★ 而前端限制那一段亦冇印備註'
    + '（如果將來加，一定要行 `displayableNote_()`）',
    !/exclusionRow[\s\S]{0,1200}?'備註：'/.test(stripComments(zone3)));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);

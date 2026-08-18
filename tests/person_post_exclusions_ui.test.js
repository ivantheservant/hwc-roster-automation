// 第二十七輪批次階段 D：區三畫面八——暫時不做某崗位。
// 執行方式：node tests/person_post_exclusions_ui.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 呢個畫面最重要嘅兩件事
// ─────────────────────────────────────────────────────────────────────
//
// 1. **同「崗位資格」分得開。** 混淆咗嘅後果：幹事想「呢半年唔好排佢做
//    主席」，就去取消佢主席嘅資格——而嗰個係「以後永遠唔會排佢」，
//    而且日後想恢復嗰陣，「佢做過幾多次」呢個歷史已經斷咗。
//
// 2. **解除 ＝ 填 EffectiveTo。** 唔係刪行，亦唔係設 Active=FALSE。
//    `Active=FALSE` 嘅意思係「呢一行由頭到尾都唔算數」——噉樣舊季度嘅
//    職事表就會變成「當時本來可以排佢」，而事實上當時係真係唔應該排佢。

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
const backend = read('src/WebAppExclusions.gs');
const zone3 = read('src/ui/ScriptZone3.html');
const common = read('src/ui/Script.html');

function bodyOf(src, fnName) {
  const start = src.indexOf('function ' + fnName + '(');
  if (start === -1) return '';
  const rest = src.slice(start);
  const end = rest.indexOf('\n}\n');
  return end === -1 ? rest : rest.slice(0, end + 3);
}

console.log('\n=== D【核心】解除 ＝ 填 EffectiveTo，唔係刪行、唔係 Active=FALSE ===');
{
  const lift = bodyOf(backend, 'apiLiftExclusion');

  check('★★★★★ 全檔冇任何刪行呼叫',
    !/deleteRow|deleteRows|removeRow/.test(backend));
  check('★★★★★ 解除**只寫 EffectiveTo 一欄**',
    /updates\[X\.EFFECTIVE_TO\] = parsed\.dateStr;/.test(lift)
    && (lift.match(/updates\[X\./g) || []).length === 1);
  check('★★★★★ 解除**唔會掂 Active**'
    + '——Active=FALSE 嘅意思係「呢一行由頭到尾都唔算數」，'
    + '噉樣舊季度就會變成「當時本來可以排佢」，而事實上唔係',
    !/updates\[X\.ACTIVE\]/.test(lift));
  check('★★★★★ 而且係一個獨立 API（唔係叫呼叫端用 apiSaveExclusion 順手改）'
    + '——獨立入口先至**結構上**保證佢唔會順手改到其他欄',
    /function apiLiftExclusion\(exclusionId, liftDateRaw\)/.test(backend));
  check('★★★★★ AuditLog 記成 EXCLUSION_LIFT（日後一句 filter 就查得晒）',
    /action: 'EXCLUSION_LIFT'/.test(lift));
  check('★★★★ old 值寫得出「本來係空白，仍然生效」',
    lift.indexOf('（空白，仍然生效）') !== -1);
  check('★★★★★ 解除日早過生效日會被擋'
    + '——寫落去就會出現一段負長度嘅生效期，等於嗰條限制從來冇存在過',
    /parsed\.dateStr < from/.test(lift));
  check('★★★★ 而且錯誤訊息會指出「真係想當佢冇存在過」應該點做',
    lift.indexOf('這一行由頭到尾都不算數') !== -1);
}

console.log('\n=== D【核心】畫面要講清楚同「崗位資格」嘅分別 ===');
{
  // 規格 4.5 指定要逐字照抄嘅兩句。
  check('★★★★★ 有「崗位資格 = 這個人從來沒做過這個崗位。」',
    zone3.indexOf('崗位資格 = 這個人從來沒做過這個崗位。') !== -1);
  check('★★★★★ 有「暫時不做 = 這個人做得到，但這一段時間不排他。」',
    zone3.indexOf('暫時不做 = 這個人做得到，但這一段時間不排他。') !== -1);
  check('★★★★★ 而且喺**新增畫面**都出現一次'
    + '——只喺清單頁講一次嘅話，幹事撳咗「新增」就已經睇唔到',
    (zone3.match(/崗位資格 = 這個人從來沒做過這個崗位。/g) || []).length >= 2);
  check('★★★★★ 「解除」畫面講明點解係填日期而唔係刪行'
    + '——唔講嘅話，下一個人會覺得「刪咗佢乾淨啲」',
    zone3.indexOf('系統只會填上「解除日」，不會刪走這一行，也不會把它設成停用。') !== -1);
}

console.log('\n=== D 過期嘅摺入「已解除」一節，唔刪 ===');
{
  const list = bodyOf(backend, 'apiListExclusions');
  check('★★★★★ 已解除 ＝ EffectiveTo 早過今日（**唔係** Active=FALSE）',
    /if \(to && to < today\) lifted\.push\(item\);/.test(list));
  check('★★★★ 前端有「已解除」一節，而且寫明保留紀錄',
    zone3.indexOf("sectionTitle('已解除（'") !== -1
    && zone3.indexOf('保留紀錄，不會刪走') !== -1);
  check('★★★★★ 已解除嗰啲唔會再有「解除限制」掣'
    + '——撳落去只會令人以為要再解除一次',
    /if \(!isLifted\) buttons\.unshift\(button\('解除限制'/.test(zone3));
}

console.log('\n=== D 原因必填 ===');
{
  const v = bodyOf(backend, 'validateExclusionInput_');
  check('★★★★★ 後端擋住空白原因（唔靠前端做關卡）',
    /if \(!reason\) \{/.test(v));
  check('★★★★★ 而且講得出點解要填'
    + '——三個月之後，冇原因嘅限制冇人記得點解，於是冇人夠膽解除佢，'
    + '嗰個人就永遠唔會再被排到嗰個崗位',
    v.indexOf('也就沒有人夠膽解除它') !== -1);
  check('★★★★ 前端亦有講（同一句意思）',
    zone3.indexOf('也就沒有人夠膽解除它。') !== -1);
}

console.log('\n=== D 打錯 PostID 要標出嚟 ===');
{
  const list = bodyOf(backend, 'apiListExclusions');
  check('★★★★★ 崗位表冇呢個代號 ⇒ unknownPost'
    + '——打錯 PostID 嘅話，呢條限制根本唔會生效，而畫面睇落完全正常',
    /unknownPost: !postNames\[postId\]/.test(list));
  check('★★★★★ 前端會顯示出嚟',
    zone3.indexOf('崗位表沒有這個代號，這一條不會生效') !== -1);
  check('★★★★ 而且新增／修改嘅崗位下拉只列真實存在嘅崗位（打唔到錯）',
    /exclusionData\.posts\.forEach/.test(zone3));
}

console.log('\n=== D 四條區三規矩 ===');
{
  const save = bodyOf(backend, 'apiSaveExclusion');
  const add = bodyOf(backend, 'apiAddExclusion');
  check('★★★★★ 只改該行該欄（writeRowFields_）',
    /writeRowFields_\(opened\.sheet, opened\.headers, found\.sheetRow, newValues\)/.test(save));
  check('★★★★★ 用 ID 重新搵列號，唔信前端傳嚟嗰個',
    /findRowById_\(SHEETS\.PERSON_POST_EXCLUSIONS, X\.EXCLUSION_ID, exclusionId\)/.test(save));
  check('★★★★★ AuditLog old／new 兩邊都有',
    /oldValue: describeFields_\(found\.record, FIELDS\)/.test(save)
    && /newValue: describeFields_\(newValues, FIELDS\)/.test(save));
  check('★★★★ 新增亦寫 AuditLog', /action: 'EXCLUSION_ADD'/.test(add));
  check('★★★★★ 前端每個寫入前面都有確認畫面',
    (zone3.match(/openConfirm\(\{[\s\S]{0,600}?callServerMutating\('apiAddExclusion'/g) || []).length === 1
    && (zone3.match(/openConfirm\(\{[\s\S]{0,900}?callServerMutating\('apiSaveExclusion'/g) || []).length === 1
    && (zone3.match(/openConfirm\(\{[\s\S]{0,600}?callServerMutating\('apiLiftExclusion'/g) || []).length === 1);
}

console.log('\n=== D 「取消啟用」同「解除」要講到分別 ===');
{
  check('★★★★★ 修改畫面嘅「啟用」勾選框寫明佢唔等於解除',
    zone3.indexOf('只是解除的話請用「解除限制」') !== -1);
  check('★★★★★ 而且真係取消啟用嗰陣會再警告一次'
    + '——連過去嘅季度都會變成「當時本來可以排他」',
    zone3.indexOf('連過去的季度也會變成') !== -1);
}

console.log('\n=== D 呼叫層：讀寫分流 ===');
{
  const listMatch = common.match(/const READ_ONLY_APIS = \[([\s\S]*?)\];/);
  const readOnly = (listMatch[1].match(/'([A-Za-z0-9_]+)'/g) || []).map((s) => s.replace(/'/g, ''));
  check('★★★★ apiListExclusions 喺唯讀白名單',
    readOnly.indexOf('apiListExclusions') !== -1);
  ['apiSaveExclusion', 'apiAddExclusion', 'apiLiftExclusion'].forEach((n) => {
    check('★★★★★ ' + n + ' 唔喺白名單，而且用 callServerMutating()',
      readOnly.indexOf(n) === -1 && zone3.indexOf("callServerMutating('" + n + "'") !== -1);
  });
}

console.log('\n=== D 區三頁尾嗰句「下一輪會搬上來」要拆走 ===');
{
  check('★★★★ 區三有「暫時不做某崗位」呢粒掣',
    /button\('暫時不做某崗位', \(\) => openExclusions\(\), ''\)/.test(zone3));
  check('★★★★★ 而且冇咗「下一輪／下一個階段會搬上來」嗰句'
    + '——兩個畫面都做完咗，留住嗰句會令幹事去選單搵一個已經喺呢度嘅功能',
    !/下一輪會搬上來/.test(zone3) && !/下一個階段會搬上來/.test(zone3));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);

// 第二十七輪批次階段 E：從出席系統（HWCAS）補電郵——Web 版。
// 執行方式：node tests/hwcas_web_apply.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 呢個功能最危險嘅地方
// ─────────────────────────────────────────────────────────────────────
//
// HWCAS 係一個唯讀外部來源，配對靠姓名。配對錯咗嘅後果係
// **把甲嘅電郵寫入乙嘅資料**——之後乙收到甲嘅職事表，甲永遠收唔到。
// 而畫面上完全睇唔出：兩個人都有電郵，職事表照樣印住兩個名。
//
// ⚠️ 名單入面真係有幾位姓名只差最尾一個同音字嘅弟兄姊妹。
//（呢度特登唔舉真實例子——名單係真人資料，而呢個 repo 係公開嘅。）
// 佢哋係唔同嘅人，**絕對唔可以自動合併**。
//
// 所以本份測試最重嘅斷言全部圍繞：預設唔勾、唔可以整批套用、
// 對 HWCAS 一律唯讀、後端唔信前端傳嚟嘅值。

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
const backend = read('src/WebAppHwcas.gs');
const zone3 = read('src/ui/ScriptZone3.html');
const common = read('src/ui/Script.html');

function bodyOf(src, fnName) {
  const start = src.indexOf('function ' + fnName + '(');
  if (start === -1) return '';
  const rest = src.slice(start);
  const end = rest.indexOf('\n}\n');
  return end === -1 ? rest : rest.slice(0, end + 3);
}

console.log('\n=== E【核心】對 HWCAS 一律唯讀 ===');
{
  check('★★★★★ 全檔冇任何 openById 之外嘅 HWCAS 存取，亦冇任何寫入呼叫',
    !/setValue|setValues|appendRow|deleteRow|insertSheet/.test(
      backend.replace(/writeRowFields_[^\n]*/g, '')),
    '（writeRowFields_ 寫嘅係本試算表嘅 NameMapping，唔係 HWCAS）');
  check('★★★★★ 讀取完全重用 readHwcasMembers_()（佢只讀 Config 列明嘅欄）'
    + '——自己再寫一次讀取就可能讀到唔應該讀嘅欄（例如密碼欄）',
    /readHwcasMembers_\(config\)/.test(backend));
  check('★★★★★ 配對亦重用 buildHwcasDraft_()，唔另寫一份'
    + '——兩份配對邏輯就會有一日一邊認得、一邊認唔得',
    /buildHwcasDraft_\(source\.records, fieldColumns, source\.headers\)/.test(backend));
}

console.log('\n=== E【核心】預覽係唯讀，唔會寫 NameMapping_Draft ===');
{
  const preview = bodyOf(backend, 'apiHwcasPreview');
  check('★★★★★ 預覽唔會叫 writeHwcasDraftSheet_()'
    + '——「我只係想睇下」唔應該靜靜改咗試算表，'
    + '而且會同選單版嗰張表互相覆蓋',
    !/writeHwcasDraftSheet_/.test(preview));
  check('★★★★★ 預覽完全冇寫入',
    !/writeRowFields_|appendRowFields_|writeZone3Audit_/.test(preview));
}

console.log('\n=== E【核心】預設全部唔勾 ===');
{
  check('★★★★★ 前端 checkbox 明確設成 false（而且有註解講點解）'
    + '——呢一行係整個畫面最重要嘅一行',
    /cb\.checked = false;/.test(zone3));
  check('★★★★★ 冇「全部勾選」之類嘅捷徑'
    + '——有咗嗰粒掣，「逐個睇過」就會變成「撳一下」',
    !/全部勾選|全選/.test(zone3));
  check('★★★★ 畫面明講預設唔勾同原因',
    zone3.indexOf('所以這裡預設全部不勾。請逐個看過再勾。') !== -1);
  check('★★★★★ 而且講得出配對錯嘅實際後果',
    zone3.indexOf('對錯了就會把甲的電郵寫進乙的資料') !== -1);
}

console.log('\n=== E【核心】名字相似但唔同人：紅色警告，而且唔可以勾 ===');
{
  const row = bodyOf(backend, 'buildHwcasPreviewRow_');
  check('★★★★★ 同名多人（AMBIGUOUS）⇒ riskLevel HIGH',
    /HWCAS_MATCH\.AMBIGUOUS\)?\s*\{[\s\S]{0,200}?riskLevel = 'HIGH'/.test(row));
  check('★★★★★ 而且訊息明講「名字相似不代表是同一個人」',
    row.indexOf('名字相似不代表是同一個人') !== -1);
  check('★★★★★ 同名多人**唔可以套用**（連勾都唔畀勾）',
    /canApply: matchedOk && !!d\.personId/.test(row)
    && /const matchedOk = d\.matchType === HWCAS_MATCH\.EXACT \|\| d\.matchType === HWCAS_MATCH\.ALIAS;/.test(row));
  check('★★★★★ 認唔出（NONE）亦係 HIGH，亦唔可以套用',
    /HWCAS_MATCH\.NONE\)?\s*\{[\s\S]{0,160}?riskLevel = 'HIGH'/.test(row));
  check('★★★★★ 會蓋掉一個唔同嘅現有電郵 ⇒ 亦係 HIGH'
    + '——蓋掉之後，本來收到信嗰位就會停止收到，而冇任何訊號',
    /existingEmail && hwcasEmail && !sameEmail\) \{[\s\S]{0,160}?riskLevel = 'HIGH'/.test(row));
  check('★★★★ 靠別名對上嘅會提一提（兩邊寫法唔同）',
    row.indexOf('是靠「別名」對上的') !== -1);
  check('★★★★★ 風險分級喺後端做，前端只負責畫紅色'
    + '——判斷邏輯留喺一處，將來加多一種風險唔使兩邊改',
    /r\.riskLevel === 'HIGH'/.test(zone3) && !/matchType === 'AMBIGUOUS'/.test(zone3));
}

console.log('\n=== E【核心】套用：後端唔信前端傳嚟嘅值 ===');
{
  const apply = bodyOf(backend, 'apiHwcasApplySelected');
  check('★★★★★ 前端只傳 personId 清單，電郵由後端重新讀一次 HWCAS'
    + '——信前端傳嘅電郵，就等於畫面顯示一個、寫入另一個都冇人發現',
    /const preview = apiHwcasPreview\(\);/.test(apply)
    && /updates\[C\.EMAIL\] = t\.hwcasEmail;/.test(apply));
  check('★★★★★ 每一行都再驗一次 canApply'
    + '——前端嗰份預覽可能係幾分鐘前攞嘅，期間 HWCAS 或者名單都可能改過',
    /if \(!r\.canApply\) \{/.test(apply));
  check('★★★★★ 一行都冇勾就拒絕（唔會變成「整批套用」）',
    /Object\.keys\(wanted\)\.length === 0/.test(apply));
  check('★★★★★ 用 PersonID 重新搵列號，唔用列號',
    /findRowById_\(SHEETS\.NAME_MAPPING, C\.PERSON_ID, t\.personId\)/.test(apply));
  check('★★★★★ 略過嘅一定要報返出嚟'
    + '——「勾咗 10 個，寫咗 7 個，冇人知」係最差嘅結果',
    /skipped\.push\(/.test(apply) && /skipped: skipped/.test(apply)
    && /res\.skipped\.length > 0/.test(zone3));
}

console.log('\n=== E 寫入內容：只碰該碰嘅欄 ===');
{
  const apply = bodyOf(backend, 'apiHwcasApplySelected');
  check('★★★★★ 用 writeRowFields_（只改該行該欄，唔整行覆寫）',
    /writeRowFields_\(opened\.sheet, opened\.headers, found\.sheetRow, updates\)/.test(apply));
  check('★★★★★ EmailSource 寫 HWCAS、EmailVerifiedAt 寫今日（規格 4.2）',
    /updates\[C\.EMAIL_SOURCE\] = EMAIL_SOURCE_HWCAS;/.test(apply)
    && /updates\[C\.EMAIL_VERIFIED_AT\] = today;/.test(apply));
  check('★★★★★ 會眾編號**只喺真係有值嗰陣先寫**'
    + '——空白覆蓋落去就係用一個「冇資料」洗走一個真實資料',
    /if \(t\.memberNo\) updates\[C\.MEMBER_NO\]/.test(apply));
  check('★★★★ 而且經 normalizeMemberNo_()（保住開頭嘅 0）',
    /normalizeMemberNo_\(t\.memberNo\)/.test(apply));
  check('★★★★★ 逐行寫 AuditLog，而且記得低「由邊個名對上」',
    /action: 'HWCAS_EMAIL_APPLY'/.test(apply)
    && /由出席系統「/.test(apply));
}

console.log('\n=== E Config 未設定時要講人話 ===');
{
  const preview = bodyOf(backend, 'apiHwcasPreview');
  check('★★★★★ 用規格指定嗰句文案',
    backend.indexOf('還沒有設定出席系統的試算表位置。請先在 Config 填 HWCAS_SPREADSHEET_ID。') !== -1);
  check('★★★★★ 而且係一個獨立旗標（notConfigured），前端唔使靠字串比對'
    + '——靠字串比對就會喺改文案嗰日靜靜壞咗',
    /notConfigured: true/.test(preview) && /hwcasData\.notConfigured/.test(zone3));
  check('★★★★ 讀取失敗（權限／ID 錯）用三段式訊息，唔係原始 exception',
    /buildThreePartMessage_\([\s\S]{0,120}?讀不到出席系統的資料/.test(preview));
}

console.log('\n=== E 冇嘢可以補嗰啲唔應該佔住畫面 ===');
{
  const preview = bodyOf(backend, 'apiHwcasPreview');
  check('★★★★ MISSING_IN_HWCAS（名單有、HWCAS 冇）唔會列出'
    + '——每多一行冇用嘅行，就多一分睇漏真正要睇嗰行嘅機會',
    /d\.matchType !== HWCAS_MATCH\.MISSING_IN_HWCAS/.test(preview));
  check('★★★★ 但「冇改動」嗰啲仍然數得到（counts.noChange）',
    /noChange: rows\.filter/.test(preview));
}

console.log('\n=== E 確認畫面 ===');
{
  check('★★★★★ 套用前有確認畫面，而且逐行列出「舊 → 新」',
    /openConfirm\(\{[\s\S]{0,900}?callServerMutating\('apiHwcasApplySelected'/.test(zone3)
    && /\(r\.existingEmail \|\| '（空白）'\) \+ ' → ' \+ r\.hwcasEmail/.test(zone3));
  check('★★★★ 有「不會做的事」，而且明講唔會改動出席系統',
    zone3.indexOf('不會改動出席系統（那邊一律唯讀）') !== -1);
}

console.log('\n=== E 呼叫層同入口 ===');
{
  const listMatch = common.match(/const READ_ONLY_APIS = \[([\s\S]*?)\];/);
  const readOnly = (listMatch[1].match(/'([A-Za-z0-9_]+)'/g) || []).map((s) => s.replace(/'/g, ''));
  check('★★★★ apiHwcasPreview 喺唯讀白名單', readOnly.indexOf('apiHwcasPreview') !== -1);
  check('★★★★★ apiHwcasApplySelected 唔喺白名單，而且用 callServerMutating()',
    readOnly.indexOf('apiHwcasApplySelected') === -1
    && zone3.indexOf("callServerMutating('apiHwcasApplySelected'") !== -1);
  check('★★★★ 「人員與電郵」畫面有呢粒掣',
    /button\('從出席系統補電郵', \(\) => openHwcas\(\), 'secondary'\)/.test(zone3));
  check('★★★★★ 而且「暫時請用選單」嗰句已經拆走',
    !/「從出席系統補電郵」暫時請用試算表上方的選單/.test(zone3));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);

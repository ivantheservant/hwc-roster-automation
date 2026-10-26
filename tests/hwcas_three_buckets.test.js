// 第二十八輪批次階段 D：HWCAS 差異畫面三分類。
// 執行方式：node tests/hwcas_three_buckets.test.js
//
// ─────────────────────────────────────────────────────────────────────
// Ivan 實測
// ─────────────────────────────────────────────────────────────────────
//
//   共 513 行　可以套用 2 行　需要特別小心 434 行　沒有改動 79 行
//
// 出席系統有 513 位會友，職事表名單只有 89 位。
// 「需要特別小心」嗰 434 行入面，真正要處理嘅大概八行
// （名單上真係有呢個名，但系統分唔清係邊一位），
// 其餘四百幾行係「出席系統有呢個人，但佢根本唔喺職事表名單」。
//
// **幹事要碌 513 行先搵到嗰 2 行有用嘅。**
//
// ⚠️ 呢個唔係「顯示得靚啲」：一個要逐行睇嘅畫面，每多一行唔關事嘅行，
// 就多一分睇漏真正要睇嗰行嘅機會，而睇漏嘅後果係把甲嘅電郵寫入乙嘅資料。
//
// 所以核心係一條界線：
//   `AMBIGUOUS` ＝ 名單上有呢個名 ⇒ **要人手決定**
//   `NONE`      ＝ 名單上根本冇呢個名 ⇒ **同排職事表無關**
// 上一輪兩者都當成「需要特別小心」，所以第二類被第三類淹沒。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs', 'WebAppGuards.gs',
  'HwcasSync.gs', 'HwcasApply.gs', 'WebAppHwcas.gs'
]);

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

/**
 * 剝走註解再檢查。
 * ⚠️ 唔剝嘅話，**解釋「唔可以再寫成咩」嘅註解本身就含住嗰個寫法**，
 * 而唯一嘅「修法」就係把註解寫得含糊。本專案已經撞過幾次。
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
const zone3Code = stripComments(zone3);

// ⚠️ 假 PersonID 一律 P9xxx，假名一律明顯係假。
const M = gas.HWCAS_MATCH;
const B = gas.HWCAS_BUCKET;
const nameIndex = { P9001: '測試甲', P9002: '測試乙', P9003: '測試丙' };
const row = (d) => gas.buildHwcasPreviewRow_(d, nameIndex);

console.log('\n=== D1【核心】NONE 同 AMBIGUOUS 唔可以歸埋一類 ===');
{
  const ambiguous = row({
    matchType: M.AMBIGUOUS, personId: '', nameTC: '', hwcasName: '測試乙',
    hwcasEmail: 'x@example.invalid', existingEmail: ''
  });
  check('★★★★★ AMBIGUOUS ⇒ 第二類「要你處理」'
    + '——名單上真係有呢個名，只係唔知邊一位',
    ambiguous.bucket === B.NEEDS_ACTION, ambiguous.bucket);

  const none = row({
    matchType: M.NONE, personId: '', nameTC: '', hwcasName: '測試丁',
    hwcasEmail: 'y@example.invalid', existingEmail: ''
  });
  check('★★★★★ NONE ⇒ 第三類「跟職事表無關」'
    + '——名單根本冇呢個名，佢唔會被排職事',
    none.bucket === B.NOT_RELEVANT, none.bucket);

  check('★★★★★ 而且兩者係唔同嘅 bucket（呢個就係整個階段 D）',
    ambiguous.bucket !== none.bucket);
  check('★★★★ 兩者都仍然係 HIGH 風險、都仍然唔可以勾'
    + '——分類係為咗排版，唔係為咗放寬',
    ambiguous.riskLevel === 'HIGH' && none.riskLevel === 'HIGH'
    && ambiguous.canApply === false && none.canApply === false);
}

console.log('\n=== D1 第一類同第四類 ===');
{
  const apply = row({
    matchType: M.EXACT, personId: 'P9001', nameTC: '測試甲', hwcasName: '測試甲',
    hwcasEmail: 'a@example.invalid', existingEmail: ''
  });
  check('★★★★★ 對得上、HWCAS 有電郵、真係有改動 ⇒ 第一類「可以套用」',
    apply.bucket === B.APPLY && apply.canApply === true, apply.bucket);

  const same = row({
    matchType: M.EXACT, personId: 'P9001', nameTC: '測試甲', hwcasName: '測試甲',
    hwcasEmail: 'a@example.invalid', existingEmail: 'A@Example.Invalid'
  });
  check('★★★★★ 電郵一樣（大小寫唔同都算一樣）⇒ 第四類「沒有改動」',
    same.bucket === B.NO_CHANGE, same.bucket);

  const noSourceEmail = row({
    matchType: M.EXACT, personId: 'P9002', nameTC: '測試乙', hwcasName: '測試乙',
    hwcasEmail: '', existingEmail: 'b@example.invalid'
  });
  check('★★★★★ 出席系統嗰邊冇電郵 ⇒ 第四類（冇嘢可以補，唔係「要你處理」）',
    noSourceEmail.bucket === B.NO_CHANGE, noSourceEmail.bucket);

  const overwrite = row({
    matchType: M.EXACT, personId: 'P9003', nameTC: '測試丙', hwcasName: '測試丙',
    hwcasEmail: 'new@example.invalid', existingEmail: 'old@example.invalid'
  });
  check('★★★★★ 會蓋掉現有電郵嘅仍然算「可以套用」，但要紅色警告'
    + '——分類唔可以把「會蓋掉」呢件事收起',
    overwrite.bucket === B.APPLY && overwrite.riskLevel === 'HIGH'
    && overwrite.warnings.join('').indexOf('蓋掉') !== -1);

  const alias = row({
    matchType: M.ALIAS, personId: 'P9001', nameTC: '測試甲', hwcasName: '測試甲甲',
    hwcasEmail: 'c@example.invalid', existingEmail: ''
  });
  check('★★★★ 靠別名對上嘅算「可以套用」，但保留「請確認真的是同一位」',
    alias.bucket === B.APPLY
    && alias.warnings.join('').indexOf('別名') !== -1);
}

console.log('\n=== D1 分類每一行都要有一個 bucket（唔可以有 undefined）===');
{
  const all = [M.EXACT, M.ALIAS, M.AMBIGUOUS, M.NONE].map(function (mt) {
    return row({
      matchType: mt, personId: mt === M.EXACT || mt === M.ALIAS ? 'P9001' : '',
      nameTC: '', hwcasName: '測試甲', hwcasEmail: 'z@example.invalid',
      existingEmail: ''
    }).bucket;
  });
  const known = [B.APPLY, B.NEEDS_ACTION, B.NOT_RELEVANT, B.NO_CHANGE];
  check('★★★★★ 四種配對結果全部落到已知嘅四類'
    + '——一個 undefined 嘅 bucket 會令嗰行喺畫面上完全消失',
    all.every(function (b) { return known.indexOf(b) !== -1; }), all.join(','));
}

console.log('\n=== D2 計數：唔可以再有「需要特別小心 434」呢個數 ===');
{
  check('★★★★★ 後端 counts 分開四個 bucket 數',
    /canApply: rows\.filter/.test(backend)
    && /needsAction: rows\.filter/.test(backend)
    && /notRelevant: rows\.filter/.test(backend)
    && /noChange: rows\.filter/.test(backend));
  check('★★★★★ 而且係數 `r.bucket`，唔係前端／後端各自再判斷一次',
    (backend.match(/r\.bucket === HWCAS_BUCKET\./g) || []).length === 4);
  check('★★★★★ 「名單有、出席系統冇」嗰批照舊唔列出，但**要出個數**'
    + '——靜靜掉咗會令幹事以為系統漏咗人',
    /notInHwcas: draft\.filter/.test(backend));
  check('★★★★★ 畫面冇咗「需要特別小心」呢個籠統講法',
    zone3Code.indexOf('需要特別小心') === -1);
}

console.log('\n=== D3／D4 畫面（第七十七輪批次 EG 組：「從出席系統補電郵」已由「出席系統連結」取代）===');
{
  // 方法 A：電郵按會眾編號自動讀取；呢個畫面只負責「邊個仲未連結」，四段：
  check('★★★★★ 四段標題', zone3.indexOf("'一、沒有會眾編號的人（'") !== -1 && zone3.indexOf("'二、出席系統找不到編號的人（'") !== -1
    && zone3.indexOf("'三、重複編號（'") !== -1 && zone3.indexOf("'四、出席系統沒有電郵的人（'") !== -1);
  check('★★★★★ 候選人嘅 checkbox **預設不勾**（讀返 hwcasLinkPicked，唔係寫死 true）',
    /cb\.checked = hwcasLinkPicked\[p\.personId\] === c\.memberNo;/.test(zone3) && !/cb\.checked = true;/.test(zone3Code.slice(zone3Code.indexOf('function renderHwcasLink'), zone3Code.indexOf('function confirmHwcasLink'))));
  check('★★★★★ 「出席系統是靠姓名對人的…預設全部不勾」嗰段警告仍然喺畫面',
    zone3.indexOf('出席系統是靠姓名對人的，對錯了就會寄錯人') !== -1 && zone3.indexOf('所以預設全部不勾，請逐個看過才勾') !== -1);
  check('★★★★★ 同名多人嗰句「名字相似不代表是同一個人——不要靠猜」照舊（後端）',
    backend.indexOf('名字相似不代表是同一個人——不要靠猜。') !== -1);
  check('★★★★ 一個編號已經係名單上另一位嘅 ⇒ 勾唔到而且講明', /cb\.disabled = !!c\.usedBy;/.test(zone3) && zone3.indexOf('這個編號已經是名單上「') !== -1);
  check('★★★★ 重新讀資料嗰陣清空勾選', /hwcasLinkPicked = \{\};[\s\S]{0,80}?renderHwcasLink\(\)/.test(zone3));
}

console.log('\n=== D5 套用嘅關卡完全冇放寬 ===');
{
  check('★★★★★ 套用時仍然重新叫 apiHwcasPreview() 再驗一次 canApply',
    /const preview = apiHwcasPreview\(\);/.test(backend)
    && /if \(!r\.canApply\) \{/.test(backend));
  check('★★★★★ 而 canApply 仍然要求對得上人（EXACT／ALIAS）＋有 PersonID',
    /const canApply = matchedOk && !!d\.personId && hwcasEmail !== '' && !sameEmail;/
      .test(backend));
  check('★★★★★ 第二、三、四段根本冇 checkbox（只有第一段嘅候選人先有）',
    (zone3Code.slice(zone3Code.indexOf('function renderHwcasLink'), zone3Code.indexOf('function confirmHwcasLink')).match(/createElement\('input'\)/g) || []).length === 1);
  check('★★★★ 一行都冇勾嗰陣唔會靜靜咩都唔做，會講返點解',
    backend.indexOf('一行都沒有勾。') !== -1);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);

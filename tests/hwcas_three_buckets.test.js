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
    /notInHwcas: draft\.filter/.test(backend)
    && zone3.indexOf('位在出席系統找不到') !== -1);
  check('★★★★★ 畫面冇咗「需要特別小心」呢個籠統講法',
    zone3Code.indexOf('需要特別小心') === -1);
}

console.log('\n=== D3 畫面：三段標題＋第三段預設摺埋 ===');
{
  check('★★★★★ 前端一律讀後端嘅 `bucket`，**唔自己 filter riskLevel**',
    /r\.bucket === name/.test(zone3)
    && !/rows\.filter\(\(r\) => r\.canApply\)/.test(zone3Code)
    && !/riskLevel === 'HIGH'\)/.test(zone3Code.replace(/r\.riskLevel === 'HIGH'\) \{/g, '')));

  check('★★★★★ 第一段「可以套用」', zone3.indexOf("'一、可以套用（'") !== -1);
  check('★★★★★ 第二段「要你處理」，而且講明點解（名單上有，只係分唔出邊一位）',
    zone3.indexOf("'二、要你處理（'") !== -1
    && zone3.indexOf('名單上有這個人，但系統分不出是哪一位') !== -1);
  check('★★★★★ 第三段「跟職事表無關」', zone3.indexOf("'三、跟職事表無關'") !== -1);

  check('★★★★★ 第三段摺埋嗰句逐字講清楚有幾多位、去咗邊'
    + '——淨係唔見咗四百幾行，幹事會以為系統食咗佢哋',
    /'出席系統另有 ' \+ notRelevant\.length \+ ' 位不在職事表名單，已收起'/.test(zone3));
  check('★★★★★ 兩段摺埋嘅預設值都係 false（＝預設摺埋）',
    /hwcasExpanded = \{ notRelevant: false, noChange: false \}/.test(zone3));
  check('★★★★ 而且重新讀資料嗰陣會 reset'
    + '——唔 reset 嘅話畫面記住上次展開咗，但入面啲行已經換咗',
    (zone3.match(/hwcasExpanded = \{ notRelevant: false, noChange: false \}/g) || []).length >= 2);
  check('★★★★ 摺埋嗰陣唔會起晒四百幾個節點（展開先至叫 buildRows）',
    /if \(open\) buildRows\(\)\.forEach/.test(zone3));
}

console.log('\n=== D3 展開／收起唔可以靜靜清走幹事勾咗嘅行 ===');
{
  check('★★★★★ checkbox 讀返 `hwcasChecked`，唔係寫死 false'
    + '——寫死嘅話撳一下「展開看看」就會清走啲勾，而且冇任何提示',
    /cb\.checked = !!hwcasChecked\[r\.personId\]/.test(zone3)
    && !/cb\.checked = false;/.test(zone3Code));
  check('★★★★★ 而 `hwcasChecked` 只喺開畫面嗰陣清空（＝預設唔勾仍然成立）',
    /hwcasChecked = \{\};[\s\S]{0,120}?renderHwcas\(\)/.test(zone3));
}

console.log('\n=== D4 逐字保留嗰段警告（寫得啱，唔好郁）===');
{
  // ⚠️ 原文喺 `.html` 入面係跨行接駁嘅，所以逐半句對——
  // 一次過對成句會因為換行而失敗，而唔係因為文字改咗。
  check('★★★★★ 「出席系統是靠姓名對人的…」原文一字不改',
    zone3.indexOf('出席系統是靠姓名對人的。對錯了就會把甲的電郵寫進乙的資料，') !== -1
    && zone3.indexOf('之後乙收到甲的職事表，而甲永遠收不到。') !== -1);
  check('★★★★★ 「所以這裡預設全部不勾。請逐個看過再勾。」照舊',
    zone3.indexOf('所以這裡預設全部不勾。請逐個看過再勾。') !== -1);
  check('★★★★★ 同名多人嗰句「名字相似不代表是同一個人——不要靠猜」照舊'
    + '——分類之後呢句更加重要，因為第二類而家獨立成段',
    backend.indexOf('名字相似不代表是同一個人——不要靠猜。') !== -1);
}

console.log('\n=== D5 套用嘅關卡完全冇放寬 ===');
{
  check('★★★★★ 套用時仍然重新叫 apiHwcasPreview() 再驗一次 canApply',
    /const preview = apiHwcasPreview\(\);/.test(backend)
    && /if \(!r\.canApply\) \{/.test(backend));
  check('★★★★★ 而 canApply 仍然要求對得上人（EXACT／ALIAS）＋有 PersonID',
    /const canApply = matchedOk && !!d\.personId && hwcasEmail !== '' && !sameEmail;/
      .test(backend));
  check('★★★★★ 第二、三類根本冇 checkbox（`hwcasRow(r, false)`）',
    /needsAction\.forEach\(\(r\) => box\.appendChild\(hwcasRow\(r, false\)\)\)/.test(zone3));
  check('★★★★ 一行都冇勾嗰陣唔會靜靜咩都唔做，會講返點解',
    backend.indexOf('一行都沒有勾。') !== -1);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);

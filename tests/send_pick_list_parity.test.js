// 第四十四輪批次 B 組：「寄出 ▸ 寄給誰 ▸ 自己選擇」嗰個名單。
// 執行方式：node tests/send_pick_list_parity.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 點解要有呢一份
// ═════════════════════════════════════════════════════════════════════
//
// Ivan 一連三輪講同一句：「自己選擇寄給誰嗰個名單**未做**」。
// 而查落程式碼一直都喺度——「處理紙本」同「寄出」用緊**同一個**
// `pickListNodes()` 元件，連搜尋框都係同一份。
//
// 真正嘅成因係：**兩個名單裝住唔同嘅人。**
//
//   ・處理紙本　　　　這一季有服侍嘅義工（幾十位，有名、有格數）
//   ・寄出（REVIEW）　`EmailRecipients` 嗰幾個堂委地址（冇名、冇格數）
//
// 佢喺 REVIEW 撳開，見到三行電郵地址，同紙本嗰幾十行完全唔似樣——
// 除咗當成「未做」之外冇第二個結論好落。**畫面一句都冇解釋過。**
//
// 所以呢一份守兩件事：
//   一、`listNote`——每一次撳開都要講明「呢一次個名單入面係邊啲人」。
//   二、冇電郵嘅人**勾唔到**，而唔係勾得到但係靜靜收唔到信。
//
// ⚠️ 第二件事唔可以淨係喺後面加句字。加咗字而仲勾得到，幹事會勾咗、
// 見到「已選 12 位」，然後以為 12 個人都會收到——而系統會靜靜略過
// 冇電郵嗰幾個。呢個專案由第一輪殺到而家嘅就係「靜靜略過」。

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 400));
}

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sendPaperUi = read('src/ui/ScriptSendPaper.html');
const sharedUi = read('src/ui/Script.html');

const gas = loadGasSource([
  'Constants.gs', 'Utils.gs', 'SheetReader.gs',
  'Roles.gs', 'WebAppGuards.gs', 'SendOptions.gs', 'WebAppSendPlan.gs'
]);

// =====================================================================
console.log('\n=== B【核心】冇電郵嘅人 ⇒ `selectable: false`（勾唔到）===');
{
  // 用真正嘅 `listSendCandidates_()`，只換走佢讀試算表嗰幾個入口。
  gas.findLatestVersionNo = function () { return 3; };
  gas.getConfig = function (_k, d) { return d; };
  gas.readRolesSafe_ = function () {
    return [{ personId: 'P9001', roleCode: 'COUNCIL',
      effectiveFrom: '', effectiveTo: '' }];
  };
  gas.Utilities = { formatDate: function () { return '2027-10-01'; } };
  gas.buildMailContext_ = function () {
    return {
      assignmentsByPerson: { P9001: [{}, {}, {}], P9002: [{}] },
      peopleById: {
        P9001: { nameTC: '測試甲', email: 'a@example.invalid' },
        // ⚠️ 呢一位**冇電郵**——佢就係整份測試嘅主角。
        P9002: { nameTC: '測試乙', email: '' }
      },
      lastHashByPerson: {}
    };
  };
  gas.listRecipients_ = function (stage) {
    const rows = [{ type: gas.RECIPIENT_TYPE.LIST, personId: '',
      email: 'council@example.invalid', displayName: '堂委名單' }];
    if (stage === gas.MAIL_STAGES.OFFICIAL || stage === gas.MAIL_STAGES.RESEND) {
      rows.push({ type: gas.RECIPIENT_TYPE.PERSON, personId: 'P9001',
        email: 'a@example.invalid', displayName: '測試甲' });
      rows.push({ type: gas.RECIPIENT_TYPE.PERSON, personId: 'P9002',
        email: '', displayName: '測試乙' });
    }
    return rows;
  };

  const rows = gas.listSendCandidates_('2027T3', gas.SEND_KIND.OFFICIAL);
  const byName = {};
  rows.forEach(function (r) { byName[r.displayName] = r; });

  check('★★★★★ 有電郵嘅勾得到',
    byName['測試甲'] && byName['測試甲'].selectable === true,
    JSON.stringify(rows));
  check('★★★★★ **冇電郵嘅 `selectable === false`**'
    + '——唔係淨係 `hasEmail: false` 加句字；勾得到就會有人以為佢收到咗',
    byName['測試乙'] && byName['測試乙'].selectable === false,
    JSON.stringify(byName['測試乙']));
  check('★★★★ 冇電郵嘅照樣列出嚟（唔可以靜靜唔見咗——'
    + '佢唔係「唔使服侍」，係要印紙本畀佢）',
    !!byName['測試乙']);
  check('★★★★ 格數照樣讀得到（測試甲三格）',
    byName['測試甲'] && byName['測試甲'].cellCount === 3);
  check('★★★★ 堂委名單嗰行冇 PersonID 都要勾得到',
    byName['堂委名單'] && byName['堂委名單'].selectable === true);
}

// =====================================================================
console.log('\n=== B【核心】每一次撳開都講明「呢個名單入面係邊啲人」===');
{
  const review = gas.describeSendCandidateList_(gas.SEND_KIND.REVIEW, 3);
  const official = gas.describeSendCandidateList_(gas.SEND_KIND.OFFICIAL, 42);
  const resend = gas.describeSendCandidateList_(gas.SEND_KIND.RESEND, 5);

  check('★★★★★ REVIEW 明講「係堂委，唔係義工」'
    + '——Ivan 三次以為呢個功能未做，就係因為呢一句一直冇講',
    review.indexOf('堂委') !== -1 && review.indexOf('不是義工') !== -1, review);
  check('★★★★★ REVIEW 明講「義工這一次一封都不會收到」'
    + '——唔講嘅話，幹事會以為自己漏咗揀人',
    review.indexOf('義工這一次一封都不會收到') !== -1, review);
  check('★★★★ REVIEW 講得出人數', review.indexOf('3') !== -1, review);
  check('★★★★★ 正式寄出講明係義工加收件人名單',
    official.indexOf('義工') !== -1 && official.indexOf('42') !== -1, official);
  // ⚠️ 呢一句本來寫「名單上是這一季安排有改動的那幾位」，而
  // `listRecipients_()` 嘅 RESEND 分支收嘅係「有派工嘅」**加上**
  //「曾經收過信嘅」——後者包括今次完全冇改動嘅人。
  //「畫面講一件事、系統做另一件事」正正係呢個專案一直喺度殺嗰一類。
  check('★★★★★ 重發嗰句要同 `listRecipients_()` 真正做嘅事對得上'
    + '——唔可以講「有改動嗰幾位」，因為冇改動嘅人一樣喺個名單入面',
    resend.indexOf('曾經收過信') !== -1
    && resend.indexOf('就算這一次沒有改動') !== -1, resend);
  check('★★★★ 而且講明「真正收到嘅仲要睇你揀嘅寄給誰」'
    + '——呢個名單係階段名單，唔係最終收件人',
    resend.indexOf('真正會收到信的還要看') !== -1, resend);
  check('★★★★★ 三個階段嘅句子唔一樣——一句通用嘅廢話等於冇講',
    review !== official && official !== resend && review !== resend);
}

// =====================================================================
console.log('\n=== B【核心】API 一定要連埋嗰一句回前端 ===');
{
  const src = read('src/WebAppSendPlan.gs');
  const body = src.slice(src.indexOf('function apiGetSendCandidates('));
  check('★★★★★ `apiGetSendCandidates()` 回 `{items, listNote}`',
    /listNote: describeSendCandidateList_\(kind, items\.length\)/.test(body),
    body.slice(0, 400));
  check('★★★★★ 前端讀返嗰一句（唔係喺前端自己計）'
    + '——後端先至知道呢一次係邊個階段；喺前端猜就一定會同真正寄嘅人唔同步',
    /sendCandidateNote_ = r\.listNote \|\| '';/.test(sendPaperUi));
  check('★★★★★ 而且真係畫咗出嚟', /text: sendCandidateNote_/.test(sendPaperUi));
  check('★★★★ 換季度／重開彈窗會清走舊嗰一句',
    /sendCandidateNote_ = '';/.test(sendPaperUi));
  check('★★★★★ 前端讀 `r.items`，唔係當個回傳值本身係陣列'
    + '——回傳形狀改咗，舊寫法會靜靜變成「一個人都冇」',
    /sendCandidates_ = r\.items \|\| \[\];/.test(sendPaperUi));
}

// =====================================================================
console.log('\n=== B【核心】`pickListNodes()` 真係勾唔到（行真正嗰份程式碼）===');
{
  // 由 `Script.html` 抽出真正嘅 `pickListNodes()` 嚟行——
  // 抄一份出嚟測只會證明副本冇問題。
  const start = sharedUi.indexOf('function pickListNodes(');
  check('★★★★★ 搵得返 `pickListNodes()`', start !== -1);
  const fnSrc = sharedUi.slice(start, sharedUi.indexOf('\n  }\n', start) + 4);

  const made = [];
  function fakeEl(tag) {
    const el = {
      tagName: tag, children: [], className: '', textContent: '',
      type: '', checked: false, disabled: false, value: '',
      style: {}, listeners: {},
      appendChild: function (c) { this.children.push(c); return c; },
      addEventListener: function (n, f) { this.listeners[n] = f; },
      setAttribute: function () {}, focus: function () {}
    };
    made.push(el);
    return el;
  }
  const sandbox = {
    document: { createElement: fakeEl },
    make: function (tag, opts, children) {
      const el = fakeEl(tag);
      if (opts) {
        if (opts.text) el.textContent = opts.text;
        if (opts.className) el.className = opts.className;
        if (opts.type) el.type = opts.type;
      }
      (children || []).forEach(function (c) { el.appendChild(c); });
      return el;
    },
    escapeHtml: function (s) { return String(s); },
    console: console
  };
  sandbox.para = function (t, c) { return sandbox.make('div', { text: t, className: c }); };
  sandbox.row = function (kids) { return sandbox.make('div', { className: 'row' }, kids); };
  sandbox.button = function (t) { return sandbox.make('button', { text: t }); };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fnSrc + '\nthis.pickListNodes = pickListNodes;',
    sandbox, { filename: 'pickListNodes.js' });

  const selected = { A: true, B: true };
  const opts = {
    items: [
      { key: 'A', label: '測試甲', note: '（這一季 3 格）', warn: '' },
      { key: 'B', label: '測試乙', note: '（這一季 1 格）',
        warn: '⚠ 沒有電郵，收不到信——要用第 4 步印紙本給他', disabled: true }
    ],
    selected: selected,
    onChange: function () {},
    onRedraw: function () {},
    onToggle: function () {}
  };
  sandbox.pickListNodes(opts);

  const boxes = made.filter(function (e) { return e.type === 'checkbox'; });
  check('★★★★★ 兩行都畫咗出嚟', boxes.length === 2, 'boxes=' + boxes.length);
  check('★★★★★ **冇電郵嗰個 checkbox 係 disabled**',
    boxes[1] && boxes[1].disabled === true);
  check('★★★★★ 而且**強制解除勾選**'
    + '——`selected` 入面本來係 true；淨係 disable 而唔清走，'
    + '個數字會照計佢，幹事會見到「已選 2 位」而實際只寄到 1 封',
    boxes[1] && boxes[1].checked === false && selected.B === false,
    JSON.stringify(selected));
  check('★★★★ 有電郵嗰個唔受影響（照勾、照撳得）',
    boxes[0] && boxes[0].disabled === false && boxes[0].checked === true
    && selected.A === true);
}

// =====================================================================
console.log('\n=== B 群組勾選（全部堂委／全部執事）唔可以勾中冇電郵嘅人 ===');
{
  check('★★★★★ 群組計成員嗰陣過濾走 `selectable === false`'
    + '——「☐ 全部堂委」勾落去如果連冇電郵嗰個都勾埋，'
    + '個數字就係假嘅，而幹事冇任何辦法睇得出',
    /\(c\.roles \|\| \[\]\)\.indexOf\(g\[0\]\) !== -1 && c\.selectable !== false/
      .test(sendPaperUi), '');
  check('★★★★★ 「全部選擇」一樣跳過 disabled'
    + '——一粒「全部選擇」如果連勾唔到嗰啲都勾埋，'
    + '前面逐行 disable 就白做咗',
    /items\.forEach\(\(it\) => \{ if \(!it\.disabled\) selected\[it\.key\] = true; \}\);/
      .test(sharedUi), '');
}

// =====================================================================
console.log('\n=== B 兩個彈窗用**同一份**元件（唔准有第二份）===');
{
  const paperUses = (sendPaperUi.match(/pickListNodes\(/g) || []).length;
  check('★★★★★ 「處理紙本」同「寄出」都係叫 `pickListNodes()`',
    paperUses >= 2, 'count=' + paperUses);
  const defsShared = (sharedUi.match(/function pickListNodes\(/g) || []).length;
  const defsPaper = (sendPaperUi.match(/function pickListNodes\(/g) || []).length;
  check('★★★★★ `pickListNodes()` 全個專案只定義一次'
    + '——第四十三輪批次 B 組定咗規矩：唔准寫第二份',
    defsShared === 1 && defsPaper === 0,
    'shared=' + defsShared + ' paper=' + defsPaper);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);

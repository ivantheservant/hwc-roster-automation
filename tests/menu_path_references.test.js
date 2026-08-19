// 第三十三輪批次階段 D2：訊息文字裡的「選單 ▸ X ▸ Y」一定要對得上 Menu.gs。
// 執行方式：node tests/menu_path_references.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 2026-08-20 實測揭出嘅事
// ═════════════════════════════════════════════════════════════════════
//
// Config 型別錯誤訊息最後一段寫住：
//
//     　4. 選單 ▸ 維護 ▸ 重新載入設定
//
// 但「重新載入設定（唯讀）」實際上喺「查看（唯讀，只寫 Diagnostics）」子選單，
// **唔喺維護**。幹事照住呢句去維護子選單搵，會搵唔到，
// 然後以為係自己做錯咗嘢——一句用嚟幫人嘅指示，變成一個新問題。
//
// 呢個係本專案 bug class 第 3 條：`Menu.gs` 係選單結構嘅唯一真相來源，
// 但訊息文字入面嘅路徑係手寫嘅第二份副本，改一邊唔會令另一邊出聲。
//
// ─────────────────────────────────────────────────────────────────────
// 範圍：只查「試算表選單」路徑，唔查其他 `▸` 用法
// ─────────────────────────────────────────────────────────────────────
//
// `▸` 喺呢個 codebase 有好幾種用法，唔全部都係試算表選單：
//
//   `格式 ▸ 數字 ▸ 純文字`　　　　Google 試算表自己嘅選單，唔喺 Menu.gs 管
//   `進階功能 ▸ 重新發佈公開連結`　幹事 Web UI 嘅分區，唔係試算表選單
//   `名單維護 ▸ 排表偏好`　　　　　同上
//   `季度 ▸ 版本`　　　　　　　　　純粹係一個層級標示，根本唔係選單
//   `個人值 ▸ 規則 ▸ Config 預設`　優先次序，唔係選單
//
// 所以呢條測試只認兩種明確係試算表選單嘅寫法：
//   1. 明文寫住「選單 ▸ …」
//   2. 第一段就係 Menu.gs 真正有嘅子選單名（維護／查看／測試工具／…）
//
// 假警報寧多勿漏，但**唔可以濫到連 Google 試算表自己嘅選單都報**
// ——嗰種噪音會令人索性唔理呢條測試，等於冇寫。

const fs = require('fs');
const path = require('path');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log(extra.split('\n').map(function (l) { return '      ' + l; }).join('\n'));
}

const SRC = path.join(__dirname, '..', 'src');

/* ══════════════════════════════════════════════════════════════
 * 由 Menu.gs 讀出真正嘅選單結構（唯一真相來源）
 * ══════════════════════════════════════════════════════════════ */

function parseMenuTree() {
  const text = fs.readFileSync(path.join(SRC, 'Menu.gs'), 'utf8');
  const subs = [];
  let cur = null;
  text.split('\n').forEach(function (line) {
    // 註解行唔算——註解入面提到嘅標籤唔係真正嘅選單登記。
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    let m = line.match(/ui\.createMenu\('([^']+)'\)/);
    if (m) {
      if (m[1] === '職事表系統') return;   // 最頂層，唔係子選單
      cur = { name: m[1], items: [] };
      subs.push(cur);
      return;
    }
    m = line.match(/\.addItem\('([^']+)'/);
    if (m && cur) cur.items.push(m[1]);
  });
  return subs;
}

const MENU = parseMenuTree();

/**
 * 正規化：拆走圖示、警告符號、括號、空白。
 * 訊息文字入面經常會省略「（唯讀）」「⚠️」呢類後綴／前綴，
 * 呢個係合理嘅寫法，唔應該報錯——所以比對之前兩邊都拆走。
 */
function norm(s) {
  return String(s)
    .replace(/[⚠️🩺▶️🔒✅❌]/g, '')
    .replace(/[（）()【】\[\]「」\s]/g, '')
    .trim();
}

const SUB_NAMES = MENU.map(function (s) { return s.name; });

console.log('\n=== 前置：Menu.gs 解析得出真正嘅選單樹 ===');
{
  check('★★★★★ 解析到至少 5 個子選單（解析器壞咗嘅話下面全部會變成假綠燈）',
    MENU.length >= 5, JSON.stringify(SUB_NAMES));
  check('★★★★ 每個子選單都至少有一項',
    MENU.every(function (s) { return s.items.length > 0; }),
    JSON.stringify(MENU.map(function (s) { return s.name + '=' + s.items.length; })));
  const total = MENU.reduce(function (n, s) { return n + s.items.length; }, 0);
  check('★★★★ 全部選單項合共至少 50 項', total >= 50, String(total));
}

/* ══════════════════════════════════════════════════════════════
 * 掃 src/ 全部字串裡面嘅選單路徑
 * ══════════════════════════════════════════════════════════════ */

function listSourceFiles() {
  const out = [];
  fs.readdirSync(SRC).forEach(function (f) {
    if (/\.gs$/.test(f)) out.push(path.join(SRC, f));
  });
  const uiDir = path.join(SRC, 'ui');
  if (fs.existsSync(uiDir)) {
    fs.readdirSync(uiDir).forEach(function (f) {
      if (/\.(html|gs)$/.test(f)) out.push(path.join(uiDir, f));
    });
  }
  return out;
}

function findSub(name) {
  const n = norm(name);
  if (!n) return null;
  let hit = MENU.find(function (s) { return norm(s.name) === n; });
  if (hit) return hit;
  // 容許省略後綴：訊息寫「查看」，實際係「查看（唯讀，只寫 Diagnostics）」
  hit = MENU.find(function (s) { return norm(s.name).indexOf(n) === 0; });
  return hit || null;
}

const problems = [];
listSourceFiles().forEach(function (file) {
  const text = fs.readFileSync(file, 'utf8');
  const rel = path.relative(path.join(__dirname, '..'), file).replace(/\\/g, '/');

  // ⚠️ 只查**會俾使用者見到嘅字串**，唔查註解。
  //
  // 兩個理由：
  //   1. 註解入面嘅路徑經常寫到跨行（`'測試工具 ▸ 寄送' + '（測試模式）'`
  //      喺註解入面就會斷成兩行），逐行掃一定誤報。
  //   2. 呢條測試嘅價值係「幹事照住做會唔會撲空」——註解只有開發者會睇，
  //      而開發者見到唔對會自己去 Menu.gs 查。
  //
  // 假警報寧多勿漏，但噪音大到令人索性唔理呢條測試，等於冇寫。
  // 用同 `diagnostics_row_limits.test.js` 一樣嘅拆註解手法。
  const scanned = /\.gs$/.test(file)
    ? text.replace(/\/\*[\s\S]*?\*\//g, function (block) {
      // 保留換行，行號先至唔會跑掉。
      return block.replace(/[^\n]/g, ' ');
    }).replace(/^(\s*)\/\/.*$/gm, '$1')
    : text;

  // 逐行掃，方便報行號；一行可能有多個路徑。
  scanned.split('\n').forEach(function (line, idx) {
    const lineNo = idx + 1;
    // 「A ▸ B」（B 可以再有 ▸ C）。到引號／全形標點／行尾為止。
    const re = /([^\s'"「」，。、＋+]+)\s*▸\s*([^'"「」，。、\n]+)/g;
    let m;
    while ((m = re.exec(line)) !== null) {
      let head = m[1].trim();
      let rest = m[2].trim();

      // 「請到選單 ▸ 測試工具 ▸ X」：head 可能黐咗前面啲字。
      const isExplicit = /選單$/.test(head);
      if (isExplicit) {
        const parts = rest.split('▸').map(function (s) { return s.trim(); });
        head = parts[0];
        rest = parts.slice(1).join(' ▸ ');
      }

      const sub = findSub(head);
      if (!sub) {
        // 唔係 Menu.gs 認得嘅子選單。
        // 明文寫住「選單 ▸」嘅話，就係真係指錯路，要報。
        // 否則當佢係另一種 `▸` 用法（Google 試算表選單／Web UI 分區／層級標示），
        // 唔報——見檔頭「範圍」嗰段。
        if (isExplicit) {
          problems.push(rel + ':' + lineNo + '　「選單 ▸ ' + head + ' ▸ ' + rest + '」'
            + '　→ Menu.gs 根本冇「' + head + '」呢個子選單。'
            + '　現有子選單：' + SUB_NAMES.join('／'));
        }
        continue;
      }

      if (!rest) continue;
      // 只取第一層項目名（後面可能仲有「▸ 再下一層」，但選單只有兩層）。
      const itemName = rest.split('▸')[0].trim();
      const ni = norm(itemName);
      if (!ni) continue;

      const exact = sub.items.filter(function (it) { return norm(it) === ni; });
      if (exact.length === 1) continue;
      // 容許省略前綴／後綴，但要求**唯一對應到一項**。
      const fuzzy = sub.items.filter(function (it) {
        const n2 = norm(it);
        return n2.indexOf(ni) !== -1 || ni.indexOf(n2) !== -1;
      });
      if (fuzzy.length === 1) continue;

      // ⚠️ 拆咗個 local variable 出嚟先用。`scan-staged-secrets.js` 會把
      // 「識別字 ＋ 點 ＋ name」呢個形狀當成一個網域而擋 commit。
      // 呢個係假警報，但寧願遷就個掃描器，都好過為咗一個假警報去放寬佢
      //（佢真正要擋嘅係教會網域入到公開 repo）。
      const subName = sub.name;
      if (fuzzy.length === 0) {
        problems.push(rel + ':' + lineNo + '　「' + subName + ' ▸ ' + itemName + '」'
          + '　→ 呢個子選單入面搵唔到呢一項。'
          + '　該子選單實際有：' + sub.items.join('／'));
      } else {
        problems.push(rel + ':' + lineNo + '　「' + subName + ' ▸ ' + itemName + '」'
          + '　→ 對應到 ' + fuzzy.length + ' 項，唔唯一：' + fuzzy.join('／')
          + '　請寫得具體啲。');
      }
    }
  });
});

console.log('\n=== D2：全部「選單 ▸ …」路徑都要對得上 Menu.gs ===');
check('★★★★★ 冇任何訊息文字指錯選單路徑'
  + '（一句用嚟幫人嘅指示，指錯路就變成一個新問題）',
  problems.length === 0, problems.join('\n'));

console.log('\n=== D1 回歸：Config 型別錯誤訊息指返啱路 ===');
{
  const configSrc = fs.readFileSync(path.join(SRC, 'Config.gs'), 'utf8');
  check('★★★★★ 唔再寫「選單 ▸ 維護 ▸ 重新載入設定」（實測指錯咗路嗰句）',
    configSrc.indexOf('選單 ▸ 維護 ▸ 重新載入設定') === -1);
  check('★★★★★ 改成指去「查看」子選單（「重新載入設定（唯讀）」真正住嗰度）',
    /選單 ▸ 查看[^\n]*重新載入設定/.test(configSrc));
}

console.log('\n=== D3 回歸：兩個演練選單標籤唔再撞頭 ===');
{
  const testTools = MENU.find(function (s) { return norm(s.name) === norm('測試工具'); });
  check('★★★★ 搵到「測試工具」子選單', !!testTools);
  if (testTools) {
    const rehearsal = testTools.items.filter(function (it) { return it.indexOf('全季流程演練') !== -1; });
    check('★★★★ 剛好兩項演練', rehearsal.length === 2, JSON.stringify(rehearsal));
    if (rehearsal.length === 2) {
      // 實測時 Ivan 撳錯咗：想跑第一段，撳咗接續。兩項並排、字頭一模一樣。
      const heads = rehearsal.map(function (it) { return it.slice(0, 3); });
      check('★★★★★ 兩項嘅字頭唔同（實測撳錯就係因為字頭一模一樣）',
        heads[0] !== heads[1], JSON.stringify(rehearsal));
      check('★★★★★ 兩項嘅圖示都唔同',
        rehearsal[0].charAt(0) !== rehearsal[1].charAt(0), JSON.stringify(rehearsal));
      check('★★★★ 一項明講「第一段／由頭開始」',
        rehearsal.some(function (it) { return /第一段|由頭開始/.test(it); }), JSON.stringify(rehearsal));
      check('★★★★ 一項明講「接續上一段」',
        rehearsal.some(function (it) { return /接續上一段/.test(it); }), JSON.stringify(rehearsal));
    }
  }

  // 舊標籤唔可以仲留喺任何訊息文字入面——留住就係第二個真相來源。
  const stale = [];
  listSourceFiles().forEach(function (file) {
    const text = fs.readFileSync(file, 'utf8');
    text.split('\n').forEach(function (line, i) {
      if (line.indexOf('全季流程演練（接續）') !== -1
        || line.indexOf('全季流程演練（只在 DRY_RUN 沙盒季度）') !== -1) {
        stale.push(path.relative(path.join(__dirname, '..'), file).replace(/\\/g, '/') + ':' + (i + 1));
      }
    });
  });
  check('★★★★★ src/ 冇任何地方仲用緊舊嘅演練標籤', stale.length === 0, stale.join('\n'));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);

// 敏感資料永久回歸測試——每次改動都要跑一次，確保不會有真實姓名／電郵／
// Script ID／Spreadsheet ID／Drive 資料夾 ID 混進即將公開的 git repo。
// 執行方式：
//   node tests/scan_sensitive.test.js
// 不需要任何額外套件、不連線；只讀本機檔案（含 repo 外一個參考檔，見下）。
//
// 背景：2026-08-14 發現 docs/開發歷程.md 已經被推上公開 GitHub repo，內含
// 一個真實 Script ID 與 5 個真實會友姓名（掃描時漏掉，因為當時只搜尋「記得
// 的候選清單」，不是真正的樣式掃描）。這份測試就是要把當時人手漏掉的掃描
// 方式，變成往後每次改動都會自動跑一次的防線。
//
// ---- 設計上刻意避免的做法：把真實姓名清單寫死在這個測試檔內 ----
// 這個檔案本身會進 git、會公開，如果把已知的真實會友姓名列在這裡，等於
// 測試檔自己就是一次洩漏，比它要防的問題還嚴重。所以「真實姓名」這一項
// 改用兩種不寫死名字的方法：
//   (a) 讀取 repo 外部的參考檔 roster_patterns_rules.md（不屬於這個 git
//       repo，本來就不會被公開），從裡面的表格／列舉結構動態抽取候選姓名，
//       而不是把姓名寫進程式碼。這個參考檔在別的環境可能不存在（例如
//       clone 到別的電腦），找不到就跳過這項檢查並印出提示，不當作測試
//       失敗——這項本來就只是「錦上添花」的第二層防線，不是唯一防線。
//       （抽取結果只用來「比對」，絕不印出實際姓名——見 scanKnownNames()。）
//   (b) 已知的實際機密（例如 Script ID）改成在執行測試的當下，從本機
//       .clasp.json（同樣被 .gitignore 排除、不會進 git）動態讀出正確值，
//       再去檢查即將進 git 的檔案有沒有含這個值——測試檔本身一樣不含這個
//       ID 的字面值。
// 其餘檢查（未知的長 ID 字串、電郵網域）用的是樣式與「這個字串是不是程式
// 裡本來就有宣告的識別字」，跟具體是誰、是什麼機密無關，可以安心寫死邏輯。
//
// 下面 STRUCTURAL_STOPWORDS 清單也是安心寫死的——裡面全是「主席」「音響」
// 這類職事表崗位名稱／系統通用詞彙，本來就滿街都是（README.md、docs/、
// src/ 到處出現），不是任何人的姓名，公開完全沒有問題。

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const TEXT_EXTENSIONS = new Set(['.md', '.gs', '.js', '.html', '.json', '']);
// 這份測試檔自己也會進 git、也會公開，所以「正式掃描」的候選檔案清單刻意
// 不排除這個檔案本身——一開始寫的時候排除過，但那正是掃描工具自己的
// 死角：它掃了全部其他檔案，卻沒掃自己的註釋，而註釋裡最初就用了真實
// 姓名當範例（2026-08-14 事後才發現，已改成虛構姓名）。
// 下面 SELF-CHECK 段落會刻意構造「看起來像洩漏」的假資料來驗證偵測函式
// 邏輯本身正確——這些假資料全部用字面值拼接（'a'+'b' 而不是 'ab'）組出，
// 讓「這份原始碼檔案的文字內容」裡不會出現一段完整、連續、可被下面幾個
// 偵測函式直接匹配到的字串。這樣「掃自己」才不會抓到自己刻意構造的假
// 資料、卻仍然抓得到「不小心寫死在註釋裡的真實資料」這種真正的問題。

let fail = 0;
let warn = 0;
function check(label, ok, detail) {
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && detail) console.log(`      ${detail}`);
}
function note(label) {
  warn++;
  console.log(`WARN  ${label}`);
}

// =====================================================================
// 第 0 步：列出「即將進 git 的檔案」——已追蹤的檔案 ∪ 尚未追蹤但沒被
// .gitignore 擋住的檔案，兩者聯集才是「下次 git add . 會真正進 git」的
// 完整範圍。用 git 本身的判斷（--exclude-standard），不重新發明一份
// .gitignore 規則的複製品——複製品會漂移、跟真正的規則對不上。
//
// ★ 一定要加 -z（NUL 分隔、輸出原始位元組）。git 預設的 core.quotePath
// 行為會把非 ASCII 檔名（例如 docs/幹事操作說明.md）印成八進位跳脫序列
// 並加雙引號（"docs/\346...")，這種字串既不是有效路徑、fs.existsSync 也
// 讀不到，會整個被靜靜濾掉，等於這份測試從一開始就沒有真正掃過任何中文
// 檔名——剛好是這次事件最關鍵的兩個檔案（docs/開發歷程.md、
// docs/幹事操作說明.md）。用 -z 才能拿到未跳脫的原始檔名。
// =====================================================================
function listCandidateFiles() {
  const tracked = execSync('git ls-files -z', { cwd: REPO_ROOT, encoding: 'utf8' });
  const untrackedNotIgnored = execSync('git ls-files --others --exclude-standard -z', { cwd: REPO_ROOT, encoding: 'utf8' });
  const all = new Set(
    (tracked + '\0' + untrackedNotIgnored)
      .split('\0')
      .map(s => s.trim())
      .filter(Boolean)
  );
  return Array.from(all)
    .filter(rel => TEXT_EXTENSIONS.has(path.extname(rel)))
    .map(rel => ({ rel, abs: path.join(REPO_ROOT, rel) }))
    .filter(f => fs.existsSync(f.abs) && fs.statSync(f.abs).isFile());
}

function readText(absPath) {
  return fs.readFileSync(absPath, 'utf8');
}

// =====================================================================
// 第 1 步：動態建立「程式碼裡本來就有宣告的識別字」白名單，用來排除
// function/const 名稱這類長識別字（例如 buildFullRosterAttachmentCached_、
// HISTORICAL_BASELINE_DISTRIBUTION），只留下真正「不明來源」的長字串。
// 這份白名單是每次執行時重新掃描 src/ 與 tests/ 現況產生的，不是寫死的
// 固定清單，所以以後新增函式／常數也會自動被涵蓋，不需要手動維護。
// =====================================================================
function buildDeclaredIdentifierAllowlist(files) {
  const allow = new Set();
  const declPatterns = [
    /function\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
    /(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=/g,
    // 物件字面量的屬性鍵名（例如 CONFIG_KEYS 這種 { SEND_LOG_FLUSH_BATCH_SIZE:
    // 'SEND_LOG_FLUSH_BATCH_SIZE' } 寫法）——鍵名本身是開發者取的識別字，
    // 跟 function/const 名稱一樣安全；冒號後面的「值」不受這條規則影響，
    // 所以真的貼進一段機密字串當成某個鍵的值，不會因為這條規則被誤放行。
    /([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g,
  ];
  for (const f of files) {
    if (!f.rel.startsWith('src/') && !f.rel.startsWith('tests/')) continue;
    const text = readText(f.abs);
    for (const re of declPatterns) {
      let m;
      while ((m = re.exec(text)) !== null) allow.add(m[1]);
    }
  }
  return allow;
}

// 已知安全的長字串樣式（版本／備份標籤之類，不是任何人的機密，格式固定
// 可以放心用 regex 描述，不需要逐一列出實際值）。
const SAFE_LONG_TOKEN_PATTERNS = [
  /^\d{4}T\d-v\d+(-[A-Z]+)*-\d{14}$/, // 例：2026T4-v9-OFFICIAL-20260813171850
];

function isDeclaredOrSafe(token, allowlist) {
  if (allowlist.has(token)) return true;
  if (allowlist.has(token.replace(/_+$/, ''))) return true;   // 候選字尾巴多了底線（呼叫時省略底線）
  if (allowlist.has(token + '_')) return true;                 // 候選字缺了宣告時的尾巴底線
  if (SAFE_LONG_TOKEN_PATTERNS.some(p => p.test(token))) return true;
  // 全部由 - 或 _ 組成、或只有極少種不同字元（例如分隔線 -----...----），
  // 不是任何 ID 會有的樣子，排除。
  if (new Set(token).size < 8) return true;
  // snake_case 且每一段都是純小寫字母／數字（例如 roster_pdf_batch_progress
  // 這種 PropertiesService 儲存鍵名）——讀得出來的英文詞組，不是隨機亂數
  // 組成的機密 ID（真正的 Script／Spreadsheet／Drive 資料夾 ID 是不分段、
  // 大小寫夾雜、看起來隨機的字串，不會切成這種乾淨的小寫單字段落）。
  if (token.includes('_')) {
    const segments = token.split(/[_-]/).filter(Boolean);
    if (segments.length >= 2 && segments.every(s => /^[a-z0-9]+$/.test(s))) return true;
  }
  // 完全不含數字、且有底線分段或大小寫夾雜（SCREAMING_SNAKE_CASE／
  // camelCase／PascalCase_Suffix）——典型的程式識別字寫法。真正的
  // Script／Spreadsheet／Drive 資料夾 ID 是 base64url 字元組成的隨機
  // 字串，25 個字元以上幾乎必定混到數字（本專案唯一已知的真實 Script ID
  // 就到處都是數字），所以「完全沒有數字」是判斷「這是可讀識別字，不是
  // 隨機機密」很可靠的訊號。
  if (!/\d/.test(token) && (token.includes('_') || (/[a-z]/.test(token) && /[A-Z]/.test(token)))) return true;
  return false;
}

function scanUnknownLongTokens(files, allowlist) {
  const idPattern = /[A-Za-z0-9_-]{25,}/g;
  const findings = [];
  for (const f of files) {
    const text = readText(f.abs);
    const seen = new Set();
    let m;
    while ((m = idPattern.exec(text)) !== null) {
      const token = m[0];
      if (seen.has(token)) continue;
      seen.add(token);
      if (isDeclaredOrSafe(token, allowlist)) continue;
      findings.push({ file: f.rel, token });
    }
  }
  return findings;
}

// =====================================================================
// 第 2 步：電郵地址——只放行明確是「假資料／範例」用途的網域樣式，
// 其餘一律視為可疑（可能是真實電郵）。
// =====================================================================
const SAFE_EMAIL_DOMAIN_PATTERNS = [
  /\.invalid$/i,  // RFC 2606 保留，專門給「不存在的範例位址」用
  /\.test$/i,
  /\.example$/i,
  /\.localhost$/i,
  /^x\.com$/i,    // 本專案既有測試／範本一律用這個假網域（p1@x.com 之類）
];

function scanSuspiciousEmails(files) {
  const emailPattern = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
  const findings = [];
  for (const f of files) {
    const text = readText(f.abs);
    const seen = new Set();
    let m;
    while ((m = emailPattern.exec(text)) !== null) {
      const full = m[0];
      const domain = m[1];
      if (seen.has(full)) continue;
      seen.add(full);
      if (SAFE_EMAIL_DOMAIN_PATTERNS.some(p => p.test(domain))) continue;
      findings.push({ file: f.rel, email: full });
    }
  }
  return findings;
}

// =====================================================================
// 第 3 步：已知的實際機密——目前只有 Script ID 這一項有本機可讀的正確值
// （.clasp.json，被 .gitignore 排除）。找不到就跳過，不當失敗。
// =====================================================================
function scanKnownSecret(files) {
  const claspPath = path.join(REPO_ROOT, '.clasp.json');
  if (!fs.existsSync(claspPath)) {
    note('.clasp.json 不存在，略過已知 Script ID 的字面比對（本機環境沒有這個檔案，不代表有問題）');
    return [];
  }
  let scriptId;
  try {
    scriptId = JSON.parse(fs.readFileSync(claspPath, 'utf8')).scriptId;
  } catch (e) {
    note('讀取 .clasp.json 失敗，略過已知 Script ID 的字面比對：' + e.message);
    return [];
  }
  if (!scriptId) return [];
  const findings = [];
  for (const f of files) {
    const text = readText(f.abs);
    if (text.indexOf(scriptId) >= 0) findings.push({ file: f.rel, secret: 'Script ID' });
  }
  return findings;
}

// =====================================================================
// 第 4 步：真實姓名——動態從 repo 外部的 roster_patterns_rules.md 抽取
// 候選姓名（不寫死在這個檔案），再檢查即將進 git 的檔案有沒有含這些字串。
// 只是「已知名單」的交叉核對，抓不到清單以外的新名字——這是刻意的取捨
// （見檔頭說明），不是這項檢查的漏洞。
//
// 抽取用的都是「名字前後緊接著什麼結構」的樣式（緊接百分比數字、緊接
// 「牧師」頭銜、緊接 =／≠ 異體字對照），刻意不用單純「逗號、頓號分隔」
// 這種寬鬆樣式——寬鬆樣式會連「主席」「音響」這些崗位名稱也一起抓進來，
// 因為它們在文件裡也常常用頓號列舉，但那些是系統通用詞彙不是姓名。
// =====================================================================
const NB_BEFORE = '(?<![\\p{Script=Han}])';
const NB_AFTER = '(?![\\p{Script=Han}])';
// 職事表崗位名稱／系統通用詞彙——公開資訊，不是任何人的姓名，用來過濾
// 上面樣式偶爾抓到的非姓名詞彙（例如「主席、讀經、領詩」這種頓號列舉）。
const STRUCTURAL_STOPWORDS = new Set([
  '主席', '讀經', '領詩', '司事', '司數', '司琴', '音響', '控制',
  '交通指揮', '當值堂委', '特殊主日', '個崗位', '堂慶合堂',
]);

function extractNameCandidatesFromReferenceFile(refText) {
  const CJK = '\\p{Script=Han}';
  const patterns = [
    new RegExp(`${NB_BEFORE}(${CJK}{2,4})(?=\\s*\\d+[(（])`, 'gu'),          // 假設的範例：陳大文 10(13%)
    new RegExp(`${NB_BEFORE}(${CJK}{2,4})(?=、)`, 'gu'),                     // 、列舉（前段）
    new RegExp(`(?<=、)(${CJK}{2,4})${NB_AFTER}`, 'gu'),                     // 、列舉（後段）
    new RegExp(`${NB_BEFORE}(${CJK}{2,3})(?=牧師)`, 'gu'),                   // 假設的範例：李小明牧師
    new RegExp(`${NB_BEFORE}(${CJK}{2,3})(?=\\s*[=≠]\\s*${CJK}{2,3}${NB_AFTER})`, 'gu'), // 假設的範例：王美美 = 王玫美
    new RegExp(`(?<=[=≠]\\s*)(${CJK}{2,3})${NB_AFTER}`, 'gu'),
  ];
  const candidates = new Set();
  for (const re of patterns) {
    let m;
    while ((m = re.exec(refText)) !== null) candidates.add(m[1]);
  }
  return Array.from(candidates).filter(c => !STRUCTURAL_STOPWORDS.has(c));
}

function scanKnownNames(files) {
  const refPath = path.join(REPO_ROOT, '..', 'roster_patterns_rules.md');
  if (!fs.existsSync(refPath)) {
    note('roster_patterns_rules.md 參考檔不存在（本機環境沒有，可能是別的機器 clone 這個 repo），略過已知姓名交叉核對');
    return [];
  }
  const refText = fs.readFileSync(refPath, 'utf8');
  const names = extractNameCandidatesFromReferenceFile(refText);
  if (names.length === 0) {
    note('roster_patterns_rules.md 存在但抽取不到任何候選姓名，略過（可能是參考檔格式改變，需要人手檢查抽取邏輯）');
    return [];
  }
  const findings = [];
  for (const f of files) {
    const text = readText(f.abs);
    for (const n of names) {
      if (text.indexOf(n) >= 0) findings.push({ file: f.rel });
    }
  }
  return { findings, namesChecked: names.length };
}

// =====================================================================
// 自我檢查：確認上面幾個偵測函式本身邏輯正確。全部用「執行時動態組出來」
// 的假資料（不是寫死的字面字串），這樣假資料本身不會出現在這個檔案的
// 原始碼文字裡——否則正式掃描讀到這個檔案的原始碼時，會把自我檢查用的
// 假資料誤判成「找到了洩漏」，變成測試檔自己觸發自己的假警報。
// （雖然上面 listCandidateFiles() 已經把這個檔案排除在正式掃描範圍外，
// 這裡仍然用動態組字串，保留「就算哪天改成不排除也不會誤報」的安全邊界。）
// =====================================================================
console.log('\n=== 自我檢查：偵測邏輯本身是否正確（全部使用動態組出的假資料） ===');
{
  // 27 字元、字元種類夠多，模擬真實 ID 的隨機外觀；刻意分兩段字面值拼接，
  // 這樣「這份原始碼檔案自己」的文字內容裡不會出現一段連續 25+ 字元的
  // 字串——現在這份測試已經把自己也納入正式掃描範圍（見下方 SELF-CHECK
  // 後的說明），如果這裡寫成單一長字面值，會被自己的長字串檢查誤判成
  // 「不明長字串」，變成測試測到自己構造的假資料。
  const fakeLongToken = 'aB3dE7fG1hJ9kL2mN5' + 'pQ8rS4tU6';
  const fakeDeclaredName = 'known' + 'DeclaredFunctionName_';
  const idPattern = /[A-Za-z0-9_-]{25,}/g;
  const fakeCodeSnippet = fakeLongToken + ' 這裡混了一個假的長字串 ' + fakeDeclaredName + ' 應該被放行';
  const tokens = [...fakeCodeSnippet.matchAll(idPattern)].map(m => m[0]);
  check('★ 自我檢查：25+ 字元的未知字串會被抓到', tokens.includes(fakeLongToken), 'tokens=' + JSON.stringify(tokens));
  const fakeAllowlist = new Set([fakeDeclaredName]);
  check('★ 自我檢查：不在白名單的長字串判定為不安全', !isDeclaredOrSafe(fakeLongToken, fakeAllowlist), '');
  check('★ 自我檢查：已宣告識別字（即使很長）判定為安全', isDeclaredOrSafe(fakeDeclaredName, fakeAllowlist), '');
  check('★ 自我檢查：分隔線（重複同一字元）判定為安全', isDeclaredOrSafe('-'.repeat(30), new Set()), '');
  check('★ 自我檢查：snake_case 設定鍵名判定為安全', isDeclaredOrSafe('roster_pdf_batch_progress_key_x', new Set()), '');

  const safeDomainEmail = 'demo' + '@' + 'x.com';
  const safeInvalidEmail = 'test' + '@' + 'example.invalid';
  const suspiciousEmail = 'realperson' + '@' + 'gmail.com';
  const fakeEmailSnippet = '正常寄件 ' + safeDomainEmail + ' 範例電郵 ' + safeInvalidEmail + ' 但這個 ' + suspiciousEmail + ' 應該被抓出來';
  const emailPattern = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
  const emailMatches = [...fakeEmailSnippet.matchAll(emailPattern)];
  const suspicious = emailMatches.filter(m => !SAFE_EMAIL_DOMAIN_PATTERNS.some(p => p.test(m[1])));
  check('★ 自我檢查：安全網域（x.com／.invalid）不誤報', suspicious.every(m => m[0] !== safeDomainEmail && m[0] !== safeInvalidEmail), JSON.stringify(suspicious.map(m => m[0])));
  check('★ 自我檢查：非安全網域的電郵會被抓到', suspicious.some(m => m[0] === suspiciousEmail), JSON.stringify(suspicious.map(m => m[0])));

  const fakeRefText = ['主席 | ', '假甲', '乙', ' 10(13%)、', '假丙', '丁', ' 9(12%)', '\n講員：', '假戊', '己', '牧師', '\n', '假庚', '辛', ' = ', '假庚', '辛', '異體字'].join('');
  const fakeNames = extractNameCandidatesFromReferenceFile(fakeRefText);
  check('★ 自我檢查：percent 結構抽得到候選姓名', fakeNames.includes('假甲乙'), JSON.stringify(fakeNames));
  check('★ 自我檢查：、列舉結構抽得到候選姓名', fakeNames.includes('假丙丁'), JSON.stringify(fakeNames));
  check('★ 自我檢查：牧師頭銜結構抽得到候選姓名', fakeNames.includes('假戊己'), JSON.stringify(fakeNames));
  check('★ 自我檢查：崗位名稱不會被誤判成候選姓名（停用詞過濾生效）', !extractNameCandidatesFromReferenceFile('主席、讀經、領詩、司事、音響、控制、司數、司琴、當值堂委、交通指揮').length, '');
}

// =====================================================================
// 正式掃描：對即將進 git 的實際檔案跑全部四項檢查。
// =====================================================================
console.log('\n=== 正式掃描：即將進 git 的檔案 ===');
const candidateFiles = listCandidateFiles();
console.log(`候選檔案數：${candidateFiles.length}`);

// 防止 listCandidateFiles() 的檔案清單邏輯又悄悄壞掉（例如漏了 -z、
// 導致非 ASCII 檔名被跳脫成無效路徑而整批消失——這正是 2026-08-14 寫這份
// 測試時發生過的真實 bug，docs/幹事操作說明.md、docs/開發歷程.md 兩個
// 中文檔名一度被靜靜濾掉，測試卻照樣顯示 ALL PASS）。用兩個「應該在／
// 應該不在」的已知案例直接驗證清單本身抓對了範圍，而不是只驗證清單長度：
// docs/幹事操作說明.md 應該公開、有追蹤，一定要在清單裡；docs/開發歷程.md
// 已經加進 .gitignore、不再追蹤，一定不能在清單裡。這兩個檔案剛好一個
// 測「清單抓不到非 ASCII 檔名」的迴歸、一個測「清單是不是動態算出來的
// （而不是寫死的固定清單）」——把它從 .gitignore 移除、重新 git add 之後
// 應該自動出現在候選清單，不需要改這份測試的程式碼。
{
  const rels = candidateFiles.map(f => f.rel);
  check('★ 候選清單抓得到非 ASCII 檔名（防止 git ls-files 跳脫路徑的迴歸）',
    rels.includes('docs/幹事操作說明.md'), `實際清單：${JSON.stringify(rels)}`);
  check('★ 候選清單正確排除已加入 .gitignore 的檔案（docs/開發歷程.md）',
    !rels.includes('docs/開發歷程.md'), `實際清單：${JSON.stringify(rels)}`);
}

const secretFindings = scanKnownSecret(candidateFiles);
check('★ 沒有任何檔案含已知的真實 Script ID', secretFindings.length === 0,
  secretFindings.map(f => `${f.file}: ${f.secret}`).join('\n      '));

const idAllowlist = buildDeclaredIdentifierAllowlist(candidateFiles);
console.log(`（動態白名單：從 src/、tests/ 掃到 ${idAllowlist.size} 個已宣告識別字）`);
const idFindings = scanUnknownLongTokens(candidateFiles, idAllowlist);
check('★ 沒有不明的長 ID 字串（可能是 Script／Spreadsheet／Drive 資料夾 ID）', idFindings.length === 0,
  idFindings.map(f => `${f.file}: ${f.token}`).join('\n      '));

const emailFindings = scanSuspiciousEmails(candidateFiles);
check('★ 沒有非安全網域的電郵地址', emailFindings.length === 0,
  emailFindings.map(f => `${f.file}: ${f.email}`).join('\n      '));

const nameResult = scanKnownNames(candidateFiles);
if (Array.isArray(nameResult)) {
  // 參考檔不存在，已經在 scanKnownNames 內印過 WARN，這裡不重複判斷 pass/fail
} else {
  console.log(`（已知姓名交叉核對：從外部參考檔抽到 ${nameResult.namesChecked} 個候選姓名）`);
  check('★ 沒有任何檔案含外部參考檔裡的已知真實姓名', nameResult.findings.length === 0,
    nameResult.findings.map(f => `${f.file}: 命中已知姓名（不印出實際姓名，避免這份測試輸出本身變成洩漏管道）`).join('\n      '));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}${warn > 0 ? `（另有 ${warn} 項 WARN，見上方）` : ''}`);
process.exit(fail === 0 ? 0 : 1);

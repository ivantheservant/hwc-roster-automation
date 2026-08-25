// 第六十二輪批次 A 組：verify-red crash 唔可以留低一個改壞咗嘅 src/。
// 執行方式：node tests/verify_red_restore.test.js
//
// ═════════════════════════════════════════════════════════════════════
// 現場（第六十一輪實測，撞咗兩次）
// ═════════════════════════════════════════════════════════════════════
//
//   node:fs:2430
//   Error: UNKNOWN: unknown error, open
//     'C:\HWC\SynologyDrive\Roster\claudecode\src\Mailer.gs'
//       at Object.writeFileSync (node:fs:2430:20)
//       at C:\...\tools\verify-red.js:3638:8
//
// 拋錯嗰一下係**還原**嗰個寫入（Synology 同步鎖住咗個檔）。
// 舊寫法冇包 try／catch，所以：
//
//   ・成支工具即刻死
//   ・`src/Mailer.gs` 留住突變版本
//   ・而最尾嗰道「src/ 冇殘留」自我檢查**排喺最後，根本跑唔到**
//
// ⚠️ 即係「最需要佢嗰陣佢唔喺度」。
// 而一個被改壞嘅 `src/` commit 咗上去，係呢個工具可以造成嘅最大傷害。
//
// ─────────────────────────────────────────────────────────────────────
// ⚠️ 呢個測試會真係整污糟 src/，所以佢自己一定要收拾乾淨
// ─────────────────────────────────────────────────────────────────────
//
// 開跑之前影低第一條突變嗰個檔案，跑完**無論結果點都**寫返去，
// 最後再斷言一次真係一個字都唔差。
// 收拾唔到嘅話，呢個測試本身就變成佢要防嗰件事。

const fs = require('fs');
const path = require('path');
const { execFileSync, execFileSync: _e } = require('child_process');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 1200));
}

const ROOT = path.join(__dirname, '..');
const VERIFY_RED = path.join(ROOT, 'tools', 'verify-red.js');
const SRC = fs.readFileSync(VERIFY_RED, 'utf8');

// ── 第一條突變改邊個檔案？影低佢 ────────────────────────────────
// ⚠️ 換一個名再 eval。用返 `MUTATIONS` 嘅話，同下面個 const
// 撞名 ⇒ `Identifier 'MUTATIONS' has already been declared`。
const MUTATIONS = eval(
  SRC.match(/const MUTATIONS = \[[\s\S]*?\n\];/)[0]
    .replace('const MUTATIONS', 'var __muts') + ';__muts');
const FIRST_FILE = MUTATIONS[0].file;
const FIRST_ABS = path.join(ROOT, FIRST_FILE);
const SNAPSHOT = fs.readFileSync(FIRST_ABS, 'utf8');

/**
 * 跑一次 `verify-red`，`fs.writeFileSync` 喺第二次寫 `src/` 嗰陣拋錯。
 *
 * @returns {{status: number, out: string}}
 */
function runWithBrokenWrite(failAt) {
  const env = Object.assign({}, process.env);
  if (failAt) env.FAIL_SRC_WRITE_AT = String(failAt);
  try {
    const out = execFileSync(process.execPath,
      // ⚠️ `--require` 要用絕對路徑。傳相對路徑嘅話 Node 當佢係
      // 一個模組名去解析 ⇒ `Cannot find module 'tests\helpers\…'`。
      ['--require', path.join(__dirname, 'helpers', 'fail_restore_write.js'),
        path.join('tools', 'verify-red.js')],
      { cwd: ROOT, stdio: 'pipe', encoding: 'utf8', env: env });
    return { status: 0, out: out };
  } catch (e) {
    return {
      status: e.status === undefined ? -1 : e.status,
      out: String(e.stdout || '') + String(e.stderr || '')
    };
  }
}

function runWithBrokenRestore() { return runWithBrokenWrite(2); }

let box = { status: -1, out: '（未跑）' };
try {
  box = runWithBrokenRestore();
} finally {
  // ⚠️ 無論上面點，都寫返原文。呢一句唔可以有任何條件。
  try { fs.writeFileSync(FIRST_ABS, SNAPSHOT); } catch (err) {
    console.log('⛔ 收拾唔到 ' + FIRST_FILE + '：' + err.message);
    console.log('   請自己跑：git checkout -- ' + FIRST_FILE);
    fail++;
  }
}

// =====================================================================
console.log('\n=== A1【核心】還原失敗 ⇒ 即刻停，唔好繼續跑落去 ===');
{
  check('★★★★★★ **冇跑晒成張突變表**'
    + '——繼續跑落去嘅話，下一條突變會喺一個已經改壞咗嘅檔案上面'
    + '再改一次，越搞越亂',
    /因為還原失敗，已經停低，冇跑晒/.test(box.out)
      && !/ALL RED OK/.test(box.out), box.out.slice(-1500));

  // 出事嗰陣只處理咗第一條突變，所以輸出入面唔應該有第三條之後嘅 id。
  const okCount = (box.out.match(/^RED OK/gm) || []).length;
  check('★★★★★★ 而且停得夠早（處理過嘅突變 ≤ 2 條，總共 '
    + MUTATIONS.length + ' 條）',
    okCount <= 2, '見到 ' + okCount + ' 行 RED OK');
}

// =====================================================================
console.log('\n=== A1【核心】退出碼非 0 ===');
{
  check('★★★★★★ **exit code 唔係 0**'
    + '——推送閘靠佢。回 0 嘅話，一個改壞咗嘅 src/ 會一路過閘',
    box.status !== 0, 'status = ' + box.status);
}

// =====================================================================
console.log('\n=== A1【核心】收尾鈎：crash 之下都要跑到 ===');
{
  // ⚠️ 呢一條先係整組嘅重點。舊寫法嗰道檢查排喺最尾，
  // 所以「還原失敗」嗰下佢由頭到尾冇跑過——最需要佢嗰陣佢唔喺度。
  check('★★★★★★ **「src/ 有冇殘留」嗰段照樣印咗出嚟**',
    /=== C 組：工具本身唔可以留低任何改動 ===/.test(box.out),
    box.out.slice(-1500));
  check('★★★★★★ 而且真係揾到嗰個殘留（唔係報「冇殘留」）',
    /同開跑之前唔一樣嘅檔案：/.test(box.out)
      && !/RED OK {2}src\/ 冇殘留/.test(box.out), box.out.slice(-1500));
  check('★★★★★★ 掛喺 `process.on(\'exit\')`，唔係擺喺最尾嗰幾行',
    /process\.on\('exit', finalResidueCheck_\)/.test(SRC), '');
  check('★★★★★★ 而且結尾用 `process.exitCode`，唔係 `process.exit()`'
    + '——`process.exit()` 會即刻走，收尾鈎行唔完',
    /process\.exitCode = fail === 0 \? 0 : 1;/.test(SRC)
      && !/process\.exit\(fail/.test(SRC), '');
}

// =====================================================================
console.log('\n=== A1【核心】訊息要講得出邊個檔案，同埋點救 ===');
{
  check('★★★★★★ **講得出係邊個檔案還原唔到**',
    new RegExp('還原失敗嘅檔案：' + FIRST_FILE.replace('/', '\\/')).test(box.out),
    box.out.slice(-1500));
  check('★★★★★★ 而且貼返原本嗰句錯誤',
    /UNKNOWN: unknown error, open/.test(box.out), box.out.slice(-1500));
  check('★★★★★★ **講得出點樣救**',
    new RegExp('git checkout -- ' + FIRST_FILE.replace('/', '\\/')).test(box.out),
    box.out.slice(-1500));
  check('★★★★★ 而且明確叫人唔好 commit',
    /唔可以\*\* commit|\*\*唔可以\*\* commit/.test(box.out)
      || /呢一刻嘅 src\/ \*\*唔可以\*\* commit/.test(box.out),
    box.out.slice(-1500));
  check('★★★★★ 出事嗰條突變 id 都印咗',
    box.out.indexOf(MUTATIONS[0].id) !== -1, box.out.slice(-1500));
}

// =====================================================================
console.log('\n=== A4 呢個測試自己收拾得乾淨 ===');
{
  // ⚠️ 收拾唔到嘅話，呢個測試本身就變成佢要防嗰件事。
  check('★★★★★★ **' + FIRST_FILE + ' 同開跑之前一個字都唔差**',
    fs.readFileSync(FIRST_ABS, 'utf8') === SNAPSHOT,
    '長度 ' + fs.readFileSync(FIRST_ABS, 'utf8').length
      + ' vs ' + SNAPSHOT.length);
}

// =====================================================================
console.log('\n=== A1【核心】就算係冇人接嘅 crash，收尾鈎一樣要跑 ===');
{
  // ⚠️⚠️ **呢一條先係「收尾鈎」真正嘅考驗。**
  //
  // 上面嗰個情境（還原失敗）已經畀 A1 嗰個 try／catch 接住咗，
  // 所以就算收尾檢查仍然擺喺最尾，佢一樣行得到。
  //
  // 呢度令**落突變**嗰個寫入拋錯——嗰一下冇人接，成支工具直接死。
  // 舊寫法之下，最尾嗰道「src/ 有冇殘留」由頭到尾唔會行。
  let crash = { status: -1, out: '（未跑）' };
  try {
    crash = runWithBrokenWrite(1);
  } finally {
    try { fs.writeFileSync(FIRST_ABS, SNAPSHOT); } catch (err) {
      console.log('⛔ 收拾唔到 ' + FIRST_FILE + '：' + err.message);
      fail++;
    }
  }

  check('★★★★★★ 的確係一個冇人接嘅 crash（stack 印咗出嚟）',
    /UNKNOWN: unknown error/.test(crash.out)
      && /at Object\.<anonymous>|throw err;/.test(crash.out),
    crash.out.slice(-800));
  check('★★★★★★ **而「src/ 有冇殘留」照樣行咗一次**'
    + '——舊寫法嗰道檢查排喺最尾，crash 之下由頭到尾唔會跑，'
    + '即係最需要佢嗰陣佢唔喺度',
    /=== C 組：工具本身唔可以留低任何改動 ===/.test(crash.out),
    crash.out.slice(0, 1200));
  check('★★★★★ 而且退出碼非 0', crash.status !== 0, 'status = ' + crash.status);
  check('★★★★★★ ' + FIRST_FILE + ' 仍然一個字都唔差',
    fs.readFileSync(FIRST_ABS, 'utf8') === SNAPSHOT, '');
}

// =====================================================================
console.log('\n=== A2【核心】CRLF 檔案照樣對得上 ===');
{
  // ⚠️ 實測（第六十一輪）：`git checkout -- src/Mailer.gs` 之後
  // 個檔案變成 CRLF，於是跨行嘅 `find` 報
  //「喺 src/Mailer.gs 搵到 0 次 find（要求剛好 1 次）」——
  // 程式一個字都冇改過，而推送閘紅咗。
  check('★★★★★★ 有一支 `normalizeEol_()`',
    /function normalizeEol_\(text\) \{[\s\S]{0,120}replace\(\/\\r\\n\/g, '\\n'\)/
      .test(SRC), '');
  check('★★★★★★ **比對之前真係正規化咗**',
    /const before = normalizeEol_\(raw\);/.test(SRC), '');
  check('★★★★★★ **但還原寫返原文，唔係正規化版本**'
    + '——正規化寫入檔案就變成「一個檢查工具順手改咗你成個 repo 嘅行尾」',
    /fs\.writeFileSync\(abs, raw\);/.test(SRC)
      && !/fs\.writeFileSync\(abs, before\);/.test(SRC), '');

  // 真跑一次：造一個 CRLF 版本，睇吓跨行 `find` 仲搵唔搵得到。
  const multiline = MUTATIONS.filter(function (m) {
    return m.find.indexOf('\n') !== -1;
  });
  check('★★★★★ 突變表入面真係有跨行嘅 `find`（' + multiline.length + ' 條）',
    multiline.length > 0, '');
  const m = multiline[0];
  const raw = fs.readFileSync(path.join(ROOT, m.file), 'utf8');
  const crlf = raw.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
  check('★★★★★★ **CRLF 版本直接比對 ⇒ 搵唔到（就係當時個病）**',
    crlf.split(m.find).length - 1 === 0,
    '搵到 ' + (crlf.split(m.find).length - 1) + ' 次');
  check('★★★★★★ **正規化之後 ⇒ 搵返到，剛好 1 次**',
    crlf.replace(/\r\n/g, '\n').split(m.find).length - 1 === 1,
    '搵到 ' + (crlf.replace(/\r\n/g, '\n').split(m.find).length - 1) + ' 次');
}

// =====================================================================
console.log('\n=== A3 `.gitattributes` ===');
{
  const ga = path.join(ROOT, '.gitattributes');
  check('★★★★★★ 檔案存在', fs.existsSync(ga), '');
  const text = fs.existsSync(ga) ? fs.readFileSync(ga, 'utf8') : '';
  ['*.gs', '*.js', '*.html', '*.json', '*.md'].forEach(function (ext) {
    check('★★★★★ ' + ext + ' 釘死做 LF',
      new RegExp(ext.replace('*', '\\*').replace('.', '\\.')
        + '\\s+text eol=lf').test(text), text.slice(-300));
  });
  const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  check('★★★★★★ **`.gitignore` 明確放行佢**'
    + '——呢個 repo 係白名單制，唔明確放行就等於冇；'
    + '而佢冇入到 repo 嘅話，換一部機 clone 落嚟又會變返 CRLF',
    /^!\/\.gitattributes$/m.test(ignore), '');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);

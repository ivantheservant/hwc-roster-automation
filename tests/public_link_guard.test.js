// 第二十六輪批次階段 A：公開連結漏洞。
// 執行方式：node tests/public_link_guard.test.js
//
// ─────────────────────────────────────────────────────────────────────
// 實測撞到嘅嘢
// ─────────────────────────────────────────────────────────────────────
//
// 幹事最自然嗰個次序——**生成初稿 → 寄給堂委審閱**——會寄出一封
// **連結係空白**嘅信，而且畫面上冇任何訊號。
//
// 根因鏈：
//   生成初稿唔會發佈
//   掣 1 喺零改動時亦唔會發佈
//   掣 2 唔會發佈，亦唔會檢查
//   placeholder 解析查唔到就回空字串
//
// ⚠️ 最深嗰層先係核心問題：**一個「查唔到」被包裝成「正常結果」**，
// 而上面每一層都以為冇事——冇拋錯、冇 log、畫面上零訊號。
//
// 教訓：**每次拆走一個人手步驟，都要問一句「嗰一步本來做緊乜？
// 而家邊個做？」** 舊選單流程有一步「準備工作 ▸ 發佈公開職事表」，
// 改成四粒掣之後冇人接手。

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
const mailer = read('src/Mailer.gs');
const generate = read('src/WebAppGenerate.gs');
const flow = read('src/WebAppFlow.gs');
const guards = read('src/WebAppGuards.gs');
const dash = read('src/WebAppDashboard.gs');
const zone1 = read('src/ui/ScriptZone1.html');
const common = read('src/ui/Script.html');
// 第二十七輪批次階段 F：區四由共通層搬咗去自己嘅檔案。
const zone4 = read('src/ui/ScriptZone4.html');

/** 由函式名切出函式本體（到第一個頂層 `\n}` 為止）。 */
function bodyOf(src, fnName) {
  const start = src.indexOf('function ' + fnName);
  if (start === -1) return '';
  const rest = src.slice(start);
  const end = rest.indexOf('\n}\n');
  return end === -1 ? rest : rest.slice(0, end + 3);
}

console.log('\n=== A2-1：生成初稿之後順手發佈 ===');
{
  const body = bodyOf(generate, 'apiGenerateDraftExecute');
  check('★★★★★ 生成成功之後有叫 tryPublishPublicRoster_()',
    /tryPublishPublicRoster_\(quarterId\)/.test(body));
  check('★★★★★ 發佈失敗**唔會**當成生成失敗（版本真係建立咗）'
    + '——用 publishFailed 分開報，唔係拋錯',
    /publishFailed: publish\.failed/.test(body));
  check('★★★★★ 前端用**黃色**警告，唔用紅色錯誤',
    /res\.publishFailed[\s\S]{0,200}?warnbox/.test(zone1));
  check('★★★★★ 而且明講「寄給堂委之前要先補返」'
    + '——唔講嘅話幹事會直接撳掣 2 而寄出一封冇連結嘅信',
    zone1.indexOf('在寄給堂委之前，請去「進階功能 ▸ 重新發佈公開連結」再試一次。') !== -1);
}

console.log('\n=== A2-2：掣 2 前置檢查 ===');
{
  const body = bodyOf(flow, 'apiStep2Confirm');
  check('★★★★★ 掣 2 執行前有叫 assertPublicLinkReady_()',
    /assertPublicLinkReady_\(quarterId\)/.test(body));
  check('★★★★★ 前端喺開確認畫面之前就攔住，而且有一粒「立即發佈」'
    + '——淨係話「去進階功能發佈」嘅話，幹事要行五步先做到佢本來想做嘅事',
    /function renderReviewNeedsPublicLink/.test(zone1)
    && zone1.indexOf('立即發佈') !== -1);
  check('★★★★ 發佈完自動返回掣 2 嘅流程',
    /openReview\(\);/.test(zone1.slice(zone1.indexOf('function renderReviewNeedsPublicLink'))));
}

console.log('\n=== A2-2【核心】「查不到」唔可以當成「冇連結」，亦唔可以當成「有連結」 ===');
{
  const body = bodyOf(guards, 'readPublicLinkState_');
  check('★★★★★ 讀唔到時另開一個 checkFailed 狀態'
    + '——當成「冇連結」會無謂擋住幹事；'
    + '當成「有連結」會放行一封空連結嘅信',
    /checkFailed: true/.test(body));

  const assertBody = bodyOf(guards, 'assertPublicLinkReady_');
  check('★★★★★ checkFailed 同「真係冇連結」兩種情況有唔同訊息',
    /state\.checkFailed/.test(assertBody)
    && assertBody.indexOf('這不代表沒有連結，只代表系統現在看不到') !== -1);
}

console.log('\n=== A2-3【最深嗰層】查唔到要回 null，唔可以回空字串 ===');
{
  const body = bodyOf(mailer, 'resolvePublicRosterUrlForPlaceholder_');
  check('★★★★★ 回 null（明確缺失標記），**唔回空字串**'
    + '——空字串同 null 喺 JS 都係 falsy，回空字串就令呼叫方'
    + '冇可能分辨「未發佈」同「發佈咗但網址係空」',
    /return null;/.test(body) && !/return\s+'';/.test(body));
}

console.log('\n=== A2-3 邊個階段要擋，由**範本實際文字**決定 ===');
{
  check('★★★★★ 有 assertPublicRosterUrlAvailableForStage_()',
    /function assertPublicRosterUrlAvailableForStage_/.test(mailer));

  const body = bodyOf(mailer, 'assertPublicRosterUrlAvailableForStage_');
  check('★★★★★ 睇範本嘅 subject／bodyHtml／bodyPlain 有冇嗰個 placeholder'
    + '——**唔係一個寫死嘅階段清單**。範本幹事改得，'
    + '寫死清單就會喺佢把連結加入審閱信之後靜靜失效',
    /t\.subject, t\.bodyHtml, t\.bodyPlain/.test(body)
    && /indexOf\('\{PublicRosterUrl\}'\)/.test(body));
  check('★★★★★ 冇範本用到 ⇒ 正常繼續（唔會無謂擋住 REVIEW／REMIND）',
    /if \(needing\.length === 0\) return;/.test(body));
  check('★★★★ 有連結 ⇒ 即刻返回，唔做任何嘢',
    /if \(publicRosterUrl\) return;/.test(body));
  check('★★★★★ sendStage() 喺**寄第一封之前**就叫嗰道關卡'
    + '——擺後面會變成「寄咗一半先發現」，而已經寄出嗰啲收唔返',
    // ⚠️ 第四十輪批次 A 組：呢度本來搵 `listRecipients_(stage, context).forEach`
    // 呢一句字。加咗「收件範圍」之後，嗰個迴圈變成
    // `filterRecipientsByScope_(listRecipients_(...), ...).forEach`，字面對唔上——
    // 但佢要守嗰件事（**關卡要喺寄第一封之前**）一啲都冇變。
    //
    // 所以改成對住「真正寄出嗰一刻」（`deliverOne_()` 第一次被叫）比。
    // 呢個比原本嗰個準：中間再加幾多層包裝都唔會令呢條斷言失效，
    // 而「關卡走到寄信後面」一定會捉到。
    mailer.indexOf('assertPublicRosterUrlAvailableForStage_(')
      < mailer.indexOf('outcomes.push(deliverOne_('));
}

console.log('\n=== A2-3 null → 空字串嘅轉換要講明點解安全 ===');
{
  const body = bodyOf(mailer, 'applyPlaceholders_');
  check('★★★★ null／undefined 轉成空字串（唔會印出 "null" 三個字）',
    /=== null \|\| placeholders\[key\] === undefined/.test(body));
  check('★★★★★ 而且註解要講明「只係因為上面有關卡先安全」'
    + '——冇咗嗰道關卡，呢一行就會變返「靜靜把缺失變成空白」',
    /assertPublicRosterUrlAvailableForStage_/.test(body));
}

console.log('\n=== A2-4：區四要有「重新發佈公開連結」 ===');
{
  check('★★★★★ 有 apiRepublishPublicLink 後端', /function apiRepublishPublicLink/.test(guards));
  const body = bodyOf(guards, 'apiRepublishPublicLink');
  check('★★★★ 第一行有 assertWebAppRequestAllowed_()',
    /^function apiRepublishPublicLink\(quarterId\) \{\s*\n\s*assertWebAppRequestAllowed_\(\);/.test(body));
  check('★★★★★ 冇版本時擋住，唔會發佈一個空嘅嘢',
    body.indexOf('這一季還沒有任何版本，沒有東西可以發佈。') !== -1);
  check('★★★★★ 區四有呢粒掣（掣 2 嘅錯誤訊息指去呢度，所以一定要有）',
    // 第二十七輪批次階段 A：狀態改成由參數傳入（唔再喺函式入面自己讀快取）。
    // 第二十七輪批次階段 F：整個區四由共通層搬咗去 ScriptZone4.html。
    /function renderRepublishEntry/.test(zone4)
    && /renderZone4[\s\S]{0,400}?renderRepublishEntry\(d\)/.test(zone4));
  check('★★★★ 而且會按目前狀態講唔同嘅話（有／冇／查唔到）',
    /link\.checkFailed[\s\S]{0,200}?link\.hasLink/.test(zone4));
}

console.log('\n=== A2：dashboard 帶埋公開連結狀態，令前端可以提早講 ===');
{
  check('★★★★ apiGetDashboardState 回傳有 publicLink',
    /publicLink: publicLink/.test(dash));
  check('★★★★★ 前端**唔會**因為 checkFailed 就當成有連結而放行'
    + '——後端仲有一道 assertPublicLinkReady_() 兜底',
    /link && !link\.hasLink/.test(zone1));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);

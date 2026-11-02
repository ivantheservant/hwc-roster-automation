// 第九十三輪批次 TD 組：〔寄出申報邀請〕改名為〔邀請義工申報不能服侍的日子〕。
// 執行方式：node tests/round93_td_invite_rename.test.js
//
//   TD1 按鈕、預覽窗標題、完成窗、runAction 文字、只可查看放行名單：全部用新名；src 使用者可見字串沒有舊名（AuditLog 內文除外）
//   TD2 預覽窗說明句原文；預覽窗有指去「進階與診斷 ▸ 寄出電郵範本樣本」的一句（行名要存在：由 round92_sc 的掃描覆蓋，這裡再核對一次）
//   TD3 季前資料及指南三份內容檔（檔案存在才檢查）沒有舊名

const fs = require('fs');
const path = require('path');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 900));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const NEW = '邀請義工申報不能服侍的日子';
const OLD = '寄出申報邀請';
function stripComments(t) {
  return t.replace(/<!--[\s\S]*?-->/g, (b) => b.replace(/[^\n]/g, ' ')).replace(/\/\*[\s\S]*?\*\//g, (b) => b.replace(/[^\n]/g, ' ')).replace(/^(\s*)\/\/.*$/gm, '$1');
}

console.log('\n=== TD1：新名 ===');
{
  const z2 = read('src/ui/ScriptZone2.html');
  check('★★★★★★ 開季前準備的按鈕是〔' + NEW + '〕', z2.indexOf("button('" + NEW + "', () => openUnavailableInvite()") !== -1);
  check('★★★★★ 預覽窗標題、完成窗標題、寄出動作文字都用新名', z2.indexOf("openModal('" + NEW + "：'") !== -1 && z2.indexOf("runAction('" + NEW + "'") !== -1 && z2.indexOf("openModal('" + NEW + "', [make") !== -1);
  check('★★★★ 只可查看的人仍然可以打開預覽（放行名單用新名）', read('src/ui/Script.html').indexOf("['寄出季前資料', '" + NEW + "']") !== -1);
  const hits = [];
  ['src', 'src/ui'].forEach((dir) => {
    fs.readdirSync(path.join(ROOT, dir)).filter((f) => /\.(gs|html)$/.test(f)).forEach((f) => {
      stripComments(read(dir + '/' + f)).split('\n').forEach((line, i) => {
        // AuditLog 內文「封申報邀請」不算介面文字；寫入紀錄的 notes 保留
        if (line.indexOf(OLD) !== -1) hits.push(dir + '/' + f + ':' + (i + 1) + '　' + line.trim());
      });
    });
  });
  check('★★★★★★ src/ 沒有舊名「' + OLD + '」', hits.length === 0, hits.join('\n'));
  check('★★★★ AuditLog 的 action 名（UNAVAILABLE_INVITE_SENT）沒有改', read('src/UnavailableInvite.gs').indexOf("'UNAVAILABLE_INVITE_SENT'") !== -1);
}

console.log('\n=== TD2：預覽窗句子 ===');
{
  const z2 = read('src/ui/ScriptZone2.html');
  check('★★★★★★ 說明句：「寄信給本季可能被安排的人，請他們用自己的個人專屬連結，申報這一季哪些主日不能服侍。」',
    z2.indexOf('寄信給本季可能被安排的人，請他們用自己的個人專屬連結，申報這一季哪些主日不能服侍。') !== -1);
  check('★★★★★★ 預覽窗有一句：「想先看看義工會見到甚麼，可以用「進階與診斷 ▸ 寄出電郵範本樣本」寄一封給自己。」',
    z2.indexOf('想先看看義工會見到甚麼，可以用「進階與診斷 ▸ 寄出電郵範本樣本」寄一封給自己。') !== -1);
  check('★★★★ 那一行真的在「進階與診斷」', /zone4Row\('寄出電郵範本樣本'/.test(read('src/ui/ScriptZone4.html')));
}

console.log('\n=== TD3：指南（檔案存在才檢查）===');
{
  let n = 0;
  ['guide/指南內容.md', 'guide/快速指南內容.md', 'guide/新功能快速指南內容.md'].forEach((f) => {
    if (!fs.existsSync(path.join(ROOT, f))) return;
    n++;
    const t = read(f);
    check('★★★★ ' + f + ' 沒有舊名，並用新名', t.indexOf(OLD) === -1 && t.indexOf(NEW) !== -1);
  });
  if (n === 0) console.log('SKIP  guide/ 不在 repo（gitignore）');
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);

// 第八十七輪批次 NC 組：幹事介面開放給教會網域名單上的人。
// 執行方式：node tests/round87_nc_domain_access.test.js
//
//   NC1　appsscript.json：access＝DOMAIN、executeAs＝USER_DEPLOYING
//   NC2　第 3 層名單照舊生效：不在名單 ⇒ 中性頁；只可查看的人照樣進得到
//   NC3　WebApp.gs 檔頭、上線檢查（三層防護那一項）、說明文件同步改
//   NC4　部署腳本（本機檔，不在 git）：幹事介面照 appsscript.json（DOMAIN），個人連結臨時改 ANYONE_ANONYMOUS
// 下面用假資料（example.invalid）。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 700));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

console.log('\n=== NC1：appsscript.json ===');
const manifest = JSON.parse(read('src/appsscript.json'));
check('★★★★★★ webapp.access＝DOMAIN', manifest.webapp.access === 'DOMAIN', JSON.stringify(manifest.webapp));
check('★★★★★★ webapp.executeAs 照舊 USER_DEPLOYING', manifest.webapp.executeAs === 'USER_DEPLOYING');

console.log('\n=== NC2：第 3 層名單照舊生效 ===');
function run(email) {
  const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'WebApp.gs']);
  gas.Session = { getActiveUser: () => ({ getEmail: () => email }) };
  gas.getConfig = function (key, d) {
    if (key === gas.CONFIG_KEYS.WEBAPP_ENABLED) return true;
    if (key === gas.CONFIG_KEYS.WEBAPP_ALLOWED_EMAILS) return ['staff@example.invalid'];
    if (key === gas.CONFIG_KEYS.WEBAPP_VIEWER_EMAILS) return ['viewer@example.invalid'];
    return d;
  };
  gas.log_ = () => {};
  gas.HtmlService = {
    createTemplateFromFile: () => ({ evaluate: () => { const o = { kind: 'INDEX', setTitle: () => o, addMetaTag: () => o }; return o; } }),
    createHtmlOutput: (html) => { const o = { html: html, setTitle: () => o }; return o; }
  };
  return gas.doGet({ parameter: {} });
}
check('★★★★★★ 同網域但不在名單 ⇒ 中性頁「這個網址只供幹事使用」', /這個網址只供幹事使用/.test(run('member@example.invalid').html || ''));
check('★★★★★★ 可以修改的人、只可查看的人 ⇒ 打開介面', run('staff@example.invalid').kind === 'INDEX' && run('viewer@example.invalid').kind === 'INDEX');

console.log('\n=== NC3：說明同步 ===');
const web = read('src/WebApp.gs');
check('★★★★★ WebApp.gs 檔頭寫 DOMAIN、第 3 層兩個名單', /`webapp\.access = "DOMAIN"`/.test(web) && /WEBAPP_VIEWER_EMAILS/.test(web.slice(0, 3000)));
const pre = read('src/PreLaunchChecklist.gs');
check('★★★★★ 上線檢查：靜態設定寫 DOMAIN；第 3 層列出只可查看名單', /webapp\.access=DOMAIN/.test(pre) && !/webapp\.access=MYSELF/.test(pre)
  && /WEBAPP_VIEWER_EMAILS（只可查看）=/.test(pre));
check('★★★★ 上線檢查的人手核實紀錄講明幹事介面已改、待人手核實', /Anyone within 教會網域（第八十七輪起，待人手核實/.test(pre));
check('★★★★ 說明文件：幹事介面規格、操作說明、實測步驟寫 DOMAIN', /access = DOMAIN/.test(read('docs/幹事介面規格.md'))
  && /access=DOMAIN/.test(read('docs/幹事操作說明.md')) && /應該係 `DOMAIN`/.test(read('docs/WebUI實測步驟.md')));

console.log('\n=== NC4：部署腳本 ===');
const deployPath = path.join(ROOT, 'deploy', 'push_and_deploy.ps1');
if (fs.existsSync(deployPath)) {
  const ps = fs.readFileSync(deployPath, 'utf8');
  check('★★★★★★ 部署腳本：先確認 appsscript.json 是 DOMAIN', /"access"\\s\*:\\s\*"DOMAIN"'\)\)\.Count -ne 1/.test(ps));
  check('★★★★★★ 個人連結：臨時把 DOMAIN 改成 ANYONE_ANONYMOUS，做完還原', /Replace\(\$manifestText, '"access"\\s\*:\\s\*"DOMAIN"', '"access": "ANYONE_ANONYMOUS"'\)/.test(ps)
    && /Copy-Item -Path \$Backup -Destination \$Manifest/.test(ps));
} else {
  console.log('（略過：deploy/push_and_deploy.ps1 不在這部電腦）');
}

console.log(fail === 0 ? '\nALL PASS' : '\n' + fail + ' FAILURE(S)');
process.exitCode = fail === 0 ? 0 : 1;

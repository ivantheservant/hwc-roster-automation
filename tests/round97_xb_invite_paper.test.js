// 第九十七輪批次 XB 組：沒有電郵的人的申報邀請——匯出 docx 或寄給自己。
// 執行方式：node tests/round97_xb_invite_paper.test.js
//
//   XB1 畫面只列這一季申報邀請對象中沒有實際電郵的人（XA 規則：補填了電郵就不列）；不回傳 token
//   XB2 前端：預設全部勾選；〔全選〕〔全部不選〕；提示句；兩個出口；預覽窗「沒有電郵」那一行旁有按鈕
//   XB3 docx：每人一頁；有姓名、截止日、個人專屬連結（超連結）；存入該季資料夾（不另外分享）
//   XB4 寄給自己：只寄給操作者自己（不接受參數），附上同一份 docx；DRY_RUN 照樣寄（理由見檔頭）；經寄信閘門
//   XB5 AuditLog INVITE_PAPER_EXPORTED（方式、人數）；不寫 SendLog；token／連結不入 AuditLog 及 log
//   XB6 只可以選名單上的人（有電郵、沒有個人連結的不可以）
// 用假資料（P97xx、假名、假 token、example.invalid）。

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { buildUnavailableScene, tok } = require('./helpers/unavailable_scene.js');
const { loadUiScripts } = require('./helpers/ui_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra !== undefined) console.log('      ' + String(extra).slice(0, 900));
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const SELF = 'k@example.invalid';

function scene() {
  const sc = buildUnavailableScene({ extraFiles: ['ManualEmail.gs', 'InvitePaper.gs', 'PdfFolders.gs', 'MailRedirect.gs'] });
  const g = sc.gas;
  g.assertWebAppRequestAllowed_ = function () {};
  sc.logs = [];
  g.log_ = function (lvl, msg) { sc.logs.push(String(msg)); };
  // Drive：該季資料夾
  sc.created = [];
  const folder = (name) => ({
    name: name,
    getFoldersByName: (n) => { const f = folder(n); return { hasNext: () => true, next: () => f }; },
    createFolder: (n) => folder(n),
    createFile: (blob) => { sc.created.push({ folder: name, blob: blob }); return { getUrl: () => 'https://example.invalid/drive/' + blob.name }; }
  });
  g.resolveMailAttachmentFolder_ = () => folder('ROOT');
  g.isPersonalMyDriveFolder_ = () => false;
  g.LockService.getScriptLock = () => ({ waitLock: () => {}, tryLock: () => true, releaseLock: () => {} });
  // .docx：Utilities.zip／newBlob
  sc.zips = [];
  g.Utilities.newBlob = function (data, type, name) {
    return { data: data, type: type, name: name, getBytes: () => data, getName: () => name };
  };
  g.Utilities.zip = function (blobs, name) { sc.zips.push({ name: name, parts: blobs }); return { getBytes: () => blobs, name: name }; };
  sc.mails = [];
  g.MailApp = { sendEmail: function (to, subject, body, options) { sc.mails.push({ to: to, subject: subject, body: body, options: options }); } };
  g.Session = { getActiveUser: () => ({ getEmail: () => SELF }) };
  return sc;
}
const partText = (zip, name) => (zip.parts.filter((b) => b.name === name)[0] || {}).data || '';

console.log('\n=== XB1：畫面 ===');
{
  const sc = scene();
  const g = sc.gas;
  const v = g.apiGetInvitePaperView(sc.Q);
  check('（前置）P9707 沒有電郵、是申報邀請對象', v.people.some((p) => p.personId === 'P9707'), JSON.stringify(v.people));
  check('★★★★★★ 只列沒有實際電郵的人', v.people.every((p) => !g.indexPeopleById_()[p.personId].email));
  check('★★★★★★ 不回傳 token（只有 hasLink）', JSON.stringify(v).indexOf(tok(7)) === -1 && v.people.every((p) => p.hasLink === true && !('token' in p)));
  check('★★★★ 提示句', v.hint === '也可以先用〔補填電郵〕補上電郵，再用電郵寄出。');
  g.saveManualEmails_locked_(sc.Q, [{ personId: 'P9707', email: 'p9707-manual@example.invalid' }]);
  check('★★★★★★ 補填了電郵 ⇒ 不再列（XA 規則）', !g.apiGetInvitePaperView(sc.Q).people.some((p) => p.personId === 'P9707'));
}

console.log('\n=== XB3／XB5：產生 docx ===');
{
  const sc = scene();
  const g = sc.gas;
  const r = g.apiExportInvitePaperDocx(sc.Q, ['P9707']);
  check('★★★★★★ 回傳下載連結及檔名（.docx）', r.ok && /\.docx$/.test(r.fileName) && /^https:\/\/example\.invalid\/drive\//.test(r.fileUrl), JSON.stringify(r));
  check('★★★★★ 存入該季資料夾（RosterPDF/<季度>）', sc.created.length === 1 && sc.created[0].folder === sc.Q);
  check('★★★★ Word 檔的類型', sc.created[0].blob.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  const zip = sc.zips[0];
  check('★★★★★ docx 有四個部分', ['[Content_Types].xml', '_rels/.rels', 'word/_rels/document.xml.rels', 'word/document.xml'].every((n) => !!partText(zip, n)));
  const doc = partText(zip, 'word/document.xml');
  const rels = partText(zip, 'word/_rels/document.xml.rels');
  const dates = g.readUnavailableInviteDates_(sc.Q);
  check('★★★★★★ 內容有姓名', doc.indexOf('姓名：' + sc.nameOf('P9707')) !== -1);
  check('★★★★★★ 內容有截止日', !!dates.deadline && doc.indexOf(dates.deadline) !== -1, dates.deadline);
  check('★★★★★★ 有個人專屬連結（超連結，連結含這個人的 token）', /<w:hyperlink r:id="rIdLink1">/.test(doc) && rels.indexOf(tok(7)) !== -1 && /TargetMode="External"/.test(rels));
  const r2 = g.apiExportInvitePaperDocx(sc.Q, ['P9707', 'P9707']);
  check('★★★★ 每人一頁（第二頁之前有分頁）', (partText(sc.zips[1], 'word/document.xml').match(/<w:br w:type="page"\/>/g) || []).length === 1 && r2.count === 2);
  const audits = sc.audits('INVITE_PAPER_EXPORTED');
  const A = sc.C.AUDIT_LOG;
  check('★★★★★★ AuditLog INVITE_PAPER_EXPORTED（方式、人數）', audits.length === 2 && audits[0][A.NEW_VALUE] === 'DOCX|1', JSON.stringify(audits.map((a) => a[A.NEW_VALUE])));
  const allAudit = JSON.stringify(sc.audits());
  check('★★★★★★ token／連結不入 AuditLog 及 log', allAudit.indexOf(tok(7)) === -1 && sc.logs.join('\n').indexOf(tok(7)) === -1);
  check('★★★★★ 不寫 SendLog（不算已寄出）', !sc.ss.getSheetByName(sc.S.SEND_LOG) || g.readSheet_(sc.S.SEND_LOG).length === 0);
  check('★★★★ 不另外分享（沒有 setSharing）', !/setSharing|addViewer|addEditor/.test(read('src/InvitePaper.gs')));
}

console.log('\n=== XB4：寄給自己 ===');
{
  const sc = scene();
  const g = sc.gas;
  check('（前置）測試模式（DRY_RUN）', g.getConfig_('DRY_RUN', true) !== false);
  const r = g.apiEmailInvitePaperToSelf(sc.Q, ['P9707']);
  check('★★★★★★ 只寄一封，收件人是操作者自己', sc.mails.length === 1 && sc.mails[0].to === SELF, JSON.stringify(sc.mails.map((m) => m.to)));
  check('★★★★★★ 附上同一份 docx', sc.mails[0].options.attachments.length === 1 && /\.docx$/.test(sc.mails[0].options.attachments[0].name)
    && sc.created.length === 1 && sc.created[0].blob === sc.mails[0].options.attachments[0]);
  check('★★★★★ 信內文沒有個人連結／token', sc.mails[0].body.indexOf(tok(7)) === -1);
  check('★★★★★ DRY_RUN 時照樣寄（寄給自己，檔頭寫明理由）', r.ok && /DRY_RUN 時照樣寄出/.test(read('src/InvitePaper.gs')));
  check('★★★★★ 不接受收件人參數（函式只收季度及人）', /function apiEmailInvitePaperToSelf\(quarterId, personIds\)/.test(read('src/InvitePaper.gs'))
    && /const self = String\(Session\.getActiveUser\(\)\.getEmail\(\) \|\| ''\)\.trim\(\);/.test(read('src/InvitePaper.gs')));
  check('★★★★★ 經寄信閘門（sendMailThroughGate_）', /sendMailThroughGate_\(\{\s*to: self,/.test(read('src/InvitePaper.gs')));
  const A = sc.C.AUDIT_LOG;
  check('★★★★★ AuditLog 方式 EMAIL_SELF', sc.audits('INVITE_PAPER_EXPORTED')[0][A.NEW_VALUE] === 'EMAIL_SELF|1');
  check('★★★★★ token 不入 AuditLog', JSON.stringify(sc.audits()).indexOf(tok(7)) === -1);
  g.MailApp.sendEmail = () => { throw new Error('should not send'); };
  g.Session = { getActiveUser: () => ({ getEmail: () => '' }) };
  let err = '';
  try { g.apiEmailInvitePaperToSelf(sc.Q, ['P9707']); } catch (e) { err = e.message; }
  check('★★★★ 查不到自己的電郵 ⇒ 不寄', /查不到你自己的電郵地址/.test(err), err);
}

console.log('\n=== XB6：只可以選名單上的人 ===');
{
  const sc = scene();
  const g = sc.gas;
  let e1 = '';
  try { g.apiExportInvitePaperDocx(sc.Q, ['P9701']); } catch (e) { e1 = e.message; }
  check('★★★★★★ 有電郵的人不可以選', /不在名單上/.test(e1), e1);
  let e2 = '';
  try { g.apiExportInvitePaperDocx(sc.Q, []); } catch (e) { e2 = e.message; }
  check('★★★★ 一位都沒有選 ⇒ 說明', /一位都沒有選/.test(e2));
  check('★★★★ 沒有產生任何檔', sc.created.length === 0);
}

console.log('\n=== XB2：前端（第一百零一輪批次 ZC-3 刻意改動：合併為〔寄出／匯出申報不能服侍日子連結〕）===');
{
  const z2 = read('src/ui/ScriptZone2.html');
  const z5 = read('src/ui/ScriptZone5.html');
  check('★★★★★ 開季前準備不再有獨立的〔沒有電郵的人：匯出邀請〕，只有〔補填電郵〕', z2.indexOf('INVITE_PAPER_BUTTON_LABEL') === -1
    && /body\.appendChild\(row\(\[button\('補填電郵', \(\) => openManualEmails\(\), 'secondary'\)\]\)\);/.test(z2));
  check('★★★★★ 舊入口 openInvitePaper ⇒ 合併後的窗', /function openInvitePaper\(\) \{ openUnavailableInvite\(\); \}/.test(z5));
  check('★★★★★ 合併後的窗：沒有電郵的人同時產生 Word 檔（同一支 createInvitePaperDocx_）', /createInvitePaperDocx_\(id, who\.noEmailPeople\)/.test(read('src/UnavailableInvite.gs')));
  const webApp = read('src/WebApp.gs');
  const roList = (webApp.match(/const WEBAPP_READ_ONLY_APIS = \[([\s\S]*?)\];/) || ['', ''])[1];
  check('★★★★★ 權限：畫面讀取在唯讀清單；匯出、寄給自己不是', /'apiGetInvitePaperView'/.test(roList)
    && !/'apiExportInvitePaperDocx'|'apiEmailInvitePaperToSelf'/.test(roList));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);

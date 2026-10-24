// 第七十五輪批次 CL 組：公開職事表一律唯讀。
// 執行方式：node tests/round75_cl_public_readonly.test.js
//
// Ivan 手動測試 A：狀態卡「職事表的永久連結」〔開啟看看〕開出 `/edit`，佢可以直接改公開版。
// 「任何人都不應該可以直接改公開版。」
//
//   CL1　永久連結一律用唯讀顯示網址 `…/d/<ID>/preview`（狀態卡、電郵、個人頁、補寄同一個來源）
//   CL2　舊紀錄記低嘅 `/edit` 讀出嚟時轉成 `/preview`（舊信入面嘅 `/edit` 照樣有效——同一個檔案）
//   CL3　每次發佈：分享設定「知道連結的人可以檢視」＋每張工作表加保護（只留系統帳戶）
//   CL4　保護做唔到唔可以令發佈失敗（記 WARN）

const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 600));
}

const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'PublicRoster.gs']);
const warns = [];
gas.log_ = (lvl, msg) => { if (lvl === 'WARN') warns.push(msg); };
gas.getConfig = (key, fb) => (key === gas.CONFIG_KEYS.SCRIPT_ACCOUNT_EMAIL ? 'system@example.invalid' : fb);

console.log('\n=== CL1／CL2：唯讀顯示網址 ===');
{
  check('★★★★★★ 有檔案 ID ⇒ /preview', gas.buildPublicViewUrl_('ABC_1-x', '') === 'https://docs.google.com/spreadsheets/d/ABC_1-x/preview');
  check('★★★★★★ 舊紀錄 /edit 冇 ID ⇒ 轉 /preview',
    gas.buildPublicViewUrl_('', 'https://docs.google.com/spreadsheets/d/ZZZ/edit#gid=0') === 'https://docs.google.com/spreadsheets/d/ZZZ/preview');
  check('★★★★ 兩樣都冇 ⇒ 空字串', gas.buildPublicViewUrl_('', '') === '');
  check('★★★★★ 網址唔含 /edit', gas.buildPublicViewUrl_('X', '').indexOf('/edit') === -1);

  // findPublicLinkRow_：記低 /edit 都回 /preview
  const C = gas.COLUMNS.PUBLIC_LINKS;
  const row = {}; row[C.QUARTER_ID] = '2099T3'; row[C.FILE_ID] = 'FID9'; row[C.FILE_URL] = 'https://docs.google.com/spreadsheets/d/FID9/edit';
  gas.ensurePublicLinksSheet_ = () => ({});
  gas.readSheet = (name) => (name === gas.SHEETS.PUBLIC_LINKS ? [row] : []);
  const r = gas.findPublicLinkRow_('2099T3');
  check('★★★★★★ findPublicLinkRow_() 回 /preview（狀態卡、電郵、個人頁全部經呢度）',
    r && r.fileUrl === 'https://docs.google.com/spreadsheets/d/FID9/preview', r && r.fileUrl);
}

console.log('\n=== CL3：每次發佈都收窄分享＋保護每張工作表 ===');
function makeSpreadsheet(sheetNames, opts) {
  opts = opts || {};
  const sharingCalls = [];
  const sheets = sheetNames.map((name) => {
    const prot = {
      editors: ['someone@example.invalid'], desc: '', domainEdit: true, added: [],
      setDescription(d) { this.desc = d; return this; },
      getEditors() { return this.editors.slice(); },
      removeEditors(list) { this.editors = this.editors.filter((e) => list.indexOf(e) === -1); return this; },
      addEditor(e) { this.added.push(e); this.editors.push(e); return this; },
      canDomainEdit() { return this.domainEdit; },
      setDomainEdit(v) { this.domainEdit = v; return this; }
    };
    return {
      _prot: null,
      getName: () => name,
      getProtections() { return this._prot ? [this._prot] : []; },
      protect() { if (opts.protectThrows) throw new Error('no permission'); this._prot = prot; return prot; }
    };
  });
  return { sharingCalls, sheets, ss: { getId: () => 'FILE1', getSheets: () => sheets, getUrl: () => 'https://docs.google.com/spreadsheets/d/FILE1/edit' } };
}
{
  const m = makeSpreadsheet(['完整版', '多咗一張']);
  gas.DriveApp = {
    Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' }, Permission: { VIEW: 'VIEW' },
    getFileById: () => ({ setSharing: (a, p) => { m.sharingCalls.push(a + '/' + p); } })
  };
  gas.SpreadsheetApp = { ProtectionType: { SHEET: 'SHEET' } };
  const out = gas.enforcePublicRosterReadOnly_(m.ss);
  check('★★★★★★ 分享設定 = 知道連結的人可以檢視', m.sharingCalls.join(',') === 'ANYONE_WITH_LINK/VIEW', m.sharingCalls.join(','));
  check('★★★★★★ 每張工作表都加咗保護', out.protectedSheets === 2 && m.sheets.every((s) => s._prot), JSON.stringify(out));
  const p = m.sheets[0]._prot;
  check('★★★★★ 其他編輯者全部移走，只加返系統帳戶', p.editors.join(',') === 'system@example.invalid', p.editors.join(','));
  check('★★★★ 網域編輯關閉', p.domainEdit === false);
  // 再發佈一次：重用既有保護，唔會疊多一層
  const before = m.sheets[0]._prot;
  gas.enforcePublicRosterReadOnly_(m.ss);
  check('★★★★ 再發佈：重用同一個保護（唔會越疊越多）', m.sheets[0]._prot === before);
}

console.log('\n=== CL4：保護做唔到唔令發佈失敗 ===');
{
  const m = makeSpreadsheet(['完整版'], { protectThrows: true });
  warns.length = 0;
  let threw = false;
  try { gas.enforcePublicRosterReadOnly_(m.ss); } catch (e) { threw = true; }
  check('★★★★★ 唔拋錯', !threw);
  check('★★★★ 記 WARN', warns.some((w) => /加保護失敗/.test(w)), warns.join(' | '));
}

console.log('\n=== CL：publishPublicRoster_() 記低 /preview，而且有叫 enforce ===');
{
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'PublicRoster.gs'), 'utf8');
  const body = src.slice(src.indexOf('function publishPublicRoster_'), src.indexOf('function readPublicFileSharing_'));
  check('★★★★★★ 發佈時叫 enforcePublicRosterReadOnly_()', /enforcePublicRosterReadOnly_\(resolved\.spreadsheet\)/.test(body));
  check('★★★★★★ 記低嘅網址係 buildPublicViewUrl_()（唔係 getUrl() 嘅 /edit）',
    /const fileUrl = buildPublicViewUrl_\(fileId, resolved\.spreadsheet\.getUrl\(\)\);/.test(body));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);

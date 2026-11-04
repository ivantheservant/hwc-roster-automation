/**
 * 第九十七輪批次 XB 組：沒有電郵的人的申報邀請——匯出 Word 檔（.docx）或寄給自己。
 *
 * ── 列出誰 ────────────────────────────────────────────────────────
 * 這一季申報邀請的對象之中，沒有實際電郵的人（`buildUnavailableInviteRecipients_()` 的 `noEmailPeople`，
 * 實際電郵照 XA 組 `effectivePersonEmail_()`）。沒有個人連結 token 的人照列，但不可以選（沒有連結可以印）。
 *
 * ── 內容 ──────────────────────────────────────────────────────────
 * 每人一頁：`TPL_UNAVAILABLE_INVITE_TC` 為這個人套入之後的純文字內文（姓名、季度、生成日、截止日、個人專屬連結），
 * 最後一行再寫一次「個人專屬連結：…」（可以按的連結）。
 *
 * ── 為甚麼自己砌 .docx，不用 Google 文件匯出 ─────────────────────
 * 用 Google 文件（DocumentApp）要加一個新的授權範圍；幹事介面以部署者身分執行，加範圍之後要部署者重新授權，
 * 未授權之前整個幹事介面都會用不到。.docx 本身是一個 zip（幾個 XML 檔），`Utilities.zip()` 已經做得到，
 * 不用新權限。
 *
 * ── 沒有 QR code ──────────────────────────────────────────────────
 * Apps Script 沒有內建產生 QR code 圖片的方法；用外面的 QR code 網站，等於把含 token 的個人連結交給第三方。
 * 所以只放連結（可以按，亦可以照打）。
 *
 * ── 個人連結含 token ──────────────────────────────────────────────
 * 檔案只存在該季 PDF 資料夾（Shared Drive，幹事才可以存取），不另外分享；連結和 token 不寫入 log／AuditLog。
 *
 * ── 寄給自己 ──────────────────────────────────────────────────────
 * 收件人永遠是正在操作的人自己（`Session.getActiveUser()`），不接受參數。和紙本包（PaperPack.gs）同一個理由：
 * DRY_RUN 要守住的是「不會有事奉人員收到一封他不預期的信」，寄給自己不違反這一點，所以 DRY_RUN 時照樣寄出；
 * 仍然經寄信閘門（測試期間 MAIL_REDIRECT_ALL_TO 有值就轉寄）。
 *
 * ── 紀錄 ──────────────────────────────────────────────────────────
 * AuditLog `INVITE_PAPER_EXPORTED`（方式、人數）。不寫 SendLog，不算「已寄出」。
 */

const INVITE_PAPER_AUDIT_ACTION = 'INVITE_PAPER_EXPORTED';
const INVITE_PAPER_HINT = '也可以先用〔補填電郵〕補上電郵，再用電郵寄出。';
const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * 這一季沒有電郵的申報邀請對象（伺服器端，含 token）。
 * @returns {Object[]} {personId, displayName, token}
 */
function listInvitePaperPeople_() {
  const timezone = getConfig_(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const today = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');
  return buildUnavailableInviteRecipients_(today).noEmailPeople || [];
}

/**
 * 供前端呼叫：〔沒有電郵的人：匯出邀請〕畫面。**純讀取。**（不回傳 token）
 * @param {string} quarterId 季度 ID
 * @returns {Object}
 */
function apiGetInvitePaperView(quarterId) {
  assertWebAppRequestAllowed_('apiGetInvitePaperView');
  const id = String(quarterId || '').trim();
  beginSheetReadMemo_();
  try {
    const dates = readUnavailableInviteDates_(id);
    return {
      quarterId: id,
      quarterLabel: buildQuarterLabel_(id),
      generateDate: dates.generateDate,
      deadline: dates.deadline,
      hint: INVITE_PAPER_HINT,
      baseUrlMissing: !String(getConfig_(CONFIG_KEYS.WEBAPP_VOLUNTEER_URL, '') || '').trim(),
      people: listInvitePaperPeople_().map(function (p) {
        return { personId: p.personId, displayName: p.displayName, hasLink: !!p.token };
      })
    };
  } finally {
    endSheetReadMemo_();
  }
}

/**
 * 揀好的人（只可以是沒有電郵、有個人連結的人）。揀了其他人 ⇒ 拋錯。
 * @param {string[]} personIds
 * @returns {Object[]} {personId, displayName, token}
 */
function pickInvitePaperPeople_(personIds) {
  const wanted = (Array.isArray(personIds) ? personIds : []).map(function (x) { return String(x || '').trim(); })
    .filter(function (x) { return !!x; });
  if (wanted.length === 0) {
    throw new Error(buildThreePartMessage_('一位都沒有選。', '甚麼都沒有產生。', ['在名單上勾選要匯出的人，再按一次']));
  }
  const byId = {};
  listInvitePaperPeople_().forEach(function (p) { byId[p.personId] = p; });
  const bad = wanted.filter(function (id) { return !byId[id] || !byId[id].token; });
  if (bad.length > 0) {
    throw new Error(buildThreePartMessage_('選了 ' + bad.length + ' 位不在名單上（已經有電郵，或者沒有個人連結）的人。',
      '甚麼都沒有產生。', ['按〔重新整理〕再開一次這個畫面，再勾選']));
  }
  return wanted.map(function (id) { return byId[id]; });
}

/**
 * 每人一頁的內容（純文字段落＋連結）。
 * @param {string} quarterId 季度 ID
 * @param {Object[]} people {personId, displayName, token}
 * @returns {{pages: Object[], baseUrl: string}} pages：{displayName, lines: string[], link: string}
 */
function buildInvitePaperPages_(quarterId, people) {
  const config = readConfig_();
  const baseUrl = String(config[CONFIG_KEYS.WEBAPP_VOLUNTEER_URL] || '').trim();
  if (!baseUrl) {
    throw new Error(buildThreePartMessage_('還沒有設定事奉人員個人連結的網址（Config WEBAPP_VOLUNTEER_URL）。',
      '甚麼都沒有產生。', ['請管理員先在 Config 填上個人連結部署的 /exec 網址']));
  }
  const dates = readUnavailableInviteDates_(quarterId);
  const tpl = findEmailTemplateById_(UNAVAILABLE_INVITE_TEMPLATE_ID) || unavailableInviteTemplateDefault_();
  const pages = people.map(function (p) {
    const link = buildPersonalRosterUrl_(baseUrl, p.token, quarterId);
    const placeholders = {
      QuarterLabel: buildQuarterLabel_(quarterId), QuarterID: quarterId,
      GenerateDate: dates.generateDate || '生成日', Deadline: dates.deadline || '生成日之前',
      PersonalLink: link
    };
    const plain = applyPlaceholders_(tpl.bodyPlain, placeholders, { displayName: p.displayName, personId: p.personId }, '');
    return { displayName: p.displayName, lines: String(plain).split(/\r?\n/), link: link };
  });
  return { pages: pages, baseUrl: baseUrl };
}

/** XML 轉義。 */
function escapeDocxText_(text) {
  return String(text === null || text === undefined ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * 砌 .docx 的四個 XML 檔（純函式，測試用得到）。每人一頁；連結用超連結（document.xml.rels 的外部目標）。
 * @param {string} title 第一頁頂的標題
 * @param {Object[]} pages {displayName, lines, link}
 * @returns {Object.<string, string>} 檔名 → XML
 */
function buildInvitePaperDocxParts_(title, pages) {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const rels = [];
  const run = function (text, bold) {
    return '<w:r>' + (bold ? '<w:rPr><w:b/></w:rPr>' : '') + '<w:t xml:space="preserve">' + escapeDocxText_(text) + '</w:t></w:r>';
  };
  const para = function (inner) { return '<w:p>' + inner + '</w:p>'; };
  const linkPara = function (label, url) {
    const id = 'rIdLink' + (rels.length + 1);
    rels.push('<Relationship Id="' + id + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="'
      + escapeDocxText_(url) + '" TargetMode="External"/>');
    return para(run(label, true) + '<w:hyperlink r:id="' + id + '"><w:r><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr>'
      + '<w:t xml:space="preserve">' + escapeDocxText_(url) + '</w:t></w:r></w:hyperlink>');
  };
  const body = [];
  pages.forEach(function (p, i) {
    if (i > 0) body.push(para('<w:r><w:br w:type="page"/></w:r>'));
    body.push(para(run(title, true)));
    body.push(para(run('姓名：' + p.displayName, true)));
    body.push(para(''));
    p.lines.forEach(function (line) { body.push(para(run(line, false))); });
    body.push(para(''));
    body.push(linkPara('個人專屬連結：', p.link));
  });
  return {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + '</Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
      + '</Relationships>',
    'word/_rels/document.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels.join('') + '</Relationships>',
    'word/document.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<w:document xmlns:w="' + W + '" xmlns:r="' + R + '"><w:body>' + body.join('')
      + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>'
      + '</w:body></w:document>'
  };
}

/**
 * 產生 .docx 並存入該季的 PDF 資料夾（不另外分享）。
 * @param {string} quarterId 季度 ID
 * @param {Object[]} people {personId, displayName, token}
 * @returns {{blob: Blob, fileUrl: string, fileName: string}}
 */
function createInvitePaperDocx_(quarterId, people) {
  const built = buildInvitePaperPages_(quarterId, people);
  const title = buildQuarterLabel_(quarterId) + '　申報不能服侍的日子';
  const parts = buildInvitePaperDocxParts_(title, built.pages);
  const fileName = quarterId + '_申報邀請_沒有電郵_' + compactTimestamp_() + '.docx';
  const blobs = Object.keys(parts).map(function (name) {
    return Utilities.newBlob(parts[name], 'application/xml', name);
  });
  const zipped = Utilities.zip(blobs, fileName);
  const blob = Utilities.newBlob(zipped.getBytes(), DOCX_MIME_TYPE, fileName);
  const folder = getOrCreateQuarterPdfFolder_(quarterId);
  const file = folder.createFile(blob);
  return { blob: blob, fileUrl: file.getUrl(), fileName: fileName };
}

/** AuditLog（方式、人數；不寫連結、token、名字以外的資料）。 */
function writeInvitePaperAudit_(quarterId, method, count) {
  writeAuditLog_({
    action: INVITE_PAPER_AUDIT_ACTION,
    targetSheet: SHEETS.QUARTERS,
    targetKey: quarterId,
    oldValue: '',
    newValue: method + '|' + count,
    source: 'InvitePaper',
    notes: (method === 'DOCX' ? '產生 Word 檔' : '寄給操作者自己') + '：' + count + ' 位沒有電郵的人的申報邀請（不算已寄出）'
  });
}

/**
 * 供前端呼叫：〔產生 docx〕。**會寫入 Drive＋AuditLog。**
 * @param {string} quarterId 季度 ID
 * @param {string[]} personIds 揀好的人
 * @returns {{ok: boolean, count: number, fileUrl: string, fileName: string, message: string}}
 */
function apiExportInvitePaperDocx(quarterId, personIds) {
  assertWebAppRequestAllowed_();
  return withMutationLock_('匯出申報邀請（Word 檔）', function () {
    const id = String(quarterId || '').trim();
    const people = pickInvitePaperPeople_(personIds);
    const made = createInvitePaperDocx_(id, people);
    writeInvitePaperAudit_(id, 'DOCX', people.length);
    return { ok: true, count: people.length, fileUrl: made.fileUrl, fileName: made.fileName,
      message: '已產生 Word 檔（' + people.length + ' 位，每人一頁），存在這一季的 PDF 資料夾。按下面的連結下載。' };
  });
}

/**
 * 供前端呼叫：〔寄給自己〕。收件人只可以是正在操作的人自己。**會寄信（DRY_RUN 時照樣寄，理由見檔頭）＋寫 Drive＋AuditLog。**
 * @param {string} quarterId 季度 ID
 * @param {string[]} personIds 揀好的人
 * @returns {{ok: boolean, count: number, fileUrl: string, message: string}}
 */
function apiEmailInvitePaperToSelf(quarterId, personIds) {
  assertWebAppRequestAllowed_();
  return withMutationLock_('申報邀請（Word 檔）寄給自己', function () {
    const id = String(quarterId || '').trim();
    const self = String(Session.getActiveUser().getEmail() || '').trim();
    if (!self) {
      throw new Error(buildThreePartMessage_('查不到你自己的電郵地址。', '一封都沒有寄出。',
        ['重新載入這一頁再試一次', '或者改用〔產生 docx〕，從連結下載']));
    }
    const people = pickInvitePaperPeople_(personIds);
    const made = createInvitePaperDocx_(id, people);
    const label = buildQuarterLabel_(id);
    sendMailThroughGate_({
      to: self,
      displayName: '操作者自己（申報邀請）',
      subject: '沒有電郵的人的申報邀請：' + label,
      bodyHtml: null,
      bodyPlain: [label + '　申報不能服侍的日子',
        '',
        '這一封附上一份 Word 檔，是給 ' + people.length + ' 位沒有電郵的人的申報邀請（每人一頁），可以印出交給他們。',
        '',
        people.map(function (p) { return '　・' + p.displayName; }).join('\n'),
        '',
        '這一封是系統寄給你自己的，沒有任何一位事奉人員會收到。'].join('\n'),
      options: { attachments: [made.blob] }
    });
    writeInvitePaperAudit_(id, 'EMAIL_SELF', people.length);
    return { ok: true, count: people.length, fileUrl: made.fileUrl,
      message: '已寄到你自己的信箱（附上 Word 檔，' + people.length + ' 位）。同一份檔案亦存在這一季的 PDF 資料夾。' };
  });
}

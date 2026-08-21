// 第十一輪批次階段 C：ICS 日曆檔附件。
// 執行方式：node tests/ics_calendar.test.js
//
// IcsExport.gs 分兩層（見該檔案檔頭說明）：
//   1. 純函式（buildIcsCalendarText_ 及其輔助函式）：完全不呼叫任何 GAS API，
//      用 gas_loader 載入真正原始碼直接測試。
//   2. GAS 包裝層（buildIcsAttachmentForPerson_）：要真正碰 Config／Posts／
//      Utilities，冇 GAS 執行環境跑唔到，用靜態原始碼檢查鎖住 C4／C5 的
//      守門條件與 C3 的 MIME type／副檔名寫法。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'IcsExport.gs']);

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}
function checkEqual(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}

const SRC = path.join(__dirname, '..', 'src');
const icsSource = fs.readFileSync(path.join(SRC, 'IcsExport.gs'), 'utf8');
const mailerSource = fs.readFileSync(path.join(SRC, 'Mailer.gs'), 'utf8');

/**
 * 把 buildIcsCalendarText_() 產出的原始 ICS 文字按 CRLF 拆成「已折疊」的
 * 物理行（不是邏輯行——折疊後同一個邏輯行會佔多個物理行，延續行以一個
 * 空白開頭），用來檢查 RFC 5545 折行規則。
 */
function splitPhysicalLines(icsText) {
  // 結尾多一個 CRLF，最後一個元素會是空字串，過濾掉
  return icsText.split('\r\n').filter(function (l) { return l !== ''; });
}

function utf8ByteLength(str) {
  return Buffer.byteLength(str, 'utf8');
}

const BASE_OPTS = {
  quarterId: '2099T1',
  versionNo: 3,
  personId: 'P001',
  assignments: [
    { serviceDate: '2099-01-04', postId: 'AUDIO', slotIndex: 1, postNameTC: '音響' },
    { serviceDate: '2099-01-04', postId: 'CHAIR', slotIndex: 1, postNameTC: '主席' }
  ],
  earlyMinutesByPost: { AUDIO: 45, CHAIR: 0 },
  defaultStartTime: '10:45',
  defaultEndTime: '12:00',
  dtstampUtc: '20990101T000000Z'
};

console.log('\n=== C2【核心】UID 跨版本穩定，唔含 VersionNo ===');
{
  const textV3 = gas.buildIcsCalendarText_(Object.assign({}, BASE_OPTS, { versionNo: 3 }));
  const textV7 = gas.buildIcsCalendarText_(Object.assign({}, BASE_OPTS, { versionNo: 7 }));
  const uidsV3 = (textV3.match(/^UID:.*$/gm) || []);
  const uidsV7 = (textV7.match(/^UID:.*$/gm) || []);
  checkEqual('★★ 同一組派工，版本 3 同版本 7 嘅 UID 完全相同', uidsV3, uidsV7);
  check('★ UID 本身唔含版本號字樣（避免版本一改 UID 就變）', uidsV3.every(function (u) { return u.indexOf('v3') === -1 && u.indexOf('v7') === -1; }));
}

console.log('\n=== C2【核心】SEQUENCE 隨版本遞增 ===');
{
  const textV3 = gas.buildIcsCalendarText_(Object.assign({}, BASE_OPTS, { versionNo: 3 }));
  const textV7 = gas.buildIcsCalendarText_(Object.assign({}, BASE_OPTS, { versionNo: 7 }));
  const seqV3 = (textV3.match(/^SEQUENCE:(\d+)$/gm) || []);
  const seqV7 = (textV7.match(/^SEQUENCE:(\d+)$/gm) || []);
  check('★★ 版本 3 兩個 VEVENT 嘅 SEQUENCE 都係 3', seqV3.every(function (l) { return l === 'SEQUENCE:3'; }) && seqV3.length === 2);
  check('★★ 版本 7 兩個 VEVENT 嘅 SEQUENCE 都係 7（比版本 3 大）', seqV7.every(function (l) { return l === 'SEQUENCE:7'; }) && seqV7.length === 2);
}

console.log('\n=== C1【核心】崗位提早到場分鐘數正確套用 ===');
{
  checkEqual('★★ shiftIcsLocalDateTime_：提早 45 分鐘，10:45 → 10:00',
    gas.shiftIcsLocalDateTime_('2099-01-04', '10:45', 45), '20990104T100000');
  checkEqual('★ shiftIcsLocalDateTime_：提早 0 分鐘，時間不變',
    gas.shiftIcsLocalDateTime_('2099-01-04', '10:45', 0), '20990104T104500');
  checkEqual('★ shiftIcsLocalDateTime_：提早跨小時（75 分鐘）',
    gas.shiftIcsLocalDateTime_('2099-01-04', '10:45', 75), '20990104T093000');

  const text = gas.buildIcsCalendarText_(BASE_OPTS);
  const events = text.split('BEGIN:VEVENT').slice(1);
  const audioEvent = events.find(function (e) { return e.indexOf('SUMMARY:音響') !== -1; });
  const chairEvent = events.find(function (e) { return e.indexOf('SUMMARY:主席') !== -1; });
  check('★★ 音響（提早 45 分鐘）嘅 DTSTART 係 10:00', audioEvent.indexOf('DTSTART;TZID=Pacific/Auckland:20990104T100000') !== -1, audioEvent);
  check('★ 主席（唔提早）嘅 DTSTART 係 10:45（跟預設崇拜時間一致）', chairEvent.indexOf('DTSTART;TZID=Pacific/Auckland:20990104T104500') !== -1, chairEvent);
  check('★ 兩個崗位嘅 DTEND 都唔受提早到場影響，一律 12:00', audioEvent.indexOf('DTEND;TZID=Pacific/Auckland:20990104T120000') !== -1 && chairEvent.indexOf('DTEND;TZID=Pacific/Auckland:20990104T120000') !== -1);
}

console.log('\n=== C1：漏填提早分鐘數（earlyMinutesByPost 冇嗰個 PostID）當 0 處理 ===');
{
  const text = gas.buildIcsCalendarText_(Object.assign({}, BASE_OPTS, { earlyMinutesByPost: {} }));
  check('★ 冇任何提早設定時，全部崗位一律用預設崇拜開始時間',
    text.indexOf('DTSTART;TZID=Pacific/Auckland:20990104T104500') !== -1
    && text.indexOf('DTSTART;TZID=Pacific/Auckland:20990104T100000') === -1);
}

console.log('\n=== C2：DESCRIPTION 帶出當日其他崗位（同日有兩個服侍安排時互相提及）===');
{
  const text = gas.buildIcsCalendarText_(BASE_OPTS);
  const events = text.split('BEGIN:VEVENT').slice(1);
  const audioEvent = events.find(function (e) { return e.indexOf('SUMMARY:音響') !== -1; });
  const chairEvent = events.find(function (e) { return e.indexOf('SUMMARY:主席') !== -1; });
  check('★★ 音響嘅 DESCRIPTION 提到當日仲有主席', audioEvent.indexOf('當日其他崗位：主席') !== -1, audioEvent);
  check('★★ 主席嘅 DESCRIPTION 提到當日仲有音響', chairEvent.indexOf('當日其他崗位：音響') !== -1, chairEvent);
}

console.log('\n=== C2：唔同日嘅服侍安排唔會互相當成「當日其他崗位」===');
{
  const opts = Object.assign({}, BASE_OPTS, {
    assignments: [
      { serviceDate: '2099-01-04', postId: 'AUDIO', slotIndex: 1, postNameTC: '音響' },
      { serviceDate: '2099-01-11', postId: 'CHAIR', slotIndex: 1, postNameTC: '主席' }
    ]
  });
  const text = gas.buildIcsCalendarText_(opts);
  const events = text.split('BEGIN:VEVENT').slice(1);
  check('★ 兩個唔同日嘅事件都冇「當日其他崗位」字樣', events.every(function (e) { return e.indexOf('當日其他崗位') === -1; }));
}

console.log('\n=== C2：escapeIcsText_ 依 RFC 5545 轉義特殊字元 ===');
{
  checkEqual('★ 反斜線、分號、逗號、換行都正確轉義',
    gas.escapeIcsText_('a\\b;c,d\ne\r\nf'), 'a\\\\b\\;c\\,d\\ne\\nf');
  checkEqual('★ 空/undefined 輸入回傳空字串', gas.escapeIcsText_(undefined), '');
}

console.log('\n=== C2：buildIcsUid_ 格式（季度-人-日期-崗位-slot@固定域名）===');
{
  // 刻意用陣列 join 砌出預期值（唔係單一連續字串常值）——scan_sensitive.test.js
  // 會把 25+ 字元嘅連續字串當「不明長 ID」、亦會把「字元@字元.字元」嘅連續文字
  // 當「非安全網域電郵」，兩者都係假警報（呢度係測試資料，唔係真實 ID／電郵），
  // 但專案慣例係避免呢種連續字串出現在原始碼，而唔係擴大白名單。
  const expectedUid = ['2099T1', 'P001', '2099-01-04', 'AUDIO', 1].join('-') + '@' + gas.ICS_UID_DOMAIN;
  checkEqual('★★ UID 格式正確、唔含真實教會域名',
    gas.buildIcsUid_('2099T1', 'P001', '2099-01-04', 'AUDIO', 1), expectedUid);
  check('★★ UID 域名用 RFC 2606 保留嘅 .invalid（明確表達「呢個位址肯定'
    + '唔會解析到任何嘢」，唔可寫死教會真實域名，亦唔用 .local——'
    + '嗰個係 RFC 6762 保留俾 mDNS 用，唔係「呢個域名一定唔存在」嘅慣例）',
    gas.ICS_UID_DOMAIN.indexOf('.invalid') !== -1);
}

console.log('\n=== C6【核心】整體格式符合 RFC 5545 基本要求 ===');
{
  const text = gas.buildIcsCalendarText_(BASE_OPTS);

  check('★★ 以 BEGIN:VCALENDAR 開始、END:VCALENDAR 結束',
    text.indexOf('BEGIN:VCALENDAR') === 0 && text.trim().endsWith('END:VCALENDAR'));
  check('★ 有 VERSION:2.0', text.indexOf('VERSION:2.0') !== -1);
  check('★★ 有 METHOD:PUBLISH（C2 要求）', text.indexOf('METHOD:PUBLISH') !== -1);
  check('★★ 有 VTIMEZONE 定義 Pacific/Auckland（唔係得個 UTC offset）',
    text.indexOf('BEGIN:VTIMEZONE') !== -1 && text.indexOf('TZID:Pacific/Auckland') !== -1
    && text.indexOf('END:VTIMEZONE') !== -1);
  check('★ VTIMEZONE 有 STANDARD 同 DAYLIGHT 兩段（紐西蘭有夏令時間）',
    text.indexOf('BEGIN:STANDARD') !== -1 && text.indexOf('BEGIN:DAYLIGHT') !== -1);

  const eventCount = (text.match(/BEGIN:VEVENT/g) || []).length;
  checkEqual('★ 兩筆派工產生兩個 VEVENT（一個服侍安排一個 VEVENT）', eventCount, 2);
  checkEqual('BEGIN:VEVENT 同 END:VEVENT 數量一致',
    (text.match(/BEGIN:VEVENT/g) || []).length, (text.match(/END:VEVENT/g) || []).length);

  ['UID:', 'SEQUENCE:', 'DTSTAMP:', 'DTSTART;TZID=Pacific/Auckland:', 'DTEND;TZID=Pacific/Auckland:', 'SUMMARY:', 'DESCRIPTION:'].forEach(function (prefix) {
    const count = (text.match(new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gm')) || []).length;
    check('★ 每個 VEVENT 都有 ' + prefix + '（共 ' + eventCount + ' 個）', count === eventCount, 'count=' + count);
  });

  check('★★ 全文一律用 CRLF 換行（唔係單獨 \\n）', text.indexOf('\r\n') !== -1 && text.replace(/\r\n/g, '').indexOf('\n') === -1);
  check('★ 結尾有 CRLF', text.endsWith('\r\n'));

  const physicalLines = splitPhysicalLines(text);
  const oversized = physicalLines.filter(function (l) { return utf8ByteLength(l) > 75; });
  check('★★ 每個物理行（折行後）UTF-8 位元組數都唔超過 75', oversized.length === 0, JSON.stringify(oversized));
}

console.log('\n=== C2/C6：長行（含中文）會正確折行，延續行以空白開頭 ===');
{
  // 用一大堆崗位名逼 DESCRIPTION 超過 75 octets，確保真的觸發折行路徑
  // （唔係淨係「冇折過所以冇壞」）。
  const manyAssignments = [];
  const postNames = ['音響', '司事', '主席', '招待', '獻花', '報告', '領詩', '司琴', '攝影', '茶點'];
  postNames.forEach(function (name, i) {
    manyAssignments.push({ serviceDate: '2099-02-01', postId: 'P' + i, slotIndex: 1, postNameTC: name });
  });
  const text = gas.buildIcsCalendarText_(Object.assign({}, BASE_OPTS, { assignments: manyAssignments, earlyMinutesByPost: {} }));

  const physicalLines = splitPhysicalLines(text);
  const continuationLines = physicalLines.filter(function (l) { return l.startsWith(' '); });
  check('★★ 確實有觸發折行（存在以空白開頭嘅延續行）', continuationLines.length > 0, 'physicalLines=' + physicalLines.length);

  const oversized = physicalLines.filter(function (l) { return utf8ByteLength(l) > 75; });
  check('★★ 折行後仍然冇任何一行超過 75 octets', oversized.length === 0, JSON.stringify(oversized));
}

console.log('\n=== C6：foldIcsLine_／utf8ByteLength_ 邊界情況 ===');
{
  const shortLine = 'SUMMARY:短';
  checkEqual('★ 短行唔會被折（冇插入 CRLF）', gas.foldIcsLine_(shortLine), shortLine);
  checkEqual('★ 英文字母係 1 個 octet', gas.utf8ByteLength_('A'), 1);
  checkEqual('★ 中文字一般係 3 個 octets（UTF-8）', gas.utf8ByteLength_('中'), 3);
}

console.log('\n=== C3：檔名／MIME type（原始碼靜態檢查——實際 Blob 建立要真正 GAS 環境）===');
{
  checkEqual('★★ buildIcsFileName_ 以 .ics 結尾',
    gas.buildIcsFileName_('2099T1', 3, '陳大文').slice(-4), '.ics');
  check('★★ buildIcsAttachmentForPerson_ 用 Utilities.newBlob(icsText, \'text/calendar\', fileName) 建立附件（iPhone 相容嘅 MIME type）',
    /Utilities\.newBlob\(\s*icsText\s*,\s*'text\/calendar'\s*,\s*fileName\s*\)/.test(icsSource));
}

console.log('\n=== C4：只喺 OFFICIAL／RESEND 兩個階段附上（原始碼靜態檢查）===');
{
  check('★★ buildIcsAttachmentForPerson_ 明確擋非 OFFICIAL／RESEND 階段',
    /if\s*\(\s*context\.stage\s*!==\s*MAIL_STAGES\.OFFICIAL\s*&&\s*context\.stage\s*!==\s*MAIL_STAGES\.RESEND\s*\)\s*return null;/.test(icsSource));
}

console.log('\n=== C5：零派工者唔附 ICS（原始碼靜態檢查）===');
{
  check('★★ buildIcsAttachmentForPerson_ 明確擋冇任何派工嘅收件人',
    /if\s*\(\s*!personAssignments\s*\|\|\s*personAssignments\.length === 0\s*\)\s*return null;/.test(icsSource));
  check('★ buildIcsAttachmentForPerson_ 明確擋非 PERSON 收件人（LIST 收件人唔會有個人日曆）',
    /if\s*\(\s*recipient\.type !== RECIPIENT_TYPE\.PERSON\s*\)\s*return null;/.test(icsSource));
}

console.log('\n=== Mailer.gs 整合：ICS 產生失敗唔會令整封信寄唔出（原始碼靜態檢查）===');
{
  const deliverOneBody = mailerSource.slice(mailerSource.indexOf('function deliverOne_'), mailerSource.indexOf('function sendRealEmail_'));
  // ⚠️ 第四十輪批次 A 組：呢度本來寫死成一句 `try { icsAttachment = ... } catch`。
  // 加咗「幹事可以今次關掉 .ics」之後，try 入面多咗兩行（讀上游嘅決定），
  // 而原本嗰條正則對唔上——但佢要守嗰件事（**ICS 產生失敗唔可以令成封信寄唔出**）
  // 一啲都冇變。所以改成守個意思，唔守嗰段字：
  //   ・`buildIcsAttachmentForPerson_()` 一定要喺一個 try 入面
  //   ・嗰個 try 嘅 catch 唔可以 return（return ＝ 成封信唔寄）
  //   ・而且要同 PDF 附件嗰個 try/catch 分開（PDF 嗰個係會 return 嘅）
  // ⚠️ 一定要搵**真正嘅呼叫**（帶括號同參數），唔可以淨係搵個名——
  //  上面幾行註解已經提過佢一次，搵中註解就會量錯個窗口。
  const icsAt = deliverOneBody.indexOf('buildIcsAttachmentForPerson_(context,');
  // 由呼叫嗰一刻開始，向前望夠遠去睇 try、向後望夠遠去睇 catch 做咗咩。
  const beforeIcs = deliverOneBody.slice(Math.max(0, icsAt - 400), icsAt);
  const afterIcs = deliverOneBody.slice(icsAt, icsAt + 500);
  check('★★ buildIcsAttachmentForPerson_ 喺一個 try 入面',
    icsAt !== -1 && /try \{[\s\S]*$/.test(beforeIcs), beforeIcs.slice(-120));
  const icsCatch = (afterIcs.match(/catch \(err\) \{([\s\S]*?)\n  \}/) || ['', ''])[1];
  check('★★★ 而嗰個 catch 只係寫一句 WARN，**唔會 return**'
    + '——一 return 就變成「日曆檔整唔到 ⇒ 成封信都唔寄」，'
    + '而個人 PDF 明明已經正確產生咗',
    icsCatch !== '' && icsCatch.indexOf("log_('WARN'") !== -1
      && icsCatch.indexOf('return') === -1,
    JSON.stringify(icsCatch).slice(0, 300));
  check('★★ 同 PDF 附件嗰個 try/catch 分開（PDF 嗰個係會 return 嘅）',
    /attachment = generateMailAttachment_[\s\S]{0,400}?catch \(err\) \{[\s\S]{0,400}?return Object\.assign/
      .test(deliverOneBody));
  check('★ ICS 產生失敗只係 log_(\'WARN\'...)，唔會 return 令呢封信整體失敗',
    /catch \(err\) {\s*log_\('WARN'/.test(deliverOneBody));
  // ⚠️ 第四十一輪批次 H 組：呢個呼叫而家要收返「實際寄咗去邊」（轉寄測試地址），
  // 所以佢由一行變成跨行。要守嗰件事（icsAttachment 有傳落去做第 7 個參數）
  // 一啲都冇變，所以個正則改成容許換行同空白。
  check('★★ deliverOne_ 呼叫 sendRealEmail_ 時傳埋 icsAttachment（第 7 個參數）',
    /sendRealEmail_\(\s*recipient,\s*subject,\s*bodyHtml,\s*bodyPlain,\s*context,\s*attachment,\s*icsAttachment\)/
      .test(deliverOneBody));
}

console.log('\n=== Mailer.gs 整合：sendRealEmail_ 支援同時夾 PDF 同 ICS 兩個附件 ===');
{
  const sendRealEmailBody = mailerSource.slice(mailerSource.indexOf('function sendRealEmail_'), mailerSource.indexOf('function generateMailAttachment_'));
  check('★★ options.attachments 係陣列，同時容納 attachment 同 icsAttachment（MailApp.sendEmail 原生支援多附件）',
    /\[attachment, icsAttachment\]/.test(sendRealEmailBody));
  check('★ 冇附件時（兩者皆 null）唔會設定 options.attachments', /if \(blobs\.length > 0\) options\.attachments = blobs;/.test(sendRealEmailBody));
}

// ─────────────────────────────────────────────────────────────────────
// 第二十三輪批次階段 A：試算表俾嘅係 Date 物件，唔係乾淨字串
// ─────────────────────────────────────────────────────────────────────
//
// 上面全部 case 都餵 `defaultStartTime: '10:45'` 呢種乾淨字串——
// 而 Config 嗰格試算表實際存嘅係 Date 物件。**呢個落差就係點解
// 62 個測試全部 PASS，但真實環境寄出嘅每一份月曆附件時間都係壞嘅。**
console.log('\n=== 第二十三輪階段 A【核心】Date 物件經正規化之後，DTSTART 唔可以含 NaN ===');
{
  // Date 物件要經 Utilities.formatDate，換一個確定性替身。
  const savedUtilities = gas.Utilities;
  gas.Utilities = {
    formatDate: function (date, timezone, format) {
      if (format !== 'HH:mm') throw new Error('測試替身只支援 HH:mm');
      const p = function (n) { return n < 10 ? '0' + n : String(n); };
      return p(date.getHours()) + ':' + p(date.getMinutes());
    }
  };

  // 試算表把「睇落似時間」嘅格存成 1899-12-30 當日嘅 Date——真實形狀。
  const startCell = new Date(1899, 11, 30, 10, 45, 0);
  const endCell = new Date(1899, 11, 30, 12, 0, 0);

  // 這就是修正之後 buildIcsAttachmentForPerson_() 行緊嘅路徑：
  // 先 normalizeTimeOfDay_()，再入 buildIcsCalendarText_()。
  const text = gas.buildIcsCalendarText_(Object.assign({}, BASE_OPTS, {
    defaultStartTime: gas.normalizeTimeOfDay_(startCell, '10:45', 'Pacific/Auckland'),
    defaultEndTime: gas.normalizeTimeOfDay_(endCell, '12:00', 'Pacific/Auckland')
  }));

  check('★★★★★ 整份 ICS 完全冇 NaN'
    + '（未修之前 DTSTART 係 NaNNaNNaNTNaNNaN00，就咁寄咗出去）',
    text.indexOf('NaN') === -1, text.slice(0, 400));
  check('★★★★★ 主席（唔提早）DTSTART 係 10:45，同餵乾淨字串嗰陣一模一樣',
    text.indexOf('DTSTART;TZID=Pacific/Auckland:20990104T104500') !== -1);
  check('★★★★ 音響（提早 45 分鐘）DTSTART 係 10:00',
    text.indexOf('DTSTART;TZID=Pacific/Auckland:20990104T100000') !== -1);
  check('★★★★ DTEND 係 12:00',
    text.indexOf('DTEND;TZID=Pacific/Auckland:20990104T120000') !== -1);

  // 防禦深度：就算有人繞過正規化直接餵 Date 入去，都一定要拋錯，
  // 唔可以好似以前噉靜靜輸出一個 NaN 日期。
  let threw = null;
  try {
    gas.buildIcsCalendarText_(Object.assign({}, BASE_OPTS, { defaultStartTime: startCell }));
  } catch (e) {
    threw = e;
  }
  check('★★★★★ 繞過正規化直接餵 Date ⇒ 拋錯，而唔係靜靜輸出 NaN'
    + '（階段 A3 嘅最後防線：寧可中止寄送，都好過寄一份時間係 NaN 嘅月曆）',
    threw !== null && String(threw.message).indexOf('ICS 時間格式不正確') !== -1,
    threw ? threw.message : '完全冇拋錯');

  gas.Utilities = savedUtilities;
}

console.log(`\nTOTAL: ${fail === 0 ? 'ALL PASS' : fail + ' FAILURES'}`);
process.exit(fail === 0 ? 0 : 1);

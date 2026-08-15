// 第十二輪批次階段 D：季度重設對「公開職事表連結」與「個人專屬連結 token」
// 兩個第十一輪新功能嘅交互稽核。
// 執行方式：node tests/quarter_reset_public_link.test.js
//
// QuarterReset.gs／PublicRoster.gs 呢部分要真正碰 SpreadsheetApp／DriveApp，
// 冇 GAS 環境跑唔到，跟本專案其他會真正改動資料嘅工具一樣，用靜態原始碼
// 檢查鎖住決策本身唔可以錯嘅幾個不變量（見 PublicRoster.gs 嘅
// clearPublicRosterOnQuarterReset_() 檔頭三點決策理由）。

const fs = require('fs');
const path = require('path');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}

const SRC = path.join(__dirname, '..', 'src');
const quarterResetSource = fs.readFileSync(path.join(SRC, 'QuarterReset.gs'), 'utf8');
const publicRosterSource = fs.readFileSync(path.join(SRC, 'PublicRoster.gs'), 'utf8');
const menuSource = fs.readFileSync(path.join(SRC, 'Menu.gs'), 'utf8');

console.log('\n=== D1【核心】planQuarterReset_() 查 PublicLinks 時保持零寫入 ===');
{
  const start = quarterResetSource.indexOf('function planQuarterReset_');
  const end = quarterResetSource.indexOf('\nfunction executeQuarterReset_', start);
  const body = quarterResetSource.slice(start, end);

  check('★★★ plan 階段查 PublicLinks 前先用 getSheetByName 確認存在，唔會呼叫 ensurePublicLinksSheet_()（會建表，違反 plan 零寫入）',
    body.indexOf('ensurePublicLinksSheet_') === -1 && body.indexOf('getSheetByName(SHEETS.PUBLIC_LINKS)') !== -1);
  check('★★ plan 階段唔會呼叫 findPublicLinkRow_()（嗰個函式內部會 ensurePublicLinksSheet_()）',
    body.indexOf('findPublicLinkRow_(') === -1);
  check('★ plan 物件有 publicLinkFileUrl 欄位，供確認畫面判斷呢一季有冇發佈過',
    /publicLinkFileUrl:\s*''/.test(body));
}

console.log('\n=== D1【核心】executeQuarterReset_() 只喺 plan 階段已經確認有紀錄先處理公開職事表 ===');
{
  const start = quarterResetSource.indexOf('function executeQuarterReset_');
  const end = quarterResetSource.indexOf('\nfunction deleteRowsMatching_', start);
  const body = quarterResetSource.slice(start, end);

  check('★★★ 執行階段有呼叫 clearPublicRosterOnQuarterReset_()（PublicRoster.gs）',
    /clearPublicRosterOnQuarterReset_\(plan\.quarterId\)/.test(body));
  check('★★ 呼叫前有先檢查 plan.publicLinkFileUrl（呢一季冇發佈過就完全唔會打開任何試算表）',
    /if \(plan\.publicLinkFileUrl\)/.test(body));
  check('★ 有 try/catch 包住，清空失敗唔會令成個重設中斷（記錄喺 errors，唔拋出）',
    /clearPublicRosterOnQuarterReset_[\s\S]{0,80}catch/.test(body) || /try\s*{\s*result\.publicRosterCleared/.test(body));
}

console.log('\n=== D1【本輪最重要】clearPublicRosterOnQuarterReset_()：只清內容，唔刪除檔案／PublicLinks 紀錄 ===');
{
  const start = publicRosterSource.indexOf('function clearPublicRosterOnQuarterReset_');
  const end = publicRosterSource.indexOf('\nfunction publishPublicRoster_', start);
  const body = publicRosterSource.slice(start, end);

  check('★★★ 完全冇任何刪除檔案嘅呼叫（DriveApp.*／setTrashed／deleteFile）',
    body.indexOf('DriveApp') === -1 && body.indexOf('setTrashed') === -1 && body.indexOf('.remove(') === -1);
  check('★★★ 完全冇刪除 PublicLinks 紀錄嘅呼叫（deleteRow／deleteRowsMatching_）',
    body.indexOf('deleteRow') === -1);
  check('★★ 用 openById(link.fileId) 打開既有檔案（唔係 create 新檔案）',
    /SpreadsheetApp\.openById\(link\.fileId\)/.test(body));
  check('★ 打唔開既有檔案時（可能已被人手刪除）只記警告、回傳 false，唔會拋錯令重設中斷',
    /catch[\s\S]{0,150}?log_\('WARN'/.test(body) && /return false;/.test(body));
  check('★★ 清空之後有寫入清楚嘅「已重設」提示文字，唔會留低舊派工資料睇落好似仲有效',
    /已重設，尚未重新發佈/.test(body));
  check('★ 有寫 AuditLog 記錄呢個動作',
    /action:\s*'季度重設：清空公開職事表'/.test(body));
}

console.log('\n=== D2【核心】個人專屬連結 token 跨季度、唔受重設影響 ===');
{
  check('★★★ QuarterReset.gs 完全冇提到 NAME_MAPPING（呢張表喺「絕對不碰」名單入面，token 存喺呢張表）',
    quarterResetSource.indexOf('NAME_MAPPING') === -1);
  check('★★ QuarterReset.gs 檔頭嘅「絕對不碰」清單有列明 NameMapping',
    /絕對不碰的工作表[\s\S]{0,200}?NameMapping/.test(quarterResetSource));
  check('★ QuarterReset.gs 完全冇提到 PersonalLinkToken 呢個欄位（唔應該有任何邏輯掂到佢）',
    quarterResetSource.indexOf('PersonalLinkToken') === -1);
}

console.log('\n=== D1：確認畫面／結果畫面都有反映公開職事表嘅處理（唔會靜靜咁做完都冇話俾幹事知）===');
{
  check('★★ 確認清單（YES/NO 之前）有列出「呢一季曾經發佈過公開職事表」嘅提示',
    /plan\.publicLinkFileUrl[\s\S]{0,300}?這一季曾經發佈過公開職事表/.test(menuSource));
  check('★ 確認訊息講清楚連結唔會變、只會清空內容',
    /連結本身不會改變、檔案不會刪除/.test(menuSource));
  check('★★ 結果畫面有一行「公開職事表」狀態（已清空／失敗／不適用三種都覆蓋到）',
    /公開職事表：'[\s\S]{0,20}?plan\.publicLinkFileUrl/.test(menuSource)
      || /'　公開職事表：'/.test(menuSource));
}

console.log(`\nTOTAL: ${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);

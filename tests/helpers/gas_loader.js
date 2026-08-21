// 階段 A（Opus 深度輪）新增：把 src/ 下真正的 .gs 原始碼載入 Node.js 沙箱，
// 讓測試可以直接呼叫**正式碼本身**，不是另外抄一份會走樣的副本。
//
// 為什麼要這樣做，而不是像其他測試檔那樣「移植逐字對應的邏輯」：
// 其他測試檔移植的是幾十行的判斷邏輯，移植版本走樣了很容易看出來。但排表
// 生成器（Generator.gs 的 buildRoster_／pickPerson_／evaluateViolations_ 等）
// 連同它依賴的規則判斷合共超過一千行，而且「系統絕不自動違反硬規則」這個
// 保證的價值，完全建立在「測的是真正會跑的那份程式碼」之上——移植一份副本
// 來測，只會證明副本沒問題，正式碼改壞了測試照樣全綠，等於白做。
//
// 可以這樣做的前提（已逐一查證）：Generator.gs 全檔完全沒有呼叫任何 Google
// Apps Script 專有 API（SpreadsheetApp／Utilities／DriveApp／Session／
// PropertiesService／MailApp／HtmlService／ScriptApp／CacheService／Logger
// 全部零命中），它只吃一個由呼叫端準備好的 context 物件。真正碰試算表的是
// buildGeneratorContext_()（讀資料）與 MultiRun.gs 的 performRosterGeneration_()
// （寫回試算表），這兩個函式測試都不會呼叫——測試自己用假資料組 context。
//
// 載入方式刻意模仿 Apps Script 自己的做法：GAS 把專案內全部 .gs 檔案當成
// 同一個全域作用域（所以跨檔案可以直接互相呼叫，不需要 import/export）。
// 這裡把需要的檔案依序串接成一份 script 再一次過執行，效果一致——包括
// 「同一個 const 名稱在兩個檔案重複宣告會是語法錯誤」這種特性也一併保留，
// 等於順帶驗證了正式碼在 GAS 的全域命名空間裡沒有衝突。

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC_DIR = path.join(__dirname, '..', '..', 'src');

/**
 * 載入順序：Constants.gs 一定要排第一（其他檔案的 top-level const 會引用
 * 它裡面的值，例如 STRUCTURAL_NA_RULE_IDS = [RULE_IDS.COMMUNION_FIRST_SUNDAY]）。
 * 其餘檔案之間只有函式互相呼叫（函式宣告會被提升），順序不影響。
 *
 * 只載入排表與規則判斷真正需要的檔案，不是整個 src/——載得越少，越不容易
 * 因為某個無關檔案在 top-level 碰到 GAS API 而載入失敗。
 */
const FILES_FOR_GENERATOR = [
  'Constants.gs',   // 全部常數（RULE_IDS／POST_FREQUENCY／ASSIGN_SOURCE 等）
  'Utils.gs',       // splitList_／daysBetween_／shiftDateString_ 等純函式
  'SheetReader.gs', // isTrueValue_（規則 Enabled 判斷會用到）
  // 第十六輪批次階段 B：身分規則（教會新規則 1／2／3）嘅純函式判斷
  // （personHasAnyRoleOn_／findActivePersonPostExclusion_／requiredRolesOfPost_）
  // 住喺呢度，而 evaluateViolations_()／findStateViolations_() 兩邊都會呼叫，
  // 所以生成器測試一定要載入佢。檔案入面碰試算表嘅只有 readOptionalSheet_()
  // 同幾個 ensure*Sheet_() 建表工具，測試路徑唔會行到嗰度。
  'Roles.gs',
  // 第二十六輪批次階段 C：排表偏好。`computeBonus_()` 會叫呢度嘅
  // `computePersonPostWeightBonus_()`，所以生成器測試一定要載入。
  // ⚠️ 檔案入面碰試算表嘅只有 `readActivePersonPostWeights_()`，
  // 而佢喺 `buildGeneratorContext_()` 度叫（唔喺純運算路徑），
  // 所以載入佢唔會令測試沙箱嘅 GAS stub 被觸發。
  'PersonPostWeight.gs',
  'Generator.gs',   // 排表生成器本身（本輪測試的主角）
  'FineTune.gs'     // findStateViolations_（重跑規則檢查，斷言直接重用它）
];

/**
 * 建立 GAS 專有全域物件的替身。刻意做成「一被呼叫就拋錯」而不是回傳假值——
 * 如果測試涵蓋的程式碼路徑真的碰到了這些 API，我們要立刻知道（代表上面
 * 「Generator.gs 不碰 GAS API」的前提被後續改動打破了），而不是靜靜拿到
 * 一個假結果、令測試繼續綠燈但其實已經測不到真實行為。
 * @returns {Object} 供 vm context 使用的全域替身
 */
function buildGasStubs_() {
  const trap = function (apiName) {
    return new Proxy({}, {
      get: function (_target, prop) {
        if (prop === Symbol.toPrimitive || prop === 'toString' || prop === 'valueOf') {
          return function () { return '[stub ' + apiName + ']'; };
        }
        return function () {
          throw new Error(
            '測試沙箱：程式碼呼叫了 ' + apiName + '.' + String(prop) + '()，'
            + '但排表生成器的測試路徑本來不應該碰任何 Google Apps Script API。\n'
            + '這代表 Generator.gs（或它呼叫的函式）新增了對試算表／Drive／'
            + '寄信的直接依賴，測試沙箱無法提供。請檢查是不是應該把那段邏輯'
            + '留在呼叫端（buildGeneratorContext_）而不是放進純運算的部分。'
          );
        };
      }
    });
  };

  /** 一把永遠攞得到嘅鎖（見下面 LockService 嘅說明）。 */
  function makeAlwaysAvailableLock_() {
    return {
      tryLock: function () { return true; },
      waitLock: function () {},
      releaseLock: function () {},
      hasLock: function () { return true; }
    };
  }
  return {
    SpreadsheetApp: trap('SpreadsheetApp'),
    DriveApp: trap('DriveApp'),
    MailApp: trap('MailApp'),
    GmailApp: trap('GmailApp'),
    Session: trap('Session'),
    PropertiesService: trap('PropertiesService'),
    CacheService: trap('CacheService'),
    ScriptApp: trap('ScriptApp'),
    HtmlService: trap('HtmlService'),
    UrlFetchApp: trap('UrlFetchApp'),
    Utilities: trap('Utilities'),
    // Logger 是唯一容許靜靜吞掉的——log_()（Utils.gs）在正常流程也會被呼叫，
    // 它只是記錄訊息，不影響任何運算結果，讓它拋錯反而會干擾測試。
    Logger: { log: function () {} },
    // ⚠️ 第四十三輪批次 A 組：`LockService` 一律**當成拿得到**。
    //
    // 離線的 node 只有一條執行緒，永遠不可能出現真正的並行——
    // 所以在這裡模擬「拿不到鎖」沒有意義，只會令每一份測試都要
    // 記得 stub 一次。
    //
    // ⚠️ 但要測「拿不到的時候會怎樣」的測試，仍然可以自己覆寫
    // `gas.LockService`——那是刻意留的口，
    // `tests/mutation_lock.test.js` 就是這樣做的。
    LockService: {
      getDocumentLock: function () { return makeAlwaysAvailableLock_(); },
      getScriptLock: function () { return makeAlwaysAvailableLock_(); },
      getUserLock: function () { return makeAlwaysAvailableLock_(); }
    }
  };
}

/**
 * 把指定的 .gs 檔案載入一個新的沙箱，回傳沙箱的全域物件——裡面可以直接取到
 * 正式碼定義的每一個函式與常數（跟 Apps Script 的全域作用域一致）。
 * @param {string[]=} files 要載入的檔名陣列；預設為排表測試需要的那一組
 * @param {Object.<string, *>=} overrides 第十三輪批次階段 D 新增：可選嘅
 *   全域替身覆寫，鍵係全域名稱（例如 `'HtmlService'`）、值係要用嚟取代
 *   預設「一呼叫就拋錯」stub 嘅實際物件。用途：某啲函式只需要 GAS 全域
 *   入面好細嘅一部分行為（例如 `renderPersonalRosterError_()` 淨係用到
 *   `HtmlService.createHtmlOutput(...).setTitle(...)`），提供一個貼合
 *   需要嘅簡化版 mock，就可以喺 Node 環境真正執行呢個函式，唔使成個
 *   `HtmlService` 都要拋錯。冇傳呢個參數時行為同以前完全一致。
 * @returns {Object} 沙箱全域物件
 */
/**
 * 永遠載入嘅檔案。
 *
 * ⚠️ 第三十輪批次階段 A2：`ArgShape.gs` 係一個**冇任何依賴**嘅
 * 參數形狀防線，而 `FineTune.gs`／`StateSource.gs` 一開頭就會叫佢。
 * 唔喺呢度自動加嘅話，每一份測試都要自己記得喺 `files` 清單補一行，
 * 而漏咗嘅後果係 `requireStateArg_ is not defined`——
 * 一個同測試本身完全無關嘅錯。
 *
 * 呢度只放「零依賴、而且好多檔案都會叫」嗰種。
 */
// ⚠️ 第四十五輪批次：`SafeWrite.gs` 已經**移除**。
//
// 佢係第四十四輪為一個**判錯咗嘅成因**而做嘅——當時以為
// `Failed due to illegal value in property: 1` 係 `Range.setValues()`
// 收到壞值，所以把全部值寫入收窄埋一個入口。
//
// 真正嘅成因喺 client 端（`google.script.run` 序列化參數），後端一次都冇被叫到。
// 而嗰個收窄點本身嘅行為係「壞值換成空字串 ＋ 寫一句 WARN」——
// 即係把一個大聲嘅失敗變成一個靜靜嘅失敗，同呢個專案一直守嘅原則相反。
const ALWAYS_LOADED = ['ArgShape.gs'];

function loadGasSource(files, overrides) {
  const requested = files || FILES_FOR_GENERATOR;
  const list = ALWAYS_LOADED.filter(function (n) {
    return requested.indexOf(n) === -1;
  }).concat(requested);
  const sources = list.map(function (name) {
    const full = path.join(SRC_DIR, name);
    // 每個檔案前後加註解標記，語法錯誤時的行號訊息比較容易對回原始檔案
    return '/* ==== ' + name + ' ==== */\n' + fs.readFileSync(full, 'utf8');
  });

  const sandbox = buildGasStubs_();
  if (overrides) Object.keys(overrides).forEach(function (k) { sandbox[k] = overrides[k]; });
  vm.createContext(sandbox);

  // 串接後一次過執行：模仿 GAS 把全部 .gs 當成同一個全域作用域的做法。
  // 用 vm.runInContext 直接跑（不包 function），令 top-level 的 const／
  // function 都留在同一個 script 的作用域內、可以互相引用。最後把需要
  // 對外提供的名稱明確掛到全域物件上。
  const exposeNames = collectTopLevelNames_(sources.join('\n\n'));
  const script = sources.join('\n\n')
    + '\n\n/* ==== 測試沙箱：把 top-level 宣告掛到全域，供 Node 取用 ==== */\n'
    + exposeNames.map(function (n) { return 'this.' + n + ' = ' + n + ';'; }).join('\n');

  vm.runInContext(script, sandbox, { filename: 'gas-bundle.js' });
  return sandbox;
}

/**
 * 從串接後的原始碼掃出全部 top-level 的 function／const 名稱，供上面掛到
 * 沙箱全域。只認「行首就是 function/const」這種形式——GAS 專案的慣例本來
 * 就是全部宣告都在檔案最外層、不縮排，巢狀函式與區塊內的宣告都有縮排，
 * 不會被誤抓。
 * @param {string} source 串接後的完整原始碼
 * @returns {string[]} 去重後的名稱清單
 */
function collectTopLevelNames_(source) {
  const names = {};
  const fnPattern = /^function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
  const constPattern = /^(?:const|var|let)\s+([A-Za-z_$][\w$]*)\s*=/gm;
  let m;
  while ((m = fnPattern.exec(source)) !== null) names[m[1]] = true;
  while ((m = constPattern.exec(source)) !== null) names[m[1]] = true;
  return Object.keys(names);
}

module.exports = { loadGasSource, FILES_FOR_GENERATOR };

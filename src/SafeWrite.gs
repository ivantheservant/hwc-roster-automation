/**
 * 第四十四輪批次 A 組：**兩個「值寫入」的唯一入口。**
 *
 * ═════════════════════════════════════════════════════════════════════
 * 現場（Ivan 已經撞到三次，錯誤原文一模一樣）
 * ═════════════════════════════════════════════════════════════════════
 *
 *   `Failed due to illegal value in property: 1`
 *
 * 而且**時好時壞**——同一串動作，有時爆有時不爆。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 查了什麼
 * ─────────────────────────────────────────────────────────────────────
 *
 * Ivan 的判斷是 `PropertiesService`（「property: 1」＝ 有一個名叫 `"1"`
 * 的屬性 ＝ 有人把一個陣列餵了落 `setProperties()`）。
 *
 * ⚠️ **這一點查完之後不成立。** `src/` 裡面：
 *
 *   ・`setProperties(` ——**一個都沒有**
 *   ・`setProperty(` ——只有四處，全部是
 *     `setProperty(<字串常數>, JSON.stringify(...))` 或者
 *     `setProperty(<字串常數>, 'dark'|'light')`
 *
 * 所以 `PropertiesService` 不是這一次的成因。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 那麼最可能是什麼
 * ─────────────────────────────────────────────────────────────────────
 *
 * 同一句話（`Failed due to illegal value in property: <索引>`）在
 * Apps Script 也會由 **`Range.setValues()`** 拋出來——那個「property」
 * 指的是**傳入陣列的索引**，而「illegal value」指的是陣列裡面出現了
 * 一個試算表寫不到的值：`undefined`、`null`、一個物件、一個函式。
 *
 * 而「時好時壞」正正是這一種的指紋：`undefined` 只在**某幾格的資料
 * 剛好走到某一條分支**的時候才出現。同一個動作、不同的資料，
 * 就會一次爆一次不爆。
 *
 * ⚠️ 我**沒有辦法在離線環境重現這一句**（那是 Google 那邊拋的，
 * 而 mock 只會照單全收）。所以這一個檔案做的是兩件事：
 *
 *   一、**把那一類值在寫入之前擋住**（`sheetSafeValues_()`），
 *       令它不可能再發生；
 *   二、萬一仍然爆，**要爆得講得出是哪一步**
 *       （見 `SuggestionSheet.gs` 那一串 `step()` 標籤）。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 順帶：`saveState_()`／`readState_()`
 * ─────────────────────────────────────────────────────────────────────
 *
 * Ivan 要求把 `PropertiesService` 收成一個唯一入口。查完雖然發現它不是
 * 這一次的成因，但**那個要求本身是對的**：一個「攤開物件做多個 property」
 * 的寫法一旦有人寫出來，就會製造這一類錯，而且極難查。
 *
 * 所以照做，並且加一條 lint（`tools/lint-static-checks` 那一組）擋住
 * 直接叫 `setProperties(`。
 */

/**
 * 一個值試算表寫不寫得到。
 *
 * ⚠️ `null`／`undefined` 一律**不合法**——它們就是那一句
 * `illegal value in property` 最常見的來源。
 *
 * @param {*} v 值
 * @returns {boolean} 寫不寫得到
 */
function isSheetWritableValue_(v) {
  if (v === null || v === undefined) return false;
  const t = typeof v;
  if (t === 'string' || t === 'number' || t === 'boolean') return true;
  // Date 物件寫得到（試算表會存成日期值）。
  if (Object.prototype.toString.call(v) === '[object Date]') return !isNaN(v.getTime());
  return false;
}

/**
 * 把一個二維陣列洗成「一定寫得入試算表」的樣子。
 *
 * ⚠️ **這不是靜靜吞掉問題。** 洗走的每一格都會寫 log，
 * 而 log 講得出是第幾行第幾欄——下一次出事就查得到源頭。
 * 靜靜換成空字串而不留痕跡，就等於把一個資料問題變成一個
 * 「表上有一格莫名其妙是空的」的問題，而後者更難查。
 *
 * ⚠️ 行長度不齊都要處理：`setValues()` 要求每一行長度一樣，
 * 不齊會拋另一個同樣看不懂的錯。
 *
 * @param {Array[]} rows 二維陣列
 * @param {string} caller 呼叫者名稱（只用來寫 log）
 * @param {number=} width 每行應該有幾多欄；不傳就用第一行的長度
 * @returns {Array[]} 洗乾淨的二維陣列
 */
function sheetSafeValues_(rows, caller, width) {
  const list = rows || [];
  const w = Number(width) > 0 ? Number(width) : (list.length > 0 ? list[0].length : 0);
  const bad = [];

  const out = list.map(function (row, r) {
    const line = [];
    for (let c = 0; c < w; c++) {
      const v = (row || [])[c];
      if (isSheetWritableValue_(v)) { line.push(v); continue; }
      // 空字串本身係合法嘅，唔算問題——只有 null／undefined／物件先要記。
      if (v !== undefined || (row || []).length > c) {
        bad.push('第 ' + (r + 1) + ' 行第 ' + (c + 1) + ' 欄（' + String(v) + '）');
      }
      line.push('');
    }
    return line;
  });

  if (bad.length > 0) {
    log_('WARN', caller + '：有 ' + bad.length + ' 格的值試算表寫不到，已經換成空白。'
      + '這通常代表上游有一個欄位算不出來。逐格：'
      + bad.slice(0, 10).join('、') + (bad.length > 10 ? '……' : ''));
  }
  return out;
}

/**
 * 寫一個範圍，而且**保證寫得入**。
 *
 * ⚠️ 全部「由程式算出來的資料」寫入都要經這一個——
 * 尤其是 grid 同建議表那兩張，它們每一格都是算出來的。
 *
 * @param {Sheet} sheet 工作表
 * @param {number} row 起始行（1-based）
 * @param {number} col 起始欄（1-based）
 * @param {Array[]} rows 二維陣列
 * @param {string} caller 呼叫者名稱（只用來寫 log）
 * @returns {void}
 */
function setSheetValuesSafely_(sheet, row, col, rows, caller) {
  const list = rows || [];
  if (list.length === 0) return;
  const width = list[0].length;
  if (width === 0) return;
  sheet.getRange(row, col, list.length, width)
    .setValues(sheetSafeValues_(list, caller, width));
}

/* ═════════════════════════════════════════════════════════════════════
 * `PropertiesService` 的唯一入口
 * ═════════════════════════════════════════════════════════════════════ */

/**
 * 存一份狀態。**一律 `JSON.stringify()` 之後用單一 key 存。**
 *
 * ⚠️ **不可以**把一個物件的欄位攤開做多個 property——那樣做
 * key 就會變成 `"0"`／`"1"`／`"2"`，而 `setProperties()` 只收
 * 「字串 → 字串」的平面物件，一有數字 key 或者非字串 value 就會拋
 * `Failed due to illegal value in property: <key>`。
 *
 * @param {string} key property 名（一律用常數，不要即場砌）
 * @param {*} value 任何 JSON 化得到的東西
 * @returns {void}
 */
function saveState_(key, value) {
  const name = String(key || '').trim();
  if (!name) throw new Error('saveState_() 收到一個空的 key。這是一個程式錯誤。');
  let text;
  try {
    text = JSON.stringify(value);
  } catch (err) {
    // ⚠️ 序列化不到**不可以靜靜略過**——下一次讀出來會是「沒有狀態」，
    // 而那會令一個做到一半的批次由頭再做一次。
    throw new Error('saveState_(' + name + ')：這一份狀態序列化不到（'
      + err.message + '）。這是一個程式錯誤，不是使用者錯。');
  }
  if (text === undefined) text = 'null';
  PropertiesService.getScriptProperties().setProperty(name, text);
}

/**
 * 讀返一份狀態。**讀不到／爛咗就當作沒有，不拋錯。**
 *
 * ⚠️ 這一條是刻意的：這幾個 key 存的全部是「做到一半的進度」。
 * 一份爛掉的進度應該當成「由頭做」，而不是令整個功能拋錯——
 * 拋錯的話幹事會完全卡死，而他根本沒有辦法去清那一個 property。
 *
 * @param {string} key property 名
 * @returns {*} 存入去那樣東西；沒有或者爛掉就回 `null`
 */
function readState_(key) {
  const raw = PropertiesService.getScriptProperties().getProperty(String(key || ''));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    log_('WARN', 'readState_(' + key + ')：存住那一份狀態讀不返（' + err.message
      + '）。當作沒有狀態處理。');
    return null;
  }
}

/**
 * 清走一份狀態。
 * @param {string} key property 名
 * @returns {void}
 */
function clearState_(key) {
  PropertiesService.getScriptProperties().deleteProperty(String(key || ''));
}

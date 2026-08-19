/**
 * 參數形狀防線（第三十輪批次階段 A2 新增）。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 點解要有
 * ─────────────────────────────────────────────────────────────────────
 *
 * 實測：幹事撳掣 1「儲存並確認」一撳即爆
 *
 *   TypeError: Cannot read properties of undefined (reading 'forEach')
 *     at findStateViolations_ (FineTune:278)
 *
 * 成因係 `findStateViolations_(context, resolved.state)`——
 * **參數次序調轉咗**。而 `findStateViolations_(state, context)` 嘅簽名
 * 兩個參數都係「一個物件」，JS 唔會投訴，錯誤要行到第 5 行
 * 讀 `context.posts.forEach` 先爆，而且個訊息完全講唔出真正嘅原因。
 *
 * ⚠️ **唔可以自動糾正。**
 * 「見到第一個係物件就自己調轉」會令錯誤靜靜消失，
 * 下一個人照樣寫錯，而且下一次調轉嘅可能係另一對參數。
 * 要嘈，而且要講得出點解、講得出收到嘅係咩。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 用喺邊
 * ─────────────────────────────────────────────────────────────────────
 *
 * 全部「同時收 `state` 同 `context`」嘅內部函式（見 `docs/系統範圍稽核.md`）：
 *   `findStateViolations_(state, context)`
 *   `findReplacementPerson_(violation, state, context)`
 *   `exceedsAssignmentLimit_(personId, state, context)`
 *   `materialiseManualEdits_(context, changes, state, source)`
 * 加上幾個只收 `context` 但好易被傳錯嘢入去嘅：
 *   `buildGridOverlayState_(context)`／`analyseManualState_(context)`
 */

/**
 * 一個值「睇落係咪一個 fine-tune context」。
 *
 * ⚠️ 用嚟**認錯誤**，唔係用嚟認正確。所以判斷放得寬鬆少少：
 * 只要有 `posts` 或者 `serviceDates` 或者 `rules` 其中一個就當係。
 * 認得太窄嘅話，一個少咗一個欄位嘅 context 會被當成「唔係 context」，
 * 而錯誤訊息會指去一個錯嘅方向。
 *
 * @param {*} value
 * @returns {boolean}
 */
function looksLikeFineTuneContext_(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return !!(value.posts || value.serviceDates || value.rules);
}

/**
 * 描述收到嘅係乜，用嚟砌錯誤訊息。**唔會印出內容**——
 * context 同 state 入面都係真人資料，而錯誤訊息會入 `Logger`、
 * 有機會出喺畫面上。只講型別同有冇某幾個欄位。
 *
 * @param {*} value
 * @returns {string}
 */
function describeArgShape_(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return '陣列（長度 ' + value.length + '）';
  if (typeof value !== 'object') return typeof value;
  const marks = [];
  ['posts', 'serviceDates', 'rules', 'assignments'].forEach(function (k) {
    if (value[k]) marks.push('.' + k);
  });
  return '物件（' + (marks.length === 0 ? '沒有 .posts／.serviceDates／.rules'
    : '有 ' + marks.join('、')) + '）';
}

/**
 * 第 `position` 個參數應該係「派工狀態陣列」。
 *
 * @param {string} fnName 函式名（會出現喺錯誤訊息）
 * @param {number} position 1-based
 * @param {*} value
 * @param {string} contextParamName 另一個參數叫咩（用嚟講「第幾個先係 context」）
 * @returns {Object[]} 原值（形狀啱先回）
 */
function requireStateArg_(fnName, position, value, contextParamName) {
  if (Array.isArray(value)) return value;
  // 收到一個 context ⇒ 幾乎肯定係次序調轉。
  const swapped = looksLikeFineTuneContext_(value);
  throw new Error(fnName + '() 收到的參數形狀不對'
    + (swapped ? '，次序似乎調轉了' : '') + '。\n'
    + '第 ' + position + ' 個參數應該是派工狀態陣列（state），'
    + '第 ' + (position + 1) + ' 個才是 ' + contextParamName + '。\n'
    + '收到的第 ' + position + ' 個參數：' + describeArgShape_(value));
}

/**
 * 第 `position` 個參數應該係一個 context。
 *
 * @param {string} fnName
 * @param {number} position 1-based
 * @param {*} value
 * @param {string[]} requiredFields 一定要有嘅欄位（例如 `['posts', 'serviceDates']`）
 * @returns {Object} 原值
 */
function requireContextArg_(fnName, position, value, requiredFields) {
  const fields = requiredFields || [];
  const missing = fields.filter(function (f) {
    return !value || typeof value !== 'object' || !value[f];
  });
  if (!Array.isArray(value) && value && typeof value === 'object' && missing.length === 0) {
    return value;
  }
  const swapped = Array.isArray(value);
  throw new Error(fnName + '() 收到的參數形狀不對'
    + (swapped ? '，次序似乎調轉了——收到的是一個陣列（state？）' : '') + '。\n'
    + '第 ' + position + ' 個參數應該是 context'
    + (fields.length === 0 ? '' : '（要有 .' + fields.join('、.') + '）') + '。\n'
    + '收到的第 ' + position + ' 個參數：' + describeArgShape_(value)
    + (missing.length === 0 ? '' : '；缺少 .' + missing.join('、.')));
}

// 第十三輪批次階段 D：輕量版 GAS HtmlService 樣板引擎（唔係測試，係
// 供離線渲染器用嘅共用工具）。
//
// GAS 嘅 HtmlService 樣板語法（`<?= ?>`／`<?!= ?>`／`<? ?>`）本質上同
// JSP／ERB／EJS 呢類 scriptlet 樣板引擎一樣，但冇獨立套件、亦唔係標準
// JS 語法，Node 冇辦法直接執行。呢個 helper 將樣板檔案文字轉成一個
// JS function（用 `new Function()`），令離線渲染器可以直接讀取**真正嘅
// `src/ui/*.html` 檔案**（唔係抄一份副本）餵入真實資料，產生高保真嘅
// 離線 HTML 輸出，供 docs/ 嘅樣本文件使用。
//
// 語法對照（同 GAS HtmlService 一致）：
//   <?= expr ?>   → HTML escape 之後輸出
//   <?!= expr ?>  → 原樣輸出，唔 escape
//   <? stmt ?>    → 當做 JS 陳述式執行（if／forEach 呢類控制流程）

/**
 * HTML escape，規則同 GAS HtmlService 嘅 `<?= ?>` 一致
 * （轉義 & < > " '）。
 * @param {*} v 要輸出嘅值
 * @returns {string}
 */
function escapeHtml_(v) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 將樣板原始碼轉成可執行嘅 JS function body。
 * @param {string} templateSource 樣板檔案原始文字
 * @returns {string} JS function body（用 __out 陣列累積輸出，最後 join）
 */
function compileTemplate_(templateSource) {
  const tagPattern = /<\?(!?=?)([\s\S]*?)\?>/g;
  const code = ['var __out = [];'];
  let idx = 0;
  let match;
  while ((match = tagPattern.exec(templateSource)) !== null) {
    const literal = templateSource.slice(idx, match.index);
    if (literal) code.push('__out.push(' + JSON.stringify(literal) + ');');

    const marker = match[1];
    const expr = match[2];
    if (marker === '=') {
      code.push('__out.push(__esc(' + expr.trim() + '));');
    } else if (marker === '!=') {
      code.push('__out.push(String((' + expr.trim() + ') === undefined || (' + expr.trim() + ') === null ? "" : (' + expr.trim() + ')));');
    } else {
      code.push(expr);
    }
    idx = tagPattern.lastIndex;
  }
  const tail = templateSource.slice(idx);
  if (tail) code.push('__out.push(' + JSON.stringify(tail) + ');');
  code.push('return __out.join("");');
  return code.join('\n');
}

/**
 * 渲染一份 GAS HtmlService 樣板檔案。
 * @param {string} templateSource 樣板檔案原始文字（直接讀 src/ui/*.html）
 * @param {Object} data 樣板入面用嘅 `data` 物件
 * @param {Object.<string, *>=} globals 樣板入面會用到嘅其他全域常數
 *   （例如 `GRID_LABELS`），鍵係變數名稱、值係實際內容
 * @returns {string} 渲染後嘅 HTML
 */
function renderGasTemplate(templateSource, data, globals) {
  const body = compileTemplate_(templateSource);
  const globalNames = Object.keys(globals || {});
  const globalValues = globalNames.map(function (n) { return globals[n]; });
  // eslint-disable-next-line no-new-func
  const fn = new Function('data', '__esc', globalNames.join(', '), body);
  return fn.apply(null, [data, escapeHtml_].concat(globalValues));
}

module.exports = { renderGasTemplate, escapeHtml_ };

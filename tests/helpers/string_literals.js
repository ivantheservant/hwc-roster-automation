// 第八十五輪批次 LA 組：抽出原始碼的字串字面值（略過註解），給用字檢查使用。
//
// .gs ⇒ 整個檔案當 JavaScript 處理。
// .html ⇒ <script> 內當 JavaScript；<script> 以外的 HTML 文字和屬性值當作字串，
//         <!-- --> 註解略過。
//
// 回傳 [{ line, text }]：line 是字串開始的行號（1 起計）。
// 模板字串的 ${…} 內的程式碼會再抽一次（裏面的字串照樣列出）。

const REGEX_PREV = /[(,=:[!&|?{};+\-*%<>~^]$/;
const REGEX_KEYWORDS = /(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|new|delete|void|throw)$/;

function jsLiterals_(src, baseLine, out) {
  let i = 0; let line = baseLine;
  const n = src.length;
  let lastSig = '';           // 最後一段非空白程式碼（判斷 / 是除號還是正規表示式）
  function push(text, startLine) { out.push({ line: startLine, text: text }); }
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; }
      i += 2; continue;
    }
    if (c === '\'' || c === '"') {
      const startLine = line; let j = i + 1; let text = '';
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') { text += src[j] + (src[j + 1] || ''); if (src[j + 1] === '\n') line++; j += 2; continue; }
        if (src[j] === '\n') { line++; break; }   // 未閉合（不應出現）
        text += src[j]; j++;
      }
      push(text, startLine); i = j + 1; lastSig = 'x'; continue;
    }
    if (c === '`') {
      const startLine = line; let j = i + 1; let text = '';
      while (j < n && src[j] !== '`') {
        if (src[j] === '\\') { text += src[j] + (src[j + 1] || ''); j += 2; continue; }
        if (src[j] === '$' && src[j + 1] === '{') {
          // 找配對的 }，裏面的程式碼另外抽字串
          let depth = 1; let k = j + 2; const codeStart = k; const codeLine = line;
          while (k < n && depth > 0) {
            const ch = src[k];
            if (ch === '\'' || ch === '"' || ch === '`') {
              const q = ch; k++;
              while (k < n && src[k] !== q) { if (src[k] === '\\') k++; else if (src[k] === '\n') line++; k++; }
              k++; continue;
            }
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
            else if (ch === '\n') line++;
            k++;
          }
          jsLiterals_(src.slice(codeStart, k - 1), codeLine, out);
          text += '${}'; j = k; continue;
        }
        if (src[j] === '\n') line++;
        text += src[j]; j++;
      }
      push(text, startLine); i = j + 1; lastSig = 'x'; continue;
    }
    if (c === '/') {
      const prev = lastSig;
      const p = prev.replace(/ $/, "");
      const isRegex = p === "" || REGEX_PREV.test(p) || REGEX_KEYWORDS.test(p);
      if (isRegex) {
        let j = i + 1; let inClass = false;
        while (j < n && src[j] !== '\n') {
          if (src[j] === '\\') { j += 2; continue; }
          if (src[j] === '[') inClass = true;
          else if (src[j] === ']') inClass = false;
          else if (src[j] === '/' && !inClass) break;
          j++;
        }
        j++;
        while (j < n && /[a-z]/i.test(src[j])) j++;
        i = j; lastSig = 'x'; continue;
      }
    }
    if (/\s/.test(c)) {
      // 空白分隔字詞：保留一個空格，讓 return 等關鍵字仍可辨認
      if (lastSig && lastSig[lastSig.length - 1] !== ' ') lastSig += ' ';
    } else {
      lastSig = (lastSig + c).slice(-20);
    }
    i++;
  }
  return out;
}

function lineOf_(src, idx) {
  let l = 1; for (let k = 0; k < idx; k++) if (src.charCodeAt(k) === 10) l++;
  return l;
}

function htmlLiterals_(src, out) {
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let last = 0; let m;
  const markupParts = [];
  while ((m = re.exec(src)) !== null) {
    markupParts.push({ start: last, text: src.slice(last, m.index) });
    const codeStart = m.index + m[0].indexOf('>') + 1;
    jsLiterals_(m[1], lineOf_(src, codeStart), out);
    last = m.index + m[0].length;
  }
  markupParts.push({ start: last, text: src.slice(last) });
  markupParts.forEach((p) => {
    // 註解換成同樣行數的空白，保留行號
    const body = p.text.replace(/<!--[\s\S]*?-->/g, (s) => s.replace(/[^\n]/g, ' '))
      .replace(/<style\b[\s\S]*?<\/style>/gi, (s) => s.replace(/[^\n]/g, ' '));
    const baseLine = lineOf_(src, p.start);
    body.split('\n').forEach((l, k) => {
      const t = l.trim();
      if (t) out.push({ line: baseLine + k, text: t });
    });
  });
  return out;
}

function extractStringLiterals(src, fileName) {
  if (/\.html$/i.test(fileName)) return htmlLiterals_(src, []);
  return jsLiterals_(src, 1, []);
}

module.exports = { extractStringLiterals };

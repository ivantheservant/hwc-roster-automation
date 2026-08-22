// 第四十九輪批次 第 2 層 2C：把 `src/ui/*.html` 嘅 `<script>` 攞出嚟喺 Node 度跑。
//
// ═════════════════════════════════════════════════════════════════════
// 點解要有呢一支
// ═════════════════════════════════════════════════════════════════════
//
// 第四十七輪嗰個 bug 喺 `src/ui/ScriptSendPaper.html` 嘅
// `renderSendDialog(s)` 入面，係一個**控制流次序**問題：
// 「未儲存」嗰一段排喺 `kind === 'NONE'` 之後，所以永遠行唔到。
//
// 之前所有 Node 測試都碰唔到佢——因為嗰一層住喺 HTML 嘅 `<script>`
// 入面，而 Node 從來冇執行過嗰段碼。測試只係喺**讀原始碼字串**，
// 而讀字串答唔到「呢一段到底行唔行得到」。
//
// ⚠️ 所以呢一支唔係「再加一種字串比對」。佢係**真嘅執行**嗰段碼，
// 餵一份 `s` 入去，然後睇**實際畫咗啲乜出嚟**。
//
// ─────────────────────────────────────────────────────────────────────
// 點解唔用 jsdom
// ─────────────────────────────────────────────────────────────────────
//
// 呢個 repo 冇 `package.json`、冇 `node_modules`——由第一日就係
// 「淨係要 Node 本身」。為咗一份測試而引入一個重型依賴，
// 代價係日後每一個接手嘅人都要先裝嘢先跑得到測試。
//
// 而前端實際用到嘅 DOM 面本來就好窄（`createElement`／`textContent`／
// `appendChild`／`className`／`addEventListener`），砌一個夠用嘅
// stub 只係幾十行。

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');

/**
 * 一個夠用嘅 DOM 節點。
 *
 * ⚠️ 特登唔扮到十足。佢只需要支援前端真正用到嗰幾樣，
 * 而**唔支援嘅嘢要即刻爆**——扮到似模似樣但行為唔同，
 * 就會造出一個「喺測試度得，喺瀏覽器度唔得」嘅假綠燈。
 */
class StubNode {
  constructor(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.children = [];
    this.className = '';
    this.id = '';
    this.title = '';
    this.type = '';
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.value = '';
    this.style = {};
    this._text = '';
    this._listeners = {};
    this.placeholder = '';
    this.autocomplete = '';
    // 前端有幾處用 `classList.toggle()` 開關一個 class。
    const classes = {};
    this.classList = {
      add: function (c) { classes[c] = true; },
      remove: function (c) { delete classes[c]; },
      contains: function (c) { return !!classes[c]; },
      toggle: function (c, on) {
        if (on === undefined) {
          if (classes[c]) delete classes[c]; else classes[c] = true;
          return !!classes[c];
        }
        if (on) classes[c] = true; else delete classes[c];
        return !!on;
      }
    };
  }

  get textContent() {
    if (this.children.length === 0) return this._text;
    return this._text + this.children.map((c) => c.textContent).join('');
  }

  set textContent(v) {
    this._text = String(v === undefined || v === null ? '' : v);
    this.children = [];
  }

  get firstChild() { return this.children[0] || null; }

  appendChild(node) {
    if (node) this.children.push(node);
    return node;
  }

  removeChild(node) {
    const i = this.children.indexOf(node);
    if (i >= 0) this.children.splice(i, 1);
    return node;
  }

  remove() {
    if (this.parent) this.parent.removeChild(this);
  }

  addEventListener(type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  }

  /**
   * 喺測試度「撳」一個節點。
   * @param {string} type 事件名
   * @returns {void}
   */
  fire(type) {
    (this._listeners[type] || []).forEach((fn) => fn({ target: this }));
  }

  querySelector() { return null; }

  focus() {}

  /** 把整棵樹嘅文字串埋，方便斷言。 */
  allText() {
    return this.textContent;
  }

  /** 把整棵樹攤平成一個陣列。 */
  flatten() {
    const out = [this];
    this.children.forEach((c) => { out.push(...c.flatten()); });
    return out;
  }
}

/**
 * 載入前端。
 *
 * @param {string[]} files `src/ui/` 下面嘅檔名，次序要同 `Index.html` 一樣
 * @returns {Object} vm sandbox（可以直接叫入面嘅函式）
 */
function loadUiScripts(files) {
  const byId = {};
  ['modalTitle', 'modalBody', 'modalActions', 'modalBackdrop', 'modalStatus',
    'status', 'app'].forEach((id) => {
    const node = new StubNode('div');
    node.id = id;
    byId[id] = node;
  });

  const document = {
    getElementById: function (id) {
      if (!byId[id]) {
        const node = new StubNode('div');
        node.id = id;
        byId[id] = node;
      }
      return byId[id];
    },
    createElement: function (tag) { return new StubNode(tag); },
    createTextNode: function (text) {
      const node = new StubNode('#text');
      node.textContent = text;
      return node;
    },
    addEventListener: function () {},
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    body: new StubNode('body')
  };

  const calls = [];
  const sandbox = {
    document: document,
    console: console,
    JSON: JSON,
    Math: Math,
    Date: Date,
    String: String,
    Number: Number,
    Boolean: Boolean,
    Array: Array,
    Object: Object,
    RegExp: RegExp,
    isNaN: isNaN,
    parseInt: parseInt,
    parseFloat: parseFloat,
    setTimeout: function (fn) { return fn ? 0 : 0; },
    clearTimeout: function () {},
    encodeURIComponent: encodeURIComponent,
    // ⚠️ `google.script.run` 一律**唔會真係叫後端**。
    // 呢一層驗嘅係「畫面收到一份 `s` 之後畫咗啲乜」，
    // 唔係「後端回咩」——後者係第 1 層嘅事。
    google: {
      script: {
        run: new Proxy({}, {
          get: function (_t, prop) {
            if (prop === 'withSuccessHandler' || prop === 'withFailureHandler') {
              return function () { return sandbox.google.script.run; };
            }
            return function () { calls.push(String(prop)); };
          }
        }),
        host: { close: function () {} }
      }
    },
    __uiCalls: calls,
    __StubNode: StubNode
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  const context = vm.createContext(sandbox);

  files.forEach(function (name) {
    const raw = fs.readFileSync(path.join(ROOT, 'src', 'ui', name), 'utf8');
    // 逐個 `<script>` 區塊抽出嚟。
    const blocks = raw.match(/<script>([\s\S]*?)<\/script>/g) || [];
    blocks.forEach(function (block, i) {
      const body = block.replace(/^<script>/, '').replace(/<\/script>$/, '');
      // ⚠️ 前端每一個檔案都係一個 `<script>`，而 `<script>` 之間係
      // **共用同一個全域**——所以要用 `var`／函式宣告嘅語意去跑，
      // 唔可以用 `vm.Script` 包成 module（噉樣就每個檔案自己一個 scope）。
      try {
        vm.runInContext(body, context, { filename: 'ui/' + name + '#' + i });
      } catch (err) {
        throw new Error('載入 src/ui/' + name + ' 失敗：' + err.message);
      }
    });
  });

  return sandbox;
}

module.exports = { loadUiScripts, StubNode };

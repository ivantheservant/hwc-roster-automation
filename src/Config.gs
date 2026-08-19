/**
 * 讀取 Config 工作表，並依 Type 欄位把每個值轉換成對應型別，結果快取一段時間
 * （預設 5 分鐘，可用 Config 自己的 SYS_CONFIG_CACHE_SECONDS 覆寫，見 readCacheTtlSeconds_）。
 * @returns {Object.<string, *>} 以 Key 為屬性名稱、已轉換型別的值組成的物件
 */
function readConfig() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(CACHE_KEYS.CONFIG);
  if (cached) {
    return JSON.parse(cached);
  }

  const rows = readSheet(SHEETS.CONFIG);
  const config = {};
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const key = row[COLUMNS.CONFIG.KEY];
    if (!key) continue;
    // ⚠️ 第三十二輪批次階段 A3：**一個壞格唔可以令全個系統停擺。**
    //
    // `convertConfigValue_()` 而家認唔出就會拋錯（呢個係階段 A1 嘅重點）。
    // 但如果喺呢度直接拋，一格壞就代表 `readConfig()` 拋錯，
    // 而 `readConfig()` 幾乎係所有功能嘅第一步——幹事會見到成個系統
    // 每一粒掣都彈同一個錯，睇唔出係邊一格出事。
    //
    // 所以呢度記低唔即拋，等 `getConfig(嗰個 key)` 真係被叫先拋。
    // 揀「記低後補拋」唔揀「轉型延後」嘅理由見稽核文件——
    // 簡單講：`readConfig()` 快取嘅係**已轉型**嘅結果，
    // 轉型延後就要連快取層一齊改，改動面大好多。
    try {
      config[key] = convertConfigValue_(row[COLUMNS.CONFIG.VALUE], row[COLUMNS.CONFIG.TYPE], key);
    } catch (err) {
      config[key] = makeConfigTypeErrorMarker_(err.message);
    }
  }

  cache.put(CACHE_KEYS.CONFIG, JSON.stringify(config), readCacheTtlSeconds_(config));
  return config;
}

/**
 * 決定 Config 快取的 TTL（秒）。讀 Config 自身的 SYS_CONFIG_CACHE_SECONDS；
 * 缺少、非數字或不是正數時採用 CACHE_DURATIONS.CONFIG_SECONDS 的預設值。
 * 這個值在剛從工作表讀出、尚未寫入快取的那一次呼叫中取得，不是循環讀取快取。
 * @param {Object.<string, *>} config 剛從工作表讀出、尚未快取的 config 物件
 * @returns {number} TTL 秒數，介於 1 與 CacheService 上限（21600 秒）之間
 */
function readCacheTtlSeconds_(config) {
  const raw = config[CONFIG_KEYS.SYS_CONFIG_CACHE_SECONDS];
  const parsed = Number(raw);
  if (isNaN(parsed) || parsed <= 0) return CACHE_DURATIONS.CONFIG_SECONDS;
  return Math.min(CACHE_MAX_TTL_SECONDS, Math.round(parsed));
}

/**
 * 清除 Config 的快取，讓下一次 readConfig() 直接從工作表重新讀取。
 * 供選單「重新載入設定」與 validateSetup() 開頭呼叫。
 * @returns {void}
 */
function reloadConfigCache() {
  CacheService.getScriptCache().remove(CACHE_KEYS.CONFIG);
}

/**
 * 讀取單一 Config 值；找不到該 Key 或值為空時回傳 fallback。
 * @param {string} key Config 的 Key
 * @param {*} fallback 找不到或值為空時要回傳的預設值
 * @returns {*} 轉換後的 Config 值，或 fallback
 */
function getConfig(key, fallback) {
  const config = readConfig();
  const value = config[key];
  // ⚠️ 型別認唔出嘅 key，喺呢度先拋——而且**一定要喺 fallback 判斷之前**。
  // 排喺後面嘅話，一個壞格會啱啱好行去 fallback 嗰條路（`value` 唔係空，
  // 但係一個 marker 物件⋯⋯其實唔會中 fallback），總之次序寫錯就會靜靜過。
  if (isConfigTypeErrorMarker_(value)) {
    throw new Error(value.message);
  }
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  return value;
}

/**
 * 「呢個 key 轉型失敗咗」嘅記號。
 *
 * ⚠️ 一定要 **JSON 可以來回**——`readConfig()` 會 `JSON.stringify()` 落快取，
 * 下一次由快取讀返出嚟。用 `Error` 物件或者 `Symbol` 都會喺嗰一轉消失，
 * 然後個壞格就會靜靜變成 `{}` 一個睇落正常嘅物件。
 *
 * @param {string} message 完整錯誤訊息
 * @returns {{__configTypeError__: boolean, message: string}}
 */
function makeConfigTypeErrorMarker_(message) {
  return { __configTypeError__: true, message: String(message) };
}

/**
 * @param {*} value
 * @returns {boolean}
 */
function isConfigTypeErrorMarker_(value) {
  return !!(value && typeof value === 'object' && value.__configTypeError__ === true);
}

/**
 * 階段 A（第五輪批次）新增：供唯讀報告（「匯出關鍵狀態」／「重新載入設定」
 * 這類會把 Config 值直接顯示給人看的地方）使用，回傳「實際生效的值」＋
 * 「這個值是不是退回程式碼預設值」，讓顯示層可以誠實標註來源。
 *
 * 存在的理由：原本這類報告常見的寫法是 `String(config[KEY])` 或
 * `config[KEY] + ''` 直接顯示，Config 工作表根本沒有這個 Key（例如從未
 * 執行過「補建 Config 參數」）時，`config[KEY]` 是 `undefined`，字面顯示
 * 出來就是文字「undefined」——系統實際運作時是安全的（別處都是用
 * `getConfig(key, fallback)` 取得正確的生效值），只是這個報告顯示的內容
 * 本身具誤導性，會讓人以為這個開關真的沒有生效值。跟 `getConfig()` 用
 * 同一個「undefined／null／空字串都算沒有設定」判斷準則，保證兩者對
 * 「是否使用預設值」的認定一致。
 * @param {Object.<string, *>} config readConfig() 的結果（或其子集，只要含這個 key）
 * @param {string} key Config 的 Key
 * @param {*} fallback Config 沒有設定時要用的預設值
 * @returns {{value: *, usedFallback: boolean, display: string}}
 *   value＝實際生效的值；usedFallback＝是否用了預設值；display＝可直接顯示的文字
 */
function describeConfigValue_(config, key, fallback) {
  const raw = config[key];
  // ⚠️ 型別壞咗嘅 key **唔可以顯示成 `[object Object]`**，
  // 更加唔可以扮成「用緊預設值」——嗰兩個講法都會令人以為冇事。
  if (isConfigTypeErrorMarker_(raw)) {
    return {
      value: null, usedFallback: false,
      display: '⚠️ 這一格的型別認不出來（詳情見「全面體檢 ▸ Config 值型別檢查」）'
    };
  }
  const usedFallback = raw === undefined || raw === null || raw === '';
  const value = usedFallback ? fallback : raw;
  return {
    value: value,
    usedFallback: usedFallback,
    display: String(value) + (usedFallback ? '（Config 未設定，用預設值）' : '')
  };
}

/**
 * 依 Type 字串把 Config 的原始儲存格值轉換成對應型別。
 * INT/DEC 轉數字、BOOL 轉布林、LIST 依逗號拆分並 trim，其餘一律轉字串。
 * @param {*} rawValue Config 工作表 Value 欄的原始值
 * @param {string} type Config 工作表 Type 欄（INT/DEC/BOOL/LIST/其他）
 * @returns {*} 轉換後的值
 */
function convertConfigValue_(rawValue, type, key) {
  const str = (rawValue === null || rawValue === undefined) ? '' : String(rawValue).trim();
  const fail = function (why) {
    throw new Error(buildConfigTypeErrorMessage_(key, type, str, why));
  };

  switch (type) {
    case CONFIG_TYPES.INT: {
      if (str === '') return null;
      const n = Number(str);
      // ⚠️ 三個 check 缺一不可，而且**唔可以合併成 `Number(str) || 預設`**。
      // 舊寫法就係直接 `return Number(str)`，`NaN` 一路傳落去，
      // 下游 `Number(x) || DEFAULT` 就靜靜退回預設值——
      // 即係「你喺 Config 改嗰個數字完全冇生效」，而畫面上乜提示都冇。
      if (isNaN(n)) fail('這不是一個數字');
      if (!isFinite(n)) fail('這是無限大，不是一個可以用的數字');
      if (Math.floor(n) !== n) fail('INT 是整數，但這個值有小數部分');
      return n;
    }
    case CONFIG_TYPES.DEC: {
      if (str === '') return null;
      const n = Number(str);
      if (isNaN(n)) fail('這不是一個數字');
      if (!isFinite(n)) fail('這是無限大，不是一個可以用的數字');
      return n;
    }
    case CONFIG_TYPES.BOOL: {
      // ⚠️ **空字串維持回 `false`**，唔改——現有幾十個呼叫點都靠住
      //「冇設定 ＝ 唔開」呢個行為。
      if (str === '') return false;
      const upper = str.toUpperCase();
      if (upper === 'TRUE') return true;
      if (upper === 'FALSE') return false;
      // ⚠️ 舊寫法係 `str.toUpperCase() === 'TRUE'`，即係**任何認唔出嘅嘢
      // 都靜靜變 `false`**。而 `DRY_RUN` 就係 BOOL——嗰一格一旦被
      // 試算表轉成日期／數字，`DRY_RUN` 靜靜變 `false`
      // ＝ 真係寄信俾全體義工。呢個係成套系統最貴嘅一個靜默失敗。
      fail('BOOL 只認得 TRUE 或 FALSE（大小寫不限）');
      return false;   // 到不了這裡；只為讓靜態檢查看得出每條路都有回傳值
    }
    case CONFIG_TYPES.LIST: {
      if (str === '') return [];
      const parts = str.split(',').map(function (s) { return s.trim(); });
      // LIST 冇辦法逐項驗證內容（成員本來就係自由文字），但**至少要擋住
      // 「成格被試算表轉成一個日期」**——嗰種情況下成個清單會變成
      // 一項亂七八糟嘅英文長字串，而下游只會當成一個正常成員。
      parts.forEach(function (p) {
        if (looksLikeStringifiedSheetsValue_(p)) {
          fail('清單裡的「' + p + '」看起來是試算表自動轉成的日期，不是一個清單項目');
        }
      });
      return parts;
    }
    default:
      // ⚠️ `STR` / `ENUM` / `EMAIL` **一律唔改**。
      // `ICS_SERVICE_START_TIME` 呢類靠下游 `normalizeTimeOfDay_()` 處理
      //（第三十一輪階段 A 嘅治本），喺呢一層攔住反而會令嗰個修正
      // 永遠用唔著。
      return str;
  }
}

/**
 * 一個字串睇落係咪「試算表把格自動轉咗之後再 `String()` 出嚟」嘅結果。
 *
 * ⚠️ 判斷特登收得窄。收得闊會把正常值當成壞值，
 * 而一個誤報嘅型別錯誤會令幹事撳唔到掣，比冇檢查更差。
 *
 * @param {string} s
 * @returns {boolean}
 */
function looksLikeStringifiedSheetsValue_(s) {
  const text = String(s || '');
  // `String(new Date())` ＝ `Sat Dec 30 1899 10:45:00 GMT+1130 (…)`
  if (/^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{2} \d{4}/.test(text)) return true;
  if (/GMT[+-]\d{4}/.test(text)) return true;
  // `toISOString()` 形狀
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) return true;
  return false;
}

/**
 * Config 型別錯誤嘅訊息。**呢段字會直接彈俾幹事睇**，所以唔可以只寫
 *「型別錯誤」——要講齊四件事：邊個 Key、讀到咩、點解會咁、點樣修。
 *
 * @param {string} key Config 的 Key（可能是 undefined，例如直接呼叫純函式時）
 * @param {string} type 宣告型別
 * @param {string} str 讀到的原值（已 trim）
 * @param {string} why 這一次認不出的具體原因
 * @returns {string}
 */
function buildConfigTypeErrorMessage_(key, type, str, why) {
  const keyName = (key === undefined || key === null || String(key).trim() === '')
    ? '（呼叫時沒有提供 Key 名稱）' : String(key);

  const lines = [
    'Config 參數「' + keyName + '」的值認不出來。',
    '',
    '宣告型別：' + type,
    '讀到的值：「' + str + '」',
    '認不出的原因：' + why,
    '',
    '最可能的原因：Google 試算表把那一格自動當成日期／數字了。',
    '你在格子裡看到的還是原本輸入的東西，但實際存進去的已經不是文字。',
    '',
    '怎樣修：',
    '　1. 開 Config 工作表，選中「' + keyName + '」那一行的 Value 格',
    '　2. 格式 ▸ 數字 ▸ 純文字',
    '　3. 把值重新輸入一次（一定要重新輸入，改格式不會改回已經存了的值）',
    // 第三十三輪批次階段 D1：呢一句實測指錯咗路。「重新載入設定（唯讀）」
    // 喺「查看（唯讀，只寫 Diagnostics）」子選單，唔喺「維護」。
    // 幹事照住去維護子選單搵，會搵唔到，然後以為自己做錯咗嘢。
    '　4. 選單 ▸ 查看（唯讀，只寫 Diagnostics）▸ 重新載入設定（唯讀）'
  ];

  // ⚠️ `DRY_RUN` 要有專屬一句。呢一格出事嘅後果同其他參數唔同一個量級。
  if (String(key) === CONFIG_KEYS.DRY_RUN) {
    lines.push('');
    lines.push('⚠️ 這個參數控制系統會不會真正寄出電郵。'
      + '在它被確認之前，任何寄送動作都會被擋住。');
  }
  return lines.join('\n');
}

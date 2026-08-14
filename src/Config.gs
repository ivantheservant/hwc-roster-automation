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
    config[key] = convertConfigValue_(row[COLUMNS.CONFIG.VALUE], row[COLUMNS.CONFIG.TYPE]);
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
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  return value;
}

/**
 * 依 Type 字串把 Config 的原始儲存格值轉換成對應型別。
 * INT/DEC 轉數字、BOOL 轉布林、LIST 依逗號拆分並 trim，其餘一律轉字串。
 * @param {*} rawValue Config 工作表 Value 欄的原始值
 * @param {string} type Config 工作表 Type 欄（INT/DEC/BOOL/LIST/其他）
 * @returns {*} 轉換後的值
 */
function convertConfigValue_(rawValue, type) {
  const str = (rawValue === null || rawValue === undefined) ? '' : String(rawValue).trim();
  switch (type) {
    case CONFIG_TYPES.INT:
    case CONFIG_TYPES.DEC:
      return str === '' ? null : Number(str);
    case CONFIG_TYPES.BOOL:
      return str.toUpperCase() === 'TRUE';
    case CONFIG_TYPES.LIST:
      return str === '' ? [] : str.split(',').map(function (s) { return s.trim(); });
    default:
      return str;
  }
}

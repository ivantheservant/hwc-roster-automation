// 第六十三輪批次 G 組：改 Config 唔會自動清快取。
// 執行方式：node tests/config_onedit.test.js
//
// `Config.gs` 快取 300 秒，全專案冇 `onEdit`。把 `DRY_RUN` 由 FALSE 改返 TRUE
// 而唔記得撳「重新載入設定」⇒ 最多五分鐘之內寄送路徑仍然讀到 FALSE。

const fs = require('fs');
const path = require('path');
const { loadGasSource } = require('./helpers/gas_loader.js');

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + String(extra).slice(0, 400));
}

const gas = loadGasSource(['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'Config.gs']);
let removed = [];
gas.CacheService = { getScriptCache: function () {
  return { remove: function (k) { removed.push(k); }, get: function () { return null; }, put: function () {} };
} };
const logs = [];
gas.log_ = function (level, msg) { logs.push(level + ' ' + msg); };
const editOn = function (name) {
  return { range: { getSheet: function () { return { getName: function () { return name; } }; } } };
};

console.log('\n=== G【核心】改 Config ⇒ 即刻清快取 ===');
gas.onEdit(editOn('Config'));
check('★★★★★★ 改 Config 工作表 ⇒ 清咗 Config 快取'
  + '——唔清嘅話 DRY_RUN 改返 TRUE 之後五分鐘之內仍然會真寄',
  removed.length === 1 && removed[0] === gas.CACHE_KEYS.CONFIG, JSON.stringify(removed));

removed = [];
gas.onEdit(editOn('RosterAssignments'));
check('★★★★★ 改其他工作表 ⇒ 唔清', removed.length === 0);

console.log('\n=== G：簡單觸發器入面唔可以拋錯 ===');
let threw = false;
try { gas.onEdit(undefined); gas.onEdit({}); } catch (e) { threw = true; }
check('★★★★ 冇事件／冇 range ⇒ 唔拋錯、唔清', !threw && removed.length === 0);
gas.CacheService = { getScriptCache: function () { throw new Error('快取服務暫時用不到'); } };
threw = false;
try { gas.onEdit(editOn('Config')); } catch (e) { threw = true; }
check('★★★★ 清快取失敗 ⇒ 唔拋錯，寫一句 log', !threw && logs.some(function (l) { return /onEdit/.test(l); }));

console.log('\n=== G：全專案只有一個 onEdit ===');
{
  const dir = path.join(__dirname, '..', 'src');
  const hits = fs.readdirSync(dir).filter(function (n) { return /\.(gs|js)$/.test(n); })
    .filter(function (n) { return /^function onEdit\(/m.test(fs.readFileSync(path.join(dir, n), 'utf8')); });
  check('★★★★★ 只有 Config.gs 一個（兩個同名簡單觸發器只會行其中一個）',
    hits.length === 1 && hits[0] === 'Config.gs', JSON.stringify(hits));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);

// 第十六輪批次階段 D：教會新規則 5（每年四次固定合堂）與「未確認日期」
// 提醒機制嘅測試。執行方式：node tests/annual_combined.test.js
//
// 最重要嘅一節係復活節演算法——任務明確要求「用正確的演算法計算，不要寫死」，
// 所以測試用**外部已知嘅正確答案**逐年對，而唔係對住實作自己嘅輸出。
// 呢啲日期可以喺任何教會年曆／百科查證，係獨立於本專案嘅事實。

const { loadGasSource, FILES_FOR_GENERATOR } = require('./helpers/gas_loader.js');

const gas = loadGasSource(FILES_FOR_GENERATOR.concat(['AnnualCombined.gs']), {
  // shiftDateString_()（Utils.gs）會用到 Utilities.formatDate，
  // nearestSundayTo_() 內部有呼叫到。
  Utilities: {
    formatDate: function (date, tz, fmt) {
      const iso = new Date(date).toISOString();
      if (fmt === 'yyyy-MM-dd') return iso.slice(0, 10);
      return iso;
    }
  }
});

let fail = 0;
function check(label, condition, extra) {
  const ok = !!condition;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok && extra) console.log('      ' + extra);
}
function checkEqual(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      got=${JSON.stringify(actual)}\n      expected=${JSON.stringify(expected)}`);
}

console.log('\n=== D1【核心】復活節主日：對住外部已知嘅正確答案逐年驗證 ===');
{
  // 呢批日期唔係由本專案產生，係公開嘅事實（西方教會格里曆復活節）。
  // 用外部答案做基準，先至證明得到演算法本身啱，而唔係「同自己一致」。
  const KNOWN = {
    2020: '2020-04-12',
    2021: '2021-04-04',
    2022: '2022-04-17',
    2023: '2023-04-09',
    2024: '2024-03-31',
    2025: '2025-04-20',
    2026: '2026-04-05',
    2027: '2027-03-28',
    2028: '2028-04-16',
    2029: '2029-04-01',
    2030: '2030-04-21',
    2031: '2031-04-13',
    2032: '2032-03-28'
  };
  Object.keys(KNOWN).forEach(function (year) {
    checkEqual('★★★★★ ' + year + ' 年復活節主日', gas.computeEasterSunday_(Number(year)), KNOWN[year]);
  });

  // 極端邊界：復活節嘅可能範圍係 3 月 22 日至 4 月 25 日
  checkEqual('★★★★ 最早可能嘅復活節（1818 年 3 月 22 日）', gas.computeEasterSunday_(1818), '1818-03-22');
  checkEqual('★★★★ 最遲可能嘅復活節（1943 年 4 月 25 日）', gas.computeEasterSunday_(1943), '1943-04-25');
}

console.log('\n=== D1：算出嚟嘅復活節一定係星期日（結構性自我檢查）===');
{
  let allSundays = true;
  const bad = [];
  for (let y = 2025; y <= 2060; y++) {
    const d = gas.computeEasterSunday_(y);
    if (!gas.isSundayDate_(d)) { allSundays = false; bad.push(y + '=' + d); }
  }
  check('★★★★★ 2025-2060 全部 36 年算出嚟都係星期日（如果演算法有 off-by-one 呢度即刻捉到）',
    allSundays, bad.join('、'));
}

console.log('\n=== D1：八月最後一個主日、十月第一個主日 ===');
{
  checkEqual('★★★★ 2026 年 8 月最後一個主日', gas.lastSundayOfMonth_(2026, 8), '2026-08-30');
  checkEqual('★★★★ 2027 年 8 月最後一個主日', gas.lastSundayOfMonth_(2027, 8), '2027-08-29');
  checkEqual('★★★ 2026 年 10 月第一個主日', gas.nthSundayOfMonth_(2026, 10, 1), '2026-10-04');
  checkEqual('★★★ 2027 年 10 月第一個主日', gas.nthSundayOfMonth_(2027, 10, 1), '2027-10-03');

  // 邊界：月頭第一日就係星期日
  checkEqual('★★★★ 邊界：2026 年 2 月 1 日本身就係星期日 → 第一個主日就係嗰日',
    gas.nthSundayOfMonth_(2026, 2, 1), '2026-02-01');
  // 邊界：月尾最後一日就係星期日
  checkEqual('★★★★ 邊界：2027 年 1 月 31 日本身就係星期日 → 最後一個主日就係嗰日',
    gas.lastSundayOfMonth_(2027, 1), '2027-01-31');

  let allSundays = true;
  const bad = [];
  for (let y = 2026; y <= 2040; y++) {
    [gas.lastSundayOfMonth_(y, 8), gas.nthSundayOfMonth_(y, 10, 1)].forEach(function (d) {
      if (!gas.isSundayDate_(d)) { allSundays = false; bad.push(d); }
    });
  }
  check('★★★★ 2026-2040 全部算出嚟都係星期日', allSundays, bad.join('、'));
}

console.log('\n=== D1：五月合堂（5 月 22 日前後最接近嘅主日）===');
{
  // 2027-05-22 係星期六 → 最近嘅主日係 5 月 23 日（之後一日）
  checkEqual('★★★ 2027 年（5/22 係星期六 → 取後一日）', gas.nearestSundayTo_(2027, 5, 22), '2027-05-23');
  // 2026-05-22 係星期五 → 前 5 日 / 後 2 日 → 取後
  checkEqual('★★★ 2026 年（5/22 係星期五 → 取後兩日）', gas.nearestSundayTo_(2026, 5, 22), '2026-05-24');
  // 2028-05-21 係星期日；5/22 係星期一 → 前 1 日 / 後 6 日 → 取前
  checkEqual('★★★★ 2028 年（5/22 係星期一 → 取前一日，證明真係「最接近」唔係「一律取後」）',
    gas.nearestSundayTo_(2028, 5, 22), '2028-05-21');

  let allSundays = true;
  const bad = [];
  for (let y = 2026; y <= 2040; y++) {
    const d = gas.nearestSundayTo_(y, 5, 22);
    if (!gas.isSundayDate_(d)) { allSundays = false; bad.push(y + '=' + d); }
    // 而且一定要喺 5 月 22 日前後 3 日之內
    if (Math.abs(gas.daysBetween_(gas.formatYmd_(y, 5, 22), d)) > 3) bad.push(y + ' 差太遠 ' + d);
  }
  check('★★★★ 2026-2040 算出嚟全部係星期日，而且全部喺 5/22 前後 3 日之內', allSundays && bad.length === 0, bad.join('、'));
}

console.log('\n=== D1【核心】planAnnualCombinedSundays_()：四項建議，只有五月嗰項未確認 ===');
{
  const plan = gas.planAnnualCombinedSundays_(2027);
  checkEqual('★★★★ 一次過畀四項', plan.length, 4);
  checkEqual('★★★★★ 四個日期', plan.map((p) => p.serviceDate),
    ['2027-03-28', '2027-05-23', '2027-08-29', '2027-10-03']);
  checkEqual('★★★★★ 只有五月嗰項係「未確認」，其餘三項都算得出所以已確認',
    plan.map((p) => p.confirmed), [true, false, true, true]);
  check('★★★ 五月嗰項嘅備註明確叫幹事去確認同改 Confirmed',
    plan[1].notes.indexOf('Confirmed') !== -1 && plan[1].notes.indexOf('確認') !== -1, plan[1].notes);
  check('★★★★ 全部四項都冇預先填 SkipPostIDs（工具唔應該猜邊個崗位要跳過）',
    plan.every((p) => p.skipPostIds === undefined));
  check('★★ Type 一律「合堂」，Title 各自唔同（用資料表達三種合堂嘅分別，見 D4）',
    plan.every((p) => p.type === '合堂') && new Set(plan.map((p) => p.title)).size === 4);
}

console.log('\n=== D2／D3【核心】isUnconfirmedSpecialSunday_()：空白＝已確認（方向唔可以搞錯）===');
{
  // 呢個係本階段最易寫反嘅一個判斷。空白當「未確認」嘅話，全部既有列
  // 一開機就會變成未確認，提醒機制即刻噴一堆假警報。
  checkEqual('★★★★★ 空白 → 已確認（後加欄位，唔可以令既有列全部變未確認）',
    gas.isUnconfirmedSpecialSunday_({ Confirmed: '' }), false);
  checkEqual('★★★★★ 欄位完全唔存在（舊工作表冇呢一欄）→ 已確認',
    gas.isUnconfirmedSpecialSunday_({}), false);
  checkEqual('★★★★ 明確 FALSE → 未確認', gas.isUnconfirmedSpecialSunday_({ Confirmed: 'FALSE' }), true);
  checkEqual('★★★★ 明確 TRUE → 已確認', gas.isUnconfirmedSpecialSunday_({ Confirmed: 'TRUE' }), false);
  checkEqual('★★★ 布林 false → 未確認', gas.isUnconfirmedSpecialSunday_({ Confirmed: false }), true);
  checkEqual('★★★ 布林 true → 已確認', gas.isUnconfirmedSpecialSunday_({ Confirmed: true }), false);
  checkEqual('★★ 大小寫唔敏感（試算表打細楷都認得）',
    gas.isUnconfirmedSpecialSunday_({ Confirmed: 'true' }), false);
}

console.log('\n=== D3：describeUnconfirmedSpecialSundays_()：完成畫面同提醒信共用嘅文字 ===');
{
  checkEqual('★★★★ 冇未確認項目 → 空字串（呼叫端可以直接 if 判斷要唔要顯示）',
    gas.describeUnconfirmedSpecialSundays_([]), '');
  checkEqual('★★★ null 都當冇（唔會拋錯）', gas.describeUnconfirmedSpecialSundays_(null), '');

  const text = gas.describeUnconfirmedSpecialSundays_([
    { serviceDate: '2027-05-23', title: '五月合堂（日期待確認）' }
  ]);
  check('★★★★ 有未確認項目時列出日期同標題',
    text.indexOf('2027-05-23') !== -1 && text.indexOf('五月合堂') !== -1, text);
  check('★★★★ 講得出點解要處理（日期錯咗要重新生成）',
    text.indexOf('重新生成') !== -1, text);
  check('★★★ 講得出具體點做（改 Confirmed 做 TRUE）',
    text.indexOf('Confirmed') !== -1, text);
}

console.log('\n=== D4 判斷記錄：三種合堂嘅分別用既有欄位表達得到，唔需要新機制 ===');
{
  // 呢一節唔係測程式行為，係鎖住 D4 嘅判斷結論——如果日後有人想加
  // 「合堂類型」嘅特殊邏輯，會喺呢度見到當初點解決定唔加。
  const plan = gas.planAnnualCombinedSundays_(2027);
  const easter = plan[0];
  const mission = plan[2];
  check('★★★ 浸禮（翻譯需求較高）嘅備註提到翻譯係人手填寫嘅崗位',
    easter.notes.indexOf('翻譯') !== -1, easter.notes);
  check('★★★ 宣教月（講員多為宣教士）嘅備註提到講員係人手填寫嘅崗位',
    mission.notes.indexOf('講員') !== -1, mission.notes);
  // 「堂慶由英語堂帶領詩司琴」用 SkipPostIDs + ExternalOwner 表達，
  // 兩個欄位早已存在並且喺 2026-10-04 實測過，唔需要本輪新增任何嘢。
  check('★★★★ 結論：四項建議全部只用既有欄位（Type／Title／備註），冇引入任何新機制',
    plan.every((p) => Object.keys(p).sort().join(',') === 'confirmed,kind,notes,serviceDate,title,type'),
    JSON.stringify(Object.keys(plan[0])));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);

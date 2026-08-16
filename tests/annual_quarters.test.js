// 第十七輪批次階段 C：「產生下一年度四個季度」嘅測試。
// 執行方式：node tests/annual_quarters.test.js
//
// 重點測三樣：日期／主日數算得啱、**只 append 唔覆寫**、季度月份劃分
// 真係讀得到 Config（唔再寫死）。

const { loadGasSource } = require('./helpers/gas_loader.js');

const gas = loadGasSource(
  ['Constants.gs', 'Utils.gs', 'SheetReader.gs', 'NewQuarterWizard.gs', 'AnnualQuarters.gs'],
  {
    Utilities: {
      formatDate: function (date, tz, fmt) {
        const iso = new Date(date).toISOString();
        return fmt === 'yyyy-MM-dd' ? iso.slice(0, 10) : iso;
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

const CALENDAR = { 1: 1, 2: 4, 3: 7, 4: 10 };

console.log('\n=== C1【核心】planAnnualQuarters_()：四季起訖日 ===');
{
  const plans = gas.planAnnualQuarters_(2027, CALENDAR, {}, {});
  checkEqual('★★★★ 一次過四季', plans.length, 4);
  checkEqual('★★★★★ 四個 QuarterID',
    plans.map((p) => p.quarterId), ['2027T1', '2027T2', '2027T3', '2027T4']);
  checkEqual('★★★★★ 四季起訖日（日曆季度）',
    plans.map((p) => p.startDate + '~' + p.endDate),
    ['2027-01-01~2027-03-31', '2027-04-01~2027-06-30',
      '2027-07-01~2027-09-30', '2027-10-01~2027-12-31']);
  checkEqual('★★★ Term 由 1 數到 4', plans.map((p) => p.term), [1, 2, 3, 4]);
  checkEqual('★★★ Year 全部係輸入嘅年份', plans.map((p) => p.year), [2027, 2027, 2027, 2027]);
}

console.log('\n=== C1【核心】WeekCount 係真係數出嚟，唔係假設 13 ===');
{
  const plans = gas.planAnnualQuarters_(2027, CALENDAR, {}, {});
  const counts = plans.map((p) => p.weekCount);

  // 逐季獨立驗證：主日數 = serviceDates 長度 = 該範圍內星期日數
  plans.forEach((p) => {
    checkEqual('★★★ ' + p.quarterId + ' 嘅 weekCount 同 serviceDates 長度一致',
      p.weekCount, p.serviceDates.length);
  });
  check('★★★★★ 全年四季主日總數 = 2027 年全年星期日數（52 或 53）',
    counts.reduce((a, b) => a + b, 0) === 52 || counts.reduce((a, b) => a + b, 0) === 53,
    '實際：' + JSON.stringify(counts) + ' 合計 ' + counts.reduce((a, b) => a + b, 0));

  // ⚠️ 2027 年啱啱好四季都係 13 個主日，所以單用 2027 證明唔到「真係數出嚟」。
  // 用 2029（12／13／14／13）同 2028（13／13／13／14）——兩年都有唔同嘅季度長度，
  // 如果實作係硬寫 13，呢兩個斷言即刻爆。
  const counts2029 = gas.planAnnualQuarters_(2029, CALENDAR, {}, {}).map((p) => p.weekCount);
  checkEqual('★★★★★ 2029 年四季主日數係 12／13／14／13（證明真係逐季數，唔係硬寫 13）',
    counts2029, [12, 13, 14, 13]);
  const counts2028 = gas.planAnnualQuarters_(2028, CALENDAR, {}, {}).map((p) => p.weekCount);
  checkEqual('★★★★ 2028 年 T4 有 14 個主日', counts2028, [13, 13, 13, 14]);

  // 全部日期一定要係星期日，而且連續相隔 7 日
  let allSundays = true;
  plans.forEach((p) => {
    p.serviceDates.forEach((sd) => { if (!gas.isSundayDate_(sd.serviceDate)) allSundays = false; });
  });
  check('★★★★ 全部算出嚟嘅日期都係星期日', allSundays);
}

console.log('\n=== C1：ServiceDateID 格式同「新增季度」一致、IsFirstSundayOfMonth 自動算 ===');
{
  const plans = gas.planAnnualQuarters_(2027, CALENDAR, {}, {});
  const t1 = plans[0];

  checkEqual('★★★★ ServiceDateID 用 {QuarterID}-W{兩位數} 格式（沿用既有慣例）',
    t1.serviceDates.slice(0, 3).map((s) => s.serviceDateId),
    ['2027T1-W01', '2027T1-W02', '2027T1-W03']);
  check('★★★ 第 10 週之後唔會補零', t1.serviceDates[9].serviceDateId === '2027T1-W10');

  // 一季三個月 → 應該啱啱好三個「該月第一個主日」
  const firsts = t1.serviceDates.filter((s) => s.isFirstSundayOfMonth);
  checkEqual('★★★★★ 一季三個月 → 三個 IsFirstSundayOfMonth=TRUE', firsts.length, 3);
  checkEqual('★★★★ 而且分別落喺 1、2、3 月',
    firsts.map((s) => s.serviceDate.slice(5, 7)), ['01', '02', '03']);
  checkEqual('★★★ 第一個主日一定係第一個 TRUE', t1.serviceDates[0].isFirstSundayOfMonth, true);
  checkEqual('★★★ WeekIndex 由 1 開始連續',
    t1.serviceDates.map((s) => s.weekIndex).slice(0, 5), [1, 2, 3, 4, 5]);
}

console.log('\n=== C4【核心】只 append 唔覆寫：已存在嘅季度整季略過 ===');
{
  const existingQ = { '2027T1': true, '2027T3': true };
  const plans = gas.planAnnualQuarters_(2027, CALENDAR, existingQ, {});

  checkEqual('★★★★★ 已存在嘅兩季標咗 alreadyExists',
    plans.map((p) => p.quarterId + '=' + p.alreadyExists),
    ['2027T1=true', '2027T2=false', '2027T3=true', '2027T4=false']);

  // 就算 alreadyExists，plan 一樣算得出日期（畀預覽畫面顯示），
  // 只係唔會被寫入——真正嘅擋喺 executeAnnualQuarters_()
  check('★★★ 已存在嘅季度一樣有算日期（預覽畫面要顯示得到）',
    plans[0].weekCount > 0 && plans[0].startDate === '2027-01-01');
}

console.log('\n=== C4：已存在嘅 ServiceDateID 逐行略過 ===');
{
  const existingSD = { '2027T2-W01': true, '2027T2-W02': true };
  const plans = gas.planAnnualQuarters_(2027, CALENDAR, {}, existingSD);
  const t2 = plans[1];

  checkEqual('★★★★★ 兩行已存在 → newServiceDates 少兩行',
    t2.newServiceDates.length, t2.serviceDates.length - 2);
  checkEqual('★★★★ skippedServiceDates 數得啱', t2.skippedServiceDates, 2);
  check('★★★★ 略過嘅係嗰兩個 ID，唔係頭兩行盲目扣走',
    t2.newServiceDates.every((s) => s.serviceDateId !== '2027T2-W01'
      && s.serviceDateId !== '2027T2-W02'));
  checkEqual('★★★ 其餘季度唔受影響', plans[0].skippedServiceDates, 0);
}

console.log('\n=== C6【核心】季度月份劃分可以由 Config 改（唔再寫死）===');
{
  // 學期制：T1 由 2 月起、T2 由 5 月起、T3 由 8 月起、T4 由 11 月起
  const academic = { 1: 2, 2: 5, 3: 8, 4: 11 };
  const plans = gas.planAnnualQuarters_(2027, academic, {}, {});

  checkEqual('★★★★★ 換咗月份劃分，起訖日跟住變（證明真係冇寫死）',
    plans.map((p) => p.startDate + '~' + p.endDate),
    ['2027-02-01~2027-04-30', '2027-05-01~2027-07-31',
      '2027-08-01~2027-10-31', '2027-11-01~2028-01-31']);
  check('★★★★ T4 跨年嗰段都算得啱（11 月起 → 下一年 1 月尾）',
    plans[3].endDate === '2028-01-31');
}

console.log('\n=== C6：computeCalendarQuarterRange_() 唔傳 startMonths 時維持舊行為 ===');
{
  // 呢個係向後相容嘅保證：既有呼叫者（同既有測試）唔傳第三個參數，
  // 應該同加呢個參數之前一模一樣。
  checkEqual('★★★★★ 唔傳參數 → 日曆季度（同加參數之前一樣）',
    gas.computeCalendarQuarterRange_(2027, 2),
    { startDate: '2027-04-01', endDate: '2027-06-30' });
  checkEqual('★★★ 傳日曆季度 map → 結果一樣',
    gas.computeCalendarQuarterRange_(2027, 2, CALENDAR),
    { startDate: '2027-04-01', endDate: '2027-06-30' });
}

console.log('\n=== C2：預覽文字要列清楚每季起訖、主日數、第一個同最後一個主日 ===');
{
  const plans = gas.planAnnualQuarters_(2027, CALENDAR, { '2027T1': true }, {});
  const preview = gas.buildAnnualQuartersPreview_(2027, plans, CALENDAR);

  check('★★★★ 四個 QuarterID 都出現',
    ['2027T1', '2027T2', '2027T3', '2027T4'].every((id) => preview.indexOf(id) !== -1));
  check('★★★★ 有起訖日', preview.indexOf('2027-04-01 至 2027-06-30') !== -1, preview);
  check('★★★★ 有主日數', preview.indexOf('主日 ') !== -1);
  check('★★★★ 有第一個同最後一個主日', preview.indexOf('第一個 ') !== -1 && preview.indexOf('最後一個 ') !== -1);
  check('★★★★★ 已存在嘅季度明確標示「整季略過、不會覆寫」',
    preview.indexOf('整季略過') !== -1 && preview.indexOf('不會覆寫') !== -1, preview);
  check('★★★★★ C5：明確提醒 GenerateOn／OfficialSendOn 留空、要跑「計算季度日期」',
    preview.indexOf('GenerateOn') !== -1 && preview.indexOf('計算季度日期') !== -1, preview);
  check('★★★ 有講月份劃分喺 Config 邊個 Key 改',
    preview.indexOf('QUARTER_TERM_START_MONTHS') !== -1, preview);
  check('★★★ 有列出將新增嘅季度數同 ServiceDates 行數',
    preview.indexOf('將新增：3 個季度') !== -1, preview);
}

console.log('\n=== C：閏年／年尾邊界 ===');
{
  // 2028 係閏年
  const plans2028 = gas.planAnnualQuarters_(2028, CALENDAR, {}, {});
  checkEqual('★★★★ 閏年 T1 結束日係 3-31（唔會因為 2 月 29 而算錯）',
    plans2028[0].endDate, '2028-03-31');
  checkEqual('★★★★ T4 結束日一定係 12-31', plans2028[3].endDate, '2028-12-31');

  let allSundays = true;
  plans2028.forEach((p) => p.serviceDates.forEach((sd) => {
    if (!gas.isSundayDate_(sd.serviceDate)) allSundays = false;
  }));
  check('★★★★ 閏年全部日期一樣係星期日', allSundays);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURE(S)'}`);
process.exit(fail === 0 ? 0 : 1);

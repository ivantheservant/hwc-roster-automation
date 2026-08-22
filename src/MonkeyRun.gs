/**
 * 第四十九輪批次 第 4 層：**亂行機。**
 *
 * ═════════════════════════════════════════════════════════════════════
 * 佢擋緊嘅係邊一種病
 * ═════════════════════════════════════════════════════════════════════
 *
 * 前面三層各自擋一種：
 *   第 1 層　「fixture 造唔出嘅狀態」——由真實入口造狀態
 *   第 2 層　「前端測試用假資料」——錄真實 payload
 *   第 3 層　「畫面同表對唔上」——不變量
 *
 * 三層都有同一個盲點：**佢哋只走我想像得到嗰幾條路。**
 *
 * 自測機嘅 S01→S10 係我坐喺度諗出嚟嘅次序。而現場撞到嘅 bug，
 * 有一半係「冇人諗過要噉撳」——例如第四十七輪嗰個死碼，
 * 就係「改咗格、未儲存、然後直接撳寄出」呢一條冇人特登行過嘅路。
 *
 * 亂行機做嘅就係：**由沙盒季度嘅當前狀態出發，睇吓而家有邊幾個動作
 * 係合法嘅，隨機揀一個執行，然後跑一次全部不變量。重覆 N 次。**
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ 最重要嘅輸出係嗰一行「走到這裡的完整步驟」
 * ─────────────────────────────────────────────────────────────────────
 *
 * 冇咗佢，紅咗都重現唔到——而一個重現唔到嘅 bug 報告，
 * 對兩個月之後嘅自己嚟講等於冇。
 *
 * 所以：固定 seed（寫喺報告開頭）＋ 每一步寫 `MonkeyLog`
 * ＋ 失敗嗰陣印出完整路徑。同一個 seed 重跑一定同一條路。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ 絕對唔准做嘅嘢
 * ─────────────────────────────────────────────────────────────────────
 *
 *   ・安裝 trigger
 *   ・真實寄信（全程 DRY_RUN，每 10 步再斷言一次）
 *   ・重設非沙盒季度
 *   ・改 Config
 *   ・改人員資料
 *
 * 呢五條唔係靠「我記得唔好噉做」——動作清單入面根本冇嗰幾個動作，
 * 而且有測試守住清單本身。
 */

/** 一次亂行最多幾多步（防走火）。 */
const MONKEY_MAX_STEPS = 500;

/** 每幾多步重新斷言一次 `DRY_RUN`。 */
const MONKEY_DRY_RUN_RECHECK_EVERY = 10;

/** 亂行機用嘅工作表。 */
const MONKEY_SHEETS = { LOG: 'MonkeyLog', STATE: 'MonkeyState' };

/**
 * 一次執行最多用幾多毫秒。同自測機一樣留 1.5 分鐘收尾。
 */
const MONKEY_TIME_BUDGET_MS = 4.5 * 60 * 1000;

/**
 * 可以重覆嘅偽隨機。
 *
 * ⚠️ **唔可以用 `Math.random()`。** 同一個 seed 重跑要行返同一條路——
 * 冇咗呢一點，一個紅咗嘅步驟就永遠重現唔到。
 *
 * @param {number} seed 種子
 * @returns {function(): number} 每次回一個 [0,1) 嘅數
 */
function makeMonkeyRandom_(seed, skip) {
  // mulberry32：短、夠散、而且完全確定。
  let a = (Number(seed) || 1) >>> 0;
  let drawn = 0;
  const next = function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    drawn++;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // ⚠️ 續跑嗰陣要**快轉**過上一次抽咗嘅次數。
  //
  // 唔快轉嘅話，「繼續亂行」會由同一個 seed 嘅第一抽再嚟一次，
  // 即係行返上一次同一條路——而嗰個唔係「繼續」，
  // 係「由頭再行一次，而報告寫住繼續」。
  for (let i = 0; i < (Number(skip) || 0); i++) next();
  next.drawnCount = function () { return drawn; };
  return next;
}

/* ═════════════════════════════════════════════════════════════════════
 * 動作清單
 * ═════════════════════════════════════════════════════════════════════
 *
 * 每一個動作寫明：
 *   `id`　　　　報告上面點叫佢
 *   `legal`　　喺呢個狀態下合唔合法（**純判斷，唔准改嘢**）
 *   `run`　　　真正執行（一律經真實入口）
 *   `expect`　 撳完之後**應該點**（第五十二輪批次 C 組）
 *
 * ⚠️ `expect` 係呢一輪加嘅。冇佢之前，`run()` 嘅回傳值只係
 * `JSON.stringify` 落 `MonkeyLog` 就算數——冇人睇。
 * 於是一個「`legal` 話做得、真係叫咗、而系統靜靜噉乜都冇做」嘅動作，
 * 亂行機會照樣行落去，一路行到 50 步，然後報一份綠色報告。
 *
 * 現場（第五十一輪批次 C1）：`apiGenerateDraftExecute()` 喺已經有版本嘅
 * 季度上面回 `{ok: false, versionCreated: false}`——**佢唔拋錯**。
 * 自測機 S14 當時就係噉行過咗頭，攞住舊嘅 v0 去驗，
 * 報咗一句完全誤導嘅結論。
 *
 * ⚠️ **一個真實入口靜靜地冇做事，而測試照樣往下走**
 * ——呢個係呢個專案由第一輪殺到而家嗰種病。
 *
 * ⚠️ `legal` 唔係「掣亮唔亮」——係「呢個動作而家做唔做得到」。
 * 兩者理應一致，而**唔一致本身就係一個發現**：
 * 一個 `legal` 講得通而執行起上嚟拋錯嘅動作，
 * 就係「畫面話得，而系統話唔得」。所以拋錯會被記低，唔會被吞。
 */
function monkeyActions_() {
  return [
    {
      id: '生成初稿',
      legal: function (facts) { return !facts.hasVersion; },
      run: function (quarterId) { return apiGenerateDraftExecute(quarterId); },
      // ⚠️ 呢一支喺已經有版本嗰陣回 `{ok: false, versionCreated: false}`，
      // **唔拋錯**。`legal` 已經查過冇版本，所以喺呢度收到拒絕
      // 就係「畫面話得，而系統話唔得」。
      expect: function (result, before, after) {
        if (result && result.versionCreated === false) {
          return '回傳 `versionCreated: false`——叫了，但沒有造出版本。'
            + '回傳訊息：' + String((result || {}).message || '（沒有）');
        }
        if (!(after.latestVersionNo > before.latestVersionNo)) {
          return '版本號沒有增加（之前 ' + before.latestVersionNo
            + '，之後 ' + after.latestVersionNo + '）。';
        }
        return '';
      }
    },
    {
      id: '改 grid 幾格',
      legal: function (facts) { return facts.hasVersion; },
      run: function (quarterId, rnd) {
        const versionNo = findLatestVersionNo(quarterId);
        const howMany = 1 + Math.floor(rnd() * 5);
        const cells = selfTestPickCells_(quarterId, versionNo, howMany);
        let written = 0;
        cells.forEach(function (c, i) {
          if (selfTestWriteGridCell_(quarterId, versionNo, c.serviceDate,
            c.postId, c.slotIndex, '亂行' + (i + 1))) written++;
        });
        return { changedCells: written };
      },
      // ⚠️ 一格都寫唔到 ⇒ 呢一步實際上乜都冇做，而下一步會當佢做過。
      expect: function (result) {
        return result.changedCells > 0 ? ''
          : '一格都沒有寫到——這一步實際上什麼都沒有做，'
            + '但後面每一步都當它做過了。';
      }
    },
    {
      id: '儲存並確認',
      legal: function (facts) { return facts.hasVersion && facts.gridChangeCount > 0; },
      run: function (quarterId) {
        return apiSaveAndConfirmExecute(quarterId, { decisions: [] });
      },
      // `legal` 已經查過「有未儲存改動」。儲存完仲有未儲存改動 ⇒ 有嘢冇入到。
      expect: function (result, before, after) {
        return after.gridChangeCount === 0 ? ''
          : '儲存完之後仍然有 ' + after.gridChangeCount + ' 格未儲存'
            + '（之前 ' + before.gridChangeCount + ' 格）。';
      }
    },
    {
      id: '寄給堂委審閱（模擬）',
      legal: function (facts) {
        return !!(facts.buttons.review && facts.buttons.review.enabled);
      },
      run: function (quarterId) { return apiStep2Confirm(quarterId, null); },
      // `legal` 睇嘅係「掣着咗」。撳咗之後 Stage 冇郁過 ⇒
      // 掣話得，而系統實際上乜都冇推進。
      expect: function (result, before, after) {
        return after.stage !== before.stage ? ''
          : '撳了之後 Stage 沒有動過（仍然是 ' + before.stage + '）。';
      }
    },
    {
      id: '正式發出給全體（模擬）',
      legal: function (facts) {
        return !!(facts.buttons.official && facts.buttons.official.enabled);
      },
      run: function (quarterId) { return apiStep4Confirm(quarterId, null); },
      // ⚠️ `advanced: false` 係一個**特登**嘅結果（有人未收到，
      // Stage 特登唔前進，補救之後可以再行一次）——嗰個唔算靜默。
      // 靜默嘅係「`advanced` 冇講唔前進，而 Stage 又真係冇郁」。
      expect: function (result, before, after) {
        if (result && result.advanced === false) return '';
        return after.stage !== before.stage ? ''
          : '撳了之後 Stage 沒有動過（仍然是 ' + before.stage + '），'
            + '而回傳值也沒有說明為什麼不前進。';
      }
    },
    {
      id: '改動後重發（只算，不寄）',
      legal: function (facts) {
        return !!(facts.buttons.resend && facts.buttons.resend.enabled);
      },
      // ⚠️ 只叫 `apiStep5Plan()`——佢係純算。
      // 亂行機唔應該喺一條隨機路徑上面走完整條寄送流程：
      // 走一次要幾分鐘，而一次亂行要行 50 步。
      run: function (quarterId) { return apiStep5Plan(quarterId, null); },
      // ⚠️ 佢自稱「純算」。一個純算嘅入口改咗嘢，就係一個真發現。
      expect: function (result, before, after) { return monkeyExpectNoChange_(before, after); }
    },
    {
      id: '回到上一個儲存版本',
      legal: function (facts) { return facts.latestVersionNo > 0; },
      run: function (quarterId) {
        const target = findLatestVersionNo(quarterId) - 1;
        return apiRollbackPlan(quarterId, target);
      },
      // `apiRollbackPlan()` 只係算，唔會真回退。同上：純算就唔准改嘢。
      expect: function (result, before, after) { return monkeyExpectNoChange_(before, after); }
    },
    {
      id: '看一次主畫面',
      // ⚠️ 一個純讀嘅動作。冇佢嘅話，亂行機每一步都會改嘢，
      // 而「連續讀兩次會唔會唔同」呢一類問題就永遠試唔到。
      legal: function () { return true; },
      run: function (quarterId) {
        const a = apiGetDashboardState(quarterId);
        const b = apiGetDashboardState(quarterId);
        return {
          same: JSON.stringify(a.unsaved) === JSON.stringify(b.unsaved),
          unsaved: a.unsaved
        };
      },
      // ⚠️ `same` 本來算咗出嚟，但**冇人睇**——JSON 落 `MonkeyLog` 就算數。
      // 呢個動作存在嘅唯一理由就係問「連續讀兩次會唔會唔同」，
      // 而佢問完之後冇睇答案。同 C 組要修嗰件事一模一樣。
      expect: function (result, before, after) {
        if (result && result.same === false) {
          return '連續讀兩次主畫面，「未儲存」的內容不一樣'
            + '——中間沒有做過任何事。';
        }
        return monkeyExpectNoChange_(before, after);
      }
    },
    {
      id: '看一次寄出彈窗',
      legal: function () { return true; },
      run: function (quarterId) { return apiGetSendPlanSummary(quarterId); },
      // 純讀。讀一次彈窗改咗季度嘅狀態，就係一個真發現。
      expect: function (result, before, after) { return monkeyExpectNoChange_(before, after); }
    }
  ];
}

/**
 * 「呢一步唔應該改到任何嘢」——畀純算／純讀嗰幾個動作用。
 *
 * @param {Object} before 撳之前的 facts
 * @param {Object} after 撳之後的 facts
 * @returns {string} 空字串 ＝ 冇改過；否則一句解釋
 */
function monkeyExpectNoChange_(before, after) {
  const moved = [];
  if (before.stage !== after.stage) {
    moved.push('Stage 由 ' + before.stage + ' 變成 ' + after.stage);
  }
  if (before.latestVersionNo !== after.latestVersionNo) {
    moved.push('版本號由 ' + before.latestVersionNo + ' 變成 ' + after.latestVersionNo);
  }
  if (before.gridChangeCount !== after.gridChangeCount) {
    moved.push('未儲存格數由 ' + before.gridChangeCount
      + ' 變成 ' + after.gridChangeCount);
  }
  return moved.length === 0 ? ''
    : '這一個動作說明自己只是計算／只是讀，但它改了東西：' + moved.join('；') + '。';
}

/**
 * 第五十二輪批次 C 組：**撳完之後真係要睇一眼回傳值同狀態。**
 *
 * ⚠️ 之前 `run()` 嘅回傳值只係 `JSON.stringify` 落 `MonkeyLog`，冇人睇。
 * 一個唔拋錯、但係靜靜噉乜都冇做嘅入口，亂行機會照樣行落去。
 *
 * 兩層：
 *   1. **共通規則**——`legal` 話做得，而回傳 `ok: false` ⇒ 系統拒絕咗
 *   2. **逐個動作嘅 `expect`**——狀態有冇真係郁過
 *
 * @param {Object} picked 揀中咗的動作
 * @param {Object} result `run()` 的回傳值
 * @param {Object} before 撳之前的 facts
 * @param {Object} after 撳之後的 facts；讀唔到就是 null
 * @returns {Array<string>} 每一句是一個問題；空陣列 ＝ 冇問題
 */
function monkeyCheckOutcome_(picked, result, before, after) {
  const complaints = [];
  // ── 1. 共通規則 ──────────────────────────────────────────────
  //
  // ⚠️ `legal()` 已經話咗呢個狀態下做得。系統喺呢度回一個拒絕，
  // 就係「畫面話得，而系統話唔得」——同一個合法動作拋錯同一級。
  if (result && result.ok === false) {
    complaints.push('`legal()` 說這一步做得到，而系統拒絕了：'
      + String(result.message || '（回傳值沒有說明原因）'));
  }
  if (!after) return complaints;

  // ── 2. 逐個動作 ──────────────────────────────────────────────
  if (typeof picked.expect === 'function') {
    try {
      const complaint = picked.expect(result, before, after);
      if (complaint) complaints.push(complaint);
    } catch (err) {
      // ⚠️ 查證本身爆咗 ⇒ **要報**。靜靜噉當佢過就係呢一組要修嗰件事。
      complaints.push('查不到這一步做過什麼：' + err.message);
    }
  }
  return complaints;
}

/**
 * 讀當前狀態，畀 `legal()` 用。**純讀取。**
 *
 * @param {string} quarterId 季度 ID
 * @returns {Object} facts
 */
function monkeyReadFacts_(quarterId) {
  const state = buildDashboardState_(quarterId);
  const versionNo = findLatestVersionNo(quarterId);
  return {
    hasVersion: versionNo >= 0,
    latestVersionNo: versionNo,
    stage: state.stage,
    gridChangeCount: (state.unsaved || {}).gridChangeCount || 0,
    buttons: state.buttons || {}
  };
}

/* ═════════════════════════════════════════════════════════════════════
 * 主迴圈
 * ═════════════════════════════════════════════════════════════════════ */

/** 呢一次執行嘅開始時間。 */
let monkeyStartedAt_ = 0;

/**
 * 跑亂行機。
 *
 * @param {number} steps 要跑幾多步
 * @param {number} seed 隨機種子
 * @returns {Object} 報告
 */
function runMonkey_(steps, seed, skipDraws) {
  monkeyStartedAt_ = new Date().getTime();

  const quarter = readSelfTestQuarterDetail_();
  const quarterId = quarter.value;

  // ⚠️ 開跑之前行同一套閘。亂行機比自測機更危險——
  // 佢會用一條**冇人預先睇過**嘅次序去撳嘢。
  const gate = checkSelfTestPreconditions_(quarterId);
  if (!gate.ok) {
    return { blocked: true, quarterId: quarterId, reasons: gate.reasons,
      seed: seed, steps: [], failures: [] };
  }

  const rnd = makeMonkeyRandom_(seed, skipDraws);
  const actions = monkeyActions_();
  const path = [];
  const stepLog = [];
  const failures = [];
  let stoppedForTime = false;
  const total = Math.max(1, Math.min(MONKEY_MAX_STEPS, Number(steps) || 50));

  for (let i = 1; i <= total; i++) {
    if (selfTestOutOfTime_ && (new Date().getTime() - monkeyStartedAt_) > MONKEY_TIME_BUDGET_MS) {
      stoppedForTime = true;
      break;
    }

    // ⚠️ 每 10 步重新斷言一次 `DRY_RUN`。
    // 開跑嗰陣驗一次係唔夠嘅——一次亂行可以行幾分鐘，
    // 而中間有人（或者另一支程式）改咗 Config，後面嗰幾十步就會真係寄信。
    if (i % MONKEY_DRY_RUN_RECHECK_EVERY === 1 && i > 1) {
      if (getConfig(CONFIG_KEYS.DRY_RUN, true) !== true) {
        failures.push({
          step: i, kind: 'DRY_RUN',
          detail: '第 ' + i + ' 步之前重新檢查，DRY_RUN 已經不是 TRUE。已立刻停手。',
          path: path.slice()
        });
        break;
      }
    }

    let facts;
    try {
      facts = monkeyReadFacts_(quarterId);
    } catch (err) {
      failures.push({ step: i, kind: '讀不到狀態', detail: err.message, path: path.slice() });
      break;
    }

    const legal = actions.filter(function (a) {
      try { return a.legal(facts); } catch (err) { return false; }
    });
    if (legal.length === 0) {
      stepLog.push({ step: i, action: '（沒有合法動作）', outcome: '停手', invariant: '' });
      break;
    }

    const picked = legal[Math.floor(rnd() * legal.length)];
    let outcome = '';
    let threw = '';
    try {
      const result = picked.run(quarterId, rnd);
      outcome = JSON.stringify(result).slice(0, 300);

      // ── 第五十二輪批次 C 組：**睇返個回傳值。** ────────────────
      //
      // ⚠️ 之前呢一行下面就直接落去跑不變量。回傳值淨係
      // `JSON.stringify` 落 `MonkeyLog`——冇人睇。
      // 一個唔拋錯、但係靜靜噉乜都冇做嘅入口，會一路行到 50 步，
      // 然後交一份綠色報告。
      let after = null;
      try {
        after = monkeyReadFacts_(quarterId);
      } catch (err) {
        failures.push({ step: i, kind: '撳完讀不到狀態',
          detail: picked.id + '　' + err.message,
          path: path.slice().concat([picked.id]) });
      }
      monkeyCheckOutcome_(picked, result, facts, after).forEach(function (complaint) {
        failures.push({
          step: i, kind: '合法動作靜靜地沒有做事',
          detail: picked.id + '　' + complaint,
          path: path.slice().concat([picked.id])
        });
      });
    } catch (err) {
      // ⚠️ 拋錯**唔會**被吞。一個 `legal` 講得通而執行起上嚟拋錯嘅動作，
      // 就係「畫面話得，而系統話唔得」——嗰個本身就係一個發現。
      threw = err.message;
      outcome = '拋錯：' + err.message;
      failures.push({
        step: i, kind: '合法動作拋錯',
        detail: picked.id + '　' + err.message,
        path: path.slice().concat([picked.id])
      });
    }
    path.push(picked.id);

    // ── 每一步跑一次全部不變量 ──────────────────────────────────
    let invariantText = '';
    try {
      const inv = runAllInvariants_(quarterId);
      const broken = inv.results.filter(function (r) {
        return r.status === INVARIANT_STATUS.FAILED || r.status === INVARIANT_STATUS.ERROR;
      });
      invariantText = broken.length === 0 ? 'OK'
        : broken.map(function (r) { return r.id; }).join('、');
      broken.forEach(function (r) {
        failures.push({
          step: i, kind: '不變量 ' + r.id,
          detail: r.label + '｜預期 ' + r.expected + '｜實際 ' + r.actual + '｜' + r.evidence,
          path: path.slice()
        });
      });
    } catch (err) {
      invariantText = '算不出：' + err.message;
      failures.push({ step: i, kind: '不變量算不出', detail: err.message, path: path.slice() });
    }

    stepLog.push({
      step: i, action: picked.id, outcome: outcome,
      invariant: invariantText, threw: threw
    });
  }

  return {
    blocked: false,
    quarterId: quarterId,
    seed: seed,
    requestedSteps: total,
    ranSteps: stepLog.length,
    stoppedForTime: stoppedForTime,
    steps: stepLog,
    failures: failures,
    path: path,
    // 續跑要用：下一次由第幾抽開始。
    drawnCount: rnd.drawnCount()
  };
}

/**
 * 把亂行報告寫成人睇嘅行。
 *
 * ⚠️ 每一個失敗都要印**走到這裡的完整步驟**。
 * 冇咗佢，紅咗都重現唔到——而一個重現唔到嘅 bug 報告，
 * 對兩個月之後嘅自己嚟講等於冇。
 *
 * @param {Object} report `runMonkey_()` 的結果
 * @returns {string[]} 逐行
 */
function describeMonkeyReport_(report) {
  if (report.blocked) {
    return ['亂行機沒有執行。', ''].concat(
      report.reasons.map(function (r) { return '・' + r; }));
  }
  const lines = [
    '亂行機：跑了 ' + report.ranSteps + ' / ' + report.requestedSteps + ' 步，'
      + report.failures.length + ' 項失敗',
    '沙盒季度：' + report.quarterId,
    // ⚠️ seed 一定要印。同一個 seed 重跑一定同一條路。
    '隨機種子：' + report.seed + '（用同一個種子重跑，會走同一條路）',
    ''
  ];

  if (report.failures.length === 0) {
    lines.push('沒有一步令不變量失敗。');
  }
  report.failures.forEach(function (f) {
    lines.push('🔴 第 ' + f.step + ' 步　' + f.kind);
    lines.push('　 ' + f.detail);
    lines.push('　 走到這裡的完整步驟：' + (f.path.join(' → ') || '（第一步）'));
    lines.push('');
  });

  if (report.stoppedForTime) {
    lines.push('⚠️ 執行時間到，已經乾淨停低（跑了 ' + report.ranSteps + ' 步）。');
    lines.push('　 撳「測試工具 ▸ ▶️ 繼續亂行」再跑一批。');
    lines.push('');
  }
  lines.push('逐步紀錄已經寫進「' + MONKEY_SHEETS.LOG + '」工作表。');
  return lines;
}

/**
 * 把逐步紀錄寫入工作表。
 * @param {Object} report `runMonkey_()` 的結果
 * @returns {void}
 */
function writeMonkeyLog_(report) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(MONKEY_SHEETS.LOG);
  if (!sheet) sheet = ss.insertSheet(MONKEY_SHEETS.LOG);
  sheet.clear();
  sheet.appendRow(['種子', report.seed, '季度', report.quarterId]);
  sheet.appendRow(['第幾步', '選了什麼', '結果', '不變量']);
  sheet.setFrozenRows(2);
  (report.steps || []).forEach(function (s) {
    sheet.appendRow([s.step, s.action, s.outcome, s.invariant]);
  });
}

/**
 * 記低「上一次亂行用邊個種子、抽咗幾多次」。
 *
 * ⚠️ 冇咗抽數，「繼續亂行」就會由同一個 seed 嘅第一抽再嚟一次——
 * 即係行返上一次同一條路，而報告寫住「繼續」。
 *
 * @param {Object} report `runMonkey_()` 的結果
 * @returns {void}
 */
function writeMonkeyState_(report) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(MONKEY_SHEETS.STATE);
  if (!sheet) sheet = ss.insertSheet(MONKEY_SHEETS.STATE);
  sheet.clear();
  sheet.appendRow(['種子', '已抽次數', '已跑步數', '季度']);
  sheet.setFrozenRows(1);
  sheet.appendRow([report.seed, report.drawnCount, report.ranSteps, report.quarterId]);
}

/**
 * 讀返上一次亂行嘅種子同抽數。
 * @returns {{seed: number, drawnCount: number}} 冇紀錄就回 `{seed: 0, drawnCount: 0}`
 */
function readMonkeyState_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(MONKEY_SHEETS.STATE);
  if (!sheet || sheet.getLastRow() < 2) return { seed: 0, drawnCount: 0 };
  const row = sheet.getRange(2, 1, 1, 2).getValues()[0];
  return { seed: Number(row[0]) || 0, drawnCount: Number(row[1]) || 0 };
}

/**
 * 選單「測試工具 ▸ ▶️ 繼續亂行」。
 *
 * ⚠️ 用返上一次嘅種子，而且**快轉過上一次抽咗嘅次數**——
 * 所以佢真係接住上一條路，唔係由頭再行一次。
 *
 * @returns {void}
 */
function runMonkeyResumeFromMenu_() {
  const ui = SpreadsheetApp.getUi();
  const title = '▶️ 繼續亂行';
  const state = readMonkeyState_();
  if (!state.seed) {
    ui.alert(title,
      '找不到上一次亂行的紀錄（' + MONKEY_SHEETS.STATE + '工作表）。\n\n'
        + '請先撳「⚠️ 亂行機（沙盒季度，DRY_RUN）」跑第一批。',
      ui.ButtonSet.OK);
    return;
  }
  const response = ui.prompt(title,
    '上一次的種子：' + state.seed + '，已經抽了 ' + state.drawnCount + ' 次。\n\n'
      + '這一次會用同一個種子接住上一條路走下去。\n\n'
      + '要再跑幾多步？（留空 ＝ 50）',
    ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  const steps = Number(normalizeIdInput_(response.getResponseText())) || 50;

  SpreadsheetApp.getActiveSpreadsheet().toast('亂行中，請稍候…', '亂行機', 300);
  let report;
  try {
    report = runMonkey_(steps, state.seed, state.drawnCount);
  } catch (err) {
    log_('ERROR', 'runMonkey_（續跑）失敗：' + err.message);
    ui.alert(title, '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }
  if (!report.blocked) {
    try {
      writeMonkeyLog_(report);
      writeMonkeyState_(report);
    } catch (err) { log_('WARN', '寫亂行紀錄失敗：' + err.message); }
  }
  ui.alert(title, describeMonkeyReport_(report).join('\n'), ui.ButtonSet.OK);
}

/**
 * 選單「測試工具 ▸ ⚠️ 亂行機（沙盒季度，DRY_RUN）」。
 * @returns {void}
 */
function runMonkeyFromMenu_() {
  const ui = SpreadsheetApp.getUi();
  const title = '⚠️ 亂行機（沙盒季度，DRY_RUN）';
  const quarter = readSelfTestQuarterDetail_();

  const stepsResponse = ui.prompt(title,
    '沙盒季度：' + quarter.value + '\n\n'
      + '這個工具會由沙盒季度的現在狀態出發，看看有哪幾個動作是合法的，'
      + '隨機選一個執行，然後跑一次全部不變量。重覆 N 次。\n\n'
      + '全程 DRY_RUN，不會寄出任何真實電郵。\n'
      + '不會安裝 trigger、不會碰其他季度、不會改 Config、不會改人員資料。\n\n'
      + '要跑幾多步？（留空 ＝ 50）',
    ui.ButtonSet.OK_CANCEL);
  if (stepsResponse.getSelectedButton() !== ui.Button.OK) return;
  const steps = Number(normalizeIdInput_(stepsResponse.getResponseText())) || 50;

  // ⚠️ seed 由幹事決定，預設用當日日期——同一日重跑會走同一條路，
  // 而想換一條路就自己改一個數字。
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const defaultSeed = Number(Utilities.formatDate(new Date(), timezone, 'yyyyMMdd'));
  const seedResponse = ui.prompt(title,
    '隨機種子？（留空 ＝ ' + defaultSeed + '）\n\n'
      + '同一個種子重跑，一定走同一條路——所以紅了之後，'
      + '用報告開頭那一個種子就可以原原本本重現一次。',
    ui.ButtonSet.OK_CANCEL);
  if (seedResponse.getSelectedButton() !== ui.Button.OK) return;
  const seed = Number(normalizeIdInput_(seedResponse.getResponseText())) || defaultSeed;

  SpreadsheetApp.getActiveSpreadsheet().toast('亂行中，請稍候…', '亂行機', 300);

  let report;
  try {
    report = runMonkey_(steps, seed);
  } catch (err) {
    log_('ERROR', 'runMonkey_ 失敗：' + err.message);
    ui.alert(title, '執行失敗：\n\n' + err.message, ui.ButtonSet.OK);
    return;
  }

  if (!report.blocked) {
    try {
      writeMonkeyLog_(report);
      writeMonkeyState_(report);
    } catch (err) {
      log_('WARN', '寫亂行紀錄失敗：' + err.message);
    }
  }
  ui.alert(title, describeMonkeyReport_(report).join('\n'), ui.ButtonSet.OK);
}

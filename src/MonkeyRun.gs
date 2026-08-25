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
/** 亂行機錄回傳值嗰陣用嘅「情境 ID」。 */
const MONKEY_SCENARIO_ID = 'MONKEY';

/** 一般動作嘅權重。 */
const MONKEY_DEFAULT_WEIGHT = 10;

/**
 * 「順手探一探」嗰類動作嘅權重。
 *
 * ⚠️ 要**明顯細過** `MONKEY_DEFAULT_WEIGHT`。呢類動作嘅價值喺於
 * 「偶然撞到」，唔係「經常做」——而經常做會蓋過其餘動作嘅覆蓋率。
 */
const MONKEY_RARE_WEIGHT = 2;

/** 寫落去試「系統認唔認得出」嗰串字。 */
const MONKEY_UNRESOLVED_TEXT = '一個系統認不出的名字';

/**
 * 連續幾多步「同一個動作 ＋ 狀態完全冇變」先當佢原地打轉。
 *
 * ⚠️ 見 `runMonkey_()` 入面嗰段。
 */
const MONKEY_SPIN_LIMIT = 5;

/**
 * 第六十一輪批次 B 組：每幾多步跑一次**全套**不變量。
 *
 * ⚠️ 背景：亂行機每一步都跑 `runAllInvariants_(quarterId)`——冇傳 set
 * 即係 `ALL`，入面包住 I04（`RosterAssignments` 成萬行）同 I08
 * （每一條要行一次完整 plan）。一步跑一次，行 50 步就跑 50 次。
 *
 * ⚠️ **唔可以因為慳時間就唔跑全套。** 只係唔使每步都跑：
 *   ・每一步　　　跑快嗰批（I01／I05／I09／I10）
 *   ・每 10 步　　跑全套一次
 *   ・收尾　　　　如果最後一步唔係全套嗰一步，補跑一次
 *
 * 「收尾補跑」唔可以省。迴圈會因為時間到、原地打轉、冇合法動作
 * 而中途 break——省咗嘅話，最尾嗰段改動就冇任何一次全套驗過。
 */
const MONKEY_FULL_INVARIANT_EVERY = 10;

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
      // ═══════════════════════════════════════════════════════════════
      // ⚠️⚠️ 第六十輪批次 A1 組：**亂行機喺沙盒度原地打轉。**
      // ═══════════════════════════════════════════════════════════════
      //
      // 舊寫法寫嘅係 `'亂行' + (i + 1)`——「亂行1」「亂行2」，
      // 一個系統一定認唔出嘅字。實測 grid 上面見到
      // `07-02 主席=亂行1、報告=亂行2`。
      //
      // `unresolvedCount > 0` 之後，系統嘅規矩係
      // **「有認唔出嘅名就乜都唔准做」**：
      //   ・儲存並確認　整批拒絕
      //   ・寄出　　　　封鎖
      //   ・套用申報　　行唔到
      //
      // ⇒ 每一步只剩「改 grid」合法 ⇒ 亂行機一直寫更多「亂行N」
      // ⇒ 永遠出唔到個坑。2028T3 嘅 Stage 停喺 OFFICIAL_SENT
      //   一路冇變過，證明零動作成功過。
      //
      // ⚠️⚠️ 呢個同第五十四輪 S03 嗰個 bug **完全同一種病**。
      // 當時嘅解法係「唔猜規則，寫入之後叫唯讀嘅
      // `apiSaveAndConfirmPlan()` 問系統」——但嗰個修正只套咗喺
      // `selfTestPickCells_()` 嘅呼叫端，冇套到亂行機。
      //
      // ⚠️ 所以呢度**直接重用 S03 嗰一支**，唔另寫一份。
      // 兩份邏輯必定分岔——而分岔之後，下一次撞規則嗰陣
      // 冇人分得出邊一份答錯。
      run: function (quarterId, rnd) {
        const versionNo = findLatestVersionNo(quarterId);
        const howMany = 1 + Math.floor(rnd() * 3);
        const picked = selfTestPickAcceptedCells_(
          quarterId, versionNo, howMany, MONKEY_SCENARIO_ID);
        return {
          changedCells: picked.cells.length,
          wanted: howMany,
          planCalls: picked.planCalls,
          planError: picked.planError || '',
          preExisting: picked.preExisting || [],
          noCandidate: picked.noCandidate || '',
          cells: picked.cells.map(function (c) {
            return c.serviceDate + ' ' + c.postId + '#' + c.slotIndex
              + ' ← ' + c.replacement.name;
          })
        };
      },
      expect: function (result, before, after) {
        // ⚠️ **呢一條先係防止今輪個 bug 翻生嗰一條。**
        // 寫入之後仲有認唔出嘅名 ⇒ 系統會整批擋住，
        // 而亂行機就會困喺「只剩改 grid 合法」嗰個坑入面。
        if (Number(after.unresolvedCount || 0) > 0) {
          return '寫完之後仍然有 ' + after.unresolvedCount + ' 格認不出——'
            + '系統的規矩是「有認不出的名字就什麼都不准做」，'
            + '接下來每一步都會被擋，亂行機會困在原地。';
        }
        if (result.planError) {
          return '選格的時候：' + result.planError;
        }
        if ((result.preExisting || []).length > 0) {
          return '這一版本身就帶著 ' + result.preExisting.length
            + ' 格硬規則違反，不是這一次改動造成的：'
            + result.preExisting.join('；');
        }
        // ⚠️ 一格都寫唔到 ⇒ 呢一步實際上乜都冇做，而下一步會當佢做過。
        return result.changedCells > 0 ? ''
          : '一格都沒有寫到——這一步實際上什麼都沒有做，'
            + '但後面每一步都當它做過了。'
            + (result.noCandidate ? '　' + result.noCandidate : '');
      }
    },
    {
      // ═══════════════════════════════════════════════════════════════
      // 第六十輪批次 A2 組：**「認唔出嘅名」仍然要驗，但唔可以鎖死部機。**
      // ═══════════════════════════════════════════════════════════════
      //
      // ⚠️ 呢一個動作**自己收拾**：寫入 → 問系統 → 即刻改返原值。
      // 全部喺同一步之內做完，所以：
      //   ・唔會留低一格認唔出嘅名去鎖死下一步
      //   ・個斷言唔使靠「下一步啱啱揀中儲存」先跑得到
      //
      // ⚠️ 權重低（見 `MONKEY_RARE_WEIGHT`）。S16 已經有一條完整嘅
      // 情境專門驗呢件事，呢度只係一個順手嘅探針。
      id: '寫一格認不出的名字（即刻改回）',
      weight: MONKEY_RARE_WEIGHT,
      legal: function (facts) { return facts.hasVersion; },
      run: function (quarterId, rnd) {
        const versionNo = findLatestVersionNo(quarterId);
        const cells = selfTestPickCells_(quarterId, versionNo, 1);
        if (cells.length === 0) return { skipped: '找不到一格有人的來改' };
        const cell = cells[0];
        const peopleById = indexPeopleById_();
        const originalName = (peopleById[cell.personId] || {}).nameTC || '';
        if (!originalName) return { skipped: '拿不到那一格原本的人名，不動它' };

        const wrote = selfTestWriteGridCell_(quarterId, versionNo, cell.serviceDate,
          cell.postId, cell.slotIndex, MONKEY_UNRESOLVED_TEXT);
        let blockReason = '';
        let blockMessage = '';
        try {
          const plan = apiSaveAndConfirmPlan(quarterId);
          blockReason = plan.blocked ? String(plan.blockReason || '') : '';
          blockMessage = String(plan.message || '').slice(0, 200);
        } catch (err) {
          blockReason = '（拋錯）' + err.message;
        }
        // ⚠️ **無論上面點，都要改返原值。** 唔收拾就等於種一個坑。
        const reverted = selfTestWriteGridCell_(quarterId, versionNo, cell.serviceDate,
          cell.postId, cell.slotIndex, originalName);
        return {
          wrote: wrote, reverted: reverted, blockReason: blockReason,
          blockMessage: blockMessage,
          cell: cell.serviceDate + ' ' + cell.postId + '#' + cell.slotIndex,
          originalName: originalName
        };
      },
      expect: function (result, before, after) {
        if (result.skipped) return '';
        if (!result.wrote) return '那一格寫不進去，這一步什麼都沒有驗到。';
        // ⚠️ **儲存必定被拒絕。** 唔拒絕嘅話，一個認唔出嘅名
        // 就會靜靜噉入咗版本——而嗰個係系統最嚴厲嗰一道閘。
        if (result.blockReason !== 'UNRESOLVED_NAMES') {
          return '寫了一個系統認不出的名字，而「儲存並確認」竟然沒有'
            + '因為 UNRESOLVED_NAMES 而擋住（blockReason='
            + (result.blockReason || '（沒有擋）') + '）。';
        }
        if (!result.reverted) return '驗完之後改不回原值，留下了一格認不出的名字。';
        // 收拾乾淨 ⇒ 狀態要同做之前一模一樣。
        return monkeyExpectNoChange_(before, after);
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
      // ═══════════════════════════════════════════════════════════════
      // 第六十一輪批次 C 組：**呢個係亂行機入面最慢嗰一個動作。**
      // ═══════════════════════════════════════════════════════════════
      //
      // `apiStep4Confirm()` → `executeStep4Send_()` 要逐個收件人
      // （全體 ≈ 58 位）行一次：解析收件人、砌信、查嗰個人嘅個人 PDF。
      // 就算 `DRY_RUN` 唔真寄，上面嗰幾樣一樣要做足。
      //
      // ⚠️ 佢**唔會**產生個人 PDF——佢係讀返「準備工作 ▸ 產生個人 PDF」
      // 已經整好嗰啲；查唔到就記 `errorPdfMissing`。產生嗰一支係
      // `generatePersonalPdfBatch_()`（`PdfBatch.gs`），
      // 而亂行機由頭到尾冇一個動作叫得到佢。
      //
      // ⚠️ 跳過佢**唔等於**呢條路冇驗過：自測機 S08（產生個人 PDF）
      // ＋ S09（正式發出，DRY_RUN）行嘅就係同一條路，而且係
      // 由頭到尾一整條，比亂行機隨機撞到嗰一下完整。
      //
      // ⚠️ 但跳過佢有一個**連帶後果**，報告要講明：Stage 上唔到
      // `OFFICIAL_SENT`，所以「改動後重發（只算，不寄）」亦都
      // 永遠合法唔到。呢個唔係 bug，係開關嘅代價。
      slow: '要逐個收件人（≈58 位）砌信同查個人 PDF；'
        + '自測機 S08 ＋ S09 已完整驗過同一條路',
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
  // 第六十輪批次：收拾乾淨嘅話，認唔出嘅格數都要打返和。
  if (Number(before.unresolvedCount || 0) !== Number(after.unresolvedCount || 0)) {
    moved.push('認不出的格數由 ' + Number(before.unresolvedCount || 0)
      + ' 變成 ' + Number(after.unresolvedCount || 0));
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
 * 由合法動作入面揀一個，**按權重**。
 *
 * ⚠️ 冇寫 `weight` 嘅動作用 `MONKEY_DEFAULT_WEIGHT`。
 * 噉樣加新動作嘅人唔使諗權重，而「順手探一探」嗰類要明確寫低。
 *
 * ⚠️ 用整數權重同一次 `rnd()`——用浮點數或者抽兩次嘅話，
 * 同一個 seed 就唔會行同一條路，而「同一個 seed 行同一條路」
 * 係亂行機可以續跑、可以重現嘅根本。
 *
 * @param {Object[]} legal 合法動作
 * @param {Function} rnd 亂數
 * @returns {Object} 揀中嗰個動作
 */
function monkeyPickWeighted_(legal, rnd) {
  let total = 0;
  legal.forEach(function (a) {
    total += Math.max(1, Number(a.weight) || MONKEY_DEFAULT_WEIGHT);
  });
  let hit = Math.floor(rnd() * total);
  for (let i = 0; i < legal.length; i++) {
    hit -= Math.max(1, Number(legal[i].weight) || MONKEY_DEFAULT_WEIGHT);
    if (hit < 0) return legal[i];
  }
  return legal[legal.length - 1];
}

/**
 * 第六十一輪批次 C 組：亂行機跳唔跳過慢動作。
 *
 * ⚠️ 讀 Config，唔係寫死。見 `CONFIG_KEYS.MONKEY_SKIP_SLOW_ACTIONS`。
 *
 * @returns {boolean} `true` ＝ 跳過
 */
function monkeySkipSlowActions_() {
  return getConfig(CONFIG_KEYS.MONKEY_SKIP_SLOW_ACTIONS, true) === true;
}

/**
 * 系統狀態嘅指紋——防打轉閘用。
 *
 * ⚠️ 三樣嘢：Stage、最新版本號、認唔出嘅格數。
 * 呢三樣都冇郁過，就代表嗰一步實際上乜都冇推進。
 *
 * ⚠️ **唔包 `gridChangeCount`。** 包咗嘅話，一部一路寫更多
 * 「亂行N」嘅機器每一步個數都會加一，於是指紋每步都唔同，
 * 而防打轉閘就永遠唔會 fire——即係今輪個 bug 原封不動。
 *
 * @param {Object} facts `monkeyReadFacts_()` 嘅結果
 * @returns {string}
 */
function monkeyStateFingerprint_(facts) {
  if (!facts) return '（讀不到）';
  return [facts.stage, facts.latestVersionNo,
    Number(facts.unresolvedCount || 0)].join('|');
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
    // 第六十輪批次：防打轉閘同「改 grid」嗰個 expect 都要用。
    unresolvedCount: (state.unsaved || {}).unresolvedCount || 0,
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

  // ── 第六十一輪批次 C 組：慢動作 ────────────────────────────────
  //
  // ⚠️ 篩走咗邊幾個，一定要帶落報告。一份「跑咗 50 步、零失敗」
  // 而冇講跳過乜嘅報告，會令人以為嗰條路驗過。
  const allActions = monkeyActions_();
  const skipSlow = monkeySkipSlowActions_();
  const skippedSlow = allActions.filter(function (a) { return !!a.slow; })
    .map(function (a) { return { id: a.id, why: String(a.slow) }; });
  const actions = skipSlow
    ? allActions.filter(function (a) { return !a.slow; })
    : allActions;

  const path = [];
  const stepLog = [];
  const failures = [];
  let stoppedForTime = false;
  // 第六十一輪批次 A 組：冇一個動作合法嗰陣，要講得出停喺邊。
  let noLegalAction = null;
  // 第六十一輪批次 B 組：全套不變量跑咗幾多次、最後一次係第幾步。
  let fullSweepCount = 0;
  let lastFullSweepStep = 0;
  // ⚠️ 由**真正跑過嗰一批**攞返 id，唔喺呢度另寫一份清單。
  // 另寫一份嘅話，`INVARIANT_SET.PER_SCENARIO` 日後加減一條，
  // 報告就會講一個唔存在嘅事實——而冇人會發現。
  let fastInvariantIds = [];
  // 第六十一輪批次 D 組：時間去咗邊。
  let actionMs = 0;
  let invariantMs = 0;
  // 第六十輪批次 A3 組：防打轉閘。
  let lastFingerprint = '';
  let sameFingerprintRun = 0;
  let spinning = null;
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
      // ═════════════════════════════════════════════════════════════
      // 第六十一輪批次 A 組：**唔可以靜靜停低。**
      // ═════════════════════════════════════════════════════════════
      //
      // 舊寫法只係 `stepLog.push(...)` 然後 `break`——冇記低失敗、
      // 冇印路徑。於是報告會寫「跑了 3 / 50 步，0 項失敗」，
      // 而冇人知道點解得 3 步、亦都重現唔到。
      //
      // ⚠️ 同 A3 防打轉閘一樣：**一份「跑咗幾步、零失敗」嘅報告
      // 睇落好似冇事**——嗰個先係最危險嘅輸出。
      noLegalAction = {
        step: i,
        state: monkeyStateFingerprint_(facts),
        actionCount: actions.length
      };
      failures.push({
        step: i, kind: '這個狀態下沒有任何合法動作',
        detail: '停在 ' + monkeyStateFingerprint_(facts)
          + '（Stage｜最新版本號｜認不出的格數）。'
          + '這一批可以撳的動作有 ' + actions.length + ' 個，'
          + '而沒有一個在這個狀態下合法，所以乾淨停手。',
        path: path.slice()
      });
      stepLog.push({ step: i, action: '（沒有合法動作）',
        outcome: '乾淨停手', invariant: '' });
      break;
    }

    const picked = monkeyPickWeighted_(legal, rnd);
    let outcome = '';
    let threw = '';
    // ⚠️ 喺迴圈嗰層宣告，唔可以留喺下面個 `try` 入面——
    // 下面防打轉嗰段喺 `try` 之後先用到佢。
    let after = null;
    // 第六十一輪批次 D 組：呢一步嘅動作用咗幾耐（包括之後讀返狀態嗰下）。
    const actionStartedAt = new Date().getTime();
    try {
      const result = picked.run(quarterId, rnd);
      outcome = JSON.stringify(result).slice(0, 300);

      // ── 第五十二輪批次 C 組：**睇返個回傳值。** ────────────────
      //
      // ⚠️ 之前呢一行下面就直接落去跑不變量。回傳值淨係
      // `JSON.stringify` 落 `MonkeyLog`——冇人睇。
      // 一個唔拋錯、但係靜靜噉乜都冇做嘅入口，會一路行到 50 步，
      // 然後交一份綠色報告。
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
    actionMs += new Date().getTime() - actionStartedAt;
    path.push(picked.id);

    // ═══════════════════════════════════════════════════════════════
    // ⚠️⚠️ 第六十輪批次 A3 組：**原地打轉要自己爬得出嚟。**
    // ═══════════════════════════════════════════════════════════════
    //
    // 現場：亂行機喺沙盒 2028T3 上面一路寫「亂行N」，
    // 而寫完之後系統乜都唔准做 ⇒ 每一步只剩「改 grid」合法 ⇒
    // 一路寫更多。Stage 停喺 OFFICIAL_SENT 一路冇變過，
    // 50 步跑完，零動作成功過，而報告一句都冇講。
    //
    // ⚠️ 呢一道係**通用防護**，唔止為咗今次呢一個 bug。
    // 亂行機嘅本質就係會撞到冇人諗過嘅狀態——佢一定要有
    // 自己爬得出嚟嘅能力，否則佢每一次撞到新坑都要人手救。
    //
    // 判斷：連續 `MONKEY_SPIN_LIMIT` 步揀中**同一個動作 id**，
    // 而且系統狀態指紋**完全冇變**。
    const fingerprint = picked.id + '　' + monkeyStateFingerprint_(after || facts);
    if (fingerprint === lastFingerprint) {
      sameFingerprintRun++;
    } else {
      sameFingerprintRun = 1;
      lastFingerprint = fingerprint;
    }
    if (sameFingerprintRun >= MONKEY_SPIN_LIMIT) {
      spinning = {
        actionId: picked.id,
        steps: sameFingerprintRun,
        state: monkeyStateFingerprint_(after || facts)
      };
      failures.push({
        step: i, kind: '偵測到原地打轉，已停止',
        detail: '連續 ' + sameFingerprintRun + ' 步都選中「' + picked.id
          + '」，而且 Stage／最新版本號／認不出的格數完全沒有變過（'
          + monkeyStateFingerprint_(after || facts) + '）。'
          + '再跑下去只會重複同一步。',
        path: path.slice()
      });
      stepLog.push({
        step: i, action: picked.id, outcome: outcome,
        invariant: '（原地打轉，已停止）', threw: threw
      });
      break;
    }

    // ── 第六十一輪批次 B 組：抽驗 ＋ 定期全驗 ────────────────────
    //
    // ⚠️ 之前每一步都 `runAllInvariants_(quarterId)`（冇傳 set ＝ ALL），
    // 入面包住 I04（成萬行）同 I08（每條行一次完整 plan）。
    // 一步跑一次，50 步就跑 50 次——而狀態一步之內改到嘅嘢，
    // 快嗰四條已經捉得到大部分。
    //
    // ⚠️ **唔係唔跑全套**，係唔使每步都跑：每 10 步一次，收尾補一次。
    const isFullSweep = (i % MONKEY_FULL_INVARIANT_EVERY === 0) || (i === total);
    const invariantStartedAt = new Date().getTime();
    let invariantText = '';
    try {
      const inv = runAllInvariants_(quarterId,
        isFullSweep ? INVARIANT_SET.ALL : INVARIANT_SET.PER_SCENARIO);
      if (isFullSweep) {
        fullSweepCount++;
        lastFullSweepStep = i;
      } else if (fastInvariantIds.length === 0) {
        fastInvariantIds = inv.results.map(function (r) { return r.id; });
      }
      const broken = inv.results.filter(function (r) {
        return r.status === INVARIANT_STATUS.FAILED || r.status === INVARIANT_STATUS.ERROR;
      });
      invariantText = (broken.length === 0 ? 'OK'
        : broken.map(function (r) { return r.id; }).join('、'))
        + (isFullSweep ? '（全套）' : '（逐步）');
      broken.forEach(function (r) {
        failures.push({
          step: i, kind: '不變量 ' + r.id,
          // ⚠️ 分開講「逐步」同「全套」：一條只喺全套先驗到嘅不變量
          // 紅咗，代表佢係喺前面某幾步之內壞嘅，唔一定係呢一步。
          sweep: isFullSweep ? '全套' : '逐步',
          detail: r.label + '｜預期 ' + r.expected + '｜實際 ' + r.actual + '｜' + r.evidence,
          path: path.slice()
        });
      });
    } catch (err) {
      invariantText = '算不出：' + err.message;
      failures.push({ step: i, kind: '不變量算不出',
        sweep: isFullSweep ? '全套' : '逐步',
        detail: err.message, path: path.slice() });
    }
    invariantMs += new Date().getTime() - invariantStartedAt;

    stepLog.push({
      step: i, action: picked.id, outcome: outcome,
      invariant: invariantText, threw: threw
    });
  }

  // ── 第六十一輪批次 B 組：收尾一定要有一次全套 ──────────────────
  //
  // ⚠️ 迴圈會因為時間到、原地打轉、冇合法動作、DRY_RUN 變咗
  // 而中途 `break`。省咗呢一段嘅話，最尾嗰幾步改到嘅嘢
  // 就冇任何一次全套驗過——而「慳時間」唔係唔驗嘅理由。
  const ranSteps = stepLog.length;
  let tailSweepStep = 0;
  if (ranSteps > 0 && lastFullSweepStep !== stepLog[ranSteps - 1].step) {
    const tailStep = stepLog[ranSteps - 1].step;
    const tailStartedAt = new Date().getTime();
    try {
      const inv = runAllInvariants_(quarterId, INVARIANT_SET.ALL);
      fullSweepCount++;
      lastFullSweepStep = tailStep;
      tailSweepStep = tailStep;
      inv.results.filter(function (r) {
        return r.status === INVARIANT_STATUS.FAILED || r.status === INVARIANT_STATUS.ERROR;
      }).forEach(function (r) {
        failures.push({
          step: tailStep, kind: '不變量 ' + r.id, sweep: '全套',
          detail: r.label + '｜預期 ' + r.expected + '｜實際 ' + r.actual
            + '｜' + r.evidence,
          path: path.slice()
        });
      });
    } catch (err) {
      failures.push({ step: tailStep, kind: '不變量算不出', sweep: '全套',
        detail: '收尾那一次全套：' + err.message, path: path.slice() });
    }
    invariantMs += new Date().getTime() - tailStartedAt;
  }

  return {
    blocked: false,
    quarterId: quarterId,
    seed: seed,
    requestedSteps: total,
    ranSteps: stepLog.length,
    stoppedForTime: stoppedForTime,
    // 第六十輪批次 A3 組：有嘅話，報告要大聲講。
    spinning: spinning,
    // 第六十一輪批次 A 組：停喺一個冇任何合法動作嘅狀態。
    noLegalAction: noLegalAction,
    // 第六十一輪批次 C 組：跳咗邊幾個慢動作。
    skipSlow: skipSlow,
    skippedSlow: skippedSlow,
    // 第六十一輪批次 B 組：全套不變量跑咗幾多次。
    fullSweepCount: fullSweepCount,
    tailSweepStep: tailSweepStep,
    fastInvariantIds: fastInvariantIds,
    // 第六十一輪批次 D 組：時間去咗邊。
    totalMs: new Date().getTime() - monkeyStartedAt_,
    actionMs: actionMs,
    invariantMs: invariantMs,
    steps: stepLog,
    failures: failures,
    path: path,
    // 續跑要用：下一次由第幾抽開始。
    drawnCount: rnd.drawnCount()
  };
}

/**
 * 第六十一輪批次 D 組：一行講清楚時間去咗邊。
 *
 * ⚠️ 分開講「動作」同「不變量」——樽頸喺邊，一眼睇得出。
 * 只印一個總數嘅話，落一輪又要重新估。
 *
 * @param {Object} report `runMonkey_()` 的結果
 * @returns {string} 一行
 */
function monkeyDescribeSpeed_(report) {
  const sec = function (ms) { return (Number(ms || 0) / 1000).toFixed(1); };
  const steps = Number(report.ranSteps) || 0;
  const per = steps > 0 ? (Number(report.totalMs || 0) / steps / 1000).toFixed(1)
    : '—';
  return '這一批：跑了 ' + steps + ' 步／用了 ' + sec(report.totalMs)
    + ' 秒／平均每步 ' + per + ' 秒'
    + '（動作 ' + sec(report.actionMs) + ' 秒／不變量 '
    + sec(report.invariantMs) + ' 秒）';
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
    '隨機種子：' + report.seed + '（用同一個種子重跑，會走同一條路）'
  ];

  // ── 第六十一輪批次 D 組：時間去咗邊 ──────────────────────────
  //
  // ⚠️ 冇呢一行嘅話，「一批 4.5 分鐘得 2 步」呢種事，
  // 每一次都要重新估一次樽頸喺邊。
  lines.push(monkeyDescribeSpeed_(report));

  // ── 第六十一輪批次 B 組：逐步 vs 全套 ────────────────────────
  //
  // ⚠️ 兩者要分開講。「跑了 50 步」唔等於「驗了 50 次全套」——
  // 混做一句嘅話，一個「全套只跑過 1 次」嘅批次睇落同
  // 「每步都跑全套」一模一樣。
  lines.push('不變量：逐步跑快的那批（'
    + ((report.fastInvariantIds || []).join('／') || '—') + '）；'
    + '全套跑了 ' + report.fullSweepCount + ' 次（每 '
    + MONKEY_FULL_INVARIANT_EVERY + ' 步一次'
    + (report.tailSweepStep ? '，另加收尾補跑第 ' + report.tailSweepStep + ' 步'
      : '') + '）。');

  // ── 第六十一輪批次 C 組：跳咗邊幾個慢動作 ────────────────────
  //
  // ⚠️⚠️ **這一行不可以省。** 一份「跑了 50 步、零失敗」而沒有講
  // 跳過什麼的報告，會令人以為那條路驗過了。
  if (report.skipSlow && (report.skippedSlow || []).length > 0) {
    lines.push('已跳過的慢動作：'
      + report.skippedSlow.map(function (a) { return a.id; }).join('、')
      + '（' + CONFIG_KEYS.MONKEY_SKIP_SLOW_ACTIONS + '=TRUE）');
    report.skippedSlow.forEach(function (a) {
      lines.push('　 ・' + a.id + '：' + a.why);
    });
    // ⚠️ 連帶後果都要講：跳過「正式發出」⇒ Stage 上不到 OFFICIAL_SENT
    // ⇒「改動後重發」也永遠合法不了。這不是 bug，是開關的代價。
    lines.push('　 ⚠️ 連帶：Stage 上不到「已正式發出」，'
      + '所以「改動後重發（只算，不寄）」這一步也不會被抽到。');
    lines.push('　 想它也一起亂行，把 ' + CONFIG_KEYS.MONKEY_SKIP_SLOW_ACTIONS
      + ' 改成 FALSE。');
  } else if ((report.skippedSlow || []).length > 0) {
    lines.push('慢動作沒有跳過（' + CONFIG_KEYS.MONKEY_SKIP_SLOW_ACTIONS
      + '=FALSE），這一批會慢很多。');
  }
  lines.push('');

  // ── 第六十一輪批次 A 組：冇一個動作合法，要講得出停喺邊。 ────
  //
  // ⚠️ 舊寫法只係靜靜 `break`，報告會寫「跑了 3 / 50 步，0 項失敗」，
  // 而冇人知道點解得 3 步、亦都重現唔到。
  if (report.noLegalAction) {
    lines.push('⛔ 這個狀態下沒有任何合法動作，已乾淨停手。');
    lines.push('　 停在第 ' + report.noLegalAction.step + ' 步，狀態 '
      + report.noLegalAction.state + '（Stage｜最新版本號｜認不出的格數）');
    lines.push('　 這一批可以撳的動作有 ' + report.noLegalAction.actionCount
      + ' 個，沒有一個在這個狀態下合法。');
    lines.push('　 完整重現路徑：' + (report.path.join(' → ') || '（第一步）'));
    lines.push('　 用同一個種子（' + report.seed + '）重跑會走同一條路。');
    lines.push('');
  }

  // ── 第六十輪批次 A3 組：原地打轉要排喺最頂，大聲講。 ─────────
  //
  // ⚠️ 排喺失敗清單前面——佢係「點解跑到一半就停」嘅答案，
  // 唔應該混喺一堆逐步失敗入面等人自己揾。
  if (report.spinning) {
    lines.push('⛔ 偵測到原地打轉，已停止。');
    lines.push('　 連續 ' + report.spinning.steps + ' 步都選中「'
      + report.spinning.actionId + '」，'
      + '而 Stage／最新版本號／認不出的格數完全沒有變過。');
    lines.push('　 停下來時的狀態：' + report.spinning.state
      + '（Stage｜最新版本號｜認不出的格數）');
    lines.push('　 完整重現路徑：' + (report.path.join(' → ') || '（第一步）'));
    lines.push('　 用同一個種子（' + report.seed + '）重跑會走同一條路。');
    lines.push('');
  }

  if (report.failures.length === 0) {
    lines.push('沒有一步令不變量失敗。');
  }
  report.failures.forEach(function (f) {
    // ⚠️ 一條**只喺全套先驗到**嘅不變量紅咗，代表佢係喺前面
    // 某幾步之內壞嘅，唔一定係呢一步——唔講明嘅話會揾錯方向。
    lines.push('🔴 第 ' + f.step + ' 步　' + f.kind
      + (f.sweep === '全套' ? '（全套那一次驗到；可能是前面幾步之內壞的）'
        : ''));
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

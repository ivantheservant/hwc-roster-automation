/**
 * 執行內建自我測試：只讀取與驗算，不寄電郵、不改資料表、不建立版本。
 * 每項回傳 PASS / FAIL 與說明，結果寫入 SelfTest_Result 工作表。
 * @returns {{results: Object[], passed: number, failed: number, sheetName: string}} 測試結果
 */
function runSelfTest() {
  const tests = [
    { name: '1. Config 讀取與 Type 轉換', run: testConfigTypes_ },
    { name: '2. Posts 讀取、過濾與排序', run: testPostsReading_ },
    { name: '3. Eligibility 雙向索引對稱', run: testEligibilitySymmetry_ },
    { name: '4. NameAlias 全部可解析', run: testAliasResolution_ },
    { name: '5. normalizeName 回傳正名', run: testNormalizeName_ },
    { name: '6. 每崗位人數 >= SlotCount', run: testEligibilityCoverage_ },
    { name: '7. 硬規則違反五項全為 0', run: testHardRuleViolations_ },
    { name: '8. 附件檔名產生邏輯', run: testAttachmentNaming_ },
    { name: '9. AssignmentHash 一致性', run: testAssignmentHash_ },
    { name: '10. DRY_RUN 走 SendLog 而非 MailApp', run: testDryRunPath_ },
    { name: '11. FineTune 偵測連續兩週', run: testFineTuneDetection_ },
    { name: '12. EmailTemplates 缺範本不 crash', run: testMissingTemplates_ }
  ];

  const results = tests.map(function (test) {
    try {
      const outcome = test.run();
      return {
        name: test.name,
        result: outcome.pass ? SELF_TEST_RESULT.PASS : SELF_TEST_RESULT.FAIL,
        detail: outcome.detail,
        action: outcome.pass ? '' : outcome.action
      };
    } catch (err) {
      return {
        name: test.name,
        result: SELF_TEST_RESULT.ERROR,
        detail: '測試本身發生錯誤：' + err.message,
        action: '把這行訊息告訴開發者，這代表程式有 bug 而非資料問題'
      };
    }
  });

  const sheetName = writeSelfTestSheet_(results);
  return {
    results: results,
    passed: results.filter(function (r) { return r.result === SELF_TEST_RESULT.PASS; }).length,
    failed: results.filter(function (r) { return r.result !== SELF_TEST_RESULT.PASS; }).length,
    sheetName: sheetName
  };
}

/**
 * 測試 1：readConfig() 能讀到全部 Key，且 INT / BOOL / DEC / LIST 各抽驗一項轉換正確。
 * @returns {{pass: boolean, detail: string, action: string}} 測試結果
 */
function testConfigTypes_() {
  const config = readConfig();
  const rawRows = readSheet(SHEETS.CONFIG);
  const problems = [];

  const sheetKeys = rawRows
    .map(function (row) { return row[COLUMNS.CONFIG.KEY]; })
    .filter(function (k) { return !!k; });
  const missing = sheetKeys.filter(function (k) { return !(k in config); });
  if (missing.length > 0) problems.push('readConfig 缺少 Key: ' + missing.join(', '));

  const typeByKey = {};
  rawRows.forEach(function (row) {
    typeByKey[row[COLUMNS.CONFIG.KEY]] = String(row[COLUMNS.CONFIG.TYPE] || '').toUpperCase();
  });

  const checks = [
    { type: CONFIG_TYPES.INT, jsType: 'number' },
    { type: CONFIG_TYPES.DEC, jsType: 'number' },
    { type: CONFIG_TYPES.BOOL, jsType: 'boolean' },
    { type: CONFIG_TYPES.LIST, jsType: 'array' }
  ];

  const sampled = [];
  checks.forEach(function (check) {
    const key = sheetKeys.filter(function (k) {
      return typeByKey[k] === check.type && config[k] !== null && config[k] !== '';
    })[0];
    if (!key) {
      sampled.push(check.type + '=（Config 中沒有此型別的資料可抽驗）');
      return;
    }
    const value = config[key];
    const actualType = Array.isArray(value) ? 'array' : typeof value;
    sampled.push(check.type + ' 抽 ' + key + ' → ' + actualType);
    if (actualType !== check.jsType) {
      problems.push(key + ' 應為 ' + check.jsType + '，實際為 ' + actualType);
    }
  });

  return {
    pass: problems.length === 0,
    detail: '共 ' + sheetKeys.length + ' 個 Key。' + sampled.join('；'),
    action: problems.join('；')
  };
}

/**
 * 測試 2：readPosts() 回傳的行數、Active 過濾與 DisplayOrder 排序是否正確。
 * @returns {{pass: boolean, detail: string, action: string}} 測試結果
 */
function testPostsReading_() {
  const all = readSheet(SHEETS.POSTS);
  const active = readPosts();
  const expectedActive = all.filter(function (row) {
    return isTrueValue_(row[COLUMNS.POSTS.ACTIVE]);
  }).length;

  const problems = [];
  if (active.length !== expectedActive) {
    problems.push('Active 過濾錯誤：回傳 ' + active.length + '，預期 ' + expectedActive);
  }
  for (let i = 1; i < active.length; i++) {
    const prev = Number(active[i - 1][COLUMNS.POSTS.DISPLAY_ORDER]);
    const cur = Number(active[i][COLUMNS.POSTS.DISPLAY_ORDER]);
    if (prev > cur) {
      problems.push('DisplayOrder 未排序：' + prev + ' 出現在 ' + cur + ' 之前');
      break;
    }
  }

  return {
    pass: problems.length === 0,
    detail: 'Posts 共 ' + all.length + ' 行，Active ' + active.length + ' 行，DisplayOrder 已由小至大排序',
    action: problems.join('；')
  };
}

/**
 * 測試 3：readEligibility() 的 byPost 與 byPerson 兩個索引是否互相對稱。
 * @returns {{pass: boolean, detail: string, action: string}} 測試結果
 */
function testEligibilitySymmetry_() {
  const eligibility = readEligibility();
  const problems = [];
  let pairCount = 0;

  Object.keys(eligibility.byPost).forEach(function (postId) {
    eligibility.byPost[postId].forEach(function (personId) {
      pairCount++;
      const posts = eligibility.byPerson[personId] || [];
      if (posts.indexOf(postId) === -1) {
        problems.push(postId + '→' + personId + ' 在 byPerson 中找不到');
      }
    });
  });

  Object.keys(eligibility.byPerson).forEach(function (personId) {
    eligibility.byPerson[personId].forEach(function (postId) {
      const people = eligibility.byPost[postId] || [];
      if (people.indexOf(personId) === -1) {
        problems.push(personId + '→' + postId + ' 在 byPost 中找不到');
      }
    });
  });

  return {
    pass: problems.length === 0,
    detail: '共 ' + pairCount + ' 組配對，'
      + Object.keys(eligibility.byPost).length + ' 個崗位、'
      + Object.keys(eligibility.byPerson).length + ' 個人，雙向索引一致',
    action: problems.slice(0, 5).join('；')
  };
}

/**
 * 測試 4：NameAlias 表中每個 Active 的別名，resolvePersonId() 都能解析到對應的 PersonID。
 * @returns {{pass: boolean, detail: string, action: string}} 測試結果
 */
function testAliasResolution_() {
  const aliasMap = readNameAlias();
  const aliases = Object.keys(aliasMap);
  const problems = [];

  aliases.forEach(function (alias) {
    const resolved = resolvePersonId(alias);
    if (resolved !== aliasMap[alias]) {
      problems.push('「' + alias + '」解析為 ' + (resolved || 'null') + '，預期 ' + aliasMap[alias]);
    }
  });

  return {
    pass: problems.length === 0,
    detail: '共 ' + aliases.length + ' 個別名，全部解析正確',
    action: problems.slice(0, 5).join('；')
      + (problems.length > 0 ? '（注意：若別名與某人的正名相同，resolvePersonId 會先命中正名）' : '')
  };
}

/**
 * 測試 5「normalizeName 回傳正名」的 fallback 樣本——只在 NameAlias 表目前
 * 沒有足夠 Active 資料時才會用到。刻意選不太可能撞名的虛構姓名，且刻意不寫成
 * 任何形式的「別名 → 正名」對照（因為它們根本不在 NameAlias 表裡，
 * testNormalizeName_() 用它們驗證的是「查無別名時原樣回傳」這條路徑，
 * 不是「別名正確解析成正名」那條路徑——兩條路徑合起來才是 normalizeName() 的
 * 完整行為，缺了真實資料時至少還能驗到後者）。
 */
const SELF_TEST_FALLBACK_NAME_ALIASES = ['陳大文', '李小明', '王美美'];

/**
 * 測試 5：normalizeName() 能把 NameAlias 表裡的異體字姓名正確解析回正名。
 *
 * 追加階段 AQ：樣本改為執行時從 NameAlias 動態取樣，不再寫死任何特定姓名
 * ——這個專案的原始碼打算公開到 GitHub，寫死真實會友姓名當測試資料本身就是
 * 要修的問題。優先取 NameAlias 現有 Active 資料的前 3 筆，用真正的
 * `resolvePersonId()` 比對驗證解析是否正確；資料不足 3 筆（含完全沒有、或
 * `readNameAlias()` 本身讀取失敗）時，其餘名額用 `SELF_TEST_FALLBACK_NAME_ALIASES`
 * 的虛構姓名補齊，改驗證「查無別名時原樣回傳、不出錯」——不會因為讀不到真實
 * 資料就整項略過不測，跟原本「不在表中就略過」的做法不同。
 * `detail` 會逐筆標明這一筆用的是「NameAlias 真實資料」還是「虛構 fallback 資料」。
 * @returns {{pass: boolean, detail: string, action: string}} 測試結果
 */
function testNormalizeName_() {
  const SAMPLE_SIZE = 3;
  let aliasMap = {};
  try {
    aliasMap = readNameAlias();
  } catch (err) {
    aliasMap = {}; // 讀取失敗一律當作沒有真實資料可用，全部落入 fallback
  }

  const realNames = Object.keys(aliasMap).slice(0, SAMPLE_SIZE);
  const fallbackNames = realNames.length < SAMPLE_SIZE
    ? SELF_TEST_FALLBACK_NAME_ALIASES.slice(0, SAMPLE_SIZE - realNames.length)
    : [];

  const details = [];
  const problems = [];

  realNames.forEach(function (name) {
    const normalized = normalizeName(name);
    const expectedId = aliasMap[name];
    const resolvedId = resolvePersonId(normalized);
    details.push(name + ' → ' + normalized + '（NameAlias 真實資料）');
    if (resolvedId !== expectedId) {
      problems.push(name + ' 正規化為「' + normalized + '」，但它對應 ' + resolvedId + '，預期 ' + expectedId);
    }
  });

  fallbackNames.forEach(function (name) {
    const normalized = normalizeName(name);
    details.push(name + ' → ' + normalized + '（虛構 fallback 資料，僅驗證查無別名時原樣回傳）');
    if (normalized !== name) {
      problems.push('虛構姓名「' + name + '」不應該被解析成別的名字，但 normalizeName() 回傳了「' + normalized + '」'
        + '——可能剛好與真實資料同名，或 normalizeName() 邏輯有誤');
    }
  });

  return {
    pass: problems.length === 0,
    detail: (fallbackNames.length > 0
      ? '（NameAlias 現有真實資料只有 ' + realNames.length + ' 筆，其餘 ' + fallbackNames.length + ' 筆用虛構 fallback 資料補齊）'
      : '（全部 ' + realNames.length + ' 筆皆取樣自 NameAlias 現有真實資料）')
      + details.join('；'),
    action: problems.join('；')
  };
}

/**
 * 測試 6：每個需要自動排班的崗位，其 Eligibility 合資格人數是否 >= SlotCount。
 * @returns {{pass: boolean, detail: string, action: string}} 測試結果
 */
function testEligibilityCoverage_() {
  const posts = readPostsNormalized();
  const eligibility = readEligibility();
  const shortfalls = [];

  posts.forEach(function (post) {
    if (!post.autoGenerate) return;
    const pool = eligibility.byPost[post.postId] || [];
    if (pool.length < post.slotCount) {
      shortfalls.push(post.postNameTC + '（' + post.postId + '）只有 '
        + pool.length + ' 人，需要 ' + post.slotCount + ' 人');
    }
  });

  const autoPosts = posts.filter(function (p) { return p.autoGenerate; });
  return {
    pass: shortfalls.length === 0,
    detail: '檢查了 ' + autoPosts.length + ' 個自動排班崗位，人數全部足夠',
    action: shortfalls.join('；') + (shortfalls.length > 0 ? '　→ 請在 Eligibility 補上合資格人選' : '')
  };
}

/**
 * 測試 7：對最新版本執行核對，確認硬規則違反五項全為 0。
 * @returns {{pass: boolean, detail: string, action: string}} 測試結果
 */
function testHardRuleViolations_() {
  const quarterId = SELF_TEST_TARGET.QUARTER_ID;
  const versionNo = SELF_TEST_TARGET.VERSION_NO;
  const context = buildVerifyContext_(quarterId, versionNo);

  if (context.assignments.length === 0) {
    return {
      pass: false,
      detail: '找不到 ' + quarterId + ' v' + versionNo + ' 的派工紀錄',
      action: '請先執行「生成職事表」產生 ' + quarterId + ' v' + versionNo
    };
  }

  const hard = checkHardRuleViolations_(context);
  const summary = hard.groups.map(function (g) {
    return g.label + ' ' + g.items.length;
  }).join('；');

  return {
    pass: hard.total === 0,
    detail: quarterId + ' v' + versionNo + '（' + context.assignments.length + ' 格）：' + summary,
    action: hard.total > 0
      ? '這是程式 bug，請看 Verify 工作表第 5 節：' + hard.groups
        .filter(function (g) { return g.items.length > 0; })
        .map(function (g) { return g.items[0]; }).join('；')
      : ''
  };
}

/**
 * 測試 8：用假資料驗證 ATTACH_NAME_PATTERN 的變數代入是否正確。不產生任何檔案。
 * @returns {{pass: boolean, detail: string, action: string}} 測試結果
 */
function testAttachmentNaming_() {
  const pattern = String(getConfig(CONFIG_KEYS.ATTACH_NAME_PATTERN, DEFAULTS.ATTACH_NAME_PATTERN));
  const fakeQuarter = 'TEST9T9';
  const fakeName = '測試人員';
  const generated = buildAttachmentName_(fakeQuarter, 9, fakeName);
  const problems = [];

  if (pattern.indexOf('{QuarterID}') !== -1 && generated.indexOf(fakeQuarter) === -1) {
    problems.push('{QuarterID} 未被代入');
  }
  if (pattern.indexOf('{PersonName}') !== -1 && generated.indexOf(fakeName) === -1) {
    problems.push('{PersonName} 未被代入');
  }
  if (generated.indexOf('{') !== -1) {
    problems.push('仍有未代入的變數：' + generated);
  }
  if (generated.toLowerCase().indexOf('.pdf') === -1) {
    problems.push('檔名沒有 .pdf 副檔名');
  }

  return {
    pass: problems.length === 0,
    detail: '範本「' + pattern + '」→ 產生「' + generated + '」（未產生實際檔案）',
    action: problems.join('；')
  };
}

/**
 * 測試 9：AssignmentHash 對同一組資料兩次計算相同；改動一格後結果不同。
 * @returns {{pass: boolean, detail: string, action: string}} 測試結果
 */
function testAssignmentHash_() {
  const sample = [
    { serviceDate: '2026-10-04', postId: 'X1', slotIndex: 1 },
    { serviceDate: '2026-10-11', postId: 'X2', slotIndex: 1 },
    { serviceDate: '2026-10-18', postId: 'X1', slotIndex: 2 }
  ];
  const changed = [
    { serviceDate: '2026-10-04', postId: 'X1', slotIndex: 1 },
    { serviceDate: '2026-10-11', postId: 'X2', slotIndex: 1 },
    { serviceDate: '2026-10-25', postId: 'X1', slotIndex: 2 }
  ];
  const reordered = [sample[2], sample[0], sample[1]];

  const hash1 = computeAssignmentHash_(sample);
  const hash2 = computeAssignmentHash_(sample);
  const hashChanged = computeAssignmentHash_(changed);
  const hashReordered = computeAssignmentHash_(reordered);
  const problems = [];

  if (hash1 !== hash2) problems.push('同一組資料兩次計算結果不同');
  if (hash1 === hashChanged) problems.push('改動一格後 hash 沒有改變');
  if (hash1 !== hashReordered) problems.push('順序不同時 hash 應該相同（計算前有排序）');
  if (hash1.length !== 16) problems.push('hash 長度應為 16，實際為 ' + hash1.length);
  // 追加階段 AO：空清單改回傳固定標記 ASSIGNMENT_HASH_EMPTY，不再是空字串
  // （原因見 Mailer.gs 的 computeAssignmentHash_() 註解）。
  if (computeAssignmentHash_([]) !== ASSIGNMENT_HASH_EMPTY) problems.push('空清單應回傳固定標記 ' + ASSIGNMENT_HASH_EMPTY);

  return {
    pass: problems.length === 0,
    detail: '原始 ' + hash1 + '；改動後 ' + hashChanged + '；重排後 ' + hashReordered + '（長度 16、可重現、對順序不敏感）',
    action: problems.join('；')
  };
}

/**
 * 測試 10：確認 DRY_RUN=TRUE 時 deliverOne_() 走 SendLog 路徑而非呼叫 MailApp。
 * 用 mock 收件人與 mock 範本，完全不接觸真正的 MailApp。
 * @returns {{pass: boolean, detail: string, action: string}} 測試結果
 */
function testDryRunPath_() {
  const isDryRun = getConfig(CONFIG_KEYS.DRY_RUN, true) !== false;
  const problems = [];

  const mockRecipient = {
    type: RECIPIENT_TYPE.LIST,
    personId: '',
    email: 'selftest@example.invalid',
    displayName: '自我測試',
    sendAs: SEND_AS.TO
  };
  const mockTemplate = {
    templateId: 'MOCK', stage: MAIL_STAGES.GENERATE, lang: 'TC',
    subject: '測試 {QuarterID}', bodyHtml: '<p>測試</p>', bodyPlain: '測試',
    attachType: ATTACH_TYPE.NONE
  };
  const mockContext = {
    quarterId: 'TEST9T9', versionNo: 9, stage: MAIL_STAGES.GENERATE,
    timezone: DEFAULTS.TIMEZONE, assignmentsByPerson: {}, postNames: {},
    peopleById: {}, subjectPrefix: '[SELFTEST]', senderName: '', replyTo: '',
    adminEmail: '', lastHashByPerson: {}, placeholders: { QuarterID: 'TEST9T9' }
  };

  const outcome = deliverOne_(mockRecipient, mockTemplate, mockContext, isDryRun);

  if (isDryRun && outcome.status !== MAIL_STATUS.DRY_RUN) {
    problems.push('DRY_RUN=TRUE 時 status 應為 DRY_RUN，實際為 ' + outcome.status);
  }
  if (outcome.status === MAIL_STATUS.SENT) {
    problems.push('嚴重：自我測試路徑產生了 SENT 狀態');
  }

  // 驗證第二重防護：即使誤呼叫 sendRealEmail_，DRY_RUN=TRUE 時也必須拒絕
  let guardWorks = false;
  if (isDryRun) {
    try {
      sendRealEmail_(mockRecipient, '不應寄出', '', '', mockContext);
      problems.push('嚴重：sendRealEmail_ 在 DRY_RUN=TRUE 時沒有拒絕');
    } catch (err) {
      guardWorks = true;
    }
  }

  return {
    pass: problems.length === 0,
    detail: 'DRY_RUN=' + isDryRun + '；deliverOne_ 回傳 ' + outcome.status
      + (guardWorks ? '；sendRealEmail_ 防呆已確認會 throw' : '')
      + '（全程未寫入 SendLog、未呼叫 MailApp）',
    action: problems.join('；')
  };
}

/**
 * 測試 11：用假資料造一個違反 SEMI_NO_CONSECUTIVE 的狀態，確認能偵測到；
 * 再造一個合規狀態，確認不會誤報。
 * @returns {{pass: boolean, detail: string, action: string}} 測試結果
 */
function testFineTuneDetection_() {
  const rules = readRules();
  if (!isRuleEnabled_(rules, RULE_IDS.NO_CONSECUTIVE)) {
    return {
      pass: true,
      detail: 'SEMI_NO_CONSECUTIVE 在 RuleSettings 已停用，略過此測試',
      action: ''
    };
  }

  const blockingPost = readPostsNormalized().filter(function (p) {
    return p.autoGenerate && p.allowConsecutive === ALLOW_CONSECUTIVE.BLOCK;
  })[0];
  if (!blockingPost) {
    return {
      pass: true,
      detail: '沒有 AllowConsecutive=BLOCK 的崗位可測試，略過',
      action: ''
    };
  }

  const eligibility = readEligibility();
  const pool = eligibility.byPost[blockingPost.postId] || [];
  if (pool.length < 2) {
    return {
      pass: true,
      detail: blockingPost.postId + ' 的候選人不足 2 人，無法造測試情境，略過',
      action: ''
    };
  }

  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const serviceDates = readServiceDatesNormalized(SELF_TEST_TARGET.QUARTER_ID, timezone);
  if (serviceDates.length < 2) {
    return { pass: true, detail: '主日不足 2 週，略過', action: '' };
  }

  // 第十八輪批次階段 A3：呢個都係一個「手砌 context」嘅呼叫點。
  // 之前漏咗 roles／personPostExclusions——**現有斷言啱巧唔受影響**
  // （下面兩個 filter 只留 NO_CONSECUTIVE，誤報嘅身分違規被隔走咗），
  // 但屬於同一個 bug class，而且一旦有人放寬嗰個 filter 就會即刻誤判。
  // 而家由同一個 buildRoleContext_() 取，唔另外讀一次工作表。
  const posts = readPostsNormalized();
  const roleContext = buildRoleContext_(eligibility, posts, timezone);
  const context = {
    rules: rules,
    posts: posts,
    serviceDates: serviceDates,
    eligibility: eligibility,
    roles: roleContext.roles,
    personPostExclusions: roleContext.exclusions,
    peopleById: indexPeopleById_(),
    unavailable: [],
    maxPerQuarterDefault: DEFAULTS.MAX_PER_QUARTER,
    // 這個自我測試特意要驗證 SEMI_HARD 違反能被偵測到（NO_CONSECUTIVE 通常設為
    // SEMI_HARD），固定給 true，不要受 Config 的 WARN_ON_SEMI_HARD_BREAK 實際設定
    // 影響——否則幹事若把它設成 FALSE，這個自我測試會跟著失效，變成測不出真正的問題。
    warnOnSemiHard: true
  };

  const makeCell = function (dateIndex, personId) {
    return {
      serviceDateId: serviceDates[dateIndex].serviceDateId,
      serviceDate: serviceDates[dateIndex].serviceDate,
      postId: blockingPost.postId,
      slotIndex: 1,
      personId: personId,
      isManual: true
    };
  };

  const breakingState = [makeCell(0, pool[0]), makeCell(1, pool[0])];
  const cleanState = [makeCell(0, pool[0]), makeCell(1, pool[1])];

  const breakingHits = findStateViolations_(breakingState, context).filter(function (v) {
    return v.ruleId === RULE_IDS.NO_CONSECUTIVE;
  });
  const cleanHits = findStateViolations_(cleanState, context).filter(function (v) {
    return v.ruleId === RULE_IDS.NO_CONSECUTIVE;
  });

  const problems = [];
  if (breakingHits.length === 0) problems.push('連續兩週同一人未被偵測到（漏報）');
  if (cleanHits.length > 0) problems.push('兩週不同人卻被判違規（誤報）');

  return {
    pass: problems.length === 0,
    detail: '用 ' + blockingPost.postNameTC + ' 測試：違規情境偵測到 '
      + breakingHits.length + ' 項、合規情境偵測到 ' + cleanHits.length + ' 項（假資料，未寫入任何表）',
    action: problems.join('；')
  };
}

/**
 * 測試 12：EmailTemplates 缺少 REMIND / OFFICIAL / RESEND 範本時，
 * findEmailTemplate_() 應回傳 null（讓呼叫端給出明確錯誤），而不是拋例外或崩潰。
 * @returns {{pass: boolean, detail: string, action: string}} 測試結果
 */
function testMissingTemplates_() {
  const stages = [MAIL_STAGES.GENERATE, MAIL_STAGES.REMIND, MAIL_STAGES.OFFICIAL, MAIL_STAGES.RESEND];
  const found = [];
  const missing = [];
  const problems = [];

  stages.forEach(function (stage) {
    let template;
    try {
      template = findEmailTemplate_(stage);
    } catch (err) {
      problems.push(stage + ' 查詢時拋出例外（應該回傳 null）：' + err.message);
      return;
    }
    if (template) {
      found.push(stage);
    } else {
      missing.push(stage);
    }
  });

  // 確認 sendStage 對缺失範本會給出明確錯誤訊息而非崩潰
  if (missing.length > 0) {
    try {
      sendStage(SELF_TEST_TARGET.QUARTER_ID, SELF_TEST_TARGET.VERSION_NO, missing[0]);
      problems.push(missing[0] + ' 沒有範本卻沒有報錯');
    } catch (err) {
      if (err.message.indexOf('找不到') === -1) {
        problems.push(missing[0] + ' 的錯誤訊息不夠明確：' + err.message);
      }
    }
  }

  return {
    pass: problems.length === 0,
    detail: '有範本：' + (found.join('、') || '無')
      + '；缺範本：' + (missing.join('、') || '無')
      + (missing.length > 0 ? '（缺失時會給出明確錯誤，不會崩潰）' : ''),
    action: problems.join('；')
      + (missing.length > 0
        ? '　→ 請在 EmailTemplates 補上 ' + missing.join('、') + ' 的範本（此項不影響 PASS）'
        : '')
  };
}

/**
 * 把自我測試結果寫入 SelfTest_Result 工作表（同名工作表會重建）。
 * @param {Object[]} results 測試結果陣列
 * @returns {string} 工作表名稱
 */
function writeSelfTestSheet_(results) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = SHEETS.SELF_TEST_RESULT;
  const existing = ss.getSheetByName(sheetName);
  if (existing) ss.deleteSheet(existing);
  const sheet = ss.insertSheet(sheetName);

  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  sheet.getRange(1, 1).setValue(
    '自我測試結果　執行時間：' + nowTimestamp_()
      + '　（本測試不寄電郵、不改資料表、不建立版本）'
  );

  const headers = ['項目', '結果', '說明', '建議動作'];
  sheet.getRange(2, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground(GRID_COLORS.HEADER);

  const rows = results.map(function (r) {
    return [r.name, r.result, r.detail, r.action];
  });
  sheet.getRange(3, 1, rows.length, headers.length).setValues(rows);

  const backgrounds = results.map(function (r) {
    const color = r.result === SELF_TEST_RESULT.PASS ? SELF_TEST_COLORS.PASS
      : (r.result === SELF_TEST_RESULT.ERROR ? SELF_TEST_COLORS.ERROR : SELF_TEST_COLORS.FAIL);
    return [color, color, null, null];
  });
  sheet.getRange(3, 1, backgrounds.length, headers.length).setBackgrounds(backgrounds);

  sheet.setColumnWidth(1, 220);
  sheet.setColumnWidth(2, 70);
  sheet.setColumnWidth(3, 520);
  sheet.setColumnWidth(4, 420);
  sheet.getRange(3, 3, rows.length, 2).setWrap(true);
  sheet.setFrozenRows(2);
  return sheetName;
}

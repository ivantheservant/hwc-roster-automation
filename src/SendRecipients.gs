/**
 * 第四十六輪批次 A／B 組：**收件人由幹事決定，唔係由階段決定。**
 *
 * ═════════════════════════════════════════════════════════════════════
 * 之前兩輪點解做錯咗
 * ═════════════════════════════════════════════════════════════════════
 *
 * 第四十一同第四十三輪都把需求理解成「喺現有嘅階段流程上加一個選人清單」
 * ——階段仍然由系統判斷（`REVIEW`／`OFFICIAL`／`RESEND`），
 * 而個清單只係喺**嗰個階段本來嘅收件範圍入面**再篩。
 *
 * Ivan 要嘅唔係噉。佢嘅原話：
 *
 *   > 這是用來寄給職事表上所有人、CC、DB、IT、admin 同自訂 email 的。
 *   > 所以我說它應該似「處理紙本」那個。
 *   > 因此「這一次是寄給堂委審閱」**這句描述也是錯的**。
 *
 * 所以呢個檔做嘅係：砌一個**同階段完全無關**嘅收件人池，
 * 由幹事自己勾。而 `listRecipients_()`（`Mailer.gs`）保持原狀——
 * 佢仍然係「自動流程／舊路」嘅收件範圍。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ Stage 冇拆走，只係唔再決定收件人
 * ─────────────────────────────────────────────────────────────────────
 *
 * 版本紀錄、`SendLog`、稽核、重發比對全部靠 Stage。所以 Stage 照樣判斷、
 * 照樣寫入 `SendLog` 同 `AuditLog`——只係**唔再攞嚟決定寄俾邊個**，
 * 亦都唔再喺彈窗頂當成「這一次是⋯⋯」講出嚟。
 */

/**
 * 收件人嘅來源。幹事可以任意組合。
 *
 * ⚠️ `IT` 同 `CLERK` 喺第四十六輪之前**唔存在**（`ROLE_CODES` 只有
 * `COMMITTEE` 同 `DEACON`）。呢一輪把佢哋加入 `ROLE_CODES`，
 * 所以佢哋同堂委／執事行**同一張 `Roles` 表、同一套生效期判斷**，
 * 冇任何一份寫死嘅名單。
 *
 * ⚠️ 加咗代號**唔等於**有人。冇人持有嗰個身分嘅時候，畫面要明講
 *「現時沒有人有這個身分」同埋去邊度加——唔可以靜靜當成幹事本人。
 */
const SEND_SOURCE = {
  ROSTER: 'ROSTER',
  COMMITTEE: 'COMMITTEE',
  DEACON: 'DEACON',
  IT: 'IT',
  CLERK: 'CLERK',
  CHANGED: 'CHANGED'
};

/** 六個來源嘅中文名同次序。畫面照呢個次序畫。 */
const SEND_SOURCE_LABELS = [
  { key: SEND_SOURCE.ROSTER, label: '職事表上全部人' },
  { key: SEND_SOURCE.COMMITTEE, label: '堂委' },
  { key: SEND_SOURCE.DEACON, label: '執事' },
  { key: SEND_SOURCE.IT, label: 'IT' },
  { key: SEND_SOURCE.CLERK, label: '幹事' },
  { key: SEND_SOURCE.CHANGED, label: '只寄給安排有改動的人' }
];

/**
 * 砌一個**同階段無關**嘅收件人池。
 *
 * 入面有三批人，去重之後合埋：
 *   一、呢一季有服侍嘅（`context.assignmentsByPerson`）
 *   二、任何一個現任身分持有人（堂委／執事／IT／幹事）——
 *       **就算佢呢一季一格都冇服侍**
 *   三、`EmailRecipients` 上面在職嘅地址（`LIST` 型）
 *
 * ⚠️ 第二批一定要有。一個堂委好可能呢一季一格都冇派工，
 * 而佢正正就係要收審閱本嗰個人。淨係列「有服侍嘅」就會漏咗佢，
 * 而幹事喺個名單度搵極都搵唔到。
 *
 * @param {Object} context `buildMailContext_()` 嘅結果
 * @param {string} timezone 時區
 * @returns {Object[]} 每筆 {key, type, personId, email, displayName, sendAs,
 *   cellCount, hasEmail, selectable, roles, sources}
 */
function buildSendRecipientPool_(context, timezone) {
  const today = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');
  const roles = readRolesSafe_(timezone);
  const rolesByPerson = {};
  roles.forEach(function (r) {
    if (!isEffectiveOn_(r.effectiveFrom, r.effectiveTo, today)) return;
    if (!rolesByPerson[r.personId]) rolesByPerson[r.personId] = [];
    if (rolesByPerson[r.personId].indexOf(r.roleCode) === -1) {
      rolesByPerson[r.personId].push(r.roleCode);
    }
  });

  const byKey = {};
  const order = [];
  const add = function (item) {
    if (byKey[item.key]) return byKey[item.key];
    byKey[item.key] = item;
    order.push(item.key);
    return item;
  };

  // ── 一、呢一季有服侍嘅 ─────────────────────────────────────
  Object.keys(context.assignmentsByPerson || {}).sort().forEach(function (personId) {
    const person = context.peopleById[personId];
    const email = person ? String(person.email || '').trim() : '';
    add({
      key: personId,
      type: RECIPIENT_TYPE.PERSON,
      personId: personId,
      email: email,
      displayName: person ? person.nameTC : personId,
      sendAs: SEND_AS.TO,
      cellCount: (context.assignmentsByPerson[personId] || []).length,
      hasEmail: !!email,
      selectable: !!email,
      roles: rolesByPerson[personId] || [],
      sources: [SEND_SOURCE.ROSTER]
    });
  });

  // ── 二、身分持有人（就算呢一季冇服侍）───────────────────────
  Object.keys(rolesByPerson).sort().forEach(function (personId) {
    const person = context.peopleById[personId];
    if (!person) return;   // `NameMapping` 查唔到 ⇒ 冇地址可寄，唔會列
    const email = String(person.email || '').trim();
    add({
      key: personId,
      type: RECIPIENT_TYPE.PERSON,
      personId: personId,
      email: email,
      displayName: person.nameTC || personId,
      sendAs: SEND_AS.TO,
      cellCount: (context.assignmentsByPerson[personId] || []).length,
      hasEmail: !!email,
      selectable: !!email,
      roles: rolesByPerson[personId],
      sources: []
    });
  });

  // ── 三、`EmailRecipients` ────────────────────────────────────
  const R = COLUMNS.EMAIL_RECIPIENTS;
  readSheet(SHEETS.EMAIL_RECIPIENTS).forEach(function (row) {
    if (!isTrueValue_(row[R.ACTIVE])) return;
    const email = String(row[R.EMAIL] || '').trim();
    if (!email) return;
    add({
      key: 'LIST:' + email.toLowerCase(),
      type: RECIPIENT_TYPE.LIST,
      personId: '',
      email: email,
      displayName: String(row[R.DISPLAY_NAME] || '').trim() || email,
      sendAs: String(row[R.SEND_AS] || SEND_AS.TO).toUpperCase(),
      cellCount: 0,
      hasEmail: true,
      selectable: true,
      roles: [],
      sources: []
    });
  });

  // ── 逐個標返佢屬於邊幾個來源 ────────────────────────────────
  //
  // ⚠️ 一個人可以同時屬於幾個（例如一個堂委今季又有服侍）。
  // 所以係一個陣列，唔係一個值。
  order.forEach(function (key) {
    const item = byKey[key];
    if (item.cellCount > 0 && item.sources.indexOf(SEND_SOURCE.ROSTER) === -1) {
      item.sources.push(SEND_SOURCE.ROSTER);
    }
    [SEND_SOURCE.COMMITTEE, SEND_SOURCE.DEACON, SEND_SOURCE.IT, SEND_SOURCE.CLERK]
      .forEach(function (code) {
        if (item.roles.indexOf(code) !== -1) item.sources.push(code);
      });
  });

  return order.map(function (key) { return byKey[key]; });
}

/**
 * `Mailer.gs` 用嘅版本：把池收窄成寄信要嘅幾個欄位。
 *
 * ⚠️ 形狀要同 `listRecipients_()` 一模一樣——下游
 *（`deliverOne_()`／`generateMailAttachment_()`）讀嘅就係嗰幾個欄位。
 * 多咗嘅欄位無害，少一個就會靜靜爆。
 *
 * @param {Object} context `buildMailContext_()` 嘅結果
 * @returns {Object[]} 收件人
 */
function listSendPoolRecipients_(context) {
  const timezone = context.timezone
    || getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  return buildSendRecipientPool_(context, timezone).map(function (item) {
    return {
      type: item.type,
      personId: item.personId,
      email: item.email,
      displayName: item.displayName,
      sendAs: item.sendAs
    };
  });
}

/**
 * 第四十六輪批次 A 組：寄信嗰陣真正用嘅收件人池。
 *
 * ⚠️ 只有「幹事自己勾咗」（`PICK`）嗰陣先至用全池。其餘一律行返
 * `listRecipients_()`——即係自動排程、補寄、彩排嗰幾條路完全冇變。
 *
 * 點解要噉分：`filterRecipientsByScope_()` 係喺一個**池**入面篩。
 * 池仍然係 `listRecipients_(stage, …)` 嘅話，幹事喺 REVIEW 揀一個義工，
 * 嗰個義工根本唔喺池入面，於是勾咗都唔會收到——而畫面會話「已選 12 位」。
 * 呢個就係「畫面講一件事、系統做另一件事」。
 *
 * @param {string} stage MAIL_STAGES 之一
 * @param {Object} context `buildMailContext_()` 嘅結果
 * @param {Object} decision `resolveSendOptions_()` 嘅結果
 * @returns {Object[]} 收件人池
 */
function resolveSendRecipientPool_(stage, context, decision) {
  if (decision && decision.recipientScope === SEND_RECIPIENT_SCOPE.PICK) {
    return listSendPoolRecipients_(context);
  }
  return listRecipients_(stage, context);
}

/* ═════════════════════════════════════════════════════════════════════
 * B 組：寄出紀錄　＋　「有改動」係相對邊一版
 * ═════════════════════════════════════════════════════════════════════ */

/**
 * 這一季寄過幾次、每次寄咗邊一版、幾多位。
 *
 * ⚠️ 資料來源係 `SendLog`，**唔另開一張表**。同一次寄送會有幾十行
 *（逐個收件人一行），所以按「階段 ＋ 版本 ＋ 分鐘」歸成一批。
 *
 * ⚠️ 用分鐘做界線係一個近似——一次寄送可能橫跨幾分鐘。
 * 寧可把一次拆成兩行（幹事睇得出係同一件事），
 * 都好過把兩次不同嘅寄送併埋一行（嗰個會令佢以為只寄過一次）。
 *
 * @param {string} quarterId 季度 ID
 * @returns {Object[]} 每筆 {stage, versionNo, sentAt, total, sent, noEmail, failed}
 */
function listSendHistory_(quarterId) {
  const C = COLUMNS.SEND_LOG;
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const byBatch = {};
  const order = [];

  readSheet(SHEETS.SEND_LOG).forEach(function (row) {
    if (String(row[C.QUARTER_ID] || '').trim() !== quarterId) return;
    const stage = String(row[C.STAGE] || '').trim();
    const versionNo = Number(row[C.VERSION_NO]);
    const sentAtRaw = row[C.SENT_AT];
    const stamp = sentAtRaw
      ? Utilities.formatDate(new Date(sentAtRaw), timezone, 'yyyy-MM-dd HH:mm') : '';
    const key = stage + '|' + versionNo + '|' + stamp;
    if (!byBatch[key]) {
      byBatch[key] = {
        stage: stage,
        versionNo: isNaN(versionNo) ? null : versionNo,
        sentAt: stamp,
        total: 0, sent: 0, noEmail: 0, failed: 0
      };
      order.push(key);
    }
    const b = byBatch[key];
    b.total++;
    const status = String(row[C.STATUS] || '').trim().toUpperCase();
    if (status === MAIL_STATUS.SENT || status === MAIL_STATUS.DRY_RUN) b.sent++;
    else if (status === MAIL_STATUS.SKIPPED_NO_EMAIL) b.noEmail++;
    else b.failed++;
  });

  return order.map(function (k) { return byBatch[k]; })
    .sort(function (a, b) { return a.sentAt < b.sentAt ? -1 : (a.sentAt > b.sentAt ? 1 : 0); });
}

/**
 * 最近一次真正寄出過嘅版本。
 *
 * ⚠️ 「有改動」一定要講**相對邊一版**。唔講嘅話，幹事根本無從判斷
 * 「有 4 位改過」係指乜——係相對佢啱啱儲存嗰一版？相對上一次寄嗰版？
 * 兩者可以差好遠。
 *
 * @param {string} quarterId 季度 ID
 * @returns {?Object} {versionNo, stage, sentAt, total}；從來未寄過回 null
 */
function findLastSentSnapshot_(quarterId) {
  const history = listSendHistory_(quarterId).filter(function (b) {
    return b.versionNo !== null && b.sent > 0;
  });
  if (history.length === 0) return null;
  return history[history.length - 1];
}

/**
 * 由 `fromVersionNo` 到 `toVersionNo`，邊幾位嘅安排改過、改咗乜。
 *
 * ⚠️ 逐個人講**改咗乜**，唔淨係俾一個名單。Ivan 要求嘅係
 *「7 月 11 日　主席（新增）」呢種——一個淨係寫住名嘅名單，
 * 幹事核對唔到，於是佢唯一做得到嘅就係照撳。
 *
 * @param {string} quarterId 季度 ID
 * @param {number} fromVersionNo 由邊一版
 * @param {number} toVersionNo 到邊一版
 * @returns {Object.<string, string[]>} personId → 改動描述
 */
function listChangedPersonsBetweenVersions_(quarterId, fromVersionNo, toVersionNo) {
  const out = {};
  if (fromVersionNo === null || fromVersionNo === undefined) return out;
  if (Number(fromVersionNo) === Number(toVersionNo)) return out;

  const postNames = readPostNameMap_();
  const nameById = indexPeopleById_();
  const push = function (personId, text) {
    if (!personId) return;
    if (!out[personId]) out[personId] = [];
    if (out[personId].indexOf(text) === -1) out[personId].push(text);
  };

  diffVersionAssignments_(quarterId, fromVersionNo, toVersionNo).forEach(function (d) {
    const postName = postNames[d.postId] || d.postId;
    const where = formatServiceDateForOperator_(d.serviceDate) + '　' + postName
      + (Number(d.slotIndex) > 1 ? (' ' + d.slotIndex) : '');
    const fromName = d.fromPersonId
      ? ((nameById[d.fromPersonId] || {}).nameTC || d.fromPersonId) : '';
    const toName = d.toPersonId
      ? ((nameById[d.toPersonId] || {}).nameTC || d.toPersonId) : '';

    if (d.fromPersonId && d.toPersonId) {
      push(d.fromPersonId, where + '（換走了，改為 ' + toName + '）');
      push(d.toPersonId, where + '（新增，本來是 ' + fromName + '）');
    } else if (d.toPersonId) {
      push(d.toPersonId, where + '（新增）');
    } else if (d.fromPersonId) {
      push(d.fromPersonId, where + '（拿走了）');
    }
  });
  return out;
}

/**
 * 日期寫成幹事讀得順嘅樣（「7 月 11 日」）。
 * @param {string} dateStr yyyy-MM-dd
 * @returns {string} 中文日期
 */
function formatServiceDateForOperator_(dateStr) {
  const s = String(dateStr || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return Number(s.slice(5, 7)) + ' 月 ' + Number(s.slice(8, 10)) + ' 日';
}

/**
 * PostID → 崗位中文名。
 * @returns {Object.<string, string>} 對照表
 */
function readPostNameMap_() {
  const map = {};
  readPostsNormalized().forEach(function (p) { map[p.postId] = p.postNameTC; });
  return map;
}

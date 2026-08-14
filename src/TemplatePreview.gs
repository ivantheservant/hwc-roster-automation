/**
 * 「預覽電郵範本」：唯讀工具，用跟實際寄送完全相同的 placeholder 代入邏輯
 * （`buildMailContext_()`／`listRecipients_()`／`applyPlaceholders_()`，全部是
 * Mailer.gs 既有、寄送與這裡共用的純函式，沒有另外複製一份平行邏輯），
 * 產生代入後的 Subject 與 BodyPlain 供人手核對，方便測試時檢查 placeholder
 * 有沒有正確代入，不需要真的寄一封信出去才能看到結果。
 *
 * 完全不寄電郵、不改 Stage、不寫 SendLog、不產生 PDF、不改任何工作表——
 * 只呼叫 buildMailContext_()／findEmailTemplate_()／listRecipients_()（三者本身
 * 都只讀，沒有副作用）與純字串代入函式 applyPlaceholders_()。
 *
 * ⚠️ 額外的結構性防護（PREVIEW_MODE_ACTIVE）：previewEmailTemplate_() 執行期間
 * 會把這個旗標設為 true，sendStage()／sendRealEmail_()（Mailer.gs）開頭都會檢查
 * 這個旗標，一旦偵測到就立即拋錯中止，不會往下執行。這是「就算日後不小心讓預覽
 * 函式走到寄送函式，也會在第一時間被攔下」的防線，跟現有 sendRealEmail_() 自己
 * 再檢查一次 DRY_RUN 的雙重防呆是同一種做法。
 */

/**
 * 預覽模式旗標。只在 previewEmailTemplate_() 執行期間為 true，執行完畢
 * （包括拋例外的情況）一定會在 finally 重設回 false。
 * @type {boolean}
 */
let PREVIEW_MODE_ACTIVE = false;

/**
 * 檢查目前是否處於預覽模式，是的話立即拋錯。供 sendStage()／sendRealEmail_()
 * 等實際寄送／寫入的函式在開頭呼叫，作為結構性防護。
 * @param {string} functionName 呼叫端的函式名稱，用於錯誤訊息
 * @returns {void}
 */
function assertNotPreviewMode_(functionName) {
  if (PREVIEW_MODE_ACTIVE) {
    throw new Error(
      '安全防護：' + functionName + ' 在預覽模式下被呼叫，這不應該發生——'
        + '「預覽電郵範本」不可以觸發任何實際寄送或寫入邏輯，已中止執行。'
        + '這代表程式邏輯有誤，請回報這個錯誤訊息。'
    );
  }
}

/**
 * 判斷一個範本是不是「個人化」範本——即內容會因收件人是誰而不同。
 * 追加階段 Y：用來決定預覽應該揀 PERSON 收件人還是隨便揀第一個。
 *
 * 兩種判斷方式，任一成立即算個人化：
 * 1. AttachType 是 PERSONAL_PDF（附件本身就是個人版）
 * 2. 範本文字含有因人而異的變數
 *
 * 注意 `{ServiceList}`：程式碼實際會代入的是 `{AssignmentSummary}`
 * （見 Mailer.gs 的 applyPlaceholders_()），`{ServiceList}` 全專案沒有任何
 * 代入邏輯。這裡仍然把它列入偵測，是因為實際的 EmailTemplates 工作表上有範本
 * 用了這個名稱——偵測到它代表「這是個人化範本」的意圖成立，預覽應該揀 PERSON
 * 收件人；至於它代不進去這件事，會由 findUnresolvedPlaceholders_() 明確標示成
 * 「未代入變數」，不會被這裡的偵測掩蓋。
 *
 * @param {Object} template findEmailTemplate_() 的結果
 * @returns {boolean} 是否為個人化範本
 */
function isPersonalizedTemplate_(template) {
  if (String(template.attachType || '').toUpperCase() === ATTACH_TYPE.PERSONAL_PDF) return true;

  const text = [template.subject, template.bodyHtml, template.bodyPlain].join('\n');
  return ['{PersonName}', '{ServiceList}', '{AssignmentSummary}'].some(function (marker) {
    return text.indexOf(marker) !== -1;
  });
}

/**
 * 產生指定季度／版本／階段的範本預覽。
 * @param {string} quarterId 季度 ID
 * @param {number} versionNo 版本號
 * @param {string} stage 寄送階段（不限於既有四個，任何 EmailTemplates 有的 Stage 都可以）
 * @returns {{stage: string, templateId: string, attachType: string,
 *   recipientDisplayName: string, subject: string, bodyPlain: string,
 *   unresolved: string[], personalized: boolean, notice: string}} 預覽結果；
 *   unresolved 為代入後仍殘留的 {變數} 標記；notice 為需要讓使用者知道的重要提示
 *   （例如個人化範本但這一版找不到任何有服侍安排的人），空字串代表沒有提示
 */
function previewEmailTemplate_(quarterId, versionNo, stage) {
  PREVIEW_MODE_ACTIVE = true;
  try {
    const template = findEmailTemplate_(stage);
    if (!template) throw new Error('EmailTemplates 中找不到 Stage=' + stage + ' 的範本');

    const context = buildMailContext_(quarterId, versionNo, stage);
    const recipients = listRecipients_(stage, context);
    const personalized = isPersonalizedTemplate_(template);

    // 追加階段 Y：個人化範本一定要揀「真的有服侍安排的 PERSON 收件人」來預覽。
    // 原本一律揀 recipients[0]，而 listRecipients_() 是先加 EmailRecipients 的 LIST
    // 收件人、之後才加 PERSON 收件人，所以 OFFICIAL／RESEND 這種個人化階段永遠會
    // 揀到名單上的第一個 LIST 收件人（例如「教會辦公室」）——那個收件人沒有 PersonID、
    // 沒有服侍安排，預覽出來的 {PersonName}／{AssignmentSummary} 全部是空的或原文，
    // 完全看不出真正寄給義工的信會長成什麼樣，失去預覽的意義。
    let recipient = null;
    let notice = '';

    if (personalized) {
      const withAssignments = recipients.filter(function (r) {
        return r.type === RECIPIENT_TYPE.PERSON
          && (context.assignmentsByPerson[r.personId] || []).length > 0;
      });
      if (withAssignments.length > 0) {
        recipient = withAssignments[0];
      } else {
        // 明確講清楚，不要靜靜揀個 LIST 收件人頂上，令人以為預覽結果就是義工會收到的樣子
        notice = '此版本沒有任何有服侍安排的收件人。'
          + '這是個人化範本（會因收件人而不同），但 ' + quarterId + ' v' + versionNo
          + ' 在 RosterAssignments 找不到任何派工紀錄，所以沒有 PERSON 收件人可以預覽。'
          + '下面顯示的是未代入個人資料的範本原文，不代表義工實際會收到的內容。';
      }
    }

    if (!recipient) {
      recipient = recipients.length > 0 && !personalized ? recipients[0] : {
        type: 'PREVIEW',
        personId: '',
        email: '',
        displayName: personalized
          ? '（沒有符合條件的 PERSON 收件人）'
          : '（範例收件人——目前沒有符合這個 Stage 的實際收件人）',
        sendAs: SEND_AS.TO
      };
    }

    const personAssignments = recipient.personId ? (context.assignmentsByPerson[recipient.personId] || []) : [];
    const summary = buildAssignmentSummary_(personAssignments, context.postNames, context.timezone);

    // 跟 deliverOne_()（Mailer.gs）組 subject/body 的方式完全一致，同一個函式、同一種組法
    const subject = context.subjectPrefix + applyPlaceholders_(template.subject, context.placeholders, recipient, summary);
    const bodyPlain = applyPlaceholders_(template.bodyPlain, context.placeholders, recipient, summary);

    const unresolved = findUnresolvedPlaceholders_(subject + '\n' + bodyPlain);

    return {
      stage: stage,
      templateId: template.templateId,
      attachType: template.attachType,
      recipientDisplayName: recipient.displayName,
      subject: subject,
      bodyPlain: bodyPlain,
      unresolved: unresolved,
      personalized: personalized,
      notice: notice
    };
  } finally {
    PREVIEW_MODE_ACTIVE = false;
  }
}

/**
 * 掃描文字中殘留、未被代入的 {變數} 標記（例如打錯字的 {QuarterId}，
 * 或範本用了 context.placeholders／{PersonName}／{AssignmentSummary} 以外的變數）。
 * @param {string} text 代入後的文字
 * @returns {string[]} 找到的殘留標記（含大括號），依出現順序去重
 */
function findUnresolvedPlaceholders_(text) {
  const matches = String(text || '').match(/\{[^{}]+\}/g) || [];
  const seen = {};
  const result = [];
  matches.forEach(function (m) {
    if (seen[m]) return;
    seen[m] = true;
    result.push(m);
  });
  return result;
}

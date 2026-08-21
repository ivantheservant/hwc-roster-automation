/**
 * 第四十輪批次 D 組：**「認不出的名字」那一粒〔立即加入這個人〕。**
 *
 * ═════════════════════════════════════════════════════════════════════
 * 拍板：維持硬擋，但補一個出口
 * ═════════════════════════════════════════════════════════════════════
 *
 * 幹事在職事表打了一個不在名單上的名，撳「儲存我的修改」會被整批擋住，
 * 而且**沒有**〔照樣儲存〕。他問過為什麼。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 為什麼不加〔照樣儲存〕
 * ─────────────────────────────────────────────────────────────────────
 *
 * 一個系統認不出的名字**沒有 `PersonID`**。所以那一格：
 *
 *   ・他收不到電郵（收件名單是按 PersonID 砌的）
 *   ・沒有個人 PDF（檔名同內容都靠 PersonID）
 *   ・不會被計入服侍次數（統計、平衡、上限全部按 PersonID）
 *   ・不會被任何規則檢查覆蓋（資格、連續兩週、身分限制全部按 PersonID）
 *
 * 即是說：儲存了之後，那一格對那個人**完全沒有作用，而且沒有任何錯誤**。
 * 職事表上看得見他的名字，系統裡面他不存在。
 *
 * 這正正是這幾輪一直在殺的那一個 bug class——**缺失被當成正常值**。
 * 加一粒〔照樣儲存〕等於在系統裡面開一道門，讓那一類狀態合法地產生。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 但幹事的需要是真實的
 * ─────────────────────────────────────────────────────────────────────
 *
 * 借調、外請、新人未入名單——這些都會發生。叫他「去試算表新增」
 * 等於中斷手上的工作再走一轉，而且回來之後要重新再撳一次儲存。
 *
 * 所以加這一粒：在同一個對話框把人加入去，順帶問一句要不要同時
 * 讓他做那個崗位，然後**自動重新檢查**——那一項應該即刻消失。
 *
 * ⚠️ 講員／翻譯／獻花本來就是自由文字（`AutoGenerate = FALSE`），
 * 不受這條限制，也不會出現在這個清單裡面。見 `buildGridOverlayState_()`。
 */

/**
 * 供前端呼叫：把一個認不出的名字加入 `NameMapping`，
 * 順帶（可選）讓他可以做那一個崗位。**會寫入。**
 *
 * ⚠️ 這一個函式**沒有自己一套新增邏輯**——它叫 `apiAddPerson()` 同
 * `apiSaveEligibilityBatch()`，即是區三那兩個畫面用的同一條路。
 * 另起爐灶就會變成「同一件事有兩個做法」，而其中一個一定會落後。
 *
 * @param {Object} payload {nameTC, nameEN, email, postId, alsoEligible}
 * @returns {Object} {ok, personId, message, duplicateWarning, eligibilityAdded}
 */
function apiAddPersonForUnresolvedName(payload) {
  assertWebAppRequestAllowed_();
  const p = payload || {};
  const nameTC = String(p.nameTC || '').trim();
  if (!nameTC) {
    return { ok: false, message: buildThreePartMessage_(
      '中文名不可以留空。', '什麼都沒有加入。', ['填寫中文名再試一次']) };
  }

  // ── 一、加人（用返區三那一條路）──────────────────────────────
  const added = apiAddPerson({
    nameTC: nameTC,
    nameEN: String(p.nameEN || '').trim(),
    email: String(p.email || '').trim(),
    memberNo: ''
  });
  if (!added.ok) return added;

  // ── 二、（可選）讓他可以做那一個崗位 ─────────────────────────
  //
  // 預設勾選是刻意的：他既然被排在那一格，多數就是要做那個崗位。
  // 但仍然是一個選擇——借調一次而不打算長期做，就不應該進資格名單。
  const postId = String(p.postId || '').trim();
  let eligibilityAdded = 0;
  if (postId && p.alsoEligible !== false) {
    const r = apiSaveEligibilityBatch([{
      personId: added.personId, postId: postId, eligible: true
    }]);
    eligibilityAdded = (r && r.added) || 0;
  }

  // ⚠️ 沒有電郵是合法的（現時就有幾位沒有），但一定要講——
  // 不講的話幹事會以為加完就萬事俱備，然後那個人一直收不到信而沒有人知道。
  const noEmailNote = String(p.email || '').trim()
    ? ''
    : '這一位沒有填電郵，所以他收不到信。記得在第 5 步印紙本給他。';

  return {
    ok: true,
    personId: added.personId,
    duplicateWarning: added.duplicateWarning || '',
    eligibilityAdded: eligibilityAdded,
    noEmailNote: noEmailNote,
    message: '已經加入「' + nameTC + '」（' + added.personId + '）。'
      + (eligibilityAdded > 0 ? '而且他現在可以做那一個崗位。' : '')
  };
}

/**
 * 第二十七輪批次階段 F：區四——把七個幹事真係會用嘅工具搬上 Web。
 *
 * 對應 `docs/幹事介面規格.md` 第五節。
 *
 * ─────────────────────────────────────────────────────────────────────
 * ⚠️ 點解只搬七個，唔係全部八十幾個選單項目
 * ─────────────────────────────────────────────────────────────────────
 *
 * 其餘嗰批係診斷／維護工具（體檢、參數掃描、上線前檢查、補建欄位…），
 * 使用者係 Ivan 或者 IT，唔係幹事。搬上嚟只會令幹事喺一堆佢一世都唔會
 * 撳嘅嘢入面搵佢真正要撳嗰粒——而「搵唔到」同「撳錯」兩樣都會出事。
 *
 * 留喺選單亦有另一個好處：選單版係**安全網**。Web 介面爆咗嘅時候
 * （例如上一輪嗰個 HtmlService 樣板 bug 令整個介面開唔到），
 * 選單仍然行得。所以本輪**一行都唔改選單版嘅行為**。
 *
 * ─────────────────────────────────────────────────────────────────────
 * 「算」同「顯示」拆開
 * ─────────────────────────────────────────────────────────────────────
 *
 * 選單版嘅 `run*_()` 全部會叫 `ui.alert()`。喺 Web App 環境冇 Sheets UI，
 * 一叫就會爆。所以呢個檔案**唔會呼叫任何 `run*_()`**，只叫佢哋裡面
 * 嗰啲純運算函式（`exportRosterPdf()`／`generatePersonalPdfBatch_()`／
 * `listPendingBackfillCells_()`／`planMakeupSend_()` …）。
 *
 * 呢啲純運算函式本來就已經拆好咗（歷史上為咗寫離線測試而拆），
 * 所以本輪唔使改佢哋，只係多一個呼叫端。
 */

/**
 * 區四共用：版本下拉。**一律寫人話。**
 *
 * ⚠️ 唔可以寫 `Roster_2026T4_v2`——嗰個係工作表名，唔係幹事嘅語言。
 * 寫成「第 2 版　2026-12-04 11:20　套用修改申報後」，佢先揀得啱。
 *
 * @param {string} quarterId
 * @returns {Object} {ok, versions:[{versionNo, label}], message}
 */
function apiListVersionsForZone4(quarterId) {
  assertWebAppRequestAllowed_();
  const V = COLUMNS.ROSTER_VERSIONS;
  const timezone = getConfig(CONFIG_KEYS.SYS_TIMEZONE, DEFAULTS.TIMEZONE);
  const id = String(quarterId || '').trim();
  if (!id) {
    return { ok: false, versions: [], message: '還沒有選季度。' };
  }

  try {
    const versions = readSheet(SHEETS.ROSTER_VERSIONS)
      .filter(function (v) { return String(v[V.QUARTER_ID] || '').trim() === id; })
      .map(function (v) {
        const no = Number(v[V.VERSION_NO]);
        const createdAt = normalizeSentAt_(v[V.CREATED_AT], timezone);
        // 內部代號（DRAFT／REQUESTS_APPLIED…）唔可以出現喺畫面上。
        // 翻譯表同狀態卡共用，唔會兩邊各有一套。
        const basisText = buildVersionBasisText_(v[V.BASIS]);
        return {
          versionNo: no,
          label: '第 ' + no + ' 版　' + (createdAt.text || '（沒有時間紀錄）')
            + (basisText ? '　' + basisText : '')
        };
      })
      .sort(function (a, b) { return b.versionNo - a.versionNo; });
    return { ok: true, versions: versions, message: '' };
  } catch (err) {
    return {
      ok: false,
      versions: [],
      message: buildThreePartMessage_(
        '讀不到版本清單（' + err.message + '）。', '什麼都沒有改動。',
        ['重新整理這一頁再試一次'])
    };
  }
}

/**
 * 區四共用：把一份報告包成「一節一節」供畫面顯示。
 * @param {Array<{heading: string, lines: string[]}>} sections
 * @returns {Object}
 */
function zone4Report_(sections) {
  return { ok: true, sections: sections };
}

/** 區四共用：把 exception 包成三段式失敗回傳。 */
function zone4Failure_(what, err, actions) {
  log_('ERROR', '區四工具失敗（' + what + '）：' + err.message);
  return {
    ok: false,
    message: buildThreePartMessage_(
      what + '失敗（' + err.message + '）。',
      '什麼都沒有改動，沒有寄出任何電郵。',
      actions || ['重新整理這一頁再試一次',
        '如果一直失敗，用試算表上方的選單做同一件事——那邊是安全網'])
  };
}

/* ============================================================
 * 核對職事表（唯讀）
 * ============================================================ */

/**
 * @param {string} quarterId
 * @param {number} versionNo
 * @returns {Object}
 */
function apiVerifyRosterForZone4(quarterId, versionNo) {
  assertWebAppRequestAllowed_();
  try {
    // 完全重用既有嘅 apiVerifyRoster()，唔另寫一次核對邏輯。
    const result = apiVerifyRoster(quarterId, Number(versionNo));
    const s = result.summary;
    return zone4Report_([
      {
        heading: '摘要',
        lines: [
          '違反「一定要遵守」的規則：' + s.hardViolationCount + ' 項',
          '同崗位連續兩週：' + s.adjacentRepeats + ' 項',
          '有服侍的人數：' + s.peopleCount + ' 人',
          '平均每人：' + Number(s.average).toFixed(1) + ' 次　最多的一位：' + s.maxCount + ' 次'
        ]
      },
      {
        heading: '逐項明細（' + result.rows.length + ' 項）',
        lines: result.rows.map(function (r) {
          return Object.keys(r).map(function (k) {
            return displayCellValue_(r[k], '');
          }).filter(function (t) { return t !== ''; }).join('　');
        })
      }
    ]);
  } catch (err) {
    return zone4Failure_('核對職事表', err);
  }
}

/* ============================================================
 * 列出待補格子（唯讀）
 * ============================================================ */

/**
 * ⚠️ 唔收版本號：待補格子問嘅係「而家仲有邊幾格未填」，
 * 而「而家」永遠係最新版本。叫幹事揀版本只會令佢揀錯一個舊版本，
 * 然後對住一份同現況無關嘅清單去填格。
 * @param {string} quarterId
 * @returns {Object}
 */
function apiListPendingBackfillCellsForZone4(quarterId) {
  assertWebAppRequestAllowed_();
  try {
    const id = String(quarterId || '').trim();
    const versionNo = findLatestVersionNo(id);
    if (versionNo < 0) {
      return zone4Report_([{
        heading: '待補格子',
        lines: ['這一季還沒有生成過任何版本，所以沒有格子可以填。']
      }]);
    }
    const cells = listPendingBackfillCells_(id, versionNo);
    if (cells.length === 0) {
      return zone4Report_([{
        heading: '第 ' + versionNo + ' 版：沒有待補格子',
        lines: ['全部格子都有人了。']
      }]);
    }
    return zone4Report_([{
      heading: '第 ' + versionNo + ' 版　共 ' + cells.length + ' 格待補',
      lines: cells.map(function (c) {
        return c.serviceDate + '　' + c.key + '　' + c.note;
      })
    }]);
  } catch (err) {
    return zone4Failure_('列出待補格子', err);
  }
}

/* ============================================================
 * 草稿覆核報告（給堂委看）
 * ============================================================ */

/**
 * @param {string} quarterId
 * @param {number} versionNo
 * @returns {Object}
 */
function apiDraftReviewReportForZone4(quarterId, versionNo) {
  assertWebAppRequestAllowed_();
  try {
    const id = String(quarterId || '').trim();
    const no = Number(versionNo);
    // 量度完全重用軟規則量度工具，唔會另外再計一次
    // ——兩份報告嘅數字永遠一致。
    const metrics = measureSoftRuleMetrics_(id, no);
    const blank = countCellClassesFromAssignments_(id, no);
    const rows = buildDraftReviewRows_(metrics, blank);

    const bySection = {};
    const order = [];
    rows.forEach(function (r) {
      const section = displayCellValue_(r[COLUMNS.DIAGNOSTICS.SECTION], '（其他）');
      if (!bySection[section]) { bySection[section] = []; order.push(section); }
      const item = displayCellValue_(r[COLUMNS.DIAGNOSTICS.ITEM], '');
      const value = displayCellValue_(r[COLUMNS.DIAGNOSTICS.VALUE], '');
      const note = displayCellValue_(r[COLUMNS.DIAGNOSTICS.NOTE], '');
      bySection[section].push([item, value, note].filter(function (t) {
        return t !== '';
      }).join('　'));
    });

    return zone4Report_(order.map(function (section) {
      return { heading: section, lines: bySection[section] };
    }));
  } catch (err) {
    return zone4Failure_('草稿覆核報告', err);
  }
}

/* ============================================================
 * 匯出職事表 PDF
 * ============================================================ */

/**
 * @param {string} quarterId
 * @param {number} versionNo
 * @returns {Object}
 */
function apiExportRosterPdf(quarterId, versionNo) {
  assertWebAppRequestAllowed_();
  try {
    const result = exportRosterPdf(String(quarterId || '').trim(), Number(versionNo));

    // ⚠️ `exportRosterPdf()` 只回 {fileId, fileName, folderName}。
    // 檔案大細同連結要自己由 Drive 攞——**唔可以喺呢度砌一個
    // `result.fileSize || 0` 出嚟**，嗰個永遠會印「0 B」，
    // 而「0 B」睇落就係一個真實嘅（而且好嚇人嘅）數字。
    //
    // 檔案大細係一個好有用嘅健康訊號：截斷／空白檔會細得好離譜。
    // 攞唔到就誠實講「查不到」，唔會扮到查過。
    let fileSize = '（查不到檔案大小）';
    let fileUrl = '';
    try {
      const file = DriveApp.getFileById(result.fileId);
      fileSize = formatFileSize_(file.getSize());
      fileUrl = file.getUrl();
    } catch (err) {
      log_('WARN', '匯出後讀不到檔案資訊：' + err.message);
    }

    return {
      ok: true,
      fileName: result.fileName,
      folderName: result.folderName,
      fileSize: fileSize,
      fileUrl: fileUrl
    };
  } catch (err) {
    return zone4Failure_('匯出職事表 PDF', err);
  }
}

/* ============================================================
 * 產生個人 PDF（分批）
 * ============================================================ */

/**
 * 一次執行只處理一批（`PDF_BATCH_SIZE`），`done=false` 就要再叫一次。
 * 前端有一個 for 迴圈負責接住跑，同掣 4 嗰邊同一個做法。
 * @param {string} quarterId
 * @param {number} versionNo
 * @returns {Object}
 */
function apiGeneratePersonalPdfBatch(quarterId, versionNo) {
  assertWebAppRequestAllowed_();
  try {
    const result = generatePersonalPdfBatch_(String(quarterId || '').trim(), Number(versionNo));
    return {
      ok: true,
      done: !!result.done,
      doneCount: result.doneCount,
      totalPeople: result.totalPeople,
      generatedCount: result.generatedCount,
      // 「略過已存在」唔算問題，但一定要出數字——唔出嘅話，
      // 幹事會以為「明明有 57 人，點解只產生咗 3 個」。
      skippedExistingCount: result.skippedExistingCount,
      totalRetries: result.totalRetries || 0
    };
  } catch (err) {
    return zone4Failure_('產生個人 PDF', err);
  }
}

/* ============================================================
 * 補寄未收到的人
 * ============================================================ */

/**
 * 有邊幾個階段補寄得。**只列真係寄過嘅階段**——
 * 列一個從來未寄過嘅階段出嚟，幹事揀咗之後只會見到「全部人都收到咗」，
 * 而嗰個講法係錯嘅（根本一封都未寄過）。
 * @param {string} quarterId
 * @returns {Object}
 */
function apiMakeupSendStages(quarterId) {
  assertWebAppRequestAllowed_();
  try {
    const id = String(quarterId || '').trim();
    const versionNo = findLatestVersionNo(id);
    if (versionNo < 0) {
      return { ok: true, stages: [], message: '' };
    }
    const S = COLUMNS.SEND_LOG;
    const sent = {};
    readSheet(SHEETS.SEND_LOG).forEach(function (row) {
      if (String(row[S.QUARTER_ID] || '').trim() !== id) return;
      sent[String(row[S.STAGE] || '').trim()] = true;
    });

    const labels = {};
    labels[MAIL_STAGES.REVIEW] = '寄給堂委審閱';
    labels[MAIL_STAGES.OFFICIAL] = '正式發出給全體';

    const stages = MAKEUP_SUPPORTED_STAGES
      .filter(function (stage) { return sent[stage]; })
      .map(function (stage) {
        return { stage: stage, label: labels[stage] || stage };
      });
    return { ok: true, stages: stages, versionNo: versionNo, message: '' };
  } catch (err) {
    return zone4Failure_('讀取可補寄的階段', err);
  }
}

/**
 * 補寄預覽。**純讀取。**
 * @param {string} quarterId
 * @param {string} stage
 * @returns {Object}
 */
function apiMakeupSendPlan(quarterId, stage) {
  assertWebAppRequestAllowed_();
  try {
    const id = String(quarterId || '').trim();
    const versionNo = findLatestVersionNo(id);
    if (versionNo < 0) {
      return { ok: false, message: '這一季還沒有生成過任何版本。' };
    }
    const plan = planMakeupSend_(id, versionNo, String(stage || '').trim());
    return {
      ok: true,
      stage: plan.stage,
      versionNo: plan.versionNo,
      isDryRun: plan.isDryRun,
      people: plan.needsResend.map(function (r) {
        return {
          nameTC: r.displayName || r.personId || r.email,
          hasEmail: !!String(r.email || '').trim(),
          lastStatus: r.lastStatus,
          reason: r.reason
        };
      }),
      alreadySentCount: plan.alreadySent.length,
      cannotSendCount: plan.cannotSend.length
    };
  } catch (err) {
    return zone4Failure_('比對誰未收到', err);
  }
}

/**
 * 補寄執行。**會真正寄信。**
 *
 * ⚠️ 後端**自己重新算一次計畫**，唔信前端傳返嚟嗰份——
 * 前端嗰份係幾分鐘前算嘅，期間可能已經有人收到咗。
 * @param {string} quarterId
 * @param {string} stage
 * @returns {Object}
 */
function apiMakeupSendExecute(quarterId, stage) {
  assertWebAppRequestAllowed_();
  try {
    const id = String(quarterId || '').trim();
    const versionNo = findLatestVersionNo(id);
    if (versionNo < 0) {
      return { ok: false, message: '這一季還沒有生成過任何版本。' };
    }
    const plan = planMakeupSend_(id, versionNo, String(stage || '').trim());
    if (plan.needsResend.length === 0) {
      return {
        ok: false,
        message: buildThreePartMessage_(
          '這一次所有人都已經收到了。', '沒有寄出任何電郵。',
          ['如果內容改過而想重發，請用區一的「改動後重發」'])
      };
    }
    const result = executeMakeupSend_(plan);
    return {
      ok: true,
      isDryRun: plan.isDryRun,
      sent: result.sent,
      dryRun: result.dryRun,
      skipped: result.skipped,
      failed: result.failed
    };
  } catch (err) {
    return zone4Failure_('補寄未收到的人', err);
  }
}

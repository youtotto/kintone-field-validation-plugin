(async function () {
  'use strict';

  const PLUGIN_ID = kintone.$PLUGIN_ID;

  function loadConfig() {
    const conf = kintone.plugin.app.getConfig(PLUGIN_ID) || {};
    return {
      rules: safeJsonParse(conf.rulesJson, [])
    };
  }

  function safeJsonParse(str, fallback) {
    try {
      return str ? JSON.parse(str) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function isEmpty(val) {
    if (val === null || val === undefined) return true;
    if (Array.isArray(val)) return val.length === 0;
    return String(val).trim() === '';
  }

  function parseCsv(str) {
    if (!str) return [];
    return String(str)
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  }

  function toArray(val) {
    if (Array.isArray(val)) return val.map(v => String(v));
    if (val === null || val === undefined || val === '') return [];
    return [String(val)];
  }

  function toSafeNumber(value) {
    if (value === null || value === undefined || value === '') return null;

    const normalized = String(value)
      .replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
      .replace(/,/g, '')
      .trim();

    if (normalized === '') return null;

    const num = Number(normalized);
    return Number.isFinite(num) ? num : null;
  }

  function getFieldValue(record, code) {
    return record[code]?.value;
  }

  function normalizeDateOnly(value) {
    if (!value) return null;

    const s = String(value);

    // DATE: 2026-05-14
    // DATETIME: 2026-05-14T01:00:00Z
    const match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;

    const y = Number(match[1]);
    const m = Number(match[2]);
    const d = Number(match[3]);

    const date = new Date(y, m - 1, d);
    date.setHours(0, 0, 0, 0);

    return Number.isNaN(date.getTime()) ? null : date;
  }

  function addDays(date, days) {
    const d = new Date(date.getTime());
    d.setDate(d.getDate() + Number(days || 0));
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function parseDateCompareValue(valueJson) {
    try {
      const obj = JSON.parse(valueJson || '{}');
      return {
        baseType: obj.baseType || 'today',
        baseField: obj.baseField || '',
        offsetDays: Number(obj.offsetDays || 0)
      };
    } catch (e) {
      return {
        baseType: 'today',
        baseField: '',
        offsetDays: 0
      };
    }
  }

  function getCompareDate(record, valueJson) {
    const parsed = parseDateCompareValue(valueJson);

    let baseDate = null;

    if (parsed.baseType === 'field') {
      baseDate = normalizeDateOnly(getFieldValue(record, parsed.baseField));
    } else {
      baseDate = new Date();
      baseDate.setHours(0, 0, 0, 0);
    }

    if (!baseDate) return null;

    return addDays(baseDate, parsed.offsetDays);
  }

  function compareDate(record, fieldCode, op, valueJson) {
    const fieldDate = normalizeDateOnly(getFieldValue(record, fieldCode));
    const compareTarget = getCompareDate(record, valueJson);

    if (!fieldDate || !compareTarget) return false;

    const a = fieldDate.getTime();
    const b = compareTarget.getTime();

    switch (op) {
      case 'eq_date':
        return a === b;
      case 'neq_date':
        return a !== b;
      case 'lte_date':
        return a <= b;
      case 'lt_date':
        return a < b;
      case 'gte_date':
        return a >= b;
      case 'gt_date':
        return a > b;
      default:
        return false;
    }
  }

  function evaluateByOp(record, fieldCode, op, target) {
    const val = getFieldValue(record, fieldCode);
    const valArray = toArray(val);
    const targetList = parseCsv(target);

    switch (op) {
      case 'empty':
        return isEmpty(val);

      case 'not_empty':
        return !isEmpty(val);

      case 'eq':
        return String(val ?? '') === String(target ?? '');

      case 'neq':
        return String(val ?? '') !== String(target ?? '');

      case 'in':
        return targetList.includes(String(val ?? ''));

      case 'includes':
        return String(val ?? '').includes(String(target ?? ''));

      case 'not_includes':
        return !String(val ?? '').includes(String(target ?? ''));

      case 'lte': {
        const a = toSafeNumber(val);
        const b = toSafeNumber(target);
        if (a === null || b === null) return false;
        return a <= b;
      }

      case 'gte': {
        const a = toSafeNumber(val);
        const b = toSafeNumber(target);
        if (a === null || b === null) return false;
        return a >= b;
      }

      case 'any_in':
        return valArray.some(v => targetList.includes(String(v)));

      case 'none_in':
        return !valArray.some(v => targetList.includes(String(v)));

      case 'has_file':
        return Array.isArray(val) && val.length > 0;

      case 'no_file':
        return !Array.isArray(val) || val.length === 0;

      case 'file_includes':
        return Array.isArray(val) && val.some(file =>
          String(file.name || '').includes(String(target || ''))
        );

      case 'file_not_includes':
        return !Array.isArray(val) || !val.some(file =>
          String(file.name || '').includes(String(target || ''))
        );

      case 'eq_date':
      case 'neq_date':
      case 'lte_date':
      case 'lt_date':
      case 'gte_date':
      case 'gt_date':
        return compareDate(record, fieldCode, op, target);

      default:
        return true;
    }
  }

  function evaluateIF(record, rule) {
    const conds = rule.if?.conds || [];
    const logic = rule.if?.logic || 'AND';

    if (conds.length === 0) return true;

    const results = conds.map(cond =>
      evaluateByOp(record, cond.field, cond.op, cond.value)
    );

    return logic === 'OR'
      ? results.some(Boolean)
      : results.every(Boolean);
  }

  function evaluateThenItem(record, item) {
    return evaluateByOp(record, item.field, item.op, item.value);
  }

  function getThenItems(rule) {
    if (Array.isArray(rule.then?.items)) {
      return rule.then.items;
    }

    // 旧形式救済
    if (rule.then?.field) {
      return [rule.then];
    }

    return [];
  }

  const OP_LABELS = {
    eq: '＝（等しい）',
    neq: '≠（等しくない）',
    in: '次のいずれかと等しい',
    includes: '次のキーワードを含む',
    not_includes: '次のキーワードを含まない',
    lte: '≦（以下）',
    gte: '≧（以上）',
    empty: '空欄である',
    not_empty: '空欄ではない',
    any_in: '次のいずれかを含む',
    none_in: '次のいずれも含まない',
    file_includes: '次のキーワードを含む',
    file_not_includes: '次のキーワードを含まない',
    has_file: 'ファイルあり',
    no_file: 'ファイルなし',
    eq_date: '＝（等しい）',
    neq_date: '≠（等しくない）',
    lte_date: '≦（以前）',
    lt_date: '＜（より前）',
    gte_date: '≧（以降）',
    gt_date: '＞（より後）'
  };

  function formatCond(cond) {
    const field = cond.field || '（フィールド未設定）';
    const op = OP_LABELS[cond.op] || cond.op || '';
    const value = cond.value ? `：${cond.value}` : '';
    return `${field} ${op}${value}`;
  }

  function formatThen(item) {
    const field = item.field || '（フィールド未設定）';
    const op = OP_LABELS[item.op] || item.op || '';
    const value = item.value ? `：${item.value}` : '';
    return `${field} ${op}${value}`;
  }


  function runValidation(event) {
    const { rules } = loadConfig();
    const record = event.record;
    const errors = [];

    rules.forEach((rule, ruleIndex) => {
      if (!rule.enabled) return;
      if (!evaluateIF(record, rule)) return;

      const thenItems = getThenItems(rule);

      thenItems.forEach((item, thenIndex) => {
        if (!item.field) return;

        const ok = evaluateThenItem(record, item);

        if (!ok) {
          errors.push({
            ruleIndex: ruleIndex + 1,
            ruleName: rule.name || '',
            ifLogic: rule.if?.logic || 'AND',
            ifConds: rule.if?.conds || [],
            thenIndex: thenIndex + 1,
            thenItem: item,
            field: item.field,
            message: item.message || '入力内容が条件を満たしていません'
          });
        }
      });
    });
    if (errors.length === 0) {
      return event;
    }

    errors.forEach((e) => {
      if (record[e.field]) {
        record[e.field].error = e.message;
      }
    });

    showValidationPanel(errors);

    event.error = '入力内容にエラーがあります。条件を確認してください。';
    return event;
  }

  function showValidationPanel(errors) {
    document.getElementById('fv-error-panel')?.remove();

    const panel = document.createElement('div');
    panel.id = 'fv-error-panel';
    panel.style.cssText = `
      position: fixed;
      right: 24px;
      bottom: 24px;
      z-index: 99999;
      width: 520px;
      max-height: 65vh;
      overflow: auto;
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 14px;
      box-shadow: 0 12px 30px rgba(0,0,0,.18);
      padding: 14px;
      font-size: 13px;
    `;

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <div style="font-weight:800;">条件チェック結果</div>
        <button type="button" id="fv-error-close"
          style="border:1px solid #d1d5db;background:#fff;border-radius:8px;padding:4px 8px;cursor:pointer;">
          ×
        </button>
      </div>

      ${errors.map((e) => `
        <div style="border-top:1px solid #e5e7eb;padding:10px 0;">
          <div style="font-weight:800;margin-bottom:6px;">
            ルール${e.ruleIndex}${e.ruleName ? `：${escapeHtml(e.ruleName)}` : ''}
          </div>

          <div style="margin-bottom:6px;">
            <div style="font-weight:700;">IF（発火条件：${escapeHtml(e.ifLogic)}）</div>
            <ul style="margin:4px 0 0 18px;padding:0;">
              ${e.ifConds.length
        ? e.ifConds.map(c => `<li>${escapeHtml(formatCond(c))}</li>`).join('')
        : '<li>条件なし（常に発火）</li>'
      }
            </ul>
          </div>

          <div>
            <div style="font-weight:700;color:#b91c1c;">NGになったTHEN（検証${e.thenIndex}）</div>
            <div style="margin-top:4px;">${escapeHtml(formatThen(e.thenItem))}</div>
          </div>
        </div>
      `).join('')}
    `;

    document.body.appendChild(panel);

    document.getElementById('fv-error-close')?.addEventListener('click', () => {
      panel.remove();
    });
  }

  kintone.events.on([
    'app.record.create.submit',
    'app.record.edit.submit'
  ], function (event) {
    return runValidation(event);
  });
})();
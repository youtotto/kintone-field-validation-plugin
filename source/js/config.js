/* global kintone */
(function () {

  'use strict';

  const PLUGIN_ID = kintone.$PLUGIN_ID;

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // ===== DOM =====
  const elFieldCount = $('#kv-fieldCount');
  const elRuleCount = $('#kv-ruleCount');

  const elBtnAddRule = $('#btn-addRule');
  const elBtnClearAll = $('#btn-clearAll');

  const elRulesContainer = $('#rules-container');

  const elBtnSave = $('#btn-save');
  const elBtnCancel = $('#btn-cancel');

  const tplRule = $('#tpl-rule');
  const tplCond = $('#tpl-cond');
  const tplThen = $('#tpl-then');

  // ===== Field Meta =====
  /**
   * meta:
   * { code, label, type, isSub, parentCode, options?: [{value,label}] }
   */
  let FIELD_LIST = [];
  const FIELD_MAP = new Map();

  function setFieldCount(n) { if (elFieldCount) elFieldCount.textContent = `フィールド読込：${n}`; }
  function setRuleCount(n) { if (elRuleCount) elRuleCount.textContent = `ルール：${n}`; }

  async function fetchFieldsProperties() {
    const resp = await kintone.app.getFormFields();
    return resp || {};
  }

  function readOptions(field) {
    // kintone form fields: options is object { "A": {label:"A", index:"0"}, ... }
    const opts = field?.options || null;
    if (!opts) return null;
    const arr = Object.keys(opts).map((k) => ({
      value: k,
      label: opts[k]?.label ?? k,
      index: Number(opts[k]?.index ?? 0)
    }));
    arr.sort((a, b) => a.index - b.index);
    return arr.map(o => ({ value: o.value, label: o.label }));
  }

  function flattenFields(props) {
    const list = [];

    const exclude = new Set([
      'REFERENCE_TABLE',
      'GROUP',
      'SPACER',
      'HR',
      'LABEL',
      'CATEGORY',
      'STATUS_ASSIGNEE'
    ]);

    const pushField = (field, code, isSub, parentCode) => {
      if (!field) return;
      if (exclude.has(field.type)) return;

      // ステータスは enabled=true の場合だけ表示
      if (field.type === 'STATUS' && field.enabled !== true) {
        return;
      }

      // カテゴリー・作業者は今回は対象外
      if (['CATEGORY', 'STATUS_ASSIGNEE'].includes(field.type)) {
        return;
      }

      const meta = {
        code,
        label: field.label || code,
        type: field.type,
        isSub: !!isSub,
        parentCode: parentCode || '',
        options: null
      };

      // 選択肢系
      if (['DROP_DOWN', 'RADIO_BUTTON', 'CHECK_BOX', 'MULTI_SELECT'].includes(field.type)) {
        meta.options = readOptions(field) || [];
      }

      // ステータス
      if (field.type === 'STATUS') {
        meta.options = [];
      }

      list.push(meta);
    };

    Object.keys(props).forEach((code) => {
      const f = props[code];
      if (!f) return;

      if (f.type === 'SUBTABLE') {
        const subProps = f.fields || {};
        Object.keys(subProps).forEach((subCode) => {
          pushField(subProps[subCode], `${code}.${subCode}`, true, code);
        });
      } else {
        pushField(f, code, false, '');
      }
    });

    list.sort((a, b) => {
      if (a.isSub !== b.isSub) return a.isSub ? 1 : -1;
      return (a.label || '').localeCompare((b.label || ''), 'ja');
    });

    return list;
  }

  function fillFieldSelect(selectEl, selected) {
    if (!selectEl) return;
    const keep0 = selectEl.querySelector('option[value=""]');
    selectEl.innerHTML = '';
    if (keep0) selectEl.appendChild(keep0);
    else {
      const o0 = document.createElement('option');
      o0.value = '';
      o0.textContent = '（フィールドを選択）';
      selectEl.appendChild(o0);
    }

    FIELD_LIST.forEach((f) => {
      const opt = document.createElement('option');
      opt.value = f.code;
      const prefix = f.isSub ? `［テーブル:${f.parentCode}］` : '';
      opt.textContent = `${prefix}${f.label}（${f.code} / ${f.type}）`;
      selectEl.appendChild(opt);
    });

    if (selected) selectEl.value = selected;
  }

  async function fetchStatusOptions(appId) {
    try {
      const resp = await kintone.api(
        kintone.api.url('/k/v1/app/status.json', true),
        'GET',
        { app: appId }
      );

      const states = resp.states || {};

      return Object.keys(states)
        .sort((a, b) => Number(states[a].index || 0) - Number(states[b].index || 0))
        .map((name) => ({
          value: name,
          label: name
        }));
    } catch (e) {
      console.warn('[FieldValidation] status.json の取得に失敗しました', e);
      return [];
    }
  }

  // ===== Operators =====
  function getAllowedOpsByFieldType(fieldType) {
    const SELECT = new Set([
      'DROP_DOWN',
      'RADIO_BUTTON',
      'CHECK_BOX',
      'MULTI_SELECT',
      'STATUS',
      'CATEGORY'
    ]);

    switch (fieldType) {
      case 'SINGLE_LINE_TEXT':
      case 'LINK':
        return ['eq', 'neq', 'in', 'includes', 'not_includes'];

      case 'MULTI_LINE_TEXT':
      case 'RICH_TEXT':
        return ['includes', 'not_includes', 'empty', 'not_empty'];

      case 'NUMBER':
      case 'CALC':
        return ['eq', 'neq', 'lte', 'gte'];

      case 'DROP_DOWN':
      case 'CHECK_BOX':
      case 'RADIO_BUTTON':
      case 'MULTI_SELECT':
      case 'STATUS':
      case 'CATEGORY':
        return ['any_in', 'none_in'];

      case 'FILE':
        return ['file_includes', 'file_not_includes', 'has_file', 'no_file'];

      case 'DATE':
      case 'DATETIME':
      case 'CREATED_TIME':
      case 'UPDATED_TIME':
        return ['eq_date', 'neq_date', 'lte_date', 'lt_date', 'gte_date', 'gt_date'];

      default:
        return ['eq', 'neq', 'empty', 'not_empty'];
    }
  }

  function allowedOpsForIF(fieldType) {
    return getAllowedOpsByFieldType(fieldType);
  }

  function allowedOpsForTHEN(fieldType) {
    return getAllowedOpsByFieldType(fieldType);
  }

  function setOpSelect(selectEl, ops, current) {
    const labels = {
      // 文字列
      eq: '＝（等しい）',
      neq: '≠（等しくない）',
      in: '次のいずれかと等しい',
      includes: '次のキーワードを含む',
      not_includes: '次のキーワードを含まない',

      // 数値
      lte: '≦（以下）',
      gte: '≧（以上）',

      // 空欄
      empty: '空欄である',
      not_empty: '空欄ではない',

      // 選択肢系
      any_in: '次のいずれかを含む',
      none_in: '次のいずれも含まない',

      // 添付ファイル
      file_includes: '次のキーワードを含む',
      file_not_includes: '次のキーワードを含まない',
      has_file: 'ファイルあり',
      no_file: 'ファイルなし',

      // 日付
      eq_date: '＝（等しい）',
      neq_date: '≠（等しくない）',
      lte_date: '≦（以前）',
      lt_date: '＜（より前）',
      gte_date: '≧（以降）',
      gt_date: '＞（より後）'
    };

    selectEl.innerHTML = '';

    ops.forEach((op) => {
      const o = document.createElement('option');
      o.value = op;
      o.textContent = labels[op] || op;
      selectEl.appendChild(o);
    });

    selectEl.value = ops.includes(current) ? current : (ops[0] || 'not_empty');
  }

  function opNeedsValue(op) {
    return ![
      'empty',
      'not_empty',
      'has_file',
      'no_file'
    ].includes(op);
  }

  // ===== Value Editor (select系は選択) =====
  function parseCsvLike(str) {
    if (!str) return [];
    // カンマ or 改行で分割（trim）
    return str
      .split(/[\n,]/g)
      .map(s => s.trim())
      .filter(Boolean);
  }

  function toCsv(values) {
    return (values || []).filter(Boolean).join(',');
  }

  function getDateFieldOptions() {
    return FIELD_LIST.filter(f =>
      ['DATE', 'DATETIME', 'CREATED_TIME', 'UPDATED_TIME'].includes(f.type)
    );
  }

  function parseDateCompareValue(currentValue) {
    try {
      if (!currentValue) {
        return {
          mode: 'relative_date',
          baseType: 'today',
          baseField: '',
          offsetDays: 0
        };
      }

      const obj = JSON.parse(currentValue);

      return {
        mode: obj.mode || 'relative_date',
        baseType: obj.baseType || 'today',
        baseField: obj.baseField || '',
        offsetDays: Number(obj.offsetDays || 0)
      };
    } catch (e) {
      return {
        mode: 'relative_date',
        baseType: 'today',
        baseField: '',
        offsetDays: 0
      };
    }
  }

  function buildDateCompareValue(baseType, baseField, days, direction) {
    const n = Number(days || 0);
    const offsetDays = direction === 'before' ? -n : n;

    return JSON.stringify({
      mode: 'relative_date',
      baseType,
      baseField: baseType === 'field' ? baseField : '',
      offsetDays
    });
  }

  function renderDateCompareEditor(wrapEl, currentValue) {
    wrapEl.innerHTML = '';

    const parsed = parseDateCompareValue(currentValue);

    const row = document.createElement('div');
    row.className = 'dateCompareBox';

    // =========================
    // 基準日セレクト（統合版）
    // =========================
    const baseSelect = document.createElement('select');
    baseSelect.className = 'date-base';

    // 今日
    const optToday = document.createElement('option');
    optToday.value = '__TODAY__';
    optToday.textContent = '今日から';
    baseSelect.appendChild(optToday);

    // 日付フィールドを追加
    getDateFieldOptions().forEach((f) => {
      const opt = document.createElement('option');
      opt.value = f.code;

      const prefix = f.isSub ? `［テーブル:${f.parentCode}］` : '';
      opt.textContent = `${prefix}${f.label}から`;

      baseSelect.appendChild(opt);
    });

    // 初期値
    if (parsed.baseType === 'field' && parsed.baseField) {
      baseSelect.value = parsed.baseField;
    } else {
      baseSelect.value = '__TODAY__';
    }

    // =========================
    // 日数入力
    // =========================
    const daysInput = document.createElement('input');
    daysInput.type = 'number';
    daysInput.min = '0';
    daysInput.step = '1';
    daysInput.className = 'date-offset-days';
    daysInput.placeholder = '日数';
    daysInput.value = Math.abs(Number(parsed.offsetDays || 0));

    // =========================
    // 前後セレクト
    // =========================
    const directionSelect = document.createElement('select');
    directionSelect.className = 'date-offset-direction';

    const optBefore = document.createElement('option');
    optBefore.value = 'before';
    optBefore.textContent = '日前';

    const optSame = document.createElement('option');
    optSame.value = 'same';
    optSame.textContent = '当日';

    const optAfter = document.createElement('option');
    optAfter.value = 'after';
    optAfter.textContent = '日後';

    directionSelect.appendChild(optBefore);
    directionSelect.appendChild(optSame);
    directionSelect.appendChild(optAfter);

    const offset = Number(parsed.offsetDays || 0);
    if (offset < 0) directionSelect.value = 'before';
    else if (offset > 0) directionSelect.value = 'after';
    else directionSelect.value = 'same';

    // =========================
    // hidden
    // =========================
    const hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.className = 'value-hidden';

    function updateHidden() {
      const isToday = baseSelect.value === '__TODAY__';

      const baseType = isToday ? 'today' : 'field';
      const baseField = isToday ? '' : baseSelect.value;

      let offsetDays = 0;

      if (directionSelect.value === 'before') {
        offsetDays = -Math.abs(Number(daysInput.value || 0));
      } else if (directionSelect.value === 'after') {
        offsetDays = Math.abs(Number(daysInput.value || 0));
      } else {
        offsetDays = 0;
      }

      hidden.value = JSON.stringify({
        mode: 'relative_date',
        baseType,
        baseField,
        offsetDays
      });
    }

    function refreshUI() {
      const isSame = directionSelect.value === 'same';
      daysInput.disabled = isSame;
      if (isSame) daysInput.value = '0';
    }

    [baseSelect, daysInput, directionSelect].forEach((el) => {
      el.addEventListener('change', () => {
        refreshUI();
        updateHidden();
      });

      el.addEventListener('input', () => {
        refreshUI();
        updateHidden();
      });
    });

    row.appendChild(baseSelect);
    row.appendChild(daysInput);
    row.appendChild(directionSelect);
    row.appendChild(hidden);

    wrapEl.appendChild(row);

    refreshUI();
    updateHidden();
  }

  function renderValueEditor(wrapEl, meta, op, currentValue) {
    wrapEl.innerHTML = '';

    if (!opNeedsValue(op)) {
      // 値不要
      const dummy = document.createElement('input');
      dummy.type = 'text';
      dummy.disabled = true;
      dummy.placeholder = '（値は不要）';
      wrapEl.appendChild(dummy);
      return;
    }

    const type = meta?.type || '';
    const isDateField = ['DATE', 'DATETIME', 'CREATED_TIME', 'UPDATED_TIME'].includes(type);
    const isDateOp = ['eq_date', 'neq_date', 'lte_date', 'lt_date', 'gte_date', 'gt_date'].includes(op);

    if (isDateField && isDateOp) {
      renderDateCompareEditor(wrapEl, currentValue);
      return;
    }

    const SELECT_TYPES = [
      'DROP_DOWN',
      'RADIO_BUTTON',
      'CHECK_BOX',
      'MULTI_SELECT',
      'STATUS'
    ];

    const isSelectField = SELECT_TYPES.includes(type);

    // select系：選択肢を選ばせる
    if (isSelectField && Array.isArray(meta?.options)) {
      const selectedValues = parseCsvLike(currentValue);

      const box = document.createElement('div');
      box.className = 'choice-box';

      const hidden = document.createElement('input');
      hidden.type = 'hidden';
      hidden.className = 'value-hidden';

      const updateHidden = () => {
        const vals = Array.from(box.querySelectorAll('input[type="checkbox"]:checked'))
          .map((input) => input.value);
        hidden.value = toCsv(vals);
      };

      meta.options.forEach((o) => {
        const label = document.createElement('label');
        label.className = 'choice-item';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = o.value;
        cb.checked = selectedValues.includes(o.value);

        cb.addEventListener('change', updateHidden);

        const text = document.createElement('span');
        text.textContent = o.label;

        label.appendChild(cb);
        label.appendChild(text);
        box.appendChild(label);
      });

      wrapEl.appendChild(box);
      wrapEl.appendChild(hidden);

      updateHidden();
      return;
    }

    // 非セレクト系：inは textarea、それ以外は input（好みで調整OK）
    if (op === 'in') {
      const ta = document.createElement('textarea');
      ta.placeholder = '例：A,B,C または 改行区切り';
      ta.value = currentValue || '';
      ta.className = 'value-plain';
      wrapEl.appendChild(ta);
      return;
    }

    const inp = document.createElement('input');
    inp.type = 'text';
    inp.placeholder = '値を入力';
    inp.value = currentValue || '';
    inp.className = 'value-plain';
    wrapEl.appendChild(inp);
  }

  function getValueFromWrap(wrapEl) {
    // select系は hidden を見る
    const hidden = wrapEl.querySelector('input.value-hidden');
    if (hidden) return hidden.value || '';
    const plain = wrapEl.querySelector('.value-plain');
    if (plain) return plain.value || '';
    return '';
  }

  // ===== Rule UI =====
  function getRuleCards() {
    return $$('#rules-container [data-rule]');
  }

  function getCondRows(card) {
    return Array.from(card.querySelectorAll('tbody.if-tbody tr[data-cond]'));
  }

  function addCondRow(card, cond) {
    const frag = tplCond.content.cloneNode(true);
    const tr = frag.querySelector('tr[data-cond]');
    const selField = tr.querySelector('.if-field');
    const selOp = tr.querySelector('.if-op');
    const wrapVal = tr.querySelector('.if-value');

    fillFieldSelect(selField, cond?.field || '');

    // op select
    const meta = FIELD_MAP.get(selField.value);
    setOpSelect(selOp, allowedOpsForIF(meta?.type || ''), cond?.op || 'not_empty');
    renderValueEditor(wrapVal, meta, selOp.value, cond?.value || '');

    selField.addEventListener('change', () => {
      const m = FIELD_MAP.get(selField.value);
      setOpSelect(selOp, allowedOpsForIF(m?.type || ''), 'not_empty');
      renderValueEditor(wrapVal, m, selOp.value, '');
    });
    selOp.addEventListener('change', () => {
      const m = FIELD_MAP.get(selField.value);
      renderValueEditor(wrapVal, m, selOp.value, getValueFromWrap(wrapVal));
    });

    // move/delete
    tr.querySelector('.btn-cdel').addEventListener('click', () => {
      tr.remove();
    });

    card.querySelector('tbody.if-tbody').appendChild(tr);
  }

  function createRuleCard(rule) {
    const frag = tplRule.content.cloneNode(true);
    const card = frag.querySelector('[data-rule]');

    const elEnabled = card.querySelector('.rule-enabled');
    const elLogic = card.querySelector('.if-logic');

    // header
    elEnabled.checked = rule?.enabled !== false;
    elLogic.value = rule?.if?.logic || 'AND';

    // IF conds
    const ruleName = card.querySelector('.rule-name');
    ruleName.value = rule?.name || '';

    const conds = rule?.if?.conds || [];
    conds.forEach(c => addCondRow(card, c));
    // 初期は1行入れておく（好みで）
    if (conds.length === 0) addCondRow(card, null);

    // THEN
    const thenItems =
      Array.isArray(rule?.then?.items)
        ? rule.then.items
        : rule?.then?.field
          ? [rule.then] // 旧形式からの移行用
          : [];

    thenItems.forEach(item => addThenRow(card, item));

    if (thenItems.length === 0) {
      addThenRow(card, null);
    }

    // Buttons
    card.querySelector('.btn-addCond').addEventListener('click', () => addCondRow(card, null));
    card.querySelector('.btn-addThen')?.addEventListener('click', () => addThenRow(card, null));

    card.querySelector('.btn-del').addEventListener('click', () => {
      card.remove();
      refreshRuleNumbers();
    });

    const btnToggle = card.querySelector('.btn-toggleRule');
    btnToggle?.addEventListener('click', () => {
      card.classList.toggle('is-collapsed');
    });

    return card;
  }

  function addRule(rule) {
    const card = createRuleCard(rule);
    elRulesContainer.appendChild(card);

    refreshRuleNumbers();
  }

  function clearAllRules() {
    elRulesContainer.innerHTML = '';
    refreshRuleNumbers();
  }

  function refreshRuleNumbers() {
    getRuleCards().forEach((card, idx) => {
      const el = card.querySelector('.rule-no');
      if (el) {
        el.textContent = `ルール${idx + 1}`;
      }
    });

    setRuleCount(getRuleCards().length);
  }

  // ===== Then UI =====
  function getThenRows(card) {
    return Array.from(card.querySelectorAll('tbody.then-tbody tr[data-then]'));
  }

  function addThenRow(card, item) {
    const frag = tplThen.content.cloneNode(true);

    const tr = frag.querySelector('tr[data-then]');
    const msgRow = frag.querySelector('.then-msg-row');

    const fieldSel = tr.querySelector('.then-field');
    const opSel = tr.querySelector('.then-op');
    const valueWrap = tr.querySelector('.then-value');
    const msg = msgRow.querySelector('.then-message');

    fillFieldSelect(fieldSel, item?.field || '');

    const meta = FIELD_MAP.get(fieldSel.value);
    setOpSelect(opSel, allowedOpsForTHEN(meta?.type || ''), item?.op || 'not_empty');
    renderValueEditor(valueWrap, meta, opSel.value, item?.value || '');

    msg.value = item?.message || '';

    fieldSel.addEventListener('change', () => {
      const m = FIELD_MAP.get(fieldSel.value);
      setOpSelect(opSel, allowedOpsForTHEN(m?.type || ''), 'not_empty');
      renderValueEditor(valueWrap, m, opSel.value, '');
    });

    opSel.addEventListener('change', () => {
      const m = FIELD_MAP.get(fieldSel.value);
      renderValueEditor(valueWrap, m, opSel.value, getValueFromWrap(valueWrap));
    });

    tr.querySelector('.btn-tdel').addEventListener('click', () => {
      msgRow.remove();
      tr.remove();
    });

    const tbody = card.querySelector('tbody.then-tbody');
    tbody.appendChild(tr);
    tbody.appendChild(msgRow);
  }

  // ===== Config load/save =====
  function safeJsonParse(str, fallback) {
    try { return str ? JSON.parse(str) : fallback; } catch (e) { return fallback; }
  }

  function getConfigFromUI() {

    const rules = getRuleCards().map((card, idx) => {
      const enabled = card.querySelector('.rule-enabled')?.checked ?? true;
      const logic = card.querySelector('.if-logic')?.value || 'AND';

      const conds = getCondRows(card).map((tr) => {
        const field = tr.querySelector('.if-field')?.value || '';
        const op = tr.querySelector('.if-op')?.value || 'not_empty';
        const valueWrap = tr.querySelector('.if-value');
        const value = valueWrap ? getValueFromWrap(valueWrap) : '';
        return { field, op, value };
      }).filter(c => c.field); // フィールド未選択は捨てる

      const name = card.querySelector('.rule-name')?.value || '';

      const thenItems = getThenRows(card).map((tr) => {
        const field = tr.querySelector('.then-field')?.value || '';
        const op = tr.querySelector('.then-op')?.value || 'not_empty';
        const valueWrap = tr.querySelector('.then-value');
        const value = valueWrap ? getValueFromWrap(valueWrap) : '';

        const msgRow = tr.nextElementSibling;
        const message = msgRow?.querySelector('.then-message')?.value || '';

        return { field, op, value, message };
      }).filter(item => item.field);

      return {
        id: `r${String(idx + 1).padStart(3, '0')}`,
        name,
        enabled,
        if: { logic, conds },
        then: { items: thenItems }
      };
    });

    return { version: '1.0.0', rules };
  }

  function applyConfigToUI(obj) {
    clearAllRules();
    (obj?.rules || []).forEach(r => addRule(r));
    if (getRuleCards().length === 0) addRule(null);
  }

  function loadConfig() {
    const conf = kintone.plugin.app.getConfig(PLUGIN_ID) || {};
    const rules = safeJsonParse(conf.rulesJson, []);
    applyConfigToUI({ rules, version: conf.version || '1.0.0' });
  }

  async function saveConfig() {
    const obj = getConfigFromUI();

    // 最低限の設定チェック
    const invalid = obj.rules
      .filter(r => r.enabled)
      .filter(r => !Array.isArray(r.then?.items) || r.then.items.length === 0);

    if (invalid.length) {
      alert('THEN（検証）が1件も設定されていないルールがあります。修正してから保存してください。');
      return;
    }

    const conf = {
      rulesJson: JSON.stringify(obj.rules || []),
      version: obj.version || '1.0.0'
    };

    await new Promise((resolve) => {
      kintone.plugin.app.setConfig(conf, () => resolve());
      setTimeout(resolve, 0);
    });

    location.href = `/k/admin/app/${kintone.app.getId()}/plugin/?message=CONFIG_SAVED#/`;
  }

  // ===== init =====
  async function init() {

    // fields
    const props = await fetchFieldsProperties();
    FIELD_LIST = flattenFields(props);

    const appId = kintone.app.getId();
    const statusMeta = FIELD_LIST.find(f => f.type === 'STATUS');

    if (statusMeta) {
      statusMeta.options = await fetchStatusOptions(appId);
    }

    FIELD_MAP.clear();
    FIELD_LIST.forEach(f => FIELD_MAP.set(f.code, f));
    setFieldCount(FIELD_LIST.length);

    // events
    elBtnAddRule?.addEventListener('click', () => addRule(null));
    elBtnClearAll?.addEventListener('click', () => {
      if (confirm('全てのルールを削除します。よろしいですか？')) clearAllRules();
      if (getRuleCards().length === 0) addRule(null);
    });

    elBtnSave?.addEventListener('click', () => { void saveConfig(); });
    elBtnCancel?.addEventListener('click', () => {
      location.href = `/k/admin/app/${kintone.app.getId()}/plugin/#/`;
    });

    // load
    loadConfig();
  }

  // DOM依存せず即実行
  void init();
})();

'use strict';

/**
 * source/config.html + source/js/config.js を jsdom 上で読み込み、
 * kintone API をスタブして設定画面の読み込み／保存を検証するヘルパー。
 */
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const CONFIG_HTML = path.resolve(__dirname, '../../source/config.html');
const CONFIG_JS = path.resolve(__dirname, '../../source/js/config.js');

const opts = (arr) => Object.fromEntries(arr.map((l, i) => [l, { label: l, index: String(i) }]));

/** テスト用フォーム定義（getFormFields の戻り値相当） */
function defaultFields() {
  return {
    顧客名: { type: 'SINGLE_LINE_TEXT', code: '顧客名', label: '顧客名' },
    備考: { type: 'MULTI_LINE_TEXT', code: '備考', label: '備考' },
    金額: { type: 'NUMBER', code: '金額', label: '金額' },
    契約開始日: { type: 'DATE', code: '契約開始日', label: '契約開始日' },
    契約区分: { type: 'DROP_DOWN', code: '契約区分', label: '契約区分', options: opts(['新規', '更新', '解約']) },
    契約書: { type: 'FILE', code: '契約書', label: '契約書添付' },
    ステータス: { type: 'STATUS', code: 'ステータス', label: 'ステータス', enabled: true },
    明細: {
      type: 'SUBTABLE', code: '明細', label: '明細',
      fields: {
        品名: { type: 'SINGLE_LINE_TEXT', code: '品名', label: '品名' },
        納期: { type: 'DATE', code: '納期', label: '納期' }
      }
    }
  };
}

/**
 * 設定画面を読み込む。
 * @param {object} options
 * @param {Array} options.rules 保存済みルール（rulesJson に入れる）
 * @param {object} options.fields フォーム定義（省略時 defaultFields）
 */
async function loadConfigScreen({ rules = [], fields = defaultFields() } = {}) {
  const html = fs.readFileSync(CONFIG_HTML, 'utf8');
  const js = fs.readFileSync(CONFIG_JS, 'utf8');

  // 保存後の location.href 代入は jsdom では「Not implemented: navigation」として
  // 仮想コンソールに出るだけで例外にはならない。テスト出力を汚さないよう捨てる。
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://example.cybozu.com/k/admin/app/1/plugin/config',
    virtualConsole
  });
  const { window } = dom;

  let saved = null;
  const config = rules.length ? { rulesJson: JSON.stringify(rules), version: '1.0.0' } : {};

  window.kintone = {
    $PLUGIN_ID: 'test-plugin',
    app: {
      getId: () => 1,
      getFormFields: async () => JSON.parse(JSON.stringify(fields))
    },
    plugin: {
      app: {
        getConfig: () => JSON.parse(JSON.stringify(config)),
        setConfig: (conf, cb) => { saved = conf; if (cb) cb(); }
      }
    },
    api: Object.assign(
      async () => ({ states: { 未処理: { index: '0' }, 申請中: { index: '1' }, 承認済: { index: '2' } } }),
      { url: (p) => p }
    )
  };
  window.alert = (msg) => { window.__lastAlert = msg; };
  window.confirm = () => true;

  window.eval(js);

  // init() は非同期。ルール一覧が描画されるまで待つ
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const cards = window.document.querySelectorAll('#rules-container [data-rule]');
    const loaded = window.document.getElementById('kv-fieldCount')?.textContent !== 'フィールド読込：未';
    if (loaded && cards.length > 0) break;
    await new Promise((r) => setTimeout(r, 10));
  }

  const doc = window.document;

  return {
    window,
    document: doc,
    ruleCards: () => Array.from(doc.querySelectorAll('#rules-container [data-rule]')),
    ifRows: (card) => Array.from(card.querySelectorAll('tbody.if-tbody tr[data-cond]')),
    thenRows: (card) => Array.from(card.querySelectorAll('tbody.then-tbody tr[data-then]')),
    optionValues: (select) => Array.from(select.options).map((o) => o.value),
    selectedText: (select) => select.selectedOptions[0]?.textContent || '',
    /** 保存ボタンを押し、setConfig に渡された rules を返す */
    async save() {
      doc.getElementById('btn-save').click();
      await new Promise((r) => setTimeout(r, 50));
      return {
        saved,
        rules: saved ? JSON.parse(saved.rulesJson) : null,
        alert: window.__lastAlert || null
      };
    },
    /** select の値を変更して change イベントを発火 */
    change(select, value) {
      select.value = value;
      select.dispatchEvent(new window.Event('change', { bubbles: true }));
    }
  };
}

module.exports = { loadConfigScreen, defaultFields };

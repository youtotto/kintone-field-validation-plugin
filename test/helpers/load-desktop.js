'use strict';

/**
 * source/js/desktop.js を Node 上で読み込み、kintone / document をスタブして
 * 保存イベントハンドラを直接呼び出せるようにするヘルパー。
 * 依存パッケージなし（node:vm のみ）。
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// FV_DESKTOP_PATH を指定すると別バージョンの desktop.js（例: 旧リリース）に対してテストを実行できる
const DESKTOP_PATH = process.env.FV_DESKTOP_PATH
  ? path.resolve(process.env.FV_DESKTOP_PATH)
  : path.resolve(__dirname, '../../source/js/desktop.js');

function makeFakeElement() {
  return {
    style: {},
    innerHTML: '',
    children: [],
    appendChild(child) { this.children.push(child); },
    remove() {},
    addEventListener() {},
    querySelector() { return null; }
  };
}

function loadDesktop() {
  const code = fs.readFileSync(DESKTOP_PATH, 'utf8');

  const handlers = {};
  let config = {};
  const warns = [];

  const kintone = {
    $PLUGIN_ID: 'test-plugin',
    plugin: { app: { getConfig: () => config } },
    events: {
      on(events, fn) {
        [].concat(events).forEach((e) => { handlers[e] = fn; });
      }
    }
  };

  const document = {
    getElementById: () => null,
    createElement: () => makeFakeElement(),
    body: makeFakeElement()
  };

  const sandboxConsole = {
    log: () => {},
    warn: (...args) => { warns.push(args); },
    error: (...args) => { warns.push(args); }
  };

  vm.runInNewContext(code, { kintone, document, console: sandboxConsole }, { filename: 'desktop.js' });

  return {
    /** 設定を差し替える（rules は配列。rulesJson を直接渡す場合は { rulesJson } を渡す） */
    setRules(rules) {
      config = { rulesJson: JSON.stringify(rules) };
    },
    setRawConfig(conf) {
      config = conf;
    },
    /** 保存イベントを発火し、戻り値の event を返す */
    submit(record, eventType = 'app.record.edit.submit') {
      const fn = handlers[eventType];
      if (!fn) throw new Error(`handler not registered: ${eventType}`);
      return fn({ type: eventType, record });
    },
    warns,
    clearWarns() { warns.length = 0; }
  };
}

/** ルール1件を簡潔に作る */
function makeRule({ name = 'テストルール', enabled = true, logic = 'AND', conds = [], items = [] } = {}) {
  return { id: 'r001', name, enabled, if: { logic, conds }, then: { items } };
}

/** THEN 1件 */
function thenItem(field, op, value = '', message = `${field}:${op}`) {
  return { field, op, value, message };
}

/** IF 条件 1件 */
function cond(field, op, value = '') {
  return { field, op, value };
}

/** フィールドエラーが付いたフィールドコード → メッセージ のマップ */
function fieldErrors(event) {
  const out = {};
  Object.entries(event.record || {}).forEach(([code, f]) => {
    if (f && f.error) out[code] = f.error;
  });
  return out;
}

function todayYmd(offsetDays = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

module.exports = { loadDesktop, makeRule, thenItem, cond, fieldErrors, todayYmd };

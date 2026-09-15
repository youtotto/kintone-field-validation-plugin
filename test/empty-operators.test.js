'use strict';

// P0-1: empty / not_empty 演算子の回帰テスト（v1.1.0 で評価処理から欠落）

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { loadDesktop, makeRule, thenItem, cond, fieldErrors } = require('./helpers/load-desktop');

const app = loadDesktop();

/** THEN に op を1件だけ設定し、値 value を持つフィールドで保存したときにエラーになるか */
function thenFails(op, value, fieldType = 'SINGLE_LINE_TEXT') {
  app.setRules([makeRule({ items: [thenItem('F', op)] })]);
  const ev = app.submit({ F: { type: fieldType, value } });
  return Boolean(ev.error);
}

/** IF に op を1件設定したとき、その条件が成立したか（成立すると THEN が必ず NG になる） */
function ifFires(op, value, fieldType = 'SINGLE_LINE_TEXT') {
  app.setRules([makeRule({
    conds: [cond('F', op)],
    items: [thenItem('G', 'eq', 'NEVER_MATCH')]
  })]);
  const ev = app.submit({ F: { type: fieldType, value }, G: { type: 'SINGLE_LINE_TEXT', value: 'x' } });
  return Boolean(ev.error);
}

describe('empty（空欄である）', () => {
  test('文字列: "" → true（THEN として OK、エラーなし）', () => {
    assert.equal(thenFails('empty', ''), false);
  });
  test('文字列: "abc" → false（THEN として NG）', () => {
    assert.equal(thenFails('empty', 'abc'), true);
  });
  test('配列: [] → true', () => {
    assert.equal(thenFails('empty', [], 'CHECK_BOX'), false);
  });
  test('配列: ["A"] → false', () => {
    assert.equal(thenFails('empty', ['A'], 'CHECK_BOX'), true);
  });
  test('null → true（例外なし）', () => {
    assert.equal(thenFails('empty', null), false);
  });
  test('undefined → true（例外なし）', () => {
    assert.equal(thenFails('empty', undefined), false);
  });
  test('空白のみ "   " → true', () => {
    assert.equal(thenFails('empty', '   '), false);
  });
  test('添付ファイル [] → true', () => {
    assert.equal(thenFails('empty', [], 'FILE'), false);
  });
  test('ユーザー選択 [{code}] → false', () => {
    assert.equal(thenFails('empty', [{ code: 'u1', name: 'User' }], 'USER_SELECT'), true);
  });
});

describe('not_empty（空欄ではない）', () => {
  test('文字列: "" → false（THEN として NG）', () => {
    assert.equal(thenFails('not_empty', ''), true);
  });
  test('文字列: "abc" → true（THEN として OK）', () => {
    assert.equal(thenFails('not_empty', 'abc'), false);
  });
  test('配列: [] → false', () => {
    assert.equal(thenFails('not_empty', [], 'CHECK_BOX'), true);
  });
  test('配列: ["A"] → true', () => {
    assert.equal(thenFails('not_empty', ['A'], 'CHECK_BOX'), false);
  });
  test('null → false（例外なし）', () => {
    assert.equal(thenFails('not_empty', null), true);
  });
  test('undefined → false（例外なし）', () => {
    assert.equal(thenFails('not_empty', undefined), true);
  });
  test('添付ファイル [{fileKey}] → true', () => {
    assert.equal(thenFails('not_empty', [{ fileKey: 'k', name: 'a.pdf' }], 'FILE'), false);
  });
  test('数値 "0" → true（0 は空欄ではない）', () => {
    assert.equal(thenFails('not_empty', '0', 'NUMBER'), false);
  });
});

describe('empty と not_empty は常に排反', () => {
  const values = ['', 'abc', '   ', [], ['A'], null, undefined, '0', [{ code: 'u1' }]];
  values.forEach((v, i) => {
    test(`値#${i} (${JSON.stringify(v)}) で empty !== not_empty`, () => {
      // THEN が NG になる = 演算子の結果が false
      const emptyResult = !thenFails('empty', v);
      const notEmptyResult = !thenFails('not_empty', v);
      assert.notEqual(emptyResult, notEmptyResult);
    });
  });
});

describe('IF 側でも empty / not_empty が評価される', () => {
  test('IF F が空欄である（F="") → 成立', () => {
    assert.equal(ifFires('empty', ''), true);
  });
  test('IF F が空欄である（F="x"） → 不成立', () => {
    assert.equal(ifFires('empty', 'x'), false);
  });
  test('IF F が空欄ではない（F="x"） → 成立', () => {
    assert.equal(ifFires('not_empty', 'x'), true);
  });
  test('IF F が空欄ではない（F=[]） → 不成立', () => {
    assert.equal(ifFires('not_empty', [], 'MULTI_SELECT'), false);
  });
});

describe('エラー付与の形', () => {
  test('not_empty NG 時は対象フィールドにメッセージ、event.error も設定', () => {
    app.setRules([makeRule({ items: [thenItem('備考', 'not_empty', '', '備考は必須です')] })]);
    const ev = app.submit({ 備考: { type: 'MULTI_LINE_TEXT', value: '' } });
    assert.equal(fieldErrors(ev)['備考'], '備考は必須です');
    assert.ok(ev.error);
  });
});

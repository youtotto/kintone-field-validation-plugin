'use strict';

// 添付ファイル系演算子（has_file / no_file / file_includes / file_not_includes）の安全な無効化
// kintone の保存前イベントでは添付ファイル情報を取得できないため、
//   THEN: 該当 THEN だけスキップ（保存をブロックしない）
//   IF  : 評価不能として 3 値で判定し、適用可否が決まらないルールはスキップ

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadDesktop, makeRule, thenItem, cond, fieldErrors } = require('./helpers/load-desktop');

const app = loadDesktop();
const FILE_OPS = ['has_file', 'no_file', 'file_includes', 'file_not_includes'];

// 保存前イベントの実挙動どおり、添付ファイルの値は常に [] にしておく
const rec = (amount = '200', subject = '') => ({
  添付ファイル: { type: 'FILE', value: [] },
  金額: { type: 'NUMBER', value: amount },
  件名: { type: 'SINGLE_LINE_TEXT', value: subject }
});

beforeEach(() => app.clearWarns());

describe('THEN: 添付ファイル系はスキップされ、保存をブロックしない', () => {
  FILE_OPS.forEach((op) => {
    test(`${op} のみの THEN → 例外なし・event.error なし・warn 1件`, () => {
      app.setRules([makeRule({ name: '添付ルール', items: [thenItem('添付ファイル', op, 'x', 'ファイル必須')] })]);
      let ev;
      assert.doesNotThrow(() => { ev = app.submit(rec()); });
      assert.equal(ev.error, undefined);
      assert.deepEqual(fieldErrors(ev), {});
      assert.equal(app.warns.length, 1);
      const [msg, detail] = app.warns[0];
      assert.match(String(msg), /添付ファイル/);
      assert.match(String(msg), /スキップ/);
      assert.equal(detail.rule, '添付ルール');
      assert.equal(detail.fieldCode, '添付ファイル');
      assert.equal(detail.op, op);
    });
  });

  test('THEN1 添付ファイルあり + THEN2 件名 空欄ではない → THEN1 スキップ、THEN2 は NG で保存停止', () => {
    app.setRules([makeRule({
      name: '混在',
      items: [
        thenItem('添付ファイル', 'has_file', '', 'ファイル必須'),
        thenItem('件名', 'not_empty', '', '件名は必須')
      ]
    })]);
    const ev = app.submit(rec('200', ''));
    assert.ok(ev.error);
    assert.deepEqual(fieldErrors(ev), { 件名: '件名は必須' });
    assert.equal(app.warns.length, 1);
  });

  test('THEN1 添付ファイルあり + THEN2 件名 空欄ではない（件名あり）→ 保存できる', () => {
    app.setRules([makeRule({
      items: [
        thenItem('添付ファイル', 'has_file', '', 'ファイル必須'),
        thenItem('件名', 'not_empty', '', '件名は必須')
      ]
    })]);
    const ev = app.submit(rec('200', '件名あり'));
    assert.equal(ev.error, undefined);
  });

  test('IF が不成立なら添付 THEN の warn も出ない', () => {
    app.setRules([makeRule({
      conds: [cond('金額', 'gte', '1000')],
      items: [thenItem('添付ファイル', 'has_file', '', 'x')]
    })]);
    app.submit(rec('50'));
    assert.equal(app.warns.length, 0);
  });
});

describe('IF: 添付ファイル条件は評価不能（3値判定）', () => {
  const NG_THEN = thenItem('件名', 'not_empty', '', '件名は必須'); // 件名空欄なら必ず NG

  test('IF が添付条件のみ → ルール全体スキップ（保存可・warn 1件）', () => {
    app.setRules([makeRule({ name: 'IF添付のみ', conds: [cond('添付ファイル', 'has_file')], items: [NG_THEN] })]);
    const ev = app.submit(rec('200', ''));
    assert.equal(ev.error, undefined);
    assert.equal(app.warns.length, 1);
    const [msg, detail] = app.warns[0];
    assert.match(String(msg), /IF条件/);
    assert.match(String(msg), /添付ファイル/);
    assert.equal(detail.rule, 'IF添付のみ');
    // desktop.js は別 vm コンテキストで動くためプロトタイプが異なる。JSON 化して比較する
    assert.deepEqual(JSON.parse(JSON.stringify(detail.conds)), [{ fieldCode: '添付ファイル', op: 'has_file' }]);
  });

  test('OR: 添付あり OR 金額≧100（金額200）→ 真が確定するのでルール適用（THEN NG で保存停止）', () => {
    app.setRules([makeRule({ logic: 'OR', conds: [cond('添付ファイル', 'has_file'), cond('金額', 'gte', '100')], items: [NG_THEN] })]);
    const ev = app.submit(rec('200', ''));
    assert.ok(ev.error);
    assert.deepEqual(fieldErrors(ev), { 件名: '件名は必須' });
    assert.equal(app.warns.length, 0);
  });

  test('OR: 添付あり OR 金額≧100（金額50）→ 評価不能なのでルールスキップ（保存可・warn）', () => {
    app.setRules([makeRule({ logic: 'OR', conds: [cond('添付ファイル', 'has_file'), cond('金額', 'gte', '100')], items: [NG_THEN] })]);
    const ev = app.submit(rec('50', ''));
    assert.equal(ev.error, undefined);
    assert.equal(app.warns.length, 1);
  });

  test('AND: 添付なし AND 金額≧100（金額200）→ 従来は no_file=true で誤適用。評価不能としてスキップ', () => {
    app.setRules([makeRule({ logic: 'AND', conds: [cond('添付ファイル', 'no_file'), cond('金額', 'gte', '100')], items: [NG_THEN] })]);
    const ev = app.submit(rec('200', ''));
    assert.equal(ev.error, undefined, '添付状態を推測して保存を止めない');
    assert.equal(app.warns.length, 1);
  });

  test('AND: 添付なし AND 金額≧100（金額50）→ 偽が確定するのでスキップ（warn なし）', () => {
    app.setRules([makeRule({ logic: 'AND', conds: [cond('添付ファイル', 'no_file'), cond('金額', 'gte', '100')], items: [NG_THEN] })]);
    const ev = app.submit(rec('50', ''));
    assert.equal(ev.error, undefined);
    assert.equal(app.warns.length, 0);
  });

  test('AND: 添付あり AND 金額≧100（金額200）→ 評価不能でスキップ（has_file を false と決めつけない）', () => {
    app.setRules([makeRule({ logic: 'AND', conds: [cond('添付ファイル', 'has_file'), cond('金額', 'gte', '100')], items: [NG_THEN] })]);
    const ev = app.submit(rec('200', ''));
    assert.equal(ev.error, undefined);
    assert.equal(app.warns.length, 1);
  });

  test('OR: ファイル名を含まない OR 金額≧100（金額50）→ 評価不能でスキップ（file_not_includes を true と決めつけない）', () => {
    app.setRules([makeRule({ logic: 'OR', conds: [cond('添付ファイル', 'file_not_includes', 'x'), cond('金額', 'gte', '100')], items: [NG_THEN] })]);
    const ev = app.submit(rec('50', ''));
    assert.equal(ev.error, undefined);
    assert.equal(app.warns.length, 1);
  });

  test('複数ルール: 添付 IF のルールがスキップされても他ルールは通常評価', () => {
    app.setRules([
      makeRule({ name: '添付', conds: [cond('添付ファイル', 'has_file')], items: [NG_THEN] }),
      makeRule({ name: '通常', conds: [cond('金額', 'gte', '100')], items: [NG_THEN] })
    ]);
    const ev = app.submit(rec('200', ''));
    assert.ok(ev.error);
    assert.deepEqual(fieldErrors(ev), { 件名: '件名は必須' });
    assert.equal(app.warns.length, 1);
  });

  test('添付条件を含まない IF は従来どおり（AND 真 / OR 偽）', () => {
    app.setRules([makeRule({ logic: 'AND', conds: [cond('金額', 'gte', '100'), cond('件名', 'empty')], items: [NG_THEN] })]);
    assert.ok(app.submit(rec('200', '')).error);
    app.setRules([makeRule({ logic: 'OR', conds: [cond('金額', 'gte', '1000'), cond('件名', 'not_empty')], items: [NG_THEN] })]);
    assert.equal(app.submit(rec('200', '')).error, undefined);
    assert.equal(app.warns.length, 0);
  });
});

'use strict';

// P0-2: THEN 対象フィールドが event.record に存在しない場合に保存不能になる問題

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadDesktop, makeRule, thenItem, cond, fieldErrors } = require('./helpers/load-desktop');

const app = loadDesktop();

const baseRecord = () => ({
  ステータス: { type: 'STATUS', value: '申請中' },
  契約書: { type: 'FILE', value: [] },
  顧客名: { type: 'SINGLE_LINE_TEXT', value: 'テスト株式会社' }
});

beforeEach(() => app.clearWarns());

describe('ケース1: THEN 対象フィールドが record に存在しない', () => {
  test('例外なし・event.error なし・console.warn が出る', () => {
    app.setRules([makeRule({
      name: '削除済みフィールドのルール',
      items: [thenItem('削除済みフィールド', 'not_empty', '', '必須')]
    })]);

    let ev;
    assert.doesNotThrow(() => { ev = app.submit(baseRecord()); });

    assert.equal(ev.error, undefined, 'event.error だけで保存をブロックしない');
    assert.deepEqual(fieldErrors(ev), {});

    assert.equal(app.warns.length, 1, '不整合時に warn が1回出る');
    const [msg, detail] = app.warns[0];
    assert.match(String(msg), /スキップ/);
    assert.equal(detail.rule, '削除済みフィールドのルール');
    assert.equal(detail.fieldCode, '削除済みフィールド');
  });

  test('サブテーブル内フィールド（テーブル.フィールド 形式）も同様にスキップ', () => {
    app.setRules([makeRule({ items: [thenItem('明細.品名', 'not_empty')] })]);
    const record = baseRecord();
    record['明細'] = { type: 'SUBTABLE', value: [{ id: '1', value: { 品名: { type: 'SINGLE_LINE_TEXT', value: '' } } }] };
    const ev = app.submit(record);
    assert.equal(ev.error, undefined);
    assert.equal(app.warns.length, 1);
    assert.equal(app.warns[0][1].fieldCode, '明細.品名');
  });

  test('ルール名が空なら「ルールN」で warn に出る', () => {
    app.setRules([makeRule({ name: '', items: [thenItem('X', 'not_empty')] })]);
    app.submit(baseRecord());
    assert.equal(app.warns[0][1].rule, 'ルール1');
  });

  test('IF が不成立なら THEN は評価されず warn も出ない（ログ過多にならない）', () => {
    app.setRules([makeRule({
      conds: [cond('ステータス', 'any_in', '承認済')],
      items: [thenItem('X', 'not_empty')]
    })]);
    const ev = app.submit(baseRecord());
    assert.equal(ev.error, undefined);
    assert.equal(app.warns.length, 0);
  });

  test('正常なレコードでは warn は出ない', () => {
    app.setRules([makeRule({ items: [thenItem('顧客名', 'not_empty')] })]);
    app.submit(baseRecord());
    assert.equal(app.warns.length, 0);
  });
});

describe('ケース2: 有効な THEN と不在 THEN の混在（有効側は OK）', () => {
  test('不在 THEN だけスキップし、有効 THEN は評価される（OK なので保存可）', () => {
    app.setRules([makeRule({
      name: '混在ルール',
      items: [
        thenItem('顧客名', 'not_empty', '', '顧客名は必須'),
        thenItem('削除済みフィールド', 'not_empty', '', '必須')
      ]
    })]);
    const ev = app.submit(baseRecord());
    assert.equal(ev.error, undefined);
    assert.deepEqual(fieldErrors(ev), {});
    assert.equal(app.warns.length, 1);
    assert.equal(app.warns[0][1].fieldCode, '削除済みフィールド');
  });
});

describe('ケース3: 有効な THEN が NG（不在 THEN が混じっても保存は止まる）', () => {
  test('有効 THEN の NG は通常通りフィールドエラー + event.error', () => {
    app.setRules([makeRule({
      name: '契約時チェック',
      conds: [cond('ステータス', 'any_in', '申請中')],
      items: [
        thenItem('削除済みフィールド', 'not_empty', '', 'スキップされる'),
        thenItem('顧客名', 'eq', '別の会社', '顧客名が一致しません'),
        thenItem('ステータス', 'any_in', '申請中', 'ステータスOK')
      ]
    })]);
    const ev = app.submit(baseRecord());

    assert.ok(ev.error, '有効 THEN の NG で保存が止まる');
    assert.deepEqual(fieldErrors(ev), { 顧客名: '顧客名が一致しません' });
    assert.equal(app.warns.length, 1);
  });

  test('複数ルール: 不在 THEN のみのルールは影響せず、他ルールの NG は止まる', () => {
    app.setRules([
      makeRule({ name: '壊れたルール', items: [thenItem('X', 'not_empty')] }),
      makeRule({ name: '正常ルール', items: [thenItem('顧客名', 'eq', '別の会社', '顧客名NG')] })
    ]);
    const ev = app.submit(baseRecord());
    assert.ok(ev.error);
    assert.deepEqual(fieldErrors(ev), { 顧客名: '顧客名NG' });
  });
});

describe('既存設定との互換', () => {
  test('旧形式 then.field（items なし）も評価される', () => {
    app.setRules([{
      id: 'r001', name: '旧形式', enabled: true,
      if: { logic: 'AND', conds: [] },
      then: { field: '顧客名', op: 'eq', value: '別の会社', message: '旧形式メッセージ' }
    }]);
    const ev = app.submit(baseRecord());
    assert.deepEqual(fieldErrors(ev), { 顧客名: '旧形式メッセージ' });
  });

  test('旧形式 then.field が不在フィールドでもスキップされる', () => {
    app.setRules([{
      id: 'r001', name: '旧形式', enabled: true,
      if: { logic: 'AND', conds: [] },
      then: { field: '存在しない', op: 'not_empty', value: '', message: 'x' }
    }]);
    const ev = app.submit(baseRecord());
    assert.equal(ev.error, undefined);
  });

  test('rulesJson が未設定でも例外なし', () => {
    app.setRawConfig({});
    const ev = app.submit(baseRecord());
    assert.equal(ev.error, undefined);
  });
});

'use strict';

// 今回触っていない既存評価処理が変わっていないことの確認

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { loadDesktop, makeRule, thenItem, cond, fieldErrors, todayYmd } = require('./helpers/load-desktop');

const app = loadDesktop();

const NEVER = thenItem('G', 'eq', 'NEVER_MATCH', 'IF成立');
const withG = (record) => ({ ...record, G: { type: 'SINGLE_LINE_TEXT', value: 'x' } });

/** IF 条件（複数可）が成立したか */
function ifFires({ conds, logic = 'AND' }, record) {
  app.setRules([makeRule({ logic, conds, items: [NEVER] })]);
  return Boolean(app.submit(withG(record)).error);
}

/** THEN 1件が NG になったか */
function thenFails(item, record) {
  app.setRules([makeRule({ items: [item] })]);
  return Boolean(app.submit(record).error);
}

const text = (v) => ({ type: 'SINGLE_LINE_TEXT', value: v });
const num = (v) => ({ type: 'NUMBER', value: v });
const date = (v) => ({ type: 'DATE', value: v });
const dt = (v) => ({ type: 'DATETIME', value: v });
const drop = (v) => ({ type: 'DROP_DOWN', value: v });
const check = (v) => ({ type: 'CHECK_BOX', value: v });

describe('equals / not_equals', () => {
  test('eq: 一致', () => assert.equal(ifFires({ conds: [cond('F', 'eq', 'A')] }, { F: text('A') }), true));
  test('eq: 不一致', () => assert.equal(ifFires({ conds: [cond('F', 'eq', 'A')] }, { F: text('B') }), false));
  test('eq: チェックボックスは順不同で完全一致', () =>
    assert.equal(ifFires({ conds: [cond('F', 'eq', '東京都,神奈川県')] }, { F: check(['神奈川県', '東京都']) }), true));
  test('eq: チェックボックス 要素数が違えば不一致', () =>
    assert.equal(ifFires({ conds: [cond('F', 'eq', '東京都')] }, { F: check(['神奈川県', '東京都']) }), false));
  test('neq: 不一致で成立', () => assert.equal(ifFires({ conds: [cond('F', 'neq', 'A')] }, { F: text('B') }), true));
  test('neq: 一致で不成立', () => assert.equal(ifFires({ conds: [cond('F', 'neq', 'A')] }, { F: text('A') }), false));
});

describe('contains（includes / not_includes / in）', () => {
  test('includes: 含む', () => assert.equal(ifFires({ conds: [cond('F', 'includes', '株式')] }, { F: text('テスト株式会社') }), true));
  test('includes: 含まない', () => assert.equal(ifFires({ conds: [cond('F', 'includes', '有限')] }, { F: text('テスト株式会社') }), false));
  test('includes: 空値は不成立', () => assert.equal(ifFires({ conds: [cond('F', 'includes', 'a')] }, { F: text('') }), false));
  test('not_includes: 含まないで成立', () => assert.equal(ifFires({ conds: [cond('F', 'not_includes', '有限')] }, { F: text('テスト株式会社') }), true));
  test('not_includes: 空値は成立', () => assert.equal(ifFires({ conds: [cond('F', 'not_includes', 'a')] }, { F: text('') }), true));
  test('in: いずれかと等しい', () => assert.equal(ifFires({ conds: [cond('F', 'in', 'A,B,C')] }, { F: text('B') }), true));
  test('in: どれとも等しくない', () => assert.equal(ifFires({ conds: [cond('F', 'in', 'A,B,C')] }, { F: text('D') }), false));
});

describe('数値（lte / gte）', () => {
  test('gte: 1000 >= 100', () => assert.equal(ifFires({ conds: [cond('F', 'gte', '100')] }, { F: num('1000') }), true));
  test('gte: 全角・カンマ付き "１,０００" >= 100', () => assert.equal(ifFires({ conds: [cond('F', 'gte', '100')] }, { F: num('１,０００') }), true));
  test('lte: 50 <= 100', () => assert.equal(ifFires({ conds: [cond('F', 'lte', '100')] }, { F: num('50') }), true));
  test('lte: 空値は不成立', () => assert.equal(ifFires({ conds: [cond('F', 'lte', '100')] }, { F: num('') }), false));
});

describe('AND / OR / 複数IF', () => {
  const rec = { A: text('1'), B: text('2') };
  test('AND: 両方成立', () => assert.equal(ifFires({ logic: 'AND', conds: [cond('A', 'eq', '1'), cond('B', 'eq', '2')] }, rec), true));
  test('AND: 片方不成立', () => assert.equal(ifFires({ logic: 'AND', conds: [cond('A', 'eq', '1'), cond('B', 'eq', 'X')] }, rec), false));
  test('OR: 片方成立', () => assert.equal(ifFires({ logic: 'OR', conds: [cond('A', 'eq', 'X'), cond('B', 'eq', '2')] }, rec), true));
  test('OR: 両方不成立', () => assert.equal(ifFires({ logic: 'OR', conds: [cond('A', 'eq', 'X'), cond('B', 'eq', 'Y')] }, rec), false));
  test('IF 0件は常に成立', () => assert.equal(ifFires({ conds: [] }, rec), true));
  test('3条件 AND', () =>
    assert.equal(ifFires({ logic: 'AND', conds: [cond('A', 'eq', '1'), cond('B', 'eq', '2'), cond('A', 'not_empty')] }, rec), true));
  test('無効ルールは評価されない', () => {
    app.setRules([makeRule({ enabled: false, items: [thenItem('A', 'eq', 'X')] })]);
    assert.equal(app.submit(rec).error, undefined);
  });
});

describe('複数THEN', () => {
  test('複数 THEN のうち NG のものだけフィールドエラーになる', () => {
    app.setRules([makeRule({
      items: [
        thenItem('A', 'eq', '1', 'AはOK'),
        thenItem('B', 'eq', 'X', 'BはNG'),
        thenItem('C', 'not_empty', '', 'CはNG')
      ]
    })]);
    const ev = app.submit({ A: text('1'), B: text('2'), C: text('') });
    assert.ok(ev.error);
    assert.deepEqual(fieldErrors(ev), { B: 'BはNG', C: 'CはNG' });
  });
  test('全 THEN OK なら保存可', () => {
    app.setRules([makeRule({ items: [thenItem('A', 'eq', '1'), thenItem('B', 'eq', '2')] })]);
    assert.equal(app.submit({ A: text('1'), B: text('2') }).error, undefined);
  });
  test('メッセージ未設定時は既定文言', () => {
    app.setRules([makeRule({ items: [{ field: 'A', op: 'eq', value: 'X', message: '' }] })]);
    const ev = app.submit({ A: text('1') });
    assert.equal(fieldErrors(ev).A, '入力内容が条件を満たしていません');
  });
});

describe('日付比較', () => {
  const todayJson = JSON.stringify({ mode: 'relative_date', baseType: 'today', baseField: '', offsetDays: 0 });
  const plus3Json = JSON.stringify({ mode: 'relative_date', baseType: 'today', baseField: '', offsetDays: 3 });
  const fieldJson = JSON.stringify({ mode: 'relative_date', baseType: 'field', baseField: '開始日', offsetDays: 7 });

  test('eq_date: 今日 = 今日', () => assert.equal(thenFails(thenItem('D', 'eq_date', todayJson), { D: date(todayYmd()) }), false));
  test('eq_date: 昨日 ≠ 今日 → NG', () => assert.equal(thenFails(thenItem('D', 'eq_date', todayJson), { D: date(todayYmd(-1)) }), true));
  test('gte_date: 明日 ≧ 今日 → OK', () => assert.equal(thenFails(thenItem('D', 'gte_date', todayJson), { D: date(todayYmd(1)) }), false));
  test('gte_date: 昨日 ≧ 今日 → NG', () => assert.equal(thenFails(thenItem('D', 'gte_date', todayJson), { D: date(todayYmd(-1)) }), true));
  test('lt_date: 今日 < 今日+3 → OK', () => assert.equal(thenFails(thenItem('D', 'lt_date', plus3Json), { D: date(todayYmd()) }), false));
  test('lte_date: 今日+3 ≦ 今日+3 → OK', () => assert.equal(thenFails(thenItem('D', 'lte_date', plus3Json), { D: date(todayYmd(3)) }), false));
  test('gt_date: 今日 > 今日 → NG', () => assert.equal(thenFails(thenItem('D', 'gt_date', todayJson), { D: date(todayYmd()) }), true));
  test('neq_date: 今日 ≠ 今日 → NG', () => assert.equal(thenFails(thenItem('D', 'neq_date', todayJson), { D: date(todayYmd()) }), true));
  test('基準フィールド + 7日: 終了日 ≧ 開始日+7', () => {
    app.setRules([makeRule({ items: [thenItem('終了日', 'gte_date', fieldJson)] })]);
    const ok = app.submit({ 開始日: date('2026-01-01'), 終了日: date('2026-01-08') });
    const ng = app.submit({ 開始日: date('2026-01-01'), 終了日: date('2026-01-07') });
    assert.equal(ok.error, undefined);
    assert.ok(ng.error);
  });
  test('日時（ISO UTC）はローカル日付に変換して比較', () => {
    const local = new Date(); local.setHours(12, 0, 0, 0);
    assert.equal(thenFails(thenItem('D', 'eq_date', todayJson), { D: dt(local.toISOString()) }), false);
  });
  test('日付が空なら比較不能 → NG', () => assert.equal(thenFails(thenItem('D', 'gte_date', todayJson), { D: date('') }), true));
});

// 添付ファイル系演算子は kintone の保存前イベントで判定できないため v1.1.1 で無効化。
// 挙動は test/file-field-disabled.test.js で検証する。
describe('選択肢系（any_in / none_in）', () => {
  test('any_in: ドロップダウン一致', () => assert.equal(ifFires({ conds: [cond('F', 'any_in', '新規,更新')] }, { F: drop('新規') }), true));
  test('any_in: ドロップダウン不一致', () => assert.equal(ifFires({ conds: [cond('F', 'any_in', '新規,更新')] }, { F: drop('解約') }), false));
  test('any_in: チェックボックスいずれか含む', () => assert.equal(ifFires({ conds: [cond('F', 'any_in', '東京都')] }, { F: check(['千葉県', '東京都']) }), true));
  test('none_in: いずれも含まない', () => assert.equal(ifFires({ conds: [cond('F', 'none_in', '東京都')] }, { F: check(['千葉県']) }), true));
  test('none_in: 空配列は成立', () => assert.equal(ifFires({ conds: [cond('F', 'none_in', '東京都')] }, { F: check([]) }), true));
  test('none_in: 含むと不成立', () => assert.equal(ifFires({ conds: [cond('F', 'none_in', '東京都')] }, { F: check(['東京都']) }), false));
});

describe('IF 側の不在フィールド（今回変更なし・従来挙動の確認）', () => {
  test('IF 対象が不在なら条件不成立（AND ルールは適用されない）', () =>
    assert.equal(ifFires({ conds: [cond('存在しない', 'eq', '1')] }, {}), false));
  test('未対応演算子は不成立', () =>
    assert.equal(ifFires({ conds: [cond('F', 'unknown_op', '1')] }, { F: text('1') }), false));
});

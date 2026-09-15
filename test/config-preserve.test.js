'use strict';

// 設定画面: 既存設定を「開いてそのまま保存」しても書き換えないこと（互換性）

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { loadConfigScreen } = require('./helpers/load-config');

const dateValue = JSON.stringify({ mode: 'relative_date', baseType: 'field', baseField: '明細.納期', offsetDays: 0 });

/** テストで使う保存済み設定（正常ルール + 利用不可フィールドを含むルール） */
function legacyRules() {
  return [
    {
      id: 'r001', name: '契約時チェック', enabled: true,
      if: { logic: 'AND', conds: [{ field: 'ステータス', op: 'any_in', value: '申請中' }, { field: '契約区分', op: 'any_in', value: '新規' }] },
      then: { items: [
        { field: '契約書', op: 'has_file', value: '', message: '契約書を添付してください' },
        { field: '契約開始日', op: 'gte_date', value: JSON.stringify({ mode: 'relative_date', baseType: 'today', baseField: '', offsetDays: 0 }), message: '今日以降' }
      ] }
    },
    {
      id: 'r002', name: '旧設定', enabled: false,
      if: { logic: 'OR', conds: [
        { field: '金額', op: 'gte', value: '1000000' },
        { field: '削除済みフィールド', op: 'eq', value: 'ABC' }
      ] },
      then: { items: [
        { field: '備考', op: 'not_empty', value: '', message: '備考必須' },
        { field: '明細.品名', op: 'not_empty', value: '', message: '品名必須' },
        { field: '削除済みフィールド', op: 'eq', value: 'ABC', message: '削除済み' },
        { field: '契約終了日', op: 'gte_date', value: dateValue, message: '基準がサブテーブル' }
      ] }
    }
  ];
}

describe('保存済み operator の保持（利用不可フィールド）', () => {
  test('読み込みで例外なし、明細.品名 の not_empty が eq に置き換わらない', async () => {
    const ui = await loadConfigScreen({ rules: legacyRules() });
    const card2 = ui.ruleCards()[1];
    const rows = ui.thenRows(card2);
    const row = rows.find((tr) => tr.querySelector('.then-field').value === '明細.品名');
    assert.ok(row, '明細.品名 の行が保持されている');

    const opSel = row.querySelector('.then-op');
    assert.equal(opSel.value, 'not_empty');
    assert.match(ui.selectedText(opSel), /空欄ではない.*現在使用できない設定/);
    assert.match(ui.selectedText(row.querySelector('.then-field')), /現在使用できないフィールド/);
  });

  test('そのまま保存しても not_empty のまま、他のルール・THEN も不変', async () => {
    const before = legacyRules();
    const ui = await loadConfigScreen({ rules: legacyRules() });
    const { rules, alert } = await ui.save();

    assert.equal(alert, null, '保存時に alert が出ない');
    assert.ok(rules, 'setConfig が呼ばれた');
    assert.equal(rules.length, 2);

    const r2 = rules[1];
    const sub = r2.then.items.find((i) => i.field === '明細.品名');
    assert.equal(sub.op, 'not_empty');
    assert.equal(sub.message, '品名必須');

    // 全体が保存前と一致（id / name / enabled / if / then）
    assert.deepEqual(rules, before);
  });
});

describe('削除済みフィールドの既存値保持', () => {
  test('IF: field=削除済みフィールド, op=eq, value=ABC が維持される', async () => {
    const ui = await loadConfigScreen({ rules: legacyRules() });
    const { rules } = await ui.save();
    const c = rules[1].if.conds.find((x) => x.field === '削除済みフィールド');
    assert.deepEqual(c, { field: '削除済みフィールド', op: 'eq', value: 'ABC' });
  });

  test('THEN: field=削除済みフィールド, op=eq, value=ABC, message が維持される', async () => {
    const ui = await loadConfigScreen({ rules: legacyRules() });
    const { rules } = await ui.save();
    const t = rules[1].then.items.find((x) => x.field === '削除済みフィールド');
    assert.deepEqual(t, { field: '削除済みフィールド', op: 'eq', value: 'ABC', message: '削除済み' });
  });

  test('日付比較の基準フィールドがサブテーブル内でも値が維持される', async () => {
    const ui = await loadConfigScreen({ rules: legacyRules() });
    const { rules } = await ui.save();
    const t = rules[1].then.items.find((x) => x.field === '契約終了日');
    assert.equal(t.op, 'gte_date');
    assert.deepEqual(JSON.parse(t.value), JSON.parse(dateValue));
  });

  test('削除済みフィールドで候補外 operator（any_in）も保持される', async () => {
    const rules = [{
      id: 'r001', name: 'x', enabled: true,
      if: { logic: 'AND', conds: [] },
      then: { items: [{ field: '削除済み選択肢', op: 'any_in', value: 'A,B', message: 'm' }] }
    }];
    const ui = await loadConfigScreen({ rules });
    const opSel = ui.thenRows(ui.ruleCards()[0])[0].querySelector('.then-op');
    assert.equal(opSel.value, 'any_in');
    const saved = await ui.save();
    assert.deepEqual(saved.rules[0].then.items[0], { field: '削除済み選択肢', op: 'any_in', value: 'A,B', message: 'm' });
  });
});

describe('正常フィールドは従来通り', () => {
  test('新規候補にサブテーブル内フィールドが含まれない', async () => {
    const ui = await loadConfigScreen({ rules: legacyRules() });
    const sel = ui.thenRows(ui.ruleCards()[0])[0].querySelector('.then-field');
    const values = ui.optionValues(sel);
    assert.ok(values.includes('顧客名'));
    assert.ok(!values.some((v) => v.startsWith('明細.')), 'サブテーブル内フィールドが候補に無い');
  });

  test('operator 候補: 文字列(1行) は eq/neq/in/includes/not_includes のみ（一時オプションなし）', async () => {
    const ui = await loadConfigScreen({ rules: [] });
    const row = ui.thenRows(ui.ruleCards()[0])[0];
    ui.change(row.querySelector('.then-field'), '顧客名');
    const ops = ui.optionValues(row.querySelector('.then-op'));
    assert.deepEqual(ops, ['eq', 'neq', 'in', 'includes', 'not_includes']);
    assert.ok(!Array.from(row.querySelector('.then-op').options).some((o) => o.textContent.includes('現在使用できない')));
  });

  test('operator 切替: フィールド変更で候補が型に応じて切り替わる（NUMBER → DATE）', async () => {
    const ui = await loadConfigScreen({ rules: [] });
    const row = ui.thenRows(ui.ruleCards()[0])[0];
    ui.change(row.querySelector('.then-field'), '金額');
    assert.deepEqual(ui.optionValues(row.querySelector('.then-op')), ['eq', 'neq', 'lte', 'gte']);
    ui.change(row.querySelector('.then-field'), '契約開始日');
    assert.deepEqual(ui.optionValues(row.querySelector('.then-op')), ['eq_date', 'neq_date', 'lte_date', 'lt_date', 'gte_date', 'gt_date']);
    assert.equal(row.querySelector('.then-op').value, 'eq_date');
  });

  test('保存: 正常ルールは読み込み前と同じ内容で保存される', async () => {
    const ui = await loadConfigScreen({ rules: legacyRules() });
    const { rules } = await ui.save();
    assert.deepEqual(rules[0], legacyRules()[0]);
  });

  test('保存: 演算子を変更して保存すると新しい値になる（通常操作）', async () => {
    const ui = await loadConfigScreen({ rules: legacyRules() });
    const row = ui.thenRows(ui.ruleCards()[0])[0]; // 契約書 has_file
    ui.change(row.querySelector('.then-op'), 'no_file');
    const { rules } = await ui.save();
    assert.equal(rules[0].then.items[0].op, 'no_file');
  });

  test('候補内の保存済み operator には一時オプションが付かない', async () => {
    const ui = await loadConfigScreen({ rules: legacyRules() });
    const opSel = ui.thenRows(ui.ruleCards()[0])[0].querySelector('.then-op');
    assert.equal(opSel.value, 'has_file');
    assert.ok(!Array.from(opSel.options).some((o) => o.textContent.includes('現在使用できない')));
  });
});

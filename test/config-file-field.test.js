'use strict';

// 設定画面: 添付ファイル（FILE）型を新規候補から除外し、既存の添付ファイル設定は保持する

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { loadConfigScreen } = require('./helpers/load-config');

const FILE_OPS = ['has_file', 'no_file', 'file_includes', 'file_not_includes'];

function fileRules() {
  return [{
    id: 'r001', name: '添付ルール', enabled: true,
    if: { logic: 'AND', conds: [
      { field: '契約書', op: 'has_file', value: '' },
      { field: '契約区分', op: 'any_in', value: '新規' }
    ] },
    then: { items: [
      { field: '契約書', op: 'has_file', value: '', message: 'ファイルあり' },
      { field: '契約書', op: 'no_file', value: '', message: 'ファイルなし' },
      { field: '契約書', op: 'file_includes', value: '契約', message: '含む' },
      { field: '契約書', op: 'file_not_includes', value: '下書き', message: '含まない' },
      { field: '顧客名', op: 'not_empty', value: '', message: '顧客名必須' }
    ] }
  }];
}

describe('新規設定: FILE 型は候補に出ない', () => {
  test('IF のフィールド候補に FILE 型（契約書）が無く、通常フィールドはある', async () => {
    const ui = await loadConfigScreen({ rules: [] });
    const sel = ui.ifRows(ui.ruleCards()[0])[0].querySelector('.if-field');
    const values = ui.optionValues(sel);
    assert.ok(!values.includes('契約書'), 'FILE 型が候補に無い');
    assert.ok(values.includes('顧客名'));
    assert.ok(values.includes('契約区分'));
    assert.ok(values.includes('契約開始日'));
  });

  test('THEN のフィールド候補に FILE 型が無く、通常フィールドはある', async () => {
    const ui = await loadConfigScreen({ rules: [] });
    const sel = ui.thenRows(ui.ruleCards()[0])[0].querySelector('.then-field');
    const values = ui.optionValues(sel);
    assert.ok(!values.includes('契約書'));
    assert.ok(values.includes('顧客名'));
    assert.ok(values.includes('備考'));
  });

  test('サブテーブル内フィールドも引き続き候補に無い', async () => {
    const ui = await loadConfigScreen({ rules: [] });
    const sel = ui.thenRows(ui.ruleCards()[0])[0].querySelector('.then-field');
    assert.ok(!ui.optionValues(sel).some((v) => v.startsWith('明細.')));
  });
});

describe('既存設定: 添付ファイル設定は保持される', () => {
  test('読み込みでクラッシュせず、契約書が「現在使用できないフィールド」として表示される', async () => {
    const ui = await loadConfigScreen({ rules: fileRules() });
    const card = ui.ruleCards()[0];
    const rows = ui.thenRows(card);
    assert.equal(rows.length, 5);
    const first = rows[0];
    assert.equal(first.querySelector('.then-field').value, '契約書');
    assert.match(ui.selectedText(first.querySelector('.then-field')), /現在使用できないフィールド/);
  });

  FILE_OPS.forEach((op, i) => {
    test(`THEN ${op}: field / operator / value / message が読み込み時に保持される`, async () => {
      const ui = await loadConfigScreen({ rules: fileRules() });
      const row = ui.thenRows(ui.ruleCards()[0])[i];
      assert.equal(row.querySelector('.then-field').value, '契約書');
      assert.equal(row.querySelector('.then-op').value, op);
      assert.equal(row.nextElementSibling.querySelector('.then-message').value, fileRules()[0].then.items[i].message);
    });
  });

  test('IF の添付条件（契約書 has_file）も保持される', async () => {
    const ui = await loadConfigScreen({ rules: fileRules() });
    const row = ui.ifRows(ui.ruleCards()[0])[0];
    assert.equal(row.querySelector('.if-field').value, '契約書');
    assert.equal(row.querySelector('.if-op').value, 'has_file');
  });

  test('そのまま保存しても rules 全体が不変（4 演算子の field/op/value/message、ルール名、IF、他 THEN）', async () => {
    const ui = await loadConfigScreen({ rules: fileRules() });
    const { rules, alert } = await ui.save();
    assert.equal(alert, null);
    assert.deepEqual(rules, fileRules());
  });
});

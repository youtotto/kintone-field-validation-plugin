# Field Validation Plugin for kintone

kintoneレコードに対して、  
**IF / THEN形式の条件付き入力チェック** をGUIで設定できるプラグインです。

JavaScriptを書かずに、業務ルールに応じた柔軟なバリデーションを設定できます。

---

# ✨ 主な機能

- IF / THEN形式による条件付き入力チェック
- 複数条件（AND / OR）対応
- 複数THEN（検証）対応
- kintone標準に近い条件設定UI
- 日付比較（今日基準 / 任意日付フィールド基準）
- 添付ファイルチェック
- ステータス条件対応
- エラー時の条件詳細パネル表示

<img width="1874" height="871" alt="スクリーンショット 2026-05-15 165551" src="https://github.com/user-attachments/assets/9c6b032d-ba7b-460e-a3e4-8a22cc9ab0c3" />

---

# 📷 イメージ

## IF条件

```text
IF
ステータス が 「申請中」
AND
契約区分 が 「新規」
```

<img width="1660" height="530" alt="image" src="https://github.com/user-attachments/assets/b5366059-6c66-4a69-9774-b030c9b33f08" />

## THEN検証

```text
THEN
契約書添付 は ファイルあり
開始日 は 今日以降
```

<img width="1702" height="835" alt="image" src="https://github.com/user-attachments/assets/62e4e67a-52e3-464a-83ba-2f3e0c747426" />

---

# ✅ 対応フィールド

| フィールド | 対応 |
|---|---|
| 文字列（1行） | ✅ |
| 文字列（複数行） | ✅ |
| 数値 | ✅ |
| 日付 | ✅ |
| 日時 | ✅ |
| ドロップダウン | ✅ |
| ラジオボタン | ✅ |
| チェックボックス | ✅ |
| 複数選択 | ✅ |
| 添付ファイル | ✅ |
| ステータス | ✅ |
| リンク | ✅ |

---

# 🧩 日付比較機能

日付型フィールドでは、以下のような比較が可能です。

## 演算子

- ＝（等しい）
- ≠（等しくない）
- ≦（以前）
- ＜（より前）
- ≧（以降）
- ＞（より後）

## 比較基準

- 今日
- 任意の日付フィールド

## オフセット

```text
今日から 3日後
申請日から -7日前
```

など。

<img width="1570" height="209" alt="image" src="https://github.com/user-attachments/assets/f3cae5f9-7cf9-4004-a030-0a610b0e11cf" />

---

# 🖥 エラー表示

保存時に条件を満たさない場合、

- 対象フィールドへエラー表示
- 条件詳細パネル表示

を行います。

<img width="1905" height="911" alt="スクリーンショット 2026-05-15 165722" src="https://github.com/user-attachments/assets/827fca87-426d-40c6-9f72-05cf0e796aaa" />

<img width="572" height="231" alt="スクリーンショット 2026-05-15 165730" src="https://github.com/user-attachments/assets/38fde56e-f68a-4d48-8c19-9c8f7f8fe3b3" />

---

# 📦 インストール方法

1. ReleaseからZIPファイルをダウンロード
2. kintone管理画面 → プラグイン
3. ZIPファイルを読み込み
4. アプリへ適用

---

# 📁 ディレクトリ構成

```text
src/
├── manifest.json
├── config.html
├── js/desktop.js
├── js/config.js
└── image/icon.png
```

---

# ⚠ 制限事項

現在、以下は未対応です。

- サブテーブル
- 関連レコード
- カテゴリー条件
- リアルタイム入力チェック

---

# 🚀 今後の予定

- サブテーブル対応
- 条件グループ化
- 入力補正
- AIによる条件生成
- ルックアップ連携
- 関連レコード条件

---

# 📄 License

MIT License

---

# 👤 Author

Nest Rec

- Website: https://www.nestrec.com
- GitHub: https://github.com/

---

# 💡 このプラグインについて

kintoneでは、業務ごとに独自の入力チェックJavaScriptが作られることが多くあります。

このプラグインは、

- 条件付きバリデーションの標準化
- GUI化
- 保守性向上

を目的として開発しています。

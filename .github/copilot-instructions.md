# Copilot Instructions — Totonoe Log

プロジェクト方針の**正**（source of truth）は
[`.claude/CLAUDE.md`](../.claude/CLAUDE.md)。このファイルは従であり、
二重管理を避けるため内容はそちらに一本化している。作業前に必ず
`.claude/CLAUDE.md` を読むこと。方針を変更するときも `.claude/CLAUDE.md` を
更新する（このファイルには方針本文を書かない）。

最低限の前提だけ再掲する：

- VSCode 拡張機能「Totonoe Log」。コンセプトは「バラバラなログを、調査しやすい
  時系列に整える」（Normalize, merge, filter, collapse, and compare messy logs）
- 1 issue = 1 PR で `main` にマージしていく。`main` への直接 push はしない
- ビルド・テスト・CI・変更時のルール（CHANGELOG 2言語運用、README 同期、
  `contributes.commands` 登録など）の詳細は `.claude/CLAUDE.md` を参照

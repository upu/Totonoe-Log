---
name: ship
description: 既存のGitHub issueをこのリポジトリのGitHub Flowに沿って一気通貫で実装する——issueを読み、最新mainからブランチを切り、テストを先に書いてから実装し、PRを開き、CIが green になり、Copilotレビューを確認したらsquash-mergeする。既存issueに取り掛かりたいときに使う（例:「/ship 18」「issue 18 をやって」「#16 に取り掛かる」）。
argument-hint: <issue番号>
---

# Ship Issue

既存のGitHub issueを、このリポジトリのGitHub Flowに沿ってマージ済みPRまで進める。`main` は保護されており、`test` CIチェックがgreenのPRを通してのみ変更が入る。

`$ARGUMENTS` はshipするissue番号。空の場合は `gh issue list` を実行してどのissueをshipするか確認する。

## 手順

1. **issueを読む** — `gh issue view $ARGUMENTS` を実行する。タイトルと受け入れ基準を復唱し、スコープを明確にする。issueが既にクローズ済み、またはスコープが曖昧な場合は、コーディングを始める前にユーザーに確認する。
   - **マイルストーン確認** — issueにマイルストーンが付いておらず（`gh issue view $ARGUMENTS --json milestone`）、オープンなマイルストーンがちょうど1つ存在する場合（`gh api "repos/:owner/:repo/milestones?state=open" --jq '.[].title'`）、そのマイルストーンにissueを割り当てる（`gh issue edit $ARGUMENTS --milestone <title>`）。オープンなマイルストーンが複数ある場合は、どれに割り当てるか（またはどれにも割り当てないか）をユーザーに確認する。
2. **最新mainからブランチを切る** — `git fetch origin` の後、`git checkout -b <type>/<slug> origin/main` を実行する。必ず `origin/main` から切り、古いローカルブランチからは切らない。`feat/`・`fix/`・`docs/`・`ci/`・`refactor/` などの種別プレフィックス付きの分かりやすい名前を使う。ファイルを触る前にこれを行い、`git branch --show-current` で新しいブランチ名が表示されること（`main` ではないこと）を確認してから手順3に進む。この確認は必須とする——issueを読んでからすぐ編集に入ると、特に同じセッションで直前の `/ship` を終えた直後に、`main` へ直接コミットしてしまう事態が起きやすい。
3. **テストを先に書く** — issueの受け入れ基準の各項目を、`src/test/suite/extension.test.ts`（または関連するテストファイル、例: `src/test/suite/normalize.test.ts`）内の1つ以上のテストケースに翻訳し、実装コードに触れる前に*意図した*挙動に対して書く。`npm run compile && npm run build && npm test` を実行し、新しいテストが期待通りの理由で失敗する（挙動がまだ存在しないためred）ことを確認する。`npm test`（vscode-test）は `npm run build` が生成する `out/extension.js` を前提にするため、`build` を挟まないとビルド成果物不足で落ちてしまい、「意図した理由でred」を確認するという目的を果たせない。タイポのような無関係なエラーで失敗していないことも確認する。テスト対象の挙動が無い変更（純粋なdocs/CI/雑務のissue）の場合のみこの手順を省略し、その旨を明示的に述べる。
4. **実装する** — 編集対象のファイルと周辺コードを読んでから編集する。失敗しているテストを最小限の変更で通す。issueのスコープ内に変更を留める——無関係な改善点に気づいたら、このissueを広げるのではなく別issueとして提案する。周辺のコードスタイルに合わせ、コメントは最小限にする（行番号への言及や、コード・テスト名が既に表している内容を繰り返すだけのコメントは避ける）。`src/**/*.ts` を編集する場合は `.github/instructions/ts-comments.instructions.md` のルールにも従う。
5. **CHANGELOGを更新する** — ユーザー影響のある変更（新機能、バグ修正、挙動やデフォルトの変更、設定の追加・変更、非推奨化、ユーザーが体感するパッケージング/性能の変更）であれば、`CHANGELOG.md`（英語、正）と `CHANGELOG.ja.md`（同じ内容の日本語訳）**両方**の `[Unreleased]` セクションに、Keep a Changelogの適切なグループ（Added / Changed / Deprecated / Removed / Fixed / Security）で一行追記する。`[Unreleased]` 配下にまだそのグループの見出しが無ければ作成する。見出し自体は両ファイルとも英語のままにする。人間が読むための変更内容の要約を書き、コミットログの一行そのものにはしない。片方のファイルだけ更新するのは避ける——リリース時に2つの `[Unreleased]` セクションがずれていると不整合の原因になる。ユーザー影響のない変更（内部リファクタ、ビルド/CI、テスト、ドキュメント、Claudeスキル等）の場合はこの手順を省略し、PRでCHANGELOG追記が不要である旨を述べる。
6. **テスト（ゲート）** — `npm run compile` → `npm run build` → `npm test` → `npm run check:package` を順に実行する。これはCIの `test` ジョブが毎PRで実行する内容そのものなので（`.github/workflows/ci.yml` 参照）、ローカルでgreenならCIも通るはず。`npm run build` は `npm test`（拡張機能の読み込みに `out/extension.js` が必要）と `npm run check:package`（パッケージ内容チェック）の両方が使う成果物を1回だけ生成するためのステップなので、`npm test` や `npm run check:package` の前に個別ビルドし直さない（二重ビルドを避ける）。全て通ること。手順3で書いたテストが今はgreenであることを確認する。redなら直す——ビルドが失敗した状態でPRを開かない。
7. **コミットする** — `git status` / `git diff` で意図した変更だけがステージされていることを確認し、リポジトリのスタイル（日本語の要約行）で、末尾に `Closes #$ARGUMENTS` を付けてコミットする。
8. **プッシュ & PR** — `git push -u origin <branch>` の後、`gh pr create --base main` で `.github/pull_request_template.md` の構成（概要・変更・チェック）に沿った本文を書き、末尾に `Closes #$ARGUMENTS` を付ける。テストが通ったこと、CHANGELOGを追記した（またはN/Aである）ことをチェック欄に反映する。
9. **CIを待つ** — `gh pr checks --watch --fail-fast 2>&1 | Select-Object -Last 5; if ($LASTEXITCODE -ne 0) { throw "PR checks failed" }` を、長めのタイムアウト（例: 600秒 / 10分）を付けた単一のフォアグラウンド呼び出しとして実行する（この環境はPowerShell専用でbashツールは無いため、bash構文の `set -o pipefail` は使わない。PowerShellはパイプを挟んでもネイティブコマンドの終了コードを `$LASTEXITCODE` にそのまま保持するので、`if ($LASTEXITCODE -ne 0) { throw ... }` で失敗を確実に検知できる）。`gh pr checks`/`gh pr merge`/`gh pr view` はPR番号を省略するとカレントブランチに紐づくPRを自動解決するので、`<branch>`（手順2で切ったブランチ）にいる限り番号の受け渡しを気にする必要はない——複数のPRを並行して扱っていてカレントブランチが目的のPRと一致しない場合のみ `--repo <owner>/<repo> <pr番号>` を明示する。この呼び出しは全チェックが終わるまで1コマンドでブロックし、いずれかが失敗すると非ゼロで終了する。`Select-Object -Last 5` が重要——`--watch` は10秒ごとにチェック表全体を再出力するため、そのままだとセッションのコンテキストを埋めてしまう。1つの自己完結した呼び出しのままにする——バックグラウンドで発火して後のターンで再開する、という運用はしない。チェックが失敗したら、実行ログを確認し、直してから再度プッシュする。`test` が一向にチェック一覧に現れず、無関係なチェックだけが完了する場合、そのPRは `origin/main` と `mergeable: CONFLICTING` の可能性が高い——GitHubは競合しているPRに対して `test` ワークフローの起動を失敗ではなく黙ってスキップする。`gh pr view --json mergeable` で確認し、該当すれば最新の `origin/main` にrebaseして解消し、force-pushして再度watchする。
10. **Copilotレビューが有効か判定してから待つ** — Copilotの自動コードレビューはリポジトリ／PRごとの設定でON/OFFが切り替わるため、まず「そもそもレビューがリクエストされているか」を確認してから待つかどうかを決める。ポーリングを始める前に必ず1回、次の単一呼び出しで現在の状態を判定する:
    ```powershell
    $pr = gh pr view --json reviewRequests,reviews | ConvertFrom-Json
    $pending = $pr.reviewRequests | Where-Object { $_.login -eq 'copilot-pull-request-reviewer' -or $_.name -eq 'Copilot' }
    $copilotReview = $pr.reviews | Where-Object { $_.author.login -eq 'copilot-pull-request-reviewer' } | Select-Object -Last 1
    $everRequested = if ($pending -or $copilotReview) { $true } else {
      (gh api repos/{owner}/{repo}/issues/<PR番号>/timeline --paginate | ConvertFrom-Json) |
        Where-Object { $_.event -eq 'review_requested' -and $_.requested_reviewer.login -like '*copilot*' } |
        Select-Object -First 1
    }
    ```
    （`gh pr view --json reviewRequests` はGUIの「Reviewers」欄と同じ情報、timelineの `review_requested` イベントはGUIの「requested review from Copilot due to automatic review settings」という履歴と同じ情報に対応する。）
    - **`$pending` も `$copilotReview` も `$everRequested` も全て無い** → このPRではCopilotレビューが一度もリクエストされていない（自動レビュー設定がOFF、またはCopilotがreviewerから外されている）。待たずにこのステップを省略し、その旨を報告に含める。
    - **`$copilotReview` が既にある（`$pending` は無い）** → レビューはもう完了している。待たずにそのまま次のCopilotレビュー内容の判断に進む。
    - **`$pending` がある（レビュー中）** → 以下のように単一のフォアグラウンド呼び出しでポーリングして完了を待つ（バックグラウンド発火や後のターンでの再開はしない）:
      ```powershell
      $deadline = (Get-Date).AddMinutes(8)
      do {
        $pr = gh pr view --json reviewRequests,reviews | ConvertFrom-Json
        $pending = $pr.reviewRequests | Where-Object { $_.login -eq 'copilot-pull-request-reviewer' -or $_.name -eq 'Copilot' }
        $copilotReview = $pr.reviews | Where-Object { $_.author.login -eq 'copilot-pull-request-reviewer' } | Select-Object -Last 1
        if ($copilotReview -and -not $pending) { break }
        Start-Sleep -Seconds 15
      } while ((Get-Date) -lt $deadline)
      $copilotReview | ConvertTo-Json -Depth 6
      ```
      `timeout`（8分）に達してもレビューが確認できない場合は、その旨をユーザーに伝えた上でマージに進んで良い（レビューは非同期でも後から届く）。
    - Copilotのレビューが手に入ったら（上記いずれの分岐でも）本文とインラインコメントを読み、次のいずれかを判断する:
      - 単なる提案・nit・スタイルの指摘のみ → 内容をユーザーに一言報告し、そのままマージへ進む（必要なら別issueとしてフォローアップを提案する）。
      - 実際のバグ・見落とし・スコープ内の問題を指摘している → 追加コミットで修正し、手順6（テストのゲート）をやり直し、`git push` して手順9（CI待ち）からやり直す。
11. **マージする** — `gh pr merge --squash --delete-branch` を実行する（許可されているマージ方式はsquash/rebaseのみ）。その後 `git checkout main && git pull` でローカルの `main` を同期する。
12. **報告する** — マージされたPR番号、`Closes #N` によりissueが自動クローズされたこと、新しい `main` のコミット、Copilotレビューの結果（あれば）を述べる。

## 補足

- `main` はルールセットで保護されている: 直接push・force-push・削除は不可。green な `test` チェックを持つPRが必須。`main` へ直接pushしようとしない。
- `test` チェックは `windows-latest` 上で動き、`@vscode/test-cli` 経由でVS Codeを起動するため1〜2分かかる——これは想定内の待ち時間であり、ハングではない。
- 1 issue = 1 PR。実装途中でスコープが膨らんだら、別issue/別PRに分割する。
- このスキルは既に存在するissueが対象。ユーザーがissue化されていない新規の作業内容を説明してきた場合は、まず `gh issue create` を提案してからshipする。
- CI待ち・Copilotレビュー待ち・マージの手順は、ツール呼び出しの構文ミスでセッションが止まりやすい箇所。事後に「発火していないことに気づく」ことに頼らず、各手順を半端に発火できない構造にする——手順9の `gh pr checks --watch`、手順10のポーリングループ、手順11の `gh pr merge` は、それぞれ1つの自己完結したフォアグラウンド呼び出しにし、後のターンで再開することを前提にしたバックグラウンド発火はしない。
- 手順2を飛ばして変更がローカル `main` に乗ってしまったことに気づいた場合（`git branch --show-current` や `git status -sb` で確認できる）、`main` に一切pushせずに復旧する: まだコミットしていなければ `git checkout -b <branch>` で変更ごと新しいブランチへ移せる。既にコミット済みなら `git branch <branch>` でそのコミットにブランチを立て、`git reset --hard origin/main` でローカル `main` を復元し、`git checkout <branch>` で作業を続ける。

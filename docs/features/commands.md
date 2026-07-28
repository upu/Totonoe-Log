🌐 [日本語](commands.ja.md)

# Command reference

Every command Totonoe Log contributes, with its command ID, where it can be run
from, and what it produces. This page is for looking things up — what each
feature is *for* is explained in the [README](../../README.md), and each entry
links back to the relevant section there.

All commands are prefixed with `Totonoe Log:` in the Command Palette
(`Ctrl+Shift+P`). Settings are written here without their namespace —
`gap.thresholdSeconds` means `totonoeLog.gap.thresholdSeconds` in
`settings.json`.

## At a glance

| Command | ID | Runs from | Operates on |
| --- | --- | --- | --- |
| Show Interactive View | `totonoeLog.showInteractiveView` | Palette, Explorer right-click | Explorer selection, otherwise the active editor |
| Show Normalized View | `totonoeLog.showNormalizedView` | Palette | Active editor |
| Show Normalized View Filtered | `totonoeLog.showNormalizedViewFiltered` | Palette | Active editor |
| Show Collapsed View | `totonoeLog.showCollapsedView` | Palette | Active editor |
| Merge Selected Files | `totonoeLog.mergeSelectedFiles` | Explorer right-click (also palette \*) | Two or more selected files |
| Merge Selected Files Filtered | `totonoeLog.mergeSelectedFilesFiltered` | Explorer right-click (also palette \*) | Two or more selected files |
| Compare Logs | `totonoeLog.compareLogs` | Palette | Two files picked from a dialog |
| Copy Masked Text | `totonoeLog.copyMaskedText` | Palette | Active editor's selection, or the whole file |
| Go to Source Line | `totonoeLog.goToSourceLine` | Palette, editor right-click | Cursor line of a normalized / merged view |
| Go to Source Line | `totonoeLog.goToSourceLineFromInteractiveView` | Interactive View right-click only | Right-clicked line of the panel |

\* The two `Merge Selected Files` commands are contributed to the Command
Palette like the rest, so they are listed there — but the palette gives them no
Explorer selection to work with, so running them that way only produces a
warning. Treat Explorer right-click as the way to run them.

Two commands share the title **Go to Source Line** because they are the same
action in two different surfaces. The Interactive View one is hidden from the
Command Palette (`when: false`), so only the other appears there.

## Where commands appear

- **Command Palette** — every command except
  `totonoeLog.goToSourceLineFromInteractiveView`, with the
  `Merge Selected Files` caveat noted above.
- **Explorer right-click** — `Merge Selected Files` and
  `Merge Selected Files Filtered` on a multi-file selection
  (`listMultiSelection`), and `Show Interactive View` on anything that is not a
  folder (`!explorerResourceIsFolder`).
- **Editor right-click** — `Go to Source Line`, only on the read-only views
  Totonoe Log produces (`totonoe-log-normalized` and `totonoe-log-merged`).
- **Interactive View right-click** — `Go to Source Line`, on a log line of the
  panel.

None of the commands has a default keybinding. To bind one, use the command ID
from the table above in **Preferences: Open Keyboard Shortcuts (JSON)**.

## Commands that read the active editor

`Show Normalized View`, `Show Normalized View Filtered`, `Show Collapsed View`,
`Copy Masked Text`, and `Show Interactive View` (when run without an Explorer
selection) all read the log from the active editor, unsaved changes included.
They refuse to run on Totonoe Log's own read-only views and warn instead —
re-parsing an already formatted view would misread it.

---

### Show Interactive View

`totonoeLog.showInteractiveView`

- **Runs from** — Command Palette; Explorer right-click on one or more
  non-folder entries.
- **Input** — the Explorer selection when there is one (folders in the
  selection are skipped); otherwise the active editor.
- **Output** — a Webview panel. Only one panel exists at a time: running the
  command again reveals and reloads the existing one rather than opening a
  second.
- **Notes** — "+ Add Files..." loads more logs into the same panel; with two or
  more files loaded the panel switches to a merged display. "Export as Virtual
  Document" writes the current state out as a read-only tab, which is how you
  reach `Ctrl+F`, `Compare Logs`, and results larger than the display cap.
- **Settings** — `interactiveView.maxDisplayLines`, `collapse.threshold`,
  `gap.thresholdSeconds`, `copyMasked.*` (the mask panel's initial selection),
  plus the parsing and display settings listed under
  [Settings that apply to every command](#settings-that-apply-to-every-command).
  Changing any of them updates an open panel right away.
- **Details** — [Interactive View](../../README.md#interactive-view).

### Show Normalized View

`totonoeLog.showNormalizedView`

- **Runs from** — Command Palette.
- **Input** — the active editor.
- **Output** — a read-only virtual document (`totonoe-log-normalized` scheme),
  opened as a tab named `<source>.normalized-N.log`. `N` increments so repeated
  runs on the same file never collide with an existing tab.
- **Settings** — `gap.thresholdSeconds`, plus the common parsing and display
  settings.
- **Details** — [Normalize into one timeline](../../README.md#normalize-into-one-timeline).

### Show Normalized View Filtered

`totonoeLog.showNormalizedViewFiltered`

- **Runs from** — Command Palette.
- **Input** — the active editor, then a multi-select picker asking which
  conditions to use (severity, date/time range, ignore pattern), followed by one
  prompt per chosen condition. Cancelling any step, or entering something
  invalid, aborts without opening anything. Confirming the picker without
  choosing a condition opens the view unfiltered.
- **Output** — a read-only virtual document as above, named
  `<source>.filtered-N.log`, plus a notification reporting how many lines were
  hidden.
- **Notes** — date/time boundaries are entered in the timezone chosen by
  `timezone.display`, so you can paste the wall-clock part of a timestamp as it
  appears in a view. If a pattern takes too long to evaluate, the command warns
  and opens nothing rather than falling back to unfiltered output.
- **Settings** — `gap.thresholdSeconds`, plus the common parsing and display
  settings.
- **Details** — [Filter out the noise](../../README.md#filter-out-the-noise).

### Show Collapsed View

`totonoeLog.showCollapsedView`

- **Runs from** — Command Palette.
- **Input** — the active editor.
- **Output** — a read-only virtual document named `<source>.collapsed-N.log`,
  where runs of consecutive repeats are folded into one line carrying a repeat
  count and the group's timestamp span.
- **Notes** — gap markers are not inserted in this view. To see every original
  line, open `Show Normalized View` separately.
- **Settings** — `collapse.threshold`, plus the common parsing and display
  settings.
- **Details** — [Collapse repeated lines](../../README.md#collapse-repeated-lines).

### Merge Selected Files

`totonoeLog.mergeSelectedFiles`

- **Runs from** — Explorer right-click on a multi-file selection. The command
  is also listed in the Command Palette, but it has no selection to work with
  there and only warns.
- **Input** — the selected files, folders excluded. Fewer than two files left
  after excluding folders produces a warning and nothing else. The selection may
  span folders. Each file is read from disk and decoded with VS Code's
  resource-scoped `files.encoding`.
- **Output** — a read-only virtual document (`totonoe-log-merged` scheme) named
  `merged-N.log`, with source file name and file "kind" columns. Hovering the
  file name column shows the full source path.
- **Notes** — results of 50 MiB or more are written to extension-managed
  temporary storage and opened as a regular text tab instead, which bypasses VS
  Code's document synchronization limit. Editing that copy never touches the
  source logs, and it is deleted once the tab closes. `Go to Source Line` does
  not work on those large results, because the line mapping it needs is only
  registered for virtual documents.
- **Settings** — `gap.thresholdSeconds`, plus the common parsing and display
  settings. `timezone.fileOffsets` and `clockSkew.fileOffsets` matter most here,
  since they are what make logs from different servers merge into true
  chronological order.
- **Details** — [Merge multiple files](../../README.md#merge-multiple-files).

### Merge Selected Files Filtered

`totonoeLog.mergeSelectedFilesFiltered`

- **Runs from** — Explorer right-click on a multi-file selection; same palette
  caveat as `Merge Selected Files`.
- **Input** — the same selection rules as above, then the same condition picker
  and prompts as `Show Normalized View Filtered`. Filtering happens after the
  merge.
- **Output** — a read-only virtual document named `merged-filtered-N.log`.
- **Settings** — the same as `Merge Selected Files`.
- **Details** — [Merge multiple files](../../README.md#merge-multiple-files).

### Compare Logs

`totonoeLog.compareLogs`

- **Runs from** — Command Palette.
- **Input** — two files, each chosen from its own file-open dialog. Cancelling
  either dialog aborts.
- **Output** — VS Code's own diff editor over two read-only virtual documents
  (`totonoe-log-compare` scheme), with timestamps and other volatile parts
  masked so date and host differences do not flood the diff.
- **Notes** — `Go to Source Line` does not work on compare views; they carry no
  line mapping. To diff what you narrowed down in Interactive View, press its
  "Export as Virtual Document" first and run this command on the resulting tabs.
  Because timestamps are masked out entirely, `timezone.*` and
  `clockSkew.fileOffsets` have no effect here.
- **Settings** — `timestampFormats`.
- **Details** — [Compare two logs](../../README.md#compare-two-logs).

### Copy Masked Text

`totonoeLog.copyMaskedText`

- **Runs from** — Command Palette.
- **Input** — the active editor's selection, or the whole document when nothing
  is selected.
- **Output** — masked text on the clipboard. The raw log's own formatting is
  preserved; only the masked spans are replaced. Nothing is opened.
- **Settings** — `copyMasked.maskTimestamp`, `copyMasked.maskHost`,
  `copyMasked.maskProcessId`, and `timestampFormats`. Unlike the view commands,
  this one does not apply `timezone.sourceOffset` or `clockSkew.fileOffsets` —
  it rewrites the original text in place rather than rebuilding a timeline.
- **Details** — [Compare two logs](../../README.md#compare-two-logs) and the
  [Settings](../../README.md#settings) table.

### Go to Source Line

`totonoeLog.goToSourceLine`

- **Runs from** — Command Palette; editor right-click, offered only on
  `totonoe-log-normalized` and `totonoe-log-merged` documents.
- **Input** — the cursor's line in one of those views.
- **Output** — opens the original log file at the corresponding line.
- **Notes** — three cases end in a message instead of a jump: the active editor
  is not a Totonoe Log view; the view has no line mapping (a compare view, or a
  view whose content was released — reopen it by re-running its command); or the
  line is generated rather than parsed, such as a gap marker.
- **Details** — [Merge multiple files](../../README.md#merge-multiple-files).

### Go to Source Line (Interactive View)

`totonoeLog.goToSourceLineFromInteractiveView`

- **Runs from** — right-clicking a log line inside the Interactive View panel
  only. It is deliberately hidden from the Command Palette, because it needs the
  clicked line passed in as context and has nothing to act on otherwise.
- **Input** — the right-clicked line.
- **Output** — opens the original log file at the corresponding line.
- **Notes** — double-clicking a line does the same thing. A single click never
  jumps, so selecting text stays safe. Generated lines such as gap markers have
  no original line, and a collapsed group's header keeps its expand/restore
  click instead.
- **Details** — [Interactive View](../../README.md#interactive-view).

---

## Settings that apply to every command

These affect how logs are parsed and rendered, so they apply to all view
commands rather than to any single one (see
[Settings](../../README.md#settings) for the full table):

| Setting | Effect |
| --- | --- |
| `totonoeLog.timestampFormats` | Adds timestamp formats the built-ins don't recognize. Tried first, so it can override a built-in interpretation. |
| `totonoeLog.timezone.sourceOffset` | The UTC offset assumed for timestamps written without one. |
| `totonoeLog.timezone.fileOffsets` | Per-file-name-pattern overrides of the above. |
| `totonoeLog.timezone.display` | The timezone every view renders timestamps in, and the one date/time prompts are read in. |
| `totonoeLog.clockSkew.fileOffsets` | Shifts a file's timestamps by ±N seconds to correct a host whose clock was wrong. |

`Compare Logs` and `Copy Masked Text` are the exceptions: both mask or rewrite
the original text instead of building a timeline, so only `timestampFormats`
applies to them.

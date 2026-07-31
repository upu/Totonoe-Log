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
| Open in Virtual Document | `totonoeLog.openVirtualDocument` | Palette, Explorer right-click | Explorer selection, otherwise the active editor |
| Set Filter | `totonoeLog.setViewFilter` | Palette, editor right-click | The active normalized / merged view tab |
| Compare Logs | `totonoeLog.compareLogs` | Palette | Two files picked from a dialog |
| Copy Masked Text | `totonoeLog.copyMaskedText` | Palette | Active editor's selection, or the whole file |
| Go to Source Line | `totonoeLog.goToSourceLine` | Palette, editor right-click | Cursor line of a normalized / merged view |
| Go to Source Line | `totonoeLog.goToSourceLineFromInteractiveView` | Interactive View right-click only | Right-clicked line of the panel |

`Show Interactive View` and `Open in Virtual Document` resolve their input by
exactly the same rules; the only difference is where the result goes (a Webview
panel or a read-only virtual document). Both switch to the merged display for
two or more files, so **you never have to pick a command based on how many
files you selected**.

Two commands share the title **Go to Source Line** because they are the same
action in two different surfaces. The Interactive View one is hidden from the
Command Palette (`when: false`), so only the other appears there.

## Where commands appear

- **Command Palette** — every command except
  `totonoeLog.goToSourceLineFromInteractiveView`.
- **Explorer right-click** — `Open in Virtual Document` and
  `Show Interactive View` on anything that is not a folder
  (`!explorerResourceIsFolder`). A single selected file is enough.
- **Editor right-click** — `Go to Source Line` and `Set Filter`, both only on
  the read-only views Totonoe Log produces (`totonoe-log-normalized` and
  `totonoe-log-merged`).
- **Interactive View right-click** — `Go to Source Line`, on a log line of the
  panel.

None of the commands has a default keybinding. To bind one, use the command ID
from the table above in **Preferences: Open Keyboard Shortcuts (JSON)**.

## Commands that read the active editor

These commands read the log from the active editor, unsaved changes included:

- `Copy Masked Text`
- `Open in Virtual Document`, when run without an Explorer selection
- `Show Interactive View`, when run without an Explorer selection

They refuse to run on Totonoe Log's own read-only views and warn instead —
re-parsing an already formatted view would misread it.

Note that **the same file is read differently depending on the route**: run
from an Explorer selection, the content comes from disk, so unsaved edits in an
open editor for that file are not reflected. To include them, focus that editor
and run the command from the Command Palette.

`Set Filter` is the mirror image: it runs **only** on Totonoe Log's own views.
Rather than re-reading the source log, it re-applies conditions to the
unfiltered entries the view kept hold of.

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

### Open in Virtual Document

`totonoeLog.openVirtualDocument`

- **Runs from** — Command Palette, or Explorer right-click on any non-folder
  item (one or many).
- **Input** — the Explorer selection when there is one (folders excluded),
  otherwise the active editor. A selection holding only folders leaves nothing
  to open and warns rather than falling back to the active editor, which would
  open a log unrelated to what you selected.
- **Output** — one file gives a normalized view (`totonoe-log-normalized`
  scheme, tab named `<source>.normalized-N.log`); two or more give a merged
  view (`totonoe-log-merged` scheme, tab named `merged-N.log`) with source file
  name and file "kind" columns, where hovering the file name column shows the
  full source path. `N` increments so repeated runs never collide with an
  existing tab.
- **Notes** — via the Explorer, each file is read from disk and decoded with VS
  Code's resource-scoped `files.encoding`, and the selection may span folders.
  Merged results of 50 MiB or more are written to extension-managed temporary
  storage and opened as a regular text tab instead, which bypasses VS Code's
  document synchronization limit. Editing that copy never touches the source
  logs, and it is deleted once the tab closes. `Go to Source Line` and
  `Set Filter` do not work on those large results, because the information they
  need is only registered for virtual documents.
- **Settings** — `gap.thresholdSeconds`, plus the common parsing and display
  settings. When merging several files, `timezone.fileOffsets` and
  `clockSkew.fileOffsets` matter most, since they are what make logs from
  different servers merge into true chronological order.
- **Details** — [Normalize into one timeline](../../README.md#normalize-into-one-timeline),
  [Merge multiple files](../../README.md#merge-multiple-files).

### Set Filter

`totonoeLog.setViewFilter`

- **Runs from** — Command Palette, and editor right-click. The context menu
  entry appears only on `totonoe-log-normalized` / `totonoe-log-merged`
  documents.
- **Input** — the active normalized or merged view, then a multi-select picker
  asking which conditions to use (severity, date/time range, ignore pattern),
  followed by one prompt per chosen condition. Cancelling any step, or entering
  something invalid, aborts and leaves the view as it was. Confirming the picker
  without choosing a condition **clears** the filter.
- **Output** — no new tab: the content of the tab you already have open is
  rewritten in place, plus a notification reporting how many lines were hidden.
- **Notes** — each run replaces the filter rather than narrowing the previous
  result; the starting point is always the unfiltered entries, so loosening a
  condition brings lines back. Date/time boundaries are entered in the timezone
  chosen by `timezone.display`, so you can paste the wall-clock part of a
  timestamp as it appears in the view. If a pattern takes too long to evaluate,
  the command warns and leaves the view unchanged rather than falling back to
  unfiltered output.
- **Not supported on** — the compare view, views exported from the Interactive
  View (a snapshot of the panel's display state, collapsing and masking
  included; filter there instead), and merged results of 50 MiB or more that
  opened as an ordinary file tab. All three warn.
- **Settings** — `gap.thresholdSeconds`, plus the common parsing and display
  settings.
- **Details** — [Filter out the noise](../../README.md#filter-out-the-noise).

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

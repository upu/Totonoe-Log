🌐 [日本語](highlight-rules.ja.md)

# Highlight rules

The full shape of the `totonoeLog.highlightRules` setting and how conflicts
between rules are resolved. For what highlighting is *for*, see
[Highlight rules](../../README.md#highlight-rules) in the README.

The setting is a plain array, so you can write it by hand — and commit it to
`.vscode/settings.json` to share your project's patterns with the team:

```json
"totonoeLog.highlightRules": [
  { "name": "OOM", "pattern": "OutOfMemory", "color": "red" },
  { "name": "timeout", "pattern": "timed? ?out", "color": "orange" }
]
```

`pattern` is a case-insensitive regular expression, and every match on a
line is colored, not just the first. `color` is one of `red`, `orange`,
`yellow`, `green`, `blue`, `purple` — a fixed set rather than free-form color
codes, so that a readable value can be used for light and dark themes alike;
it defaults to `yellow`. `name` is only there to tell your own rules apart
and to name the rule in warnings, and defaults to `highlight-<n>`.

When two rules match overlapping text the rule listed first wins, so put the
more specific ones higher — the Interactive View's ▲▼ buttons are for that.
A rule with an invalid regular expression or an unknown color is skipped
with a warning naming it, while the remaining rules keep working; it still
shows up in the panel so you can repair it. Editing the setting by hand
recolors an open panel right away, and the panel writes back to wherever the
rules are already defined (workspace settings if that is where they live,
your user settings otherwise).

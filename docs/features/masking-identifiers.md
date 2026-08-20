🌐 [日本語](masking-identifiers.ja.md)

# Masking your own identifiers

Full behavior of the mask panel's "キー" and "任意パターン" fields, and of
process-ID masking. For the mask panel overview, see
[Masking your own identifiers](../../README.md#masking-your-own-identifiers) in
the README.

**"キー"** is the one to reach for first: list the key names whose values
should go (`user, token`, separated by commas or spaces) and only the values
are replaced, so `user=hoge` becomes `user=<MASKED>` with the key still
readable. It covers `key=value`, `key: value`, and quoted values
(`token="abc"` → `token="<MASKED>"`), matches keys case-insensitively, and
takes them literally, so regex metacharacters and non-ASCII names (`契約ID`)
work as typed; a key that only appears inside a longer one (`superuser=x`
when masking `user`) is left alone.

**"任意パターン"** takes a regular expression and replaces every match with
`<MASKED>`, for anything the key field cannot express. An invalid or
too-slow pattern disables only that one mask, with a warning, while every
other mask keeps working. Both fields apply together, and both are panel
state that is never saved to settings.

Process-ID masking, available here and in `Copy Masked Text`, covers
syslog-style `sshd[1234]:` tags and `pid=1234` / `pid: 1234` / `[pid 1234]`
notations (replaced with `<PID>`), while leaving log4j thread names such as
`[main]` and array indices such as `retries[3]` alone.

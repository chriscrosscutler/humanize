# humanize

An agent skill that finds and removes the patterns that make text read as machine-written. A
catalog of tells with stable ids (W1, S4, …) drives a zero-dependency scanner, a rewrite mode, a
project audit and a hook that flags tells right after Claude writes them.

## Layout

| Path | What it holds |
|---|---|
| `SKILL.md` | The modes (rewrite, check, audit, fix, voice) and the ground rules, loaded on each use |
| `references/` | The catalog (`patterns.md`), tiers per surface (`registers.md`), the voice profile, the audit procedure and the evidence behind each rule |
| `scripts/scan.mjs` | The scanner: plain Node with no dependencies; `--help` prints the flags |
| `scripts/rules.json` | Every rule's id, pattern and tier per register |
| `scripts/hook.mjs` | The PostToolUse hook that reports block hits after a Write or Edit |
| `tests/` | Scanner, rules, hook and catalog drift tests, with fixtures |

## Install

Clone it into Claude Code's skills folder:

```bash
git clone https://github.com/chriscrosscutler/humanize ~/.claude/skills/humanize
```

To flag tells as Claude writes them, add the hook to `~/.claude/settings.json` under
`hooks.PostToolUse` with the matcher `Write|Edit|MultiEdit`:

```json
{ "type": "command", "command": "node ~/.claude/skills/humanize/scripts/hook.mjs 2>/dev/null || true" }
```

## Use

```bash
node ~/.claude/skills/humanize/scripts/scan.mjs --register landing site/index.html
```

In Claude Code, `/humanize <text or path>` rewrites, `/humanize check` reports only, and
`/humanize audit` writes a report on a project's copy. A repo's `.humanize.json` sets registers per
path, exemptions, project rules and dated waivers (`references/audit.md` §7).

## Tests

```bash
node --test
```

Run before each commit. The catalog test fails when `references/patterns.md` and
`scripts/rules.json` drift apart.

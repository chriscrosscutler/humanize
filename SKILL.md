---
name: humanize
description: Strip AI writing patterns from text people read. Rewrites pasted text or a file so it stops reading as machine-written, checks it, audits and fixes a project's copy (landing, store, UI strings, docs, email, release notes, commits, PRs, comments), and keeps a profile of how you write. Use for "humanize", "de-AI", "unslop", "sounds like AI", "make this sound human", text pasted to clean up, a prose or copy audit, and before finalizing any public copy.
---

# /humanize

One catalog of AI writing tells with stable ids (`references/patterns.md`: W1, S4, …), a zero-dependency scanner, and the rules for writing without them. `SCAN` means `node ~/.claude/skills/humanize/scripts/scan.mjs`.

| Invocation | Does |
|---|---|
| `/humanize <text or path>` | Rewrite (the default) |
| `/humanize check <text or path>` | Report only |
| `/humanize audit [path]` | Report on a project's copy to `docs/audits/humanize-<date>.md`. Read `references/audit.md` first |
| `/humanize fix` | Apply the latest audit, surface by surface (`references/audit.md` §6) |
| `/humanize voice <samples>` | Build or refresh your profile (`references/voice.md`) |

## Ground rules, every mode

1. Facts, numbers, names, quotes, links and code survive verbatim.
2. Never invent a fact, number, quote, anecdote or opinion to sound human (K6). A missing specific is a question for the author.
3. No detector games: no planted typos, slang, homoglyphs, invisible characters or random rhythm.
4. Cut before replacing. Most fixes are deletions, and a synonym swap is a tell of its own.
5. The register sets the tiers (`references/registers.md`). Project rules win over these.
6. Legal and consent text, quoted text and git history are reported, never rewritten.

## Rewrite

1. **Register.** Take it from the path or from where the user says the text goes. Pasted text with nowhere named is `prose`, or `landing` when it sells something (a product pitch, a call to action). When two registers fit, use the stricter. Ask only when the destination changes the rules and can't be inferred.
2. **Scan.** `SCAN --register <r> <path>`, or pipe pasted text to `SCAN --stdin --register <r>`.
3. **Judge.** Read the judgment section of `references/patterns.md` (S23 to S31, K1 to K6), then read the input once for those tells.
4. **Rewrite.** Fix every block hit. Fix every warn hit unless its entry's "Leave:" line covers it (`SCAN --explain S3` prints the entry). Then fix the judgment findings. Fill each gap from "What to put back" and the profile in `references/voice.md`, with facts from the source text or the project (code, docs, product brief) only. A gap nothing fills stays open and becomes a question in step 7.
5. **Re-scan** the result until it has zero block hits.
6. **Last pass.** Read it as a skeptical reader: what still sounds machine-written? Fix that.
7. **Return** the text in the input's format. Edit a file in place unless told otherwise. Then add at most two lines: what changed, by family ("cut 3 chatbot lines, 4 hype words, 2 'not X but Y'"), and the specifics the original lacked ("says 'much faster': what's the number?").

`check` runs steps 1 to 3 and reports a table (line, id, text, fix) plus judgment findings, with no rewrite.

## Writing new text

Text other people read follows the Writing block in `~/.claude/CLAUDE.md`. The six moves that prevent most tells:

1. Open with the point. End when the content ends: no summary, zinger or offer.
2. Name the actor and the mechanism. No hype word, and no "AI" as a selling point.
3. No chatbot residue: openers, sign-offs, edit commentary, "I hope this helps".
4. No stock shapes: "not X but Y", "No X. No Y. Just Z.", staged reveals, reflexive threes, ", highlighting…" tails.
5. No em or en dashes in user-facing text.
6. A specific beats a general claim: a number, a name, a file. Ask rather than invent.

Before committing public copy, `SCAN` it to zero block hits.

## Scanner

- `SCAN --help` lists the flags. Exit 0 clean, 1 on a block hit or an expired waiver, 2 on a usage or config error.
- `--github` prints hits as GitHub Actions annotations; `action.yml` and `.pre-commit-hooks.yaml` wrap the scanner as a gate (`references/audit.md` §7).
- `SCAN --explain ID` shows one rule, its tier in every register and its catalog entry with the "Leave:" cases; `--list-rules --register R` shows them all.
- `--summary` and `--json` are for audits; `--git-log N` reads commit messages; `--comments` adds code comments. A phrase that repeats on one line reports once, marked ×n (`count` in the JSON).
- A repo's `.humanize.json` holds path registers, exemptions, tier overrides, project rules and waivers with a reason and an expiry (`references/audit.md` §7). The scanner reads the nearest one above the first path, or above the working directory with `--stdin`; `--no-config` ignores it.
- A PostToolUse hook runs `scripts/hook.mjs` after each Write or Edit and reports block hits in the text just added. It never blocks a write. It skips `~/.claude`, plans, memory, scratchpad, audits, fixtures, `node_modules` and the agent and ledger files (CLAUDE.md, TODO.md and the like), and stays silent when it fails, so a quiet hook proves nothing: `SCAN` the file. `HUMANIZE_HOOK=off` turns it off.
- `node --test` from this folder runs the tests, including the catalog drift check.

## References

- `references/patterns.md`: the catalog, the judgment pass and what is not a tell.
- `references/registers.md`: tiers and writing rules per surface.
- `references/voice.md`: what to put back, your profile, the voice mode.
- `references/audit.md`: audit, fix and gate wiring.
- `references/sources.md`: evidence and calibration numbers.

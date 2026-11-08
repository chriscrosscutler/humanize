---
name: humanize
description: Strip AI writing patterns from text people read. Rewrites pasted text or a file so it stops reading as machine-written, checks it, audits and fixes a project's copy (landing, store, UI strings, docs, email, release notes, commits, PRs, comments), and keeps a profile of how you write. Use for "humanize", "de-AI", "unslop", "sounds like AI", "make this sound human", text pasted to clean up, a prose or copy audit, and before finalizing any public copy.
---

# /humanize

One catalog of AI writing tells with stable ids (`references/patterns.md`: W1, S4, …), a zero-dependency scanner, and the rules for writing without them. `SCAN` means `node ~/.claude/skills/humanize/scripts/scan.mjs`, and `GUARD` means `node ~/.claude/skills/humanize/scripts/guard.mjs`.

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

1. **Register.** Take it from the path or from where the user says the text goes. Pasted text with nowhere named is `prose`, or `landing` when it sells something (a product pitch, a call to action). When two registers fit, use the stricter. Ask only when the destination changes the rules and can't be inferred. With `--judge` and no `--register`, Jev names the register of pasted text; the report's `register:` note says what it picked or why it didn't.
2. **Scan.** `SCAN --judge --register <r> <path>`, or pipe pasted text to `SCAN --judge --stdin`. Save pasted text to a scratch file first; step 6 needs it. `--judge` asks Jev (see "Jev" below) the judgment questions and drops warn hits that are literal uses to info.
3. **Judge.** Jev hits carry `source: "jev"` and count like regex hits. Read the judgment section of `references/patterns.md` (S23 to S32, K1 to K10), then read the input for the tells the `jev:` row lists as unsettled or not checked, plus S29, K2 and K6, which Jev never answers in a scan. Without `--judge`, read the input for every judgment tell.
4. **Rewrite.** Fix every block hit. Fix every warn hit unless its entry's "Leave:" line covers it (`SCAN --explain S3` prints the entry). Then fix the judgment findings. Fill each gap from "What to put back" and the profile in `references/voice.md`, with facts from the source text or the project (code, docs, product brief) only. A gap nothing fills stays open and becomes a question in step 9.
5. **Re-scan** the result until it has zero block hits. Jev answers for unchanged sections come from the cache.
6. **Fact guard.** `GUARD compare <original> <rewrite> --register <r> --jev-untrusted`. A K6 block hit is a number, name, link or code span the rewrite added: restore the original or turn it into a question. A dropped warn is a point the rewrite lost: put it back unless it was filler. Jev's rows (info, since its questions have not passed the stress run) name rewrite sentences whose claim the original may not make: check each against the original. Exit 3 means Jev could not answer, so check the claims by hand; the literal check still ran.
7. **Polish.** When a sentence or headline still has a hit after two passes, write up to three versions to files and run `GUARD pick --register <r> <a> <b> [<c>]`. Use the version it names. When it names none, choose yourself.
8. **Last pass.** Read it as a skeptical reader: what still sounds machine-written? Fix that.
9. **Return** the text in the input's format. Edit a file in place unless told otherwise. Then add at most two lines: what changed, by family ("cut 3 chatbot lines, 4 hype words, 2 'not X but Y'"), and the specifics the original lacked ("says 'much faster': what's the number?").

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

## Jev

`--judge` and `GUARD` send text to TypeSafe's Jev API, which answers yes-or-no and pick-one questions with a probability; code turns 0.7 and above into yes and 0.3 and below into no, and anything between goes to you. Only questions that passed the held-out stress run (`scripts/jev-trust.json`) act; `--jev-untrusted` shows the rest as info.

- Key: `TYPESAFE_API_KEY` in the environment, or the macOS keychain item of that name. No key means a `jev: no_key` row and the 1.1.0 behavior.
- Off: `HUMANIZE_JEV=0`, `"jev": false` in `.humanize.json`, or `--no-jev`. Legal, commit, PR, comment and chat text is never sent. The hook, the Action and pre-commit never call Jev.
- Cost: under $0.002 per 1,000 words, or under $0.01 with `--jev-untrusted` (measured in `references/sources.md`); `--jev-budget` caps a run (default $0.05). Answers are cached in `~/.cache/humanize/jev`.
- A failed call is "not checked", never a no.

## References

- `references/patterns.md`: the catalog, the judgment pass and what is not a tell.
- `references/registers.md`: tiers and writing rules per surface.
- `references/voice.md`: what to put back, your profile, the voice mode.
- `references/audit.md`: audit, fix and gate wiring.
- `references/sources.md`: evidence and calibration numbers.

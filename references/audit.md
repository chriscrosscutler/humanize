# Project audit and fix

`/humanize audit [path]` reports and changes nothing. `/humanize fix` applies the latest report, surface by surface, and commits by path. `SCAN` below means `node ~/.claude/skills/humanize/scripts/scan.mjs`, or `scripts/humanize/scan.mjs` where the repo vendors it.

## 1. Read the project's rules first

- `CLAUDE.md`, any copy or design-language doc (casetracker: `docs/design/DESIGN-LANGUAGE.md`, CPY-1 to CPY-24), and the copy rows in the ledger (`docs/TODO.md` where it exists).
- An existing `.humanize.json` and the last `docs/audits/humanize-*.md`. A new audit says what changed since the last one.
- The facts the copy rests on: the product brief (`PRODUCT.md`, `docs/product/`), the README and any store listing in the repo. K2 in §4 checks claims against these and the code.
- Project rules win. Note every conflict with these defaults; the fix is a `.humanize.json` entry, not an argument.

## 2. Inventory the surfaces

List what people read, with its register (`registers.md`), before scanning anything.

| Stack | Surfaces |
|---|---|
| Web, Astro, Next | `site/`, `src/pages/`, `public/*.html`, `app/**/page.tsx` (landing); component text (ui); `emails/` (email); JSON-LD in `<script type="application/ld+json">`, scanned with the page and kept equal to the visible FAQ and description |
| Swift (iOS, macOS) | strings in `Text`, `Label`, `Button`, `.alert` (ui); `*.xcstrings`, `*.strings` (ui); `fastlane/metadata/**` (store) |
| Expo, React Native | `*.tsx` (ui); store metadata folders (store); OTA and release notes (release) |
| Any | `README`, `docs/` (docs); `CHANGELOG` with Unreleased first (release); privacy and terms (legal, report only) |
| Dev text | `--git-log 50` (commit); PR bodies (pr); code comments with `--comments` |

A directory scan skips agent and ledger files (`CLAUDE.md`, `AGENTS.md`, `HANDOFF.md`, `MEMORY.md`, `TODO.md`); name one by path if people outside the project read it.

The scanner can't see some surfaces. Read them by hand:
- Permission purpose strings: `plutil -p Info.plist | grep UsageDescription`, or the `infoPlist` and `permissions` blocks in `app.json` / `app.config.ts`. Pipe the values to `SCAN --stdin --register ui`.
- PR bodies: `gh pr list --state all --limit 20 --json number,title,body`, then `SCAN --stdin --register pr`.
- Astro `{…}` expressions and strings built at runtime.
- Copy that lives outside the repo: the live App Store listing, a checkout page, emails in a provider. List them as owner reads; never sign in to fetch them.

## 3. Scan (zero agent tokens)

```
SCAN --summary <surfaces…>
SCAN --json <surfaces…> > <scratchpad>/humanize.json
SCAN --git-log 50 --summary
```

`--summary` gives per-file counts and the census; `--json` gives every hit with its line, tier, excerpt and fix, plus a `count` when the phrase repeats on its line. Keep the JSON in the scratchpad, never in the repo. Run `--git-log` on a whole-repo audit only, not when the user names paths. Triage in this order: block hits; warn hits on the high-traffic surfaces; census outliers (sentence spread under 0.3 on a long page, many dashes per 1,000 words).

## 4. Judgment pass

Read in full only the highest-traffic surfaces, in this order: landing hero and first screen, store subtitle and first three lines, onboarding, paywall, permission prompts, errors and empty states, transactional email, README intro. Check each against S23 to S31 and K1 to K6 in `patterns.md`. K2 means opening the code behind each claim: a claim with no code behind it is a finding, whatever its wording. Check claims in this order: everything above the fold; then prices and limits, platforms and versions, privacy, and numbers. Stop after about 20 claims, or once ten in a row hold up, and label the K2 rows a spot check.

Do this inline. A repo with more than about 150K tokens of copy may justify a workflow under your global budget rules (disjoint lenses, at most 4 agents, every finder carrying evidence and a refutation attempt, no verify phase).

## 5. Report

Write `docs/audits/humanize-<YYYY-MM-DD>.md` in the audited repo. Terse tables, no prose report.

```
# humanize audit: <repo>, <date>

Scanner: <n> block, <n> warn in <n> files (<n> words). Project config: <.humanize.json summary, or none>.
Snapshot: <git sha>, plus the files that were dirty at scan time.

| Surface | File:line | Id | Tier | Text | Fix |
|---|---|---|---|---|---|

Judgment (S23 to S31, K1 to K6):
| Surface | File:line | Id | Finding | Fix |
|---|---|---|---|---|

Facts only the owner has: <claim>, <file:line>, needs <what>.
Conflicts with project rules: <rule>, <how .humanize.json encodes it>.
Reported, not rewritten: legal and consent text, quotes, names, git history.
```

Sort rows by surface traffic, then tier. Every row quotes its flagged phrase, and only that, so the row still finds its text after lines move. A warn hit left alone on purpose several times in one file is one row: rule, file, count and the reason.

## 6. Fix

`/humanize fix` reads the newest report.

1. Work one surface at a time, highest traffic first. Rewrite only the flagged sentences and the context they need, with the rewrite procedure in `SKILL.md`: cut first, name the mechanism, invent nothing.
2. Never edit legal or consent text, quoted text, names (products, people, trademarks), code identifiers, string keys or git history. In localized apps, change the source language only and add a ledger row to retranslate the rest.
3. A claim that needs a fact only the owner has stays as it is, with a ledger row naming the fact.
4. After each surface, re-scan it to zero block hits, then run the gates the project has (typecheck, tests, `pnpm lint:fast`). Copy changes break snapshot tests.
5. Commit by path, one commit per surface: `git commit -- <paths>`. Write the subject in the project's style and cite the ids: "Landing hero names the sorting mechanism instead of hype words (humanize W3, F1)".
6. A hit that is right as written (a product name, a required disclosure) gets a waiver in `.humanize.json` with a reason and an expiry no more than six months out. Never waive a real tell to get a gate green.

## 7. Wire the gate

For any repo that ships copy:

1. Vendor `scan.mjs` and `rules.json` into `scripts/humanize/`. Zero dependencies; tested on Node 25.
2. Add `"lint:prose": "node scripts/humanize/scan.mjs --quiet ."` to `package.json` and chain it into `lint:fast`, so pre-push and CI both run it. The default skip list drops tests, fixtures and build output, and the scanner never scans its own files, so a new repo is green on arrival.
3. Add `.humanize.json` at the repo root (below); exempt internal docs there.
4. When the skill's rules change, re-vendor: `for f in scan.mjs rules.json; do cmp -s scripts/humanize/$f ~/.claude/skills/humanize/scripts/$f || echo "$f drifted"; done` shows drift. CI runs the vendored copy.

A repo on GitHub can skip the vendoring: `uses: chriscrosscutler/humanize@<tag>` runs the scanner with `--github`, so each hit lands as an annotation on its line, and its `commits` input scans a range of commit messages. `.pre-commit-hooks.yaml` offers `humanize` for files and `humanize-commit-msg` for the message.

Exit codes: 0 clean, 1 on a block hit or an expired waiver, 2 on a usage or config error.

`.humanize.json`, every key optional:

```json
{
  "paths": [["marketing/**/*.md", "landing"]],
  "exempt": ["tests/fixtures/**", "docs/audits/**"],
  "rules": { "W9": "block", "F2": { "registers": { "docs": "info" } } },
  "custom": [{ "id": "Q1", "words": ["checkout"], "fix": "Say Buy.", "registers": { "ui": "block" } }],
  "waivers": [{ "rule": "S13", "path": "site/index.astro", "reason": "registered tagline", "expires": "2027-04-30" }]
}
```

- `paths` map globs to registers ahead of the defaults. `exempt` skips files. `rules` overrides a tier everywhere or per register. `custom` adds project rules with ids Q1, Q2, …, house kind and warn tier unless set. `waivers` need all four fields; an expired one fails the run.
- Inline markers for one-off cases: `humanize-ignore` (this line), `humanize-ignore-next-line`, `humanize-ignore-start` … `humanize-ignore-end`, `humanize-ignore-file`. Each takes optional ids: `<!-- humanize-ignore-next-line W3 -->`. Prefer a waiver with an expiry for anything that should not last forever.

## 8. Ledger

Owner-owed items go in the project's ledger (`docs/TODO.md` where it exists), one checkbox line each with what, any ordering, and done-when: facts only the owner has, live copy outside the repo, legal text that reads badly, locales to retranslate.

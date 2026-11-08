<a href="https://chockstonelabs.com/apps/?utm_source=github&utm_medium=readme&utm_campaign=humanize#skills">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/banner-dark.png">
    <img alt="humanize, a Claude Code skill by Chockstone Labs. Finds what makes text read as machine-written." src=".github/readme/banner-light.png" width="100%">
  </picture>
</a>

<p align="center">
  <a href="#install"><b>Install</b></a>&nbsp;&nbsp;·&nbsp;&nbsp;
  <a href="#what-it-catches"><b>What it catches</b></a>&nbsp;&nbsp;·&nbsp;&nbsp;
  <a href="#use"><b>Use</b></a>&nbsp;&nbsp;·&nbsp;&nbsp;
  <a href="#compared-with-other-humanizers"><b>Compared</b></a>&nbsp;&nbsp;·&nbsp;&nbsp;
  <a href="https://chockstonelabs.com/?utm_source=github&utm_medium=readme&utm_campaign=humanize"><b>Chockstone Labs</b></a>
</p>

<p align="center">
  <img alt="Claude Code skill" src="https://img.shields.io/badge/Claude_Code-skill-4A47F5?style=flat-square&labelColor=0A1A8C">
  <img alt="103 rules" src="https://img.shields.io/badge/rules-103-4A47F5?style=flat-square&labelColor=0A1A8C">
  <img alt="14 registers" src="https://img.shields.io/badge/registers-14-4A47F5?style=flat-square&labelColor=0A1A8C">
  <img alt="Apache 2.0 license" src="https://img.shields.io/badge/license-Apache_2.0-4A47F5?style=flat-square&labelColor=0A1A8C">
  <img alt="Node, no dependencies" src="https://img.shields.io/badge/Node-no_dependencies-7A2CF0?style=flat-square&labelColor=0A1A8C">
</p>

<br>

humanize finds the patterns that make text read as machine-written, and Claude rewrites them.
Each pattern in the catalog has a stable id (C1, P1, S4, W1), so a hit in a review or a commit
message points at one rule and its fix. The scanner is a single Node file with no dependencies,
and a rewrite keeps every fact, number, name, quote and link as it was.

## What it catches

A landing page draft from the test fixtures, scanned (24 block hits, five shown):

```console
$ node scripts/scan.mjs --register landing tests/fixtures/ai-landing.md
tests/fixtures/ai-landing.md:1  P7 block  "Unlock Your Full Potential"  → Name the actual task or outcome in plain words.
tests/fixtures/ai-landing.md:3  P1 block  In today's fast-paced digital world: "In today's fast-paced digital world, managing your photos can feel…"  → Delete the scene-setting; open with the specific point.
tests/fixtures/ai-landing.md:5  S1 block  It's not just a photo organizer, it's: "…you to take control of your library. It's not just a photo organizer, it's a game-changer."  → State what it is. Drop the straw man it is not.
tests/fixtures/ai-landing.md:13  S4 block  No subscriptions. No cloud. Just: "No subscriptions. No cloud. Just your photos."  → Say what it does in one sentence; list the absences only if a reader asked.
…
tests/fixtures/ai-landing.md:19  C1 block  Certainly!: "Certainly! Here's a revised version of the text.…"  → Delete the opener and start with the answer.
humanize: 24 block, 5 warn in 1 file, 136 words. Exit 1.
```

And rewritten, with only the facts the draft already had:

```diff
- In today's fast-paced digital world, managing your photos can feel
- overwhelming. That's where Capysort comes in — a smart, seamless solution
- designed with you in mind.
- No subscriptions. No cloud. Just your photos.
+ Capysort groups the duplicates in your photo library. Your photos never
+ leave your device, and there is no subscription.
```

The catalog has seven families:

| Family | Catches | Example |
|---|---|---|
| **C** Chatbot residue | Openers, sign-offs, edit commentary | `Certainly!` `I hope this helps` |
| **P** Stock phrases | Scene-setting and stock promises | `In today's fast-paced digital world` |
| **S** Structure | Stock sentence shapes | `It's not just X, it's Y` `No X. No Y. Just Z.` |
| **F** Format | Dashes in copy, Title Case headings, bold-label bullets | `Sort photos — fast.` |
| **H** Hedging and filler | Padding and wordy connectors | `Due to the fact that` |
| **W** Words | Hype and AI-era vocabulary | `delve` `tapestry` `seamless` |
| **X** Dev text | Commit and PR habits | `This commit introduces` `Bug fixes and performance improvements` |

A phrase can be fine in an essay and wrong on a store listing, so each rule has a tier (block,
warn or info) in each of 14 registers: landing, store, ui, docs, email, social, release, commit,
pr, comment, legal, essay, chat and prose. The scanner picks the register from the file path.

## Install

In Claude Code, as a plugin with its hook:

```text
/plugin install humanize --marketplace chriscrosscutler/humanize
```

Claude Code before 2.1.275 takes two lines: `/plugin marketplace add chriscrosscutler/humanize`,
then `/plugin install humanize@humanize`. The plugin answers to `/humanize:humanize`. The hook
reports block hits in the text Claude just wrote and never blocks a write.

To answer to `/humanize` instead, clone it into the skills folder:

```bash
git clone https://github.com/chriscrosscutler/humanize ~/.claude/skills/humanize
```

A clone needs the hook added by hand, in `~/.claude/settings.json` under `hooks.PostToolUse`
with the matcher `Write|Edit|MultiEdit`:

```json
{ "type": "command", "command": "node ~/.claude/skills/humanize/scripts/hook.mjs 2>/dev/null || true" }
```

## Use

In Claude Code:

| Command | Does |
|---|---|
| `/humanize <text or path>` | Rewrites the text, or the file in place |
| `/humanize check <text or path>` | Reports hits without rewriting |
| `/humanize audit [path]` | Writes a report on a project's copy to `docs/audits/` |
| `/humanize fix` | Applies the latest audit, one surface at a time |
| `/humanize voice <samples>` | Builds a profile of how you write, used to fill gaps in a rewrite |

From a shell or a CI job:

```bash
node ~/.claude/skills/humanize/scripts/scan.mjs --register landing site/index.html
```

The scanner exits 0 when clean, 1 on a block hit and 2 on a usage error, so it works as a gate.
`--explain S4` prints one rule with its examples, `--git-log 20` reads commit messages, and
`--json` feeds other tools. A repo's `.humanize.json` sets registers per path, exemptions, project
rules and waivers with an expiry date ([references/audit.md](references/audit.md) §7).

In GitHub Actions, each hit becomes an annotation on its line in the pull request:

```yaml
- uses: actions/checkout@v4
  with: { fetch-depth: 0 }
- uses: chriscrosscutler/humanize@v1.2.0
  with:
    paths: site docs README.md
    commits: origin/main..HEAD
```

With [pre-commit](https://pre-commit.com), the second hook reads the commit message (install it
with `pre-commit install --hook-type commit-msg`):

```yaml
- repo: https://github.com/chriscrosscutler/humanize
  rev: v1.2.0
  hooks:
    - id: humanize
    - id: humanize-commit-msg
```

## Judgment checks with Jev

Some tells take judgment: an opening that buries its point, a store listing whose first lines
never say what the app does, an error message with no next step. With `--judge`, the scanner
asks [TypeSafe's Jev model](https://docs.typesafe.ai) these as yes-or-no questions and gets a
probability back. Code reads 0.7 and above as yes and 0.3 and below as no, and Claude reads
anything between. Each pick-one question is asked twice with the options reversed, and a split
answer also goes to Claude.

```bash
node scripts/scan.mjs --judge --register store fastlane/metadata/en-US/description.txt
```

- **What acts.** Only checks that passed a stress run on 391 held-out documents: K3 crowd
  claims, K5 deadlines, K8 errors, K10 store openings, S25 closings that decline to pick, and the
  register of pasted text. The rest show as info with `--jev-untrusted`. The numbers and their
  limits are in [references/sources.md](references/sources.md#jev-stress-run).
- **Fact guard.** `node scripts/guard.mjs compare <original> <rewrite>` checks that a rewrite
  added no number, link, name or code span: an added one is a K6 block hit. With
  `--jev-untrusted` it also asks Jev, sentence by sentence, whether the original makes each
  claim; those rows are leads to check until the questions pass the stress run.
- **Claim evidence.** `node scripts/guard.mjs evidence <file> --root <repo> --jev-untrusted`
  finds the code and docs behind each claim in a landing page, store listing or release note,
  skipping other copy, and reports the claims with nothing behind them. Its questions have not
  passed the stress run yet, so each row is a lead to check by reading the snippet.
- **What is sent.** The copy being judged, in sections of up to about 4,000 tokens, plus the
  matched snippets for `evidence`. Legal, commit, PR, comment and chat text is never sent. The
  hook, the Action and pre-commit never call Jev.
- **Key and cost.** `TYPESAFE_API_KEY` from the environment or the macOS keychain. Under $0.002
  per 1,000 words, or $0.01 with `--jev-untrusted`. `--jev-budget` caps a run (default $0.05),
  and answers are cached in `~/.cache/humanize/jev`.
- **Off.** `--no-jev`, `HUMANIZE_JEV=0` or `"jev": false` in `.humanize.json`. Without a key the
  scan runs as before and adds a `jev: no_key` row.
- **Limits.** The stress run's AI store and release drafts come from Claude models only, and
  email, social and ui text was tested on synthetic cases only. A failed call means "not
  checked", never "no".

## Compared with other humanizers

Checked November 1, 2026, against the three most-starred humanizer skills on GitHub.

| | humanize | [humanizer](https://github.com/blader/humanizer) | [stop-slop](https://github.com/hardikpandya/stop-slop) | [avoid-ai-writing](https://github.com/conorbronsdon/avoid-ai-writing) |
|---|---|---|---|---|
| Catalog | 103 rules and 20 judgment checks | 26 patterns | One page of rules | 74 pattern categories |
| Scanner that runs without a model | Node, no dependencies | No | No | An npm package |
| Rules change with the surface | 14 registers, read from the file path | No | No | Context profiles |
| CI gate | GitHub Action, pre-commit, exit codes | No | No | GitHub Action, pre-commit |
| Score | None: each hit names a rule and its fix | None | 1 to 10 on five dimensions | 0 to 100 |

humanize reads copy where an app keeps it: JSX and TSX props, Swift string literals,
`.strings`, `.stringsdict` and `.xcstrings` catalogs, i18n JSON, commit messages and code
comments. A waiver in `.humanize.json` carries a reason and an expiry date, and the scan fails
once it expires. The `audit` mode writes one report for a whole project, ordered by how many
people read each surface, and `fix` works through it.

Where the others are better:

- **humanizer** has 63,000 stars, judges preferred its rewrites in 16 of 16 blind tests, and it
  installs in Codex and Claude.ai too.
- **avoid-ai-writing** is on npm, runs as an MCP server, and works in Codex and Cursor.
- **stop-slop** is one short file you can paste into any model's custom instructions.

## Layout

| Path | What it holds |
|---|---|
| [`SKILL.md`](SKILL.md) | The modes and ground rules, loaded on each use |
| [`references/`](references) | The catalog (`patterns.md`), tiers per register (`registers.md`), the voice profile, the audit procedure and the evidence behind each rule |
| [`scripts/scan.mjs`](scripts/scan.mjs) | The scanner; `--help` prints the flags |
| [`scripts/rules.json`](scripts/rules.json) | Every rule's id, pattern and tier per register |
| [`scripts/hook.mjs`](scripts/hook.mjs) | The PostToolUse hook |
| [`scripts/judge.mjs`](scripts/judge.mjs), [`judge.json`](scripts/judge.json) | The Jev questions, thresholds and the code that asks them |
| [`scripts/jev.mjs`](scripts/jev.mjs) | The Jev client: key lookup, retries, budget and cache |
| [`scripts/guard.mjs`](scripts/guard.mjs) | Fact guard, claim evidence and pick |
| [`scripts/jev-trust.json`](scripts/jev-trust.json) | Which checks act, and the baselines per register, from the stress run |
| [`evals/jev/`](evals/jev) | The stress run, its report and the corpus manifest (ids and URLs, no text) |
| [`tests/`](tests) | Scanner, rules, hook, Jev and catalog drift tests, with fixtures and recorded Jev answers |

## Tests

```bash
node --test
```

The tests run offline on recorded Jev answers; no key or network is needed.

The catalog test fails when `references/patterns.md` and `scripts/rules.json` drift apart.

## License

[Apache 2.0](LICENSE), copyright 2026 Chockstone Labs LLC. A copy or fork keeps the
[NOTICE](NOTICE) file. The license does not cover the Chockstone Labs name or logo.

<br>

<p align="center">
  <a href="https://chockstonelabs.com/?utm_source=github&utm_medium=readme&utm_campaign=humanize"><img src=".github/readme/chockstone.svg" width="44" alt="Chockstone Labs"></a>
</p>
<p align="center">
  Made by <a href="https://chockstonelabs.com/apps/?utm_source=github&utm_medium=readme&utm_campaign=humanize"><b>Chockstone Labs</b></a>, a small app studio in Chagrin Falls, Ohio.<br>
  We also make <a href="https://capnolog.com">Capnolog</a>, <a href="https://spotmeter.app">SpotMeter</a>, <a href="https://capysort.com">Capysort</a> and <a href="https://lightdrills.com">LightDrills</a>, and the <a href="https://github.com/chriscrosscutler/video-edit">video-edit</a> skill.
</p>

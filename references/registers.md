# Registers

A register is the kind of text: who reads it, where, and what a tell costs there. The same sentence can be fine in a chat reply and a block hit on a landing page, so every rule's tier is set per register.

## How the scanner picks one

1. `--register NAME` forces one register for everything scanned.
2. Otherwise each path is matched against globs, first match wins: the project's `.humanize.json` `paths`, then the defaults in `scripts/rules.json`.
3. Text on stdin takes the register its `--label` path would get (`--label site/hero.html` reads as landing).
4. Nothing matched: `prose`.

A hit's tier is the rule's entry for that register, else the rule's default; then the project's override in `.humanize.json` `rules`; then the register's cap (legal never goes above warn). Rules name two groups: `@user` is landing, store, ui, release, email and social; `@dev` is commit, pr and comment.

| Path (default globs, abbreviated) | Register |
|---|---|
| `fastlane/metadata/**`, `app-store/`, `store-listing/`, `play-store/` | store |
| `fastlane/**/release_notes.txt`, `CHANGELOG*`, `WHATS_NEW*`, `RELEASE_NOTES*`, `NEWS*`, `release-notes/` | release |
| `COMMIT_EDITMSG`, `MERGE_MSG`, `SQUASH_MSG`, `TAG_EDITMSG`, and `--git-log` | commit |
| `.github/pull_request_template*` | pr |
| `privacy*`, `terms*`, `eula*`, `tos*`, `cookies*`, `disclaimer*`, `legal/`, `privacy/`, `terms/` | legal |
| `emails/`, `mail/`, `*.mjml` | email |
| html, astro and md under `site/`, `www/`, `landing/`, `web/`, `public/`, `pages/`; any `.astro` or `.html` | landing |
| `.tsx .jsx .vue .svelte .swift .xcstrings .strings .stringsdict .arb`, `locales/`, `i18n/`, string literals in `.ts`/`.js` | ui |
| `docs/**`, `README`, `CONTRIBUTING`, other `.md .txt .rst .adoc` | docs |
| code comments, only with `--comments` | comment |

The scanner does not read `Info.plist` purpose strings, Astro `{…}` expressions or text built at runtime. Read those by hand during an audit.

## prose

The default for pasted text and unmatched paths. Chatbot residue (C1 to C3, C5 to C8, C10, C12), the stock phrases P1, P2 and P7, "No X. No Y. Just Z." (S4), staged reveals (S8), emoji bullets (F8) and invisible characters (F15) block; most other rules warn. P4 and P5 warn here because human tutorials and man pages use them ("It should be noted that", "Let's take a look"; `sources.md`, Calibration). When you know where the text is going, pass `--register` so the right rules apply.

## chat

Messages to a person: Slack, DMs, forum and support replies.
- Lead with the answer. No opener, no sign-off, no offer of more help.
- Format only what has real structure: a list of steps, a command, a table of options.
- "Sure" and "you're right" answer real questions here, so the assistant-residue rules warn instead of block, and most density rules drop to info.

## email

Product and outreach email.
- The subject names the point; the first sentence says why you're writing.
- One ask, with a date or an owner.
- No "I hope this email finds you well" (P10 blocks here) and no "let me know if you have any questions" (C4).
- Sign with a name. A salutation and a sign-off are normal in email; a letter in a PR is not.
- Dashes, hype words, fragment triplets and staged reveals block, as in every user-facing register.

## docs

README, `docs/`, guides and reference.
- The first paragraph says what the project is and who it's for.
- Task headings in sentence case. Steps as a numbered list. Commands in code blocks.
- Link text names the target; never "click here".
- Present tense. Skip "currently", "new" and "latest", which go stale.
- Headings, bullets and tables are normal here, so F10 relaxes. An occasional dash is fine (F2 warns only at density); hype words warn.

## essay

Blog posts, articles and other long-form prose.
- Rhythm counts here: uniform sentence length (S14) and same-opener runs (S22) warn.
- A personal voice, an idiom used on purpose and a strong opinion are all fine.
- Long-form is where the judgment tells show most: orbit-then-reveal (S28), uniform section shape (S29), significance inflation (S24).

## landing

Marketing pages. Dashes (F1), hype words (W2, W3), "AI" as a selling point (W4), unsourced superlatives (P16), fragment triplets (S13), "less X, more Y" (S17), staged reveals (S8) and the other rhetoric shapes block.
- One claim per section, each one traceable to the app's source (K2).
- Name the mechanism: what runs, when, and on what.
- Numbers carry units; claims about the market carry a source and a date.
- No manufactured urgency, carousel, logo wall or rating until it is real (RULES §7).
- The headline says what the product does for whom; the line under it says how.

## store

App Store and Play metadata. App Store Connect limits: name 30 characters, subtitle 30, promotional text 170, keywords 100, description 4,000, What's New 4,000.
- Only the first lines show before "more". Put the main use there.
- Metadata must describe what the app actually does (guideline 2.3). No prices, other apps' names or keyword stuffing (2.3.7). No placeholder text (2.1).
- Screenshot captions follow the same rules, with no dashes and no prices (RULES §7).
- Markdown never renders here; F12 blocks it in .txt files and pasted text. A .md draft's headings are its structure and are left alone.

## ui

In-app strings: labels, buttons, alerts, onboarding, empty states and errors.
- Buttons are verbs that name the action, two to four words ("Move to Trash", not "OK").
- Alert titles say what happened; the message says what to do. Use "OK" only for an alert that just informs (Apple HIG).
- Errors say what failed, why if known, and what to do next, and keep what the person typed. No blame words (P22) and no "Something went wrong" (P20).
- Sentence case. "Please" only when asking for something inconvenient; "sorry" only when the app caused a real problem.
- Device-correct verbs: tap on iOS, click on the Mac.
- An empty state says what goes there and how to add the first one.
- Permission purpose strings say what the app does with the data, with an example (Apple HIG Privacy). Audit them by hand.
- Use "your" sparingly. "We" is a per-project choice (W9).
- String catalogs are checked for Markdown headings only (F12): SwiftUI's `Text` renders bold, links and code from a localized string.

## release

CHANGELOG, What's New and release notes.
- One line per change, most important first, in full sentences.
- Say what changed for the reader: the bug, the screen, the new behavior. "Bug fixes and performance improvements" alone is a vague change note (X2).
- No hype words, dashes or emoji bullets.
- App Store What's New is plain text: F12 blocks Markdown in .txt release notes. CHANGELOG.md and GitHub releases render it.

## commit

Your own commit style wins over the generic guides: a descriptive present-tense sentence, often long, often with an area and a colon ("Ledger: O-33's draft is uploaded and blocked only by…"). Never rewrite a subject into the imperative mood and never enforce a 50/72 limit.
- A body, when there is one, says why.
- "This commit introduces…" blocks (X1). Done-report words (X8), assurance language (X7), letter form (X10) and arrows in prose (F3) warn. Bold, headings and links block (F12); backticks are fine.
- `scan.mjs --git-log 50` reads recent history. History is never rewritten.

## pr

Pull request titles and bodies.
- The title says what changes, in the commit style.
- The body says what and why, how it was tested, and the risk. A one-line change gets a one-sentence body.
- Delete template sections that don't apply instead of filling them with "N/A".
- "This PR introduces…" (X1), "successfully" (X8) and letter form (X10) warn.

## comment

Code comments and docstrings, read only with `--comments`.
- Say why, not what. Delete a comment that restates the line below it (X4).
- Describe the code as it is now; history belongs in the commit message (X9).
- No tutorial voice (X3) and no emoji in log output (X5).
- Block comments are full sentences.

## social

Posts for X, LinkedIn, Bluesky and Threads.
- One idea per post, with the specific thing first.
- One to three hashtags (F16 warns at six).
- No "let that sink in", no counted announcements, no thread-bait openers.
- Dashes, hype words and fragment triplets block.
- Posts show Markdown as typed; F12 blocks it in pasted text and .txt drafts.

## legal

Privacy policy, terms, EULA and consent text. Findings cap at warn and `fix` never edits them. Legal phrasing (herein, shall, in the event that) is not a tell. Report only; the owner decides on any change, with counsel where there is one.

## Project rules win

A repo's own copy rules beat these defaults where they conflict. casetracker's `docs/design/DESIGN-LANGUAGE.md` (CPY-1 to CPY-24) requires the Oxford comma and bans "we", so its `.humanize.json` turns W9 on. Record each conflict in the audit report and encode it in the project's `.humanize.json` rather than arguing it case by case.

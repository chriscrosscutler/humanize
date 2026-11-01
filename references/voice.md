# Voice

Cutting tells leaves gaps. This file says what goes in them, and records how you write so a rewrite sounds like you rather than like a cleaned-up model.

## What to put back

Fill each gap with something the text was missing, never with decoration.

1. **The specific.** The number, the name, the file, the screen, the date. If the source doesn't have it, ask for it or leave the claim out. Never invent one (K6).
2. **The actor.** Who or what does the thing: "Sift moves the photos", not "photos are moved". Where a project bans "we", name the app, the company or the reader.
3. **The mechanism.** What runs, when, and on what. This replaces every hype word.
4. **Rhythm that follows the content.** A long sentence for a chain of reasons, a short one for the result. Vary length because the content varies, never as decoration.
5. **Real hedges only.** One hedge where the uncertainty is real, naming its condition: "Import is slower for libraries over 50,000 photos."
6. **One word per thing.** Repeat the term you chose (S23).
7. **Stop when the content stops.** No summary, zinger or offer at the end.

Worked example, landing register. Tidy and everything it does are invented for this example; never reuse them as facts.

> Before: In today's fast-paced world, your photo library can quickly become overwhelming. Tidy is an AI-powered solution that seamlessly organizes your memories — so you can focus on what truly matters. Say goodbye to clutter!
>
> After: Tidy sorts your Photos library into albums by trip and by person, on your Mac. Tidy moves nothing until you approve the plan.

The era opener (P1) and the marketing template (P9) are gone. "AI-powered" and "seamlessly" (W4, W3) became the mechanism. The dash and "what truly matters" (F1, W6) went with nothing in their place. Every fact in the after text has to come from the product's source (K2); if it doesn't, the rewrite asks instead of guessing.

## Your profile

Seeded on 2026-10-31 from casetracker's copy rules (`docs/design/DESIGN-LANGUAGE.md` CPY-1 to CPY-24), the playbook's RULES §7 and your repos' commit history. `/humanize voice` refreshes it from samples. Project rules still win inside their project.

**Product copy** (UI, store, landing, email), as defaults that a project's own rules override. They bind product copy only; docs and other prose follow the catalog and `references/registers.md`:
- Complete sentences; labels are exempt (CPY-1).
- Name the actor (CPY-2). "We" is banned in casetracker and a per-project choice elsewhere (W9).
- No blame: invalid, illegal, incorrect, "failed to" (CPY-3).
- 25 words or fewer per sentence, and never chain clauses with ", and" (CPY-5).
- A standalone UI line never opens with And, So, Or or But (CPY-8), and no string opens with "It" (CPY-13).
- Never smart, automatic, AI, seamless, effortless, powerful or magic as selling words. Allowed: "renews automatically" and product names such as SmartPhrase (CPY-9, RULES §7).
- The button says exactly what happens (CPY-10).
- Sentence case (CPY-12). Active voice, key word first (CPY-14, CPY-15).
- Parallel lists and one glossary term per concept (CPY-16, CPY-17).
- No idioms; tap on iOS, click on the Mac; "your" sparingly; numerals for numbers (CPY-18 to CPY-21).
- No em or en dashes in user-facing text (RULES §7, CPY-23). Contractions are fine (CPY-24). The Oxford comma is required in casetracker (CPY-22) and a house choice elsewhere.
- Every public claim derives from the app's source; name the mechanism, never the hype word (RULES §7).
- No manufactured urgency, carousel, logo wall or rating until it is real (RULES §7).

**Commit messages:**
- A descriptive present-tense sentence about what is now true: "ChatGPT plugin's brand color meets OpenAI's 2:1 contrast against white (oak, with apricot for dark mode)".
- Often an area and a colon first ("Ledger: …", "Handoff: …"). Long subjects are fine; a semicolon joins related facts.
- Never imperative mood, never a 50/72 limit, never "This commit…".

**Measured** (empty until the first `/humanize voice` run): sample sources and dates, word count, sentence mean and spread, paragraph length, contractions, dashes and semicolons per 1,000 words, and any habits with one quoted line each as evidence.

## The voice mode

`/humanize voice <paths or pasted samples>` builds or refreshes the Measured block.

1. Gather at least 1,500 words you wrote yourself. Prefer text from before 2022-11-30 or text you know no assistant touched. Leave out commits with a `Co-Authored-By: Claude` trailer and anything an assistant drafted.
2. Measure with zero agent tokens: `node scripts/scan.mjs --json --no-config --register <register> <files>` gives each file's census (words, sentences, sentence mean and spread, long and short sentences, paragraph spread, dashes per 1,000 words). Count contractions, semicolons, questions and first person with grep.
3. Read the samples for habits a count misses: how you open, how you disagree, how you hedge, what you never say. Keep a habit only with a quoted line as evidence.
4. Write the Measured block: date, sources, numbers, habits. Replace the old block; keep the seeded rules unless the samples contradict them, and then ask before changing one.
5. Never lift distinctive phrases from the samples into new text. The profile shapes choices; it is not a phrasebook.

Profile rules are style, not tells. They never become block rules here. A project that wants one enforced adds it to its `.humanize.json` as a custom rule (Q1, Q2, …).

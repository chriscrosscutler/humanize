# Sources

What each rule and number rests on. Web pages were read on 2026-10-31 unless a date says otherwise. Tells drift with every model generation, so re-check the measured sources about once a year and retire rules whose signal has faded.

## Numbers cited in this skill

| Claim | Source |
|---|---|
| "delves" rose to about 39.5 times its pre-2023 rate in spring 2024 and fell to about 8 times by mid-2025 | Kobak et al., [arXiv 2406.07016](https://arxiv.org/abs/2406.07016), and the authors' July 2025 update in [berenslab/llm-excess-vocab](https://github.com/berenslab/llm-excess-vocab) |
| Human essays use 0.33 to 17.12 em dashes per 1,000 words (mean 3.23); GPT-4.1 10.62; GPT-5.4 1.43; Claude Opus 4.6 9.09 unconstrained, 0.19 when asked for plain prose | Freeburg, "The Last Fingerprint", [arXiv 2603.27006](https://arxiv.org/abs/2603.27006), March 2026 |
| Per 10,000 words, human against AI: triads 5 and 19, "not just A but B" 1 and 3, bold 2 and 65, Markdown 8 and 90, em dashes 5 against 32 (Anthropic), 45 (OpenAI) and 3 (Gemini 3 Pro) | [Pangram, signs of AI writing](https://www.pangram.com/signs-of-ai-writing) |
| "is genuinely" 1,021 times in Claude Opus 5 articles against 4 in human ones; "less like a … and more like" 125 against 1; classic tells fell 41 to 86% from each family's earliest model to its latest | [Graphite, AI Tells](https://graphite.io/five-percent/research/ai-tells), 2026-09-16, 10,000 articles per source |
| Claude Opus 5 responses average 510 words against 158 for Opus 4.5, with sentences 58% longer; "load-bearing" about twice as frequent | Arena sample of 2026-08-12, reported by [paddo.dev](https://paddo.dev/blog/a-dial-worth-turning/); baselines not stated |
| Three weak signs together show up in about 0.75% of human text | [Wikipedia: WikiProject AI Cleanup](https://en.wikipedia.org/wiki/Wikipedia:WikiProject_AI_Cleanup) |
| People recognized 57% of AI texts and 64% of human ones | Studies cited by [Wikipedia: Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) |
| Seven detectors flagged 61.22% of 91 non-native TOEFL essays as AI | Liang et al., [arXiv 2304.02819](https://arxiv.org/abs/2304.02819) |
| Five heavy LLM users reached about 90% recall with 3.3 to 4.0% false positives; their majority vote missed 1 of 300 articles | Russell, Karpinska and Iyyer, [arXiv 2501.15654](https://arxiv.org/abs/2501.15654) |
| "in order to", "due to the", "as well as" and "the fact that" sit on the human side | [GPTZero, common AI phrases](https://gptzero.me/news/how-to-avoid-common-ai-generated-phrases-in-your-writing/) |
| Newer models stay subtly positive and avoid blatant superlatives | Sussman and Carter, [arXiv 2504.19556](https://arxiv.org/abs/2504.19556), via Wikipedia |

## Measurement studies

- Kobak et al., excess vocabulary in biomedical abstracts, [arXiv 2406.07016](https://arxiv.org/abs/2406.07016) (Science Advances 2025): W1, W8, P3.
- Liang et al., peer reviews, [arXiv 2403.07183](https://arxiv.org/abs/2403.07183); scientific papers, [arXiv 2404.01268](https://arxiv.org/abs/2404.01268); society-wide adoption, [arXiv 2502.09747](https://arxiv.org/abs/2502.09747): W1, W2, W8.
- Juzek and Ward, why ChatGPT delves, [arXiv 2412.11385](https://arxiv.org/abs/2412.11385), and word overuse after alignment, [arXiv 2508.01930](https://arxiv.org/abs/2508.01930): W1.
- Reinhart et al., grammatical features of LLM text, [arXiv 2410.16107](https://arxiv.org/abs/2410.16107) (PNAS 2025): S5, S6, S7.
- Sun et al., idiosyncrasies of model families, [arXiv 2502.12150](https://arxiv.org/abs/2502.12150): F6, F7, F11 (ChatGPT bolds key points; Claude numbers plainly).
- Geng and Trotta, the drop in "is" and "are", [arXiv 2404.08627](https://arxiv.org/abs/2404.08627): S7.
- Clark, Martin and Mahowald, why AI-generated language is hard to understand, [arXiv 2610.29162](https://arxiv.org/abs/2610.29162), 2026-10-21: S21 (inanimate subjects), S28.
- Yakura et al., AI words spreading into speech, [arXiv 2409.01754](https://arxiv.org/abs/2409.01754): why a word alone proves nothing.
- Zhang et al., format preferences, [arXiv 2409.11704](https://arxiv.org/abs/2409.11704): F6, F8, F11.
- Czuma, em dashes in congressional press releases ([arXiv 2608.05889](https://arxiv.org/abs/2608.05889)) and medRxiv preprints ([arXiv 2606.29540](https://arxiv.org/abs/2606.29540)): F2.

## Phrase lists and detectors, with their limits

- [antislop-sampler](https://github.com/sam-paech/antislop-sampler), [slop-forensics](https://github.com/sam-paech/slop-forensics) and the [EQ-Bench creative-writing slop index](https://github.com/EQ-bench/creative-writing-bench): P14 and chat residue. Built from fiction corpora and partly auto-generated, so they stay out of non-fiction tiers.
- [GPTZero AI vocabulary](https://gptzero.me/news/most-common-ai-vocabulary/): word candidates only. Schmalz and Tack ([BEA 2025](https://aclanthology.org/2025.bea-1.71)) found 98 of its 245 terms in a held-out corpus, with weak transfer.
- [Originality.ai](https://originality.ai/blog/obvious-chatgpt-sayings) and Copyleaks phrase tiers: raw counts with no human baseline. Used for examples, never for tiers.

## Community catalogs

- Wikipedia: [Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing), [/Style](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing/Style), [/Markup](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing/Markup), [Signs of AI use in comments](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_use_in_comments): most S and C rules, F5, F12, F14, C7; the ineffective-indicator list behind "Not tells on their own".
- [blader/humanizer](https://github.com/blader/humanizer) v3.1.0, [conorbronsdon/avoid-ai-writing](https://github.com/conorbronsdon/avoid-ai-writing) v3.38.0, [hardikpandya/stop-slop](https://github.com/hardikpandya/stop-slop), [jooray/humanizer](https://github.com/jooray/humanizer), [chi-feng/humanizer](https://github.com/chi-feng/humanizer), [Anbeeld/WRITING.md](https://github.com/Anbeeld/WRITING.md), [tropes.fyi](https://tropes.fyi/directory), [Simon Willison's cliché highlighter](https://tools.simonwillison.net/llm-cliche-highlighter): candidates for S, P and H rules. avoid-ai-writing also documents which word swaps fire on human prose; several stop-slop rules were too broad to keep.
- Claude-era tells: [The Register](https://www.theregister.com/2025/08/13/claude_codes_copious_coddling_confounds/) on "You're absolutely right!" (C2), [slhck on Claudish](https://slhck.info/software/2026/06/22/claudish.html), [Daily AI Digest](https://buttondown.com/dailyaidigest/archive/dad-how-to-combat-claude-slop-93/) on "load-bearing" (W7), [explainx.ai](https://explainx.ai/blog/mannered-prose-prompt-claude-fable-5-1-writing-2026) on mannered prose (S17, S19, S28).
- Dev text: PostHog's skills for [code comments](https://github.com/PostHog/posthog/blob/HEAD/.agents/skills/writing-code-comments/SKILL.md), [user-facing copy](https://github.com/PostHog/posthog/blob/HEAD/.agents/skills/writing-user-facing-copy/SKILL.md) and [PR descriptions](https://github.com/PostHog/posthog/blob/HEAD/.agents/skills/writing-pr-descriptions/SKILL.md); [obra/clank commenting-intent](https://github.com/obra/clank/blob/HEAD/skills/coding/commenting-intent/SKILL.md): X3, X4, X9.

## Style guides (the fix side)

- [GOV.UK writing guidelines](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/) and the [A to Z](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/style-guides/a-to-z-style-guide/): plain words, 25-word sentences, change notes (release register), link text.
- [plainlanguage.gov](https://www.plainlanguage.gov/guidelines/): H1, H2, W5, noun strings and hidden verbs.
- [Google developer documentation style guide](https://developers.google.com/style): word list, present tense, timeless docs, headings, contractions.
- [Microsoft Writing Style Guide](https://learn.microsoft.com/en-us/style-guide/welcome/): simple words, jargon, exclamation points, em dashes (prescribed, which is why F2 counts density only).
- Apple: [HIG Writing](https://developer.apple.com/design/human-interface-guidelines/writing), [Alerts](https://developer.apple.com/design/human-interface-guidelines/alerts), [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons), [Privacy](https://developer.apple.com/design/human-interface-guidelines/privacy); [product page limits](https://developer.apple.com/app-store/product-page/); [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) 2.1 and 2.3: the ui and store registers.
- [Mailchimp Content Style Guide](https://styleguide.mailchimp.com/): word list, voice and tone, email and social.
- Nielsen Norman Group: [error messages](https://www.nngroup.com/articles/error-message-guidelines/) (P20, P22), [UI copy](https://www.nngroup.com/articles/ui-copy/), [tone of voice](https://www.nngroup.com/articles/tone-voice-users/), [cringeworthy words](https://www.nngroup.com/articles/cringeworthy-words/).
- Commits and comments: [cbea.ms](https://cbea.ms/git-commit/), [kernel patches](https://docs.kernel.org/process/submitting-patches.html), [Git SubmittingPatches](https://git-scm.com/docs/SubmittingPatches), [kernel comment style](https://docs.kernel.org/process/coding-style.html), [PEP 8](https://peps.python.org/pep-0008/), [Coding Horror](https://blog.codinghorror.com/code-tells-you-how-comments-tell-you-why/). Your own commit style overrides their imperative-mood rule.

## Calibration

Run on 2026-10-31 against human-written reference documentation installed on this Mac:
- 180 macOS man pages (every 8th page in man1 and every 16th in man8, rendered with `mandoc -T ascii | col -b`, then dedented);
- the 156 vim 9.1 help files (released January 2024; most of the text is decades older);
- the 209 perl 5.34 pods (released May 2021), rendered with `pod2text -i 0`.

That is 545 files and 2.69M words as the scanner counts them, scanned with `--no-config` in the docs, prose and landing registers. Rebuild the corpus from this description; it is not kept anywhere.

Rerun it after any change to a block-tier rule. A block-tier tell that fires on this corpus in docs or prose gets fixed or demoted.

| Register | Block hits before | After |
|---|---|---|
| docs | 2,080: F12 2,061, F15 16, C3 3 | 0 |
| prose | 2,111: the docs hits plus P4 17, P5 8, S8 4, P7 2 | 0 |

Block-tier misfires and the changes:

| Rule | Human text it hit | Change |
|---|---|---|
| F12 | Backtick spans, `__DATA__`, "# comment" lines in .txt docs | Runs only where Markdown shows as typed: commit messages, commit/social/store text that is pasted or in .txt, and .txt release notes. String catalogs are checked for headings only. Backticks and dunder names dropped |
| F15 | A soft hyphen in a character table; `langmap=ΑA,ΒB` | An invisible character between two spaces is left alone. A look-alike needs Latin letters on both sides, or two on one side |
| C3 | "What should I make into a module?" | "Should I" fires only as an offer to continue. "Want me to" fires only at a sentence start |
| S8 | "The result:" ending a line before an example | A colon reveal needs text after it on the same line |
| P7 | "In the realm of hackerdom" | "realm" is left to W1 (warn) |
| P4, P5 | "It should be noted that", "Let's take a look at" in man pages and tutorials | Warn in prose and essay; block stays in landing, store, ui, release and social. P5 no longer matches "let's break" or "let's get started" |

Warn-tier misfires found by scanning the same corpus as landing copy:

| Rule | Human text it hit | Change |
|---|---|---|
| W1 | "underscore", the character (122 of 145 hits); "[-R realm]" | "underscore(s)" dropped; P3 keeps "underscores the importance". A Kerberos or LDAP realm is left |
| W2 | "test harness", "t/harness", "unlock()", "unlock a volume" | "harness" and "unlock" dropped. P7 keeps "harness the power" and "unlock the potential", and now also covers insights, creativity, productivity and opportunities |
| S12 | "from the socket to standard output," after a hard line wrap | Sentence-start rules skip a wrapped line that starts in lowercase |
| S10 | "depending on whether you're reading or writing" | Fires only at a sentence start or after a comma |
| S13 | The initials "R. P. C." | Each fragment needs two letters |
| P9 | "points to the next level", "the ultimate destination" (scp) | "to the next level" needs take, bring or elevate. "Destination" counts only after go-to, one-stop or all-in-one |
| P15 | "a carefully crafted set of hash keys" | Left alone in security contexts |
| S1 | "doesn't really exist, you will get" | The pivot needs it/this/that/they, or a pronoun with a verb; "really" counts only as "really about" |
| S9 | "it is suggested that you indent" | Not before "you" |
| C11 | "in the given context block" | "given" dropped |
| S15 | "get cups api, compiler, directory, and link information" (cups-config) counted as "compiler, directory, and link information" | A triple whose first item follows a comma is the tail of a longer list and no longer counts |
| S15 | "references, data structures, object-oriented programming, and modules" (perlbook) counted from "structures", the second word of a list item | A triple may not start one word after a comma either. The cost: it misses a triple after a lead-in word, as in "specified, the commands, settings and mappings" (vim ft_mp.txt) |

Human rates after the fixes, docs register:

| Rule | Hits | Per 1,000 words |
|---|---|---|
| W2 Hype and buzzwords | 151 | 0.056 |
| S15 Reflexive triples | 58 | 0.022, in 7 files |
| W5 Inflated verb | 56 | 0.021 |
| H3 Stacked hedge | 52 | 0.019 |
| W1 AI-era vocabulary | 20 | 0.007 |
| P4 Importance throat-clearing | 17 | 0.006 |
| P6 Summary closer | 13 | 0.005 |
| S9 Vague attribution | 10 | 0.004 |
| P5 Signpost opener | 7 | 0.003 |
| S1 Denial pivot | 3 | 0.001 |
| P3 Importance assertion | 2 | 0.001 |

The AI-side rates are the measured ones in the first table (Pangram, Graphite, Kobak). Some tells that block in landing still fire on this corpus: W2 ("powerful", "robust", "vibrant"), P4 and S9. These are real human uses of the phrase. They stay at block because landing copy is not reference documentation: rewrite the line or waive it.

Limits:
- The corpus is reference documentation, not marketing, email or chat. The landing, store, email and social tiers rest on the cited studies.
- ASCII rendering turns em dashes into "--", so F1 and F2 are not calibrated here. F2's threshold comes from Freeburg.
- Code the conversions left unmarked, such as perl's `->` and vim's `:w!`, inflates F3 and F13.

## Jev stress run

Run on 2026-11-07 with jev-1.14.0. `node evals/jev/stress.mjs --split held --write-trust` writes `scripts/jev-trust.json` and `evals/jev/report.md`. `evals/jev/manifest.jsonl` lists every document by id, URL or brief; the text itself stays out of the repo.

Corpus:
- AI drafts: 41 by Claude Sonnet and 41 by Claude Haiku from one-line briefs (essay, docs, landing, store, release), kept only when they scanned with zero block hits; 18 essays, docs and landing pages by other models (DeepSeek, GPT-4, Gemini, Mixtral, Mistral, Qwen, Kimi, Yi) from public Hugging Face datasets.
- Human copy: 90 pages from before 2022-11-30 fetched from the Wayback Machine (essay 17, docs 20, landing 18, store 17, release 18). Ten more were dropped as broken extractions or not English.
- Synthetic cases: 24 per check for 12 checks that the drafts rarely trip (288), half with the tell and half without, and 20 rewrite pairs for the fact guard.
- Labels: Claude Sonnet read each document for each check, without Jev's answers.

A document is a tuning case when the first byte of the SHA-1 of its id is divisible by 5, and held out otherwise. Question wording was tuned on the tuning cases only. Trust comes from the 391 held-out documents. The bar: at least 20 cases with 8 on each side, at least 60% settled, at most 5% wrong among the settled answers, recall of at least 0.67 and false positives on at most 5% of clean cases.

| Check | With / without | Recall | False positives | Settled | Wrong | Acts |
|---|---|---|---|---|---|---|
| register | 377 docs | 0.93 | | 0.97 | 0.04 | yes |
| K3 crowd claim | 11 / 537 | 1 | 0.04 | 0.99 | 0.04 | yes |
| K5 deadline | 9 / 539 | 0.89 | 0.01 | 0.98 | 0.01 | yes |
| K8 error without cause or next step | 11 / 11 | 1 | 0 | 1 | 0 | yes |
| K10 store opening | 8 / 66 | 1 | 0.02 | 0.96 | 0.01 | yes |
| S25 declines to pick | 10 / 522 | 1 | 0 | 0.99 | 0 | yes |
| S27 corrects a belief | 11 / 993 | 0.64 | 0.01 | 0.98 | 0.02 | no |
| X2 change line | 8 / 367 | 0.63 | 0.10 | 0.92 | 0.11 | no |
| S8 withheld payoff | 11 / 9 | 0.73 | 0 | 1 | 0.15 | no |
| K9 several asks | 10 / 8 | 1 | 0.25 | 0.94 | 0.12 | no |
| K1 unmeasured quality | 36 / 575 | 0.47 | 0.17 | 0.88 | 0.21 | no |
| S30 first sentence echoes heading | 13 / 303 | 0.46 | 0.06 | 0.68 | 0.10 | no |
| S31 says what the reader knows | 11 / 973 | 0.45 | 0 | 0.99 | 0.01 | no |
| K4 superlative | 17 / 594 | 0.35 | 0.01 | 0.99 | 0.02 | no |
| S24 says what facts mean | 9 / 684 | 0.33 | 0.01 | 0.86 | 0.02 | no |
| S23 several names for one thing | 10 / 289 | 0 | 0 | 0.99 | 0.03 | no |
| Leave filter, S15 | 138 / 32 | 0.61 | 0.19 | 0.63 | 0.17 | no |

The other checks (K7, S26, S28, S32, the other Leave questions and the fact guard's two questions) had fewer than 8 held-out cases on one side. A check that does not act still runs with `--jev-untrusted`, as info; without it Claude reads that tell by hand. Most K1, K4 and K7 misses were label calls: one sentence filed under K1 by the label and K4 by Jev, or a section heading such as "Simple, transparent pricing" read as generic by one and as a label by the other.

Tells per 1,000 words, median per held-out document:

| Register | Human, regex | AI, regex | Human, every Jev check | AI, every Jev check |
|---|---|---|---|---|
| essay | 6.41 | 8.42 | 2.70 | 3.17 |
| docs | 2.03 | 0 | 1.37 | 0 |
| landing | 14.13 | 15.67 | 14.59 | 15.33 |
| store | 5.41 | 15.63 | 6.10 | 3.45 |
| release | 12.24 | 0 | 5.28 | 10.52 |

At the median, neither count separates a human page from a current draft that already scans free of block hits, and the trusted checks alone fire on almost nothing on either side (median 0). The count says how much there is to fix, never who wrote the text.

Cost, measured on five drafts with an empty cache: $0.0002 to $0.0013 per 1,000 words with the trusted checks, and $0.0019 to $0.0069 with `--jev-untrusted`.

Limits:
- Store and release AI drafts come from Claude models only.
- Positives for K8, K9, K10, S8, S23, S25 and S27 are synthetic; their clean cases include the real drafts and pages. Email, social and ui text appears only in synthetic cases.
- One model wrote the labels. Rerun the stress run after any wording change, and on each new Jev model.

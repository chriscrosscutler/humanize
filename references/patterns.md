# Pattern catalog

Every rule the scanner runs, plus the tells only a reader can judge. Cite an entry by id ("humanize S1") in commits, reviews and audit reports. An id keeps its meaning for good; a retired rule's id is never reused.

- The scanner prints each hit's id, tier and fix. `node scripts/scan.mjs --explain W1` prints one rule's pattern and its tier in every register.
- Look up one entry with `grep -n '^\*\*W1 ' references/patterns.md`.
- Read the judgment section in full on every rewrite and every audit. No regex sees those.

Entry format: **ID Name.** "machine-sounding instance" → "rewrite". Leave: where the pattern is fine. The rewrite shows the move, not text to paste, and its facts are made up for illustration; a real rewrite uses only facts the source gives (K6). Tiers live in `scripts/rules.json` and change by register; `registers.md` explains them. Kind "house" marks your own style rulings (no dashes in user copy, no hype words); they fire whoever wrote the text.

## Judgment pass (no scanner rule)

Read the whole text once for these after the scanner is clean.

**S23 Synonym cycling (judgment).** One thing called "the app", "the platform", "the tool" and "the solution" in four sentences → pick one name and repeat it; readers take a new word for a new thing. Leave: terms that really differ, and fiction.
**S24 Significance inflation (judgment).** Every paragraph ends by saying what the fact means, signals or reflects ("a step toward a calmer library") → state the fact and stop; keep a meaning sentence only when it is news to the reader.
**S25 Reflexive both-sides balance (judgment).** Each claim followed by a counterweight, and a close that refuses to choose ("both have merits; it depends on your needs") → recommend one and say when the other wins. Leave: a real comparison where the answer does depend on a named condition, stated as that condition.
**S26 Answer buried (judgment).** The direct answer arrives in the third paragraph after background → open with the answer, then the context a reader needs to trust it.
**S27 Setup and reversal (judgment).** A paragraph built as misconception, pause, correction ("Most people think backups are enough. They aren't.") when no reader held the misconception → state the finding.
**S28 Orbit then reveal (judgment).** Clauses that circle before landing ("When it comes to large libraries, and especially when duplicates pile up, what matters most is speed") → "Speed matters most for large libraries." Claude-era drafts run long: one sample found responses three times longer and sentences 58% longer than the previous model's.
**S29 Uniform section shape (judgment).** Every section has the same skeleton: heading, one-line intro, three bullets, a bolded takeaway → let each section's length follow its content and merge the thin ones.
**K1 Claim with no number (judgment).** "Much faster imports" → "Imports 2,000 photos in 40 seconds on an M2 MacBook Air", using a number you measured; with no number, ask for one or cut the claim. Leave: claims a reader can check at a glance.
**K2 Claim not derivable from source (judgment).** Copy promises a capability, limit or guarantee the code doesn't implement ("works offline", "end-to-end encrypted", "never uploads anything") → check the app source; fix the copy or flag the gap. Every public claim must trace to source (RULES §7).
**K3 Empty social proof (judgment).** "Loved by photographers everywhere", a logo wall or a star rating with nothing behind it → cut it until there is a real count, a source and a date.
**K4 Unearned superlative (judgment).** "The best way to organize photos" → name the advantage and the evidence for it ("the only one of the five sorters we tested that reads RAW sidecar files").
**K5 Manufactured urgency (judgment).** "Only 3 spots left", "price goes up tonight" when nothing ends → cut it. A real deadline keeps its date.
**K6 Fabricated specifics (judgment).** The rewrite adds numbers, names, quotes, dates or anecdotes the source never had, to sound concrete → remove them and ask the author for the real figure. This is the humanizer's own failure mode; check for it on every pass.

## Not tells on their own

Flag none of these by themselves. Several weak signs together mean far more than one: by Wikipedia's arithmetic, three weak signs show up together in about 0.75% of human text.

- Perfect grammar, formal register, a neutral or bland tone, a mix of casual and formal.
- An em dash, or a writer who always used them. Human essays run 0.33 to 17.12 per 1,000 words, and newer models often use fewer than people. Count density, never presence. (Dashes in user-facing copy are a house rule, F1, not an authorship claim.)
- Curly quotes and the ellipsis character: Word, macOS and iOS produce them.
- Markdown, headings, bullets and tables in documentation.
- One transition word (however, therefore, additionally). Only a pile-up opening sentence after sentence counts (H6).
- "In order to", "due to", "as well as", "the fact that": detector data puts these on the human side. H1 and H2 treat them as padding, a house style choice.
- One three-item list, or one "not just X but Y". Human base rates are about 5 triads and 1 contrast per 10,000 words.
- Passive voice. Its direction flips between models, and every style guide lists legitimate passives.
- Contractions or their absence, the Oxford comma, semicolons, sentence or title case: house style.
- Short sentences and short paragraphs: plain-language guides prescribe them.
- Literal uses: an API key, landscape mode, robust standard errors, foster care, the underscore character, a load-bearing wall, TNFα, 5 µs.
- Salutations and sign-offs in a real letter.
- Delve, or any single word. Delve peaked near 39.5 times its old rate in spring 2024 and fell to about 8 times by mid-2025.
- Unsourced claims. People make them too; the machine-specific problem is a real-looking source that doesn't support the sentence.
- A detector score or a feeling. People recognized 57% of AI texts and 64% of human ones in the studies Wikipedia cites; seven detectors flagged 61.22% of non-native TOEFL essays as AI.
- Text written before 2022-11-30.
- Absence of tells. The classic tells fell 41 to 86% from each family's earliest model to its latest.
- An occasional emoji or exclamation mark used on purpose, and humor that fits. Forced humor is the defect.
- Legal and safety disclaimers, real caveats and real alternatives. Keep them.

## C: chatbot residue

**C1 Assistant opener.** "Certainly! The export finished at 3:40." → "The export finished at 3:40." Leave: "Sure" answering a direct yes-or-no question, and the words mid-sentence.
**C2 Sycophantic agreement or apology.** "You're absolutely right, the limit is 500." → "The limit is 500." Leave: quoted dialogue, and an apology that names a specific fault and its fix.
**C3 Assistant sign-off.** "I hope this helps!" → cut; end on the last useful sentence. Also catches "Would you like me to…" offers and "Should I continue with…?". Leave: a real question the reader must answer, and FAQ questions ("What should I put in a module?").
**C4 Offer-more closer.** "Let me know if you have any questions." → cut, or one concrete next step: "Reply by Friday if the dates don't work." Leave: support replies where a reply is the expected next step, said once.
**C5 AI self-reference or knowledge cutoff.** "As an AI language model, I can't verify that." → cut; the text speaks for whoever publishes it. Leave: text about AI models, and quoted transcripts.
**C6 Unfilled template placeholder.** "Best regards, [Your Name]" → fill in the real value or remove the sentence. Also "[Insert date]", "2026-XX-XX", "INSERT_LINK". Leave: docs that show template syntax on purpose (warn there, off in code comments).
**C7 Chat interface artifact.** "Sales rose 4% in May.:contentReference[oaicite:0]{index=0}" → "Sales rose 4% in May." with the real link restored by hand. Also oai_citation tokens, "utm_source=chatgpt.com" and pasted "ChatGPT said:" lines. Leave: documentation about these artifacts.
**C8 Revision announcement.** "Here's the revised version of your bio:" → deliver the bio alone. Leave: chat where you offer two labeled options.
**C9 Output announcement.** "Here's a quick overview of the steps:" → give the steps. Leave: a docs page whose heading already says what follows.
**C10 Prompt echo or edit commentary.** "I've rewritten the draft to be more concise." → cut; ship the edited text. Also "To answer your question," and "You're asking about…". Leave: a change log written for the reader.
**C11 Source-availability hedge.** "While specific details are not publicly available, the company likely charges per seat." → "The company doesn't publish its pricing." Leave: research notes that record a gap and what was checked.
**C12 Reasoning narration.** "Let me think about this step by step." → cut; give the steps or the answer. Leave: a tutorial that teaches a reasoning method by name.
**C13 Assurance and service voice.** "I completely understand the importance of a quick reply." → "The refund reaches your card by Friday." Also "rest assured" and its kin. Leave: an apology with a named fault, and legal text.

## P: stock phrases

**P1 Era-setting opener.** "In today's fast-paced digital world, photos pile up." → "Photos pile up." Leave: a dated claim that needs its date ("In 2026, Apple Photos added…").
**P2 Testament or reminder puffery.** "The redesign stands as a testament to the team's care." → "The redesign cut setup from six screens to two." Leave: quoted text.
**P3 Importance assertion.** "Caching plays a crucial role in performance." → "Caching cuts page load from 2.1 s to 0.4 s." Also "marks a pivotal moment", "sets the stage for", "underscores the importance of". Leave: a measured finding phrased this way in a cited study.
**P4 Importance throat-clearing.** "It's worth noting that exports run overnight." → "Exports run overnight." If it is a warning, name the consequence: "Exports run overnight, so leave the Mac on." Leave: legal notices that must use a fixed form.
**P5 Signpost opener.** "Let's dive into the settings." → start with the first setting. Leave: a spoken transcript. Tutorials say "Let's take a look at…", so this warns in docs, prose and essays.
**P6 Summary closer.** "In conclusion, the new sync is faster and safer." → end on the last new point. Leave: a long report whose summary sits at the top under its own heading.
**P7 Journey and potential metaphor.** "Embark on a journey to a tidier library." → "Sort 10,000 photos in an afternoon." Also "unlock the full potential", "harness the power of", "navigate the complexities", "the ever-evolving landscape". Leave: literal trips, and unlocking a phone or a door.
**P8 Stock idiom.** "The logs shed light on the crash." → "The logs show the crash starts in the importer." Leave: an idiom a personal essay uses on purpose.
**P9 Marketing template.** "Say goodbye to cluttered albums." → "Sift finds duplicate photos and puts them in one album for review." Also "Look no further", "Meet X, your new…", "Think X meets Y". Leave: quoted ads.
**P10 Email and social cliché.** "I hope this email finds you well." → open with the reason you are writing. Also "must-read", "bookmark this", "I'm thrilled to announce". Leave: nothing in product email; a personal note may keep a greeting.
**P11 Abstract benefit phrase.** "You'll gain a newfound sense of control." → "You choose which duplicates go to the trash." Leave: a study that measured exactly that.
**P12 Insight and overview filler.** "The dashboard provides valuable insights into storage use." → "The dashboard shows which albums take the most space." Leave: "Insights" as the name of a screen.
**P13 Challenges and outlook closer.** "Despite these challenges, the future of photo management looks bright." → cut. A real risk gets a name, a date or an owner. Leave: a risk register.
**P14 Fiction cliché.** "She couldn't help but smile." → one specific detail from the scene. Off except in essays. Leave: deliberate pastiche.
**P15 Crafted-with-care marketese.** "Every screen is thoughtfully designed." → "Every screen works with one hand." Name the design decision and its effect. Leave: a literal craft description ("carefully sanded") and security writing ("a carefully crafted payload").
**P16 Unsourced superlative or social proof.** "The #1 app for photographers." → cut, or a sourced fact: "Rated 4.8 by 1,200 App Store reviewers (October 2026)." Leave: rankings that carry a source and a date.
**P17 Narrated candor.** "I want to be upfront about the limits: the beta drops some edits." → "The beta drops some edits." Leave: nothing; the caveat itself is the honest part.
**P18 Performed insight or stakes.** "Storage costs fell 90%. Let that sink in." → "Storage costs fell 90%." Also "Read that again." Leave: quoted social posts.
**P19 Fake-casual aside.** "The new importer is, chef's kiss, fast." → "The new importer is fast." Also "*checks notes*", "mic drop". Leave: humor writing where the voice is the author's own.
**P20 Generic error message.** "Something went wrong." → "Couldn't save the photo. Check that the disk has space, then try again." Leave: a true last-resort fallback that offers a retry and a way to reach support.
**P21 Aphorism formula.** "Trust is the new currency of the web." → the literal claim the metaphor stands for. Leave: a quoted maxim.
**P22 Blame wording in UI.** "Invalid email." → "Enter an email address like name@example.com." Leave: developer-facing errors ("invalid JSON at line 4").

## S: structure

**S1 Denial pivot.** "It's not just a photo app, it's a memory keeper." → "Sift sorts photos by event and person." Leave: correcting a misconception the reader actually holds, once.
**S2 Not only X but also Y.** "It not only removes duplicates but also frees space." → "It removes duplicates, which frees space." Fires at density. Leave: one per page.
**S3 Trailing negation.** "Sift is a sorter, not a cleaner." → "Sift sorts photos." Keep the contrast only where a reader would assume the opposite. Fires at density. Leave: a privacy line readers need ("processed on your Mac, not uploaded"), once.
**S4 No X. No Y. Just Z.** "No ads. No tracking. Just photos." → "Sift shows no ads and sends nothing off your Mac." Leave: a privacy page that lists what is not collected, in sentences.
**S5 Analysis tail.** "Sales rose 4%, highlighting the strength of the brand." → "Sales rose 4%." Leave: a tail that adds a checkable fact ("…, matching last year's rate").
**S6 Participle tail density.** "The app syncs hourly, ensuring your library stays current." → "The app syncs hourly." Fires at density. Leave: an occasional tail that carries real information.
**S7 Copula avoidance.** "The menu serves as the main entry point." → "The menu is the main entry point." Also "boasts" for "has". Fires at density. Leave: literal serving (a server serves requests).
**S8 Staged reveal.** "The result? A library you can search." → "The library is searchable." Also "Here's the thing:" and "The catch?" Leave: FAQ questions, dialogue, and "The result:" ending a line to introduce an example.
**S9 Vague attribution.** "Experts say photo clutter causes stress." → name the source and the finding, or cut the claim. Leave: named sources.
**S10 Whether you're X or Y.** "Whether you're a pro or a beginner, Sift has you covered." → name the one reader this is for and what they get. Leave: a real either-or that leads to different instructions.
**S11 Rhetorical question opener.** "Ever wondered where your storage went?" → "Open Storage to see which albums take the most space." Leave: FAQ headings and real survey questions.
**S12 False range.** "From family trips to work receipts, Sift sorts it all." → "Sift sorts trips, receipts and screenshots into separate albums." Leave: a real range with two endpoints ("From Monday to Friday, the queue runs nightly").
**S13 Fragment triplet.** "Fast. Private. Yours." → "Sift runs on your Mac, so sorting is fast and nothing leaves the device." Leave: a product's actual tagline that legal or the owner has fixed (waive it with a reason).
**S14 Uniform sentence rhythm.** Twelve or more sentences whose lengths barely vary → split one long sentence, merge two short ones, let one run long. Census only outside essays, email and pasted prose. Leave: numbered steps and reference tables.
**S15 Reflexive triples.** Three-item lists in sentence after sentence ("fast, simple and secure") → keep three only where all three are needed; otherwise name the one that matters. Leave: a list that really has three members. The scanner skips the last three items of a longer list.
**S16 Contrast and corrective framing density.** "It isn't a backup. It's a sorter." → "Sift sorts photos into albums." Also "That's not to say", "Make no mistake". Fires at density. Leave: one real correction.
**S17 Less X, more Y.** "It's less like a tool and more like a teammate." → "It sorts photos while you work." Graphite counted "less like a … and more like" 125 times in Claude Opus 5 articles against once in human articles. Leave: measured comparisons ("uses less memory").
**S18 Counted announcement.** "Three things stand out:" → give the three things. Leave: a numbered procedure whose count the reader needs.
**S19 Zinger closer.** "That's the whole point." → cut; the paragraph already made it. Leave: dialogue, and a sign-off the owner chose on purpose (ask once, then note it in the audit).
**S20 Performed balance.** "While some may argue that local processing is slower, it keeps photos private." → "Local processing is slower and keeps photos private." Or name who disagrees and why. Leave: a cited counterargument.
**S21 False agency.** "The data tells a clear story." → "Returns fell from 9% to 4% after the size chart shipped." Name who measured what. Fires at density. Leave: "the chart shows" followed by the value.
**S22 Same-opener run.** Three or more sentences in a row that open with the same word ("Sift sorts… Sift finds… Sift keeps…") → merge them or vary the openings. Leave: deliberate anaphora in an essay, and steps.

## F: format and typography

**F1 Dash in user-facing copy.** "Sort photos — fast." → "Sort photos fast." Also en dashes and spaced hyphens. For ranges write "to". House rule (RULES §7). Leave: code, CLI flags, hyphenated words, and minus signs.
**F2 Dash density.** "The import — which runs nightly — skips edited files — usually." → periods, commas or parentheses; keep a dash only where a hard break helps. Fires at density outside user registers. Leave: one or two per page, which Microsoft and Mailchimp prescribe.
**F3 Arrow in prose.** "Renamed the flag -> fixes the crash." → "Renaming the flag fixes the crash." Write the relation as a verb. Leave: menu paths in UI walkthroughs, code and diagrams.
**F4 Curly quotes or ellipsis character in dev text.** "Fix the “Save” button…" → straight quotes and three periods. Commit messages and comments only. Leave: user-facing copy, where curly quotes are correct typography.
**F5 Title Case headings.** "Getting Started With The App" as a heading, twice or more → "Getting started with the app". Leave: product and proper names, and a project that sets title case in `.humanize.json`.
**F6 Bold-label bullets.** Three or more bullets shaped "**Speed:** Sorting is fast." → plain sentences, or a table when they really are label and value. Leave: glossaries and spec sheets.
**F7 Bold sprinkled through prose.** Bold on a phrase every few sentences → keep bold on the one phrase a skimmer must not miss. Leave: UI names in step-by-step docs, if the project does that throughout.
**F8 Emoji as heading or bullet decoration.** "🚀 Getting started" as a heading, "✅ Fast" as a bullet → remove the emoji. Leave: an emoji that is the data (a status column).
**F9 Emoji density.** Several emoji per paragraph → none, or one that replaces a word. Leave: social posts in moderation.
**F10 Headings on short text.** Three headings over 300 words → remove the headings; short text reads as paragraphs. Leave: reference pages that readers scan by heading.
**F11 List where prose would do.** Six or more bullets that make up most of the text → sentences that say how the items relate. Leave: true lists (requirements, steps, options).
**F12 Markdown where it will not render.** "**Note:** restart the app" in an App Store description, a social post or a commit message → remove the markup; those surfaces show the asterisks. Runs on commit messages, on commit, social and store text that is pasted or kept in .txt files, and on .txt release notes; string catalogs are checked for headings only, because SwiftUI's Text renders bold, links and code. Leave: .md drafts, backticks, `__dunder__` names, and surfaces that render Markdown.
**F13 Exclamation marks in neutral text.** "Your export is ready!" → "Your export is ready." Fires at density. Leave: a real celebration, rarely.
**F14 Stock section heading.** "Key Takeaways" → delete the section, or name its content ("What changes for existing users"). Also "Conclusion", "Final Thoughts", "Why This Matters". Leave: a report format that requires the heading.
**F15 Invisible character or homoglyph.** A zero-width space inside a word, a soft hyphen, or a Cyrillic "а" inside a Latin word → delete the invisible characters and retype the look-alike letters; they break search, copy and paste, and screen readers. Leave: zero-width joiners inside emoji, a byte-order mark at the start of a file, Greek letters in math, Cyrillic words, and a character standing alone in a table that documents it.
**F16 Hashtag stuffing.** "#photography #mac #productivity #apps #declutter #storage" → one to three hashtags people follow. Social only.
**F17 Unicode styled letters.** "𝗙𝗮𝘀𝘁 𝘀𝗼𝗿𝘁𝗶𝗻𝗴" → "Fast sorting". Screen readers spell styled letters out one by one. Leave: math notation in technical docs.

## H: hedging and filler

**H1 Padding phrase.** "Due to the fact that sync is slow, exports wait." → "Because sync is slow, exports wait." House style, not a tell. Leave: legal text.
**H2 Wordy connector density.** "In order to export, open the menu." → "To export, open the menu." Fires at density. House style; detector data puts these phrases on the human side. Leave: one or two per page.
**H3 Stacked hedge.** "This may potentially reduce storage." → "This reduces storage when duplicates exist." Commit to the claim or name the condition. Leave: legal and medical text that must hedge, with one hedge.
**H4 Empty intensifier density.** "It's really very easy, basically one click." → "It takes one click." Fires at density. Leave: "actually" marking a real correction.
**H5 Subjective ease word.** "Simply drag the folder in." → "Drag the folder in." Fires at density. Leave: a usability result that measured ease.
**H6 Transition-word openers.** "Moreover, the app supports RAW files." → "The app also supports RAW files." Fires at density. Leave: one or two per page.
**H7 Backward or forward reference.** "As mentioned above, exports run nightly." → "Exports run nightly (see Scheduling)." Name the thing again or link to it. Leave: a long document with real anchors.
**H8 Hedged enumeration opener.** "There are several ways to free up space." → "Empty Recently Deleted, then remove large videos." Name the ways. Fires at density. Leave: a sentence followed by a numbered list of exactly those ways.

## W: words

**W1 AI-era vocabulary.** "We delve into the data." → "We look at the data." Also tapestry, realm, intricate, underscored, showcase, and their kin ("underscores the importance" is P3). Leave: literal uses (a woven tapestry, a Kerberos realm).
**W2 Hype and buzzwords.** "A game-changing way to sort photos." → "Sort 10,000 photos in an afternoon." Also cutting-edge, groundbreaking, powerful, intuitive, sleek. Leave: literal uses ("a powerful magnet") and quoted reviews with a source. "Harness" and "unlock" are not on the list: a test harness and an Unlock Pro button are ordinary; P7 catches "harness the power" and "unlock the potential".
**W3 Hype word in product copy.** "Smart albums that update automatically." → "Albums update each time you import." Also seamless, effortless, magic. House rule (RULES §7). Leave: "renews automatically" in subscription terms and the names the rule already skips (Smart Albums, Magic Keyboard, magic numbers); waive any other product name in `.humanize.json`.
**W4 "AI" as a selling point.** "AI-powered sorting." → "Claude reads the file names you approve and suggests albums." House rule (RULES §7). Leave: a required disclosure that names the model and what it receives.
**W5 Inflated verb.** "Utilize the export menu." → "Use the export menu." Also leverage, facilitate, commence, endeavor, adhere. Leave: "leverage" in finance, and legal text.
**W6 Sincerity and intensity adverbs.** "This is genuinely useful." → "This finds duplicates the Photos app misses." Graphite counted "is genuinely" 1,021 times in Claude Opus 5 articles against 4 in human articles. Fires at density. Leave: one in dialogue.
**W7 Claude-era idiom.** "That sentence is load-bearing." → "That sentence is required." Also "doing the heavy lifting". Leave: a load-bearing wall or beam.
**W8 AI-favored word density.** "A comprehensive, nuanced approach is crucial." → name the specific approach and why it matters. Fires at density. Leave: one or two per page.
**W9 First-person plural in product copy.** "We keep your photos private." → "Sift keeps your photos on your Mac." Off by default; a project turns it on (casetracker CPY-2).

## X: dev text

**X1 This commit or PR introduces.** "This commit introduces a new export flag." → "Export takes a --format flag." Say what changed and why. Leave: nothing in a commit subject.
**X2 Vague change note.** "Bug fixes and performance improvements." → "Fixes a crash when importing HEIC files from an SD card." Name what changed for the reader. Leave: nothing; even a quiet release names one thing.
**X3 Tutorial-voice comment.** "Now we loop over the files" → say why the code does this, or delete the comment. Leave: a teaching example in a tutorial repo.
**X4 Comment restates the code.** "increment the counter" → delete it, or give the reason the code exists. Leave: a comment that explains a non-obvious unit or edge case.
**X5 Emoji in log output.** "console.log('🚀 Starting import')" → log plain text; emoji break grep, log parsers and some terminals. Leave: user-facing UI strings.
**X6 Personified code.** "The cache quietly drops stale entries." → "The cache drops stale entries without logging them." Describe behavior literally. Leave: a well-known idiom (a function "returns early").
**X7 Assurance language in change descriptions.** "Improves readability and maintainability of the importer." → "Splits the importer into parse and write steps." Also "implement a comprehensive solution". Leave: a measured change ("cuts build time from 90 s to 40 s").
**X8 Done-report language.** "Successfully implemented the export flag." → "Export takes a --format flag." Leave: a UI message that confirms success to a user.
**X9 Change-history comment.** "Previously this used a for loop." → describe the code as it is; the history goes in the commit message. Leave: a comment that explains why the obvious approach fails, when that is the reason for the code.
**X10 Letter form in dev text.** "Dear Maintainers, this fixes the crash." → "Fixes the crash when…" Drop the salutation and the sign-off. Leave: an email template stored in the repo.

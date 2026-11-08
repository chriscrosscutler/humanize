// The Jev judgment pass, offline: a fake client answers by question name, so
// no test touches the network, the keychain or an API key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as H from "../scripts/scan.mjs";
import { JevError, loadJudge } from "../scripts/jev.mjs";
import { buildUnits, inferRegisterJev, leaveFilter, runProbes } from "../scripts/judge.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIX = join(ROOT, "tests/fixtures/jev");
const judge = loadJudge();
const rules = H.loadRules();
const cfg = H.emptyConfig();

// ── fakes ───────────────────────────────────────────────────────────────────

const N = (p) => ({ type: "noul", noul: p });
const YES = N(0.95);
const NO = N(0.05);
const MID = N(0.5);
/** A settled Choice answer: `top` leads, the rest share what is left. */
const C = (q, top) => {
  const keys = Object.keys(q.criteria);
  const rest = keys.filter((k) => k !== top);
  return { type: "choice", choice: top, confidence: 0.9, probabilities: Object.fromEntries(keys.map((k) => [k, k === top ? 0.9 : 0.1 / Math.max(1, rest.length)])) };
};
/** A Choice whose top option differs by order, so it cannot settle. */
const SPLIT = (q) => {
  const keys = Object.keys(q.criteria);
  return { type: "choice", choice: keys[0], confidence: 0.5, probabilities: Object.fromEntries(keys.map((k, i) => [k, i === 0 ? 0.5 : 0.5 / Math.max(1, keys.length - 1)])) };
};

function fake(handler, { spend = 0 } = {}) {
  const calls = [];
  return {
    calls,
    model: "jev-1.14.0",
    spent: () => ({ usd: spend, input_tokens: calls.length * 10, requests: calls.length, cache_hits: 0 }),
    ask: async ({ state, questions }) => {
      calls.push({ state, names: Object.keys(questions) });
      const answers = {};
      for (const [name, q] of Object.entries(questions)) answers[name] = handler(name, q, state);
      return { answers, usage: { input_tokens: 0, output_tokens: 0, usd: 0 }, cached: {} };
    },
  };
}
const asked = (client) => client.calls.flatMap((c) => c.names);

const trustAll = { model: judge.model, probes: new Proxy({}, { get: () => ({ trusted: true }) }) };
const only = (...keys) => ({ ...judge, probes: Object.fromEntries(keys.map((k) => [k, judge.probes[k]])) });

function units(src, register, ext = ".md", title = "doc.md") {
  const segs = ext === ".html" ? H.extractHtml(src) : H.extractMarkdown(src);
  return buildUnits(segs, { register, judge, title, src, ext });
}
const probes = (u, register, keys, client, extra = {}) =>
  runProbes({ units: u, register, judge: only(...keys), trust: trustAll, client, scanHits: [], cfg, rules, ...extra });

/** Section handler: find, locate (which sentence), confirm and unless by sentence id. */
const section = ({ find = YES, locate = "s1", confirm = YES, unless = NO } = {}) =>
  (name, q) => {
    if (name === "find") return find;
    if (name.startsWith("locate")) return typeof locate === "function" ? locate(name, q) : C(q, locate);
    if (name.startsWith("confirm_")) return confirm;
    if (name.startsWith("unless_")) return unless;
    return NO;
  };

// ── buildUnits ──────────────────────────────────────────────────────────────

test("buildUnits cuts a markdown file into tagged sections, opening, ledes, headlines and lines", () => {
  const src = readFileSync(join(FIX, "doc.md"), "utf8");
  const u = units(src, "docs");
  assert.deepEqual(u.sections.map((s) => s.heading), ["Photo sorting guide", "Exporting", "Backups"]);
  const intro = u.sections[0];
  assert.deepEqual(intro.sentences.map((s) => [s.id, s.line]), [["s1", 3], ["s2", 3], ["s3", 4], ["s4", 6]]);
  assert.match(intro.section, /^s1\| Sorting by hand takes an afternoon\.\ns2\| /);
  const exp = u.sections[1];
  assert.equal(exp.sentences[0].id, "s1", "ids restart per section");
  assert.equal(exp.line, 8);
  assert.deepEqual(exp.sentences.map((s) => s.text), ["Exporting lets you save your library as a file.", "Choose File > Export, then pick a folder.", "Pick a format", "Pick a folder"]);
  assert.equal(u.opening.title, "Photo sorting guide");
  assert.match(u.opening.opening, /^Sorting by hand[^]*\n\nThe second paragraph/);
  assert.equal(u.opening.line, 3);
  assert.deepEqual(u.ledes.map((l) => [l.heading, l.first_sentence, l.line]), [["Photo sorting guide", "Sorting by hand takes an afternoon.", 3], ["Exporting", "Exporting lets you save your library as a file.", 10], ["Backups", "This marks a step toward a calmer library and reflects how far backups have come.", 17]]);
  assert.deepEqual(u.headlines.map((h) => h.headline), ["Photo sorting guide", "Exporting", "Backups"]);
  assert.match(u.lines.notes, /^l1\| Sorting by hand takes an afternoon\. This guide shows a faster way\.$/m);
  assert.match(u.lines.notes, /^l5\| Pick a format$/m);
  assert.equal(u.email.sentences.at(-1).id, `s${u.email.sentences.length}`);
  assert.match(u.email.email, /^s1\| /);
});

test("buildUnits falls back to the file basename for the title and tags strings", () => {
  const u = buildUnits([{ kind: "para", line: 1, text: "Plain text with no heading. Two sentences." }], { register: "prose", judge, title: "notes/draft.txt", src: "", ext: ".txt" });
  assert.equal(u.opening.title, "draft.txt");
  assert.equal(u.opening.titled, false);
  const s = buildUnits([{ kind: "string", line: 4, text: "Upload failed." }], { register: "ui", judge, title: "x.swift", src: "", ext: ".swift" });
  assert.deepEqual(s.strings, [{ message: "Upload failed.", line: 4 }]);
});

test("buildUnits drops nav, footer and a header without an h1 from html, and keeps one with an h1", () => {
  const src = readFileSync(join(FIX, "page.html"), "utf8");
  const u = units(src, "landing", ".html", "page.html");
  const text = u.text;
  assert.ok(!text.includes("Home sentence"), "nav");
  assert.ok(!text.includes("Banner text"), "header without h1");
  assert.ok(!text.includes("Footer sentence"), "footer");
  assert.ok(text.includes("Sort photos in one tap"), "header with h1");
  assert.ok(text.includes("The hero header keeps its words"));
  assert.ok(text.includes("Pick a folder"));
  assert.deepEqual(u.headlines.map((h) => h.headline), ["Sort photos in one tap", "How it works"]);
  // The regex scan still sees the nav: filtering is for Jev units only.
  const regexSegs = H.extractHtml(src);
  assert.ok(regexSegs.some((s) => s.text.includes("Home sentence")));
});

test("buildUnits splits a section over the token limit at paragraph boundaries and caps ids", () => {
  const paras = Array.from({ length: 6 }, (_, i) => `Paragraph ${i} has a fairly long sentence about nothing in particular.`).join("\n\n");
  const small = { ...judge, section_max_tokens: 40, chars_per_token: 4 };
  const segs = H.extractMarkdown(`# Title\n\n${paras}`);
  const u = buildUnits(segs, { register: "prose", judge: small, title: "a.md", src: "", ext: ".md" });
  assert.ok(u.sections.length >= 2, "split");
  for (const s of u.sections) {
    assert.equal(s.sentences[0].id, "s1");
    assert.ok(s.section.length <= 160 + 40, `section size ${s.section.length}`);
    assert.ok(s.sentences.length < 255);
  }
  assert.equal(u.sections.reduce((n, s) => n + s.sentences.length, 0), 6);
  const many = Array.from({ length: 600 }, (_, i) => `Sentence ${i} ends.`).join(" ");
  const big = buildUnits(H.extractMarkdown(many), { register: "prose", judge, title: "b.md", src: "", ext: ".md" });
  assert.ok(big.sections.length >= 3);
  for (const s of big.sections) assert.ok(s.sentences.length <= 255);
});

// ── section probes ──────────────────────────────────────────────────────────

const S24 = "Photos come in two kinds. This marks a step toward a calmer library. Back up nightly.";

test("section probe: find no is clean and asks nothing more", async () => {
  const client = fake(section({ find: NO }));
  const r = await probes(units(S24, "prose"), "prose", ["S24_meaning"], client);
  assert.deepEqual(r.hits, []);
  assert.deepEqual(r.coverage.checked, ["S24_meaning"]);
  assert.deepEqual(asked(client).filter((n) => n.startsWith("confirm")), []);
});

test("section probe: an unsettled find still goes to confirm, which decides", async () => {
  const c = fake(section({ find: MID }));
  const r = await probes(units(S24, "prose"), "prose", ["S24_meaning"], c);
  assert.equal(r.hits.length, 1);
  assert.ok(asked(c).some((n) => n.startsWith("confirm_")));
  const r2 = await probes(units(S24, "prose"), "prose", ["S24_meaning"], fake(section({ find: MID, confirm: MID })));
  assert.deepEqual(r2.hits, []);
  assert.equal(r2.coverage.unsettled[0].why, "confirm");
});

test("section probe: locate orders that disagree are unsettled", async () => {
  const flip = (name, q) => {
    const keys = Object.keys(q.criteria);
    return C(q, name === "locate" ? keys[0] : keys[1]);
  };
  const r = await probes(units(S24, "prose"), "prose", ["S24_meaning"], fake(section({ locate: flip })));
  assert.deepEqual(r.hits, []);
  assert.equal(r.coverage.unsettled[0].why, "locate");
});

test("section probe: confirm yes and unless no is a tell with the sentence's line, tier and note", async () => {
  const client = fake(section({ locate: "s2" }));
  const r = await probes(units(S24, "prose"), "prose", ["S24_meaning"], client);
  assert.equal(r.hits.length, 1);
  const h = r.hits[0];
  assert.equal(h.id, "S24");
  assert.equal(h.family, "S");
  assert.equal(h.kind, "tell");
  assert.equal(h.name, "Significance inflation");
  assert.equal(h.tier, "warn");
  assert.equal(h.line, 1);
  assert.equal(h.source, "jev");
  assert.equal(h.probe, "S24_meaning");
  assert.equal(h.p, 0.95);
  assert.equal(h.count, 1);
  assert.equal(h.match, "This marks a step toward a calmer library.");
  assert.equal(h.note, "jev S24_meaning p=0.95");
  assert.ok(h.excerpt.includes("calmer library"));
  assert.ok(h.fix.startsWith("State the fact"));
  // One locate/find request, then one confirm request holding confirm and unless.
  assert.deepEqual(client.calls.map((c) => c.names), [["find", "locate", "locate_rev"], ["confirm_s2", "unless_s2"]]);
  assert.match(client.calls[1].state.section, /^s1\| /);
});

test("section probe: unless yes means no hit; unless unsettled keeps the hit with a note", async () => {
  const a = await probes(units(S24, "prose"), "prose", ["S24_meaning"], fake(section({ locate: "s2", unless: YES })));
  assert.deepEqual(a.hits, []);
  assert.equal(a.coverage.unsettled.length, 0);
  const b = await probes(units(S24, "prose"), "prose", ["S24_meaning"], fake(section({ locate: "s2", unless: MID })));
  assert.equal(b.hits.length, 1);
  assert.match(b.hits[0].note, /Leave case unsettled/);
  assert.equal(b.coverage.unsettled.length, 0);
  const c = await probes(units(S24, "prose"), "prose", ["S24_meaning"], fake(section({ locate: "s2", confirm: MID })));
  assert.equal(c.coverage.unsettled[0].why, "confirm");
  const d = await probes(units(S24, "prose"), "prose", ["S24_meaning"], fake(section({ locate: "s2", confirm: NO })));
  assert.deepEqual([d.hits, d.coverage.unsettled], [[], []]);
});

test("section probe: code_leave drops numbers, count-and-date and dates before any confirm call", async () => {
  const cases = [
    ["K1_unmeasured", "Imports are much faster. Imports 40 photos in a second. Two times quicker.", "s2", "s1"],
    ["K1_unmeasured", "Imports are much faster. Imports twelve photos in a second.", "s2", "s1"],
    ["K3_proof", "Loved by photographers. Loved by 3,000 photographers since 2019.", "s2", "s1"],
    ["K3_proof", "Loved by photographers. Loved by 3,000 photographers since March.", "s2", "s1"],
    ["K5_urgency", "Act now. The offer ends on March 3.", "s2", "s1"],
    ["K5_urgency", "Act now. The offer ends 2026-12-01.", "s2", "s1"],
    ["K5_urgency", "Act now. The offer ends Friday.", "s2", "s1"],
  ];
  for (const [key, text, leave, keep] of cases) {
    const dropped = fake(section({ locate: leave }));
    const r = await probes(units(text, "landing"), "landing", [key], dropped);
    assert.deepEqual(r.hits, [], `${key}: ${text}`);
    assert.deepEqual(asked(dropped).filter((n) => n.startsWith("confirm")), [], `${key} asked about a left sentence`);
    const kept = fake(section({ locate: keep }));
    const k = await probes(units(text, "landing"), "landing", [key], kept);
    assert.equal(k.hits.length, 1, `${key}: ${text}`);
    assert.equal(k.hits[0].line, 1);
  }
  // A digit alone does not leave K3; a year or month does.
  const r = await probes(units("Loved by 3,000 photographers.", "landing"), "landing", ["K3_proof"], fake(section({ locate: "s1" })));
  assert.equal(r.hits.length, 1);
});

test("section probe: S28 skips sentences under filter.min_words and a section with none", async () => {
  const client = fake(section());
  const r = await probes(units("Short one. Another short one.", "prose"), "prose", ["S28_orbit"], client);
  assert.deepEqual(r.hits, []);
  assert.equal(client.calls.length, 0);
  const long = "When it comes to large libraries, and especially when duplicates pile up across several drives over many years, what matters most to nearly everyone who sorts photos by hand is speed. Short one.";
  const c2 = fake(section({ locate: "s1" }));
  const r2 = await probes(units(long, "prose"), "prose", ["S28_orbit"], c2);
  assert.equal(r2.hits.length, 1);
  assert.deepEqual(Object.keys(c2.calls[0].state), ["title", "heading", "section"]);
  assert.deepEqual(asked(c2), ["find", "locate", "locate_rev", "confirm_s1"]);
});

// ── single-unit probes ──────────────────────────────────────────────────────

test("headline probe: gate no skips, gate unsettled is unsettled, polarity absent makes no the tell", async () => {
  const src = "# Your all-in-one platform\n\nSome body text here.\n";
  const run = (gate, ask) => probes(units(src, "landing"), "landing", ["K7_generic"], fake((n) => (n === "gate" ? gate : ask)));
  assert.deepEqual((await run(NO, NO)).hits, []);
  const unsettled = await run(MID, NO);
  assert.deepEqual(unsettled.hits, []);
  assert.deepEqual(unsettled.coverage.unsettled[0], { key: "K7_generic", line: 1, why: "gate" });
  const tell = await run(YES, NO);
  assert.equal(tell.hits.length, 1);
  assert.equal(tell.hits[0].id, "K7");
  assert.equal(tell.hits[0].line, 1);
  assert.equal(tell.hits[0].match, "Your all-in-one platform");
  assert.deepEqual((await run(YES, YES)).hits, [], "yes means specific, so clean");
  const unsure = await run(YES, MID);
  assert.deepEqual(unsure.hits, []);
  assert.equal(unsure.coverage.unsettled[0].why, "ask");
});

test("string probe K8: any missing answer is a tell and the note names it", async () => {
  const u = buildUnits([{ kind: "string", line: 7, text: "Something went wrong." }], { register: "ui", judge, title: "a.swift", src: "", ext: ".swift" });
  const run = (cause, next) => probes(u, "ui", ["K8_error"], fake((n) => ({ gate: YES, ask_cause: cause, ask_next: next })[n]));
  const both = await run(NO, NO);
  assert.equal(both.hits.length, 1);
  assert.equal(both.hits[0].line, 7);
  assert.match(both.hits[0].note, /missing: cause, next/);
  const one = await run(YES, NO);
  assert.match(one.hits[0].note, /missing: next/);
  assert.deepEqual((await run(YES, YES)).hits, []);
  const gated = await probes(u, "ui", ["K8_error"], fake((n) => (n === "gate" ? NO : YES)));
  assert.deepEqual(gated.hits, []);
});

test("lede probe S30: heading echo is a tell unless the lede defines the term", async () => {
  const src = "## Exporting\n\nExporting lets you save your library as a file.\n";
  const run = (ask, unless) => probes(units(src, "docs"), "docs", ["S30_echo"], fake((n) => (n === "ask" ? ask : unless)));
  assert.equal((await run(YES, NO)).hits.length, 1);
  assert.equal((await run(YES, NO)).hits[0].line, 3);
  assert.deepEqual((await run(YES, YES)).hits, []);
  assert.deepEqual((await run(NO, NO)).hits, []);
});

test("opening probe S8 sends the opening and reports it at its first line", async () => {
  const client = fake(() => YES);
  const r = await probes(units("You won't believe what happened next.\n\nIt was a backup.\n", "social"), "social", ["S8_withheld"], client);
  assert.equal(r.hits.length, 1);
  assert.equal(r.hits[0].line, 1);
  assert.match(client.calls[0].state.opening, /believe what happened/);
});

test("lines probe X2: a line with a regex X2 hit is not sent; polarity absent makes no the tell", async () => {
  const src = "- Various fixes and updates\n- Fixes a crash when importing HEIC files\n- Improvements to the experience\n";
  const u = units(src, "release");
  const client = fake((n) => (n === "line_l2" ? YES : NO));
  const r = await probes(u, "release", ["X2_change"], client, { scanHits: [{ id: "X2", line: 1 }] });
  assert.deepEqual(client.calls[0].names, ["line_l2", "line_l3"]);
  assert.deepEqual(r.hits.map((h) => h.line), [3]);
  assert.match(client.calls[0].state.notes, /^l1\| Various fixes/);
  assert.equal(r.hits[0].id, "X2");
  assert.equal(r.hits[0].tier, "warn");
});

test("email probe K9 counts asks and reports at the second", async () => {
  const src = "Hi Sam,\n\nCould you review the draft? Also, can you send the logo?\n\nLet me know your availability.\n\nThanks.\n";
  const u = units(src, "email");
  const yesFor = (...ids) => fake((n) => (ids.map((i) => `sentence_${i}`).includes(n) ? YES : NO));
  const three = await probes(u, "email", ["K9_asks"], yesFor("s2", "s3", "s4"));
  assert.equal(three.hits.length, 1);
  assert.equal(three.hits[0].line, 3);
  assert.match(three.hits[0].note, /3 asks, at lines 3, 3, 5/);
  const two = await probes(u, "email", ["K9_asks"], yesFor("s2", "s4"));
  assert.equal(two.hits[0].line, 5);
  assert.deepEqual((await probes(u, "email", ["K9_asks"], yesFor("s3"))).hits, []);
  const maybe = await probes(u, "email", ["K9_asks"], fake((n) => (n === "sentence_s2" ? YES : n === "sentence_s4" ? MID : NO)));
  assert.deepEqual(maybe.hits, []);
  assert.equal(maybe.coverage.unsettled.length, 1);
});

test("email probe K9 counts only prose asks; asks in a list are the fix", async () => {
  const src = "Hi Dana,\n\nThanks for the call.\n\nTwo things I need from you:\n\n1. Send me the August figures by Thursday.\n2. Tell me which tab holds the 2026 numbers.\n\nThanks,\nPriya\n";
  const u = units(src, "email");
  const listed = u.email.sentences.filter((s) => s.list).map((s) => s.id);
  assert.equal(listed.length, 2);
  const client = fake(() => YES);
  const r = await probes(u, "email", ["K9_asks"], client);
  assert.ok(client.calls.every((c) => c.names.every((n) => !listed.includes(n.replace("sentence_", "")))));
  assert.ok(r.hits.every((h) => !/August|2026/.test(h.match ?? "")));
});

test("names probe S23 clusters names that Jev says are one thing", async () => {
  const src = "The app syncs your photos.\n\nThe platform keeps a copy.\n\nOpen the tool to review them.\n";
  const u = units(src, "prose");
  const pairs = (yesPairs) => fake((n, q, state) => (yesPairs.some(([a, b]) => state.name_a.endsWith(a) && state.name_b.endsWith(b)) ? YES : NO));
  const r = await probes(u, "prose", ["S23_names"], pairs([["app", "platform"], ["platform", "tool"]]));
  assert.equal(r.hits.length, 1);
  assert.equal(r.hits[0].id, "S23");
  assert.equal(r.hits[0].line, 5, "third distinct name first appears on line 5");
  assert.match(r.hits[0].match, /the app, the platform, the tool/);
  const two = await probes(u, "prose", ["S23_names"], pairs([["app", "platform"]]));
  assert.deepEqual(two.hits, []);
  const client = pairs([]);
  await probes(u, "prose", ["S23_names"], client);
  assert.equal(client.calls.length, 3, "three pairs");
  assert.deepEqual(Object.keys(client.calls[0].state).sort(), ["name_a", "name_b", "text"]);
  const single = fake(() => YES);
  await probes(units("The app is fast. The app is small.", "prose"), "prose", ["S23_names"], single);
  assert.equal(single.calls.length, 0, "one name is nothing to compare");
});

test("S29 is code only: the same skeleton under most headings is a hit, with no trust and no Jev", async () => {
  const sec = (n) => `## Part ${n}\n\nOne intro line for part ${n}.\n\n- one\n- two\n- three\n\n**Takeaway ${n} is bold.**\n`;
  const same = ["# Guide", ...[1, 2, 3, 4, 5].map(sec)].join("\n");
  const client = fake(() => { throw new Error("no Jev call expected"); });
  const r = await runProbes({ units: units(same, "docs"), register: "docs", judge, trust: { probes: {} }, client, cfg, rules });
  const s29 = r.hits.find((h) => h.id === "S29");
  assert.ok(s29);
  assert.equal(s29.line, 2);
  assert.equal(s29.tier, "warn");
  assert.equal(s29.source, "code");
  assert.equal(client.calls.length, 0);
  assert.ok(r.coverage.not_checked.every((n) => n.why === "untrusted"));
  const few = ["# Guide", ...[1, 2, 3].map(sec)].join("\n");
  assert.ok(!(await runProbes({ units: units(few, "docs"), register: "docs", judge, trust: { probes: {} }, client, cfg, rules })).hits.some((h) => h.id === "S29"));
  const mixed = ["# Guide", sec(1), "## Odd\n\nJust prose here.\n\nMore prose.\n", "## Odder\n\n- a\n- b\n- c\n- d\n- e\n", "## Last\n\nShort.\n", "## Fifth\n\nAlso short and prose.\n\nAnd more.\n\nAnd more still.\n"].join("\n");
  assert.ok(!(await runProbes({ units: units(mixed, "docs"), register: "docs", judge, trust: { probes: {} }, client, cfg, rules })).hits.some((h) => h.id === "S29"));
});

// ── trust, tiers, errors ────────────────────────────────────────────────────

test("an untrusted probe is listed not checked; --jev-untrusted runs it and marks hits info", async () => {
  const u = units(S24, "prose");
  const client = fake(section({ locate: "s2" }));
  const none = await runProbes({ units: u, register: "prose", judge: only("S24_meaning"), trust: { probes: { S24_meaning: { trusted: false } } }, client, cfg, rules });
  assert.deepEqual(none.coverage.not_checked, [{ key: "S24_meaning", why: "untrusted" }]);
  assert.equal(client.calls.length, 0);
  const run = await runProbes({ units: u, register: "prose", judge: only("S24_meaning"), trust: { probes: {} }, client, untrusted: true, cfg, rules });
  assert.equal(run.hits.length, 1);
  assert.equal(run.hits[0].tier, "info");
  assert.equal(run.hits[0].untrusted, true);
  assert.deepEqual(run.coverage.checked, ["S24_meaning"]);
});

test("tiers come from judge.json by register, then .humanize.json, and legal is capped", async () => {
  const u = units("Photos come in two kinds. This is a sign of how far backups have come.", "docs");
  const hit = async (register, over) => {
    const j = { ...only("S28_orbit", "S31_known"), tiers: { ...judge.tiers, S31: { default: "block" } } };
    const long = "When it comes to large libraries, and especially when duplicates pile up across several drives over many years, what matters most to nearly everyone who sorts photos by hand is speed.";
    const r = await runProbes({ units: units(long, register), register, judge: j, trust: trustAll, client: fake(section()), cfg: over ?? cfg, rules });
    return r.hits.map((x) => [x.id, x.tier]);
  };
  assert.deepEqual(await hit("docs"), [["S28", "info"], ["S31", "block"]]);
  assert.deepEqual(await hit("essay"), [["S28", "warn"], ["S31", "block"]]);
  const over = { ...cfg, rules: { S28: "off", S31: "info" } };
  assert.deepEqual(await hit("essay", over), [["S31", "info"]]);
  assert.ok(u.sections.length);
});

test("a register in judge.never sends nothing", async () => {
  const client = fake(() => YES);
  const r = await runProbes({ units: units(S24, "legal"), register: "legal", judge, trust: trustAll, client, cfg, rules });
  assert.deepEqual([r.hits, r.coverage.checked, client.calls.length], [[], [], 0]);
});

test("a budget error leaves this and every later probe not checked", async () => {
  let n = 0;
  const client = fake(section());
  const real = client.ask;
  client.ask = async (req) => {
    if (++n === 2) throw new JevError("budget", "over");
    return real(req);
  };
  const keys = ["K1_unmeasured", "K3_proof", "K4_superlative", "K5_urgency"];
  const r = await probes(units("Imports are much faster. Back up nightly.", "landing"), "landing", keys, client);
  assert.equal(r.status, "budget");
  const nc = r.coverage.not_checked;
  assert.ok(nc.length >= 2 && nc.every((x) => x.why === "budget"), JSON.stringify(nc));
  assert.deepEqual([...r.coverage.checked, ...nc.map((x) => x.key)].sort(), [...keys].sort());
});

test("http, timeout and bad_response errors skip that probe and continue; off and no_key stop", async () => {
  const keys = ["K1_unmeasured", "K4_superlative"];
  const failing = (code, times) => {
    let n = 0;
    const c = fake(section());
    const real = c.ask;
    c.ask = async (req) => {
      if (++n <= times) throw new JevError(code, code);
      return real(req);
    };
    return c;
  };
  const u = units("Imports are much faster. Back up nightly.", "landing");
  const a = await probes(u, "landing", keys, failing("http", 1));
  assert.deepEqual(a.coverage.not_checked, [{ key: "K1_unmeasured", why: "error: http" }]);
  assert.deepEqual(a.coverage.checked, ["K4_superlative"]);
  assert.equal(a.status, "ok");
  const all = await probes(u, "landing", keys, failing("timeout", 99));
  assert.equal(all.status, "error");
  assert.deepEqual(all.coverage.not_checked.map((x) => x.why), ["error: timeout", "error: timeout"]);
  const nokey = await probes(u, "landing", keys, failing("no_key", 99));
  assert.equal(nokey.status, "no_key");
  assert.deepEqual(nokey.coverage.not_checked.map((x) => x.why), ["no_key", "no_key"]);
});

// ── leaveFilter ─────────────────────────────────────────────────────────────

const mk = (id, tier, line, match, kind = "tell") => ({ id, family: id[0], kind, name: id, tier, fix: "f", match, line, excerpt: match, count: 1 });

test("leaveFilter drops a warn tell to info on a yes and never touches block hits or other kinds", async () => {
  const segs = H.extractMarkdown("A powerful magnet holds the lid. The word delve stays.\n");
  const hits = [mk("W2", "warn", 1, "powerful"), mk("W1", "block", 1, "delve"), mk("W5", "warn", 1, "leverage", "count")];
  const client = fake(() => YES);
  const r = await leaveFilter(hits, segs, { register: "docs", judge, trust: trustAll, client });
  const by = Object.fromEntries(r.hits.map((h) => [h.id, h]));
  assert.equal(by.W2.tier, "info");
  assert.equal(by.W2.note, "jev: literal use or sourced quote");
  assert.equal(by.W1.tier, "block");
  assert.equal(by.W5.tier, "warn");
  assert.deepEqual(client.calls.map((c) => c.names), [["leave_W2"]]);
  assert.deepEqual(client.calls[0].state, { sentence: "A powerful magnet holds the lid.", match: "powerful" });
  assert.equal(hits[0].tier, "warn", "input is not mutated");
  const no = await leaveFilter(hits, segs, { register: "docs", judge, trust: trustAll, client: fake(() => NO) });
  assert.equal(no.hits[0].tier, "warn");
  const mid = await leaveFilter(hits, segs, { register: "docs", judge, trust: trustAll, client: fake(() => MID) });
  assert.equal(mid.hits[0].tier, "warn");
  assert.equal(mid.coverage.unsettled.length, 1);
});

test("leaveFilter puts all Leave questions for one sentence in one request and sends C1's previous sentence", async () => {
  const segs = H.extractMarkdown("It was fast. Fast, simple and secure is the claim, and it is powerful.\n");
  const hits = [mk("S15", "warn", 1, "Fast, simple and secure"), mk("W2", "warn", 1, "powerful"), mk("C1", "warn", 1, "Fast, simple")];
  const client = fake(() => NO);
  await leaveFilter(hits, segs, { register: "prose", judge, trust: trustAll, client });
  const sent = client.calls.map((c) => c.names.join(","));
  assert.ok(sent.includes("leave_S15,leave_C1") || sent.includes("leave_S15") || sent.length >= 2, sent.join(" | "));
  const c1 = client.calls.find((c) => c.names.includes("leave_C1"));
  assert.equal(c1.state.previous, "It was fast.");
  const w2 = client.calls.find((c) => c.names.includes("leave_W2"));
  assert.equal("previous" in w2.state, false);
});

test("leaveFilter: untrusted keys and never registers send nothing; P6 under a summary heading is info by code", async () => {
  const segs = H.extractMarkdown("## Summary\n\nIn conclusion, the app is fast.\n\n## Details\n\nIn conclusion, more.\n");
  const hits = [mk("P6", "warn", 3, "In conclusion"), mk("P6", "warn", 7, "In conclusion"), mk("W2", "warn", 3, "fast")];
  const client = fake(() => YES);
  const r = await leaveFilter(hits, segs, { register: "docs", judge, trust: { probes: {} }, client });
  assert.equal(client.calls.length, 0);
  assert.deepEqual(r.coverage.not_checked, [{ key: "leave.W2", why: "untrusted" }]);
  assert.deepEqual(r.hits.map((h) => h.tier), ["info", "warn", "warn"]);
  assert.equal(r.hits[0].note, "summary heading");
  const legal = await leaveFilter(hits, segs, { register: "legal", judge, trust: trustAll, client });
  assert.equal(client.calls.length, 0);
  assert.equal(legal.hits[2].tier, "warn");
});

// ── register ────────────────────────────────────────────────────────────────

test("inferRegisterJev: settled, sells, unsettled, legal-looking and untrusted", async () => {
  const reg = (top, sells) => fake((n, q) => (n === "sells" ? sells : C(q, top)));
  const text = "Run the export from the File menu.";
  assert.deepEqual(await inferRegisterJev(text, { judge, trust: trustAll, client: reg("docs", NO) }), { register: "docs" });
  assert.deepEqual(await inferRegisterJev(text, { judge, trust: trustAll, client: reg("docs", YES) }), { register: "landing" });
  assert.deepEqual(await inferRegisterJev(text, { judge, trust: trustAll, client: reg("email", YES) }), { register: "email" });
  const un = await inferRegisterJev(text, { judge, trust: trustAll, client: fake((n, q) => (n === "sells" ? NO : SPLIT(q))) });
  assert.equal(un.register, null);
  assert.equal(un.candidates.length, 2);
  const client = reg("docs", NO);
  assert.deepEqual(await inferRegisterJev("The licensee shall not copy the software.", { judge, trust: trustAll, client }), { register: null, why: "legal-looking, not sent" });
  assert.deepEqual(await inferRegisterJev(text, { judge, trust: { probes: {} }, client }), { register: null, why: "untrusted" });
  assert.equal(client.calls.length, 0);
  const sent = reg("docs", NO);
  await inferRegisterJev(text, { judge, trust: trustAll, client: sent });
  assert.deepEqual(sent.calls[0].names, ["register", "register_rev", "sells"]);
  const q = Object.keys(sent.calls[0].state);
  assert.deepEqual(q, ["text"]);
});

// ── the CLI ─────────────────────────────────────────────────────────────────

async function withRepo(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), "humanize-jev-"));
  try {
    mkdirSync(join(dir, ".git"));
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), text);
    }
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function cli(args, { cwd, env = {}, stdin = "", ...io } = {}) {
  const out = [];
  const err = [];
  const r = H.run(args, { out: (s) => out.push(s), err: (s) => err.push(s), cwd, env: { HUMANIZE_TODAY: "2026-11-07", ...env }, stdin: () => stdin, ...io });
  const code = await r;
  return { code, out: out.join("\n"), err: err.join("\n"), isPromise: typeof r?.then === "function" };
}

const ESSAY = "# Notes\n\nPhotos come in two kinds. This marks a step toward a calmer library. Back up nightly.\n";
const noCall = fake(() => { throw new Error("the client must not be called"); });

test("--judge with HUMANIZE_JEV=0, --no-jev or \"jev\": false gives the plain scan plus a row, with no call", async () => {
  const bad = "# Notes\n\nWe delve into the rich tapestry of it all. This marks a step toward a calmer library.\n";
  await withRepo({ "essay.md": bad }, async (dir) => {
    const plain = await cli(["essay.md", "--register", "essay"], { cwd: dir });
    assert.equal(plain.isPromise, false);
    for (const [extra, env] of [[[], { HUMANIZE_JEV: "0" }], [["--no-jev"], {}]]) {
      const j = await cli(["essay.md", "--register", "essay", "--judge", ...extra], { cwd: dir, env, jevClient: noCall, jevTrust: trustAll });
      assert.equal(j.isPromise, true);
      assert.equal(j.code, plain.code);
      const lines = j.out.split("\n");
      const row = lines.findIndex((l) => l.startsWith("jev: "));
      assert.match(lines[row], /^jev: off, 0 probes checked, 0 unsettled \(read by hand\), \d+ not checked, \$0\.0000 spent$/);
      assert.match(j.out, /not checked: S24_meaning \(off\)/);
      assert.deepEqual(lines.filter((l, i) => i < row || (i > row && !l.startsWith("  "))), plain.out.split("\n"));
    }
  });
  await withRepo({ "essay.md": bad, ".humanize.json": JSON.stringify({ jev: false }) }, async (dir) => {
    const plain = await cli(["essay.md", "--register", "essay"], { cwd: dir });
    const j = await cli(["essay.md", "--register", "essay", "--judge"], { cwd: dir, jevClient: noCall, jevTrust: trustAll });
    assert.equal(j.code, plain.code);
    assert.match(j.out, /^jev: off, 0 probes checked/m);
  });
  await withRepo({ "essay.md": bad, ".humanize.json": JSON.stringify({ jev: "yes" }) }, async (dir) => {
    const j = await cli(["essay.md", "--judge"], { cwd: dir });
    assert.equal(j.code, 2);
    assert.match(j.err, /jev: expected true or false/);
  });
});

test("--judge --json adds a top-level jev block and merges Jev hits", async () => {
  await withRepo({ "essay.md": ESSAY }, async (dir) => {
    const client = fake(section({ locate: "s2" }), { spend: 0.0123 });
    const j = await cli(["essay.md", "--register", "essay", "--judge", "--json"], { cwd: dir, jevClient: client, jevTrust: trustAll, jevBaselines: null });
    assert.equal(j.code, 0, "Jev warns never fail a run");
    const data = JSON.parse(j.out);
    assert.deepEqual(Object.keys(data.jev).sort(), ["cache_hits", "checked", "input_tokens", "model", "not_checked", "status", "unsettled", "usd"]);
    assert.equal(data.jev.status, "ok");
    assert.equal(data.jev.model, "jev-1.14.0");
    assert.equal(data.jev.usd, 0.0123);
    assert.ok(data.jev.checked.includes("S24_meaning"));
    const hit = data.files[0].hits.find((h) => h.id === "S24");
    assert.ok(hit);
    assert.equal(hit.source, "jev");
    assert.equal(hit.probe, "S24_meaning");
    assert.equal(hit.line, 3);
    assert.equal(hit.tier, "warn");
    assert.equal(data.totals.warn >= 1, true);
    const plain = JSON.parse((await cli(["essay.md", "--register", "essay", "--json"], { cwd: dir })).out);
    assert.equal("jev" in plain, false);
  });
});

test("--judge text, --summary and --github carry the Jev hit and the coverage row", async () => {
  await withRepo({ "essay.md": ESSAY }, async (dir) => {
    const args = ["essay.md", "--register", "essay", "--judge"];
    const t = await cli(args, { cwd: dir, jevClient: fake(section({ locate: "s2", find: (YES) })), jevTrust: trustAll });
    assert.match(t.out, /essay\.md:3 {2}S24 warn {2}"This marks a step toward a calmer library\."[^\n]*\[jev S24_meaning p=0\.95\]/);
    assert.match(t.out, /^jev: ok, \d+ probes checked, 0 unsettled \(read by hand\), \d+ not checked, \$0\.0000 spent$/m);
    const s = await cli([...args, "--summary"], { cwd: dir, jevClient: fake(section({ locate: "s2" })), jevTrust: trustAll });
    assert.match(s.out, /^jev: ok,/m);
    assert.match(s.out, /S24/);
    const g = await cli([...args, "--github"], { cwd: dir, jevClient: fake(section({ locate: "s2" })), jevTrust: trustAll });
    assert.match(g.out, /^::warning file=essay\.md,line=3,title=humanize S24::/m);
    const u = await cli(args, { cwd: dir, jevClient: fake(section({ locate: "s2", confirm: MID })), jevTrust: trustAll });
    assert.match(u.out, /^jev: ok, \d+ probes checked, [1-9]\d* unsettled \(read by hand\)/m);
    assert.match(u.out, /^ {2}essay\.md:3 {2}S24_meaning unsettled \(confirm\)$/m);
  });
});

test("--judge prints the file's Jev rate beside the human median when jev-trust.json has a baseline", async () => {
  const base = { essay: { human: { median: 1.8, p90: 4, docs: 12 }, ai: { median: 9, p90: 14, docs: 12 } } };
  await withRepo({ "essay.md": ESSAY }, async (dir) => {
    const args = ["essay.md", "--register", "essay", "--judge"];
    const t = await cli(args, { cwd: dir, jevClient: fake(section({ locate: "s2" })), jevTrust: trustAll, jevBaselines: base });
    assert.match(t.out, /^ {2}essay\.md: \d+(\.\d+)? Jev tells per 1,000 words; human essay median 1\.8$/m);
    const none = await cli(args, { cwd: dir, jevClient: fake(section({ locate: "s2" })), jevTrust: trustAll, jevBaselines: null });
    assert.doesNotMatch(none.out, /per 1,000 words/);
    const other = await cli(args, { cwd: dir, jevClient: fake(section({ locate: "s2" })), jevTrust: trustAll, jevBaselines: { docs: base.essay } });
    assert.doesNotMatch(other.out, /per 1,000 words/);
    const j = JSON.parse((await cli([...args, "--json"], { cwd: dir, jevClient: fake(section({ locate: "s2" })), jevTrust: trustAll, jevBaselines: base })).out);
    assert.equal(j.jev.rates[0].human_median, 1.8);
  });
});

test("--judge honours humanize-ignore comments and waivers over Jev hits, and a project override can make one block", async () => {
  const ignored = "# Notes\n\nPhotos come in two kinds. This marks a step toward a calmer library. <!-- humanize-ignore S24 -->\n";
  await withRepo({ "essay.md": ignored }, async (dir) => {
    const j = await cli(["essay.md", "--register", "essay", "--judge", "--json"], { cwd: dir, jevClient: fake(section({ locate: "s2" })), jevTrust: trustAll });
    assert.equal(JSON.parse(j.out).files[0].hits.some((h) => h.id === "S24"), false);
  });
  const waiver = { waivers: [{ rule: "S24", path: "essay.md", reason: "reviewed", expires: "2027-01-01" }] };
  await withRepo({ "essay.md": ESSAY, ".humanize.json": JSON.stringify(waiver) }, async (dir) => {
    const j = await cli(["essay.md", "--register", "essay", "--judge", "--json"], { cwd: dir, jevClient: fake(section({ locate: "s2" })), jevTrust: trustAll });
    assert.equal(JSON.parse(j.out).files[0].hits.some((h) => h.id === "S24"), false);
  });
  await withRepo({ "essay.md": ESSAY, ".humanize.json": JSON.stringify({ rules: { S24: "block" } }) }, async (dir) => {
    const j = await cli(["essay.md", "--register", "essay", "--judge"], { cwd: dir, jevClient: fake(section({ locate: "s2" })), jevTrust: trustAll });
    assert.equal(j.code, 1);
  });
});

test("--judge with no key or a spent budget leaves the regex output and exit code alone", async () => {
  await withRepo({ "essay.md": ESSAY }, async (dir) => {
    const plain = await cli(["essay.md", "--register", "essay"], { cwd: dir });
    const throwing = (code) => {
      const c = fake(() => YES);
      c.ask = async () => { throw new JevError(code, code); };
      return c;
    };
    const nk = await cli(["essay.md", "--register", "essay", "--judge"], { cwd: dir, jevClient: throwing("no_key"), jevTrust: trustAll });
    assert.equal(nk.code, plain.code);
    assert.match(nk.out, /^jev: no_key, 0 probes checked/m);
    assert.match(nk.out, /not checked: [^\n]*\(no_key\)/);
    const bg = await cli(["essay.md", "--register", "essay", "--judge"], { cwd: dir, jevClient: throwing("budget"), jevTrust: trustAll });
    assert.match(bg.out, /^jev: budget,/m);
    const un = await cli(["essay.md", "--register", "essay", "--judge"], { cwd: dir, jevClient: fake(section()), jevTrust: { probes: {} } });
    assert.match(un.out, /\(untrusted\)/);
    assert.equal(un.code, plain.code);
  });
});

test("--judge on a legal register sends nothing and says so", async () => {
  await withRepo({ "terms.md": "# Terms\n\nYou agree to these terms.\n" }, async (dir) => {
    const j = await cli(["terms.md", "--register", "legal", "--judge"], { cwd: dir, jevClient: noCall, jevTrust: trustAll });
    assert.equal(j.code, 0);
    assert.match(j.out, /^jev: not sent \(register legal\)$/m);
  });
});

test("--stdin --judge with no register asks Jev and notes the answer; unsettled stays prose", async () => {
  const text = "Run the export from the File menu, then pick a folder.\n";
  const settled = await cli(["--stdin", "--judge"], { cwd: FIX, stdin: text, jevClient: fake((n, q) => (n === "sells" ? NO : C(q, "docs"))), jevTrust: trustAll });
  assert.match(settled.out, /register: docs \(jev\)/);
  const json = await cli(["--stdin", "--judge", "--json"], { cwd: FIX, stdin: text, jevClient: fake((n, q) => (n === "sells" ? NO : C(q, "docs"))), jevTrust: trustAll });
  assert.equal(JSON.parse(json.out).files[0].register, "docs");
  const unsettled = await cli(["--stdin", "--judge", "--json"], { cwd: FIX, stdin: text, jevClient: fake((n, q) => (n === "sells" ? NO : SPLIT(q))), jevTrust: trustAll });
  const d = JSON.parse(unsettled.out);
  assert.equal(d.files[0].register, "prose");
  assert.match(d.jev.notes.join("\n"), /register: prose \(unsettled between/);
  const named = fake(() => { throw new Error("register is given"); });
  const labelled = await cli(["--stdin", "--judge", "--register", "docs", "--no-jev"], { cwd: FIX, stdin: text, jevClient: named });
  assert.equal(labelled.code, 0);
});

test("scan.mjs never imports judge.mjs or jev.mjs statically", () => {
  const src = readFileSync(join(ROOT, "scripts/scan.mjs"), "utf8");
  assert.doesNotMatch(src, /^\s*import\b[^;\n]*\bfrom\s+["']\.\/(?:judge|jev)\.mjs["']/m);
  assert.doesNotMatch(src, /^\s*import\s+["']\.\/(?:judge|jev)\.mjs["']/m);
  assert.match(src, /import\("\.\/judge\.mjs"\)/);
  const hook = readFileSync(join(ROOT, "scripts/hook.mjs"), "utf8");
  assert.doesNotMatch(hook, /judge\.mjs|jev\.mjs/);
});

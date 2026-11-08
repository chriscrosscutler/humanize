// The Jev stress harness, offline: canned runProbes output for the scoring
// functions, and a fake client for the whole CLI over a tiny fixture corpus.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadJudge } from "../scripts/jev.mjs";
import * as S from "../evals/jev/stress.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CORPUS = join(ROOT, "tests/fixtures/stress/corpus");
const judge = loadJudge();
const bars = judge.trust;

const N = (p) => ({ type: "noul", noul: p });
function fake(handler) {
  const calls = [];
  return {
    calls,
    model: "jev-test",
    spent: () => ({ usd: 0.001, input_tokens: calls.length * 10, requests: calls.length, cache_hits: 0 }),
    ask: async ({ questions }) => {
      calls.push(Object.keys(questions));
      const answers = {};
      for (const [name, q] of Object.entries(questions)) answers[name] = handler(name, q);
      return { answers, usage: { input_tokens: 0, output_tokens: 0, usd: 0 }, cached: {} };
    },
  };
}
const choice = (q, top) => {
  const keys = Object.keys(q.criteria);
  return { type: "choice", choice: top, confidence: 0.9, probabilities: Object.fromEntries(keys.map((k) => [k, k === top ? 0.9 : 0.1 / Math.max(1, keys.length - 1)])) };
};

test("norm and quoteMatch fold whitespace, quotes and case, and match by containment either way", () => {
  assert.equal(S.norm("  It’s   “Fine” "), `it's "fine"`);
  assert.ok(S.quoteMatch("This marks a turning point.", "this  marks a TURNING point"));
  assert.ok(S.quoteMatch("A long sentence here. And more.", "a long sentence here."));
  assert.ok(!S.quoteMatch("one thing", "another"));
  assert.ok(!S.quoteMatch("", "x"));
});

test("outcome counts a hit on the wrong sentence in a positive section as wrong", () => {
  const right = S.outcome({ expected: true, predicted: "tell", correct: true });
  assert.deepEqual([right.tp, right.wrong, right.settled], [1, 0, 1]);
  const off = S.outcome({ expected: true, predicted: "tell", correct: false });
  assert.deepEqual([off.tp, off.wrong], [0, 1]);
  const miss = S.outcome({ expected: true, predicted: "clean", correct: false });
  assert.deepEqual([miss.tp, miss.wrong], [0, 1]);
  const unset = S.outcome({ expected: true, predicted: "unsettled", correct: false });
  assert.deepEqual([unset.settled, unset.wrong, unset.tp], [0, 0, 0]);
  const fp = S.outcome({ expected: false, predicted: "tell", correct: false });
  assert.deepEqual([fp.fp, fp.wrong, fp.neg], [1, 1, 1]);
  const ok = S.outcome({ expected: false, predicted: "clean", correct: false });
  assert.deepEqual([ok.wrong, ok.fp], [0, 0]);
});

function table(spec) {
  const t = {};
  for (const [pred, exp, correct, n] of spec) for (let i = 0; i < n; i++) S.addCase(t, "K", { expected: exp, predicted: pred, correct });
  return t.K;
}

test("finalize trusts a probe that clears every bar and names the reason when it does not", () => {
  const good = S.finalize("K", table([["tell", true, true, 9], ["clean", false, false, 12]]), bars);
  assert.equal(good.trusted, true);
  assert.equal(good.recall, 1);
  assert.equal(good.fp, 0);
  const few = S.finalize("K", table([["tell", true, true, 3], ["clean", false, false, 4]]), bars);
  assert.equal(few.trusted, false);
  assert.match(few.reason, /cases 7 < 20/);
  assert.match(few.reason, /pos 3 < 8/);
  const noisy = S.finalize("K", table([["tell", true, true, 9], ["tell", false, false, 4], ["clean", false, false, 9]]), bars);
  assert.equal(noisy.trusted, false);
  assert.match(noisy.reason, /fp 0\.31 > 0\.05/);
  const shy = S.finalize("K", table([["tell", true, true, 9], ["unsettled", true, false, 9], ["clean", false, false, 9]]), bars);
  assert.match(shy.reason, /recall 0\.5 < 0\.67/);
  const unsettledMost = S.finalize("K", table([["tell", true, true, 8], ["unsettled", false, false, 20], ["clean", false, false, 8]]), bars);
  assert.match(unsettledMost.reason, /settled 0\.44 < 0\.6/);
});

test("the register probe needs no negatives", () => {
  const t = {};
  for (let i = 0; i < 25; i++) S.addCase(t, "register", { expected: true, predicted: "tell", correct: true });
  assert.equal(S.finalize("register", t.register, bars).trusted, true);
});

test("median and p90", () => {
  assert.equal(S.median([3, 1, 2]), 2);
  assert.equal(S.median([1, 2, 3, 4]), 2.5);
  assert.equal(S.median([]), null);
  assert.equal(S.p90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 9);
});

test("baselines split human from ai docs per register", () => {
  const b = S.baselines([
    { register: "landing", group: "human", jev: 1, regex: 0 },
    { register: "landing", group: "human", jev: 3, regex: 2 },
    { register: "landing", group: "ai-sonnet", jev: 10, regex: 4 },
    { register: "landing", group: "ai-haiku", jev: 12, regex: 6 },
    { register: "docs", group: "human", jev: 0.5, regex: 0 },
  ]);
  assert.deepEqual(b.landing.human, { median: 2, p90: 3, docs: 2 });
  assert.equal(b.landing.ai.median, 11);
  assert.equal(b.landing.regex_ai.docs, 2);
  assert.equal(b.docs.ai.docs, 0);
});

// ── casesFor on canned runProbes output ─────────────────────────────────────

const sent = (id, text, line) => ({ id, text, line, words: text.split(/\s+/).length });
const units = {
  sections: [
    { heading: "A", level: 1, line: 1, sentences: [sent("s1", "This marks a turning point for the industry and its many teams.", 3), sent("s2", "The merge step costs four milliseconds per edit on a laptop.", 4)] },
    { heading: "B", level: 2, line: 6, sentences: [sent("s1", "Next year I will wait until May before planting any beans at all.", 8)] },
    { heading: "C", level: 2, line: 10, sentences: [sent("s1", "The tomatoes are fine and so are the peppers this year, mostly.", 12)] },
  ],
  opening: null, ledes: [], headlines: [], lines: { notes: [], lines: [] }, strings: [], email: null, skeletons: [],
};
const pr = (hits, unsettled = []) => ({ hits, coverage: { checked: ["S24_meaning"], unsettled, not_checked: [] }, status: "ok" });
const hit = (line, match) => ({ id: "S24", probe: "S24_meaning", line, match });
const probe = judge.probes.S24_meaning;
const lbl = ["This marks a turning point for the industry and its many teams."];

test("section cases: right sentence, wrong sentence, unsettled, clean", () => {
  const right = S.casesFor("S24_meaning", probe, units, lbl, pr([hit(3, "This marks a turning point for the industry and its many teams.")]));
  assert.deepEqual(right.map((c) => [c.expected, c.predicted, c.correct]), [[true, "tell", true], [false, "clean", false], [false, "clean", false]]);
  const wrong = S.casesFor("S24_meaning", probe, units, lbl, pr([hit(4, "The merge step costs four milliseconds per edit on a laptop.")]));
  assert.deepEqual([wrong[0].predicted, wrong[0].correct], ["tell", false]);
  const uns = S.casesFor("S24_meaning", probe, units, lbl, pr([], [{ key: "S24_meaning", line: 8, why: "x" }]));
  assert.deepEqual(uns.map((c) => c.predicted), ["clean", "unsettled", "clean"]);
  const fp = S.casesFor("S24_meaning", probe, units, [], pr([hit(12, "x")]));
  assert.deepEqual(fp.map((c) => [c.expected, c.predicted]), [[false, "clean"], [false, "clean"], [false, "tell"]]);
});

test("a hit beats an unsettled row in the same section", () => {
  const c = S.casesFor("S24_meaning", probe, units, lbl, pr([hit(3, "This marks a turning point for the industry and its many teams.")], [{ key: "S24_meaning", line: 4, why: "x" }]));
  assert.equal(c[0].predicted, "tell");
});

test("sections with no sentence long enough are not cases", () => {
  const short = { ...units, sections: [{ heading: "A", level: 1, line: 1, sentences: [sent("s1", "Too short.", 2)] }] };
  assert.equal(S.casesFor("S24_meaning", { ...probe, filter: { min_words: 25 } }, short, [], pr([])).length, 0);
});

// ── guard cases ─────────────────────────────────────────────────────────────

test("guardCases scores each changed rewrite sentence and each dropped original sentence", () => {
  const pair = { changed: ["Teams use it every day."], dropped: ["Export takes one click."] };
  const original = "Photos sync in the background. Export takes one click.";
  const rewrite = "Photos sync in the background. Teams use it every day.";
  const res = {
    hits: [
      { name: "Changed claim", note: "", excerpt: "Teams use it every day." },
      { name: "Dropped point", note: "", excerpt: "Export takes one click." },
    ],
    unsettled: [],
  };
  const g = S.guardCases(pair, original, rewrite, res);
  assert.deepEqual(g["guard.supports"].map((c) => [c.expected, c.predicted, c.correct]), [[true, "tell", true]]);
  assert.deepEqual(g["guard.dropped"].map((c) => [c.expected, c.predicted, c.correct]), [[true, "tell", true]]);
  const miss = S.guardCases(pair, original, rewrite, { hits: [], unsettled: [{ key: "guard.supports", sentence: "Teams use it every day.", line: 1 }] });
  assert.equal(miss["guard.supports"][0].predicted, "unsettled");
  assert.equal(miss["guard.dropped"][0].predicted, "clean");
});

test("guardCases skips sentences a literal hit already caught", () => {
  const pair = { changed: [], dropped: [] };
  const res = { hits: [{ name: "Added literal", note: "added literal: 5,000", excerpt: "Used by 5,000 teams." }], unsettled: [] };
  const g = S.guardCases(pair, "Photos sync.", "Photos sync. Used by 5,000 teams.", res);
  assert.equal(g["guard.supports"].length, 0);
});

// ── whole CLI, fake client, fixture corpus ──────────────────────────────────

function run(argv, client, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), "stress-"));
  const out = [];
  const err = [];
  const io = { out: (s) => out.push(s), err: (s) => err.push(s), client, reportPath: join(dir, "report.md"), trustPath: join(dir, "trust.json"), today: "2026-11-07", ...extra };
  return S.main(["--corpus", CORPUS, ...argv], io).then((code) => ({ code, out: out.join("\n"), err: err.join("\n"), dir, report: existsSync(io.reportPath) ? readFileSync(io.reportPath, "utf8") : null, trust: existsSync(io.trustPath) ? JSON.parse(readFileSync(io.trustPath, "utf8")) : null }));
}

// S24 finds the turning-point sentence; everything else is no.
const handler = (name, q) => {
  if (name === "find") return N(0.95);
  if (name.startsWith("locate")) return choice(q, "s2");
  if (name.startsWith("confirm_")) return N(0.95);
  if (name.startsWith("unless_")) return N(0.05);
  if (name === "register" || name === "register_rev") return choice(q, "essay");
  return N(0.05);
};

test("main runs the labelled held split with a fake client and writes metrics only", async () => {
  const client = fake(handler);
  const r = await run(["--split", "held", "--only", "S24_meaning,register", "--write-trust"], client);
  assert.equal(r.code, 0, r.err);
  assert.ok(client.calls.length > 0);
  assert.match(r.report, /\| S24_meaning \| \d+ \|/);
  assert.match(r.report, /## Baselines/);
  assert.match(r.report, /## Spend/);
  assert.ok(!/turning point/i.test(r.report), "report holds no corpus text");
  assert.equal(r.trust.split, "held");
  assert.equal(r.trust.measured, "2026-11-07");
  assert.equal(typeof r.trust.probes.S24_meaning.trusted, "boolean");
  assert.equal(r.trust.probes.S24_meaning.trusted, false, "two docs cannot clear min_cases");
  assert.ok("essay" in r.trust.baselines);
  rmSync(r.dir, { recursive: true, force: true });
});

test("main skips a probe key the doc did not label", async () => {
  const client = fake(handler);
  const r = await run(["--split", "tune", "--only", "S24_meaning"], client);
  assert.equal(r.code, 0, r.err);
  assert.equal(client.calls.length, 0, "an empty labels object labels nothing, so nothing is asked");
  rmSync(r.dir, { recursive: true, force: true });
});

test("main scores the guard pair", async () => {
  const client = fake((name, q) => {
    if (name.startsWith("sentence_") || name.startsWith("line_")) return N(0.95);
    return N(0.05);
  });
  const r = await run(["--split", "held", "--only", "guard.supports,guard.dropped"], client);
  assert.equal(r.code, 0, r.err);
  assert.match(r.report, /guard\.(supports|dropped)/);
  rmSync(r.dir, { recursive: true, force: true });
});

test("a budget stop reports what was measured and exits clean", async () => {
  const { JevError } = await import("../scripts/jev.mjs");
  const client = { model: "x", spent: () => ({ usd: 3, input_tokens: 1, requests: 1, cache_hits: 0 }), ask: async () => { throw new JevError("budget", "spent $3"); } };
  const r = await run(["--split", "held", "--only", "S24_meaning"], client);
  assert.equal(r.code, 0, r.err);
  assert.match(r.report, /Stopped early: budget/);
  rmSync(r.dir, { recursive: true, force: true });
});

test("--write-trust needs the held split and refuses --dry-run", async () => {
  const a = await run(["--write-trust"], fake(handler));
  assert.equal(a.code, 2);
  assert.match(a.err, /held/);
  const b = await run(["--split", "held", "--write-trust", "--dry-run"], fake(handler));
  assert.equal(b.code, 2);
});

test("--dry-run makes no calls and prints docs, sections and an estimate", async () => {
  const client = fake(handler);
  const r = await run(["--dry-run"], client);
  assert.equal(r.code, 0, r.err);
  assert.equal(client.calls.length, 0);
  assert.match(r.out, /dry run: 3 docs/);
  assert.match(r.out, /input tokens, \$\d/);
  assert.equal(r.report, null);
});

test("bad flags exit 2", async () => {
  assert.equal((await run(["--split", "nope"], fake(handler))).code, 2);
  assert.equal((await run(["--budget", "x"], fake(handler))).code, 2);
  assert.equal((await run(["--bogus"], fake(handler))).code, 2);
});

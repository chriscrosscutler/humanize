#!/usr/bin/env node
// Jev stress harness: runs every judge.json probe over a labelled corpus,
// scores the answers against the labels, and decides which probes earn trust.
// Metrics only leave this tool: evals/jev/report.md never holds corpus text.
//
//   node evals/jev/stress.mjs [--corpus evals/corpus] [--labels glob|dir]
//        [--split held|tune|all] [--budget USD] [--write-trust] [--dry-run]
//        [--only key,key]
//
// Never logs an API key; the client (scripts/jev.mjs) owns the key.

import { existsSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { emptyConfig, extract, extractorFor, globToRe, loadRules, readText, scanUnit, splitSentences } from "../../scripts/scan.mjs";
import { JevError, TRUST_PATH, createClient, loadJudge } from "../../scripts/jev.mjs";
import { applicableProbes, buildUnits, inferRegisterJev, leaveFilter, runProbes } from "../../scripts/judge.mjs";
import { compare } from "../../scripts/guard.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
export const REPORT_PATH = join(HERE, "report.md");
const ONE_SIDED = new Set(["register"]);

// ── matching ────────────────────────────────────────────────────────────────

/** Whitespace, quote style and case folded away. */
export function norm(s) {
  return String(s ?? "")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Containment either way after normalising. */
export function quoteMatch(a, b) {
  const x = norm(a);
  const y = norm(b);
  return !!x && !!y && (x.includes(y) || y.includes(x));
}
const anyMatch = (text, quotes) => quotes.some((q) => quoteMatch(text, q));

// ── cases ───────────────────────────────────────────────────────────────────
// A case is { expected: bool, predicted: "tell"|"clean"|"unsettled", correct: bool }.
// `correct` says a predicted tell landed on a labelled quote.

function judgeCase(expected, hits, unsettled, labels, text) {
  const predicted = hits.length ? "tell" : unsettled.length ? "unsettled" : "clean";
  const correct = hits.some((h) => anyMatch(h.match ?? "", labels) || (text != null && anyMatch(h.match ?? "", [text]) && expected));
  return { expected, predicted, correct };
}

/** Cases for one probe key over one doc. `pr` is runProbes output. */
export function casesFor(key, probe, units, labels, pr, { scanHits = [], judge } = {}) {
  const hits = pr.hits.filter((h) => (key === "S29" ? h.id === "S29" : h.probe === key));
  const uns = pr.coverage.unsettled.filter((u) => u.key === key);
  const at = (line) => [hits.filter((h) => h.line === line), uns.filter((u) => u.line === line)];
  const out = [];
  switch (probe.unit) {
    case "section": {
      const min = probe.filter?.min_words ?? 0;
      const secs = [...units.sections].sort((a, b) => a.line - b.line);
      secs.forEach((sec, i) => {
        if (!sec.sentences.some((s) => s.words >= min)) return;
        const lo = sec.line;
        const hi = i + 1 < secs.length ? secs[i + 1].line - 1 : Infinity;
        const inR = (l) => l >= lo && l <= hi;
        const expected = sec.sentences.some((s) => anyMatch(s.text, labels));
        out.push(judgeCase(expected, hits.filter((h) => inR(h.line)), uns.filter((u) => inR(u.line)), labels));
      });
      break;
    }
    case "opening": {
      const o = units.opening;
      if (o) out.push(judgeCase(anyMatch(o.opening, labels), hits, uns, labels));
      break;
    }
    case "lede":
      for (const l of units.ledes) out.push(judgeCase(anyMatch(l.first_sentence, labels), ...at(l.line), labels));
      break;
    case "headline":
      for (const h of units.headlines) out.push(judgeCase(anyMatch(h.headline, labels), ...at(h.line), labels));
      break;
    case "string":
      for (const s of units.strings) out.push(judgeCase(anyMatch(s.message, labels), ...at(s.line), labels));
      break;
    case "lines": {
      const skip = probe.skip_if_regex_hit;
      for (const l of units.lines.lines) {
        if (skip && scanHits.some((h) => h.id === skip && h.line === l.line)) continue;
        out.push(judgeCase(anyMatch(l.text, labels), ...at(l.line), labels));
      }
      break;
    }
    case "email":
    case "names":
    case "document": {
      if (probe.unit === "email" && !units.email) break;
      if (probe.unit === "document") {
        const cfg = judge?.code?.S29;
        if (!cfg || units.skeletons.length < cfg.min_sections) break;
      }
      const expected = labels.length > 0;
      out.push({ expected, predicted: hits.length ? "tell" : uns.length ? "unsettled" : "clean", correct: expected && hits.length > 0 });
      break;
    }
  }
  return out;
}

/** Counts for one case. */
export function outcome(c) {
  const settled = c.predicted !== "unsettled";
  const tp = c.expected && c.predicted === "tell" && c.correct;
  const fp = !c.expected && c.predicted === "tell";
  const wrong = settled && (c.predicted === "tell" ? !(c.expected && c.correct) : c.expected);
  return { pos: c.expected ? 1 : 0, neg: c.expected ? 0 : 1, settled: settled ? 1 : 0, wrong: wrong ? 1 : 0, tp: tp ? 1 : 0, fp: fp ? 1 : 0 };
}

const ZERO = () => ({ cases: 0, pos: 0, neg: 0, settled: 0, wrong: 0, tp: 0, fp: 0 });

export function addCase(table, key, c) {
  const m = (table[key] ??= ZERO());
  const o = outcome(c);
  m.cases++;
  for (const k of Object.keys(o)) m[k] += o[k];
}

const r2 = (x) => Math.round(x * 100) / 100;

/** Recall, fp, trust verdict and reasons from counters, using judge.json's bars. */
export function finalize(key, m, bars) {
  const recall = m.pos ? m.tp / m.pos : null;
  const fp = m.neg ? m.fp / m.neg : null;
  const reasons = [];
  const oneSided = ONE_SIDED.has(key);
  if (m.cases < bars.min_cases) reasons.push(`cases ${m.cases} < ${bars.min_cases}`);
  if (m.pos < bars.min_each_side) reasons.push(`pos ${m.pos} < ${bars.min_each_side}`);
  if (!oneSided && m.neg < bars.min_each_side) reasons.push(`neg ${m.neg} < ${bars.min_each_side}`);
  if (!m.settled) reasons.push("nothing settled");
  else if (m.wrong / m.settled > bars.max_wrong) reasons.push(`wrong ${r2(m.wrong / m.settled)} > ${bars.max_wrong}`);
  if (m.cases && m.settled / m.cases < bars.min_settled) reasons.push(`settled ${r2(m.settled / m.cases)} < ${bars.min_settled}`);
  if (m.pos && recall < bars.min_recall) reasons.push(`recall ${r2(recall)} < ${bars.min_recall}`);
  if (!oneSided && m.neg && fp > bars.max_false_positive) reasons.push(`fp ${r2(fp)} > ${bars.max_false_positive}`);
  return { key, cases: m.cases, pos: m.pos, neg: m.neg, settled: m.settled, wrong: m.wrong, recall: recall == null ? null : r2(recall), fp: fp == null ? null : r2(fp), trusted: reasons.length === 0, reason: reasons.join("; ") };
}

// ── baselines ───────────────────────────────────────────────────────────────

export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return r2(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
}
export function p90(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return r2(s[Math.max(0, Math.ceil(0.9 * s.length) - 1)]);
}
const stat = (xs) => ({ median: median(xs), p90: p90(xs), docs: xs.length });

/**
 * rates: [{register, group, words?, byProbe?, jev, regex}] -> { register: { human, ai, human_all, ai_all, regex_human, regex_ai } }
 * `human` and `ai` count only the trusted probes, the ones a default `scan --judge` runs, so a file's rate
 * compares like with like. `*_all` count every probe. Synthetic docs are left out.
 */
export function baselines(rates, trusted = null) {
  const out = {};
  const real = rates.filter((r) => r.group !== "synthetic");
  const trustedRate = (r) => {
    if (!trusted || !r.byProbe || !r.words) return r.jev;
    const n = Object.entries(r.byProbe).reduce((s, [k, c]) => s + (trusted.has(k) ? c : 0), 0);
    return (n / r.words) * 1000;
  };
  for (const reg of [...new Set(real.map((r) => r.register))]) {
    const of = (g, f) => real.filter((r) => r.register === reg && (g === "human" ? r.group === "human" : r.group.startsWith("ai"))).map(f);
    out[reg] = {
      human: stat(of("human", trustedRate)),
      ai: stat(of("ai", trustedRate)),
      human_all: stat(of("human", (r) => r.jev)),
      ai_all: stat(of("ai", (r) => r.jev)),
      regex_human: stat(of("human", (r) => r.regex)),
      regex_ai: stat(of("ai", (r) => r.regex)),
    };
  }
  return out;
}

// ── guard pairs ─────────────────────────────────────────────────────────────

const stripEllipsis = (s) => String(s ?? "").replaceAll("…", "");

/** Cases from compare() output for one pair. */
export function guardCases(pair, original, rewrite, res) {
  const origSents = splitSentences(original);
  const rewSents = splitSentences(rewrite);
  const origSet = new Set(origSents.map(norm));
  const rewSet = new Set(rewSents.map(norm));
  const out = { "guard.supports": [], "guard.dropped": [] };
  const isLit = (h) => /literal:/.test(h.note ?? "");
  const on = (h, sentence) => quoteMatch(sentence, stripEllipsis(h.excerpt));
  const lit = (sentence) => res.hits.some((h) => isLit(h) && on(h, sentence));
  const jev = (name, sentence) => res.hits.filter((h) => h.name === name && !isLit(h) && on(h, sentence));
  const uns = (key, sentence) => res.unsettled.filter((x) => x.key === key && quoteMatch(sentence, stripEllipsis(x.sentence)));
  // Sentences with a literal hit never reached Jev, so they are not Jev cases.
  for (const s of rewSents.filter((x) => !origSet.has(norm(x)) && !lit(x))) {
    const expected = anyMatch(s, pair.changed ?? []);
    const h = jev("Changed claim", s);
    out["guard.supports"].push({ expected, predicted: h.length ? "tell" : uns("guard.supports", s).length ? "unsettled" : "clean", correct: expected && h.length > 0 });
  }
  for (const s of origSents.filter((x) => !rewSet.has(norm(x)) && !lit(x))) {
    const expected = anyMatch(s, pair.dropped ?? []);
    const h = jev("Dropped point", s);
    out["guard.dropped"].push({ expected, predicted: h.length ? "tell" : uns("guard.dropped", s).length ? "unsettled" : "clean", correct: expected && h.length > 0 });
  }
  return out;
}

// ── corpus and labels ───────────────────────────────────────────────────────

function jsonl(file) {
  return readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

export function readLabels(spec, corpus) {
  const target = spec ?? join(corpus, "labels");
  let files = [];
  if (/[*?]/.test(target)) {
    const dir = dirname(target);
    const re = globToRe(basename(target));
    if (existsSync(dir)) files = readdirSync(dir).filter((f) => re.test(f)).map((f) => join(dir, f));
  } else if (existsSync(target) && statSync(target).isDirectory()) files = readdirSync(target).filter((f) => f.endsWith(".jsonl")).map((f) => join(target, f));
  else if (existsSync(target)) files = [target];
  const docs = [];
  const pairs = [];
  for (const f of files.sort()) for (const l of jsonl(f)) (l.original && l.rewrite ? pairs : l.doc ? docs : []).push(l);
  return { docs, pairs };
}

/** Docs named by manifest.jsonl files, for a dry run with no labels. */
export function manifestDocs(corpus) {
  const out = [];
  if (!existsSync(corpus)) return out;
  for (const g of readdirSync(corpus).sort()) {
    const m = join(corpus, g, "manifest.jsonl");
    if (!existsSync(m)) continue;
    for (const e of jsonl(m)) out.push({ doc: `${g}/${e.path}`, register: e.register, group: g, split: "all", labels: null });
  }
  return out;
}

// ── a client that only counts, for --dry-run ────────────────────────────────

const tok = (v) => Math.ceil(JSON.stringify(v).length / 4);

export function countingClient(judge) {
  const t = { requests: 0, tokens: 0 };
  return {
    totals: t,
    model: judge.model,
    spent: () => ({ usd: (t.tokens * judge.usd_per_mtok) / 1e6, input_tokens: t.tokens, requests: t.requests, cache_hits: 0 }),
    ask: async ({ state, questions }) => {
      const names = Object.keys(questions);
      t.requests++;
      t.tokens += tok(state) * names.length + names.reduce((s, n) => s + tok(questions[n]), 0);
      const answers = {};
      for (const n of names) {
        const q = questions[n];
        if (q.type === "noul") answers[n] = { type: "noul", noul: 0.9 };
        else {
          const keys = Object.keys(q.criteria);
          answers[n] = { type: "choice", choice: keys[0], confidence: 0.9, probabilities: Object.fromEntries(keys.map((k, i) => [k, i === 0 ? 0.9 : 0.1 / Math.max(1, keys.length - 1)])) };
        }
      }
      return { answers, usage: { input_tokens: 0, output_tokens: 0, usd: 0 }, cached: {} };
    },
  };
}

// ── the run ─────────────────────────────────────────────────────────────────

const trustReg = { model: null, probes: { register: { trusted: true } } };

/**
 * Runs the harness. opts: { corpus, labels, split, only, dryRun, client, judge }.
 * Returns { table, baselines, spend, docs, stopped, dry }.
 */
export async function runStress(opts, io = {}) {
  const judge = opts.judge ?? loadJudge();
  const corpus = resolve(opts.corpus);
  const rules = io.rules ?? loadRules();
  const cfg = emptyConfig();
  const client = opts.client;
  const split = opts.split ?? "all";
  const only = opts.only ? new Set(opts.only) : null;
  const want = (key) => !only || only.has(key);
  const { docs: labelled, pairs } = readLabels(opts.labels, corpus);
  let docs = labelled;
  if (opts.dryRun) {
    const have = new Set(labelled.map((d) => d.doc));
    docs = [...labelled, ...manifestDocs(corpus).filter((d) => !have.has(d.doc))];
  }
  docs = docs.filter((d) => split === "all" || (d.split ?? "all") === split);
  const table = {};
  const rates = [];
  const regs = {};
  let stopped = null;
  let measured = 0;
  const dry = { docs: docs.length, sections: 0, byRegister: {} };

  for (const d of docs) {
    if (stopped) break;
    const path = join(corpus, d.doc);
    const src = existsSync(path) ? readText(path) : null;
    if (src == null || judge.never.includes(d.register)) continue;
    const ext = extname(path).toLowerCase();
    const extractor = extractorFor(d.doc) ?? "markdown";
    const res = scanUnit({ label: d.doc, rel: d.doc, src, register: d.register, extractor, ext, comments: false }, { rules, cfg });
    const segs = res.segs.filter((s) => s.kind !== "comment");
    const units = buildUnits(segs, { register: d.register, judge, title: basename(path), src, ext });
    dry.sections += units.sections.length;
    dry.byRegister[d.register] = (dry.byRegister[d.register] ?? 0) + 1;
    const labels = d.labels ?? null;
    const keys = applicableProbes(d.register, judge).filter((k) => want(k) && (!labels || k in labels));
    const sub = { ...judge, probes: Object.fromEntries(keys.map((k) => [k, judge.probes[k]])) };
    const pr = await runProbes({ units, register: d.register, judge: sub, trust: {}, client, untrusted: true, scanHits: res.hits, cfg, rules });
    if (pr.status === "budget" || pr.status === "no_key" || pr.status === "off") {
      stopped = pr.status;
    }
    if (labels) {
      for (const k of keys) {
        if (!pr.coverage.checked.includes(k)) continue;
        for (const c of casesFor(k, judge.probes[k], units, labels[k] ?? [], pr, { scanHits: res.hits, judge })) addCase(table, k, c);
      }
      const s29 = judge.code?.S29;
      if ("S29" in labels && want("S29") && s29?.registers.includes(d.register))
        for (const c of casesFor("S29", { unit: "document" }, units, labels.S29, pr, { judge })) addCase(table, "S29", c);
    }
    if (pr.status === "ok" && labels) {
      const per1k = (n) => (res.words ? (n / res.words) * 1000 : 0);
      const byProbe = {};
      for (const h of pr.hits) byProbe[h.probe] = (byProbe[h.probe] ?? 0) + 1;
      rates.push({ register: d.register, group: d.group ?? "", words: res.words, byProbe, jev: per1k(pr.hits.length), regex: per1k(res.hits.filter((h) => h.tier === "block" || h.tier === "warn").length) });
    }
    if (labels?.leave === undefined && !labels && !opts.dryRun) continue;
    // Leave questions, one regex hit at a time.
    if (!stopped) {
      const leaves = labels?.leave ?? d.leave ?? [];
      for (const lv of leaves) {
        const key = `leave.${lv.id}`;
        if (!want(key) || !judge.leave?.[lv.id]) continue;
        const h = res.hits.find((x) => x.id === lv.id && x.line === lv.line && x.kind === "tell");
        if (!h) continue;
        const lf = await leaveFilter([{ ...h, tier: "warn" }], segs, { register: d.register, judge, trust: {}, client, untrusted: true });
        if (lf.status !== "ok") {
          stopped = lf.status;
          break;
        }
        const asked = lf.coverage.checked.length || lf.coverage.unsettled.length;
        if (!asked) continue;
        const yes = lf.hits[0].tier === "info";
        addCase(table, key, { expected: !!lv.leave, predicted: lf.coverage.unsettled.length ? "unsettled" : yes ? "tell" : "clean", correct: !!lv.leave && yes });
      }
    }
    // Register.
    if (!stopped && want("register") && (labels || opts.dryRun)) {
      try {
        const r = await inferRegisterJev(src, { judge, trust: trustReg, client });
        if (!r.why) addCase(table, "register", { expected: true, predicted: r.register ? (r.register === d.register ? "tell" : "clean") : "unsettled", correct: r.register === d.register });
      } catch (e) {
        if (!(e instanceof JevError)) throw e;
        if (["budget", "no_key", "off"].includes(e.code)) stopped = e.code;
      }
    }
    measured++;
  }

  if (!stopped && !opts.dryRun) {
    for (const p of pairs.filter((x) => split === "all" || (x.split ?? "all") === split)) {
      if (stopped) break;
      const read = (rel) => (rel && existsSync(join(corpus, rel)) ? readFileSync(join(corpus, rel), "utf8") : null);
      const original = read(p.original);
      const rewrite = read(p.rewrite);
      if (original == null || rewrite == null) continue;
      const res = await compare({ original, rewrite, register: p.register, judge, trust: {}, client, untrusted: true, originalPath: p.original, rewritePath: p.rewrite });
      if (["budget", "no_key", "off"].includes(res.status)) {
        stopped = res.status;
        break;
      }
      if (res.status !== "ok" && res.status !== "untrusted") continue;
      const gc = guardCases(p, original, rewrite, res);
      for (const [k, list] of Object.entries(gc)) if (want(k)) for (const c of list) addCase(table, k, c);
    }
  }

  const rows = Object.keys(table).sort().map((k) => finalize(k, table[k], judge.trust));
  regs.value = baselines(rates, new Set(rows.filter((r) => r.trusted).map((r) => r.key)));
  return { rows, baselines: regs.value, spend: client?.spent?.() ?? { usd: 0, input_tokens: 0, requests: 0, cache_hits: 0 }, docs: measured, stopped, dry };
}

// ── output ──────────────────────────────────────────────────────────────────

const cell = (v) => (v == null ? "-" : String(v));

export function renderReport({ model, date, split, result }) {
  const L = [];
  L.push("# Jev stress report", "");
  L.push(`Model ${model}, measured ${date}, split ${split}, ${result.docs} docs.${result.stopped ? ` Stopped early: ${result.stopped}.` : ""}`, "");
  L.push("Metrics only; this file never holds corpus text.", "");
  L.push("| key | cases | pos | neg | settled | wrong | recall | fp | trusted | reason |", "|---|---|---|---|---|---|---|---|---|---|");
  for (const r of result.rows) L.push(`| ${r.key} | ${r.cases} | ${r.pos} | ${r.neg} | ${r.settled} | ${r.wrong} | ${cell(r.recall)} | ${cell(r.fp)} | ${r.trusted ? "yes" : "no"} | ${r.trusted ? "" : r.reason} |`);
  L.push("", "## Baselines", "", "Tells per 1,000 words per doc, median and p90, with the doc count.", "");
  L.push("| register | human Jev | ai Jev | human regex | ai regex |", "|---|---|---|---|---|");
  const f = (s) => (s.docs ? `${s.median} / ${s.p90} (${s.docs})` : "-");
  for (const [reg, b] of Object.entries(result.baselines)) L.push(`| ${reg} | ${f(b.human)} | ${f(b.ai)} | ${f(b.regex_human)} | ${f(b.regex_ai)} |`);
  const s = result.spend;
  L.push("", "## Spend", "", `$${(s.usd ?? 0).toFixed(4)}, ${s.requests ?? 0} requests, ${s.input_tokens ?? 0} input tokens, ${s.cache_hits ?? 0} cache hits.`, "");
  return L.join("\n");
}

export function trustFile({ model, date, split, result }) {
  return {
    model,
    measured: date,
    split,
    probes: Object.fromEntries(result.rows.map((r) => [r.key, { trusted: r.trusted, cases: r.cases, pos: r.pos, neg: r.neg, settled: r.settled, wrong: r.wrong, recall: r.recall, fp: r.fp }])),
    baselines: result.baselines,
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const USAGE = `usage: stress.mjs [--corpus DIR] [--labels GLOB|DIR] [--split held|tune|all] [--budget USD]
                  [--write-trust] [--dry-run] [--only key,key]`;

export function parseArgs(argv) {
  const o = { corpus: join(ROOT, "evals/corpus"), labels: null, split: "all", budget: 3, writeTrust: false, dryRun: false, only: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--corpus") o.corpus = resolve(val());
    else if (a === "--labels") o.labels = resolve(val());
    else if (a === "--split") {
      o.split = val();
      if (!["held", "tune", "all"].includes(o.split)) throw new Error("--split takes held, tune or all");
    } else if (a === "--budget") {
      o.budget = parseFloat(val());
      if (!Number.isFinite(o.budget) || o.budget < 0) throw new Error("--budget takes a dollar amount");
    } else if (a === "--write-trust") o.writeTrust = true;
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--only") o.only = val().split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "-h" || a === "--help") o.help = true;
    else throw new Error(`unknown option ${a}`);
  }
  return o;
}

/** The CLI as a function. io: { out, err, client, reportPath, trustPath, today, env }. */
export async function main(argv, io = {}) {
  const out = io.out ?? ((s) => process.stdout.write(s + "\n"));
  const err = io.err ?? ((s) => process.stderr.write(s + "\n"));
  let o;
  try {
    o = parseArgs(argv);
  } catch (e) {
    err(`stress: ${e.message}\n${USAGE}`);
    return 2;
  }
  if (o.help) {
    out(USAGE);
    return 0;
  }
  if (o.writeTrust && o.split !== "held") {
    err("stress: --write-trust needs --split held (trust is measured on the held split only)");
    return 2;
  }
  if (o.writeTrust && o.dryRun) {
    err("stress: --write-trust cannot be combined with --dry-run");
    return 2;
  }
  const judge = io.judge ?? loadJudge();
  const date = io.today ?? new Date().toLocaleDateString("en-CA");
  const client = o.dryRun ? countingClient(judge) : (io.client ?? createClient({ budgetUsd: o.budget, env: io.env ?? process.env, judge }));
  const result = await runStress({ ...o, client, judge }, io);
  if (o.dryRun) {
    const s = client.spent();
    out(`dry run: ${result.dry.docs} docs, ${result.dry.sections} sections`);
    out(`by register: ${Object.entries(result.dry.byRegister).map(([r, n]) => `${r} ${n}`).join(", ") || "none"}`);
    out(`estimated ${s.requests} requests, ${s.input_tokens} input tokens, $${s.usd.toFixed(4)} (budget $${o.budget})`);
    return 0;
  }
  const report = renderReport({ model: judge.model, date, split: o.split, result });
  writeFileSync(io.reportPath ?? REPORT_PATH, report);
  if (o.writeTrust) writeFileSync(io.trustPath ?? TRUST_PATH, JSON.stringify(trustFile({ model: judge.model, date, split: o.split, result }), null, 2) + "\n");
  out(`stress: ${result.rows.length} probe keys over ${result.docs} docs, ${result.rows.filter((r) => r.trusted).length} trusted, $${result.spend.usd.toFixed(4)} spent${result.stopped ? `, stopped: ${result.stopped}` : ""}`);
  return result.stopped === "no_key" ? 1 : 0;
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => {
    process.exitCode = c;
  });
}

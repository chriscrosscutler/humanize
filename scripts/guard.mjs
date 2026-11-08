#!/usr/bin/env node
// The fact guard for humanize: a rewrite may not add facts, drop points, or
// claim what the project does not do. Code checks literals first (numbers,
// URLs, quotes, code spans, names). Jev reads the rest through typed questions.
// Zero dependencies. Tests inject a fake client; nothing here touches a key.

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { candidates, createClient, isTrusted, JevError, loadJudge, loadTrust, reversed, settle, settleChoice } from "./jev.mjs";
import { extract, extractorFor, findConfig, inferRegister, loadConfig, loadRules, readText, splitSentences } from "./scan.mjs";

const MAX_REQUEST_TOKENS = 64000;
const MAX_ORIGINAL_TOKENS = 24000;
const MAX_DROPPED = 40;
const SNIPPET_LINES = 20;
const MAX_SNIPPETS = 10;
const MAX_SNIPPET_FILE = 200 * 1024;

const tokens = (v) => Math.ceil((typeof v === "string" ? v : JSON.stringify(v)).length / 4);
const fold = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();
const clip = (s, n = 90) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const fill = (s, id) => s.replaceAll("{id}", id);
const pct = (p) => (typeof p === "number" && !Number.isNaN(p) ? p.toFixed(2) : "?");

// ── literals ────────────────────────────────────────────────────────────────

const URL_RE = /https?:\/\/[^\s<>"'`]+/g;
const CODE_RE = /`([^`\n]+)`/g;
const QUOTE_RE = /"([^"\n]{3,})"|“([^”\n]{3,})”|‘([^’\n]{3,})’/g;
const NUM_RE = /\$?\d+(?:,\d{3})*(?:\.\d+)?(?:%|[a-z]{1,2}\b)?/gi;
const NAME_RUN = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g;
const ALLCAPS = /\b[A-Z]{2,}\b/g;
const MIXED = /\b[a-z]+[A-Z][A-Za-z]*\b/g;
const NUM_UNITS = new Set(["s", "x", "ms", "mb", "gb", "kb", "tb", "k", "m", "h", "px", "pt", "hz"]);

function normNumber(raw) {
  const s = raw.toLowerCase().replace(/,/g, "");
  const m = s.match(/^(\$?\d+(?:\.\d+)?)(.*)$/);
  if (!m) return s;
  // "10th" and "3rd" carry no unit; keep percent and real units only.
  return m[1] + (m[2] === "%" || NUM_UNITS.has(m[2]) ? m[2] : "");
}

/** Literals of a text as Sets of normalized strings: numbers, urls, quotes, code, names. */
export function literals(text) {
  const out = { numbers: new Set(), urls: new Set(), quotes: new Set(), code: new Set(), names: new Set() };
  let rest = text;
  const take = (re, fn) => {
    rest = rest.replace(re, (...m) => {
      fn(m);
      return " ";
    });
  };
  take(CODE_RE, (m) => out.code.add(fold(m[1])));
  take(URL_RE, (m) => out.urls.add(m[0].replace(/[.,;:!?)\]]+$/, "").toLowerCase()));
  take(QUOTE_RE, (m) => out.quotes.add(fold(m[1] ?? m[2] ?? m[3])));
  take(NUM_RE, (m) => out.numbers.add(normNumber(m[0])));
  // Names: capitalized runs not at a sentence start, ALLCAPS, mixed case.
  for (const sent of splitSentences(rest)) {
    const leadStart = sent.search(/[\p{L}\p{N}]/u);
    for (const m of sent.matchAll(NAME_RUN)) {
      const name = m.index === leadStart ? m[0].split(/\s+/).slice(1).join(" ") : m[0];
      if (name) out.names.add(name.toLowerCase());
    }
  }
  for (const m of rest.matchAll(ALLCAPS)) out.names.add(m[0].toLowerCase());
  for (const m of rest.matchAll(MIXED)) out.names.add(m[0].toLowerCase());
  return out;
}

const KINDS = ["numbers", "urls", "quotes", "code", "names"];
const LOOSE = new Set(["urls", "quotes", "code", "names"]);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function has(kind, lit, set, foldedText) {
  if (set.has(lit)) return true;
  if (!LOOSE.has(kind)) return false;
  // A name must appear as a whole word: "Pro" is not in "provides".
  if (kind === "names") return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(lit)}(?![\\p{L}\\p{N}])`, "u").test(foldedText);
  return foldedText.includes(lit);
}

// ── reading text ────────────────────────────────────────────────────────────

/** Sentences of a text with ids and source lines. `prefix` is "o" or "r". */
function sentencesOf(text, path, prefix) {
  const named = path && path !== "-";
  const kind = named ? (extractorFor(path) ?? "markdown") : "markdown";
  const segs = extract(kind, text, { ext: named ? extname(path).toLowerCase() : "" });
  const out = [];
  for (const seg of segs) {
    for (const s of splitSentences(seg.text)) out.push({ id: `${prefix}${out.length + 1}`, text: s, line: seg.line ?? 1 });
  }
  return out;
}

const tag = (list) => list.map((s) => `${s.id}| ${s.text}`).join("\n");

// ── Jev context: gating, errors ─────────────────────────────────────────────

/** The register a path reads as, from the project's config and the default globs; null for stdin. */
export function pathRegister(path, cwd = process.cwd()) {
  if (!path || path === "-") return null;
  const rules = loadRules();
  const found = findConfig(dirname(resolve(cwd, path)));
  const cfg = found ? loadConfig(found, { rules }) : null;
  const base = cfg?.dir ?? cwd;
  return inferRegister(relative(base, resolve(cwd, path)).split(/[\\/]/).join("/"), cfg, rules);
}

function context({ trust, client, untrusted, off, env, never }) {
  const killed = off || (env ?? process.env).HUMANIZE_JEV === "0";
  const ctx = { status: killed ? "off" : "ok", reason: killed ? "off" : null, notChecked: [], asks: 0, dead: killed };
  // Legal, commit, PR, comment and chat text never goes to Jev; the literal checks still run.
  if (never && !killed) Object.assign(ctx, { status: "skipped", reason: never, dead: true });
  ctx.gate = (key) => {
    if (ctx.dead) return null;
    if (isTrusted(trust, key)) return { untrusted: false };
    if (untrusted) return { untrusted: true };
    if (!ctx.notChecked.some((n) => n.key === key)) ctx.notChecked.push({ key, why: "untrusted" });
    return null;
  };
  ctx.fail = (code) => {
    ctx.dead = true;
    if (ctx.status === "ok") {
      ctx.status = ["off", "no_key", "budget"].includes(code) ? code : "error";
      ctx.reason = code;
    }
  };
  ctx.ask = async (state, questions) => {
    if (ctx.dead) return null;
    if (!client) {
      ctx.fail("no_key");
      return null;
    }
    try {
      ctx.asks += 1;
      const res = await client.ask({ state, questions });
      return res.answers ?? {};
    } catch (e) {
      ctx.fail(e instanceof JevError ? e.code : "bad_response");
      return null;
    }
  };
  ctx.finish = () => {
    if (ctx.status === "ok" && ctx.notChecked.length && !ctx.asks) ctx.status = "untrusted";
  };
  ctx.tier = (tier, g) => (g?.untrusted ? "info" : tier);
  return ctx;
}

const noulP = (a) => (a && typeof a.noul === "number" ? a.noul : Number.NaN);

function hit(over) {
  return { id: "K6", family: "K", kind: "guard", name: "", tier: "warn", fix: "", match: "", line: 1, excerpt: "", note: "", count: 1, source: "code", p: null, probe: null, ...over };
}

// ── compare ─────────────────────────────────────────────────────────────────

const FIX_ADDED = "Remove the added fact or confirm it with the author.";
const FIX_CHANGED = "Restore what the original says, or cut the claim.";
const FIX_DROPPED = "Put the point back, or confirm it was filler.";

const neverSent = (judge, register) => (register && judge.never.includes(register) ? `register ${register} is never sent` : null);

export async function compare({ original, rewrite, register, judge = loadJudge(), trust, client, untrusted = false, off = false, env, originalPath, rewritePath } = {}) {
  const g = judge.guard;
  const ctx = context({ trust, client, untrusted, off, env, never: neverSent(judge, register ?? pathRegister(originalPath)) });
  const hits = [];
  const unsettled = [];
  const added = [];
  const dropped = [];
  const result = () => {
    ctx.finish();
    return { status: ctx.status, reason: ctx.reason, hits, unsettled, notChecked: ctx.notChecked, literals: { added, dropped } };
  };

  const os = sentencesOf(original, originalPath, "o");
  const rs = sentencesOf(rewrite, rewritePath, "r");
  const origFolded = fold(os.map((s) => s.text).join(" "));
  const rewFolded = fold(rs.map((s) => s.text).join(" "));
  const origLits = literals(os.map((s) => s.text).join(" "));
  const rewLits = literals(rs.map((s) => s.text).join(" "));

  // 1. Literals, per sentence for the line number.
  const blocked = new Set();
  for (const s of rs) {
    const l = literals(s.text);
    for (const kind of KINDS) {
      for (const lit of l[kind]) {
        if (has(kind, lit, origLits[kind], origFolded) || added.includes(lit)) continue;
        added.push(lit);
        blocked.add(s.id);
        hits.push(hit({ name: "Added literal", tier: g.tiers.added, fix: FIX_ADDED, match: lit, line: s.line, excerpt: clip(s.text, 120), note: `added literal: ${lit}` }));
      }
    }
  }
  const droppedBy = new Set();
  for (const s of os) {
    const l = literals(s.text);
    for (const kind of ["numbers", "urls", "code"]) {
      for (const lit of l[kind]) {
        if (has(kind, lit, rewLits[kind], rewFolded) || dropped.includes(lit)) continue;
        dropped.push(lit);
        droppedBy.add(s.id);
        hits.push(hit({ name: "Dropped point", tier: g.tiers.dropped, fix: FIX_DROPPED, match: lit, line: s.line, excerpt: clip(s.text, 120), note: `dropped literal: ${lit}` }));
      }
    }
  }

  // 2. Rewrite sentences that changed.
  const origSet = new Set(os.map((s) => fold(s.text)));
  const rewrSet = new Set(rs.map((s) => fold(s.text)));
  const changed = rs.filter((s) => !origSet.has(fold(s.text)) && !blocked.has(s.id));

  if (changed.length && os.length) {
    const sup = ctx.gate("guard.supports");
    if (sup) {
      if (tokens(tag(os)) > MAX_ORIGINAL_TOKENS) {
        ctx.status = "too_long";
        ctx.reason = "too_long";
        return result();
      }
      await supportStage({ ctx, g, judge, os, rs, changed, sup, hits, unsettled });
    }
  }

  // 5. Dropped points.
  const drop = ctx.gate("guard.dropped");
  if (drop && rs.length) {
    const strong = (s) => /\d|https?:\/\/|`|\s[A-Z][a-z]/.test(s.text);
    const facty = (s) => strong(s) || s.text.split(/\s+/).length >= 12;
    const pool = os.filter((s) => facty(s) && !rewrSet.has(fold(s.text)) && !droppedBy.has(s.id));
    const picks = [...pool.filter(strong), ...pool.filter((s) => !strong(s))].slice(0, MAX_DROPPED);
    const whole = tag(rs);
    for (const s of picks) {
      const q = { dropped: { type: "noul", instructions: g.dropped.instructions, criteria: g.dropped.criteria } };
      const ans = await ctx.ask({ sentence: s.text, rewrite: whole }, q);
      if (!ans) break;
      const p = noulP(ans.dropped);
      const v = settle(p, judge.thresholds);
      if (v === "yes") {
        hits.push(hit({ name: "Dropped point", tier: ctx.tier(g.tiers.dropped, drop), fix: FIX_DROPPED, match: clip(s.text, 60), line: s.line, excerpt: clip(s.text, 120), note: `jev guard.dropped p=${pct(p)}: not in the rewrite`, source: "jev", p, probe: "guard.dropped", untrusted: drop.untrusted || undefined }));
      } else if (v === "unsettled") {
        unsettled.push({ line: s.line, sentence: clip(s.text, 120), key: "guard.dropped", why: `jev guard.dropped p=${pct(p)}: unsettled` });
      }
    }
  }
  return result();
}

async function supportStage({ ctx, g, judge, os, rs, changed, sup, hits, unsettled }) {
  // 3. Source picks, batched so no request passes the token cap.
  const state = { original: tag(os), rewrite: tag(rs) };
  const optCriteria = Object.fromEntries(os.map((s) => [s.id, null]));
  const perQuestion = tokens(state) + tokens(optCriteria) + tokens(g.source.instructions) + 40;
  const batchSize = Math.max(1, Math.floor(MAX_REQUEST_TOKENS / (perQuestion * 2)));
  const answers = {};
  for (let i = 0; i < changed.length; i += batchSize) {
    const questions = {};
    for (const s of changed.slice(i, i + batchSize)) {
      const q = { type: "choice", instructions: fill(g.source.instructions, s.id), criteria: optCriteria };
      questions[`source_${s.id}`] = q;
      questions[`source_${s.id}_rev`] = reversed(q);
    }
    const ans = await ctx.ask(state, questions);
    if (!ans) return;
    Object.assign(answers, ans);
  }
  const idx = new Map(os.map((s, i) => [s.id, i]));
  for (const s of changed) {
    const r = settleChoice(answers[`source_${s.id}`], answers[`source_${s.id}_rev`], judge.margin);
    const cands = candidates(r.probs, { min: judge.locate_min, max: judge.locate_max });
    if (!cands.length) {
      unsettled.push({ line: s.line, sentence: clip(s.text, 120), key: "guard.supports", why: "no source sentence found" });
      continue;
    }
    const keep = new Set();
    for (const c of cands) {
      const i = idx.get(c);
      if (i == null) continue;
      for (const j of [i - 1, i, i + 1]) if (j >= 0 && j < os.length) keep.add(j);
    }
    const source = [...keep].sort((a, b) => a - b).map((j) => os[j]);
    const q = { supports: { type: "noul", instructions: g.supports.instructions, criteria: g.supports.criteria } };
    const ans = await ctx.ask({ source: tag(source), sentence: s.text }, q);
    if (!ans) return;
    const p = noulP(ans.supports);
    const v = settle(p, judge.thresholds);
    if (v === "no") {
      hits.push(hit({ name: "Changed claim", tier: ctx.tier(g.tiers.changed, sup), fix: FIX_CHANGED, match: clip(s.text, 60), line: s.line, excerpt: clip(s.text, 120), note: `jev guard.supports p=${pct(p)}: not in the original`, source: "jev", p, probe: "guard.supports", untrusted: sup.untrusted || undefined }));
    } else if (v === "unsettled") {
      unsettled.push({ line: s.line, sentence: clip(s.text, 120), key: "guard.supports", why: `jev guard.supports p=${pct(p)}: unsettled` });
    }
  }
}

// ── evidence ────────────────────────────────────────────────────────────────

const STOP = new Set(
  "about above after again also always been before being below between both cannot could does doing down during each every from further have having here into just keep keeps like make many more most much never only other over same should some such than that their them then there these they this those through under until upon very want were what when where which while will with within without would your yours".split(" "),
);
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git", "vendor", ".next", ".turbo", "coverage"]);
const SKIP_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".gz", ".mp4", ".mov", ".woff", ".woff2", ".ttf", ".otf", ".icns", ".car", ".bin", ".map", ".lock", ".lockb"]);
const SKIP_NAMES = new Set(["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "Cargo.lock", "Gemfile.lock", "poetry.lock", "composer.lock"]);

function projectFiles(root) {
  let list = null;
  try {
    list = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 })
      .split("\0")
      .filter(Boolean);
  } catch {
    /* not a git work tree */
  }
  if (list?.length) return list;
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name));
      } else if (e.isFile()) out.push(relative(root, join(dir, e.name)));
    }
  };
  walk(root);
  return out;
}

/** Content words of 4+ letters, minus stopwords. */
export function claimTerms(claim) {
  const words = claim.toLowerCase().match(/[a-z]{4,}/g) ?? [];
  return [...new Set(words.filter((w) => !STOP.has(w)))];
}

// Other copy (another page, the store listing, llms.txt, an audit that quotes it) repeats a claim; it is not evidence for it.
const COPY_REGISTERS = new Set(["landing", "store", "release", "social", "email"]);
const copyTest = new Map();
function isCopyFile(root) {
  if (!copyTest.has(root)) {
    const rules = loadRules();
    const found = findConfig(root);
    const cfg = found ? loadConfig(found, { rules }) : null;
    copyTest.set(root, (rel) => COPY_REGISTERS.has(inferRegister(rel, cfg, rules)) || /(^|\/)llms(-full)?\.txt$|(^|\/)audits\//.test(rel));
  }
  return copyTest.get(root);
}

/** Up to 10 snippets of at most 20 lines from the project's code and docs that share terms with the claim. */
export function grepSnippets(claim, root, { skip, copy = false } = {}) {
  const terms = claimTerms(claim);
  if (!terms.length) return [];
  const skipAbs = skip ? resolve(skip) : null;
  const isCopy = copy ? () => false : isCopyFile(root);
  const scored = [];
  for (const rel of projectFiles(root)) {
    const parts = rel.split(/[\\/]/);
    if (parts.some((p) => SKIP_DIRS.has(p)) || isCopy(rel)) continue;
    const name = parts[parts.length - 1];
    if (SKIP_NAMES.has(name) || SKIP_EXT.has(extname(name).toLowerCase())) continue;
    const abs = resolve(root, rel);
    if (abs === skipAbs) continue;
    try {
      if (statSync(abs).size > MAX_SNIPPET_FILE) continue;
    } catch {
      continue;
    }
    const text = readText(abs);
    if (text == null) continue;
    const lines = text.split(/\r?\n/);
    const seen = new Set();
    let best = { n: 0, i: 0 };
    lines.forEach((raw, i) => {
      const l = raw.toLowerCase();
      let n = 0;
      for (const t of terms) {
        if (l.includes(t)) {
          n += 1;
          seen.add(t);
        }
      }
      if (n > best.n) best = { n, i };
    });
    if (!seen.size) continue;
    const start = Math.max(0, Math.min(best.i - 5, lines.length - SNIPPET_LINES));
    scored.push({ path: rel.split("\\").join("/"), line: best.i + 1, text: lines.slice(start, start + SNIPPET_LINES).join("\n"), terms: seen.size, dense: best.n });
  }
  scored.sort((a, b) => b.terms - a.terms || b.dense - a.dense || a.path.localeCompare(b.path));
  return scored.slice(0, MAX_SNIPPETS).map((s, i) => ({ id: `c${i + 1}`, path: s.path, line: s.line, text: s.text }));
}

const tagSnippets = (sn) => sn.map((s) => `${s.id}| ${s.path}:${s.line}\n${s.text}`).join("\n\n");

function sectionsOf(segs, maxChars) {
  const sections = [];
  let cur = [];
  for (const seg of segs) {
    if (seg.kind === "heading") {
      if (cur.length) sections.push(cur);
      cur = [];
      continue;
    }
    for (const t of splitSentences(seg.text)) cur.push({ text: t, line: seg.line ?? 1 });
  }
  if (cur.length) sections.push(cur);
  const out = [];
  for (const sec of sections) {
    let chunk = [];
    let n = 0;
    for (const s of sec) {
      if (chunk.length && n + s.text.length > maxChars) {
        out.push(chunk);
        chunk = [];
        n = 0;
      }
      chunk.push(s);
      n += s.text.length + 8;
    }
    if (chunk.length) out.push(chunk);
  }
  return out;
}

export async function evidence({ path, text, register, root = process.cwd(), judge = loadJudge(), trust, client, untrusted = false, off = false, env } = {}) {
  const ev = judge.evidence;
  register ??= pathRegister(path) ?? undefined;
  const ctx = context({ trust, client, untrusted, off, env });
  const hits = [];
  const claims = [];
  const unsettled = [];
  const done = () => {
    ctx.finish();
    return { status: ctx.status, reason: ctx.reason, hits, claims, unsettled, notChecked: ctx.notChecked };
  };
  if (register && !ev.registers.includes(register)) {
    ctx.status = "skipped";
    ctx.reason = `register ${register} is not checked for evidence`;
    return done();
  }
  const gate = ctx.gate("evidence");
  if (!gate) return done();

  const named = path && path !== "-";
  const kind = named ? (extractorFor(path) ?? "markdown") : "markdown";
  const segs = extract(kind, text, { ext: named ? extname(path).toLowerCase() : "" });
  const sections = sectionsOf(segs, judge.section_max_tokens * judge.chars_per_token);

  for (const sec of sections) {
    const tagged = sec.map((s, i) => ({ ...s, id: `s${i + 1}` }));
    const questions = {};
    for (const s of tagged) questions[`claim_${s.id}`] = { type: "noul", instructions: fill(ev.is_claim.instructions, s.id), criteria: ev.is_claim.criteria };
    const ans = await ctx.ask({ section: tag(tagged) }, questions);
    if (!ans) return done();
    for (const s of tagged) {
      const p = noulP(ans[`claim_${s.id}`]);
      const v = settle(p, judge.thresholds);
      if (v === "unsettled") {
        unsettled.push({ line: s.line, sentence: clip(s.text, 120), key: "evidence", why: `jev evidence is_claim p=${pct(p)}: unsettled` });
        continue;
      }
      if (v !== "yes") continue;
      const found = await findSource({ ctx, ev, judge, claim: s, root, path: named ? path : null });
      if (found === "dead") return done();
      if (found.unsettled) {
        unsettled.push({ line: s.line, sentence: clip(s.text, 120), key: "evidence", why: found.unsettled });
        continue;
      }
      claims.push({ line: s.line, sentence: s.text, source: found.source, p: found.p });
      if (!found.source) {
        hits.push(hit({ id: "K2", name: "Claim without a source", tier: ctx.tier(judge.tiers.K2?.default ?? "warn", gate), fix: "Find the code or doc behind the claim, or cut it.", match: clip(s.text, 60), line: s.line, excerpt: clip(s.text, 120), note: "no source found, verify", source: found.noSnippets ? "code" : "jev", p: found.p, probe: "evidence", untrusted: gate.untrusted || undefined }));
      }
    }
  }
  return done();
}

async function findSource({ ctx, ev, judge, claim, root, path }) {
  const snippets = grepSnippets(claim.text, root, { skip: path ? resolve(path) : null });
  if (!snippets.length) return { source: null, p: null, noSnippets: true };
  const state = { claim: claim.text, snippets: tagSnippets(snippets) };
  const criteria = Object.fromEntries(snippets.map((s) => [s.id, null]));
  const q = { type: "choice", instructions: ev.pick.instructions, criteria };
  const ans = await ctx.ask(state, { pick: q, pick_rev: reversed(q) });
  if (!ans) return "dead";
  const r = settleChoice(ans.pick, ans.pick_rev, judge.margin);
  let cands = candidates(r.probs, { min: judge.locate_min, max: judge.locate_max });
  if (!cands.length) cands = snippets.slice(0, judge.locate_max).map((s) => s.id);
  const questions = {};
  for (const c of cands) questions[`supports_${c}`] = { type: "noul", instructions: fill(ev.supports.instructions, c), criteria: ev.supports.criteria };
  const sup = await ctx.ask(state, questions);
  if (!sup) return "dead";
  let best = null;
  let anyUnsettled = false;
  let lowest = null;
  for (const c of cands) {
    const p = noulP(sup[`supports_${c}`]);
    const v = settle(p, judge.thresholds);
    if (v === "yes" && (!best || p > best.p)) best = { c, p };
    if (v === "unsettled") anyUnsettled = true;
    if (!Number.isNaN(p) && (lowest == null || p < lowest)) lowest = p;
  }
  if (best) {
    const sn = snippets.find((s) => s.id === best.c);
    return { source: { path: sn.path, line: sn.line }, p: best.p };
  }
  if (anyUnsettled) return { unsettled: "jev evidence supports: unsettled" };
  return { source: null, p: lowest };
}

// ── pick ────────────────────────────────────────────────────────────────────

export async function pick({ versions, register, judge = loadJudge(), trust, client, untrusted = false, off = false, env } = {}) {
  const ctx = context({ trust, client, untrusted, off, env, never: neverSent(judge, register) });
  const done = (extra) => {
    ctx.finish();
    return { winner: null, settled: false, probs: {}, why: "", status: ctx.status, ...extra };
  };
  if (!Array.isArray(versions) || versions.length < 2) return done({ why: "need at least two versions" });
  const gate = ctx.gate("pick");
  if (!gate) return done({ why: `not checked: ${ctx.dead ? ctx.status : "untrusted"}` });
  const audience = judge.pick.audiences[register] ?? judge.pick.audiences.prose;
  const state = { audience, versions: versions.map((v, i) => `v${i + 1}| ${v.replace(/\s+/g, " ").trim()}`).join("\n") };
  const criteria = Object.fromEntries(versions.map((_, i) => [`v${i + 1}`, null]));
  const q = { type: "choice", instructions: judge.pick.clearest.instructions, criteria };
  const ans = await ctx.ask(state, { clearest: q, clearest_rev: reversed(q) });
  if (!ans) return done({ why: `not checked: ${ctx.reason ?? ctx.status}` });
  const r = settleChoice(ans.clearest, ans.clearest_rev, judge.margin);
  const mark = gate.untrusted ? { untrusted: true } : {};
  if (r.settled && r.top) {
    const winner = Number(r.top.slice(1)) - 1;
    return done({ winner, settled: true, probs: r.probs, why: `jev picked v${winner + 1} in both orders`, ...mark });
  }
  return done({ probs: r.probs, why: "the two orders disagree or the lead is under the margin; Claude picks", ...mark });
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const USAGE = `usage:
  guard.mjs compare <original> <rewrite> [--register R] [--json] [--jev-budget USD] [--jev-untrusted] [--no-jev]
  guard.mjs evidence <path> [--root DIR] [--register R] [--json] [--jev-budget USD] [--jev-untrusted] [--no-jev]
  guard.mjs pick --register R <file1> <file2> [<file3>] [--json] [--jev-untrusted] [--no-jev]
"-" reads stdin for one argument.`;

function parseArgs(argv) {
  const o = { cmd: null, args: [], register: null, json: false, budget: null, untrusted: false, noJev: false, root: null };
  const a = [...argv];
  o.cmd = a.shift() ?? null;
  while (a.length) {
    const t = a.shift();
    const val = () => {
      if (!a.length) throw new Error(`${t} needs a value`);
      return a.shift();
    };
    if (t === "--register") o.register = val();
    else if (t === "--root") o.root = val();
    else if (t === "--json") o.json = true;
    else if (t === "--jev-budget") {
      o.budget = Number(val());
      if (!Number.isFinite(o.budget) || o.budget < 0) throw new Error("--jev-budget needs a number of dollars");
    } else if (t === "--jev-untrusted") o.untrusted = true;
    else if (t === "--no-jev") o.noJev = true;
    else if (t === "-" || !t.startsWith("--")) o.args.push(t);
    else throw new Error(`unknown option ${t}`);
  }
  return o;
}

function hitLine(file, h) {
  const what = h.match && h.match.length <= 40 && h.excerpt.length > h.match.length + 3 ? `${h.match}: ` : "";
  const tier = h.untrusted ? `${h.tier} untrusted` : h.tier;
  return `${file}:${h.line}  ${h.id} ${tier}  ${what}"${h.excerpt}"  → ${h.fix}${h.note ? `  [${h.note}]` : ""}`;
}

/** CLI entry. io: out, err, cwd, env, stdin, judge, trust, jevClient. Returns the exit code. */
export async function main(argv, io = {}) {
  const out = io.out ?? ((s) => process.stdout.write(`${s}\n`));
  const err = io.err ?? ((s) => process.stderr.write(`${s}\n`));
  const cwd = io.cwd ?? process.cwd();
  const env = io.env ?? process.env;
  const stdin = io.stdin ?? (() => readFileSync(0, "utf8"));
  let o;
  try {
    o = parseArgs(argv);
  } catch (e) {
    err(`guard: ${e.message}\n${USAGE}`);
    return 2;
  }
  if (!["compare", "evidence", "pick"].includes(o.cmd)) {
    err(`guard: ${o.cmd ? `unknown command ${o.cmd}` : "no command"}\n${USAGE}`);
    return 2;
  }
  const [lo, hi] = { compare: [2, 2], evidence: [1, 1], pick: [2, 3] }[o.cmd];
  if (o.args.length < lo || o.args.length > hi) {
    err(`guard: ${o.cmd} takes ${lo === hi ? lo : `${lo} to ${hi}`} file argument(s)\n${USAGE}`);
    return 2;
  }
  if (o.args.filter((x) => x === "-").length > 1) {
    err("guard: only one argument can be - (stdin)");
    return 2;
  }
  if (o.cmd === "pick" && !o.register) {
    err("guard: pick needs --register");
    return 2;
  }
  let texts;
  try {
    texts = o.args.map((p) => {
      if (p === "-") return stdin();
      const t = readText(resolve(cwd, p));
      if (t == null) throw new Error(`cannot read ${p}`);
      return t;
    });
  } catch (e) {
    err(`guard: ${e.message}`);
    return 2;
  }

  const judge = io.judge ?? loadJudge();
  const off = o.noJev || env.HUMANIZE_JEV === "0";
  const trust = io.trust ?? loadTrust(undefined, judge.model);
  let client = io.jevClient ?? null;
  if (!client && !off) {
    try {
      client = createClient({ env, judge, budgetUsd: o.budget ?? undefined });
    } catch {
      client = null;
    }
  }
  const common = { judge, trust, client, untrusted: o.untrusted, off, env };
  const spent = () => {
    try {
      return client?.spent?.().usd ?? 0;
    } catch {
      return 0;
    }
  };
  const footer = (r) => `jev: ${r.status}${r.reason && r.reason !== r.status ? ` (${r.reason})` : ""}, $${spent().toFixed(4)} spent`;
  const rowLine = (u) => `  unsettled ${u.line}  ${u.key}: ${u.why}  "${u.sentence}"`;
  const label = (p) => (p === "-" ? "<stdin>" : p);

  if (o.cmd === "compare") {
    const [origPath, rewPath] = o.args;
    const r = await compare({ ...common, original: texts[0], rewrite: texts[1], register: o.register, originalPath: origPath, rewritePath: rewPath });
    const block = r.hits.some((h) => h.tier === "block");
    const unavailable = ["off", "no_key", "error", "budget", "too_long"].includes(r.status);
    if (o.json) out(JSON.stringify({ ...r, spent: spent() }, null, 2));
    else {
      for (const h of r.hits) out(hitLine(label(rewPath), h));
      for (const n of r.notChecked) out(`not checked: ${n.key} ${n.why}`);
      if (unavailable) out(`jev: not checked (${r.reason ?? r.status})`);
      out(footer(r));
      for (const u of r.unsettled) out(rowLine(u));
    }
    if (block) return 1;
    return unavailable ? 3 : 0;
  }

  if (o.cmd === "evidence") {
    const path = o.args[0];
    const r = await evidence({ ...common, path, text: texts[0], register: o.register ?? undefined, root: resolve(cwd, o.root ?? ".") });
    if (o.json) out(JSON.stringify({ ...r, spent: spent() }, null, 2));
    else {
      for (const h of r.hits) out(hitLine(label(path), h));
      for (const c of r.claims) out(`claim ${c.line}  ${c.source ? `${c.source.path}:${c.source.line}` : "no source"}  "${clip(c.sentence, 80)}"`);
      for (const n of r.notChecked) out(`not checked: ${n.key} ${n.why}`);
      out(footer(r));
      for (const u of r.unsettled) out(rowLine(u));
    }
    return 0;
  }

  const r = await pick({ ...common, versions: texts, register: o.register });
  if (o.json) out(JSON.stringify({ ...r, spent: spent() }, null, 2));
  else {
    out(r.winner == null ? `pick: none (${r.why})` : `pick: ${label(o.args[r.winner])} (${r.why})`);
    out(footer(r));
  }
  return 0;
}

// realpath, so a run through the ~/.claude/skills symlink still starts main().
const invoked = (() => {
  try {
    return process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (invoked) {
  main(process.argv.slice(2)).then((c) => process.exit(c));
}

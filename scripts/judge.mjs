// The Jev judgment pass: cuts a document into units, asks scripts/judge.json's
// questions of a client, and turns the answers into hits. Jev judges, code
// decides (jev.mjs has the thresholds). Loaded only by `scan.mjs --judge`;
// the hook, the Action and plain scans never import this file.
// Zero dependencies.

import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PH, countNewlines, countWords, excerpt, ignoreMap, splitSentences, tierFor } from "./scan.mjs";
import { JevError, TRUST_PATH, candidates, isTrusted, loadJudge, loadTrust, reversed, settle, settleChoice, tellFrom } from "./jev.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const HTML_EXT = new Set([".html", ".htm", ".xhtml", ".mjml"]);
const MAX_IDS = 255;

// ── units ───────────────────────────────────────────────────────────────────

/** Sentences of one segment, each with the source line it starts on. */
function sentencesOf(seg) {
  const sents = splitSentences(seg.text);
  if (!sents.length) return [];
  let collapsed = "";
  const lineAt = [];
  let line = seg.line;
  let space = true;
  for (let ch of seg.text) {
    if (ch === PH) ch = "x";
    if (/\s/.test(ch)) {
      if (!space) {
        collapsed += " ";
        lineAt.push(line);
      }
      space = true;
      if (ch === "\n") line++;
    } else {
      collapsed += ch;
      lineAt.push(line);
      space = false;
    }
  }
  const out = [];
  let cursor = 0;
  for (const text of sents) {
    const at = collapsed.indexOf(text, cursor);
    const idx = at < 0 ? cursor : at;
    out.push({ text, line: lineAt[idx] ?? seg.line, words: countWords(text) });
    if (at >= 0) cursor = at + text.length;
  }
  return out;
}

/** Line ranges of the blocks Jev should not read in an HTML source. */
function skippedRanges(src, names) {
  const want = new Set(names);
  const ranges = [];
  const stack = [];
  const re = /<(\/?)(nav|footer|header|h1)\b[^>]*>/gi;
  let m;
  let line = 1;
  let last = 0;
  const lineOf = (idx) => {
    line += countNewlines(src.slice(last, idx));
    last = idx;
    return line;
  };
  while ((m = re.exec(src))) {
    const name = m[2].toLowerCase();
    if (name === "h1") {
      if (!m[1]) for (const f of stack) f.h1 = true;
      continue;
    }
    if (!want.has(name)) continue;
    if (!m[1]) stack.push({ name, from: lineOf(m.index), h1: false });
    else {
      const k = stack.map((f) => f.name).lastIndexOf(name);
      if (k < 0) continue;
      const [f] = stack.splice(k, 1);
      if (!(name === "header" && f.h1)) ranges.push([f.from, lineOf(m.index)]);
    }
  }
  const total = countNewlines(src) + 1;
  for (const f of stack) if (!(f.name === "header" && f.h1)) ranges.push([f.from, total]);
  return ranges;
}

const CHUNK = (sents) => sents.map((s, i) => `s${i + 1}| ${s.text}`).join("\n");

/** Sentences grouped by paragraph, packed into chunks under the size and id limits. */
function pack(groups, maxChars) {
  const chunks = [];
  let cur = [];
  let chars = 0;
  const flush = () => {
    if (cur.length) chunks.push(cur);
    cur = [];
    chars = 0;
  };
  // A paragraph larger than a chunk is cut at sentence boundaries.
  const pieces = [];
  for (const g of groups) {
    let part = [];
    let n = 0;
    for (const s of g) {
      const c = s.text.length + 8;
      if (part.length && (n + c > maxChars || part.length >= MAX_IDS)) {
        pieces.push(part);
        part = [];
        n = 0;
      }
      part.push(s);
      n += c;
    }
    if (part.length) pieces.push(part);
  }
  for (const p of pieces) {
    const c = p.reduce((n, s) => n + s.text.length + 8, 0);
    if (cur.length && (chars + c > maxChars || cur.length + p.length > MAX_IDS)) flush();
    cur.push(...p);
    chars += c;
  }
  flush();
  return chunks;
}

// App Store text kept as "Name: … / Subtitle: … / Description: …" fields.
const STORE_FIELD = /^\s*(name|title|subtitle|promotional text|description|what['\u2019]?s new|release notes|keywords)\s*:\s*(.*)$/i;
const DROP_FIELDS = new Set(["name", "title", "subtitle", "keywords"]);
const CHANGE_FIELDS = new Set(["whats new", "release notes"]);
const CHANGE_FILE = /what.?s.?new|release|changelog/i;

export function storeFields(src) {
  const out = [];
  src.split("\n").forEach((t, i) => {
    const m = t.match(STORE_FIELD);
    if (m) out.push({ name: m[1].toLowerCase().replace(/['\u2019]/g, "").replace(/\s+/g, " "), line: i + 1, value: m[2].trim() });
  });
  return out;
}

// Field label lines leave the text; a label with a value keeps the value. A
// paragraph that runs across fields splits at each label, so every piece
// belongs to one field.
function stripStoreFields(segs, fields) {
  const at = new Map(fields.map((f) => [f.line, f]));
  const out = [];
  for (const s of segs) {
    let kept = [];
    const flush = () => {
      if (kept.some(([, t]) => t.trim())) out.push({ ...s, line: kept[0][0], text: kept.map(([, t]) => t).join("\n") });
      kept = [];
    };
    s.text.split("\n").forEach((t, i) => {
      const f = at.get(s.line + i);
      if (!f) return kept.push([s.line + i, t]);
      flush();
      if (!DROP_FIELDS.has(f.name) && f.value) kept.push([s.line + i, f.value]);
    });
    flush();
  }
  return out;
}

const fieldOf = (fields, line) => {
  let cur = null;
  for (const f of fields) if (f.line <= line) cur = f;
  return cur;
};

const TAKEAWAY = /^\s*(?:(?:\*\*|__)[^]+(?:\*\*|__)|(?:key )?takeaway\b|bottom line\b|in short\b|the point\b)/i;
const bullets = (n) => (n === 0 ? "0" : n <= 2 ? "1-2" : n === 3 ? "3" : "4+");

export function buildUnits(segs, { register, judge, title = "", src = "", ext = "" } = {}) {
  const maxChars = judge.section_max_tokens * judge.chars_per_token;
  segs = segs.filter((s) => s.kind !== "comment");
  if (HTML_EXT.has(ext)) {
    const ranges = skippedRanges(src, judge.skip_blocks ?? []);
    if (ranges.length) segs = segs.filter((s) => !ranges.some(([a, b]) => s.line >= a && s.line <= b));
  }

  const fields = register === "store" ? storeFields(src) : [];
  if (fields.length) segs = stripStoreFields(segs, fields);

  // Groups: the text under each heading.
  const groups = [{ heading: null, level: 0, line: 1, items: [] }];
  for (const s of segs) {
    if (s.kind === "heading") groups.push({ heading: s.text.trim(), level: s.level ?? 2, line: s.line, items: [] });
    else if (s.kind === "para" || s.kind === "list") groups[groups.length - 1].items.push(s);
  }

  const sections = [];
  const skeletons = [];
  for (const g of groups) {
    if (g.heading !== null && g.items.length) {
      const paras = g.items.filter((s) => s.kind === "para").length;
      const items = g.items.filter((s) => s.kind === "list").length;
      const last = g.items[g.items.length - 1];
      const ends = last.kind === "para" && TAKEAWAY.test(last.raw ?? last.text);
      skeletons.push({ line: g.line, heading: g.heading, key: `${Math.min(paras, 3)}p|${bullets(items)}b|${ends ? "end" : "-"}` });
    }
    const groupsOfSents = g.items.map((s) => sentencesOf(s).map((x) => ({ ...x }))).filter((x) => x.length);
    pack(groupsOfSents, maxChars).forEach((chunk, n) => {
      const sentences = chunk.map((s, i) => ({ id: `s${i + 1}`, ...s }));
      sections.push({ heading: g.heading, level: g.level, line: g.heading !== null && n === 0 ? g.line : sentences[0].line, sentences, section: CHUNK(sentences) });
    });
  }

  const h1 = segs.find((s) => s.kind === "heading" && s.level === 1);
  const paras = segs.filter((s) => s.kind === "para");
  const first2 = paras.slice(0, 2);
  const unitTitle = h1 ? h1.text.trim() : basename(title || "");
  let opening = first2.length ? { title: unitTitle, titled: !!h1, opening: first2.map((s) => s.text.trim()).join("\n\n"), line: first2[0].line } : null;
  const desc = fields.find((f) => f.name === "description");
  if (desc) {
    // The first lines of the description are what shows before "more".
    const inDesc = paras.filter((p) => fieldOf(fields, p.line) === desc).slice(0, 2);
    const name = fields.find((f) => f.name === "name" || f.name === "title")?.value;
    opening = inDesc.length ? { title: name || unitTitle, titled: false, opening: inDesc.map((p) => p.text.trim()).join("\n\n"), line: inDesc[0].line } : null;
  }

  const ledes = [];
  for (const g of groups) {
    if (g.heading === null || g.level > 2) continue;
    const p = g.items.find((s) => s.kind === "para");
    const first = p ? sentencesOf(p)[0] : null;
    if (first) ledes.push({ heading: g.heading, first_sentence: first.text, line: first.line });
  }

  let headlines;
  if (register === "store" && fields.length) {
    const sub = fields.find((f) => f.name === "subtitle" && f.value);
    headlines = sub ? [{ headline: sub.value, line: sub.line }] : [];
  } else if (register === "store") {
    const f = segs[0];
    headlines = f ? [{ headline: f.text.split("\n")[0].trim(), line: f.line }] : [];
  } else headlines = segs.filter((s) => s.kind === "heading" && (s.level ?? 2) <= 2).map((s) => ({ headline: s.text.trim(), line: s.line }));

  // Change lines: list items in release notes; in store text, the What's New
  // field, or every line of a file named for it. Prose and feature lists are not change lines.
  const lines = [];
  const changeSeg = (s) => {
    if (register === "store") return fields.length ? CHANGE_FIELDS.has(fieldOf(fields, s.line)?.name) : CHANGE_FILE.test(basename(title || ""));
    if (register === "release") return s.kind === "list";
    return true;
  };
  for (const s of segs) {
    if (!changeSeg(s)) continue;
    if (s.kind === "list") lines.push({ text: s.text.replace(/\s+/g, " ").trim(), line: s.line });
    else if (s.kind === "para") s.text.split("\n").forEach((t, i) => t.trim() && lines.push({ text: t.trim(), line: s.line + i }));
  }
  lines.forEach((l, i) => (l.id = `l${i + 1}`));
  const lineUnits = lines.slice(0, MAX_IDS);

  const strings = segs.filter((s) => s.kind !== "heading" || register === "ui").map((s) => ({ message: s.text.replace(/\s+/g, " ").trim(), line: s.line }));

  const emailSents = segs
    .filter((s) => s.kind === "para" || s.kind === "list")
    .flatMap((s) => sentencesOf(s).map((x) => ({ ...x, list: s.kind === "list" })))
    .slice(0, MAX_IDS)
    .map((s, i) => ({ id: `s${i + 1}`, ...s }));

  return {
    sections,
    opening,
    ledes,
    headlines,
    lines: { notes: lineUnits.map((l) => `${l.id}| ${l.text}`).join("\n"), lines: lineUnits },
    strings,
    email: emailSents.length ? { email: CHUNK(emailSents), sentences: emailSents } : null,
    text: segs.map((s) => s.text).join("\n\n"),
    paragraphs: segs.filter((s) => s.kind !== "heading").map((s) => ({ text: s.text, line: s.line })),
    skeletons,
    headings: segs.filter((s) => s.kind === "heading").map((s) => ({ text: s.text, line: s.line, level: s.level ?? 2 })),
  };
}

// ── questions and answers ───────────────────────────────────────────────────

const fill = (text, id) => text.replaceAll("{id}", id);
const noul = (q, id) => ({ type: "noul", instructions: id ? fill(q.instructions, id) : q.instructions, criteria: q.criteria });
const choice = (instructions, criteria) => ({ type: "choice", instructions, criteria });

async function ask(client, state, questions) {
  const res = await client.ask({ state, questions });
  return res?.answers ?? {};
}

function pOf(answers, name) {
  const p = answers[name]?.noul;
  if (typeof p !== "number") throw new JevError("bad_response", `no answer for ${name}`);
  return p;
}

const choiceOf = (answers, name) => {
  if (!answers[name]?.probabilities) throw new JevError("bad_response", `no answer for ${name}`);
  return answers[name];
};

const isJev = (e) => e instanceof JevError || e?.name === "JevError";

// ── code checks ─────────────────────────────────────────────────────────────

const MONTH = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const NUMBER_WORD = /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|hundred|thousand|million)\b/i;
const CODE_LEAVE = {
  has_number: (t) => /\d/.test(t) || NUMBER_WORD.test(t),
  count_and_date: (t) => /\d/.test(t) && (/\b(?:19|20)\d{2}\b/.test(t) || new RegExp(`\\b${MONTH}\\b`, "i").test(t)),
  has_date: (t) =>
    new RegExp(`\\b${MONTH}\\.?\\s+\\d{1,2}\\b`, "i").test(t) ||
    new RegExp(`\\b\\d{1,2}\\s+${MONTH}\\b`, "i").test(t) ||
    /\b\d{4}-\d{2}-\d{2}\b/.test(t) ||
    /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(t),
};

// ── hits ────────────────────────────────────────────────────────────────────

let catalogNames;
function nameOf(id, rules) {
  const r = rules?.byId?.get(id);
  if (r) return r.name.replace(/\.$/, "");
  if (!catalogNames) {
    catalogNames = new Map();
    try {
      const md = readFileSync(resolve(HERE, "../references/patterns.md"), "utf8");
      for (const m of md.matchAll(/^\*\*([A-Z]\d+) (.+?)\.?\*\* /gm)) catalogNames.set(m[1], m[2].replace(/ \(judgment\)$/, ""));
    } catch {
      /* a vendored copy has no catalog */
    }
  }
  return catalogNames.get(id) ?? id;
}

function tierOf(id, register, judge, cfg, rules) {
  const t = judge.tiers?.[id];
  const base = t?.[register] ?? t?.default ?? "warn";
  if (rules) return tierFor({ id, registers: {}, tier: base }, register, cfg ?? {}, rules);
  return register === "legal" && base === "block" ? "warn" : base;
}

const clip = (s, n = 160) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

function makeHit(env, key, probe, { line, text, p, extra }) {
  const match = clip(text.replace(/\s+/g, " ").trim());
  const note = `jev ${key}${typeof p === "number" ? ` p=${p.toFixed(2)}` : ""}${extra ? `; ${extra}` : ""}`;
  const h = {
    id: probe.id,
    family: probe.id[0],
    kind: "tell",
    name: nameOf(probe.id, env.rules),
    tier: env.untrusted ? "info" : env.tier,
    fix: probe.fix,
    match,
    line,
    excerpt: excerpt(match, 0, match.length),
    note,
    count: 1,
    source: "jev",
    p: typeof p === "number" ? Math.round(p * 100) / 100 : undefined,
    probe: key,
  };
  if (env.untrusted) h.untrusted = true;
  return h;
}

// ── probe runners ───────────────────────────────────────────────────────────
// Each takes (key, probe, env, out) and pushes to out.hits / out.unsettled.
// A JevError propagates to runProbes, which turns it into "not checked".

const thr = (env) => env.judge.thresholds;
const UNLESS_NOTE = "Leave case unsettled, check it by hand";

async function runSection(key, probe, env, out) {
  const { judge, client } = env;
  const minWords = probe.filter?.min_words ?? 0;
  for (const sec of env.units.sections) {
    const eligible = sec.sentences.filter((s) => s.words >= minWords);
    if (!eligible.length) continue;
    const locate = choice(probe.locate.instructions, Object.fromEntries(eligible.map((s) => [s.id, null])));
    // The section state carries the title and heading, which some confirm and
    // unless questions name (S27's unless asks about readers of `title`).
    const state = { title: env.units.opening?.title ?? "", heading: sec.heading ?? "", section: sec.section };
    const a = await ask(client, state, { find: noul(probe.find), locate, locate_rev: reversed(locate) });
    // find only screens out clear noes. Jev is less sure about a whole section
    // than about one sentence, so an unsettled find still goes to confirm.
    if (settle(pOf(a, "find"), thr(env)) === "no") continue;
    const pick = settleChoice(choiceOf(a, "locate"), choiceOf(a, "locate_rev"), judge.margin);
    let cands = candidates(pick.probs, { min: judge.locate_min, max: judge.locate_max });
    if (!cands.length && pick.settled && pick.top) cands = [pick.top];
    if (!cands.length) {
      out.unsettled.push({ key, line: sec.line, why: "locate" });
      continue;
    }
    const leave = probe.code_leave ? CODE_LEAVE[probe.code_leave] : null;
    const byId = new Map(sec.sentences.map((s) => [s.id, s]));
    cands = cands.filter((id) => byId.has(id) && !(leave && leave(byId.get(id).text)));
    if (!cands.length) continue;
    const qs = {};
    for (const id of cands) {
      qs[`confirm_${id}`] = noul(probe.confirm, id);
      if (probe.unless) qs[`unless_${id}`] = noul(probe.unless, id);
    }
    const c = await ask(client, state, qs);
    for (const id of cands) {
      const s = byId.get(id);
      const conf = settle(pOf(c, `confirm_${id}`), thr(env));
      if (conf === "no") continue;
      if (conf === "unsettled") {
        out.unsettled.push({ key, line: s.line, why: "confirm" });
        continue;
      }
      // unless works like a Leave line: only a clear yes clears the hit.
      let extra;
      if (probe.unless) {
        const un = settle(pOf(c, `unless_${id}`), thr(env));
        if (un === "yes") continue;
        if (un === "unsettled") extra = UNLESS_NOTE;
      }
      out.hits.push(makeHit(env, key, probe, { line: s.line, text: s.text, p: c[`confirm_${id}`].noul, extra }));
    }
  }
}

/** opening, lede, headline and string units: one request per unit. */
async function runUnitAsk(key, probe, env, out) {
  const { client } = env;
  const items = [];
  const u = env.units;
  if (probe.unit === "opening" && u.opening) items.push({ state: { opening: u.opening.titled ? `${u.opening.title}\n\n${u.opening.opening}` : u.opening.opening }, line: u.opening.line, text: u.opening.opening });
  if (probe.unit === "lede") for (const l of u.ledes) items.push({ state: { heading: l.heading, first_sentence: l.first_sentence }, line: l.line, text: l.first_sentence });
  if (probe.unit === "headline") for (const h of u.headlines) items.push({ state: { headline: h.headline }, line: h.line, text: h.headline });
  if (probe.unit === "string") for (const s of u.strings) items.push({ state: { message: s.message }, line: s.line, text: s.message });
  for (const it of items) {
    const qs = {};
    if (probe.gate) qs.gate = noul(probe.gate);
    if (probe.ask) qs.ask = noul(probe.ask);
    if (probe.asks) for (const [n, q] of Object.entries(probe.asks)) qs[`ask_${n}`] = noul(q);
    if (probe.unless) qs.unless = noul(probe.unless);
    const a = await ask(client, it.state, qs);
    if (probe.gate) {
      const g = settle(pOf(a, "gate"), thr(env));
      if (g === "no") continue;
      if (g === "unsettled") {
        out.unsettled.push({ key, line: it.line, why: "gate" });
        continue;
      }
    }
    const verdicts = [];
    if (probe.ask) verdicts.push(["ask", tellFrom(settle(pOf(a, "ask"), thr(env)), probe.polarity), pOf(a, "ask")]);
    if (probe.asks) for (const n of Object.keys(probe.asks)) verdicts.push([n, tellFrom(settle(pOf(a, `ask_${n}`), thr(env)), probe.polarity), pOf(a, `ask_${n}`)]);
    const tells = verdicts.filter((v) => v[1] === "tell");
    const unsure = verdicts.some((v) => v[1] === "unsettled");
    if (!tells.length) {
      if (unsure) out.unsettled.push({ key, line: it.line, why: "ask" });
      continue;
    }
    let unsure_leave;
    if (probe.unless) {
      const un = settle(pOf(a, "unless"), thr(env));
      if (un === "yes") continue;
      if (un === "unsettled") unsure_leave = UNLESS_NOTE;
    }
    const names = probe.asks ? `missing: ${tells.map((v) => v[0]).join(", ")}` : undefined;
    const extra = [names, unsure_leave].filter(Boolean).join("; ") || undefined;
    out.hits.push(makeHit(env, key, probe, { line: it.line, text: it.text, p: tells[0][2], extra }));
  }
}

async function runLines(key, probe, env, out) {
  const { notes, lines } = env.units.lines;
  const skip = probe.skip_if_regex_hit;
  const todo = lines.filter((l) => !(skip && env.scanHits.some((h) => h.id === skip && h.line === l.line)));
  if (!todo.length) return;
  const qs = Object.fromEntries(todo.map((l) => [`line_${l.id}`, noul(probe.per_line, l.id)]));
  const a = await ask(env.client, { notes }, qs);
  for (const l of todo) {
    const p = pOf(a, `line_${l.id}`);
    const v = tellFrom(settle(p, thr(env)), probe.polarity);
    if (v === "unsettled") out.unsettled.push({ key, line: l.line, why: "line" });
    else if (v === "tell") out.hits.push(makeHit(env, key, probe, { line: l.line, text: l.text, p }));
  }
}

async function runEmail(key, probe, env, out) {
  const e = env.units.email;
  if (!e) return;
  // Asks in a list are the fix (one ask per item), so only prose sentences count.
  const prose = e.sentences.filter((s) => !s.list);
  if (!prose.length) return;
  const qs = Object.fromEntries(prose.map((s) => [`sentence_${s.id}`, noul(probe.per_sentence, s.id)]));
  const a = await ask(env.client, { email: e.email }, qs);
  const asks = [];
  let unsure = null;
  for (const s of prose) {
    const v = settle(pOf(a, `sentence_${s.id}`), thr(env));
    if (v === "yes") asks.push(s);
    else if (v === "unsettled" && !unsure) unsure = s;
  }
  const min = probe.min_count ?? 2;
  if (asks.length >= min) {
    const second = asks[1];
    out.hits.push(makeHit(env, key, probe, { line: second.line, text: second.text, p: a[`sentence_${second.id}`].noul, extra: `${asks.length} asks, at lines ${asks.map((s) => s.line).join(", ")}` }));
  } else if (unsure && asks.length + 1 >= min) out.unsettled.push({ key, line: unsure.line, why: "ask" });
}

async function runNames(key, probe, env, out) {
  const cand = probe.candidates.join("|");
  const re = new RegExp(`\\b(the|our|this|your)\\s+(${cand})\\b`, "gi");
  const seen = new Map();
  env.units.paragraphs.forEach((p, pi) => {
    for (const m of p.text.matchAll(re)) {
      const noun = m[2].toLowerCase();
      const e = seen.get(noun) ?? { phrase: `${m[1]} ${m[2]}`.toLowerCase(), line: p.line + countNewlines(p.text, m.index), paras: new Set() };
      e.paras.add(pi);
      seen.set(noun, e);
    }
  });
  const names = [...seen.values()];
  if (names.length < 2) return;
  const maxChars = env.judge.section_max_tokens * env.judge.chars_per_token;
  const parent = names.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const pairs = [];
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) pairs.push([i, j]);
  for (const [i, j] of pairs.slice(0, 10)) {
    let idx = [...names[i].paras].filter((x) => names[j].paras.has(x));
    if (!idx.length) idx = [Math.min(...names[i].paras), Math.min(...names[j].paras)].sort((a, b) => a - b);
    const text = idx.map((x) => env.units.paragraphs[x].text).join("\n\n").slice(0, maxChars);
    const a = await ask(env.client, { text, name_a: names[i].phrase, name_b: names[j].phrase }, { same: noul(probe.ask) });
    const v = settle(pOf(a, "same"), thr(env));
    if (v === "yes") parent[find(i)] = find(j);
    else if (v === "unsettled") out.unsettled.push({ key, line: names[j].line, why: `${names[i].phrase} / ${names[j].phrase}` });
  }
  const clusters = new Map();
  names.forEach((n, i) => clusters.set(find(i), [...(clusters.get(find(i)) ?? []), n]));
  for (const c of clusters.values())
    if (c.length >= (probe.min_names ?? 3)) out.hits.push(makeHit(env, key, probe, { line: c[2].line, text: c.map((n) => n.phrase).join(", ") }));
}

const RUNNERS = { section: runSection, opening: runUnitAsk, lede: runUnitAsk, headline: runUnitAsk, string: runUnitAsk, lines: runLines, email: runEmail, names: runNames };

/** S29: the same skeleton under most headings. Code only; no Jev call. */
function runSkeletons(env, out) {
  const cfg = env.judge.code?.S29;
  if (!cfg || !cfg.registers.includes(env.register)) return;
  const tier = tierOf("S29", env.register, env.judge, env.cfg, env.rules);
  if (tier === "off") return;
  const sk = env.units.skeletons;
  if (sk.length < cfg.min_sections) return;
  const counts = new Map();
  for (const s of sk) counts.set(s.key, (counts.get(s.key) ?? 0) + 1);
  const [key, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (n / sk.length < cfg.same_share) return;
  const first = sk.find((s) => s.key === key);
  const probe = { id: "S29", fix: cfg.fix };
  const h = makeHit({ ...env, tier, untrusted: false }, "S29", probe, { line: first.line, text: first.heading });
  h.note = `${n} of ${sk.length} sections share one shape (${key})`;
  h.source = "code";
  delete h.p;
  delete h.probe;
  out.hits.push(h);
}

// ── runProbes ───────────────────────────────────────────────────────────────

export function applicableProbes(register, judge) {
  return Object.entries(judge.probes)
    .filter(([, p]) => p.registers.includes(register))
    .map(([k]) => k);
}

export async function runProbes({ units, register, judge, trust, client, untrusted = false, scanHits = [], cfg, rules }) {
  const coverage = { checked: [], unsettled: [], not_checked: [] };
  const hits = [];
  if (judge.never.includes(register)) return { hits, coverage, status: "ok" };
  let status = "ok";
  let stop = null;
  let errors = 0;
  for (const [key, probe] of Object.entries(judge.probes)) {
    if (!probe.registers.includes(register)) continue;
    if (stop) {
      coverage.not_checked.push({ key, why: stop });
      continue;
    }
    const tier = tierOf(probe.id, register, judge, cfg, rules);
    if (tier === "off") continue;
    const trusted = isTrusted(trust, key);
    if (!trusted && !untrusted) {
      coverage.not_checked.push({ key, why: "untrusted" });
      continue;
    }
    const out = { hits: [], unsettled: [] };
    const env = { judge, client, units, register, scanHits, cfg, rules, tier, untrusted: !trusted };
    try {
      await RUNNERS[probe.unit](key, probe, env, out);
      coverage.checked.push(key);
    } catch (e) {
      if (!isJev(e)) throw e;
      if (e.code === "budget" || e.code === "off" || e.code === "no_key") {
        stop = e.code;
        status = e.code;
        coverage.not_checked.push({ key, why: e.code });
      } else {
        errors++;
        coverage.not_checked.push({ key, why: `error: ${e.code}` });
      }
    }
    hits.push(...out.hits);
    coverage.unsettled.push(...out.unsettled);
  }
  const s29 = { hits: [], unsettled: [] };
  runSkeletons({ judge, units, register, cfg, rules, tier: "warn", untrusted: false }, s29);
  hits.push(...s29.hits);
  if (status === "ok" && errors && !coverage.checked.length) status = "error";
  const seen = new Set();
  return {
    hits: hits.filter((h) => {
      const k = `${h.id}\0${h.line}\0${h.match}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }),
    coverage,
    status,
  };
}

// ── Leave questions ─────────────────────────────────────────────────────────

/** Warn tells that Jev reads as a legitimate use drop to info. */
export async function leaveFilter(hits, segs, { register, judge, trust, client, untrusted = false }) {
  const coverage = { checked: [], unsettled: [], not_checked: [] };
  let status = "ok";
  segs = segs.filter((s) => s.kind !== "comment");
  const out = hits.map((h) => ({ ...h }));

  // P6 in a summary section is the section doing its job. Code only.
  const p6 = judge.code?.P6;
  if (p6) {
    const re = new RegExp(p6.pattern, "i");
    const heads = segs.filter((s) => s.kind === "heading");
    for (const h of out) {
      if (h.id !== "P6" || h.tier !== "warn") continue;
      const above = heads.filter((x) => x.line <= h.line).sort((a, b) => b.line - a.line)[0];
      if (above && re.test(above.text.trim())) {
        h.tier = "info";
        h.note = h.note ? `${h.note}; summary heading` : "summary heading";
      }
    }
  }

  const askable = out.filter((h) => h.tier === "warn" && h.kind === "tell" && h.id !== "$comment" && judge.leave?.[h.id]);
  if (!askable.length || !client || judge.never.includes(register)) return { hits: out, coverage, status };

  const flat = segs.flatMap((s) => sentencesOf(s));
  const groups = new Map();
  for (const h of askable) {
    const key = `leave.${h.id}`;
    const trusted = isTrusted(trust, key);
    if (!trusted && !untrusted) {
      if (!coverage.not_checked.some((n) => n.key === key)) coverage.not_checked.push({ key, why: "untrusted" });
      continue;
    }
    const m = h.match.toLowerCase();
    let at = -1;
    flat.forEach((s, i) => {
      if (s.text.toLowerCase().includes(m) && (at < 0 || Math.abs(s.line - h.line) < Math.abs(flat[at].line - h.line))) at = i;
    });
    if (at < 0) at = flat.findIndex((s) => s.line === h.line);
    if (at < 0) continue;
    const gk = `${at}\0${h.match}`;
    const g = groups.get(gk) ?? { at, match: h.match, hits: [] };
    g.hits.push({ h, trusted });
    groups.set(gk, g);
  }

  let stop = null;
  for (const g of groups.values()) {
    const ids = [...new Set(g.hits.map((x) => x.h.id))];
    if (stop) {
      for (const id of ids) coverage.not_checked.push({ key: `leave.${id}`, why: stop });
      continue;
    }
    const state = { sentence: flat[g.at].text, match: g.match };
    if (ids.includes("C1") && g.at > 0) state.previous = flat[g.at - 1].text;
    const qs = Object.fromEntries(ids.map((id) => [`leave_${id}`, noul(judge.leave[id])]));
    let a;
    try {
      a = await ask(client, state, qs);
    } catch (e) {
      if (!isJev(e)) throw e;
      for (const id of ids) coverage.not_checked.push({ key: `leave.${id}`, why: e.code === "budget" || e.code === "off" || e.code === "no_key" ? e.code : `error: ${e.code}` });
      if (e.code === "budget" || e.code === "off" || e.code === "no_key") {
        stop = e.code;
        status = e.code;
      }
      continue;
    }
    for (const id of ids) {
      const key = `leave.${id}`;
      const p = pOf(a, `leave_${id}`);
      if (!coverage.checked.includes(key)) coverage.checked.push(key);
      const v = settle(p, judge.thresholds);
      if (v === "unsettled") coverage.unsettled.push({ key, line: flat[g.at].line, why: "leave" });
      if (v !== "yes") continue;
      for (const x of g.hits) {
        if (x.h.id !== id) continue;
        x.h.tier = "info";
        const note = `jev: ${judge.leave[id].reason}`;
        x.h.note = x.h.note ? `${x.h.note}; ${note}` : note;
        if (!x.trusted) x.h.untrusted = true;
      }
    }
  }
  return { hits: out, coverage, status };
}

// ── register ────────────────────────────────────────────────────────────────

/** Where pasted text is going, when nothing else says. */
export async function inferRegisterJev(text, { judge, trust, client }) {
  const r = judge.register;
  if (new RegExp(r.skip_if, "i").test(text)) return { register: null, why: "legal-looking, not sent" };
  if (!isTrusted(trust, "register")) return { register: null, why: "untrusted" };
  const maxChars = judge.section_max_tokens * judge.chars_per_token;
  const q = choice(r.choice.instructions, r.choice.criteria);
  const a = await ask(client, { text: text.slice(0, maxChars) }, { register: q, register_rev: reversed(q), sells: noul(r.sells) });
  const pick = settleChoice(choiceOf(a, "register"), choiceOf(a, "register_rev"), judge.margin);
  if (!pick.settled || !pick.top) {
    const top2 = Object.entries(pick.probs).sort((x, y) => y[1] - x[1]).slice(0, 2).map(([k]) => k);
    return { register: null, candidates: top2 };
  }
  let register = pick.top;
  if (["prose", "essay", "docs"].includes(register) && settle(pOf(a, "sells"), judge.thresholds) === "yes") register = "landing";
  return { register };
}

// ── the --judge run ─────────────────────────────────────────────────────────

/**
 * Called by scan.mjs with the regex-scanned results. Adds Jev hits to each
 * result, builds the coverage block, then hands it to ctx.report.
 */
/** Baselines the stress harness measured, from jev-trust.json; none when absent. */
function readBaselines() {
  try {
    return JSON.parse(readFileSync(TRUST_PATH, "utf8")).baselines ?? null;
  } catch {
    return null;
  }
}

export async function runJudged(ctx, io = {}) {
  const { opts, units, results, cfg, rules } = ctx;
  const env = io.env ?? process.env;
  const judge = io.judge ?? loadJudge();
  const checked = new Set();
  const unsettled = [];
  const notChecked = new Map();
  const notes = [];
  const notSent = [];
  const addNotChecked = (key, why) => notChecked.set(`${key}\0${why}`, { key, why });
  let stop = null; // { status, why }
  let sawError = false;
  const rates = [];
  const baselines = "jevBaselines" in io ? io.jevBaselines : readBaselines();

  let client = null;
  if (env.HUMANIZE_JEV === "0" || cfg?.jev === false || opts.noJev) stop = { status: "off", why: "off" };
  else {
    try {
      if (io.jevClient) client = io.jevClient;
      else {
        const mod = await import("./jev.mjs");
        if (typeof mod.createClient !== "function") throw new JevError("off", "no client");
        client = mod.createClient({ budgetUsd: opts.jevBudget ?? judge.budget_usd, env });
      }
    } catch (e) {
      if (!isJev(e)) throw e;
      stop = e.code === "no_key" || e.code === "off" ? { status: e.code, why: e.code } : { status: "error", why: `error: ${e.code}` };
    }
  }
  const trust = io.jevTrust ?? loadTrust(undefined, judge.model);
  const halt = (e) => {
    if (e.code === "budget" || e.code === "off" || e.code === "no_key") stop = { status: e.code, why: e.code };
    else sawError = true;
  };

  // Pasted text with no register: Jev may name it.
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (!u.inferJev || stop) continue;
    try {
      const r = await inferRegisterJev(u.src, { judge, trust, client });
      if (r.register) {
        u.register = r.register;
        results[i] = ctx.rescan(u);
        notes.push(`register: ${r.register} (jev)`);
      } else if (r.why?.startsWith("legal")) {
        results[i].skipJev = r.why;
        notes.push(`register: prose (${r.why})`);
      } else notes.push(`register: prose (${r.candidates ? `unsettled between ${r.candidates.join(" and ")}` : r.why})`);
    } catch (e) {
      if (!isJev(e)) throw e;
      halt(e);
      notes.push(`register: prose (not checked: ${e.code})`);
    }
  }

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.ignored) continue;
    const register = r.register;
    if (judge.never.includes(register) || r.skipJev) {
      notSent.push({ file: r.label, register: r.skipJev ? "legal-looking" : register });
      continue;
    }
    if (stop) {
      for (const key of applicableProbes(register, judge)) addNotChecked(key, stop.why);
      continue;
    }
    const segs = r.segs.filter((s) => s.kind !== "comment");
    const ignore = ignoreMap(r.src);
    const lf = await leaveFilter(r.hits, segs, { register, judge, trust, client, untrusted: opts.jevUntrusted }).catch((e) => {
      if (!isJev(e)) throw e;
      halt(e);
      return null;
    });
    if (lf) {
      r.hits = lf.hits;
      for (const k of lf.coverage.checked) checked.add(k);
      for (const n of lf.coverage.not_checked) addNotChecked(n.key, n.why);
      for (const u of lf.coverage.unsettled) unsettled.push({ ...u, file: r.label });
      if (lf.status !== "ok") stop = { status: lf.status, why: lf.status };
    }
    if (stop) {
      for (const key of applicableProbes(register, judge)) addNotChecked(key, stop.why);
      continue;
    }
    const built = buildUnits(segs, { register, judge, title: r.label, src: r.src, ext: r.ext });
    const pr = await runProbes({ units: built, register, judge, trust, client, untrusted: opts.jevUntrusted, scanHits: r.hits, cfg, rules });
    const kept = pr.hits.filter((h) => !ignore.has(h.line, h.id));
    r.hits = [...r.hits, ...kept];
    // Trusted-only runs compare with the trusted-only baseline; --jev-untrusted runs with every probe's.
    const human = opts.jevUntrusted ? baselines?.[register]?.human_all : baselines?.[register]?.human;
    if (pr.status === "ok" && human?.docs && r.words > 0) rates.push({ file: r.label, register, per_1000: Math.round((kept.length / r.words) * 10000) / 10, human_median: human.median });
    for (const k of pr.coverage.checked) checked.add(k);
    for (const n of pr.coverage.not_checked) addNotChecked(n.key, n.why);
    for (const u of pr.coverage.unsettled) unsettled.push({ ...u, file: r.label });
    if (pr.status === "error") sawError = true;
    else if (pr.status !== "ok" && !stop) stop = { status: pr.status, why: pr.status };
  }

  const spent = client?.spent?.() ?? { usd: 0, input_tokens: 0, cache_hits: 0 };
  let status = stop?.status ?? (sawError && !checked.size ? "error" : "ok");
  if (!stop && notSent.length && notSent.length === results.filter((r) => !r.ignored).length) status = "off";
  const jev = {
    status,
    model: judge.model,
    checked: [...checked],
    unsettled,
    not_checked: [...notChecked.values()],
    usd: spent.usd ?? 0,
    input_tokens: spent.input_tokens ?? 0,
    cache_hits: spent.cache_hits ?? 0,
  };
  if (notes.length) jev.notes = notes;
  if (notSent.length) jev.not_sent = notSent;
  if (rates.length) jev.rates = rates;
  return ctx.report(jev);
}

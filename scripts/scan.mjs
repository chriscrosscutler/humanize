#!/usr/bin/env node
// humanize scan: flags the marks of machine-written prose in text people read.
//
// Zero dependencies, Node 20+. Reads reader-facing text only: Markdown minus
// code; HTML, Astro, Vue and Svelte text plus alt, title, aria and meta text;
// JSX text and copy props; prose-like string literals in TS/JS and Swift;
// xcstrings, .strings, .stringsdict and i18n JSON values; commit messages with
// --git-log; code comments with --comments.
//
// Rules live in rules.json beside this file and are cited by id ("humanize
// S1"); references/patterns.md says what each catches and how to fix it. A repo
// tunes them with .humanize.json: path registers, exempt globs, rule tiers,
// project rules (Q1…), dated waivers.
//
// Exit: 0 clean; 1 block-tier hits (warn too, with --fail-on warn) or an
// expired waiver; 2 usage or config error.

import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const RULES_PATH = resolve(HERE, "rules.json");
export const CONFIG_NAME = ".humanize.json";
export const TIER_RANK = { block: 0, warn: 1, info: 2 };
const TIERS_OR_OFF = ["block", "warn", "info", "off"];
const MAX_BYTES = 2_000_000;

// An interpolation (`${x}`, `\(x)`, `{x}`, `%@`) becomes this private-use
// character: not a letter, so it forms no word and no rule can match it.
export const PH = "";
// Masked HTML keeps its newlines (hits report lines) and marks element
// boundaries with these, so a heading never runs into the paragraph after it.
const SEP_BLOCK = "\u001E";
const SEP_H1 = "\u001C";
const SEP_HEADING = "\u001F";
const SEP_ITEM = "\u001D";
const SEP_ATTR = "\u001B";

const USAGE = `usage: scan.mjs [paths…] [--stdin] [--git-log N|A..B] [options]

Flags AI writing tells in text people read. Exit 0 clean, 1 block-tier hits or
an expired waiver, 2 usage or config error.

  --stdin               read text from stdin (set --register; --label names it)
  --git-log N|A..B      scan commit messages: the last N, or a range
  -r, --register R      force a register (default: inferred from each path,
                        or from --label for stdin, else "prose"). See
                        --list-rules for the names.
  --comments            also read code comments (register "comment")
  --summary             per-file table, census and the most frequent rules
  --json                everything, machine-readable
  --all                 include info-tier hits in the text output
  -q, --quiet           block-tier hits only
  --fail-on block|warn  lowest tier that exits 1 (default block)
  --only IDS            only these ids or families, comma-separated (W,P3,F)
  --max N               hits shown per rule per file (default 20)
  --config PATH         use this .humanize.json (default: nearest one up to
                        the repo root)
  --no-config           ignore .humanize.json
  --list-rules          every rule with its tier (for --register, if given)
  --explain ID          one rule and its tier in each register
  --label NAME          display name for --stdin; its path picks the extractor
                        and register (site/copy.html reads as landing)
  --rules PATH          use another rules.json (default: the one beside this
                        script)`;

// ── small helpers ───────────────────────────────────────────────────────────

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const blank = (s) => s.replace(/[^\n]+/g, " ");
const toPosix = (p) => p.split(sep).join("/");
const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const clean = (s) => s.replace(/\s+/g, " ").replaceAll(PH, "{x}").trim();
const clip = (s, n = 90) => {
  const t = clean(s);
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

export function countNewlines(s, end = s.length) {
  let c = 0;
  for (let k = 0; k < end; k++) if (s.charCodeAt(k) === 10) c++;
  return c;
}

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
export const countWords = (s) => (s.match(WORD_RE) || []).length;

function lineIndex(src) {
  const nl = [];
  for (let k = 0; k < src.length; k++) if (src.charCodeAt(k) === 10) nl.push(k);
  return (idx) => {
    let lo = 0;
    let hi = nl.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (nl[mid] < idx) lo = mid + 1;
      else hi = mid;
    }
    return lo + 1;
  };
}

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ",
  thinsp: " ", mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘",
  ldquo: "“", rdquo: "”", laquo: "«", raquo: "»", middot: "·", bull: "•",
  rarr: "→", larr: "←", harr: "↔", copy: "©", reg: "®", trade: "™", times: "×",
  minus: "−", deg: "°", shy: "", zwj: "", zwnj: "",
};
export function decodeEntities(s) {
  return s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]*);/g, (m, e) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try {
        return String.fromCodePoint(cp);
      } catch {
        return m;
      }
    }
    return ENTITIES[e] ?? ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** A short window of `text` around a match, whitespace collapsed. */
export function excerpt(text, idx, len, width = 40) {
  let a = Math.max(0, idx - width);
  let b = Math.min(text.length, idx + len + width);
  if (a > 0) {
    const sp = text.slice(a, idx).search(/\s/);
    if (sp >= 0) a += sp + 1;
  }
  if (b < text.length) {
    const sp = text.slice(idx + len, b).search(/\s\S*$/);
    if (sp >= 0) b = idx + len + sp;
  }
  return (a > 0 ? "…" : "") + clean(text.slice(a, b)) + (b < text.length ? "…" : "");
}

// ── globs ───────────────────────────────────────────────────────────────────
// `**/` is any number of directories, `*` stays inside one, `{a,b}` is a
// choice. A glob with no slash matches the basename at any depth. Paths are
// matched case-insensitively (macOS folds case).

function globSource(g) {
  let re = "";
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*") {
      if (g[i + 1] === "*") {
        if (g[i + 2] === "/") {
          re += "(?:[^/]*/)*";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (c === "{") {
      const end = g.indexOf("}", i);
      if (end < 0) {
        re += "\\{";
        continue;
      }
      re += "(?:" + g.slice(i + 1, end).split(",").map(globSource).join("|") + ")";
      i = end;
    } else re += escapeRe(c);
  }
  return re;
}
const globCache = new Map();
export function globToRe(glob) {
  let re = globCache.get(glob);
  if (!re) {
    let g = glob.replace(/\\/g, "/").replace(/^\.\//, "");
    if (g.startsWith("/")) g = g.slice(1);
    else if (!g.includes("/")) g = "**/" + g;
    re = new RegExp("^" + globSource(g) + "$", "i");
    globCache.set(glob, re);
  }
  return re;
}
export const globMatch = (glob, rel) => globToRe(glob).test(rel.replace(/^\/+/, ""));

// ── rules ───────────────────────────────────────────────────────────────────

const W_BEFORE = "(?<![\\p{L}\\p{N}_\\-])(?<!\\p{L}['’])";
const W_AFTER = "(?![\\p{L}\\p{N}_]|-[\\p{L}\\p{N}]|['’]\\p{L})";
// A sentence opens at the start of a segment or line, or after . ! ? (plus any
// closing quote or bracket) and a space. Markdown list markers are already gone.
const SENTENCE_START = "(?<=(?:^|\\n|[.!?…][\"'”’)\\]]*\\s)\\s*)";

/** `words` entries: phrases split on spaces, `*` = more letters, ' = ' or ’. */
export function wordsSource(words) {
  const alts = [...words]
    .sort((a, b) => b.length - a.length)
    .map((w) =>
      w
        .trim()
        .split(/\s+/)
        .map((part) =>
          escapeRe(part)
            .replace(/\\\*/g, "[\\p{L}\\p{N}]*")
            .replace(/['’]/g, "['’]"),
        )
        .join("\\s+"),
    );
  return W_BEFORE + "(?:" + alts.join("|") + ")" + W_AFTER;
}

function expandRegisters(map, groups) {
  const out = {};
  for (const [k, v] of Object.entries(map || {})) if (k.startsWith("@")) for (const r of groups[k] || []) out[r] = v;
  for (const [k, v] of Object.entries(map || {})) if (!k.startsWith("@")) out[k] = v;
  return out;
}

export function compileRules(data, extra = []) {
  const registers = data.registers || {};
  const names = Object.keys(registers);
  const groups = {
    "@user": names.filter((r) => registers[r].userFacing),
    "@dev": names.filter((r) => registers[r].dev),
    "@all": names,
  };
  const seen = new Set();
  const rules = [...data.rules, ...extra].map((r) => {
    if (seen.has(r.id)) throw new Error(`duplicate rule id ${r.id}`);
    seen.add(r.id);
    return compileRule(r, groups, names);
  });
  return {
    ...data,
    registers,
    registerNames: names,
    groups,
    paths: data.paths || [],
    skip: data.skip || [],
    rules,
    byId: new Map(rules.map((r) => [r.id, r])),
  };
}

export function compileRule(r, groups, names = []) {
  if (!r.id || !r.fix) throw new Error(`rule ${r.id ?? "?"}: needs id and fix`);
  if (!TIERS_OR_OFF.includes(r.tier)) throw new Error(`rule ${r.id}: tier must be block, warn, info or off`);
  if ([r.words, r.regex, r.check].filter((x) => x != null).length !== 1) throw new Error(`rule ${r.id}: needs exactly one of words, regex or check`);
  if (r.words && (!Array.isArray(r.words) || !r.words.length)) throw new Error(`rule ${r.id}: words must be a non-empty array`);
  const rule = { ...r, registers: expandRegisters(r.registers, groups) };
  for (const [reg, t] of Object.entries(rule.registers)) {
    if (names.length && !names.includes(reg)) throw new Error(`rule ${r.id}: unknown register ${reg}`);
    if (!TIERS_OR_OFF.includes(t)) throw new Error(`rule ${r.id}: bad tier ${t} for ${reg}`);
  }
  let src = r.words ? wordsSource(r.words) : r.regex ?? null;
  if (src != null) {
    if (r.at === "sentence-start") src = SENTENCE_START + "(?:" + src + ")";
    else if (r.at === "line-start") src = "^[ \\t]*(?:" + src + ")";
    try {
      rule.re = new RegExp(src, (r.caseSensitive ? "gu" : "giu") + (r.at === "line-start" ? "m" : ""));
      if (r.unless) rule.unlessRe = new RegExp(r.unless, r.caseSensitive ? "u" : "iu");
    } catch (e) {
      throw new Error(`rule ${r.id}: ${e.message}`);
    }
  }
  if (rule.check && !CHECKS[rule.check]) throw new Error(`rule ${r.id}: unknown check ${rule.check}`);
  return rule;
}

export function loadRules(path = RULES_PATH, extra = []) {
  return compileRules(JSON.parse(readFileSync(path, "utf8")), extra);
}

/** The tier a rule has in a register, after the repo's overrides and caps. */
export function tierFor(rule, register, cfg, rules) {
  let t = rule.registers[register] ?? rule.tier;
  const o = cfg?.rules?.[rule.id];
  if (typeof o === "string") t = o;
  else if (o) t = expandRegisters(o.registers, rules.groups)[register] ?? o.tier ?? t;
  const cap = rules.registers?.[register]?.cap;
  if (cap && t !== "off" && TIER_RANK[t] < TIER_RANK[cap]) t = cap;
  return t;
}

export function inferRegister(rel, cfg, rules) {
  for (const [g, r] of [...(cfg?.paths || []), ...rules.paths]) if (globMatch(g, rel)) return r;
  return "prose";
}

export const isSkipped = (rel, rules, cfg) => [...rules.skip, ...(cfg?.exempt || [])].some((g) => globMatch(g, rel));

/** True for this scanner's own files, so a copy vendored anywhere in a repo never scans itself. */
function isSelf(file) {
  if (!["scan.mjs", "hook.mjs", "rules.json"].includes(basename(file))) return false;
  try {
    return dirname(realpathSync(file)) === realpathSync(HERE);
  } catch {
    return false;
  }
}

// ── sentences and census ────────────────────────────────────────────────────

const ABBREV = /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|cf|Fig|No|Vol|approx|Inc|Ltd|Co|Corp|e\.g|i\.e|U\.S|a\.m|p\.m)|(?:^|\s)\p{Lu})\.$/u;

export function splitSentences(text) {
  const t = text.replaceAll(PH, "x").replace(/\s+/g, " ").trim();
  if (!t) return [];
  const out = [];
  let start = 0;
  for (const m of t.matchAll(/[.!?…]+["'”’)\]]*\s+(?=["'“‘(\[]?[\p{Lu}\p{N}])/gu)) {
    if (ABBREV.test(t.slice(start, m.index + 1))) continue;
    out.push(t.slice(start, m.index + m[0].length).trim());
    start = m.index + m[0].length;
  }
  if (start < t.length) out.push(t.slice(start).trim());
  return out.filter((s) => /[\p{L}\p{N}]/u.test(s));
}

// Running prose: what sentence rhythm and density are measured on. Headings,
// list items and table cells are fragments by design.
const PROSE_KINDS = new Set(["para", "quote", "jsx", "string", "prop", "comment", "meta"]);

function sentenceLengths(segs) {
  return segs
    .filter((s) => PROSE_KINDS.has(s.kind))
    .flatMap((s) => splitSentences(s.text))
    .map(countWords)
    .filter((n) => n > 0);
}

function spread(xs) {
  if (!xs.length) return { mean: 0, sd: 0, cv: 0 };
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  return { mean, sd, cv: mean ? sd / mean : 0 };
}

/** Numbers for the judgment pass; no verdicts. */
export function census(segs) {
  const words = segs.reduce((n, s) => n + countWords(s.text), 0);
  const lens = sentenceLengths(segs);
  const s = spread(lens);
  const paras = segs.filter((x) => x.kind === "para").map((x) => countWords(x.text));
  const dashes = segs.reduce((n, x) => n + (x.text.match(/[—–]/g) || []).length, 0);
  return {
    words,
    sentences: lens.length,
    sentenceMean: round(s.mean, 1),
    sentenceCV: round(s.cv),
    longSentences: lens.filter((n) => n >= 30).length,
    shortSentences: lens.filter((n) => n <= 6).length,
    paragraphs: paras.length,
    paragraphCV: round(spread(paras).cv),
    listItems: segs.filter((x) => x.kind === "list").length,
    headings: segs.filter((x) => x.kind === "heading").length,
    dashesPer1k: words ? round((dashes / words) * 1000, 1) : 0,
  };
}

// ── structural checks (rules with "check") ──────────────────────────────────

const SMALL_WORDS = new Set(
  "a an and as at but by en for from if in into is it its nor of off on onto or out over per so than that the to up upon via vs with yet".split(" "),
);
const EMOJI = "[\\u{1F000}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{2B00}-\\u{2BFF}]";
// One emoji as a reader sees it: a flag, or a ZWJ sequence with its skin tones
// and variation selectors, counts once.
const EMOJI_G = new RegExp(`[\\u{1F1E6}-\\u{1F1FF}]{2}|${EMOJI}(?:[\\u{FE0F}\\u{1F3FB}-\\u{1F3FF}]|\\u200D${EMOJI})*`, "gu");
const LEAD_EMOJI = new RegExp(`^\\s*(?:#{1,6}\\s*|[-*+•]\\s+|\\d{1,3}[.)]\\s+)?(?:\\*\\*|__)?${EMOJI}`, "u");
const BOLD_MD = /(\*\*|__)(?=\S)[^\n]{1,160}?\S\1/g;
const BOLD_LABEL_MD = /^\s*(?:(?:[-*+•]|\d{1,3}[.)])\s+)?(?:\*\*|__)[^*_\n]{1,80}?(?:(?:\*\*|__)\s*[:：—–-]|:\s*(?:\*\*|__))/;
const BOLD_LABEL_HTML = /<li\b[^>]*>\s*<(strong|b)\b[^>]*>[^<]{1,80}?(?::\s*<\/\1>|<\/\1>\s*[:—–-])/gi;
// The last three items of a longer list are not a triple: the first item must not follow a comma,
// and must not start at the second word of an item that does.
const TRIPLET =
  /(?<![\p{L}\p{N}'’-])(?<!,\s*)(?<!,\s*\p{L}[\p{L}'’-]*\s+)\p{L}[\p{L}'’-]*(?:\s+\p{L}[\p{L}'’-]*)?,\s+\p{L}[\p{L}'’-]*(?:\s+\p{L}[\p{L}'’-]*)?,?\s+(?:and|or)\s+\p{L}[\p{L}'’-]*(?:\s+\p{L}[\p{L}'’-]*)?(?!\p{L})/gu;
const MARKUP_EXTRACTORS = new Set(["html", "template", "jsx"]);

// Openers that start ordinary runs of sentences; "No X. No Y." is S4's.
const OPENER_STOP = new Set("the a an it i we you they he she this that there these those no".split(" "));

export const CHECKS = {
  // Three or more sentences in a row that open on the same word ("Maybe it…
  // Maybe the… Maybe nobody…").
  sameOpenerRun(segs, { rule }) {
    const run = rule.params?.run ?? 3;
    const out = [];
    for (const s of segs) {
      if (!PROSE_KINDS.has(s.kind)) continue;
      const sents = splitSentences(s.text);
      const first = sents.map((x) => (/^[^\p{L}]*(\p{L}+)/u.exec(x)?.[1] ?? "").toLowerCase());
      for (let i = 0, j; i < sents.length; i = j) {
        for (j = i + 1; j < sents.length && first[j] === first[i]; j++);
        if (j - i >= run && first[i] && !OPENER_STOP.has(first[i]))
          out.push({ line: s.line, match: first[i], excerpt: clip(sents.slice(i, j).join(" ")) });
      }
    }
    return out;
  },

  // Title Case Headings. h2 and below: an h1 is often a product name.
  titleCaseHeadings(segs, { rule }) {
    const out = [];
    for (const s of segs) {
      if (s.kind !== "heading" || (s.level ?? 2) < 2) continue;
      const words = s.text.replace(/\([^)]*\)|"[^"]*"|“[^”]*”/g, " ").match(/\p{L}[\p{L}\p{N}'’.-]*/gu) || [];
      if (words.length < 3) continue;
      const rest = words
        .slice(1)
        .filter((w) => !SMALL_WORDS.has(w.toLowerCase()) && !/^\p{Lu}[\p{Lu}\p{N}]+s?$/u.test(w) && !/\p{Ll}\p{Lu}/u.test(w));
      if (rest.length >= 2 && rest.every((w) => /^\p{Lu}/u.test(w)))
        out.push({ line: s.line, match: clean(s.text), excerpt: clip(s.text) });
    }
    return out.length >= (rule.params?.min ?? 2) ? out : [];
  },

  // "- **Label:** text", the inline-header list, three or more in a document.
  boldLabelBullets(segs, { rule, src, extractor }) {
    const out = [];
    for (const s of segs)
      if ((s.kind === "list" || s.kind === "para") && s.raw && BOLD_LABEL_MD.test(s.raw))
        out.push({ line: s.line, match: clip(s.text.split("\n")[0], 50), excerpt: clip(s.text) });
    if (src && MARKUP_EXTRACTORS.has(extractor)) {
      const lineOf = lineIndex(src);
      for (const m of src.matchAll(BOLD_LABEL_HTML)) {
        const t = m[0].replace(/<[^>]+>/g, " ");
        out.push({ line: lineOf(m.index), match: clip(t, 50), excerpt: clip(t) });
      }
    }
    return out.length >= (rule.params?.min ?? 3) ? out : [];
  },

  boldDensity(segs, { rule, src, extractor, words }) {
    let count = 0;
    let first = 0;
    if (src && MARKUP_EXTRACTORS.has(extractor)) {
      const lineOf = lineIndex(src);
      for (const m of src.matchAll(/<(?:strong|b)\b/gi)) {
        count++;
        if (!first) first = lineOf(m.index);
      }
    } else {
      for (const s of segs) {
        if (s.kind === "heading" || !s.raw) continue;
        const k = (s.raw.match(BOLD_MD) || []).length;
        if (k && !first) first = s.line;
        count += k;
      }
    }
    const p = rule.params || {};
    const per100 = words ? (count / words) * 100 : 0;
    if (count < (p.min ?? 5) || per100 <= (p.per100 ?? 2)) return [];
    return [{ line: first, match: `${count} bold`, excerpt: `${count} bold spans in ${words} words (${round(per100, 1)} per 100)` }];
  },

  emojiLead(segs) {
    const out = [];
    for (const s of segs)
      if ((s.kind === "heading" || s.kind === "list" || s.kind === "subject") && LEAD_EMOJI.test(s.raw ?? s.text))
        out.push({ line: s.line, match: clip(s.text, 40), excerpt: clip(s.text) });
    return out;
  },

  emojiDensity(segs, { rule, words }) {
    let count = 0;
    let first = 0;
    for (const s of segs) {
      const k = (s.text.match(EMOJI_G) || []).length;
      if (k && !first) first = s.line;
      count += k;
    }
    const p = rule.params || {};
    const per1k = words ? (count / words) * 1000 : 0;
    if (count < (p.min ?? 3) || per1k <= (p.per1000 ?? 5)) return [];
    return [{ line: first, match: `${count} emoji`, excerpt: `${count} emoji in ${words} words` }];
  },

  // Every sentence about as long as the last: the metronome of generated text.
  uniformRhythm(segs, { rule }) {
    const lens = sentenceLengths(segs);
    const p = rule.params || {};
    if (lens.length < (p.minSentences ?? 12)) return [];
    const { mean, cv } = spread(lens);
    if (cv >= (p.maxCV ?? 0.3)) return [];
    const first = segs.find((s) => PROSE_KINDS.has(s.kind));
    return [
      {
        line: first?.line ?? 1,
        match: `cv ${round(cv)}`,
        excerpt: `${lens.length} sentences, mean ${round(mean, 1)} words, spread (cv) ${round(cv)}`,
      },
    ];
  },

  tripletDensity(segs, { rule, words }) {
    const found = [];
    for (const s of segs) {
      if (!PROSE_KINDS.has(s.kind) && s.kind !== "list") continue;
      for (const m of s.text.matchAll(TRIPLET))
        found.push({ line: s.line + countNewlines(s.text, m.index), match: clean(m[0]), excerpt: excerpt(s.text, m.index, m[0].length) });
    }
    const p = rule.params || {};
    const per1k = words ? (found.length / words) * 1000 : 0;
    if (found.length < (p.min ?? 3) || per1k <= (p.per1000 ?? 4)) return [];
    return found.map((f) => ({ ...f, note: `${found.length} lists of three in ${words} words` }));
  },

  headingsOnShortText(segs, { rule }) {
    const heads = segs.filter((s) => s.kind === "heading");
    const body = segs.filter((s) => s.kind !== "heading").reduce((n, s) => n + countWords(s.text), 0);
    const p = rule.params || {};
    if (heads.length < (p.minHeadings ?? 3) || body >= (p.maxWords ?? 300)) return [];
    return [{ line: heads[0].line, match: `${heads.length} headings`, excerpt: `${heads.length} headings over ${body} words of text` }];
  },

  listHeavy(segs, { rule, words }) {
    const items = segs.filter((s) => s.kind === "list");
    const listWords = items.reduce((n, s) => n + countWords(s.text), 0);
    const p = rule.params || {};
    if (items.length < (p.minItems ?? 6) || !words || listWords / words <= (p.share ?? 0.6)) return [];
    return [
      {
        line: items[0].line,
        match: `${items.length} bullets`,
        excerpt: `${items.length} bullets carry ${Math.round((listWords / words) * 100)}% of the words`,
      },
    ];
  },

  // Markdown where nothing renders it: commit messages, and commit, social or
  // store text that is pasted or kept in .txt files, plus .txt release notes.
  // A .md draft's own headings are structure, not content. String catalogs
  // are checked for headings only, since SwiftUI's Text renders bold, links
  // and code from a localized string. Backticks and __dunder__ names are left
  // alone: people write them in plain text all the time (sources.md,
  // Calibration).
  markdownInPlainText(segs, { extractor, ext, register }) {
    const catalog = /^(?:strings|stringsdict|xcstrings|i18n)$/.test(extractor);
    const raw = !ext || ext === ".txt";
    const plain =
      extractor === "commit" ||
      (raw && ["commit", "social", "store"].includes(register)) ||
      (register === "release" && ext === ".txt");
    if (!plain && !catalog) return [];
    const re = plain ? /\*\*[^*\n]+\*\*|^#{1,6}\s+\S|\[[^\]\n]+\]\([^)\s]+\)/gm : /^#{1,6}\s+\S/gm;
    const out = [];
    for (const s of segs) {
      const raw = s.raw ?? s.text;
      for (const m of raw.matchAll(re))
        out.push({ line: s.line + countNewlines(raw, m.index), match: m[0].slice(0, 40), excerpt: excerpt(raw, m.index, m[0].length) });
    }
    return out;
  },
};

// ── extraction: Markdown and plain text ─────────────────────────────────────
// A segment is one run of reader-facing text: { kind, line, text, raw }, with
// `text` cleaned for word rules and `raw` the source lines for format rules.

const FRONT_KEYS = new Set(["title", "description", "summary", "excerpt", "subtitle", "tagline", "headline", "lede", "intro", "abstract", "caption", "alt"]);
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function inline(s) {
  s = s
    .replace(/(`+)(?!`)[\s\S]*?[^`]\1(?!`)/g, " ")
    .replace(/!?\[([^\]]*)\]\((?:[^()\s]|\([^()\s]*\))*(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g, " $1 ")
    .replace(/!?\[([^\]]+)\]\[[^\]]*\]/g, " $1 ")
    .replace(/<(?:https?|mailto|ftp):[^>\s]*>/gi, " ")
    .replace(/<\/?[A-Za-z][\w-]*(?:\s[^<>]*)?\/?>/g, " ")
    .replace(/\b(?:https?|ftp):\/\/[^\s<>()\]]+/gi, " ")
    .replace(/\bwww\.[\w-]+\.[^\s<>()\]]+/gi, " ")
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, " ")
    .replace(/(?<!\\)(?:\*{1,3}|~~)/g, " ")
    .replace(/(^|[^\p{L}\p{N}_\\])_{1,3}(?=[\p{L}\p{N}])/gu, "$1 ")
    .replace(/([\p{L}\p{N}.!?,;:)])_{1,3}(?![\p{L}\p{N}_])/gu, "$1 ")
    .replace(/\\([\\`*_{}[\]()#+\-.!|>~<])/g, "$1");
  return decodeEntities(s);
}

export function extractMarkdown(src) {
  src = src.replace(/\r\n?/g, "\n");
  const lines = src.replace(/<!--[\s\S]*?-->/g, blank).split("\n");
  const raws = src.split("\n");
  const segs = [];
  let cur = null;
  let lastKind = null;
  const flush = () => {
    if (cur && /[\p{L}\p{N}]/u.test(cur.text)) segs.push(cur);
    cur = null;
  };
  const start = (kind, i, text, extra) => {
    flush();
    cur = { kind, line: i + 1, text, raw: raws[i], ...extra };
    lastKind = kind;
  };
  const append = (i, text) => {
    cur.text += "\n" + text;
    cur.raw += "\n" + raws[i];
  };
  let fence = null;
  let front = false;
  let inList = false;
  let indented = false;
  let prevBlank = true;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && /^---\s*$/.test(line)) {
      front = true;
      continue;
    }
    if (front) {
      if (/^(?:---|\.\.\.)\s*$/.test(line)) {
        front = false;
        prevBlank = true;
        continue;
      }
      const m = /^\s*([A-Za-z_][\w-]*)\s*:\s*(.+?)\s*$/.exec(line);
      if (m && FRONT_KEYS.has(m[1].toLowerCase())) {
        const value = m[2].replace(/^(["'])(.*)\1$/, "$2");
        if (/\p{L}/u.test(value)) {
          start("meta", i, value);
          flush();
        }
      }
      continue;
    }
    const fm = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (fm && fm[1][0] === fence[0] && fm[1].length >= fence.length && /^ {0,3}(?:`+|~+)\s*$/.test(line)) fence = null;
      continue;
    }
    if (fm) {
      flush();
      fence = fm[1];
      continue;
    }
    if (!line.trim()) {
      flush();
      prevBlank = true;
      continue;
    }
    if (indented) {
      if (/^(?: {4}|\t)/.test(line)) continue;
      indented = false;
    }
    if (prevBlank && !inList && /^(?: {4}|\t)/.test(line)) {
      flush();
      indented = true;
      prevBlank = false;
      continue;
    }
    const afterBlank = prevBlank;
    prevBlank = false;
    let m;
    if (/^ {0,3}\[[^\]]+\]:\s*\S/.test(line)) {
      flush();
      continue;
    }
    if (/^ {0,3}=+\s*$/.test(line) && cur?.kind === "para") {
      cur.kind = "heading";
      cur.level = 1;
      flush();
      continue;
    }
    if (/^ {0,3}-+\s*$/.test(line) && cur?.kind === "para" && !afterBlank) {
      cur.kind = "heading";
      cur.level = 2;
      flush();
      continue;
    }
    if (/^ {0,3}([-*_])(?:[ \t]*\1){2,}\s*$/.test(line)) {
      flush();
      continue;
    }
    if (line.includes("|") && TABLE_SEP.test(line)) {
      if (cur) cur.kind = "table";
      if (cur) cur.text = cur.text.replace(/\|/g, " ");
      flush();
      lastKind = "table";
      continue;
    }
    if ((m = /^ {0,3}(#{1,6})(?=\s|$)/.exec(line))) {
      start("heading", i, inline(line.slice(m[0].length).replace(/\s+#+\s*$/, "")), { level: m[1].length });
      flush();
      inList = false;
      continue;
    }
    if (/^ {0,3}>/.test(line)) {
      const body = inline(line.replace(/^(?: {0,3}>[ \t]?)+/, ""));
      if (cur?.kind === "quote" && !afterBlank) append(i, body);
      else start("quote", i, body);
      continue;
    }
    if ((m = /^(\s*)(?:[-*+•]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/.exec(line))) {
      start("list", i, inline(line.slice(m[0].length)));
      inList = true;
      continue;
    }
    if (/^\s*\|/.test(line) || (lastKind === "table" && line.includes("|") && !afterBlank)) {
      start("table", i, inline(line.replace(/\|/g, " ")));
      flush();
      continue;
    }
    if (cur && !afterBlank) {
      append(i, inline(line));
      continue;
    }
    if (inList && /^\s/.test(line)) {
      start("list", i, inline(line));
      continue;
    }
    inList = false;
    start("para", i, inline(line));
  }
  flush();
  return segs;
}

// ── extraction: HTML, Astro, Vue, Svelte, MJML ──────────────────────────────

const SKIP_CONTENT = new Set(["script", "style", "pre", "code", "kbd", "samp", "var", "svg", "math", "noscript", "textarea", "iframe", "object", "canvas"]);
const BLOCK_TAGS = new Set(
  "address article aside blockquote body br button caption dd details dialog div dl dt fieldset figcaption figure footer form head header hr html label legend li main menu nav ol optgroup option output p section select summary table tbody td tfoot th thead title tr ul mj-text mj-button mj-section mj-column".split(" "),
);
const TEXT_ATTRS = new Set(["alt", "title", "aria-label", "aria-description", "aria-placeholder", "aria-roledescription", "aria-valuetext", "placeholder", "label"]);
const META_TEXT = new Set(["description", "og:description", "og:title", "og:image:alt", "twitter:title", "twitter:description", "twitter:image:alt", "apple-mobile-web-app-title"]);

function frontmatterEnd(src) {
  const m = /^\uFEFF?\s*---[ \t]*\n/.exec(src);
  if (!m) return 0;
  const close = /\n---[ \t]*(?:\n|$)/g;
  close.lastIndex = m[0].length - 1;
  const c = close.exec(src);
  return c ? c.index + c[0].length : 0;
}

function skipQuote(src, j) {
  const q = src[j];
  for (let k = j + 1; k < src.length; k++) {
    if (src[k] === "\\") k++;
    else if (src[k] === q) return k + 1;
  }
  return src.length;
}

function skipBraces(src, i) {
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '"' || c === "'" || c === "`") {
      j = skipQuote(src, j) - 1;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return j + 1;
  }
  return src.length;
}

function tagEnd(src, i, expressions) {
  let q = null;
  let depth = 0;
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (q) {
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") q = c;
    else if (expressions && c === "{") depth++;
    else if (expressions && c === "}") depth = Math.max(0, depth - 1);
    else if (c === ">" && depth === 0) return j + 1;
  }
  return src.length;
}

function keepAttrs(tag, name) {
  const metaName = name === "meta" ? (/\b(?:name|property|itemprop)\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1] || "").toLowerCase() : "";
  const buttonInput = name === "input" && /\btype\s*=\s*["']?(?:submit|button|reset)\b/i.test(tag);
  let out = "";
  let last = 0;
  for (const m of tag.matchAll(/([^\s"'<>/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const attr = m[1].toLowerCase();
    const value = m[2] ?? m[3] ?? "";
    const keep = attr === "content" ? META_TEXT.has(metaName) : attr === "value" ? buttonInput : TEXT_ATTRS.has(attr);
    if (!keep || !/\p{L}/u.test(value)) continue;
    const vStart = m.index + m[0].length - 1 - value.length;
    out += blank(tag.slice(last, vStart)) + SEP_ATTR + decodeEntities(value) + SEP_ATTR;
    last = vStart + value.length;
  }
  return out + blank(tag.slice(last));
}

function segmentsFromMasked(text) {
  const segs = [];
  const parts = text.split(/([\u001B-\u001F]|\n[ \t]*\n)/);
  let line = 1;
  let kind = "para";
  let level;
  let saved = null;
  for (let k = 0; k < parts.length; k++) {
    const p = parts[k];
    if (k % 2) {
      line += countNewlines(p);
      // An attribute value is a segment of its own; the element text around it
      // keeps its heading or list kind.
      if (p === SEP_ATTR) {
        if (saved) {
          [kind, level] = saved;
          saved = null;
        } else {
          saved = [kind, level];
          [kind, level] = ["para", undefined];
        }
      } else if (p === SEP_H1) [kind, level] = ["heading", 1];
      else if (p === SEP_HEADING) [kind, level] = ["heading", 2];
      else if (p === SEP_ITEM) [kind, level] = ["list", undefined];
      else if (p === SEP_BLOCK) [kind, level] = ["para", undefined];
      continue;
    }
    if (/[\p{L}\p{N}]/u.test(p)) {
      const lead = /^\s*/.exec(p)[0];
      const seg = { kind, line: line + countNewlines(lead), text: p.slice(lead.length).trimEnd() };
      if (level) seg.level = level;
      segs.push(seg);
    }
    line += countNewlines(p);
  }
  return segs;
}

export function extractHtml(src, { expressions = false, frontmatter = false } = {}) {
  src = src.replace(/\r\n?/g, "\n");
  const lower = src.toLowerCase();
  const n = src.length;
  const isTag = (j) => src[j] === "<" && /[A-Za-z/!?]/.test(src[j + 1] || "");
  let out = "";
  let i = 0;
  if (frontmatter) {
    const end = frontmatterEnd(src);
    if (end) {
      out += blank(src.slice(0, end));
      i = end;
    }
  }
  while (i < n) {
    if (src.startsWith("<!--", i)) {
      const e = src.indexOf("-->", i + 4);
      const end = e < 0 ? n : e + 3;
      out += blank(src.slice(i, end));
      i = end;
      continue;
    }
    if (isTag(i)) {
      const end = tagEnd(src, i, expressions);
      const tag = src.slice(i, end);
      const closing = tag[1] === "/";
      const name = (/^<\/?([A-Za-z][\w:.-]*)/.exec(tag)?.[1] || "").toLowerCase();
      let mark = "";
      if (!closing && name === "h1") mark = SEP_H1;
      else if (!closing && /^h[2-6]$/.test(name)) mark = SEP_HEADING;
      else if (!closing && name === "li") mark = SEP_ITEM;
      else if (BLOCK_TAGS.has(name) || /^h[1-6]$/.test(name)) mark = SEP_BLOCK;
      out += mark + (closing ? blank(tag) : keepAttrs(tag, name));
      i = end;
      if (!closing && SKIP_CONTENT.has(name) && !tag.endsWith("/>")) {
        const close = lower.indexOf("</" + name, i);
        const stop = close < 0 ? n : close;
        out += blank(src.slice(i, stop));
        i = stop;
      }
      continue;
    }
    if (expressions && src[i] === "{") {
      const e = skipBraces(src, i);
      out += PH + src.slice(i, e).replace(/[^\n]/g, "");
      i = e;
      continue;
    }
    let j = i + 1;
    while (j < n && !isTag(j) && !(expressions && src[j] === "{")) j++;
    out += decodeEntities(src.slice(i, j));
    i = j;
  }
  return [...segmentsFromMasked(out), ...jsonLdSegments(src)].sort((a, b) => a.line - b.line);
}

// Search results show JSON-LD text (FAQ answers, product descriptions), and it
// usually repeats the page copy, so its reader-facing values are scanned too.
const LD_VALUE =
  /"(?:name|description|text|headline|alternativeHeadline|abstract|caption|slogan|disambiguatingDescription|reviewBody|featureList)"\s*:\s*(\[[^\]]*\]|"(?:[^"\\]|\\.)*")/g;

function jsonLdSegments(src) {
  const segs = [];
  for (const m of src.matchAll(/<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const start = m.index + m[0].indexOf(">") + 1;
    for (const v of m[1].matchAll(LD_VALUE)) {
      const at = start + v.index + v[0].length - v[1].length;
      for (const s of v[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
        let text;
        try {
          text = JSON.parse(`"${s[1]}"`);
        } catch {
          continue;
        }
        if (/\p{L}{2,}/u.test(text)) segs.push({ kind: "meta", line: countNewlines(src, at + s.index) + 1, text, raw: s[1] });
      }
    }
  }
  return segs;
}

function scriptBlocks(src) {
  const out = [];
  for (const m of src.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\btype\s*=\s*["']?(?:application\/(?:ld\+)?json|text\/template|importmap)/i.test(m[1])) continue;
    out.push({ code: m[2], line: countNewlines(src, m.index + m[0].indexOf(">") + 1) + 1 });
  }
  return out;
}

export function extractTemplate(src, ext = ".astro") {
  src = src.replace(/\r\n?/g, "\n");
  const segs = extractHtml(src, { expressions: true, frontmatter: ext === ".astro" });
  const end = ext === ".astro" ? frontmatterEnd(src) : 0;
  if (end) segs.push(...extractScript(src.slice(0, end)));
  if (ext === ".vue" || ext === ".svelte")
    for (const b of scriptBlocks(src)) for (const s of extractScript(b.code, { jsx: false })) segs.push({ ...s, line: s.line + b.line - 1 });
  return segs.sort((a, b) => a.line - b.line);
}

// ── extraction: string literals and comments (TS/JS/JSX, Swift) ─────────────

const CSS_DECL = /[a-z-]{2,}\s*:\s*[^;{}]{1,80};/g;
const MARKUP = /<\/[a-z][\w-]*>|<[a-z][\w-]*(?:\s[^<>]*)?\/?>/g;
const SQL_OPENER = /^\s*(?:CREATE|SELECT|INSERT|UPDATE|DELETE|ALTER|DROP|PRAGMA|WITH|BEGIN|REPLACE INTO)\b/i;
const SQL_FRAGMENT = /\b(?:select|from|where|join|exists|group by|order by|on conflict)\b[\s\S]*\b(?:select|from|where|join|exists|group by|order by|and|or)\b/i;
const TAILWIND = /(?:^|\s)(?:[a-z][\w.]*:)?-?[a-z][\w.]*-(?:\[[^\]]+\]|[\w./]+)(?:\s|$)/;
const DATE_FORMAT = /^[yMdHhmsSaEGQWwZzXxLlcek\s,.:/'’-]+$/;
const FORMAT_SPEC = /%(?:\d+\$)?[-+ #0]*\d*(?:\.\d+)?(?:ll|l|hh|h|q|z|t|j)?[@dDuUxXoOfFeEgGcCsSpaA%]|%#@\w+@/g;

/** One token with no spaces that reads as a key, path, id or code. */
export const looksLikeIdentifier = (t) => {
  const s = t.replaceAll(PH, "").trim();
  return !/\s/.test(s) && /[_./:@#%=?&[\]$\\]|\p{Ll}\p{Lu}|^\d|-\w*-/u.test(s);
};

/** A string literal outside a known UI call: is it a sentence someone reads? */
export function isProse(raw, text = raw) {
  if (!raw || raw.includes("://")) return false;
  const t = text.replaceAll(PH, " ").replace(/\s+/g, " ").trim();
  if (!/\p{L}/u.test(t) || looksLikeIdentifier(t)) return false;
  const decls = raw.match(CSS_DECL);
  if (decls && decls.length >= 3 && raw.includes("{")) return false;
  if ((raw.match(MARKUP) || []).length >= 2) return false;
  if (countWords(t) < 3) return false;
  if (SQL_OPENER.test(t)) return false;
  const prosePunct = /[.!?](?:\s|$)/.test(t);
  if (!prosePunct && (SQL_FRAGMENT.test(t) || TAILWIND.test(t))) return false;
  if (DATE_FORMAT.test(t)) return false;
  const words = t.split(" ");
  if (words.filter((w) => /\p{Ll}\p{Lu}|_|^\$|[{}();=<>]/u.test(w)).length * 2 >= words.length) return false;
  return true;
}

const DIRECTIVE = /^\s*(?:eslint|prettier|@ts-|ts-|tslint|jshint|global\b|istanbul|c8\b|biome-ignore|swiftlint|swift-format|sourceMappingURL|#(?:end)?region|webpackChunkName|@vite-ignore|@flow|@jsx|@refresh|humanize-|MARK:|SPDX-License|Copyright|\(c\)|-\*-)/i;
const CODE_LINE =
  /^(?:[\w$.]+\s*\(.*\)\s*;?|(?:let|var|const|func|function|import|export|return|if|else|for|while|class|struct|enum|guard|case|switch|await|try|catch|throw|public|private|static|override|@\w+)\b.*|[\w$.[\]]+\s*[+\-*/]?=\s*.+;?|[{}()[\];,]+)$/;

function commentSegment(body, line) {
  const lines = body.split("\n").map((l) => l.replace(/^\s*(?:\*+|\/+)?[ \t]?/, ""));
  const content = lines.map((l) => l.trim()).filter(Boolean);
  if (!content.length || DIRECTIVE.test(content[0])) return null;
  if (content.every((l) => CODE_LINE.test(l))) return null;
  const text = lines.join("\n");
  if (!/\p{L}{2,}/u.test(text)) return null;
  return { kind: "comment", line, text, raw: body };
}

const REGEX_PRECEDERS = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "~", "^", "<", ">", ""]);
const REGEX_KEYWORDS = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "yield", "await"]);
const JSX_PRECEDERS = new Set(["(", ",", "=", "?", ":", "&", "|", "{", "[", ">", "!", ";", ""]);
const JSX_KEYWORDS = new Set(["return", "yield", "default", "case", "await", "else", "do"]);
const JS_SUPPRESS = [
  /(?:^|[^\w$.])(?:console|logger|log|debug|winston|pino)\s*\.\s*[A-Za-z_$][\w$]*\s*$/,
  /(?:^|[^\w$.])(?:track|trackEvent|captureEvent|captureException|captureMessage|addBreadcrumb|logEvent|require|import|describe|it|test|expect|beforeEach|afterEach|invariant|assert|querySelector|querySelectorAll|getElementById|getElementsByClassName|addEventListener|removeEventListener|dispatchEvent|matchMedia|getItem|setItem|removeItem|getPropertyValue|setAttribute|getAttribute|createElement|fetch|RegExp|URL|URLSearchParams|Symbol|cn|clsx|classNames|cva|twMerge|keyframes|gql|graphql|sql)\s*$/,
  /(?:^|[^\w$.])(?:Sentry|posthog|analytics|mixpanel|amplitude|segment|datadog|LOG_EVENTS)\s*(?:\.[\w$]+)+\s*$/,
  /\.(?:on|off|once|emit|addListener|get|has|delete|query|prepare|exec|raw|select|from|eq|neq|in|order|rpc|channel|invoke|postMessage|setHeader|getHeader|test|match|matchAll|replace|replaceAll|split|startsWith|endsWith|includes|indexOf|join|localeCompare|toLocaleDateString|toLocaleString|toLocaleTimeString)\s*$/,
];
const JS_TAGS = /(?:^|[^\w$.])(?:sql|gql|graphql|css|html|svg|md|markdown|dedent|outdent|keyframes|createGlobalStyle|injectGlobal|String\.raw|styled(?:\.\w+|\([^)]*\))(?:\.attrs\([^)]*\))?)\s*$/;
const COPY_PROPS = new Set(
  "alt title label placeholder aria-label aria-description aria-placeholder aria-valuetext aria-roledescription accessibilityLabel accessibilityHint description subtitle caption message hint helperText helpText tooltip heading header footer text body cta summary prompt headline tagline eyebrow lede intro legend note".split(" "),
);
const COPY_PROP_SUFFIX = /(?:Text|Label|Title|Message|Description|Hint|Caption|Placeholder|Copy|Heading|Subtitle|Tooltip|Prompt|Summary|Headline|Tagline)$/;
const NON_COPY_PROPS = new Set(
  "className class style id key ref testID testId nativeID href src srcSet to as type name variant size color icon rel target role lang dir method action pattern mode sx tw css htmlFor for autoComplete autoCapitalize inputMode keyboardType returnKeyType textContentType align justify direction fill stroke d viewBox xmlns transform points path width height fontFamily fontWeight accessibilityRole pointerEvents resizeMode source uri layout behavior edges presentation animation initialRouteName component slot sizes media loading decoding crossOrigin integrity referrerPolicy sandbox allow form formAction encType accept capture min max step value defaultValue".split(" "),
);

function isCopyProp(attr, value) {
  const v = value.replaceAll(PH, " ");
  if (!/\p{L}/u.test(v)) return false;
  if (NON_COPY_PROPS.has(attr) || /^(?:data-|on[A-Z])/.test(attr)) return false;
  if (COPY_PROPS.has(attr) || COPY_PROP_SUFFIX.test(attr)) return !looksLikeIdentifier(v);
  return isProse(value, value);
}

export function extractScript(src, { jsx = false, comments = false } = {}) {
  src = src.replace(/\r\n?/g, "\n");
  const n = src.length;
  const lineOf = lineIndex(src);
  const segs = [];
  let prop = null; // the JSX attribute whose {expression} is being read

  function literal(q, j) {
    let k = j + 1;
    let text = "";
    while (k < n) {
      const c = src[k];
      if (c === "\\") {
        const e = src[k + 1];
        if (e === "n" || e === "t" || e === "r") text += " ";
        else if (e === "u" || e === "x") {
          const m = (e === "u" ? /^u(?:\{([0-9a-fA-F]+)\}|([0-9a-fA-F]{4}))/ : /^x([0-9a-fA-F]{2})/).exec(src.slice(k + 1, k + 12));
          if (m) {
            text += String.fromCodePoint(parseInt(m[1] ?? m[2], 16));
            k += 1 + m[0].length;
            continue;
          }
        } else if (e !== "\n") text += e ?? "";
        k += 2;
        continue;
      }
      if (q === "`" && c === "$" && src[k + 1] === "{") {
        k = code(k + 2, true);
        text += PH;
        continue;
      }
      if (c === q) return { end: k + 1, text, raw: src.slice(j + 1, k) };
      if (c === "\n" && q !== "`") return { end: k, text, raw: src.slice(j + 1, k) };
      text += c;
      k++;
    }
    return { end: n, text, raw: src.slice(j + 1) };
  }

  function addComment(body, line) {
    if (!comments) return;
    const seg = commentSegment(body, line);
    if (seg) segs.push(seg);
  }

  function takeLiteral(lit, j, suppressed, trail, parens) {
    if (suppressed) return;
    if (/(?:^|[^\w$.])(?:import|from|require|export)\s*\(?\s*$/.test(trail)) return;
    const inProp = prop && parens === 0;
    const ok = inProp ? isCopyProp(prop, lit.text) : isProse(lit.raw, lit.text);
    if (ok) segs.push({ kind: inProp ? "prop" : "string", line: lineOf(j), text: lit.text, raw: lit.raw });
  }

  function regexEnd(j) {
    let k = j + 1;
    let inClass = false;
    while (k < n && src[k] !== "\n") {
      if (src[k] === "\\") k += 2;
      else {
        if (src[k] === "[") inClass = true;
        else if (src[k] === "]") inClass = false;
        else if (src[k] === "/" && !inClass) {
          k++;
          while (k < n && /[a-z]/i.test(src[k])) k++;
          return k;
        }
        k++;
      }
    }
    return -1;
  }

  function code(j, untilBrace) {
    let depth = 0;
    let parens = 0;
    let lastSig = untilBrace ? "{" : "";
    let lastWord = "";
    let trail = "";
    const supp = [];
    const note = (s) => {
      trail = (trail + s).slice(-160);
    };
    while (j < n) {
      const c = src[j];
      if (c === "/" && src[j + 1] === "/") {
        let e = src.indexOf("\n", j);
        if (e < 0) e = n;
        addComment(src.slice(j + 2, e), lineOf(j));
        j = e;
        continue;
      }
      if (c === "/" && src[j + 1] === "*") {
        let e = src.indexOf("*/", j + 2);
        if (e < 0) e = n;
        addComment(src.slice(j + 2, e), lineOf(j));
        j = Math.min(n, e + 2);
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        const tagged = c === "`" && JS_TAGS.test(trail);
        const lit = literal(c, j);
        if (!tagged) takeLiteral(lit, j, supp.length > 0, trail, parens);
        j = lit.end;
        lastSig = c;
        lastWord = "";
        note('"x"');
        continue;
      }
      if (c === "/" && ((!lastWord && REGEX_PRECEDERS.has(lastSig)) || REGEX_KEYWORDS.has(lastWord))) {
        const e = regexEnd(j);
        if (e > 0) {
          j = e;
          lastSig = "/";
          lastWord = "";
          note("/r/");
          continue;
        }
      }
      if (jsx && c === "<" && /[A-Za-z>]/.test(src[j + 1] || "") && ((!lastWord && JSX_PRECEDERS.has(lastSig)) || JSX_KEYWORDS.has(lastWord))) {
        const mark = segs.length;
        const e = element(j);
        if (e > 0) {
          j = e;
          lastSig = ">";
          lastWord = "";
          note("<j/>");
          continue;
        }
        segs.length = mark;
      }
      if (c === "{") depth++;
      else if (c === "}") {
        if (untilBrace && depth === 0) return j + 1;
        depth--;
      } else if (c === "(") {
        parens++;
        if (JS_SUPPRESS.some((re) => re.test(trail))) supp.push(parens);
      } else if (c === ")") {
        while (supp.length && supp[supp.length - 1] >= parens) supp.pop();
        parens = Math.max(0, parens - 1);
      }
      if (/[\w$]/.test(c)) {
        let k = j + 1;
        while (k < n && /[\w$]/.test(src[k])) k++;
        lastWord = src.slice(j, k);
        lastSig = src[k - 1];
        note(lastWord);
        j = k;
        continue;
      }
      if (!/\s/.test(c)) {
        lastSig = c;
        lastWord = "";
      }
      note(c);
      j++;
    }
    return n;
  }

  function element(j) {
    let k = j + 1;
    if (src[k] === ">") return children(k + 1);
    const nm = /^[A-Za-z_$][\w$.:-]*/.exec(src.slice(k, k + 120));
    if (!nm) return -1;
    k += nm[0].length;
    if (/^\s*(?:,|extends\b)/.test(src.slice(k, k + 12))) return -1; // a generic, not an element
    for (;;) {
      while (k < n && /\s/.test(src[k])) k++;
      if (k >= n) return -1;
      if (src[k] === "/" && src[k + 1] === ">") return k + 2;
      if (src[k] === ">") return children(k + 1);
      if (src[k] === "{") {
        k = code(k + 1, true);
        continue;
      }
      const an = /^[^\s=/>{}"'<]+/.exec(src.slice(k, k + 120));
      if (!an) return -1;
      const attr = an[0];
      k += attr.length;
      while (k < n && /\s/.test(src[k])) k++;
      if (src[k] !== "=") continue;
      k++;
      while (k < n && /\s/.test(src[k])) k++;
      const q = src[k];
      if (q === '"' || q === "'") {
        const e = src.indexOf(q, k + 1);
        if (e < 0) return -1;
        const value = decodeEntities(src.slice(k + 1, e));
        if (isCopyProp(attr, value)) segs.push({ kind: "prop", line: lineOf(k), text: value, raw: value });
        k = e + 1;
      } else if (q === "{") {
        const saved = prop;
        prop = attr;
        k = code(k + 1, true);
        prop = saved;
      } else return -1;
    }
  }

  function children(j) {
    let buf = "";
    let line = 0;
    let started = false;
    const flush = () => {
      if (started && /\p{L}/u.test(buf)) segs.push({ kind: "jsx", line, text: decodeEntities(buf).replace(/^\s+/, ""), raw: buf.trim() });
      buf = "";
      started = false;
    };
    const saved = prop;
    prop = null;
    try {
      while (j < n) {
        const c = src[j];
        if (c === "<") {
          flush();
          if (src[j + 1] === "/") {
            const e = src.indexOf(">", j);
            return e < 0 ? -1 : e + 1;
          }
          const e = element(j);
          if (e < 0) return -1;
          j = e;
          continue;
        }
        if (c === "{") {
          const lit = /^\{\s*(["'])((?:\\.|(?!\1)[^\\\n])*)\1\s*\}/.exec(src.slice(j, j + 600));
          if (lit) {
            if (!started && /\S/.test(lit[2])) [started, line] = [true, lineOf(j)];
            buf += lit[2];
            j += lit[0].length;
            continue;
          }
          const e = code(j + 1, true);
          if (started) buf += PH;
          j = e;
          continue;
        }
        if (!started && !/\s/.test(c)) [started, line] = [true, lineOf(j)];
        if (started) buf += c;
        j++;
      }
      return -1;
    } finally {
      prop = saved;
    }
  }

  code(0, false);
  return segs.sort((a, b) => a.line - b.line);
}

// Swift: Text("…") and its kin are copy at any length; other literals count
// when they read as a sentence. Logging, assertions, keys, identifiers and
// translator comments are not read by users.
const SWIFT_UI = [
  /(?:^|[^\w.])(?:Text|Label|Button|Toggle|Picker|Menu|Section|NavigationLink|TextField|SecureField|TextEditor|Link|Tab|LabeledContent|ContentUnavailableView|GroupBox|DisclosureGroup|Stepper|DatePicker|ColorPicker|ShareLink|ProgressView|Gauge|ControlGroup|Alert|ActionSheet|UIAlertController|UIAlertAction|NSAlert|Window|WindowGroup|CommandMenu|CommandGroup|MenuBarExtra|ToolbarItem|LocalizedStringKey|LocalizedStringResource|NSLocalizedString)\s*\(\s*(?:verbatim\s*:\s*)?$/,
  /\.(?:navigationTitle|navigationSubtitle|alert|confirmationDialog|help|accessibilityLabel|accessibilityHint|accessibilityValue|accessibilityAction|badge|searchable|tabItem|toolbarTitleMenu|prompt|fileExporter|fileImporter)\s*\([^()]*$/,
  /\b(?:String|AttributedString)\s*\(\s*localized\s*:\s*$/,
  /\b(?:title|message|messageText|informativeText|label|prompt|placeholder|description|subtitle|caption|text|hint|header|footer|actionTitle|buttonTitle|summary|detail|body|headline|tooltip|toolTip|explanation|localizedDescription)\s*:\s*$/,
];
const SWIFT_SUPPRESS = [
  /(?:^|[^\w.])(?:print|debugPrint|NSLog|os_log|fatalError|assert|assertionFailure|precondition|preconditionFailure|dump|XCTAssert\w*|XCTFail|XCTSkip\w*|XCTUnwrap|expectation|NSPredicate|NSExpression|NSSortDescriptor|URL|URLComponents|URLQueryItem|URLRequest|NSRegularExpression|Regex|Selector|NSSelectorFromString|NSClassFromString|Logger|OSLog|OSSignposter|UTType|Image|NSImage|UIImage|Color|NSColor|UIColor|Font|NSFont|UIFont|Bundle|FileManager|Process|DispatchQueue|UserDefaults|AppStorage|SceneStorage|BGTaskScheduler|BGProcessingTaskRequest|BGAppRefreshTaskRequest|CKContainer|CKRecord|CKRecordZone|CKQuery|NSEntityDescription|NSFetchRequest|FetchRequest|SortDescriptor|NSUserActivity|UIPasteboard|CharacterSet|DateFormatter|ISO8601DateFormatter|Locale|TimeZone|SecItemAdd|SecItemCopyMatching|SecItemUpdate|SecItemDelete|sqlite3_\w+|exec|query|(?:NS)?Notification\.Name|NSPasteboard\.PasteboardType)\s*$/,
  /\.(?:debug|trace|info|notice|warning|error|fault|critical|log|accessibilityIdentifier|appendingPathComponent|appendingPathExtension|appending|object|set|bool|integer|double|float|string|data|array|dictionary|stringArray|url|value|setValue|removeObject|register|addObserver|removeObserver|post|perform|matches|range|replacingOccurrences|components|split|hasPrefix|hasSuffix|contains|starts|firstMatch|wholeMatch|prefixMatch|trimmingCharacters|evaluate|execute|prepare|bind|decode|encode|decodeIfPresent|encodeIfPresent|fetch|tag|id|named|onOpenURL|handlesExternalEvents|keyboardShortcut|signpost|beginInterval|endInterval|emitEvent)\s*$/,
  /(?:^|[^\w])@(?:available|objc|_silgen_name|_cdecl|Option|Argument|Flag|AppStorage|SceneStorage|Environment)\s*$/,
  /#Preview\s*$/,
];
const SWIFT_SKIP_LABEL =
  /\b(?:comment|forKey|key|forResource|withExtension|systemName|systemImage|named|identifier|withIdentifier|reuseIdentifier|forCellReuseIdentifier|subsystem|category|predicate|keyPath|entityName|ofType|extension|path|scheme|host|bundleIdentifier|forHTTPHeaderField|httpMethod|forUndefinedKey|tableName|bundle|suiteName|accessGroup|service|account|contentType|id|tag|forMode)\s*:\s*$/;

function readSwiftString(src, i) {
  let hashes = 0;
  while (src[i + hashes] === "#") hashes++;
  let j = i + hashes;
  const multi = src.startsWith('"""', j);
  j += multi ? 3 : 1;
  const contentStart = j;
  const close = (multi ? '"""' : '"') + "#".repeat(hashes);
  const esc = "\\" + "#".repeat(hashes);
  let text = "";
  while (j < src.length) {
    if (src.startsWith(close, j)) return { end: j + close.length, text, raw: src.slice(contentStart, j), contentStart };
    if (!multi && src[j] === "\n") break;
    if (src.startsWith(esc, j)) {
      const k = j + esc.length;
      const e = src[k];
      if (e === "(") {
        j = skipSwiftInterpolation(src, k + 1);
        text += PH;
        continue;
      }
      if (e === "u" && src[k + 1] === "{") {
        const c = src.indexOf("}", k);
        const cp = parseInt(src.slice(k + 2, c), 16);
        if (!Number.isNaN(cp)) text += String.fromCodePoint(cp);
        j = c + 1;
        continue;
      }
      if (e === "n" || e === "t" || e === "r") text += " ";
      else if (e !== "\n") text += e ?? "";
      j = k + 1;
      continue;
    }
    text += src[j];
    j++;
  }
  return { end: j, text, raw: src.slice(contentStart, j), contentStart };
}

function skipSwiftInterpolation(src, j) {
  let depth = 1;
  while (j < src.length && depth > 0) {
    const c = src[j];
    if (c === '"') {
      j = readSwiftString(src, j).end;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") depth--;
    j++;
  }
  return j;
}

function debugRanges(src) {
  // Line numbers inside `#if DEBUG … #endif`: diagnostic text, not copy.
  const lines = new Set();
  let depth = 0;
  let debugAt = 0;
  src.split("\n").forEach((t, k) => {
    const s = t.trim();
    if (/^#if\b/.test(s)) {
      depth++;
      if (!debugAt && /^#if\s+DEBUG\b/.test(s)) debugAt = depth;
    } else if (/^#endif\b/.test(s)) {
      if (debugAt === depth) debugAt = 0;
      depth = Math.max(0, depth - 1);
    } else if (/^#else\b/.test(s) && debugAt === depth) debugAt = 0;
    if (debugAt) lines.add(k + 1);
  });
  return lines;
}

export function extractSwift(src, { comments = false } = {}) {
  src = src.replace(/\r\n?/g, "\n");
  const n = src.length;
  const lineOf = lineIndex(src);
  const debug = debugRanges(src);
  const segs = [];
  const supp = [];
  let depth = 0;
  let trail = "";
  const note = (s) => {
    trail = (trail + s).slice(-160);
  };
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      let e = src.indexOf("\n", i);
      if (e < 0) e = n;
      if (comments) {
        const seg = commentSegment(src.slice(i + 2, e), lineOf(i));
        if (seg) segs.push(seg);
      }
      i = e;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      let d = 1;
      let j = i + 2;
      while (j < n && d > 0) {
        if (src[j] === "/" && src[j + 1] === "*") [d, j] = [d + 1, j + 2];
        else if (src[j] === "*" && src[j + 1] === "/") [d, j] = [d - 1, j + 2];
        else j++;
      }
      if (comments) {
        const seg = commentSegment(src.slice(i + 2, Math.max(i + 2, j - 2)), lineOf(i));
        if (seg) segs.push(seg);
      }
      note(" ");
      i = j;
      continue;
    }
    if (c === '"' || (c === "#" && /^#+"/.test(src.slice(i, i + 8)))) {
      const r = readSwiftString(src, i);
      const line = lineOf(r.contentStart);
      if (!supp.length && !SWIFT_SKIP_LABEL.test(trail) && !debug.has(line)) {
        const ui = SWIFT_UI.some((re) => re.test(trail));
        const bare = r.text.replaceAll(PH, "");
        const ok = ui ? /\p{L}/u.test(bare) && !looksLikeIdentifier(r.text) : isProse(r.raw, r.text);
        if (ok) segs.push({ kind: "string", line, text: r.text, raw: r.raw });
      }
      note('"x"');
      i = r.end;
      continue;
    }
    if (c === "(") {
      depth++;
      if (SWIFT_SUPPRESS.some((re) => re.test(trail))) supp.push(depth);
    } else if (c === ")") {
      while (supp.length && supp[supp.length - 1] >= depth) supp.pop();
      depth = Math.max(0, depth - 1);
    }
    note(c);
    i++;
  }
  return segs;
}

// ── extraction: string tables and i18n ──────────────────────────────────────

const LANGS = new Set(
  "af am ar as az be bg bn bs ca cs cy da de el es et eu fa fi fil fr ga gl gu he hi hr hu hy id is it ja ka kk km kn ko ky lo lt lv mk ml mn mr ms my nb ne nl nn no or pa pl pt ro ru si sk sl sq sr sv sw ta te th tl tr uk ur uz vi zh zu".split(" "),
);

const LOCALE_TAG = /^([a-z]{2,3})((?:[-_](?:[a-z]{2}|[a-z]{4}|\d{3}))*)$/;
const LOCALE_PARENTS = new Set(
  "locales locale i18n lang langs languages translations translation messages intl l10n content docs pages site public www metadata".split(" "),
);

/**
 * English only. de.lproj, a fr-FR or zh-Hans folder, locales/de/, de.json and
 * README.de.md mark another language; a bare two-letter folder elsewhere (ml/,
 * it/, sw/, gl/) does not.
 */
export function isForeignLocale(rel) {
  const parts = rel.toLowerCase().split("/");
  return parts.some((part, i) => {
    let m;
    if (part.endsWith(".lproj")) return LANGS.has(LOCALE_TAG.exec(part.slice(0, -6))?.[1]);
    if (i === parts.length - 1) {
      const stem = part.replace(/\.[a-z0-9]+$/, "");
      if ((m = LOCALE_TAG.exec(stem)) && /\.(?:json|arb|strings|stringsdict|ya?ml|po|xliff|properties)$/.test(part)) return LANGS.has(m[1]);
      return LANGS.has(/\.([a-z]{2,3})(?:[-_](?:[a-z]{2}|[a-z]{4}))?$/.exec(stem)?.[1]);
    }
    if (!(m = LOCALE_TAG.exec(part)) || !LANGS.has(m[1])) return false;
    return Boolean(m[2]) || LOCALE_PARENTS.has(parts[i - 1]);
  });
}

function finder(src) {
  const lineOf = lineIndex(src);
  let from = 0;
  return (s) => {
    const needle = JSON.stringify(s);
    let at = src.indexOf(needle, from);
    if (at < 0) at = src.indexOf(needle);
    if (at >= 0) from = at;
    return at < 0 ? 1 : lineOf(at);
  };
}

const uiText = (text) => /\p{L}/u.test(text.replaceAll(PH, "")) && !looksLikeIdentifier(text);

function collectStringUnits(node, out) {
  if (!node || typeof node !== "object") return;
  if (node.stringUnit && typeof node.stringUnit.value === "string") out.push(node.stringUnit.value);
  for (const [k, v] of Object.entries(node)) if (k !== "stringUnit" && v && typeof v === "object") collectStringUnits(v, out);
}

export function extractXcstrings(src) {
  let data;
  try {
    data = JSON.parse(src);
  } catch {
    return [];
  }
  const find = finder(src);
  const source = String(data.sourceLanguage || "en").toLowerCase();
  const segs = [];
  for (const [key, entry] of Object.entries(data.strings || {})) {
    if (entry?.shouldTranslate === false) continue;
    const locs = entry?.localizations || {};
    const values = [];
    for (const l of Object.keys(locs)) if (/^en(?:[-_]|$)/i.test(l)) collectStringUnits(locs[l], values);
    if (!values.length && source.startsWith("en")) values.push(key);
    for (const v of new Set(values)) {
      const text = v.replace(FORMAT_SPEC, PH);
      if (uiText(text)) segs.push({ kind: "string", line: find(v), text, raw: v });
    }
  }
  return segs;
}

const unescapeC = (s) =>
  s
    .replace(/\\[ntr]/g, " ")
    .replace(/\\U([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\(.)/g, "$1");

export function extractStrings(src) {
  const masked = src.replace(/\r\n?/g, "\n").replace(/\/\*[\s\S]*?\*\//g, blank).replace(/^[ \t]*\/\/[^\n]*/gm, " ");
  const lineOf = lineIndex(masked);
  const segs = [];
  for (const m of masked.matchAll(/"((?:[^"\\]|\\.)*)"\s*=\s*"((?:[^"\\]|\\.)*)"\s*;/g)) {
    const text = unescapeC(m[2]).replace(FORMAT_SPEC, PH);
    if (uiText(text)) segs.push({ kind: "string", line: lineOf(m.index), text, raw: m[2] });
  }
  return segs;
}

export function extractStringsdict(src) {
  const lineOf = lineIndex(src);
  const segs = [];
  for (const m of src.matchAll(/<string>([^<]*)<\/string>/g)) {
    const v = decodeEntities(m[1]);
    if (/^\s*(?:NSString\w+|[a-z]{1,3}|%#@\w+@)\s*$/.test(v)) continue;
    const text = v.replace(FORMAT_SPEC, PH);
    if (/\p{L}{2,}/u.test(text) && uiText(text)) segs.push({ kind: "string", line: lineOf(m.index), text, raw: v });
  }
  return segs;
}

export function extractI18nJson(src) {
  let data;
  try {
    data = JSON.parse(src);
  } catch {
    return [];
  }
  const find = finder(src);
  const segs = [];
  const walk = (node, key) => {
    if (typeof node === "string") {
      if (key.startsWith("@") || key.startsWith("$")) return;
      const text = node.replace(/\{\{?\s*[\w.]+\s*\}?\}|%\{\w+\}|\{\d+\}/g, PH).replace(FORMAT_SPEC, PH);
      if (uiText(text)) segs.push({ kind: "string", line: find(node), text, raw: node });
    } else if (Array.isArray(node)) node.forEach((v) => walk(v, key));
    else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) if (!k.startsWith("@")) walk(v, k);
  };
  walk(data, "");
  return segs;
}

// ── extraction: commit messages ─────────────────────────────────────────────

export function extractCommitMessage(msg) {
  const lines = msg.replace(/\r\n?/g, "\n").split("\n");
  const scissors = lines.findIndex((l) => /^# -+ >8 -+$/.test(l));
  const kept = (scissors >= 0 ? lines.slice(0, scissors) : lines).map((l) => (/^#(?:\s|$)/.test(l) ? "" : l));
  // Trailers (Co-Authored-By: …) are the last paragraph when every line is Key: value.
  let end = kept.length;
  while (end > 0 && !kept[end - 1].trim()) end--;
  let start = end;
  while (start > 0 && kept[start - 1].trim()) start--;
  if (start > 0 && end > start && kept.slice(start, end).every((l) => /^[A-Za-z][\w-]*:\s+\S/.test(l)))
    for (let k = start; k < end; k++) kept[k] = "";
  const s = kept.findIndex((l) => l.trim());
  if (s < 0) return [];
  const segs = [{ kind: "subject", line: s + 1, text: kept[s].trim(), raw: kept[s] }];
  for (const seg of extractMarkdown(kept.slice(s + 1).join("\n"))) segs.push({ ...seg, line: seg.line + s + 1 });
  return segs;
}

export function readGitLog(spec, cwd) {
  const args = ["log", "--no-merges", "--format=%h%x1f%B%x1e"];
  if (/^\d+$/.test(spec)) args.push("-n", spec);
  else args.push(spec);
  const out = execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  return out
    .split("\x1e")
    .map((r) => r.replace(/^\n+/, ""))
    .filter((r) => r.includes("\x1f"))
    .map((r) => {
      const [sha, message] = r.split("\x1f");
      return { sha, message: message.trim() };
    });
}

// ── extraction: dispatch ────────────────────────────────────────────────────

const PLAIN_NAMES = /^(?:readme|changelog|changes|history|news|authors|contributing|code_of_conduct|security|support)$/i;

/** Which extractor reads this path; null when it holds no reader-facing text. */
export function extractorFor(rel) {
  const b = basename(rel);
  const ext = extname(b).toLowerCase();
  if (/^(?:COMMIT_EDITMSG|MERGE_MSG|SQUASH_MSG|TAG_EDITMSG)$/.test(b)) return "commit";
  if ([".md", ".mdx", ".markdown", ".txt", ".text", ".rst", ".adoc"].includes(ext)) return "markdown";
  if (!ext && PLAIN_NAMES.test(b)) return "markdown";
  if ([".html", ".htm", ".xhtml", ".mjml"].includes(ext)) return "html";
  if ([".astro", ".vue", ".svelte"].includes(ext)) return "template";
  if ([".tsx", ".jsx"].includes(ext)) return "jsx";
  if ([".ts", ".js", ".mjs", ".cjs", ".mts", ".cts"].includes(ext)) return "script";
  if (ext === ".swift") return "swift";
  if (ext === ".xcstrings") return "xcstrings";
  if (ext === ".strings") return "strings";
  if (ext === ".stringsdict") return "stringsdict";
  if (ext === ".arb") return "i18n";
  if (ext === ".json" && /(?:^|\/)(?:locales?|i18n|lang|langs|languages|translations?|messages|intl)\//i.test(rel)) return "i18n";
  return null;
}

export function extract(extractor, src, { ext = "", comments = false } = {}) {
  switch (extractor) {
    case "html":
      return extractHtml(src);
    case "template":
      return extractTemplate(src, ext);
    case "jsx":
      return extractScript(src, { jsx: true, comments });
    case "script":
      return extractScript(src, { jsx: false, comments });
    case "swift":
      return extractSwift(src, { comments });
    case "xcstrings":
      return extractXcstrings(src);
    case "strings":
      return extractStrings(src);
    case "stringsdict":
      return extractStringsdict(src);
    case "i18n":
      return extractI18nJson(src);
    case "commit":
      return extractCommitMessage(src);
    default:
      return extractMarkdown(src);
  }
}

// ── inline ignores ──────────────────────────────────────────────────────────
// `humanize-ignore` (this line), `humanize-ignore-next-line`,
// `humanize-ignore-start` … `humanize-ignore-end`, `humanize-ignore-file` (in
// the first 10 lines). Each may name ids: `humanize-ignore F1, W3`. Any comment
// syntax works: the marker is found in the raw line.

export function ignoreMap(src) {
  const byLine = new Map();
  const add = (ln, ids) => {
    const cur = byLine.get(ln);
    if (cur === "*") return;
    if (!ids) return void byLine.set(ln, "*");
    byLine.set(ln, new Set([...(cur || []), ...ids]));
  };
  let region = null;
  let file = false;
  src.split("\n").forEach((t, idx) => {
    const ln = idx + 1;
    if (region) add(ln, region.ids);
    const m = /humanize-ignore(-next-line|-start|-end|-file)?\b(?:[:\s]+([A-Z]{1,2}\d+(?:\s*,\s*[A-Z]{1,2}\d+)*))?/.exec(t);
    if (!m) return;
    const ids = m[2] ? m[2].split(/\s*,\s*/) : null;
    if (m[1] === "-file") file = file || idx < 10;
    else if (m[1] === "-start") {
      region = { ids };
      add(ln, ids);
    } else if (m[1] === "-end") region = null;
    else if (m[1] === "-next-line") add(ln + 1, ids);
    else add(ln, ids);
  });
  return {
    file,
    has: (ln, id) => {
      const s = byLine.get(ln);
      return s === "*" || (s instanceof Set && s.has(id));
    },
  };
}

// ── scanning ────────────────────────────────────────────────────────────────

// A hard-wrapped line that starts in lowercase continues the sentence above
// it, so a sentence-start rule does not match there.
function wrappedMidSentence(text, i) {
  let j = i;
  while (j > 0 && (text[j - 1] === " " || text[j - 1] === "\t")) j--;
  if (j === 0 || text[j - 1] !== "\n") return false;
  const c = text[i];
  return c !== c.toUpperCase() && c === c.toLowerCase();
}

function matchRule(rule, text, line) {
  const found = [];
  for (const m of text.matchAll(rule.re)) {
    if (!m[0]) continue;
    if (rule.at === "sentence-start" && wrappedMidSentence(text, m.index)) continue;
    if (rule.unlessRe) {
      const a = Math.max(0, m.index - (rule.window ?? 60));
      if (rule.unlessRe.test(text.slice(a, m.index + m[0].length + (rule.window ?? 60)))) continue;
    }
    found.push({ line: line + countNewlines(text, m.index), match: clean(m[0]), excerpt: excerpt(text, m.index, m[0].length) });
  }
  return found;
}

export function scanSegments(segs, ctx) {
  const { register, rules, cfg } = ctx;
  const words = segs.reduce((n, s) => n + countWords(s.text), 0);
  const all = [];
  for (const rule of rules.rules) {
    const tier = tierFor(rule, register, cfg, rules);
    if (tier === "off") continue;
    if (rule.ext && !rule.ext.includes(ctx.ext)) continue;
    if (rule.extractors && !rule.extractors.includes(ctx.extractor)) continue;
    if (rule.minWords && words < rule.minWords) continue;
    let found = [];
    if (rule.check) found = CHECKS[rule.check](segs, { ...ctx, words, rule }) || [];
    // `on: "src"` rules read the whole file once (chat-export tokens, log
    // calls), in the prose pass only.
    else if (rule.on === "src") found = ctx.srcPass ? matchRule(rule, ctx.src, 1) : [];
    else
      for (const seg of segs) {
        if (rule.in && !rule.in.includes(seg.kind)) continue;
        if (rule.notIn && rule.notIn.includes(seg.kind)) continue;
        found.push(...matchRule(rule, rule.on === "raw" ? seg.raw ?? seg.text : seg.text, seg.line));
      }
    if (!found.length) continue;
    let note;
    if (rule.density && tier !== "block") {
      const per1k = words ? (found.length / words) * 1000 : 0;
      if (found.length < (rule.density.min ?? 1) || per1k <= (rule.density.per1000 ?? 0)) continue;
      note = `${found.length}× in ${words} words, ${round(per1k, 1)} per 1,000 (limit ${rule.density.per1000})`;
    }
    for (const f of found)
      all.push({ id: rule.id, family: rule.family, kind: rule.kind, name: rule.name, tier, fix: rule.fix, ...f, note: f.note ?? note });
  }
  // One hit per rule, line and phrase; `count` says how often it occurs there.
  const seen = new Map();
  const hits = all.filter((h) => {
    const k = `${h.id}\0${h.line}\0${h.match.toLowerCase()}`;
    const first = seen.get(k);
    if (first) {
      first.count = (first.count ?? 1) + 1;
      return false;
    }
    seen.set(k, h);
    return true;
  });
  return { hits, words };
}

/** Extract and scan one unit: { src, extractor, register, ext, comments }. */
export function scanUnit(unit, { rules, cfg }) {
  const ignore = ignoreMap(unit.src);
  if (ignore.file) return { ...unit, segs: [], hits: [], words: 0, ignored: true };
  const segs = extract(unit.extractor, unit.src, unit);
  const ctx = { rules, cfg, src: unit.src, extractor: unit.extractor, ext: unit.ext ?? "" };
  const prose = segs.filter((s) => s.kind !== "comment");
  const notes = segs.filter((s) => s.kind === "comment");
  const a = scanSegments(prose, { ...ctx, register: unit.register, srcPass: true });
  const b = notes.length ? scanSegments(notes, { ...ctx, register: "comment" }) : { hits: [], words: 0 };
  const hits = [...a.hits, ...b.hits].filter((h) => !ignore.has(h.line, h.id));
  return { ...unit, segs, words: a.words + b.words, hits };
}

export function applyWaivers(hits, rel, cfg) {
  if (!cfg?.waivers?.length) return hits;
  return hits.filter((h) => {
    const w = cfg.waivers.find(
      (w) => w.rule === h.id && globMatch(w.path, rel) && (!w.text || h.excerpt.includes(w.text) || h.match.includes(w.text)),
    );
    if (w) w.used++;
    return !w;
  });
}

// ── config ──────────────────────────────────────────────────────────────────

const CONFIG_KEYS = ["paths", "exempt", "rules", "custom", "waivers"];

export const emptyConfig = () => ({ path: null, dir: null, paths: [], exempt: [], rules: {}, custom: [], waivers: [], expired: [], errors: [] });

/** Nearest .humanize.json from `dir` up to the repository root. */
export function findConfig(dir) {
  let d = resolve(dir);
  for (;;) {
    const p = resolve(d, CONFIG_NAME);
    if (existsSync(p)) return p;
    if (existsSync(resolve(d, ".git"))) return null;
    const up = dirname(d);
    if (up === d) return null;
    d = up;
  }
}

export function loadConfig(path, { today, rules }) {
  const cfg = { ...emptyConfig(), path, dir: dirname(path) };
  const err = (m) => cfg.errors.push(`${CONFIG_NAME} ${m}`);
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    err(`(${path}): ${e.message}`);
    return cfg;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    err("must be a JSON object");
    return cfg;
  }
  for (const k of Object.keys(raw)) if (!k.startsWith("$") && !CONFIG_KEYS.includes(k)) err(`${k}: unknown key; expected ${CONFIG_KEYS.join(", ")}`);
  if (raw.paths !== undefined) {
    const ok = Array.isArray(raw.paths) && raw.paths.every((p) => Array.isArray(p) && p.length === 2 && typeof p[0] === "string" && rules.registerNames.includes(p[1]));
    if (ok) cfg.paths = raw.paths;
    else err(`paths: expected [["glob", "register"], …] with a register from ${rules.registerNames.join(", ")}`);
  }
  if (raw.exempt !== undefined) {
    if (Array.isArray(raw.exempt) && raw.exempt.every((g) => typeof g === "string")) cfg.exempt = raw.exempt;
    else err("exempt: expected an array of globs");
  }
  if (raw.custom !== undefined) {
    if (!Array.isArray(raw.custom)) err("custom: expected an array of rules");
    else
      for (const r of raw.custom) {
        if (!r || typeof r.id !== "string" || !/^Q\d+$/.test(r.id)) err("custom: every project rule needs an id Q1, Q2, …");
        else if (typeof r.fix !== "string") err(`custom ${r.id}: needs "fix"`);
        else cfg.custom.push({ family: "Q", kind: "house", tier: "warn", name: r.id, ...r });
      }
  }
  const ids = new Set([...rules.rules.map((r) => r.id), ...cfg.custom.map((r) => r.id)]);
  if (raw.rules !== undefined) {
    if (!raw.rules || typeof raw.rules !== "object" || Array.isArray(raw.rules)) err("rules: expected { id: tier | { tier, registers } }");
    else {
      for (const [id, v] of Object.entries(raw.rules)) {
        if (!ids.has(id)) err(`rules: no rule ${id}`);
        else if (typeof v === "string") {
          if (!TIERS_OR_OFF.includes(v)) err(`rules.${id}: tier must be ${TIERS_OR_OFF.join(", ")}`);
        } else if (!v || typeof v !== "object") err(`rules.${id}: expected a tier or { tier, registers }`);
        else {
          if (v.tier !== undefined && !TIERS_OR_OFF.includes(v.tier)) err(`rules.${id}.tier: must be ${TIERS_OR_OFF.join(", ")}`);
          for (const [reg, t] of Object.entries(v.registers || {})) {
            if (!reg.startsWith("@") && !rules.registerNames.includes(reg)) err(`rules.${id}.registers: unknown register ${reg}`);
            if (!TIERS_OR_OFF.includes(t)) err(`rules.${id}.registers.${reg}: must be ${TIERS_OR_OFF.join(", ")}`);
          }
        }
      }
      cfg.rules = raw.rules;
    }
  }
  if (raw.waivers !== undefined) {
    if (!Array.isArray(raw.waivers)) err("waivers: expected an array");
    else
      raw.waivers.forEach((w, k) => {
        const at = `waivers[${k}]`;
        const missing = ["rule", "path", "reason", "expires"].filter((f) => typeof w?.[f] !== "string" || !w[f].trim());
        if (missing.length) return err(`${at}: missing ${missing.join(", ")} (a waiver says what, where, why and until when)`);
        if (!ids.has(w.rule)) return err(`${at}: no rule ${w.rule}`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(w.expires)) return err(`${at}: expires must be YYYY-MM-DD`);
        (w.expires < today ? cfg.expired : cfg.waivers).push({ ...w, used: 0 });
      });
  }
  return cfg;
}

// ── files ───────────────────────────────────────────────────────────────────

/** Text of a file, or null when it is binary or too large to be prose. */
export function readText(file) {
  let buf;
  try {
    if (statSync(file).size > MAX_BYTES) return null;
    buf = readFileSync(file);
  } catch {
    return null;
  }
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString("utf16le");
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    const sw = Buffer.from(buf.subarray(2, 2 + ((buf.length - 2) & ~1)));
    return sw.swap16().toString("utf16le");
  }
  if (buf.subarray(0, 8000).includes(0)) return null;
  const s = buf.toString("utf8");
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function gitRoot(dir) {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

/** Files under `dir`: git's view inside a work tree (ignored files stay out), a plain walk outside one. */
export function listFiles(dir) {
  try {
    const out = execFileSync("git", ["-C", dir, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return [...new Set(out.split("\0").filter(Boolean))].map((p) => resolve(dir, p)).filter((p) => existsSync(p));
  } catch {
    const acc = [];
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.name === ".git" || e.name === "node_modules") continue;
        const p = resolve(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.isFile()) acc.push(p);
      }
    };
    walk(dir);
    return acc;
  }
}

// ── output ──────────────────────────────────────────────────────────────────

const plural = (n, w) => `${n.toLocaleString("en-US")} ${w}${n === 1 ? "" : "s"}`;

function formatHit(file, h) {
  // Name the matched words when the excerpt around them is longer.
  const what = h.match && h.match.length <= 40 && h.excerpt.length > h.match.length + 3 ? `${h.match}: ` : "";
  const times = h.count > 1 ? ` ×${h.count}` : "";
  return `${file}:${h.line}  ${h.id} ${h.tier}${times}  ${what}"${h.excerpt}"  → ${h.fix}${h.note ? `  [${h.note}]` : ""}`;
}

function tierList(rule, rules, cfg, register) {
  if (register) return tierFor(rule, register, cfg, rules);
  const def = tierFor(rule, "prose", cfg, rules);
  const diff = rules.registerNames.map((r) => [r, tierFor(rule, r, cfg, rules)]).filter(([, t]) => t !== def);
  return def + (diff.length ? ` (${diff.map(([r, t]) => `${r}: ${t}`).join(", ")})` : "");
}

function listRules(rules, cfg, register) {
  return rules.rules
    .map((r) => `${r.id.padEnd(4)} ${r.kind.padEnd(5)} ${tierList(r, rules, cfg, register)}\n     ${r.name}: ${r.fix}`)
    .join("\n");
}

function explainRule(r, rules, cfg) {
  const { re, unlessRe, registers, ...rest } = r;
  const tiers = Object.fromEntries(rules.registerNames.map((reg) => [reg, tierFor(r, reg, cfg, rules)]));
  return JSON.stringify({ ...rest, pattern: re?.source, tiers }, null, 2);
}

/** The rule's line in references/patterns.md, with its "Leave:" cases; empty in a vendored copy. */
function catalogEntry(id) {
  try {
    const md = readFileSync(resolve(HERE, "../references/patterns.md"), "utf8");
    return new RegExp(`^\\*\\*${id.replace(/[^\w]/g, "\\$&")} [^\\n]*`, "m").exec(md)?.[0] ?? "";
  } catch {
    return "";
  }
}

function summarize(results, totals, out) {
  const rows = results
    .map((r) => {
      const c = census(r.segs);
      const k = (t) => r.hits.filter((h) => h.tier === t).length;
      return [r.label, r.register, r.words, k("block"), k("warn"), k("info"), c.sentences >= 5 ? c.sentenceCV.toFixed(2) : "-", c.dashesPer1k];
    })
    .sort((a, b) => b[3] - a[3] || b[4] - a[4] || String(a[0]).localeCompare(String(b[0])));
  const head = ["file", "register", "words", "block", "warn", "info", "sent.cv", "dash/1k"];
  const width = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const fmt = (r) => r.map((c, i) => (i < 2 ? String(c).padEnd(width[i]) : String(c).padStart(width[i]))).join("  ");
  out(fmt(head));
  for (const r of rows) out(fmt(r));
  const byRule = new Map();
  for (const r of results)
    for (const h of r.hits) {
      const e = byRule.get(h.id) ?? { n: 0, tier: h.tier, name: h.name };
      e.n++;
      if (TIER_RANK[h.tier] < TIER_RANK[e.tier]) e.tier = h.tier;
      byRule.set(h.id, e);
    }
  const top = [...byRule.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]));
  if (top.length) {
    out("");
    out("most frequent:");
    for (const [id, e] of top.slice(0, 15)) out(`  ${id.padEnd(4)} ×${String(e.n).padEnd(4)} ${e.tier.padEnd(5)} ${e.name}`);
  }
  const fams = new Map();
  for (const [id, e] of byRule) {
    const f = id.replace(/\d+$/, "");
    fams.set(f, (fams.get(f) ?? 0) + e.n);
  }
  if (fams.size) out(`by family: ${[...fams.entries()].sort().map(([f, n]) => `${f} ${n}`).join(", ")}`);
  const per1k = totals.words ? round(((totals.block + totals.warn) / totals.words) * 1000, 1) : 0;
  out(`${per1k} block+warn hits per 1,000 words`);
}

const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// ── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const o = { paths: [], stdin: false, gitLog: null, register: null, comments: false, json: false, summary: false, all: false, quiet: false, failOn: "block", only: null, max: 20, config: null, noConfig: false, list: false, explain: null, label: null, rules: RULES_PATH, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    switch (a) {
      case "--stdin":
      case "-":
        o.stdin = true;
        break;
      case "--git-log":
        o.gitLog = val();
        break;
      case "-r":
      case "--register":
        o.register = val();
        break;
      case "--comments":
        o.comments = true;
        break;
      case "--json":
        o.json = true;
        break;
      case "--summary":
        o.summary = true;
        break;
      case "--all":
        o.all = true;
        break;
      case "-q":
      case "--quiet":
        o.quiet = true;
        break;
      case "--fail-on":
        o.failOn = val();
        if (!["block", "warn"].includes(o.failOn)) throw new Error("--fail-on takes block or warn");
        break;
      case "--only":
        o.only = val().split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "--max":
        o.max = Math.max(1, parseInt(val(), 10) || 20);
        break;
      case "--config":
        o.config = val();
        break;
      case "--no-config":
        o.noConfig = true;
        break;
      case "--list-rules":
        o.list = true;
        break;
      case "--explain":
        o.explain = val();
        break;
      case "--label":
        o.label = val();
        break;
      case "--rules":
        o.rules = val();
        break;
      case "-h":
      case "--help":
        o.help = true;
        break;
      default:
        if (a.startsWith("-")) throw new Error(`unknown option ${a}`);
        o.paths.push(a);
    }
  }
  return o;
}

/** The whole CLI as a function: returns the exit code. `io` is for tests. */
export function run(argv, io = {}) {
  const out = io.out ?? ((s) => process.stdout.write(s + "\n"));
  const err = io.err ?? ((s) => process.stderr.write(s + "\n"));
  const cwd = io.cwd ?? process.cwd();
  const env = io.env ?? process.env;
  const readStdin = io.stdin ?? (() => readFileSync(0, "utf8"));
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    err(`humanize: ${e.message}\n\n${USAGE}`);
    return 2;
  }
  if (opts.help) {
    out(USAGE);
    return 0;
  }
  const today = env.HUMANIZE_TODAY || localDate();
  let data;
  let rules;
  try {
    data = JSON.parse(readFileSync(resolve(cwd, opts.rules), "utf8"));
    rules = compileRules(data);
  } catch (e) {
    err(`humanize: rules: ${e.message}`);
    return 2;
  }
  if (opts.register && !rules.registerNames.includes(opts.register)) {
    err(`humanize: unknown register "${opts.register}"; one of ${rules.registerNames.join(", ")}`);
    return 2;
  }
  const firstAbs = opts.paths.length ? resolve(cwd, opts.paths[0]) : cwd;
  const firstDir = existsSync(firstAbs) && statSync(firstAbs).isDirectory() ? firstAbs : dirname(firstAbs);
  let cfg = emptyConfig();
  const cfgPath = opts.noConfig ? null : opts.config ? resolve(cwd, opts.config) : findConfig(firstDir);
  if (cfgPath) {
    cfg = loadConfig(cfgPath, { today, rules });
    if (!cfg.errors.length && cfg.custom.length) {
      try {
        rules = compileRules(data, cfg.custom);
      } catch (e) {
        cfg.errors.push(`${CONFIG_NAME} custom: ${e.message}`);
      }
    }
    if (cfg.errors.length) {
      err(cfg.errors.map((e) => `humanize: ${e}`).join("\n"));
      return 2;
    }
  }
  if (opts.list) {
    out(listRules(rules, cfg, opts.register));
    return 0;
  }
  if (opts.explain) {
    const r = rules.byId.get(opts.explain);
    if (!r) {
      err(`humanize: no rule ${opts.explain}`);
      return 2;
    }
    out(explainRule(r, rules, cfg));
    const entry = catalogEntry(r.id);
    if (entry) out(`\n${entry}`);
    return 0;
  }
  if (opts.only) {
    const keep = new Set(opts.only);
    const sel = rules.rules.filter((r) => keep.has(r.id) || keep.has(r.family));
    if (!sel.length) {
      err(`humanize: --only ${opts.only.join(",")} matches no rule`);
      return 2;
    }
    rules = { ...rules, rules: sel };
  }
  if (!opts.stdin && !opts.gitLog && !opts.paths.length) {
    err(USAGE);
    return 2;
  }
  const root = cfg.dir ?? gitRoot(firstDir) ?? cwd;
  const units = [];
  if (opts.stdin) {
    const label = opts.label ?? "<stdin>";
    const register = opts.register ?? (opts.label ? inferRegister(label, cfg, rules) : "prose");
    const extractor = register === "commit" ? "commit" : extractorFor(label) ?? "markdown";
    units.push({ label, rel: label, src: readStdin(), register, extractor, ext: extname(label).toLowerCase(), comments: opts.comments });
  }
  if (opts.gitLog) {
    let commits;
    try {
      commits = readGitLog(opts.gitLog, firstDir);
    } catch (e) {
      err(`humanize: git log ${opts.gitLog}: ${String(e.stderr || e.message).trim()}`);
      return 2;
    }
    for (const c of commits)
      units.push({ label: `commit ${c.sha}`, rel: `commit:${c.sha}`, src: c.message, register: opts.register ?? "commit", extractor: "commit", ext: "" });
  }
  let unreadable = 0;
  for (const p of opts.paths) {
    const abs = resolve(cwd, p);
    if (!existsSync(abs)) {
      err(`humanize: no such path: ${p}`);
      return 2;
    }
    const explicit = statSync(abs).isFile();
    for (const file of explicit ? [abs] : listFiles(abs)) {
      const rel = toPosix(relative(root, file));
      if (!explicit && (isSelf(file) || isSkipped(rel, rules, cfg) || isForeignLocale(rel))) continue;
      let extractor = opts.register === "commit" ? "commit" : extractorFor(rel);
      if (!extractor) {
        if (!explicit) continue;
        extractor = "markdown";
      }
      const src = readText(file);
      if (src == null) {
        unreadable++;
        continue;
      }
      const label = toPosix(relative(cwd, file)) || basename(file);
      units.push({ label, rel, src, register: opts.register ?? inferRegister(rel, cfg, rules), extractor, ext: extname(file).toLowerCase(), comments: opts.comments });
    }
  }

  const results = units.map((u) => scanUnit(u, { rules, cfg }));
  for (const r of results) r.hits = applyWaivers(r.hits, r.rel, cfg);
  const count = (t) => results.reduce((n, r) => n + r.hits.filter((h) => h.tier === t).length, 0);
  const totals = { files: results.length, words: results.reduce((n, r) => n + r.words, 0), block: count("block"), warn: count("warn"), info: count("info") };
  const unused = cfg.waivers.filter((w) => !w.used && results.some((r) => globMatch(w.path, r.rel)));
  const failed = totals.block > 0 || (opts.failOn === "warn" && totals.warn > 0) || cfg.expired.length > 0;
  const exit = failed ? 1 : 0;

  if (opts.json) {
    out(
      JSON.stringify(
        {
          version: 1,
          today,
          root,
          config: cfg.path,
          totals,
          exit,
          files: results.map((r) => ({ file: r.label, register: r.register, extractor: r.extractor, words: r.words, ignored: !!r.ignored, census: census(r.segs), hits: r.hits })),
          waivers: { expired: cfg.expired, unused },
          unreadable,
        },
        null,
        2,
      ),
    );
    return exit;
  }

  const shown = opts.quiet ? ["block"] : opts.all ? ["block", "warn", "info"] : ["block", "warn"];
  if (opts.summary) summarize(results, totals, out);
  else
    for (const r of [...results].sort((a, b) => a.label.localeCompare(b.label))) {
      const hs = r.hits.filter((h) => shown.includes(h.tier)).sort((a, b) => a.line - b.line || TIER_RANK[a.tier] - TIER_RANK[b.tier] || a.id.localeCompare(b.id));
      const per = new Map();
      for (const h of hs) {
        const k = (per.get(h.id) ?? 0) + 1;
        per.set(h.id, k);
        if (k <= opts.max) out(formatHit(r.label, h));
      }
      for (const [id, k] of per) if (k > opts.max) out(`${r.label}  ${id}: ${k - opts.max} more (--max or --json for all)`);
    }
  for (const w of cfg.expired)
    out(`humanize: waiver EXPIRED ${w.expires}: ${w.rule} ${w.path}${w.text ? ` "${w.text}"` : ""} (${w.reason}). Fix the text, or re-read it and renew the waiver.`);
  for (const w of unused) out(`humanize: waiver unused: ${w.rule} ${w.path}${w.text ? ` "${w.text}"` : ""}. Remove it.`);
  if (unreadable) out(`humanize: skipped ${plural(unreadable, "binary or oversized file")}`);
  const parts = [`${totals.block} block`, `${totals.warn} warn`];
  if (opts.all || opts.summary) parts.push(`${totals.info} info`);
  out(`humanize: ${parts.join(", ")} in ${plural(totals.files, "file")}, ${plural(totals.words, "word")}.${failed ? " Exit 1." : ""}`);
  return exit;
}

const invoked = (() => {
  try {
    return process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (invoked) process.exitCode = run(process.argv.slice(2));

#!/usr/bin/env node
// PostToolUse hook for Write, Edit and MultiEdit. Scans the file that was just
// written and reports block-tier hits that sit in the text the edit added. It
// never blocks a write: it prints one additionalContext note (8 lines at most)
// or nothing, and stays silent on any error. HUMANIZE_HOOK=off turns it off.
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  RULES_PATH,
  applyWaivers,
  countNewlines,
  decodeEntities,
  emptyConfig,
  extractorFor,
  findConfig,
  inferRegister,
  isForeignLocale,
  isSkipped,
  loadConfig,
  loadRules,
  readText,
  scanUnit,
} from "./scan.mjs";

const SCAN = "~/.claude/skills/humanize/scripts/scan.mjs";
const SHOWN = 6;

// Agent notes, plans, ledgers and scratch files are not copy anyone else reads;
// the skill's own catalog quotes every tell on purpose.
export const SKIP_DIRS = /\/(?:\.claude|plans|memory|scratchpad|audits|fixtures|node_modules)\/|\/playbook\/skills\/humanize\/|^\/(?:private\/)?tmp\/claude-\d+\//;
const SKIP_NAMES = /(?:^|\/)(?:CLAUDE|AGENTS|GEMINI|HANDOFF|MEMORY|TODO)\.md$/i;

const toPosix = (p) => p.split(sep).join("/");
const norm = (s) => decodeEntities(String(s)).replace(/\s+/g, " ").toLowerCase();
const count = (hay, needle) => (needle ? hay.split(needle).length - 1 : 0);
const short = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function repoRoot(dir) {
  for (let d = resolve(dir); ; ) {
    if (existsSync(resolve(d, ".git"))) return d;
    const up = dirname(d);
    if (up === d) return null;
    d = up;
  }
}

/**
 * Lines the tool added and the text it added and removed. `lines` is null for
 * a new file, where every hit is new. With Claude Code's structuredPatch the
 * lines are exact; without it, the edit's new_string is located in the file.
 */
export function addedText(input, text) {
  const ti = input.tool_input ?? {};
  const resp = input.tool_response && typeof input.tool_response === "object" ? input.tool_response : {};
  const patch = Array.isArray(resp.structuredPatch) && resp.structuredPatch.length ? resp.structuredPatch : null;
  let plus = "";
  let minus = "";
  if (patch) {
    const lines = new Set();
    for (const h of patch) {
      let n = h.newStart;
      for (const l of h.lines ?? []) {
        if (l.startsWith("+")) {
          lines.add(n++);
          plus += `${l.slice(1)}\n`;
        } else if (l.startsWith("-")) minus += `${l.slice(1)}\n`;
        else if (!l.startsWith("\\")) n++;
      }
    }
    return { lines, plus, minus, exact: true };
  }
  if (input.tool_name === "Write") return { lines: null, plus: text, minus: "", exact: true };
  const lines = new Set();
  for (const e of input.tool_name === "MultiEdit" ? ti.edits ?? [] : [ti]) {
    const frag = e?.new_string ?? "";
    plus += `${frag}\n`;
    minus += `${e?.old_string ?? ""}\n`;
    if (!frag.trim()) continue;
    for (let i = text.indexOf(frag); i !== -1; i = e.replace_all ? text.indexOf(frag, i + frag.length) : -1) {
      const a = countNewlines(text, i) + 1;
      for (let k = a, z = a + countNewlines(frag); k <= z; k++) lines.add(k);
    }
  }
  return { lines, plus, minus, exact: false };
}

/** Hits on added lines whose matched text the edit added rather than kept. */
export function newHits(hits, input, text) {
  const { lines, plus, minus, exact } = addedText(input, text);
  if (!lines) return hits;
  const P = norm(plus);
  const M = norm(minus);
  return hits.filter((h) => {
    if (!lines.has(h.line)) return false;
    const k = norm(h.match);
    const added = count(P, k);
    const removed = count(M, k);
    // A match the raw text doesn't spell out (an entity, a check's census) is
    // trusted only when the patch gives exact lines.
    return added > removed || (exact && added === 0 && removed === 0);
  });
}

/** The note for one PostToolUse event, or "" when there is nothing to say. */
export function hookReport(input, { home = homedir(), env = process.env, skip = SKIP_DIRS } = {}) {
  if (env.HUMANIZE_HOOK === "off") return "";
  if (!["Write", "Edit", "MultiEdit"].includes(input?.tool_name)) return "";
  const file = input.tool_input?.file_path;
  if (typeof file !== "string" || !isAbsolute(file)) return "";
  const abs = toPosix(file);
  if (abs.startsWith(`${toPosix(home)}/.claude/`) || skip.test(abs) || SKIP_NAMES.test(abs)) return "";
  const text = readText(file);
  if (text == null) return "";

  const today = env.HUMANIZE_TODAY || new Date().toLocaleDateString("en-CA");
  let rules = loadRules();
  let cfg = emptyConfig();
  const cfgPath = findConfig(dirname(file));
  if (cfgPath) {
    const c = loadConfig(cfgPath, { today, rules });
    if (!c.errors.length) {
      cfg = c;
      if (cfg.custom.length) rules = loadRules(RULES_PATH, cfg.custom);
    }
  }
  const root = cfg.dir ?? repoRoot(dirname(file)) ?? dirname(file);
  const rel = toPosix(relative(root, file));
  if (isSkipped(rel, rules, cfg) || isForeignLocale(rel)) return "";
  const extractor = extractorFor(rel);
  if (!extractor) return "";

  const unit = { label: rel, rel, src: text, register: inferRegister(rel, cfg, rules), extractor, ext: extname(file).toLowerCase() };
  const block = scanUnit(unit, { rules, cfg }).hits.filter((h) => h.tier === "block");
  const hits = newHits(applyWaivers(block, rel, cfg), input, text).sort((a, b) => a.line - b.line || a.id.localeCompare(b.id));
  if (!hits.length) return "";

  const n = hits.length;
  const shown = n > SHOWN ? hits.slice(0, SHOWN - 1) : hits;
  return [
    `humanize: ${n} block hit${n === 1 ? "" : "s"} in the text just written to ${rel} (${unit.register} register). The write went through; rewrite these lines now unless they quote someone, name something or are legal text.`,
    ...shown.map((h) => `  ${rel}:${h.line}  ${h.id} ${h.name}: "${short(h.match, 40)}"${h.count > 1 ? ` ×${h.count}` : ""}  → ${short(h.fix, 100)}`),
    ...(n > shown.length ? [`  …and ${n - shown.length} more`] : []),
    `Full report: node ${SCAN} "${file}"`,
  ].join("\n");
}

const invoked = (() => {
  try {
    return process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (invoked) {
  try {
    const note = hookReport(JSON.parse(readFileSync(0, "utf8")));
    if (note) process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: note } })}\n`);
  } catch {
    // A hook that fails must not get in the way of the write it follows.
  }
}

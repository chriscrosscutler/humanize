// TypeSafe Jev client for humanize: questions in, calibrated answers out.
// Jev judges, code decides. The helpers at the top turn answers into yes, no
// or unsettled; everything below them talks to the API.
// Zero dependencies. The hook, the Action and pre-commit never import this file.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const JUDGE_PATH = join(HERE, "judge.json");
export const TRUST_PATH = join(HERE, "jev-trust.json");

export function loadJudge(path = JUDGE_PATH) {
  return JSON.parse(readFileSync(path, "utf8"));
}

// Trust is per probe key and per model. A missing file trusts nothing.
export function loadTrust(path = TRUST_PATH, model) {
  let data;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { model, probes: {} };
  }
  if (model && data.model !== model) return { model, probes: {} };
  return { model: data.model, probes: data.probes ?? {} };
}

export function isTrusted(trust, key) {
  return trust?.probes?.[key]?.trusted === true;
}

// A Noul probability against the yes and no thresholds.
export function settle(p, { yes = 0.7, no = 0.3 } = {}) {
  if (typeof p !== "number" || Number.isNaN(p)) return "unsettled";
  if (p >= yes) return "yes";
  if (p <= no) return "no";
  return "unsettled";
}

// For a probe with polarity "absent" the tell is present when the answer is no.
export function tellFrom(verdict, polarity = "present") {
  if (verdict === "unsettled") return "unsettled";
  const yes = verdict === "yes";
  return (polarity === "absent" ? !yes : yes) ? "tell" : "clean";
}

// The same Choice with its options in reverse order, to cancel position bias.
export function reversed(question) {
  const keys = Object.keys(question.criteria ?? {}).reverse();
  const criteria = {};
  for (const k of keys) criteria[k] = question.criteria[k];
  return { ...question, criteria };
}

// Two answers to one Choice, asked in both orders. Each option keeps the lower
// of its two probabilities. Settled only when both orders put the same option
// on top and it leads the next by at least `margin`.
export function settleChoice(fwd, rev, margin = 0.15) {
  const pf = fwd?.probabilities ?? {};
  const pr = rev?.probabilities ?? {};
  const keys = [...new Set([...Object.keys(pf), ...Object.keys(pr)])];
  const probs = {};
  for (const k of keys) probs[k] = Math.min(pf[k] ?? 0, pr[k] ?? 0);
  const rank = (p) => keys.slice().sort((a, b) => (p[b] ?? 0) - (p[a] ?? 0));
  const [tf, nf] = rank(pf);
  const [tr, nr] = rank(pr);
  const lead = (p, t, n) => (p[t] ?? 0) - (p[n] ?? 0);
  const agree = tf !== undefined && tf === tr;
  const settled = agree && lead(pf, tf, nf) >= margin && lead(pr, tr, nr) >= margin;
  return { top: agree ? tf : null, settled, probs };
}

// Options whose probability clears `min` in both orders, best first, at most `max`.
export function candidates(probs, { min = 0.15, max = 3 } = {}) {
  return Object.entries(probs)
    .filter(([, p]) => p >= min)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([k]) => k);
}

// A failed or refused call. Callers report the probe as "not checked: <code>",
// never as a no. Codes: off, no_key, http, timeout, bad_response, budget.
export class JevError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.name = "JevError";
    this.code = code;
  }
}

// ---- client (below this line) ----

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync as readFile, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

export const jevHttp = {
  fetch: (url, init) => fetch(url, init),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

// The key comes from the environment, then the macOS keychain. Never logged.
export function apiKey(env = process.env, { exec = execFileSync, platform = process.platform } = {}) {
  const fromEnv = env.TYPESAFE_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  if (platform !== "darwin") return null;
  try {
    const out = exec("security", ["find-generic-password", "-s", "TYPESAFE_API_KEY", "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    });
    return String(out).trim() || null;
  } catch {
    return null;
  }
}

export function cacheDir(env = process.env) {
  if (env.HUMANIZE_CACHE) return env.HUMANIZE_CACHE;
  return join(env.XDG_CACHE_HOME || join(homedir(), ".cache"), "humanize", "jev");
}

function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = stable(v[k]);
    return o;
  }
  return v;
}

export function cacheKey(model, state, question) {
  return createHash("sha256")
    .update(JSON.stringify(stable({ model, state, question })))
    .digest("hex");
}

const RETRIES = 4;
const TIMEOUT_MS = 30000;
const DELAY_CAP_MS = 8000;
const tokens = (v) => Math.ceil(JSON.stringify(v).length / 4);

export function createClient({
  env = process.env,
  http = jevHttp,
  judge = loadJudge(),
  model,
  budgetUsd,
  cache = true,
  cacheDir: dir,
  key,
  exec,
} = {}) {
  const useModel = model ?? env.HUMANIZE_JEV_MODEL ?? judge.model;
  const budget = budgetUsd ?? judge.budget_usd;
  const price = judge.usd_per_mtok;
  const root = dir ?? cacheDir(env);
  const totals = { usd: 0, input_tokens: 0, requests: 0, cache_hits: 0 };
  let resolved = key;

  const file = (k) => join(root, k.slice(0, 2), `${k}.json`);
  function readCache(k) {
    if (!cache) return null;
    try {
      const d = JSON.parse(readFile(file(k), "utf8"));
      return d && d.model === useModel && d.answer ? d.answer : null;
    } catch {
      return null;
    }
  }
  function writeCache(k, answer) {
    if (!cache) return;
    try {
      const f = file(k);
      mkdirSync(dirname(f), { recursive: true });
      const tmp = `${f}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
      writeFileSync(tmp, JSON.stringify({ model: useModel, answer }));
      renameSync(tmp, f);
    } catch {
      /* cache failures are ignored */
    }
  }

  async function send(body) {
    const redact = (s) => (resolved ? String(s).split(resolved).join("[key]") : String(s));
    let last = null;
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      if (attempt > 0) {
        const ra = Number(last?.retryAfter);
        const ms = Number.isFinite(ra) && last?.retryAfter != null && last.retryAfter !== ""
          ? Math.min(ra * 1000, DELAY_CAP_MS)
          : Math.min(500 * 2 ** (attempt - 1), DELAY_CAP_MS);
        await http.sleep(ms);
      }
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      try {
        const res = await http.fetch(judge.endpoint, {
          method: "POST",
          headers: { Authorization: `Bearer ${resolved}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: ctl.signal,
        });
        const text = await res.text();
        if (res.status >= 200 && res.status < 300) {
          clearTimeout(timer);
          try {
            return JSON.parse(text);
          } catch {
            throw new JevError("bad_response", "response was not JSON");
          }
        }
        last = {
          code: "http",
          msg: `HTTP ${res.status}: ${text.slice(0, 200)}`,
          retryAfter: res.headers?.get?.("retry-after") ?? null,
          retry: res.status === 429 || res.status >= 500,
        };
        if (!last.retry) break;
      } catch (e) {
        if (e instanceof JevError) throw e;
        last = ctl.signal.aborted
          ? { code: "timeout", msg: "request timed out", retry: true }
          : { code: "http", msg: `network error: ${e?.message ?? e}`, retry: true };
      } finally {
        clearTimeout(timer);
      }
    }
    throw new JevError(last.code, redact(last.msg));
  }

  async function ask({ state, questions }) {
    if (env.HUMANIZE_JEV === "0") throw new JevError("off", "Jev is switched off (HUMANIZE_JEV=0)");
    if (!resolved) resolved = apiKey(env, { exec });
    if (!resolved) throw new JevError("no_key", "no TYPESAFE_API_KEY in the environment or keychain");

    const names = Object.keys(questions);
    const answers = {};
    const cached = {};
    const misses = {};
    for (const n of names) {
      const k = cacheKey(useModel, state, questions[n]);
      const hit = readCache(k);
      if (hit && hit.type === questions[n].type) {
        answers[n] = hit;
        cached[n] = true;
        totals.cache_hits++;
      } else {
        cached[n] = false;
        misses[n] = k;
      }
    }
    const missNames = Object.keys(misses);
    let usage = { input_tokens: 0, output_tokens: 0, usd: 0 };
    if (missNames.length) {
      const est = tokens(state) * missNames.length + missNames.reduce((s, n) => s + tokens(questions[n]), 0);
      if (totals.usd + (est * price) / 1e6 > budget) {
        throw new JevError("budget", `estimated spend exceeds the $${budget} budget`);
      }
      const sent = Object.fromEntries(missNames.map((n) => [n, questions[n]]));
      const data = await send({ model: useModel, state, questions: sent });
      totals.requests++;
      for (const n of missNames) {
        const a = data?.answers?.[n];
        if (!a || a.type !== questions[n].type) {
          throw new JevError("bad_response", `answer for "${n}" is missing or has the wrong type`);
        }
      }
      const inTok = Number(data?.usage?.input_tokens) || 0;
      const outTok = Number(data?.usage?.output_tokens) || 0;
      const usd = (inTok * price) / 1e6;
      totals.usd += usd;
      totals.input_tokens += inTok;
      usage = { input_tokens: inTok, output_tokens: outTok, usd };
      for (const n of missNames) {
        answers[n] = data.answers[n];
        writeCache(misses[n], data.answers[n]);
      }
    }
    return { answers, usage, cached };
  }

  return { ask, spent: () => ({ ...totals }), model: useModel };
}

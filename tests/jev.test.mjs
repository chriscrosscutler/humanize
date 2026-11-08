import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  settle, tellFrom, reversed, settleChoice, candidates, JevError,
  createClient, apiKey, cacheKey, cacheDir,
} from "../scripts/jev.mjs";

const KEY = "sk-test-SECRET";
const judge = { endpoint: "https://x.test/v1", model: "m1", usd_per_mtok: 0.042, budget_usd: 0.05 };
const tmp = () => mkdtempSync(join(tmpdir(), "jev-"));
const NQ = { type: "noul", instructions: "q", criteria: { true: "a", false: "b" } };
const CQ = { type: "choice", instructions: "q", criteria: { a: null, b: null } };
const ans = (q, p = 0.9) => q.type === "noul" ? { type: "noul", noul: p } : { type: "choice", choice: "a", confidence: p, probabilities: { a: p, b: 1 - p } };
const reply = (status, body, headers = {}) => ({
  status, ok: status < 300,
  headers: { get: (h) => headers[h.toLowerCase()] ?? null },
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});
function fake(handler) {
  const calls = [], sleeps = [];
  return {
    calls, sleeps,
    fetch: async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return handler(calls.length, calls.at(-1)); },
    sleep: async (ms) => { sleeps.push(ms); },
  };
}
const ok = (_n, c) => reply(200, {
  answers: Object.fromEntries(Object.entries(c.body.questions).map(([k, q]) => [k, ans(q)])),
  usage: { input_tokens: 100, output_tokens: 5 },
});
const mk = (http, o = {}) => createClient({ env: {}, http, judge, key: KEY, cacheDir: tmp(), ...o });
const codeOf = async (p) => { try { await p; } catch (e) { return e; } assert.fail("did not throw"); };

test("settle truth table", () => {
  assert.equal(settle(0.7), "yes");
  assert.equal(settle(0.95), "yes");
  assert.equal(settle(0.3), "no");
  assert.equal(settle(0.05), "no");
  assert.equal(settle(0.5), "unsettled");
  assert.equal(settle(NaN), "unsettled");
  assert.equal(settle(undefined), "unsettled");
  assert.equal(settle(0.6, { yes: 0.6, no: 0.2 }), "yes");
});

test("tellFrom truth table", () => {
  assert.equal(tellFrom("yes", "present"), "tell");
  assert.equal(tellFrom("no", "present"), "clean");
  assert.equal(tellFrom("yes", "absent"), "clean");
  assert.equal(tellFrom("no", "absent"), "tell");
  assert.equal(tellFrom("unsettled", "absent"), "unsettled");
  assert.equal(tellFrom("yes"), "tell");
});

test("reversed flips option order and keeps the rest", () => {
  const r = reversed(CQ);
  assert.deepEqual(Object.keys(r.criteria), ["b", "a"]);
  assert.equal(r.instructions, "q");
  assert.deepEqual(Object.keys(CQ.criteria), ["a", "b"]);
});

test("settleChoice agreement, disagreement, margin edge", () => {
  const f = { probabilities: { a: 0.7, b: 0.2, c: 0.1 } };
  const r = { probabilities: { a: 0.6, b: 0.3, c: 0.1 } };
  const s = settleChoice(f, r);
  assert.equal(s.settled, true);
  assert.equal(s.top, "a");
  assert.equal(s.probs.a, 0.6);
  const d = settleChoice({ probabilities: { a: 0.8, b: 0.2 } }, { probabilities: { a: 0.2, b: 0.8 } });
  assert.equal(d.settled, false);
  assert.equal(d.top, null);
  const edge = settleChoice({ probabilities: { a: 0.75, b: 0.25 } }, { probabilities: { a: 0.75, b: 0.25 } }, 0.5);
  assert.equal(edge.settled, true);
  const under = settleChoice({ probabilities: { a: 0.55, b: 0.45 } }, { probabilities: { a: 0.6, b: 0.4 } });
  assert.equal(under.settled, false);
  assert.equal(under.top, "a");
});

test("candidates filters, sorts and caps", () => {
  const p = { a: 0.5, b: 0.9, c: 0.1, d: 0.3, e: 0.2 };
  assert.deepEqual(candidates(p), ["b", "a", "d"]);
  assert.deepEqual(candidates(p, { min: 0.25, max: 5 }), ["b", "a", "d"]);
  assert.deepEqual(candidates(p, { min: 0.95 }), []);
});

test("request wire shape and headers", async () => {
  const http = fake(ok);
  const c = mk(http);
  const r = await c.ask({ state: { s: "hi" }, questions: { n: NQ, c: CQ } });
  assert.equal(http.calls.length, 1);
  const h = http.calls[0].init.headers;
  assert.equal(h.Authorization, `Bearer ${KEY}`);
  assert.equal(h["Content-Type"], "application/json");
  assert.deepEqual(Object.keys(h).sort(), ["Authorization", "Content-Type"]);
  assert.equal(http.calls[0].url, judge.endpoint);
  assert.equal(http.calls[0].body.model, "m1");
  assert.equal(r.answers.n.noul, 0.9);
  assert.equal(r.usage.input_tokens, 100);
  assert.ok(Math.abs(r.usage.usd - (100 * 0.042) / 1e6) < 1e-12);
  assert.deepEqual(r.cached, { n: false, c: false });
  assert.equal(c.spent().requests, 1);
  assert.equal(c.model, "m1");
});

test("retry on 429 then success", async () => {
  const http = fake((n, c) => (n === 1 ? reply(429, "slow down") : ok(n, c)));
  const r = await mk(http).ask({ state: {}, questions: { n: NQ } });
  assert.equal(http.calls.length, 2);
  assert.equal(r.answers.n.noul, 0.9);
  assert.deepEqual(http.sleeps, [500]);
});

test("retry-after is honored and capped", async () => {
  const http = fake((n, c) => (n === 1 ? reply(429, "", { "retry-after": "3" }) : n === 2 ? reply(503, "", { "retry-after": "60" }) : ok(n, c)));
  await mk(http).ask({ state: {}, questions: { n: NQ } });
  assert.deepEqual(http.sleeps, [3000, 8000]);
});

test("backoff doubles and caps", async () => {
  const http = fake(() => reply(500, "boom"));
  await codeOf(mk(http).ask({ state: {}, questions: { n: NQ } }));
  assert.deepEqual(http.sleeps, [500, 1000, 2000, 4000]);
});

test("five failures throw http, never an answer", async () => {
  const http = fake(() => reply(500, "boom"));
  const e = await codeOf(mk(http).ask({ state: {}, questions: { n: NQ } }));
  assert.ok(e instanceof JevError);
  assert.equal(e.code, "http");
  assert.equal(http.calls.length, 5);
  assert.match(e.message, /500/);
});

test("a 400 is not retried", async () => {
  const http = fake(() => reply(400, "bad"));
  const e = await codeOf(mk(http).ask({ state: {}, questions: { n: NQ } }));
  assert.equal(e.code, "http");
  assert.equal(http.calls.length, 1);
});

test("network errors retry and end as http", async () => {
  const http = fake(() => { throw new Error("socket hang up"); });
  const e = await codeOf(mk(http).ask({ state: {}, questions: { n: NQ } }));
  assert.equal(e.code, "http");
  assert.equal(http.calls.length, 5);
});

test("the key never appears in errors, stdout or stderr", async () => {
  const out = [], err = [];
  const ow = process.stdout.write, ew = process.stderr.write;
  process.stdout.write = (s, ...a) => { out.push(String(s)); return true; };
  process.stderr.write = (s, ...a) => { err.push(String(s)); return true; };
  let e;
  try {
    const http = fake(() => reply(401, `invalid key ${KEY} and again ${KEY}`));
    e = await codeOf(mk(http).ask({ state: {}, questions: { n: NQ } }));
    const http2 = fake(() => { throw new Error(`failed with ${KEY}`); });
    var e2 = await codeOf(mk(http2).ask({ state: {}, questions: { n: NQ } }));
  } finally {
    process.stdout.write = ow;
    process.stderr.write = ew;
  }
  assert.ok(!e.message.includes(KEY));
  assert.ok(!e2.message.includes(KEY));
  assert.ok(!JSON.stringify(e).includes(KEY));
  assert.match(e.message, /\[key\]/);
  assert.ok(!out.join("").includes(KEY));
  assert.ok(!err.join("").includes(KEY));
});

test("error body is cut to 200 characters", async () => {
  const http = fake(() => reply(400, "x".repeat(1000)));
  const e = await codeOf(mk(http).ask({ state: {}, questions: { n: NQ } }));
  assert.ok(e.message.length < 260);
});

test("a cache hit makes no request and returns identical answers", async () => {
  const http = fake(ok);
  const c = mk(http, { cacheDir: tmp() });
  const a = await c.ask({ state: { s: 1 }, questions: { n: NQ, c: CQ } });
  const b = await c.ask({ state: { s: 1 }, questions: { n: NQ, c: CQ } });
  assert.equal(http.calls.length, 1);
  assert.deepEqual(b.answers, a.answers);
  assert.deepEqual(b.cached, { n: true, c: true });
  assert.deepEqual(b.usage, { input_tokens: 0, output_tokens: 0, usd: 0 });
  assert.equal(c.spent().cache_hits, 2);
});

test("a partial cache sends only the misses", async () => {
  const http = fake(ok);
  const dir = tmp();
  await mk(http, { cacheDir: dir }).ask({ state: { s: 1 }, questions: { n: NQ } });
  const r = await mk(http, { cacheDir: dir }).ask({ state: { s: 1 }, questions: { n: NQ, c: CQ } });
  assert.equal(http.calls.length, 2);
  assert.deepEqual(Object.keys(http.calls[1].body.questions), ["c"]);
  assert.deepEqual(r.cached, { n: true, c: false });
  assert.deepEqual(Object.keys(r.answers).sort(), ["c", "n"]);
});

test("a different state or model misses the cache", async () => {
  const http = fake(ok);
  const dir = tmp();
  await mk(http, { cacheDir: dir }).ask({ state: { s: 1 }, questions: { n: NQ } });
  await mk(http, { cacheDir: dir }).ask({ state: { s: 2 }, questions: { n: NQ } });
  await mk(http, { cacheDir: dir, model: "m2" }).ask({ state: { s: 1 }, questions: { n: NQ } });
  assert.equal(http.calls.length, 3);
});

test("cache: false always sends", async () => {
  const http = fake(ok);
  const c = mk(http, { cache: false });
  await c.ask({ state: {}, questions: { n: NQ } });
  await c.ask({ state: {}, questions: { n: NQ } });
  assert.equal(http.calls.length, 2);
});

test("cacheKey is stable across key order", () => {
  assert.equal(cacheKey("m", { a: 1, b: { c: 2, d: 3 } }, NQ), cacheKey("m", { b: { d: 3, c: 2 }, a: 1 }, NQ));
  assert.notEqual(cacheKey("m", { a: 1 }, NQ), cacheKey("m", { a: 2 }, NQ));
  assert.match(cacheKey("m", {}, NQ), /^[0-9a-f]{64}$/);
});

test("the budget error fires before any request", async () => {
  const http = fake(ok);
  const c = mk(http, { budgetUsd: 0.000001 });
  const e = await codeOf(c.ask({ state: { s: "x".repeat(4000) }, questions: { n: NQ } }));
  assert.equal(e.code, "budget");
  assert.equal(http.calls.length, 0);
});

test("spend accumulates toward the budget", async () => {
  const http = fake(() => reply(200, { answers: { n: ans(NQ) }, usage: { input_tokens: 1000000, output_tokens: 0 } }));
  const c = mk(http, { budgetUsd: 0.0421, cache: false });
  await c.ask({ state: {}, questions: { n: NQ } });
  assert.ok(Math.abs(c.spent().usd - 0.042) < 1e-9);
  const e = await codeOf(c.ask({ state: { s: "x".repeat(40000) }, questions: { n: NQ } }));
  assert.equal(e.code, "budget");
  assert.equal(http.calls.length, 1);
});

test("HUMANIZE_JEV=0 gives off with no request", async () => {
  const http = fake(ok);
  const c = mk(http, { env: { HUMANIZE_JEV: "0" } });
  const e = await codeOf(c.ask({ state: {}, questions: { n: NQ } }));
  assert.equal(e.code, "off");
  assert.equal(http.calls.length, 0);
});

test("no key gives no_key", async () => {
  const http = fake(ok);
  const c = createClient({ env: {}, http, judge, cacheDir: tmp(), exec: () => { throw new Error("no"); } });
  const e = await codeOf(c.ask({ state: {}, questions: { n: NQ } }));
  assert.equal(e.code, "no_key");
  assert.equal(http.calls.length, 0);
});

test("apiKey prefers env, then the keychain on darwin", () => {
  assert.equal(apiKey({ TYPESAFE_API_KEY: "  abc \n" }), "abc");
  assert.equal(apiKey({}, { platform: "darwin", exec: () => "kc-key\n" }), "kc-key");
  assert.equal(apiKey({}, { platform: "linux", exec: () => "kc-key" }), null);
  assert.equal(apiKey({}, { platform: "darwin", exec: () => { throw new Error("x"); } }), null);
});

test("cacheDir honors HUMANIZE_CACHE and XDG_CACHE_HOME", () => {
  assert.equal(cacheDir({ HUMANIZE_CACHE: "/a" }), "/a");
  assert.equal(cacheDir({ XDG_CACHE_HOME: "/x" }), join("/x", "humanize", "jev"));
});

test("a missing answer gives bad_response", async () => {
  const http = fake(() => reply(200, { answers: { n: ans(NQ) }, usage: { input_tokens: 1, output_tokens: 1 } }));
  const e = await codeOf(mk(http).ask({ state: {}, questions: { n: NQ, c: CQ } }));
  assert.equal(e.code, "bad_response");
});

test("a wrong answer type gives bad_response", async () => {
  const http = fake(() => reply(200, { answers: { n: ans(CQ) }, usage: { input_tokens: 1, output_tokens: 1 } }));
  const e = await codeOf(mk(http).ask({ state: {}, questions: { n: NQ } }));
  assert.equal(e.code, "bad_response");
});

test("a non-JSON body gives bad_response", async () => {
  const http = fake(() => reply(200, "<html>"));
  const e = await codeOf(mk(http).ask({ state: {}, questions: { n: NQ } }));
  assert.equal(e.code, "bad_response");
  assert.equal(http.calls.length, 1);
});

test("a timeout ends as timeout after retries", async () => {
  const http = {
    calls: 0,
    sleep: async () => {},
    fetch(_u, init) {
      this.calls++;
      return new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted"))));
    },
  };
  const realSet = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...a) => realSet(fn, ms === 30000 ? 1 : ms, ...a);
  let e;
  try { e = await codeOf(mk(http).ask({ state: {}, questions: { n: NQ } })); } finally { globalThis.setTimeout = realSet; }
  assert.equal(e.code, "timeout");
  assert.equal(http.calls, 5);
});

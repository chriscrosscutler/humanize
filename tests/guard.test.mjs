import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { compare, evidence, grepSnippets, literals, main, pick } from "../scripts/guard.mjs";
import { JevError, loadJudge } from "../scripts/jev.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FX = join(HERE, "fixtures", "guard");
const judge = loadJudge();
const KEYS = ["guard.supports", "guard.dropped", "evidence", "pick"];
const trust = { model: judge.model, probs: undefined, probes: Object.fromEntries(KEYS.map((k) => [k, { trusted: true }])) };
const env = {};

// A fake client. handler(name, question, state) returns a number (Noul p) or {fwd probs}.
function fake(handler) {
  const calls = [];
  return {
    calls,
    model: judge.model,
    spent: () => ({ usd: 0.0012, input_tokens: 10, requests: calls.length, cache_hits: 0 }),
    async ask({ state, questions }) {
      calls.push({ state, names: Object.keys(questions) });
      const answers = {};
      for (const [name, q] of Object.entries(questions)) {
        const r = handler(name, q, state);
        if (r instanceof Error) throw r;
        answers[name] = q.type === "noul" ? { type: "noul", noul: r } : { type: "choice", choice: Object.keys(r)[0], confidence: 1, probabilities: r };
      }
      return { answers, usage: {}, cached: false };
    },
  };
}
const names = (c) => c.calls.flatMap((x) => x.names);

test("literals normalize numbers, find urls, code, quotes and names", () => {
  const l = literals('Up to 1,000 users at $9, 50% off, 40s, 2x. See https://a.dev/x and `run --now`. Say "hello there". Ask Maria Gomez about iPhone and macOS in the USA.');
  for (const n of ["1000", "$9", "50%", "40s", "2x"]) assert.ok(l.numbers.has(n), n);
  assert.ok(l.urls.has("https://a.dev/x"));
  assert.ok(l.code.has("run --now"));
  assert.ok(l.quotes.has("hello there"));
  for (const n of ["maria gomez", "iphone", "macos", "usa"]) assert.ok(l.names.has(n), n);
  assert.ok(!l.names.has("up") && !l.names.has("see"));
  assert.deepEqual([...literals("1,000 and 1000").numbers], ["1000"]);
});

test("a planted number is a K6 block with no Jev call", async () => {
  const c = fake(() => 0.9);
  const r = await compare({ original: "The app has 3 modes. It runs offline.", rewrite: "The app has 5 modes. It runs offline.", judge, trust, client: c, env });
  const h = r.hits.find((x) => x.note === "added literal: 5");
  assert.ok(h);
  assert.equal(h.id, "K6");
  assert.equal(h.tier, "block");
  assert.equal(h.source, "code");
  assert.deepEqual(r.literals.added, ["5"]);
  assert.ok(r.literals.dropped.includes("3"));
  assert.equal(c.calls.length, 0);
});

test("up to 5 accounts becoming up to 10 accounts is caught by the literal check", async () => {
  const c = fake(() => 0.9);
  const r = await compare({ original: "Free plans include up to 5 accounts.", rewrite: "Free plans include up to 10 accounts.", judge, trust, client: c, env });
  assert.equal(r.hits.filter((h) => h.tier === "block").length, 1);
  assert.equal(r.hits[0].match, "10");
  assert.equal(c.calls.length, 0);
});

test("a changed claim with no literals is a K6 block when supports says no", async () => {
  const c = fake((name) => {
    if (name.startsWith("source_r2")) return { o2: 0.9, o1: 0.05 };
    if (name.startsWith("source_")) return { o1: 0.9, o2: 0.05 };
    if (name === "supports") return 0.12;
    return 0.05;
  });
  const r = await compare({ original: "Photos stay on your device. Sync is optional.", rewrite: "Photos stay on your device. Sync is automatic.", judge, trust, client: c, env });
  const h = r.hits.find((x) => x.source === "jev");
  assert.ok(h);
  assert.equal(h.id, "K6");
  assert.equal(h.tier, "block");
  assert.equal(h.note, "jev guard.supports p=0.12: not in the original");
  assert.equal(r.status, "ok");
  assert.ok(names(c).includes("source_r2") && names(c).includes("source_r2_rev"));
  assert.ok(!names(c).some((n) => n.startsWith("source_r1")));
});

test("two original paragraphs merged into one sentence: both sources picked, supports yes, clean", async () => {
  const c = fake((name, q, state) => {
    if (name.startsWith("source_")) return { o1: 0.5, o2: 0.5, o3: 0.01 };
    if (name === "supports") return 0.9;
    return 0.05;
  });
  const r = await compare({ original: "Backups run every night.\n\nRestores take a minute.\n\nExports use CSV.", rewrite: "Backups run every night and restores take a minute.", judge, trust, client: c, env });
  assert.deepEqual(r.hits, []);
  const sup = c.calls.find((x) => x.names.includes("supports"));
  assert.match(sup.state.source, /o1\|/);
  assert.match(sup.state.source, /o2\|/);
  assert.match(sup.state.source, /o3\|/, "a neighbour is included");
});

test("a rewrite that only cuts filler has no hits and dropped says no", async () => {
  const filler = "We are very thrilled to announce that the new release is now available to everyone today.";
  const c = fake((name) => (name === "dropped" ? 0.05 : 0.9));
  const r = await compare({ original: `Welcome! ${filler} The export tool writes CSV files.`, rewrite: "The export tool writes CSV files.", judge, trust, client: c, env });
  assert.deepEqual(r.hits, []);
  assert.deepEqual(names(c), ["dropped"]);
  assert.equal(c.calls[0].state.sentence, filler);
});

test("a dropped point that Jev confirms is a K6 warn", async () => {
  const c = fake((name) => (name === "dropped" ? 0.95 : 0.9));
  const r = await compare({ original: "Exports use CSV. Deleting a project cannot be undone by anyone at all, including the support team on duty.", rewrite: "Exports use CSV.", judge, trust, client: c, env });
  const h = r.hits.find((x) => x.source === "jev");
  assert.equal(h.name, "Dropped point");
  assert.equal(h.tier, "warn");
});

test("unchanged sentences make no request", async () => {
  const c = fake(() => 0.9);
  const t = "Backups run every night. Restores take a minute.";
  const r = await compare({ original: t, rewrite: "backups run every night. RESTORES TAKE A MINUTE.", judge, trust, client: c, env });
  assert.equal(c.calls.length, 0);
  assert.equal(r.status, "ok");
  assert.deepEqual(r.hits, []);
});

test("untrusted keys are not checked; --jev-untrusted runs them as info", async () => {
  const empty = { model: judge.model, probes: {} };
  const handler = (name) => (name.startsWith("source_") ? { o2: 0.9, o1: 0.05 } : 0.1);
  const a = fake(handler);
  const orig = "Photos stay on your device. Sync is optional.";
  const rew = "Photos stay on your device. Sync is automatic.";
  const r = await compare({ original: orig, rewrite: rew, judge, trust: empty, client: a, env });
  assert.equal(r.status, "untrusted");
  assert.equal(a.calls.length, 0);
  assert.deepEqual(r.notChecked.map((n) => n.key).sort(), ["guard.dropped", "guard.supports"]);
  const b = fake(handler);
  const r2 = await compare({ original: orig, rewrite: rew, judge, trust: empty, client: b, untrusted: true, env });
  const h = r2.hits.find((x) => x.source === "jev");
  assert.equal(h.tier, "info");
  assert.equal(h.untrusted, true);
});

test("a Jev error is never a no", async () => {
  const c = fake(() => new JevError("http", "boom"));
  const r = await compare({ original: "Sync is optional.", rewrite: "Sync is automatic.", judge, trust, client: c, env });
  assert.equal(r.status, "error");
  assert.equal(r.reason, "http");
  assert.deepEqual(r.hits, []);
  const off = await compare({ original: "Sync is optional.", rewrite: "Sync is automatic.", judge, trust, client: c, off: true, env });
  assert.equal(off.status, "off");
  const killed = await compare({ original: "Sync is optional.", rewrite: "Sync is automatic.", judge, trust, client: c, env: { HUMANIZE_JEV: "0" } });
  assert.equal(killed.status, "off");
});

test("a very long original returns too_long", async () => {
  const long = Array.from({ length: 4000 }, (_, i) => `Sentence number ${i} says something rather long about the product here.`).join(" ");
  const r = await compare({ original: long, rewrite: "Something else entirely.", judge, trust, client: fake(() => 0.5), env });
  assert.equal(r.status, "too_long");
});

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), "guard-"));
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), body);
  }
  return dir;
}

test("evidence finds a snippet and supports yes leaves no hit", async () => {
  const root = project({ "src/cache.js": "// serve from the offline cache\nexport const offline = true;\n", "landing.md": "# Notes\n\nWorks offline.\n", "pnpm-lock.yaml": "offline: yes\n" });
  const c = fake((name) => {
    if (name.startsWith("claim_")) return 0.9;
    if (name.startsWith("pick")) return { c1: 0.9 };
    return 0.9;
  });
  const text = "# Notes\n\nWorks offline.\n";
  const r = await evidence({ path: join(root, "landing.md"), text, register: "landing", root, judge, trust, client: c, env });
  assert.deepEqual(r.hits, []);
  assert.equal(r.claims.length, 1);
  assert.equal(r.claims[0].source.path, "src/cache.js");
  const pk = c.calls.find((x) => x.names.includes("pick"));
  assert.match(pk.state.snippets, /c1\| src\/cache\.js:/);
  assert.ok(!/pnpm-lock/.test(pk.state.snippets));
  assert.ok(!/landing\.md/.test(pk.state.snippets));
  assert.ok(names(c).includes("supports_c1"));
});

test("evidence with no matching file is a K2 warn and makes no supports call", async () => {
  const root = project({ "src/a.js": "export const x = 1;\n" });
  const c = fake((name) => (name.startsWith("claim_") ? 0.9 : 0.1));
  const r = await evidence({ path: "-", text: "Encrypts every backup with lattices.\n", register: "landing", root, judge, trust, client: c, env });
  assert.equal(r.hits.length, 1);
  assert.equal(r.hits[0].id, "K2");
  assert.equal(r.hits[0].tier, "warn");
  assert.equal(r.hits[0].note, "no source found, verify");
  assert.deepEqual(names(c), ["claim_s1"]);
});

test("evidence supports no on every pick is a K2 warn; other registers are skipped", async () => {
  const root = project({ "src/a.js": "// offline mode is planned\n" });
  const c = fake((name) => {
    if (name.startsWith("claim_")) return 0.9;
    if (name.startsWith("pick")) return { c1: 0.9 };
    return 0.05;
  });
  const r = await evidence({ path: "-", text: "Works offline.\n", register: "release", root, judge, trust, client: c, env });
  assert.equal(r.hits[0].id, "K2");
  const s = await evidence({ path: "-", text: "Works offline.\n", register: "docs", root, judge, trust, client: c, env });
  assert.equal(s.status, "skipped");
});

test("grepSnippets ranks by distinct terms and caps lines", () => {
  const root = project({ "a.md": "offline\n", "b.md": `${"x\n".repeat(50)}works offline always\n${"y\n".repeat(50)}` });
  const sn = grepSnippets("Works offline", root);
  assert.equal(sn[0].path, "b.md");
  assert.ok(sn[0].text.split("\n").length <= 20);
});

test("grepSnippets skips other copy: a landing page or store listing is not evidence", () => {
  const root = project({ "site/about.html": "<p>Works offline, always.</p>\n", "fastlane/metadata/en-US/description.txt": "Works offline.\n", "src/sync.ts": "// works offline: queue writes\n" });
  assert.deepEqual(grepSnippets("Works offline", root).map((s) => s.path), ["src/sync.ts"]);
  assert.equal(grepSnippets("Works offline", root, { copy: true }).length, 3);
});

test("pick returns a winner on agreement and null on disagreement", async () => {
  const agree = fake(() => ({ v1: 0.2, v2: 0.8 }));
  const r = await pick({ versions: ["Alpha one.", "Beta two."], register: "landing", judge, trust, client: agree, env });
  assert.equal(r.winner, 1);
  assert.equal(r.settled, true);
  assert.match(agree.calls[0].state.audience, /first-time visitor/);
  assert.match(agree.calls[0].state.versions, /^v1\| Alpha one\.\nv2\| Beta two\.$/);
  const split = fake((name) => (name === "clearest" ? { v1: 0.8, v2: 0.2 } : { v1: 0.2, v2: 0.8 }));
  const d = await pick({ versions: ["a", "b"], register: "nope", judge, trust, client: split, env });
  assert.equal(d.winner, null);
  assert.equal(d.settled, false);
  assert.match(split.calls[0].state.audience, /general reader/);
  const u = await pick({ versions: ["a", "b"], register: "ui", judge, trust: { probes: {} }, client: agree, env });
  assert.equal(u.winner, null);
  assert.match(u.why, /not checked: untrusted/);
});

function cli(argv, io = {}) {
  const lines = [];
  const errs = [];
  return main(argv, { out: (s) => lines.push(s), err: (s) => errs.push(s), env: {}, trust, cwd: FX, ...io }).then((code) => ({ code, out: lines.join("\n"), err: errs.join("\n") }));
}

test("CLI exit codes: 0, 1, 2, 3", async () => {
  const ok = await cli(["compare", "original.md", "rewrite-clean.md"], { jevClient: fake(() => 0.9) });
  assert.equal(ok.code, 0);
  assert.match(ok.out, /jev: ok, \$0\.0012 spent/);

  const bad = await cli(["compare", "original.md", "rewrite-planted.md"], { jevClient: fake(() => 0.9) });
  assert.equal(bad.code, 1);
  assert.match(bad.out, /rewrite-planted\.md:\d+  K6 block/);
  assert.match(bad.out, /added literal: 5/);

  const off = await cli(["compare", "original.md", "rewrite-clean.md", "--no-jev"]);
  assert.equal(off.code, 3);
  assert.match(off.out, /jev: not checked \(off\)/);

  const blockWins = await cli(["compare", "original.md", "rewrite-planted.md", "--no-jev"]);
  assert.equal(blockWins.code, 1);

  assert.equal((await cli([])).code, 2);
  assert.equal((await cli(["compare", "original.md"])).code, 2);
  assert.equal((await cli(["compare", "original.md", "missing.md"])).code, 2);
  assert.equal((await cli(["pick", "original.md", "rewrite-clean.md"])).code, 2);
  assert.equal((await cli(["compare", "original.md", "rewrite-clean.md", "--bogus"])).code, 2);
});

test("CLI evidence and pick exit 0 with the row; - reads stdin", async () => {
  const root = project({ "src/cache.js": "// offline cache\n" });
  const c = fake((name) => (name.startsWith("claim_") ? 0.9 : name.startsWith("pick") ? { c1: 0.9 } : 0.9));
  const ev = await cli(["evidence", "-", "--root", root, "--register", "landing"], { jevClient: c, stdin: () => "Works offline.\n" });
  assert.equal(ev.code, 0);
  assert.match(ev.out, /claim 1  src\/cache\.js:1/);
  const pk = await cli(["pick", "--register", "ui", "original.md", "rewrite-planted.md"], { jevClient: fake(() => ({ v1: 0.1, v2: 0.9 })) });
  assert.equal(pk.code, 0);
  assert.match(pk.out, /pick: rewrite-planted\.md/);
  const json = await cli(["compare", "-", "rewrite-clean.md", "--json"], { jevClient: fake(() => 0.9), stdin: () => "Backups run every night." });
  assert.equal(JSON.parse(json.out).status, "ok");
});

test("guard.mjs runs main when invoked through a symlink", () => {
  const dir = mkdtempSync(join(tmpdir(), "guard-link-"));
  const link = join(dir, "guard.mjs");
  symlinkSync(join(HERE, "..", "scripts", "guard.mjs"), link);
  const r = spawnSync(process.execPath, [link, "nope"], { encoding: "utf8", env: { ...process.env, HUMANIZE_JEV: "0" } });
  assert.equal(r.status, 2);
  assert.match(r.stderr + r.stdout, /usage:/);
});

test("compare: an added name counts even when it hides inside an original word", async () => {
  const r = await compare({ original: "The app provides exports to CSV.\n", rewrite: "The Pro plan provides exports to CSV.\n", judge, trust, off: true, env });
  assert.ok(r.literals.added.includes("pro"));
  const same = await compare({ original: "Sync runs on the Pro plan.\n", rewrite: "The Pro plan runs sync.\n", judge, trust, off: true, env });
  assert.ok(!same.literals.added.includes("pro"));
});

test("compare and pick never send legal text; the literal check still runs", async () => {
  const c = fake(() => ({ noul: 0.9 }));
  const r = await compare({ original: "We keep data 30 days.\n", rewrite: "We keep data 60 days.\n", register: "legal", judge, trust, client: c, untrusted: true, env });
  assert.equal(r.status, "skipped");
  assert.equal(c.calls.length, 0);
  assert.ok(r.literals.added.includes("60"));
  const byPath = await compare({ original: "We keep data.\n", rewrite: "We store data.\n", originalPath: "privacy.md", judge, trust, client: c, untrusted: true, env });
  assert.equal(byPath.status, "skipped");
  const p = await pick({ versions: ["a", "b"], register: "commit", judge, trust, client: c, env });
  assert.equal(p.winner, null);
  assert.equal(c.calls.length, 0);
});

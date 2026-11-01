// Scanner behaviour: fixtures per register, extraction per file type, path
// rules, config and waivers, and the CLI contract (exit codes, JSON shape).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as H from "../scripts/scan.mjs";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const rules = H.loadRules();
const read = (name) => readFileSync(join(FIX, name), "utf8");

/** Scan `src` as though it lived at repo path `rel`. */
function scan(src, rel, { register, comments = false, cfg = H.emptyConfig() } = {}) {
  const unit = {
    label: rel,
    rel,
    src,
    comments,
    register: register ?? H.inferRegister(rel, cfg, rules),
    extractor: H.extractorFor(rel) ?? "markdown",
    ext: extname(rel).toLowerCase(),
  };
  return H.scanUnit(unit, { rules, cfg });
}
const ids = (res, tier) => [...new Set(res.hits.filter((h) => !tier || h.tier === tier).map((h) => h.id))].sort();
const has = (res, id, tier) => res.hits.some((h) => h.id === id && (!tier || h.tier === tier));
const list = (s) => s.split(" ").filter(Boolean).sort();

/** Run the CLI with captured output. */
function cli(args, { stdin = "", cwd = FIX, today = "2026-10-31" } = {}) {
  const out = [];
  const err = [];
  const code = H.run(args, { out: (s) => out.push(s), err: (s) => err.push(s), cwd, env: { HUMANIZE_TODAY: today }, stdin: () => stdin });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

/** A throwaway repository with these files; removed after `fn`. */
function withRepo(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), "humanize-"));
  try {
    mkdirSync(join(dir, ".git"));
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), typeof text === "string" ? text : JSON.stringify(text));
    }
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── fixtures ────────────────────────────────────────────────────────────────

const AI = [
  // file, path it pretends to live at, exact block ids, warn ids it must include
  ["ai-landing.md", "site/index.md", "C1 C3 C8 F1 P1 P2 P3 P4 P7 P9 S1 S10 S13 S4 S8 W1 W2 W3", "C4 F6"],
  ["ai-structure.md", "docs/notes.md", "C10 C3 F15", "C13 H8 P17 P18 P19 P21 P3 P9 S17 S18 S19 S20 S21 W1"],
  ["ai-structure.md", "site/notes.md", "C10 C3 F15 P16 P3 P9 S17 W1", "S22"],
  ["Hero.tsx", "src/Hero.tsx", "F1 P24 P7 W2 W3 W4", "P9 X5"],
  ["ContentView.swift", "App/ContentView.swift", "W3", "P20 X5"],
  ["Err.swift", "App/Err.swift", "", "P20"],
  ["Localizable.strings", "App/en.lproj/Localizable.strings", "W3", "P16"],
  ["index.html", "site/index.html", "F1 P15 P16 P9 W2", ""],
  ["commit.txt", "COMMIT_EDITMSG", "X1", "X7"],
  ["chat-export.md", "docs/chat-export.md", "C7", ""],
];
for (const [file, rel, block, warn] of AI)
  test(`${file} as ${rel}`, () => {
    const res = scan(read(file), rel);
    assert.deepEqual(ids(res, "block"), list(block));
    const w = ids(res, "warn");
    for (const id of list(warn)) assert.ok(w.includes(id), `missing warn ${id}`);
  });

test("human fixtures have no block hits in any register", () => {
  for (const file of ["human-docs.md", "human-technical.md"])
    for (const register of rules.registerNames) assert.deepEqual(ids(scan(read(file), "docs/h.md", { register }), "block"), [], `${file} as ${register}`);
});

test("human fixtures have no hits at all as docs or landing", () => {
  for (const file of ["human-docs.md", "human-technical.md"])
    for (const rel of ["docs/h.md", "site/h.md"]) assert.deepEqual(ids(scan(read(file), rel)), [], `${file} as ${rel}`);
});

test("hits carry source line numbers", () => {
  const strings = scan(read("Localizable.strings"), "App/en.lproj/Localizable.strings");
  assert.deepEqual(strings.hits.map((h) => `${h.id}:${h.line}`).sort(), ["P16:6", "W3:2"]);
  const swift = scan(read("ContentView.swift"), "App/ContentView.swift");
  assert.deepEqual(swift.hits.map((h) => `${h.id}:${h.line}`).sort(), ["P20:8", "W3:4", "X5:10"]);
  assert.ok(scan(read("commit.txt"), "COMMIT_EDITMSG").hits.some((h) => h.id === "X1" && h.line === 1));
});

// ── extraction ──────────────────────────────────────────────────────────────

test("markdown: code spans and fences are not prose", () => {
  assert.deepEqual(ids(scan("Call `delve()` first.\n\n```js\nconst seamless = delve();\n```\n", "site/a.md")), []);
});

test("html: attribute text is read and the heading resumes after it", () => {
  const segs = H.extractHtml('<h2>Fast <abbr title="as soon as possible">sync</abbr> for photos</h2>\n<img alt="A cat on a sofa" src="x.png">');
  assert.deepEqual(
    segs.map((s) => [s.kind, s.text.replace(/\s+/g, " ").trim()]),
    [["heading", "Fast"], ["para", "as soon as possible"], ["heading", "sync for photos"], ["para", "A cat on a sofa"]],
  );
});

test("jsx: text and copy props are read; class names are not", () => {
  const res = scan('export const A = () => <Button className="seamless-btn" aria-label="Seamless sync">Go</Button>;\n', "src/A.tsx");
  assert.deepEqual(res.hits.map((h) => `${h.id}:${h.match.toLowerCase()}`), ["W3:seamless"]);
});

test("swift: Text literals are read; identifiers are not", () => {
  const res = scan('let seamlessMode = true\nText("Seamlessly sync your photos")\n', "App/V.swift");
  assert.deepEqual(res.hits.map((h) => `${h.id}:${h.line}`), ["W3:2"]);
});

test("strings: comments are skipped and line numbers hold", () => {
  const res = scan('/* seamless */\n// seamless\n"k" = "A seamless way to sort";\n', "App/en.lproj/Localizable.strings");
  assert.deepEqual(res.hits.map((h) => `${h.id}:${h.line}`), ["W3:3"]);
});

test("whole-file rules report once, even with comments read", () => {
  const res = scan('// Seamless helper\nexport function go() {\n  console.log("🚀 Starting sync");\n}\n', "src/go.ts", { comments: true });
  assert.equal(res.hits.filter((h) => h.id === "X5").length, 1);
});

// ── single rules ────────────────────────────────────────────────────────────

test("word rules respect word edges and their unless context", () => {
  assert.ok(!has(scan("The Old Testament list.", "site/a.md"), "P2"));
  assert.ok(has(scan("It is a testament to our team.", "site/a.md"), "P2"));
  assert.ok(!has(scan("Set delve_mode and multi-delve.", "site/a.md"), "W1"));
  assert.ok(has(scan("We delve into it.", "site/a.md"), "W1", "block"));
});

test("C6 flags template placeholders, not links", () => {
  assert.ok(has(scan("Thanks, [Your Name]", "docs/a.md"), "C6"));
  assert.ok(has(scan("Released on 2025-XX-XX.", "docs/a.md"), "C6"));
  assert.ok(!has(scan("See [Name](https://example.com) and [Link][1].", "docs/a.md"), "C6"));
});

test("F15 flags invisible characters and mixed-script look-alikes, not emoji or units", () => {
  for (const s of ["Pay with раypal.", "Ask the team​ now.", "soft­hyphen", "x⁠y", "a‍b"])
    assert.ok(has(scan(s, "docs/a.md"), "F15", "block"), JSON.stringify(s));
  for (const s of ["﻿A leading byte-order mark.", "Family 👨‍👩‍👧 and 👩🏽‍💻 render.", "5 µs and 3 μm.", "TNFα levels.", "Москва is Moscow."])
    assert.ok(!has(scan(s, "docs/a.md"), "F15"), JSON.stringify(s));
});

test("calibration: shapes that misfired on man pages, vim and perl docs stay clean", () => {
  const prose = { register: "prose" };
  const clean = [
    ["What should I put in the header file? The declarations.", "C3"],
    ["Why should I give feedback? It shapes the next release.", "C3"],
    ["If you want me to draft it, say so.", "C3"],
    ["Press CTRL-T. The result:\n\n    indented example\n", "S8"],
    ["Map the keys with langmap=ΑA,ΒB,ΨC to type Greek.", "F15"],
    ["Code 0xad is ­ SOFT HYPHEN in the table.", "F15"],
    ["Let's break the loop when the list is empty.", "P5"],
    ["In the realm of hackerdom, a patch is a fix.", "P7"],
  ];
  for (const [s, id] of clean) assert.ok(!has(scan(s, "notes.md", prose), id, "block"), `${id}: ${JSON.stringify(s)}`);
  const noted = "It should be noted that the flag is ignored.";
  assert.ok(has(scan(noted, "notes.md", prose), "P4", "warn"));
  assert.ok(has(scan(noted, "site/index.md"), "P4", "block"));
  for (const s of ["The result: a library you can search.", "The result? A library you can search."])
    assert.ok(has(scan(s, "notes.md", prose), "S8", "block"), s);
  for (const s of ["Should I continue with the next section?", "Want me to draft a shorter version?"])
    assert.ok(has(scan(s, "notes.md", prose), "C3", "block"), s);
});

test("calibration: technical literals stay clean even in landing copy", () => {
  const landing = { register: "landing" };
  const clean = [
    ["Names may contain an underscore or two underscores.", "W1"],
    ["Run the test harness from t/harness.", "W2"],
    ["Call unlock() to release the mutex, or unlock Pro in Settings.", "W2"],
    ["Each reference points to the next level of the tree.", "P9"],
    ["Forward the connection to the ultimate destination host.", "P9"],
    ["A carefully crafted set of hash keys can slow the table.", "P15"],
    ["This line doesn't really exist, you will get an error.", "S1"],
    ["It is suggested that you indent the block.", "S9"],
    ["It depends on whether you're reading or writing the file.", "S10"],
    ["The parent copies everything\nfrom the socket to standard output, while the child waits.", "S12"],
    ["Rewritten by R. P. C. Rodgers for Unix.", "S13"],
    ["Save the pad in the given context block.", "C11"],
  ];
  for (const [s, id] of clean) assert.ok(!has(scan(s, "notes.md", landing), id), `${id}: ${JSON.stringify(s)}`);
  const fire = [
    ["Take your photos to the next level.", "P9"],
    ["Carefully crafted presets for every shot.", "P15"],
    ["It doesn't just sort photos, it understands them.", "S1"],
    ["Whether you're a pro or a beginner, it works.", "S10"],
    ["Built for you.\nFrom selfies to screenshots, every photo finds a home.", "S12"],
    ["Unlock the full potential of your library.", "P7"],
  ];
  for (const [s, id] of fire) assert.ok(has(scan(s, "notes.md", landing), id, "block"), `${id}: ${JSON.stringify(s)}`);
});

test("F12 fires only where Markdown shows as typed", () => {
  const md = "**New:** faster sorting.\n\nSee [the guide](https://example.com).";
  assert.ok(has(scan(md, "fastlane/metadata/en-US/description.txt"), "F12", "block"));
  assert.ok(has(scan(md, "COMMIT_EDITMSG"), "F12", "block"));
  assert.ok(has(scan(md, "post", { register: "social" }), "F12", "block"));
  assert.ok(!has(scan(md, "launch.md", { register: "social" }), "F12"));
  assert.ok(!has(scan(md, "docs/notes.txt"), "F12"));
  assert.ok(!has(scan("Run `make`, then edit __init__.py.", "fastlane/metadata/en-US/description.txt"), "F12"));
  assert.ok(!has(scan('"k" = "**Note:** restart the app";', "App/en.lproj/Localizable.strings"), "F12"));
});

test("F9 counts a ZWJ sequence or a flag as one emoji", () => {
  assert.ok(!has(scan("The family emoji 👨‍👩‍👧 renders.", "docs/a.md"), "F9"));
  assert.ok(has(scan("Ship it 🚀🚀🚀 now.", "docs/a.md"), "F9"));
});

test("S22 flags three sentences that open on the same word, not runs of 'The'", () => {
  assert.ok(has(scan("Maybe it works. Maybe it fails. Maybe nobody notices.\n", "docs/a.md", { register: "essay" }), "S22", "warn"));
  assert.ok(!has(scan("The app opens. The list loads. The sync starts.\n", "docs/a.md", { register: "essay" }), "S22"));
});

test("legal text is capped at warn", () => {
  const res = scan("We delve into a seamless experience — always.", "site/privacy.md");
  assert.equal(res.register, "legal");
  assert.deepEqual(ids(res, "block"), []);
});

test("inline ignores silence a line, the next line, a region or the file", () => {
  const src = [
    "Seamless one. <!-- humanize-ignore -->",
    "",
    "<!-- humanize-ignore-next-line W3 -->",
    "Seamless two.",
    "",
    "Seamless three.",
    "",
    "<!-- humanize-ignore-start -->",
    "Seamless four.",
    "<!-- humanize-ignore-end -->",
    "",
    "Seamless five.",
  ].join("\n");
  assert.deepEqual(scan(src, "site/a.md").hits.filter((h) => h.id === "W3").map((h) => h.line), [6, 12]);
  assert.equal(scan("<!-- humanize-ignore-file -->\n\nSeamless.\n", "site/a.md").hits.length, 0);
});

// ── paths ───────────────────────────────────────────────────────────────────

test("registers follow the path", () => {
  const cases = {
    "site/index.html": "landing",
    "src/pages/About.astro": "landing",
    "fastlane/metadata/en-US/description.txt": "store",
    "fastlane/metadata/en-US/release_notes.txt": "release",
    "CHANGELOG.md": "release",
    "privacy.md": "legal",
    "site/terms.html": "legal",
    "src/App.tsx": "ui",
    "App/Settings.swift": "ui",
    "emails/welcome.mjml": "email",
    "docs/guide.md": "docs",
    "README.md": "docs",
    COMMIT_EDITMSG: "commit",
    ".github/pull_request_template.md": "pr",
    "x.unknown": "prose",
  };
  for (const [p, want] of Object.entries(cases)) assert.equal(H.inferRegister(p, H.emptyConfig(), rules), want, p);
});

test("foreign-locale paths are recognized; English and code paths are not", () => {
  for (const p of ["App/fr.lproj/Localizable.strings", "locales/de.json", "src/i18n/fr/home.json", "fastlane/metadata/de-DE/description.txt", "README.de.md", "content/es/about.md"])
    assert.ok(H.isForeignLocale(p), p);
  for (const p of ["src/ml/x.ts", "tests/it/x.md", "App/en.lproj/Localizable.strings", "App/Base.lproj/Main.strings", "fastlane/metadata/en-US/description.txt", "src/id.ts"])
    assert.ok(!H.isForeignLocale(p), p);
});

test("generated, vendored, test and agent files are skipped", () => {
  for (const p of ["node_modules/x/README.md", "dist/index.html", "Pods/X/README.md", "src/__tests__/a.tsx", "src/a.test.tsx", "CLAUDE.md", "docs/TODO.md", "pnpm-lock.yaml", "LICENSE", "docs/audits/humanize-2026-10-31.md"])
    assert.ok(H.isSkipped(p, rules), p);
  for (const p of ["site/index.html", "README.md", "docs/guide.md", "src/App.tsx"]) assert.ok(!H.isSkipped(p, rules), p);
});

// ── config and waivers ──────────────────────────────────────────────────────

test("config: overrides, exempt globs, custom rules and unused waivers", () =>
  withRepo(
    {
      "site/index.md": "A seamless way to sort. We delve into it. Built for Acme teams.\n",
      "site/old/legacy.md": "Seamless.\n",
      ".humanize.json": {
        exempt: ["site/old/**"],
        rules: { W1: "off" },
        custom: [{ id: "Q1", name: "Old brand name", words: ["Acme"], tier: "block", fix: "Say Capysort instead." }],
        waivers: [
          { rule: "W3", path: "site/index.md", text: "seamless", reason: "quoted from a review", expires: "2027-01-01" },
          { rule: "F1", path: "site/**", reason: "nothing to waive", expires: "2027-01-01" },
        ],
      },
    },
    (dir) => {
      const r = cli(["site", "--json"], { cwd: dir });
      const j = JSON.parse(r.out);
      assert.deepEqual(j.files.map((f) => f.file), ["site/index.md"]);
      const got = j.files[0].hits.map((h) => h.id);
      assert.ok(!got.includes("W1") && !got.includes("W3") && got.includes("Q1"), got.join(" "));
      assert.deepEqual(j.waivers.unused.map((w) => w.rule), ["F1"]);
      assert.equal(r.code, 1);
    },
  ));

test("an expired waiver fails the run and says so", () =>
  withRepo(
    {
      "docs/a.md": "Plain notes.\n",
      ".humanize.json": { waivers: [{ rule: "W3", path: "docs/a.md", reason: "launch copy", expires: "2026-01-01" }] },
    },
    (dir) => {
      const r = cli(["docs"], { cwd: dir });
      assert.equal(r.code, 1);
      assert.match(r.out, /waiver EXPIRED 2026-01-01: W3 docs\/a\.md/);
    },
  ));

test("a broken config exits 2 with the reason", () =>
  withRepo({ "docs/a.md": "Notes.\n", ".humanize.json": { rules: { ZZ1: "off" }, extra: 1 } }, (dir) => {
    const r = cli(["docs"], { cwd: dir });
    assert.equal(r.code, 2);
    assert.match(r.err, /no rule ZZ1/);
    assert.match(r.err, /extra: unknown key/);
  }));

// ── CLI ─────────────────────────────────────────────────────────────────────

test("CLI exit codes", () => {
  const stdin = (s, ...args) => cli(["--stdin", "--no-config", ...args], { stdin: s }).code;
  assert.equal(stdin("We delve into a seamless world.\n", "--label", "site/a.md"), 1);
  assert.equal(stdin(read("human-docs.md"), "--label", "site/a.md"), 0);
  assert.equal(stdin("It plays a pivotal role.\n"), 0);
  assert.equal(stdin("It plays a pivotal role.\n", "--fail-on", "warn"), 1);
  assert.equal(cli(["--bogus"]).code, 2);
  assert.equal(cli(["--stdin", "-r", "nowhere"]).code, 2);
  assert.equal(cli([]).code, 2);
  assert.equal(cli(["no/such/path"]).code, 2);
});

test("CLI --json shape", () => {
  const j = JSON.parse(cli(["--stdin", "--label", "site/a.md", "--no-config", "--json"], { stdin: "We delve deeper.\n" }).out);
  assert.deepEqual(Object.keys(j).sort(), ["config", "exit", "files", "root", "today", "totals", "unreadable", "version", "waivers"]);
  assert.deepEqual(Object.keys(j.totals).sort(), ["block", "files", "info", "warn", "words"]);
  assert.deepEqual(Object.keys(j.files[0]).sort(), ["census", "extractor", "file", "hits", "ignored", "register", "words"]);
  for (const k of ["id", "family", "kind", "name", "tier", "line", "match", "excerpt", "fix"]) assert.ok(k in j.files[0].hits[0], k);
  assert.equal(j.today, "2026-10-31");
  assert.equal(j.exit, 1);
});

test("CLI --only, --list-rules and --explain", () => {
  const only = JSON.parse(cli(["--stdin", "--label", "site/a.md", "--no-config", "--only", "F", "--json"], { stdin: "We delve — deeper.\n" }).out);
  assert.deepEqual([...new Set(only.files[0].hits.map((h) => h.family))], ["F"]);
  const listed = cli(["--list-rules", "--no-config"]).out;
  for (const r of rules.rules) assert.match(listed, new RegExp(`^${r.id} `, "m"), r.id);
  assert.equal(cli(["--explain", "F1", "--no-config"]).code, 0);
  assert.equal(cli(["--explain", "ZZ9", "--no-config"]).code, 2);
  assert.equal(cli(["--only", "ZZ9", "--stdin", "--no-config"]).code, 2);
});

test("the scanner never reports its own files", () => {
  const SCRIPTS = dirname(H.RULES_PATH);
  // Vendored at the path SOURCES.md names, a directory walk skips it; the same text elsewhere still hits.
  const usage = 'const USAGE = "Flags AI writing tells in text people read.";\n';
  withRepo({ "scripts/humanize/scan.mjs": usage, "scripts/other/cli.mjs": usage }, (dir) => {
    const r = cli(["."], { cwd: dir });
    assert.match(r.out, /scripts\/other\/cli\.mjs:1 +W4/);
    assert.doesNotMatch(r.out, /humanize\/scan\.mjs/);
  });
  // A copy at any other path skips itself by its real path, and only itself.
  withRepo({}, (dir) => {
    mkdirSync(join(dir, "tools/lint"), { recursive: true });
    for (const f of ["scan.mjs", "rules.json"]) copyFileSync(join(SCRIPTS, f), join(dir, "tools/lint", f));
    copyFileSync(join(SCRIPTS, "scan.mjs"), join(dir, "tools/lint/copy.mjs"));
    const r = spawnSync(process.execPath, [join(dir, "tools/lint/scan.mjs"), dir, "--no-config"], { encoding: "utf8" });
    assert.match(r.stdout, /tools\/lint\/copy\.mjs:\d+ +W4/);
    assert.doesNotMatch(r.stdout, /tools\/lint\/scan\.mjs/);
  });
  // No invisible characters in its source, so an explicit scan stays clean on F15.
  assert.equal(cli([join(SCRIPTS, "scan.mjs"), join(SCRIPTS, "hook.mjs"), "--no-config", "--only", "F15"]).code, 0);
});

test("S15 counts lists of three, not the tail of a longer list", () => {
  const three = "Pick red, green or blue. Ship fast, cheap and safe. Read docs, code and tests.\n";
  const four = "Pick red, green, gold or blue. Ship fast, cheap, small and safe. Read docs, code, logs and tests.\n";
  assert.equal(scan(three, "docs/a.md").hits.filter((h) => h.id === "S15").length, 3);
  assert.ok(!has(scan(four, "docs/a.md"), "S15"));
});

test("JSON-LD text is scanned at its own line; types and URLs are not", () => {
  const html = [
    "<!doctype html>",
    "<html><head><title>Tidy</title>",
    '<script type="application/ld+json">',
    '{"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": "Is Tidy AI-powered?",',
    '  "acceptedAnswer": {"@type": "Answer", "text": "It sorts by date \\u2014 and place."}}], "url": "https://example.com/AI-powered"}',
    "</script>",
    "</head><body><p>Tidy sorts by date and place.</p></body></html>",
  ].join("\n");
  const res = scan(html, "site/index.html");
  assert.deepEqual(res.hits.filter((h) => h.id === "W4").map((h) => h.line), [4]);
  // The — escape decodes to a dash.
  assert.deepEqual(res.hits.filter((h) => h.id === "F1").map((h) => h.line), [5]);
});

test("--explain prints the catalog entry with its Leave cases", () => {
  const r = cli(["--explain", "S19"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /^\*\*S19 Zinger closer\.\*\* .*Leave: /m);
});

test("a phrase repeated on one line is one hit with a count", () => {
  const line = "It is fast — and cheap — to run.\n";
  const f1 = scan(line, "site/a.md").hits.filter((h) => h.id === "F1");
  assert.equal(f1.length, 1);
  assert.equal(f1[0].count, 2);
  withRepo({ "site/a.md": line }, (dir) => {
    assert.match(cli(["site/a.md"], { cwd: dir }).out, /site\/a\.md:1 +F1 block ×2 /);
  });
});

test("S15 skips a triple that starts inside a two-word list item", () => {
  // S15 needs three triples to fire; the five-item list must not add a fourth.
  const text =
    "Open Settings and pick red, green or blue. Ship fast, cheap and safe. Read docs, code and tests. " +
    "It holds path registers, exemptions, tier overrides, project rules and waivers.\n";
  const s15 = scan(text, "docs/a.md").hits.filter((h) => h.id === "S15");
  assert.equal(s15.length, 3);
  assert.ok(!s15.some((h) => /overrides/.test(h.match)));
});

test("--github prints each hit as an annotation on its file and line", () => {
  withRepo({ "site/a, b.md": "Certainly! Sort photos — fast.\n" }, (dir) => {
    const r = cli(["--github", "site/a, b.md"], { cwd: dir });
    assert.equal(r.code, 1);
    assert.match(r.out, /^::error file=site\/a%2C b\.md,line=1,title=humanize C1::Certainly!/m);
    assert.match(r.out, /^::error file=site\/a%2C b\.md,line=1,title=humanize F1::/m);
    assert.match(r.out, /^humanize: \d+ block/m);
  });
});

test("a reader that closes the pipe early ends the scan quietly", () => {
  const scanPath = join(dirname(fileURLToPath(import.meta.url)), "../scripts/scan.mjs");
  const r = spawnSync("sh", ["-c", `"${process.execPath}" "${scanPath}" --register landing "${join(FIX, "ai-landing.md")}" | head -1`], { encoding: "utf8" });
  assert.equal(r.stderr, "");
  assert.match(r.stdout, /ai-landing\.md:1 +P7 block/);
});

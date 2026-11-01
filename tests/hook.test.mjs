// The PostToolUse hook reports block hits the edit added and stays quiet
// everywhere else.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SKIP_DIRS, hookReport } from "../scripts/hook.mjs";

const env = { HUMANIZE_TODAY: "2026-10-31" };
// The temp directory may itself sit under a skipped folder; the default skip
// list gets its own test below.
const report = (input, extra = {}) => hookReport(input, { home: "/no-home", env, skip: /^$/, ...extra });
const PAGE = "Fast sync for photos.\n\nWe delve into it — fast.\n";

function withRepo(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), "humanize-hook-"));
  try {
    mkdirSync(join(dir, ".git"));
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), text);
    }
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const ids = (note) => [...note.matchAll(/:\d+ {2}([A-Z]\d+) /g)].map((m) => m[1]);

test("a new file reports every block hit", () =>
  withRepo({ "site/index.md": PAGE }, (dir) => {
    const note = report({ tool_name: "Write", tool_input: { file_path: join(dir, "site/index.md"), content: PAGE }, tool_response: { type: "create", structuredPatch: [] } });
    assert.deepEqual(ids(note), ["F1", "W1"]);
    assert.match(note, /^humanize: 2 block hits in the text just written to site\/index\.md \(landing register\)/);
    assert.match(note, /Full report: node ~\/\.claude\/skills\/humanize\/scripts\/scan\.mjs /);
  }));

test("an edit reports only what it added (old_string and new_string)", () =>
  withRepo({ "site/index.md": PAGE }, (dir) => {
    const note = report({ tool_name: "Edit", tool_input: { file_path: join(dir, "site/index.md"), old_string: "We delve into it.", new_string: "We delve into it — fast." } });
    assert.deepEqual(ids(note), ["F1"]);
  }));

test("an edit reports only what it added (structuredPatch)", () =>
  withRepo({ "site/index.md": PAGE }, (dir) => {
    const patch = [{ oldStart: 3, oldLines: 1, newStart: 3, newLines: 1, lines: ["-We delve into it.", "+We delve into it — fast."] }];
    assert.deepEqual(ids(report({ tool_name: "Edit", tool_input: { file_path: join(dir, "site/index.md") }, tool_response: { structuredPatch: patch } })), ["F1"]);
    const same = [{ oldStart: 3, oldLines: 1, newStart: 3, newLines: 1, lines: ["-We delve into it — fast!", "+We delve into it — fast."] }];
    assert.equal(report({ tool_name: "Edit", tool_input: { file_path: join(dir, "site/index.md") }, tool_response: { structuredPatch: same } }), "");
  }));

test("MultiEdit reports hits from each edit", () =>
  withRepo({ "site/index.md": "Seamless sync for photos.\n\nWe delve into it.\n" }, (dir) => {
    const edits = [
      { old_string: "Fast sync", new_string: "Seamless sync" },
      { old_string: "We look at it.", new_string: "We delve into it." },
    ];
    assert.deepEqual(ids(report({ tool_name: "MultiEdit", tool_input: { file_path: join(dir, "site/index.md"), edits } })), ["W3", "W1"]);
  }));

test("long reports stop at eight lines", () =>
  withRepo({ "site/index.md": "Seamless. Effortless. Magic. Smart. Delve. Tapestry. Unlock — seamless.\n" }, (dir) => {
    const note = report({ tool_name: "Write", tool_input: { file_path: join(dir, "site/index.md") } });
    assert.ok(note.split("\n").length <= 8, note);
    assert.match(note, /…and \d+ more/);
  }));

test("waivers in .humanize.json hold", () =>
  withRepo(
    {
      "site/index.md": PAGE,
      ".humanize.json": JSON.stringify({ waivers: [{ rule: "F1", path: "site/index.md", reason: "brand line", expires: "2027-01-01" }] }),
    },
    (dir) => assert.deepEqual(ids(report({ tool_name: "Write", tool_input: { file_path: join(dir, "site/index.md") } })), ["W1"]),
  ));

test("quiet for warn-only registers, unknown file types, other tools and HUMANIZE_HOOK=off", () =>
  withRepo({ "README.md": PAGE, "site/index.md": PAGE, "tool.py": "print('delve — now')\n" }, (dir) => {
    const write = (rel, extra) => report({ tool_name: "Write", tool_input: { file_path: join(dir, rel) } }, extra);
    assert.equal(write("README.md"), "");
    assert.equal(write("tool.py"), "");
    assert.equal(write("site/index.md", { env: { ...env, HUMANIZE_HOOK: "off" } }), "");
    assert.equal(report({ tool_name: "Read", tool_input: { file_path: join(dir, "site/index.md") } }), "");
    assert.equal(report({ tool_name: "Write", tool_input: { file_path: "site/index.md" } }), "");
    assert.equal(report({}), "");
  }));

test("agent notes, plans and scratch files are skipped by path", () => {
  for (const p of [
    "/Users/x/.claude/plans/a.md",
    "/Users/x/repo/.claude/notes.md",
    "/Users/x/repo/docs/plans/next.md",
    "/Users/x/.claude/projects/p/memory/a.md",
    "/private/tmp/claude-501/p/s/scratchpad/draft.md",
    "/Users/x/repo/docs/audits/humanize-2026-10-31.md",
    "/Users/x/playbook/skills/humanize/references/patterns.md",
  ])
    assert.ok(SKIP_DIRS.test(p), p);
  assert.ok(!SKIP_DIRS.test("/Users/x/repo/site/index.md"));
  assert.equal(hookReport({ tool_name: "Write", tool_input: { file_path: "/Users/x/repo/CLAUDE.md" } }, { env }), "");
});

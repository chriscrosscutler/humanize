// patterns.md and rules.json describe the same rules. Every rule has a catalog
// entry and every non-judgment entry has a rule; each quoted example fires its
// rule and each quoted rewrite does not.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRules, run } from "../scripts/scan.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const md = readFileSync(join(ROOT, "references/patterns.md"), "utf8");
const rules = loadRules().rules;
const byId = new Map(rules.map((r) => [r.id, r]));
const entries = [...md.matchAll(/^\*\*([A-Z]\d+) (.+?)\.?\*\* (.*)$/gm)].map((m) => ({
  id: m[1],
  name: m[2],
  body: m[3],
  judgment: m[2].endsWith("(judgment)"),
}));

test("every rule has one catalog entry and every rule entry has a rule", () => {
  const ids = entries.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate catalog id");
  for (const r of rules) assert.ok(ids.includes(r.id), `${r.id} has no entry in patterns.md`);
  for (const e of entries) {
    if (e.judgment) assert.ok(!byId.has(e.id), `${e.id} is a scanner rule but marked (judgment)`);
    else assert.ok(byId.has(e.id), `${e.id} is in patterns.md but not in rules.json; mark it (judgment) or add the rule`);
  }
});

test("catalog names match rule names", () => {
  for (const e of entries.filter((x) => !x.judgment)) assert.equal(e.name, byId.get(e.id).name.replace(/\.$/, ""), e.id);
});

test("quoted examples fire their rule and quoted rewrites do not", () => {
  let checked = 0;
  for (const e of entries.filter((x) => !x.judgment)) {
    const r = byId.get(e.id);
    const m = e.body.match(/^"([^"]+)"(?: → "([^"]+)")?/);
    if (!m || !r.re) continue;
    const re = new RegExp(r.re.source, r.re.flags.replace("g", ""));
    assert.ok(re.test(m[1]), `${e.id} example does not fire: ${m[1]}`);
    if (m[2]) assert.ok(!re.test(m[2]), `${e.id} rewrite still fires: ${m[2]}`);
    checked++;
  }
  assert.ok(checked >= 80, `only ${checked} examples checked`);
});

test("SKILL.md names only files that exist", () => {
  const skill = readFileSync(join(ROOT, "SKILL.md"), "utf8");
  for (const [, p] of skill.matchAll(/`((?:references|scripts)\/[\w.-]+)`/g)) assert.ok(existsSync(join(ROOT, p)), p);
});

test("README.md scans clean as docs", () => {
  const out = [];
  const code = run([join(ROOT, "README.md"), "--register", "docs", "--no-config"], { out: (s) => out.push(s), err: (s) => out.push(s), cwd: ROOT });
  assert.equal(code, 0, out.join("\n"));
});

test("the plugin, marketplace, hook and package manifests agree", () => {
  const json = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
  const plugin = json(".claude-plugin/plugin.json");
  const market = json(".claude-plugin/marketplace.json");
  const pkg = json("package.json");
  assert.equal(plugin.name, "humanize");
  assert.equal(pkg.version, plugin.version, "package.json and plugin.json versions");
  assert.deepEqual(market.plugins.map((p) => [p.name, p.source]), [["humanize", "./"]]);
  assert.equal(market.plugins[0].description, plugin.description);
  const hook = json("hooks/hooks.json").hooks.PostToolUse[0];
  assert.equal(hook.matcher, "Write|Edit|MultiEdit");
  const script = hook.hooks[0].command.match(/\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./-]+)/)[1];
  assert.ok(existsSync(join(ROOT, script)), script);
  assert.ok(existsSync(join(ROOT, pkg.bin["humanize-scan"])));
  const action = readFileSync(join(ROOT, "action.yml"), "utf8");
  assert.match(action, /\$GITHUB_ACTION_PATH\/scripts\/scan\.mjs/);
  assert.match(action, /--github/);
});

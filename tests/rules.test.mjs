// rules.json is the one source the scanner, the hook and the catalog read.
// These checks keep it loadable, consistent and free of empty matches.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CHECKS, RULES_PATH, compileRules, loadRules } from "../scripts/scan.mjs";

const data = JSON.parse(readFileSync(RULES_PATH, "utf8"));
const rules = loadRules();
const names = Object.keys(data.registers);
const TIERS = ["block", "warn", "info", "off"];

test("every rule has an id, a name, a fix and exactly one matcher", () => {
  const seen = new Set();
  for (const r of data.rules) {
    assert.match(r.id, /^[CPSFHWX]\d+$/, `bad id ${r.id}`);
    assert.ok(!seen.has(r.id), `duplicate ${r.id}`);
    seen.add(r.id);
    assert.equal(r.family, r.id[0], `${r.id} family`);
    assert.ok(["tell", "house"].includes(r.kind), `${r.id} kind`);
    assert.ok(r.name, `${r.id} name`);
    assert.ok(r.fix?.length > 10, `${r.id} fix`);
    assert.equal(["words", "regex", "check"].filter((k) => k in r).length, 1, `${r.id} matcher`);
    if (r.check) assert.ok(CHECKS[r.check], `${r.id} check ${r.check}`);
  }
});

test("tiers, registers and options use known values", () => {
  for (const r of data.rules) {
    assert.ok(TIERS.includes(r.tier), `${r.id} tier`);
    for (const [reg, t] of Object.entries(r.registers ?? {})) {
      assert.ok(names.includes(reg) || ["@user", "@dev", "@all"].includes(reg), `${r.id} register ${reg}`);
      assert.ok(TIERS.includes(t), `${r.id} ${reg} tier`);
    }
    if (r.density) assert.ok(r.density.per1000 >= 0 && (r.density.min ?? 1) >= 1, `${r.id} density`);
    if (r.at) assert.ok(["line-start", "sentence-start"].includes(r.at), `${r.id} at`);
    if (r.on) assert.ok(["raw", "src"].includes(r.on), `${r.id} on`);
  }
  for (const [glob, reg] of data.paths) assert.ok(names.includes(reg), `paths ${glob} → ${reg}`);
});

test("no pattern matches empty text or a plain sentence", () => {
  for (const r of rules.rules) {
    if (!r.re) continue;
    const re = new RegExp(r.re.source, r.re.flags.replace("g", ""));
    assert.ok(!re.test(""), `${r.id} matches ""`);
    assert.ok(!re.test("The cat sat on the mat. It was warm, so it stayed until noon."), `${r.id} matches a plain sentence`);
  }
});

test("compileRules rejects malformed rules with the rule id", () => {
  const base = { id: "W99", family: "W", kind: "tell", name: "x", tier: "warn", fix: "Do the thing." };
  const bad = [
    [{ ...base }, /W99: needs exactly one/],
    [{ ...base, words: ["a"], regex: "b" }, /W99: needs exactly one/],
    [{ ...base, words: [] }, /W99: words must be/],
    [{ ...base, regex: "(" }, /W99: /],
    [{ ...base, regex: "a", tier: "loud" }, /W99: tier/],
    [{ ...base, regex: "a", registers: { nowhere: "warn" } }, /W99: unknown register/],
    [{ ...base, check: "noSuchCheck" }, /W99: unknown check/],
  ];
  for (const [rule, msg] of bad) assert.throws(() => compileRules({ ...data, rules: [...data.rules, rule] }), msg);
  assert.throws(() => compileRules({ ...data, rules: [...data.rules, { ...base, id: "W1", regex: "a" }] }), /duplicate rule id W1/);
});

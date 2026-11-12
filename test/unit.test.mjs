// Unit tests: each module on its own, with no hook process and no model.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { globToRegExp, walk } from "../lib/glob.mjs";
import { DEFAULTS, classify } from "../lib/config.mjs";
import { isEnglishProse, passages, changedPassages, useLanguage } from "../lib/extract.mjs";
import { loadCalques, instantFindings } from "../lib/instant.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "es-unit-"));
const put = (root, rel, text = "x") => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};

// Task 1: globs and the configuration

test("globToRegExp: ** spans any depth, * stays in a segment, braces give alternatives", () => {
  const md = globToRegExp("**/*.md");
  assert.ok(md.test("a/b/c.md"));
  assert.ok(md.test("c.md"));
  assert.ok(!md.test("c.mdx"));
  const code = globToRegExp("**/*.{ts,js}");
  assert.ok(code.test("src/a.ts") && code.test("a.js") && !code.test("a.py"));
  assert.ok(!globToRegExp("specs/*.json").test("specs/a/b.json"));
  assert.ok(globToRegExp("**/node_modules/**").test("x/node_modules/y/z.md"));
});

test("walk: finds what the globs name, prunes excluded and unreachable folders", () => {
  const root = tmp();
  put(root, "docs/a.md");
  put(root, "node_modules/x.md");
  put(root, "projects/p/memory/m.md");
  put(root, "projects/p/transcripts/t.md");
  const found = walk(root, ["**/*.md"], ["**/node_modules/**"]).map((p) => path.relative(root, p).replace(/\\/g, "/"));
  assert.ok(found.includes("docs/a.md"));
  assert.ok(!found.includes("node_modules/x.md"));
  const mem = walk(root, ["projects/*/memory/**/*.md"]).map((p) => path.relative(root, p).replace(/\\/g, "/"));
  assert.deepEqual(mem, ["projects/p/memory/m.md"]);
});

test("classify: kind, instruction, article, and what is out of scope", () => {
  const home = tmp();
  const env = { ENGSTICKLER_USER_HOME: home };
  const proj = tmp();
  const at = (rel) => classify(path.join(proj, rel), DEFAULTS, { root: proj, env });
  assert.equal(at("specs/x.json").kind, "json");
  assert.equal(at("CLAUDE.md").instruction, true);
  assert.equal(at("docs/guide.md").instruction, false);
  assert.equal(at("_promo/articles/a.md").article, true);
  assert.equal(at("src/x.png"), null);
  assert.equal(at("node_modules/p/README.md"), null);
  assert.equal(at("package.json"), null);
  const skill = path.join(home, ".claude", "skills", "s", "SKILL.md");
  const c = classify(skill, DEFAULTS, { env });
  assert.equal(c.instruction, true);
  const note = classify(path.join(home, ".claude", ".ai_docs", "n.md"), DEFAULTS, { env });
  assert.equal(note.instruction, false);
  assert.equal(classify(path.join(home, ".claude", "plugins", "p", "README.md"), DEFAULTS, { env }), null);
});

// Task 3: English passages

test("isEnglishProse: English sentences yes; Russian, code and short labels no", () => {
  assert.ok(isEnglishProse("A rule is approved by one of its owners."));
  assert.ok(!isEnglishProse("Правило одобряет один из его ответственных."));
  assert.ok(!isEnglishProse("npm run build"));
  assert.ok(!isEnglishProse("`const x = foo(bar)` https://example.com/a/b"));
});

test("passages: one changed paragraph of a large Markdown file is the only change", () => {
  const paras = Array.from({ length: 300 }, (_, i) => `Paragraph number ${i} says something plain about the system.`);
  const before = paras.join("\n\n");
  paras[150] = "Paragraph one hundred and fifty now says something new about the checks.";
  const changed = changedPassages(before, paras.join("\n\n"), "markdown");
  assert.equal(changed.length, 1);
  assert.match(changed[0].text, /one hundred and fifty/);
  assert.equal(changed[0].where, "line 301");
});

test("passages: Markdown lists and table rows are separate, fenced code is skipped", () => {
  const md = [
    "# Title of the page here",
    "",
    "- The first item says one thing.",
    "- The second item says another thing.",
    "",
    "```",
    "this code block has many plain words in it",
    "```",
    "",
    "| The cell holds a sentence here | and another |",
  ].join("\n");
  const texts = passages(md, "markdown").map((p) => p.text);
  assert.ok(texts.includes("- The first item says one thing."));
  assert.ok(texts.includes("- The second item says another thing."));
  assert.ok(!texts.some((t) => t.includes("code block")));
  assert.ok(texts.some((t) => t.startsWith("| The cell")));
});

test("passages: JSON gives English strings only, by JSON pointer", () => {
  const json = JSON.stringify({ nodes: [{ text: "A rule is approved by its owner.", ruText: "Правило одобряет его ответственный.", sid: "s-abc" }] });
  assert.deepEqual(passages(json, "json"), [{ where: "/nodes/0/text", text: "A rule is approved by its owner." }]);
});

test("passages: code gives its comments, not its code; broken JSON falls back to text", () => {
  const ts = [
    "// Reads the configuration from the user's folder.",
    "const value = readTheConfigurationFromTheFolder(path);",
    "/* Returns the merged settings of the user. */",
  ].join("\n");
  assert.deepEqual(
    passages(ts, "code").map((p) => p.text),
    ["Reads the configuration from the user's folder.", "Returns the merged settings of the user."],
  );
  assert.equal(passages("{ not json, but a sentence of plain words here", "json").length, 1);
});

// Task 2: the languages, their calque lists and the instant check

import { LANGUAGES_DIR, languageFile, listLanguages, languageInfo } from "../lib/languages.mjs";

const readIf = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);

const calqueHits = (text, calques) => instantFindings(text, { calques, sentenceWords: 1000, article: false }).filter((f) => f.type === "calque");
const clean = fs.readdirSync(new URL("clean/", import.meta.url)).map((f) => [f, fs.readFileSync(new URL(`clean/${f}`, import.meta.url), "utf8")]);

test("languages: each folder describes its language; its calques compile, catch their examples and flag its benchmark", () => {
  assert.ok(listLanguages().length >= 1);
  for (const code of listLanguages()) {
    const info = languageInfo(code);
    assert.equal(info?.code, code, `languages/${code}/language.json names another code`);
    assert.ok(info.name, `languages/${code}/language.json has no name`);
    const calques = loadCalques(code);
    for (const c of calques) {
      assert.doesNotThrow(() => new RegExp(c.find, "gi"), `${code}: ${c.find}`);
      if (c.example) assert.equal(calqueHits(c.example, [c]).length > 0, true, `${code}: "${c.find}" misses its example`);
      if (c.correct) assert.deepEqual(calqueHits(c.correct, [c]), [], `${code}: "${c.find}" flags its corrected sentence`);
    }
    const expect = JSON.parse(readIf(languageFile(code, "test", "expect.json")) ?? "{}");
    const key = readIf(languageFile(code, "benchmark", "key.json"));
    if (key && expect.calquesFlagBenchmarkAtLeast) {
      const flagged = JSON.parse(key).filter((k) => calqueHits(k.was, calques).length);
      assert.ok(flagged.length >= expect.calquesFlagBenchmarkAtLeast, `${code}: flagged ${flagged.length}`);
    }
  }
  assert.equal(languageInfo("xx"), null);
  assert.equal(languageInfo("../lib"), null);
});

test("languages: no calque list flags the clean English texts", () => {
  for (const code of listLanguages()) {
    const calques = loadCalques(code);
    for (const [name, text] of clean) assert.deepEqual(calqueHits(text, calques), [], `${code}: false alarms in test/clean/${name}`);
  }
});

test("languages: a language in the Latin alphabet is not taken for English, and English still is", () => {
  const english = [
    "Reads the configuration from the user's folder.",
    "This function checks whether the file exists and is valid.",
    "Install from a local folder.",
  ];
  try {
    for (const code of listLanguages()) {
      useLanguage(code);
      for (const s of english) assert.ok(isEnglishProse(s), `${code}: "${s}" not taken for English`);
      const expect = JSON.parse(readIf(languageFile(code, "test", "expect.json")) ?? "{}");
      for (const s of expect.notEnglish ?? []) assert.ok(!isEnglishProse(s), `${code}: "${s}" taken for English`);
    }
  } finally {
    useLanguage(null);
  }
});

test("languages: nothing outside languages/ names a language or a language's files", () => {
  const root = path.join(LANGUAGES_DIR, "..");
  const names = listLanguages().map((c) => languageInfo(c).name);
  const pattern = new RegExp(`languages[\\\\/](${listLanguages().join("|")})\\b|\\b(${names.join("|")})\\b|-(${listLanguages().join("|")})\\.json`);
  const files = walk(root, ["lib/**/*.mjs", "scripts/**/*.mjs", "hooks/**/*.json", "agents/**/*.md", ".claude-plugin/*.json", "package.json"]);
  for (const f of files) assert.doesNotMatch(fs.readFileSync(f, "utf8"), pattern, path.relative(root, f));
});

// Task 4: the store, and Task 5: the log

import { getBaseline, setBaseline, getSession, saveSession, newSession, markChecked, isChecked, messageKey } from "../lib/store.mjs";
import { appendErrors, warnings } from "../lib/log.mjs";
import { writeChunks } from "../lib/pending.mjs";
import { isCommit, isPush, movesHead, commitMessage, pushTarget } from "../lib/git.mjs";

test("store: baselines, sessions and checked marks round-trip; slashes do not matter", () => {
  const env = { ENGSTICKLER_HOME: tmp() };
  setBaseline("C:\\proj\\docs\\a.md", "one", 5, env);
  setBaseline("C:/proj/docs/a.md", "two", 6, env);
  const b = getBaseline("c:/proj/docs/a.md", env);
  assert.equal(b.text, "two");
  assert.equal(b.mtimeMs, 6);
  const s = newSession(env);
  s.touched.push("x");
  saveSession("id1", s, env);
  assert.deepEqual(getSession("id1", env).touched, ["x"]);
  assert.equal(isChecked("commit", messageKey("A  message\nhere"), env), false);
  markChecked("commit", messageKey("A message here"), env);
  assert.equal(isChecked("commit", messageKey("A  message\nhere"), env), true);
});

test("log: the most frequent phrase comes first in the writer's warnings", () => {
  const env = { ENGSTICKLER_HOME: tmp() };
  appendErrors([{ phrase: "at a push", correction: "on push", kind: "calque" }], { env });
  appendErrors([{ phrase: "stands in", correction: "is in", kind: "calque" }], { env });
  appendErrors([{ phrase: "At a push", correction: "when pushing", kind: "calque" }], { env });
  const lines = warnings(20, env).split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /"At a push" → "when pushing" \(calque, 2 times\)/);
  assert.equal(warnings(1, env).split("\n").length, 1);
});

test("writeChunks: instruction files go to thorough chunks; a chunk stays within its word limit", () => {
  const dir = tmp();
  const para = (n) => ({ where: `line ${n}`, text: Array.from({ length: 40 }, () => "word").join(" ") });
  const pending = [
    { path: "/p/docs/a.md", instruction: false, passages: [para(1), para(3), para(5)] },
    { path: "/p/CLAUDE.md", instruction: true, passages: [para(1)] },
  ];
  const chunks = writeChunks(pending, dir, 100);
  assert.deepEqual(chunks.map((c) => [path.basename(c.file), c.thorough, c.words]), [
    ["fast-1.md", false, 80],
    ["fast-2.md", false, 40],
    ["thorough-1.md", true, 40],
  ]);
  assert.match(fs.readFileSync(chunks[0].file, "utf8"), /^### \/p\/docs\/a\.md · line 1/);
});

// Task 6: git commands

test("commitMessage: -m values, heredocs, PowerShell here-strings, -F, and none", () => {
  const msg = (cmd, cwd) => commitMessage(cmd, cwd).message;
  assert.equal(msg('git commit -m "First line" -m "Second paragraph"'), "First line\n\nSecond paragraph");
  const heredoc = [
    "git add -A && git commit -m \"$(cat <<'EOF'",
    "Plugin: the readers run at the end of each response",
    "",
    "Details follow; with a semicolon and a | pipe.",
    "EOF",
    ")\"",
  ].join("\n");
  assert.equal(msg(heredoc), "Plugin: the readers run at the end of each response\n\nDetails follow; with a semicolon and a | pipe.");
  const ps = ["git commit -m @'", "Guide: a message written as a PowerShell here-string", "'@"].join("\n");
  assert.equal(msg(ps), "Guide: a message written as a PowerShell here-string");
  const stdinHeredoc = ["git commit -F - <<\"EOF\"", "Guide: a message read from standard input", "EOF"].join("\n");
  assert.equal(msg(stdinHeredoc), "Guide: a message read from standard input");
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "msg.txt"), "A message kept in a file.");
  assert.equal(msg("git commit -F msg.txt", dir), "A message kept in a file.");
  assert.equal(msg("git commit --amend --no-edit"), null);
  assert.equal(msg("git commit -am 'Quick fix of the guide'"), "Quick fix of the guide");
  assert.equal(msg('git commit -m"No space before the message"'), "No space before the message");
  assert.equal(msg('python -m pytest -q && git commit -m "Tests: the parser reads one call"'), "Tests: the parser reads one call");
  assert.equal(msg('git tag -m "a tag" v1 && git commit -m "Only this message counts here"'), "Only this message counts here");
  assert.deepEqual(commitMessage("git commit -F missing-file.txt", dir), { unreadable: true });
});

test("isCommit, isPush, movesHead and pushTarget: what a command line does with git", () => {
  assert.ok(isPush("git -C x push origin main"));
  assert.ok(isPush("npm test && git push"));
  assert.ok(!isPush("echo git push"));
  assert.ok(isCommit("git add . && git commit -m 'x'"));
  assert.ok(!isCommit("git log --grep commit"));
  const heredoc = "git commit -m \"$(cat <<'EOF'\nThen run git push to publish.\nEOF\n)\"";
  assert.ok(isCommit(heredoc));
  assert.ok(!isPush(heredoc));
  assert.ok(movesHead('git commit -m "x" && git push'));
  assert.ok(!movesHead("git push origin main"));
  const at = (cmd) => pushTarget(cmd, "/w/a");
  assert.deepEqual(at("git push").refs, ["HEAD"]);
  assert.deepEqual(at("git push origin develop").refs, ["develop"]);
  assert.deepEqual(at("git push -u origin feature:main").refs, ["feature"]);
  assert.deepEqual(at("git push origin --delete old-feature").refs, []);
  assert.deepEqual(at("git push origin :old-feature").refs, []);
  assert.equal(path.resolve(at("git -C ../b push").dir), path.resolve("/w/b"));
  assert.equal(path.resolve(at("cd /w/c && git push").dir), path.resolve("/w/c"));
});

test("passages: a byte-order mark before JSON, and a long block with no blank lines", () => {
  const json = "﻿" + JSON.stringify({ rules: Array.from({ length: 50 }, (_, i) => `Rule ${i} says one plain thing about the system.`) });
  const changed = JSON.parse(json.slice(1));
  changed.rules[20] = "Rule twenty now says something else about the system.";
  const out = changedPassages(json, "﻿" + JSON.stringify(changed), "json");
  assert.deepEqual(out.map((p) => p.where), ["/rules/20"]);
  const lines = Array.from({ length: 200 }, (_, i) => `Line ${i} of a long block says one plain thing.`);
  const before = lines.join("\n");
  lines[120] = "Line one hundred and twenty now says something new.";
  const md = changedPassages(before, lines.join("\n"), "markdown");
  assert.equal(md.length, 1);
  assert.equal(md[0].where, "line 121");
});

// Task 7: the readers, the manifest and the grading

import { gradeReport } from "../lib/bench.mjs";

const repoFile = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const frontmatter = (t) => Object.fromEntries([...t.split("---")[1].matchAll(/^(\w+): (.*)$/gm)].map((m) => [m[1], m[2]]));
const body = (t) => t.split("---").slice(2).join("---");

test("readers: the two bodies are identical; each runs on its own model and effort", () => {
  const fast = repoFile("agents/reader.md");
  const thorough = repoFile("agents/reader-thorough.md");
  assert.equal(body(fast), body(thorough));
  assert.deepEqual([frontmatter(fast).name, frontmatter(fast).model, frontmatter(fast).effort], ["reader", "sonnet", "high"]);
  assert.deepEqual([frontmatter(thorough).name, frontmatter(thorough).model, frontmatter(thorough).effort], ["reader-thorough", "fable", "medium"]);
});

test("manifest and hooks: the plugin is engstickler and every hook calls the one script", () => {
  assert.equal(JSON.parse(repoFile(".claude-plugin/plugin.json")).name, "engstickler");
  assert.equal(JSON.parse(repoFile(".claude-plugin/marketplace.json")).plugins[0].name, "engstickler");
  const hooks = JSON.parse(repoFile("hooks/hooks.json")).hooks;
  assert.deepEqual(Object.keys(hooks).sort(), ["PostToolUse", "PreToolUse", "SessionStart", "Stop"]);
  for (const groups of Object.values(hooks)) for (const g of groups) for (const h of g.hooks) assert.match(h.command, /scripts\/hook\.mjs" (session-start|pre-edit|post-edit|stop|pre-bash|post-bash)$/);
});

test("gradeReport: a quoted phrase in the same node and part catches the key items it is in", () => {
  const key = JSON.parse(fs.readFileSync(languageFile("ru", "benchmark", "key.json"), "utf8"));
  const report = [
    "### Node 1.6.1 · text",
    "TRANSLATION: …",
    "TWO READINGS: none",
    'LANGUAGE: - "at a push" → "on push" — calque',
  ].join("\n");
  const g = gradeReport(report, key);
  const atPush = key.map((k, i) => [k, i + 1]).filter(([k]) => k.num === "1.6.1" && k.field === "text" && /at a push/i.test(k.was));
  assert.ok(atPush.length >= 1);
  for (const [, i] of atPush) assert.ok(g.own.includes(i));
  const elsewhere = key.map((k, i) => [k, i + 1]).filter(([k]) => !(k.num === "1.6.1" && k.field === "text") && /at a push/i.test(k.was));
  for (const [, i] of elsewhere) assert.ok(g.propagated.includes(i) && !g.own.includes(i));
  assert.equal(gradeReport(report.replace('"at a push"', '"on push"'), key).own.length, 0);
});

test("instant: a long sentence is reported, except in an article; code and links are not words", () => {
  const long = Array.from({ length: 30 }, () => "word").join(" ") + ".";
  const calques = [];
  assert.equal(instantFindings(long, { calques, sentenceWords: 25, article: false }).filter((f) => f.type === "long").length, 1);
  assert.equal(instantFindings(long, { calques, sentenceWords: 25, article: true }).length, 0);
  const withCode = "Run `node scripts/es.mjs checked session-id-here` and see https://example.com/very/long/path now.";
  assert.equal(instantFindings(withCode, { calques, sentenceWords: 6, article: false }).filter((f) => f.type === "long").length, 0);
});

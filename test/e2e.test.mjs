// End-to-end tests: the hook and the command-line script run as separate processes, as Claude Code runs them,
// against a temporary git repository, a temporary home and a temporary state folder. No model is called.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(here, "..", "scripts", "hook.mjs");
const ES = path.join(here, "..", "scripts", "es.mjs");

function setup({ language = "ru" } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "es-e2e-"));
  const proj = path.join(base, "proj");
  const env = {
    ...process.env,
    ENGSTICKLER_HOME: path.join(base, "state"),
    ENGSTICKLER_USER_HOME: path.join(base, "home"),
    GIT_CONFIG_GLOBAL: path.join(base, "gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
  };
  fs.mkdirSync(path.join(proj, "docs"), { recursive: true });
  fs.mkdirSync(path.join(base, "home", ".claude"), { recursive: true });
  fs.mkdirSync(env.ENGSTICKLER_HOME, { recursive: true });
  if (language) fs.writeFileSync(path.join(env.ENGSTICKLER_HOME, "config.json"), JSON.stringify({ language }));
  fs.writeFileSync(env.GIT_CONFIG_GLOBAL, "[user]\n\tname = Test\n\temail = test@example.com\n[init]\n\tdefaultBranch = main\n");
  const git = (...args) => spawnSync("git", ["-C", proj, ...args], { env, encoding: "utf8" });
  git("init", "-q");
  const paras = Array.from({ length: 20 }, (_, i) => `Paragraph ${i} of the guide says one plain thing about the tool.`);
  fs.writeFileSync(path.join(proj, "docs", "guide.md"), paras.join("\n\n") + "\n");
  fs.writeFileSync(path.join(proj, "CLAUDE.md"), "This file tells the agent how the project is organised.\n");
  fs.writeFileSync(path.join(proj, "src.js"), "// Reads the configuration of the user.\nconst a = 1;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "Initial commit of the test project");
  return { base, proj, env, git, paras };
}

function hook(ctx, event, input) {
  const r = spawnSync(process.execPath, [HOOK, event], { input: JSON.stringify({ cwd: ctx.proj, session_id: "s1", ...input }), env: ctx.env, encoding: "utf8" });
  assert.equal(r.stderr, "", r.stderr);
  return { code: r.status, out: r.stdout ? JSON.parse(r.stdout) : null };
}

function es(ctx, args, input = "") {
  const r = spawnSync(process.execPath, [ES, ...args], { input, env: ctx.env, cwd: ctx.proj, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

// Rewrites a file the way a script would, with no Edit tool, and moves its mtime past any earlier one.
let tick = 0;
function rewrite(file, text) {
  fs.writeFileSync(file, text);
  const t = new Date(Date.now() + 5000 + ++tick * 1000);
  fs.utimesSync(file, t, t);
}

test("no language set: the session start says how to set one, and nothing is checked", () => {
  const ctx = setup({ language: null });
  const { out } = hook(ctx, "session-start", { source: "startup" });
  assert.match(out.hookSpecificOutput.additionalContext, /no language is set/);
  rewrite(path.join(ctx.proj, "docs", "guide.md"), "A paragraph nobody reads, since no language is set.\n");
  assert.equal(hook(ctx, "stop", { stop_hook_active: false }).out, null);
});

test("session start: the procedure for the agent", () => {
  const ctx = setup();
  const { out } = hook(ctx, "session-start", { source: "startup" });
  assert.match(out.hookSpecificOutput.additionalContext, /engstickler:reader/);
  assert.match(out.hookSpecificOutput.additionalContext, /Russian/);
});

test("stop: a paragraph changed by a script is sent alone; after checked the stop passes", () => {
  const ctx = setup();
  hook(ctx, "session-start", { source: "startup" });
  const guide = path.join(ctx.proj, "docs", "guide.md");
  const paras = [...ctx.paras];
  paras[7] = "Paragraph seven now explains how the readers check the English.";
  rewrite(guide, paras.join("\n\n") + "\n");
  const { out } = hook(ctx, "stop", { stop_hook_active: false });
  assert.equal(out.decision, "block");
  const chunk = out.reason.match(/- (\S+fast-1\.md)/)[1];
  const text = fs.readFileSync(chunk, "utf8");
  assert.match(text, /readers check the English/);
  assert.doesNotMatch(text, /Paragraph 6 /);
  assert.match(out.reason, /checked s1/);
  es(ctx, ["checked", "s1"]);
  assert.equal(hook(ctx, "stop", { stop_hook_active: false }).out, null);
  paras[8] = "Paragraph eight is changed again after the check was made.";
  rewrite(guide, paras.join("\n\n") + "\n");
  assert.equal(hook(ctx, "stop", { stop_hook_active: false }).out.decision, "block");
});

test("stop: the third stop in one response passes silently and accepts the last fixes", () => {
  const ctx = setup();
  hook(ctx, "session-start", { source: "startup" });
  rewrite(path.join(ctx.proj, "docs", "guide.md"), "A new first paragraph that nobody has read yet.\n");
  assert.equal(hook(ctx, "stop", { stop_hook_active: false }).out.decision, "block");
  assert.equal(hook(ctx, "stop", { stop_hook_active: true }).out.decision, "block");
  assert.equal(hook(ctx, "stop", { stop_hook_active: true }).out, null);
  assert.equal(hook(ctx, "stop", { stop_hook_active: false }).out, null);
});

test("session start: another session's unread English is never absorbed", () => {
  const ctx = setup();
  hook(ctx, "session-start", { source: "startup" });
  rewrite(path.join(ctx.proj, "docs", "guide.md"), "Session one wrote this paragraph and nobody has read it.\n");
  assert.equal(hook(ctx, "stop", { stop_hook_active: false }).out.decision, "block");
  const other = spawnSync(process.execPath, [HOOK, "session-start"], {
    input: JSON.stringify({ cwd: ctx.proj, session_id: "s2", source: "startup" }),
    env: ctx.env,
    encoding: "utf8",
  });
  assert.equal(other.status, 0);
  assert.equal(hook(ctx, "stop", { stop_hook_active: true }).out.decision, "block");
});

test("post-bash: a checkout brings in a teammate's text, which is not sent to the readers", () => {
  const ctx = setup();
  ctx.git("checkout", "-q", "-b", "teammate");
  fs.writeFileSync(path.join(ctx.proj, "docs", "team.md"), "A teammate wrote this page on another branch.\n");
  ctx.git("add", "-A");
  ctx.git("commit", "-q", "-m", "Teammate: a page of their own");
  ctx.git("checkout", "-q", "main");
  hook(ctx, "session-start", { source: "startup" });
  hook(ctx, "pre-bash", { tool_name: "Bash", tool_input: { command: "git checkout teammate" } });
  ctx.git("checkout", "-q", "teammate");
  hook(ctx, "post-bash", { tool_name: "Bash", tool_input: { command: "git checkout teammate" } });
  assert.equal(hook(ctx, "stop", { stop_hook_active: false }).out, null);
});

test("stop: a copied file and files git ignores are not sent to the readers", () => {
  const ctx = setup();
  fs.writeFileSync(path.join(ctx.proj, ".gitignore"), "cache/\n");
  hook(ctx, "session-start", { source: "startup" });
  const copy = path.join(ctx.proj, "docs", "guide-copy.md");
  fs.copyFileSync(path.join(ctx.proj, "docs", "guide.md"), copy);
  rewrite(copy, fs.readFileSync(copy, "utf8"));
  fs.mkdirSync(path.join(ctx.proj, "cache"), { recursive: true });
  rewrite(path.join(ctx.proj, "cache", "README.md"), "A tool wrote this cache file and nobody has read it.\n");
  assert.equal(hook(ctx, "stop", { stop_hook_active: false }).out, null);
});

test("post-edit: code is read for its comments only", () => {
  const ctx = setup();
  const code = "export function collectPending({ sessionId, cwd, cfg, env = process.env, a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p }) {";
  assert.equal(hook(ctx, "post-edit", { tool_name: "Edit", tool_input: { file_path: path.join(ctx.proj, "src.js"), new_string: code } }).out, null);
});

test("stop: an instruction file goes to the thorough check; a change to code alone passes", () => {
  const ctx = setup();
  hook(ctx, "session-start", { source: "startup" });
  rewrite(path.join(ctx.proj, "src.js"), "// Reads the configuration of the user.\nconst a = 2;\n");
  assert.equal(hook(ctx, "stop", { stop_hook_active: false }).out, null);
  rewrite(path.join(ctx.proj, "CLAUDE.md"), "This file now tells the agent where every document of the project is kept.\n");
  const { out } = hook(ctx, "stop", { stop_hook_active: false });
  assert.match(out.reason, /thorough-1\.md/);
  assert.doesNotMatch(out.reason, /fast-1\.md/);
});

test("pre-edit and stop: a new file outside the project is read whole", () => {
  const ctx = setup();
  hook(ctx, "session-start", { source: "startup" });
  const other = path.join(ctx.base, "other", "notes.md");
  hook(ctx, "pre-edit", { tool_name: "Write", tool_input: { file_path: other } });
  fs.mkdirSync(path.dirname(other), { recursive: true });
  fs.writeFileSync(other, "These notes were written in this session by the agent.\n");
  const { out } = hook(ctx, "stop", { stop_hook_active: false });
  assert.match(fs.readFileSync(out.reason.match(/- (\S+fast-1\.md)/)[1], "utf8"), /written in this session/);
});

test("post-edit: a known calque and a long sentence come back to the agent at once", () => {
  const ctx = setup();
  const { out } = hook(ctx, "post-edit", {
    tool_name: "Edit",
    tool_input: { file_path: path.join(ctx.proj, "docs", "guide.md"), new_string: "The tests run at a push." },
  });
  assert.match(out.hookSpecificOutput.additionalContext, /"at a push"/);
  assert.equal(hook(ctx, "post-edit", { tool_name: "Edit", tool_input: { file_path: path.join(ctx.proj, "x.png"), new_string: "at a push" } }).out, null);
});

test("pre-bash: an unread commit message is denied, then allowed once marked", () => {
  const ctx = setup();
  const cmd = 'git commit -m "Guide: the readers check every paragraph the agent writes"';
  const { out } = hook(ctx, "pre-bash", { tool_name: "Bash", tool_input: { command: cmd } });
  assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
  es(ctx, ["checked-commit", "s1"], "Guide: the readers check every paragraph the agent writes");
  assert.equal(hook(ctx, "pre-bash", { tool_name: "Bash", tool_input: { command: cmd } }).out, null);
  assert.equal(hook(ctx, "pre-bash", { tool_name: "Bash", tool_input: { command: "git status" } }).out, null);
  const chained = hook(ctx, "pre-bash", { tool_name: "Bash", tool_input: { command: `${cmd} && git push` } }).out;
  assert.match(chained.hookSpecificOutput.permissionDecisionReason, /a command of its own/);
});

test("pre-bash: a push gets the thorough check of what it sends, then passes once marked", () => {
  const ctx = setup();
  const remote = path.join(ctx.base, "remote.git");
  spawnSync("git", ["init", "-q", "--bare", remote], { env: ctx.env });
  ctx.git("remote", "add", "origin", remote);
  ctx.git("push", "-q", "-u", "origin", "main");
  const paras = [...ctx.paras];
  paras[3] = "Paragraph three now says how a push is checked before it leaves.";
  fs.writeFileSync(path.join(ctx.proj, "docs", "guide.md"), paras.join("\n\n") + "\n");
  ctx.git("commit", "-q", "-am", "Guide: a push is checked before it leaves the machine");
  const { out } = hook(ctx, "pre-bash", { tool_name: "Bash", tool_input: { command: "git push" } });
  assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
  const chunk = out.hookSpecificOutput.permissionDecisionReason.match(/- (\S+thorough-1\.md)/)[1];
  const text = fs.readFileSync(chunk, "utf8");
  assert.match(text, /how a push is checked/);
  assert.match(text, /before it leaves the machine/);
  assert.doesNotMatch(text, /Paragraph 2 /);
  es(ctx, ["checked-push", "s1"]);
  assert.equal(hook(ctx, "pre-bash", { tool_name: "Bash", tool_input: { command: "git push" } }).out, null);
  assert.equal(hook(ctx, "pre-bash", { tool_name: "Bash", tool_input: { command: "git push origin --delete old-feature" } }).out, null);
});

test("es log and warnings: a logged error is in the next session's procedure", () => {
  const ctx = setup();
  es(ctx, ["log"], JSON.stringify([{ phrase: "stands in", correction: "is in", kind: "calque", file: "docs/guide.md", check: "fast" }]));
  assert.match(es(ctx, ["warnings"]), /"stands in" → "is in"/);
  const { out } = hook(ctx, "session-start", { source: "startup" });
  assert.match(out.hookSpecificOutput.additionalContext, /"stands in" → "is in"/);
});

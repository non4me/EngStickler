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

// Runs a command the way the agent does: the hooks before and after it, and the command's change between.
function script(ctx, file, text, command = "node fix.mjs") {
  hook(ctx, "pre-bash", { tool_name: "Bash", tool_input: { command } });
  rewrite(file, text);
  hook(ctx, "post-bash", { tool_name: "Bash", tool_input: { command } });
}

test("stop: a paragraph a script changed is sent alone; after checked the stop passes", () => {
  const ctx = setup();
  hook(ctx, "session-start", { source: "startup" });
  const guide = path.join(ctx.proj, "docs", "guide.md");
  const paras = [...ctx.paras];
  paras[7] = "Paragraph seven now explains how the readers check the English.";
  script(ctx, guide, paras.join("\n\n") + "\n");
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
  script(ctx, guide, paras.join("\n\n") + "\n");
  assert.equal(hook(ctx, "stop", { stop_hook_active: false }).out.decision, "block");
});

test("stop: text changed by hand, with no command of the agent, is not sent", () => {
  const ctx = setup();
  hook(ctx, "session-start", { source: "startup" });
  rewrite(path.join(ctx.proj, "docs", "guide.md"), "The user wrote this paragraph by hand between two responses.\n");
  assert.equal(hook(ctx, "stop", { stop_hook_active: false }).out, null);
});

test("stop: the readers run in the background; the end of a response is held back once, and its English stays unread until marked as read", () => {
  const ctx = setup();
  hook(ctx, "session-start", { source: "startup" });
  const guide = path.join(ctx.proj, "docs", "guide.md");
  const paras = [...ctx.paras];
  paras[1] = "A new second paragraph that nobody has read yet.";
  script(ctx, guide, paras.join("\n\n") + "\n");
  const first = hook(ctx, "stop", { stop_hook_active: false }).out;
  assert.equal(first.decision, "block");
  assert.match(first.reason, /in the background/);
  assert.match(first.reason, /checked s1 1\b/);
  // The agent has started the readers and ends its response: the second run of the stop hook lets the response end.
  assert.equal(hook(ctx, "stop", { stop_hook_active: true }).out, null);
  // The batch that is still being read does not hold back a later response that writes nothing new.
  assert.equal(hook(ctx, "stop", { stop_hook_active: false }).out, null);
  assert.match(es(ctx, ["pending", "s1"]), /guide\.md/);
  // New English text goes into a batch of its own; the first batch's chunk is kept for the readers still reading it.
  const firstChunk = first.reason.match(/- (\S+fast-1\.md)/)[1];
  paras[9] = "Paragraph nine was written while the first batch was being read.";
  script(ctx, guide, paras.join("\n\n") + "\n");
  const second = hook(ctx, "stop", { stop_hook_active: false }).out;
  assert.match(second.reason, /checked s1 2\b/);
  const secondChunk = second.reason.match(/- (\S+fast-1\.md)/)[1];
  assert.notEqual(secondChunk, firstChunk);
  assert.match(fs.readFileSync(firstChunk, "utf8"), /new second paragraph/);
  const text = fs.readFileSync(secondChunk, "utf8");
  assert.match(text, /while the first batch was being read/);
  assert.doesNotMatch(text, /new second paragraph/);
  es(ctx, ["checked", "s1", "1"]);
  assert.match(es(ctx, ["pending", "s1"]), /guide\.md/);
  es(ctx, ["checked", "s1", "2"]);
  assert.match(es(ctx, ["pending", "s1"]), /Nothing unread/);
});

test("stop: a sentence fixed in response to the readers' findings is read once more; a fix of that fix is accepted", () => {
  const ctx = setup();
  hook(ctx, "session-start", { source: "startup" });
  const guide = path.join(ctx.proj, "docs", "guide.md");
  const paras = [...ctx.paras];
  paras[4] = "The readers check every paragraph which the agent writes for the user.";
  script(ctx, guide, paras.join("\n\n") + "\n");
  assert.equal(hook(ctx, "stop", { stop_hook_active: false }).out.decision, "block");
  // The agent fixes the sentence the readers flagged, then marks the batch as read.
  paras[4] = "The readers check every paragraph that the agent writes for the user.";
  script(ctx, guide, paras.join("\n\n") + "\n");
  es(ctx, ["checked", "s1"]);
  const reread = hook(ctx, "stop", { stop_hook_active: false }).out;
  assert.equal(reread.decision, "block");
  assert.match(fs.readFileSync(reread.reason.match(/- (\S+fast-1\.md)/)[1], "utf8"), /that the agent writes/);
  // The fix of the fix is accepted without another reading.
  paras[4] = "The readers check each paragraph that the agent writes for the user.";
  script(ctx, guide, paras.join("\n\n") + "\n");
  es(ctx, ["checked", "s1"]);
  assert.equal(hook(ctx, "stop", { stop_hook_active: false }).out, null);
  // A new paragraph unlike any paragraph read before is read as usual.
  paras[12] = "Commit messages get their own check before the commit is made.";
  script(ctx, guide, paras.join("\n\n") + "\n");
  assert.equal(hook(ctx, "stop", { stop_hook_active: false }).out.decision, "block");
});

test("pre-bash: a commit and a push wait until every batch of the session has been marked as read", () => {
  const ctx = setup();
  hook(ctx, "session-start", { source: "startup" });
  script(ctx, path.join(ctx.proj, "docs", "guide.md"), "A paragraph whose readers have not reported yet.\n");
  assert.equal(hook(ctx, "stop", { stop_hook_active: false }).out.decision, "block");
  const msg = "Guide: a paragraph whose readers have not reported yet";
  es(ctx, ["checked-commit", "s1"], msg);
  const cmd = `git commit -am "${msg}"`;
  const denied = hook(ctx, "pre-bash", { tool_name: "Bash", tool_input: { command: cmd } }).out;
  assert.equal(denied.hookSpecificOutput.permissionDecision, "deny");
  assert.match(denied.hookSpecificOutput.permissionDecisionReason, /checked s1 1\b/);
  assert.equal(hook(ctx, "pre-bash", { tool_name: "Bash", tool_input: { command: "git push" } }).out.hookSpecificOutput.permissionDecision, "deny");
  es(ctx, ["checked", "s1", "1"]);
  assert.equal(hook(ctx, "pre-bash", { tool_name: "Bash", tool_input: { command: cmd } }).out, null);
});

test("pre-edit: another session's unread English is never absorbed", () => {
  const ctx = setup();
  hook(ctx, "session-start", { source: "startup" });
  const guide = path.join(ctx.proj, "docs", "guide.md");
  script(ctx, guide, "Session one wrote this paragraph and nobody has read it.\n");
  assert.equal(hook(ctx, "stop", { stop_hook_active: false }).out.decision, "block");
  const other = spawnSync(process.execPath, [HOOK, "pre-edit"], {
    input: JSON.stringify({ cwd: ctx.proj, session_id: "s2", tool_name: "Edit", tool_input: { file_path: guide } }),
    env: ctx.env,
    encoding: "utf8",
  });
  assert.equal(other.status, 0);
  assert.match(es(ctx, ["pending", "s1"]), /guide\.md/);
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
  const guide = path.join(ctx.proj, "docs", "guide.md");
  script(ctx, path.join(ctx.proj, "docs", "guide-copy.md"), fs.readFileSync(guide, "utf8"), "cp docs/guide.md docs/guide-copy.md");
  fs.mkdirSync(path.join(ctx.proj, "cache"), { recursive: true });
  script(ctx, path.join(ctx.proj, "cache", "README.md"), "A tool wrote this cache file and nobody has read it.\n", "npx some-tool");
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
  script(ctx, path.join(ctx.proj, "src.js"), "// Reads the configuration of the user.\nconst a = 2;\n");
  assert.equal(hook(ctx, "stop", { stop_hook_active: false }).out, null);
  script(ctx, path.join(ctx.proj, "CLAUDE.md"), "This file now tells the agent where every document of the project is kept.\n");
  const { out } = hook(ctx, "stop", { stop_hook_active: false });
  assert.match(out.reason, /thorough-1\.md/);
  assert.doesNotMatch(out.reason, /fast-1\.md/);
});

test("pre-edit: the text a file had before the agent's first edit is not sent, the agent's text is", () => {
  const ctx = setup();
  hook(ctx, "session-start", { source: "startup" });
  const guide = path.join(ctx.proj, "docs", "guide.md");
  rewrite(guide, fs.readFileSync(guide, "utf8") + "\nThe user added this paragraph by hand before the session.\n");
  hook(ctx, "pre-edit", { tool_name: "Edit", tool_input: { file_path: guide } });
  fs.appendFileSync(guide, "\nThe agent added this paragraph with the edit tool.\n");
  const { out } = hook(ctx, "stop", { stop_hook_active: false });
  const text = fs.readFileSync(out.reason.match(/- (\S+fast-1\.md)/)[1], "utf8");
  assert.match(text, /The agent added this paragraph/);
  assert.doesNotMatch(text, /The user added this paragraph/);
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

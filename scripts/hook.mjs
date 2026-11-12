#!/usr/bin/env node
// The single entry point for EngStickler's hooks: session-start | pre-edit | post-edit | stop | pre-bash | post-bash.
// A hook never calls a model. It finds the English that changed and tells the agent which readers to run.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, classify, expandHome, stateDir } from "../lib/config.mjs";
import { languageInfo, listLanguages } from "../lib/languages.mjs";
import { getBaseline, setBaseline, getSession, saveSession, newSession, updateSession, isChecked, markChecked, messageKey, sessionDir } from "../lib/store.mjs";
import { refreshBaselines, loadSession, collectPending, writeChunks, recordListed, acceptPending, projectRoot } from "../lib/pending.mjs";
import { loadCalques, instantFindings, formatInstant } from "../lib/instant.mjs";
import { isCommit, isPush, movesHead, commitMessage, pushTarget, pushPending } from "../lib/git.mjs";
import { isEnglishProse, passages, changedPassages, jsonStrings, useLanguage } from "../lib/extract.mjs";
import { warnings } from "../lib/log.mjs";

const env = process.env;
const cfg = loadConfig(env);
const lang = languageInfo(cfg.language);
useLanguage(lang?.code);
const es = fileURLToPath(new URL("./es.mjs", import.meta.url));
const terms = cfg.terms.map((t) => expandHome(t, env)).filter((t) => fs.existsSync(t));

const readStdin = async () => {
  let s = "";
  for await (const chunk of process.stdin) s += chunk;
  return s.trim() ? JSON.parse(s) : {};
};
const print = (o) => process.stdout.write(JSON.stringify(o));

const readerBrief = (root) =>
  `Give each reader: the project root ${root}, the chunk file's path, the language to translate into (${lang.name})` +
  (terms.length ? `, and the term files ${terms.join(", ")}` : "") +
  ".";

function procedure() {
  const lines = [
    `EngStickler checks every English text you write for this user, who talks to you in ${lang.name}.`,
    `Write English that says what the user means; never translate word for word from ${lang.name}.`,
    "",
    'When a hook stops your response, a commit or a push with a reason that begins "EngStickler:":',
    "1. Run the readers on each chunk file the reason names: the agent `engstickler:reader` on a fast chunk; " +
      "`engstickler:reader` and `engstickler:reader-thorough` in parallel on a thorough chunk. The reason says what to give them.",
    `2. Compare each reader's ${lang.name} translation with what you meant. Where they agree, keep the English. ` +
      "Where they differ, or a reader reports a phrase that reads two ways or that a native writer would not use, rewrite the English. " +
      "Search the other files EngStickler checks for each flagged phrase and fix every occurrence.",
    "3. Never change the meaning the user intended without the user's agreement: propose such a change instead. " +
      "You may reject a finding you judge to be a false alarm, but give your reason.",
    `4. Log every error you confirmed: pipe a JSON array of objects with the keys "phrase", "correction", ` +
      `"kind" (calque, collocation, ambiguity or grammar), "file" and "check" (fast or thorough) to: node "${es}" log`,
    "5. Mark the chunks as read with the command the reason gives, and go on.",
    "In your answer to the user, say in one short line what was fixed. Do not show the findings.",
  ];
  const w = warnings(cfg.limits.warnings, env);
  if (w) lines.push("", "Errors previously found in English written for this user. Avoid them:", w);
  return lines.join("\n");
}

// The prose of an edit's new text that the instant check reads: comments in code, strings in JSON,
// and, for a whole file written at once, only the passages it changed.
function editProse(abs, c, ti) {
  if (typeof ti.content === "string") {
    const base = getBaseline(abs, env);
    return changedPassages(base?.text ?? "", ti.content, c.kind);
  }
  const fragments = [ti.new_string, ...(ti.edits ?? []).map((e) => e.new_string)].filter((x) => typeof x === "string");
  return fragments.flatMap((f) => (c.kind === "json" ? jsonStrings(f).filter((p) => isEnglishProse(p.text)) : passages(f, c.kind)));
}

const IMPORTS_TEXT = /(^|[\s;&|(])git(\.exe)?(\s+-C\s+\S+)?\s+(checkout|switch|pull|merge|rebase|reset|restore|stash|cherry-pick|am|revert|clone)\b/;

async function main() {
  const event = process.argv[2];
  const input = await readStdin();
  if (!lang) {
    // With no language set, EngStickler checks nothing; the session start says how to set one.
    if (event !== "session-start") return;
    const notice =
      `EngStickler is installed but checks nothing: no language is set. To set one, write ` +
      `{"language": "<code>"} to ${path.join(stateDir(env), "config.json")}, where <code> is one of: ${listLanguages().join(", ")}.`;
    return print({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: notice } });
  }
  const id = input.session_id || "default";
  const cwd = input.cwd || process.cwd();
  const ti = input.tool_input ?? {};

  if (event === "session-start") {
    const fresh = input.source === "startup" || input.source === "clear" || !input.source;
    if (fresh || !getSession(id, env)) saveSession(id, newSession(), env);
    if (fresh) refreshBaselines(cwd, cfg, env);
    return print({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: procedure() } });
  }

  if (event === "pre-edit") {
    const p = ti.file_path ?? ti.notebook_path;
    if (!p) return;
    const abs = path.resolve(cwd, p);
    if (!classify(abs, cfg, { cwd, env })) return;
    updateSession(id, (s) => (s.touched.includes(abs) ? s : (s.touched.push(abs), s)), env);
    if (!getBaseline(abs, env)) {
      if (fs.existsSync(abs)) setBaseline(abs, fs.readFileSync(abs, "utf8"), fs.statSync(abs).mtimeMs, env);
      else setBaseline(abs, "", 0, env);
    }
    return;
  }

  if (event === "post-edit") {
    const p = ti.file_path ?? ti.notebook_path;
    if (!p) return;
    const abs = path.resolve(cwd, p);
    const c = classify(abs, cfg, { cwd, env });
    if (!c) return;
    const prose = editProse(abs, c, ti).map((x) => x.text).join("\n\n");
    const found = instantFindings(prose, { calques: loadCalques(lang.code), sentenceWords: cfg.limits.sentenceWords, article: c.article });
    if (!found.length) return;
    return print({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: formatInstant(found, c.rel) } });
  }

  if (event === "stop") {
    const scanStart = Date.now();
    const s = loadSession(id, env);
    const round = input.stop_hook_active ? s.round : 0;
    const pending = collectPending({ sessionId: id, cwd, cfg, env });
    if (!pending.length || round >= cfg.limits.rounds) {
      // Nothing unread, or the last round's fixes, which the agent resolves on its own: accepted as they are.
      if (pending.length) acceptPending(pending, env);
      updateSession(id, (x) => Object.assign(x, { round: 0, since: scanStart, listed: {} }), env);
      return;
    }
    const chunks = writeChunks(pending, path.join(sessionDir(id, env), "chunks"), cfg.limits.chunkWords);
    const listed = recordListed(id, pending, env);
    updateSession(id, (x) => Object.assign(x, { round: round + 1, listed }), env);
    const fast = chunks.filter((c) => !c.thorough);
    const thorough = chunks.filter((c) => c.thorough);
    const reason = [
      `EngStickler: the English written in this response has not been read yet (round ${round + 1} of ${cfg.limits.rounds}).`,
      fast.length ? `Fast check: run engstickler:reader on each of:\n${fast.map((c) => `- ${c.file} (${c.words} words)`).join("\n")}` : "",
      thorough.length
        ? `Thorough check (instruction files): run engstickler:reader and engstickler:reader-thorough in parallel on each of:\n${thorough.map((c) => `- ${c.file} (${c.words} words)`).join("\n")}`
        : "",
      readerBrief(projectRoot(cwd)),
      `Then follow the EngStickler procedure given at the start of the session, and mark the chunks as read with: node "${es}" checked ${id}`,
    ].filter(Boolean);
    return print({ decision: "block", reason: reason.join("\n") });
  }

  if (event === "pre-bash") {
    const cmd = ti.command ?? "";
    const deny = (reason) => print({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } });
    if (IMPORTS_TEXT.test(cmd)) updateSession(id, (x) => Object.assign(x, { gitOpStart: Date.now() }), env);
    const dir = sessionDir(id, env);
    if (isCommit(cmd)) {
      const parsed = commitMessage(cmd, cwd);
      if (parsed.unreadable) {
        return deny("EngStickler: this commit's message cannot be read from the command. Write the message to a file and commit with: git commit -F <file>");
      }
      const msg = parsed.message;
      if (msg && isEnglishProse(msg) && !isChecked("commit", messageKey(msg), env)) {
        fs.mkdirSync(dir, { recursive: true });
        const chunk = path.join(dir, "commit-chunk.md");
        fs.writeFileSync(chunk, `### commit message · message\n\n${msg}\n`);
        fs.writeFileSync(path.join(dir, "commit-message.txt"), msg);
        return deny(
          [
            "EngStickler: the commit message has not been read yet.",
            `Run engstickler:reader on ${chunk}. ${readerBrief(projectRoot(cwd))}`,
            "Fix the message as the EngStickler procedure says.",
            `Then mark the final message as read: pipe it to node "${es}" checked-commit ${id}`,
            "(with nothing piped in, the message as it stands in the chunk is marked).",
            "After that, run the commit again with that message.",
          ].join("\n"),
        );
      }
    }
    if (isPush(cmd)) {
      if (movesHead(cmd)) {
        return deny("EngStickler: run the push as a command of its own, after the command that changes the commits, so that what it sends can be read first.");
      }
      const target = pushTarget(cmd, cwd);
      const { range, pending, root } = pushPending(target, cfg, env);
      if (range && !isChecked("push", range.key, env)) {
        if (!pending.length) return markChecked("push", range.key, env);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "push-key.txt"), range.key);
        const chunks = writeChunks(pending, path.join(dir, "push-chunks"), cfg.limits.chunkWords, { allThorough: true });
        return deny(
          [
            `EngStickler: the English in the ${range.commits.length} commit(s) about to be pushed has not had the thorough check.`,
            `Run engstickler:reader and engstickler:reader-thorough in parallel on each of:\n${chunks.map((c) => `- ${c.file} (${c.words} words)`).join("\n")}`,
            readerBrief(root),
            `Fix what the readers report, as the EngStickler procedure says, and commit the fixes. Then run: node "${es}" checked-push ${id}`,
            "After that, push again.",
          ].join("\n"),
        );
      }
    }
    return;
  }

  if (event === "post-bash") {
    const cmd = ti.command ?? "";
    if (!IMPORTS_TEXT.test(cmd)) return;
    // A checkout, pull, merge or the like brought in text the agent did not write: it becomes the baseline unread.
    const since = loadSession(id, env).gitOpStart ?? Date.now();
    refreshBaselines(cwd, cfg, env, { since: since - 2000 });
  }
}

main().catch((e) => {
  // A fault in EngStickler must never stop the user's work: report it and let the action proceed.
  process.stderr.write(`EngStickler hook error: ${e?.stack ?? e}\n`);
  process.exit(0);
});

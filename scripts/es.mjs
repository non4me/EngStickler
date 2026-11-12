#!/usr/bin/env node
// EngStickler's commands for the agent: checked | checked-commit | checked-push | log | warnings | pending | bench-grade.
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../lib/config.mjs";
import { markChecked, messageKey, sessionDir } from "../lib/store.mjs";
import { acceptListed, collectPending, projectRoot } from "../lib/pending.mjs";
import { appendErrors, warnings } from "../lib/log.mjs";

const env = process.env;
const cfg = loadConfig(env);

const readStdin = async () => {
  if (process.stdin.isTTY) return "";
  let s = "";
  for await (const chunk of process.stdin) s += chunk;
  return s;
};

const [cmd, ...args] = process.argv.slice(2);

switch (cmd) {
  case "checked": {
    if (!args[0]) throw new Error("usage: es.mjs checked <session id>");
    console.log(`EngStickler: ${acceptListed(args[0], env)} file(s) marked as read.`);
    break;
  }
  case "checked-commit": {
    if (!args[0]) throw new Error("usage: es.mjs checked-commit <session id>");
    let msg = (await readStdin()).trim();
    if (!msg) msg = fs.readFileSync(path.join(sessionDir(args[0], env), "commit-message.txt"), "utf8");
    markChecked("commit", messageKey(msg), env);
    console.log("EngStickler: the commit message is marked as read.");
    break;
  }
  case "checked-push": {
    if (!args[0]) throw new Error("usage: es.mjs checked-push <session id>");
    const key = fs.readFileSync(path.join(sessionDir(args[0], env), "push-key.txt"), "utf8").trim();
    markChecked("push", key, env);
    console.log("EngStickler: the push is marked as checked.");
    break;
  }
  case "log": {
    const entries = JSON.parse((await readStdin()) || "[]");
    const n = appendErrors(Array.isArray(entries) ? entries : [entries], { project: path.basename(projectRoot(process.cwd())), env });
    console.log(`EngStickler: ${n} error(s) logged.`);
    break;
  }
  case "warnings": {
    console.log(warnings(Number(args[0]) || cfg.limits.warnings, env) || "No errors logged yet.");
    break;
  }
  case "pending": {
    const pending = collectPending({ sessionId: args[0] || "default", cwd: process.cwd(), cfg, env });
    for (const f of pending) console.log(`${f.path}: ${f.passages.length} passage(s)${f.instruction ? ", thorough" : ""}`);
    if (!pending.length) console.log("Nothing unread.");
    break;
  }
  case "bench-grade": {
    const { gradeFiles } = await import("../lib/bench.mjs");
    console.log(gradeFiles(args));
    break;
  }
  default:
    console.log("usage: es.mjs checked <session> | checked-commit <session> | checked-push <session> | log | warnings [n] | pending [session] | bench-grade <report>...");
    process.exitCode = 1;
}

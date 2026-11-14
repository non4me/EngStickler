#!/usr/bin/env node
// EngStickler's commands for the agent: open | checked [batch] | checked-commit | checked-push | log | warnings | pending | bench-grade.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, expandHome } from "../lib/config.mjs";
import { languageInfo } from "../lib/languages.mjs";
import { markChecked, messageKey, sessionDir } from "../lib/store.mjs";
import { closeBatches, collectPending, prepareBatch, readerLines, projectRoot } from "../lib/pending.mjs";
import { appendErrors, warnings } from "../lib/log.mjs";
import { useLanguage } from "../lib/extract.mjs";

const env = process.env;
const cfg = loadConfig(env);
useLanguage(cfg.language);

const readStdin = async () => {
  if (process.stdin.isTTY) return "";
  let s = "";
  for await (const chunk of process.stdin) s += chunk;
  return s;
};

const [cmd, ...args] = process.argv.slice(2);

switch (cmd) {
  case "checked": {
    if (!args[0]) throw new Error("usage: es.mjs checked <session id> [batch]...");
    console.log(`EngStickler: ${closeBatches(args[0], args.slice(1), env)} batch(es) marked as read.`);
    break;
  }
  case "open": {
    if (!args[0]) throw new Error("usage: es.mjs open <session id>");
    const batch = prepareBatch({ sessionId: args[0], cwd: process.cwd(), cfg, env });
    if (!batch) {
      console.log("EngStickler: Nothing to read. Write your message.");
      break;
    }
    const terms = cfg.terms.map((t) => expandHome(t, env)).filter((t) => fs.existsSync(t));
    const lines = [
      `EngStickler: the English text written so far in this response is batch ${batch.n}.`,
      "Start the readers in the background (run_in_background) now, without waiting for them, and then write your message.",
      ...readerLines(batch, { root: projectRoot(process.cwd()), language: languageInfo(cfg.language).name, terms }),
      `When the readers report, follow the EngStickler procedure given at the start of the session, and mark the batch as read with: node "${fileURLToPath(import.meta.url)}" checked ${args[0]} ${batch.n}`,
    ];
    console.log(lines.join("\n"));
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
    if (!cfg.language) throw new Error("no language is set in the configuration");
    const { gradeFiles } = await import("../lib/bench.mjs");
    console.log(gradeFiles(args, cfg.language));
    break;
  }
  default:
    console.log("usage: es.mjs open <session> | checked <session> [batch]... | checked-commit <session> | checked-push <session> | log | warnings [n] | pending [session] | bench-grade <report>...");
    process.exitCode = 1;
}

// The error log: every confirmed error, and the warnings for the writing agent drawn from it.
import fs from "node:fs";
import path from "node:path";
import { stateDir } from "./config.mjs";

const logFile = (env) => path.join(stateDir(env), "log.jsonl");

export function appendErrors(entries, { project = "", env = process.env } = {}) {
  const date = new Date().toISOString();
  const lines = entries
    .filter((e) => e && typeof e.phrase === "string" && e.phrase.trim())
    .map((e) => JSON.stringify({ date, project, ...e }) + "\n");
  if (!lines.length) return 0;
  fs.mkdirSync(stateDir(env), { recursive: true });
  fs.appendFileSync(logFile(env), lines.join(""));
  return lines.length;
}

export function readLog(env = process.env) {
  let text = "";
  try {
    text = fs.readFileSync(logFile(env), "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/** The errors made most often, the most recent first among equals, one line each, for the writing agent. */
export function warnings(limit, env = process.env) {
  const groups = new Map();
  for (const e of readLog(env)) {
    const k = e.phrase.toLowerCase().replace(/\s+/g, " ").trim();
    const g = groups.get(k) ?? { phrase: e.phrase, count: 0, date: "", correction: "", kind: "" };
    g.count += 1;
    if (e.date >= g.date) Object.assign(g, { phrase: e.phrase, date: e.date, correction: e.correction ?? "", kind: e.kind ?? "" });
    groups.set(k, g);
  }
  return [...groups.values()]
    .sort((a, b) => b.count - a.count || (a.date < b.date ? 1 : -1))
    .slice(0, limit)
    .map((g) => `- "${g.phrase}" → "${g.correction}" (${g.kind}${g.count > 1 ? `, ${g.count} times` : ""})`)
    .join("\n");
}

// Grading a reader's report against a benchmark's key by script, with no model.
import fs from "node:fs";
import { languageFile } from "./languages.mjs";

const norm = (s) => ` ${s.toLowerCase().replace(/[`"“”«»'’.,;:()—–!?]/g, " ").replace(/\s+/g, " ").trim()} `;
const wordsIn = (s) => s.trim().split(/\s+/).filter(Boolean).length;

/** The phrases a report flags, each with the node and the part named in its section's heading. */
export function flaggedPhrases(report) {
  const flagged = [];
  for (const section of report.split(/^### /m).slice(1)) {
    const head = section.split("\n")[0];
    const m = head.match(/Node\s+(\S+)\s+·\s+(\w+)/);
    if (!m) continue;
    let inFindings = false;
    for (const line of section.split("\n").slice(1)) {
      if (/^(TWO READINGS|LANGUAGE):/.test(line)) inFindings = true;
      else if (/^TRANSLATION:/.test(line)) inFindings = false;
      if (!inFindings) continue;
      const q = line.match(/"([^"]+)"/);
      if (q) flagged.push({ num: m[1], field: m[2], phrase: q[1] });
    }
  }
  return flagged;
}

/**
 * Which key items a report caught: `own` counts a phrase flagged in the same node and part; `propagated` also
 * counts a flagged phrase of two or more words wherever it occurs in the key, as fixing it everywhere would.
 */
export function gradeReport(report, key) {
  const flagged = flaggedPhrases(report);
  const own = [];
  const propagated = [];
  key.forEach((k, idx) => {
    const was = norm(k.was);
    const local = flagged.filter((f) => f.num === k.num && f.field === k.field);
    const hit = local.some((f) => {
      const p = norm(f.phrase);
      const ok = wordsIn(p) >= 2 || p.trim().length >= 4;
      return ok && (was.includes(p) || p.includes(was));
    });
    if (hit) own.push(idx + 1);
    if (hit || flagged.some((f) => wordsIn(norm(f.phrase)) >= 2 && was.includes(norm(f.phrase)))) propagated.push(idx + 1);
  });
  return { own, propagated, flagged };
}

export function gradeFiles(files, code) {
  const key = JSON.parse(fs.readFileSync(languageFile(code, "benchmark", "key.json"), "utf8"));
  const pct = (n) => `${n}/${key.length} (${Math.round((n / key.length) * 100)}%)`;
  const rows = [];
  let ownSum = 0;
  let propSum = 0;
  for (const f of files) {
    const g = gradeReport(fs.readFileSync(f, "utf8"), key);
    ownSum += g.own.length;
    propSum += g.propagated.length;
    const missed = key.map((_, i) => i + 1).filter((i) => !g.propagated.includes(i));
    rows.push(`${f}: own ${pct(g.own.length)}, propagated ${pct(g.propagated.length)}, flagged ${g.flagged.length}, missed ${missed.join(",")}`);
  }
  if (files.length > 1) rows.push(`mean: own ${pct(Math.round(ownSum / files.length))}, propagated ${pct(Math.round(propSum / files.length))}`);
  return rows.join("\n");
}

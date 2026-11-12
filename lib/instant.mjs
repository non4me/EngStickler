// The instant check: known calques and over-long sentences, by script, with no model.
import fs from "node:fs";
import { passages, proseOf } from "./extract.mjs";

export function loadCalques(code = "ru") {
  const file = new URL(`../data/calques-${code}.json`, import.meta.url);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")).calques;
  } catch {
    return [];
  }
}

const sentencesOf = (text) =>
  proseOf(text)
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

const wordCount = (s) => (s.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;

export function instantFindings(text, { calques, sentenceWords, article }) {
  const found = [];
  for (const c of calques) {
    const re = new RegExp(c.find, "gi");
    for (const m of text.matchAll(re)) found.push({ type: "calque", phrase: m[0], use: c.use, why: c.why });
  }
  if (!article) {
    for (const p of passages(text, "markdown")) {
      for (const s of sentencesOf(p.text)) {
        const words = wordCount(s);
        if (words > sentenceWords) found.push({ type: "long", sentence: s.length > 140 ? s.slice(0, 140) + "…" : s, words });
      }
    }
  }
  return found;
}

export function formatInstant(findings, file) {
  const lines = findings.map((f) =>
    f.type === "calque"
      ? `- "${f.phrase}" → ${f.use}. ${f.why}`
      : `- a sentence of ${f.words} words: "${f.sentence}"`,
  );
  return (
    `EngStickler: instant check of ${file}. Reread each item below. ` +
    "If a phrase is used in the sense the calque list warns about, rewrite it to say what you meant. " +
    "If a sentence states more than one thought, split it.\n" +
    lines.join("\n")
  );
}

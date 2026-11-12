// The English passages of a file, and the passages a change added.
import fs from "node:fs";
import { languageFile } from "./languages.mjs";

const URL_RE = /https?:\/\/\S+/g;
const CODE_RE = /`[^`]*`/g;
const LATIN_WORD = /[A-Za-z][A-Za-z'’-]*/g;

/** Text with its code spans and links removed: what a reader reads as prose. */
export const proseOf = (s) => s.replace(CODE_RE, " ").replace(URL_RE, " ");

// The commonest English function words. Prose in a language written in the Latin alphabet is told from
// English by comparing how many of these it holds with how many of that language's own function words.
const ENGLISH_STOPWORDS = new Set(
  ("the of and to a an in is are was were be been it its that this these those for with as on at by from or not no " +
    "but if then than which who what when where there their they them we you he she his her our your has have had do " +
    "does did can could will would should must may might each every all any some one only also into out about after " +
    "before such so more most other")
    .split(" "),
);

let userStopwords = null;

/**
 * Sets the user's language for telling English from it. A language written in the Latin alphabet has a
 * list of its function words in its folder; a language with no list is told from English by its letters.
 */
export function useLanguage(code) {
  userStopwords = null;
  if (!code) return;
  try {
    const words = fs.readFileSync(languageFile(code, "stopwords.txt"), "utf8").split(/\s+/).filter(Boolean);
    userStopwords = new Set(words.map((w) => w.toLowerCase()));
  } catch {
    // No list: the share of Latin letters decides.
  }
}

export function isEnglishProse(s) {
  const t = proseOf(s);
  const words = t.match(LATIN_WORD) ?? [];
  if (words.length < 4) return false;
  const latin = (t.match(/[A-Za-z]/g) ?? []).length;
  const letters = (t.match(/\p{L}/gu) ?? []).length;
  if (latin / letters < 0.7) return false;
  if (!userStopwords) return true;
  const tokens = (t.toLowerCase().match(/\p{L}+/gu) ?? []);
  const english = tokens.filter((w) => ENGLISH_STOPWORDS.has(w)).length;
  const native = tokens.filter((w) => userStopwords.has(w)).length;
  return english >= 1 && english > native;
}

const collapse = (s) => s.replace(/\s+/g, " ").trim();

function markdownPassages(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  let fence = null;
  let cur = null;
  const flush = () => {
    if (cur) out.push(cur);
    cur = null;
  };
  lines.forEach((line, i) => {
    const fenceMark = line.match(/^\s*(```|~~~)/);
    if (fence) {
      if (fenceMark && fenceMark[1] === fence) fence = null;
      return;
    }
    if (fenceMark) {
      flush();
      fence = fenceMark[1];
      return;
    }
    if (/^\s*$/.test(line) || /^-{3,}\s*$/.test(line)) return flush();
    const starts = /^\s{0,3}([-*+]|\d+[.)])\s/.test(line) || /^\s*\|/.test(line) || /^#{1,6}\s/.test(line);
    if (starts || !cur) {
      flush();
      cur = { where: `line ${i + 1}`, text: line };
    } else cur.text += "\n" + line;
    if (/^#{1,6}\s/.test(line) || /^\s*\|/.test(line)) flush();
  });
  flush();
  return out;
}

function jsonPassages(text) {
  const data = JSON.parse(text);
  const out = [];
  const esc = (k) => String(k).replace(/~/g, "~0").replace(/\//g, "~1");
  const visit = (v, ptr) => {
    if (typeof v === "string") out.push({ where: ptr || "/", text: v });
    else if (Array.isArray(v)) v.forEach((x, i) => visit(x, `${ptr}/${i}`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) visit(x, `${ptr}/${esc(k)}`);
  };
  visit(data, "");
  return out;
}

function codePassages(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  let cur = null;
  let block = null; // "*/" or '"""' while inside a block comment or a docstring
  const flush = () => {
    if (cur) out.push(cur);
    cur = null;
  };
  const add = (i, s) => {
    if (!cur) cur = { where: `line ${i + 1}`, text: s };
    else cur.text += "\n" + s;
  };
  lines.forEach((line, i) => {
    const t = line.trim();
    if (block) {
      const end = t.indexOf(block);
      add(i, (end >= 0 ? t.slice(0, end) : t).replace(/^\*\s?/, "").trim());
      if (end >= 0) {
        block = null;
        flush();
      }
      return;
    }
    const open = t.match(/^(\/\*\*?|""")(.*)$/);
    if (open) {
      flush();
      const close = open[1] === '"""' ? '"""' : "*/";
      const rest = open[2];
      const end = rest.indexOf(close);
      add(i, (end >= 0 ? rest.slice(0, end) : rest).trim());
      if (end >= 0) flush();
      else block = close;
      return;
    }
    const line_ = t.match(/^(\/\/+|#(?!!))\s?(.*)$/);
    if (line_) return add(i, line_[2]);
    flush();
  });
  flush();
  return out.map((p) => ({ where: p.where, text: p.text.trim() }));
}

const linePassages = (text) => text.split(/\r?\n/).map((line, i) => ({ where: `line ${i + 1}`, text: line.trim() }));

// The string literals of a fragment of JSON, which need not parse on its own: used for an edit's new text.
export const jsonStrings = (fragment) =>
  [...fragment.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((m, i) => {
    let text = m[1];
    try {
      text = JSON.parse(`"${m[1]}"`);
    } catch {
      // A literal that does not decode is read as it stands.
    }
    return { where: `string ${i + 1}`, text };
  });

const MAX_WORDS = 120;
const wordCount = (s) => (s.match(/\S+/g) ?? []).length;

// A passage longer than MAX_WORDS is split into its lines, or a single long line into its sentences,
// so that one changed sentence never sends a whole block to the readers.
function splitLong(p) {
  if (wordCount(p.text) <= MAX_WORDS) return [p];
  const base = Number(p.where.match(/^line (\d+)$/)?.[1] ?? NaN);
  const lines = p.text.split("\n");
  if (lines.length > 1) {
    return lines.flatMap((line, i) => splitLong({ where: Number.isNaN(base) ? p.where : `line ${base + i}`, text: line }));
  }
  return p.text
    .split(/(?<=[.?!])\s+/)
    .filter(Boolean)
    .map((s) => ({ where: p.where, text: s }));
}

/** The English prose passages of a file's text, each with its location. */
export function passages(text, kind) {
  const t = text.replace(/^﻿/, "");
  let all;
  if (kind === "json") {
    try {
      all = jsonPassages(t);
    } catch {
      all = linePassages(t);
    }
  } else if (kind === "code") all = codePassages(t);
  else all = markdownPassages(t);
  return all.flatMap(splitLong).filter((p) => isEnglishProse(p.text));
}

/** The passages of the new text that the old text did not have. */
export function changedPassages(oldText, newText, kind) {
  const old = new Set(passages(oldText ?? "", kind).map((p) => collapse(p.text)));
  return passages(newText, kind).filter((p) => !old.has(collapse(p.text)));
}

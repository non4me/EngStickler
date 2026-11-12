// The English passages of a file, and the passages a change added.
const URL_RE = /https?:\/\/\S+/g;
const CODE_RE = /`[^`]*`/g;
const LATIN_WORD = /[A-Za-z][A-Za-z'’-]*/g;

/** Text with its code spans and links removed: what a reader reads as prose. */
export const proseOf = (s) => s.replace(CODE_RE, " ").replace(URL_RE, " ");

export function isEnglishProse(s) {
  const t = proseOf(s);
  const words = t.match(LATIN_WORD) ?? [];
  if (words.length < 4) return false;
  const latin = (t.match(/[A-Za-z]/g) ?? []).length;
  const letters = (t.match(/\p{L}/gu) ?? []).length;
  return latin / letters >= 0.7;
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

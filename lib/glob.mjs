// Glob matching and a directory walk that prunes what no pattern can reach.
// Paths are compared in forward-slash form, relative to the walk's root.
import fs from "node:fs";
import path from "node:path";

const toSlash = (p) => p.replace(/\\/g, "/");

function segmentToRegExp(seg) {
  let re = "";
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "{") {
      const end = seg.indexOf("}", i);
      const alts = seg.slice(i + 1, end).split(",").map((a) => a.replace(/[.+^$()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*"));
      re += `(?:${alts.join("|")})`;
      i = end;
    } else re += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  return re;
}

/** A glob converted to a regular expression that matches a whole forward-slash path. */
export function globToRegExp(glob) {
  const segs = toSlash(glob).split("/");
  let re = "";
  segs.forEach((seg, i) => {
    const last = i === segs.length - 1;
    if (seg === "**") re += last ? ".*" : "(?:[^/]+/)*";
    else re += segmentToRegExp(seg) + (last ? "" : "/");
  });
  return new RegExp(`^${re}$`);
}

export function matchesAny(rel, globs) {
  const p = toSlash(rel);
  return globs.some((g) => globToRegExp(g).test(p));
}

// Whether a directory at `relDir` (no trailing slash, "" for the root) can contain a match for `glob`.
function dirCanMatch(relDir, glob) {
  if (relDir === "") return true;
  const dirSegs = relDir.split("/");
  const gSegs = toSlash(glob).split("/");
  const step = (di, gi) => {
    if (di === dirSegs.length) return gi < gSegs.length; // part of the glob is left to match the files below
    if (gi >= gSegs.length - 1) return gSegs[gi] === "**"; // the last segment names files, not directories
    const g = gSegs[gi];
    if (g === "**") return step(di, gi + 1) || step(di + 1, gi);
    return new RegExp(`^${segmentToRegExp(g)}$`).test(dirSegs[di]) && step(di + 1, gi + 1);
  };
  return step(0, 0);
}

/** Absolute paths under `root` that match an include glob and no exclude glob. */
export function walk(root, include, exclude = []) {
  const out = [];
  const excludeRe = exclude.map(globToRegExp);
  const excluded = (rel) => excludeRe.some((re) => re.test(rel) || re.test(rel + "/"));
  const includeRe = include.map(globToRegExp);
  const visit = (relDir) => {
    let entries;
    try {
      entries = fs.readdirSync(path.join(root, relDir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (excluded(rel + "/x") || excluded(rel)) continue;
        if (include.some((g) => dirCanMatch(rel, g))) visit(rel);
      } else if (e.isFile()) {
        if (!excluded(rel) && includeRe.some((re) => re.test(rel))) out.push(path.join(root, rel));
      }
    }
  };
  visit("");
  return out;
}

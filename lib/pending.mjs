// What English changed since the baselines, and the chunk files the readers read.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { claudeDir, classify } from "./config.mjs";
import { walk, matchesAny } from "./glob.mjs";
import { passages, changedPassages } from "./extract.mjs";
import {
  getBaseline,
  setBaselines,
  baselineIndex,
  sha1,
  keyOf,
  getSession,
  newSession,
  updateSession,
  sessionDir,
  knownPassages,
  addKnown,
  passageKey,
  unreadFiles,
  markUnread,
  clearUnread,
} from "./store.mjs";

const read = (p) => fs.readFileSync(p, "utf8");

/** The git work tree that contains `cwd`, or null outside a git repository. */
export function gitRoot(cwd) {
  const r = spawnSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  return r.status === 0 && r.stdout.trim() ? path.resolve(r.stdout.trim()) : null;
}
export const projectRoot = (cwd) => gitRoot(cwd) ?? path.resolve(cwd);

/**
 * The project's files in scope: what git tracks or would track (so ignored caches and generated copies stay
 * out), plus the ignored folders that are in scope. Outside a git repository the project is not scanned.
 */
function projectFiles(root, cfg) {
  const r = spawnSync("git", ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
  if (r.status !== 0) return [];
  const rels = r.stdout.split("\0").filter((rel) => rel && matchesAny(rel, cfg.project.include) && !matchesAny(rel, cfg.project.exclude));
  const files = rels.map((rel) => path.join(root, rel));
  for (const dir of cfg.project.ignoredInScope ?? []) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    for (const p of walk(abs, ["**/*"], cfg.project.exclude)) {
      const rel = path.relative(root, p).replace(/\\/g, "/");
      if (matchesAny(rel, cfg.project.include) && !matchesAny(rel, cfg.project.exclude)) files.push(p);
    }
  }
  return files;
}

/** Every file in scope, each with its root: the project that contains the cwd, and the user's own files. */
export function scopeFiles(cwd, cfg, env = process.env) {
  const out = [];
  const root = cwd ? gitRoot(cwd) : null;
  if (root) for (const p of projectFiles(root, cfg)) out.push({ path: p, root });
  const claude = claudeDir(env);
  for (const p of walk(claude, cfg.user.include, cfg.user.exclude ?? [])) out.push({ path: p, root: claude });
  if (out.length > cfg.limits.maxFiles) {
    process.stderr.write(`EngStickler: ${out.length} files in scope, more than ${cfg.limits.maxFiles}; only files edited with the edit tools are checked.\n`);
    return [];
  }
  return out;
}

const knownKeys = (text, kind) => passages(text, kind).map((p) => passageKey(p.text));

/** Records baselines and adds their passages to the known ones. */
function recordBaselines(items, env) {
  setBaselines(items, env);
  addKnown(items.flatMap((i) => (i.kind ? knownKeys(i.text, i.kind) : [])), env);
}

/**
 * Every file in scope whose content changed becomes its own baseline, unread files excepted: at a session
 * start, and, with `since`, after a git command that brought in other people's text.
 */
export function refreshBaselines(cwd, cfg, env = process.env, { since = 0 } = {}) {
  const index = baselineIndex(env);
  const unread = unreadFiles(env);
  const items = [];
  for (const { path: p, root } of scopeFiles(cwd, cfg, env)) {
    const key = keyOf(p);
    if (unread[key]) continue;
    let st;
    try {
      st = fs.statSync(p);
    } catch {
      continue;
    }
    if (st.mtimeMs < since) continue;
    const rec = index[key];
    if (rec && rec.mtimeMs === st.mtimeMs) continue;
    const text = read(p);
    if (rec && rec.hash === sha1(text)) continue;
    items.push({ path: p, text, mtimeMs: st.mtimeMs, kind: classify(p, cfg, { root, env })?.kind });
  }
  recordBaselines(items, env);
  return items.length;
}

export const loadSession = (id, env = process.env) => getSession(id, env) ?? newSession();

/**
 * The files whose English changed since their baseline, each with its new passages. A candidate is a file in
 * scope changed since the session's last clean check, a file this session edited, or a file listed and not
 * yet accepted. A passage already known (read before, or present in another file) is not sent again.
 */
export function collectPending({ sessionId, cwd, cfg, env = process.env }) {
  const session = loadSession(sessionId, env);
  const index = baselineIndex(env);
  const unread = unreadFiles(env);
  const candidates = new Map();
  for (const f of scopeFiles(cwd, cfg, env)) candidates.set(keyOf(f.path), f);
  const own = new Set([...session.touched, ...Object.keys(session.listed ?? {})].map(keyOf));
  for (const [k, sid] of Object.entries(unread)) if (sid === sessionId) own.add(k);
  for (const p of session.touched) if (!candidates.has(keyOf(p))) candidates.set(keyOf(p), { path: p, root: null });
  const known = knownPassages(env);
  const silent = [];
  const out = [];
  for (const [key, { path: p, root }] of candidates) {
    let st;
    try {
      st = fs.statSync(p);
    } catch {
      continue;
    }
    const rec = index[key];
    if (rec && rec.mtimeMs === st.mtimeMs) continue;
    if (!own.has(key) && st.mtimeMs < session.since) continue;
    const c = classify(p, cfg, { cwd, env, root: root ?? undefined });
    if (!c) continue;
    const text = read(p);
    const base = rec ? getBaseline(p, env, index) : null;
    if (!base && !own.has(key) && st.mtimeMs < session.startedAt) {
      silent.push({ path: p, text, mtimeMs: st.mtimeMs, kind: c.kind });
      continue;
    }
    if (base && base.hash === sha1(text)) {
      silent.push({ path: p, text, mtimeMs: st.mtimeMs, kind: c.kind });
      continue;
    }
    const changed = changedPassages(base?.text ?? "", text, c.kind).filter((ps) => !known.has(passageKey(ps.text)));
    if (!changed.length) {
      silent.push({ path: p, text, mtimeMs: st.mtimeMs, kind: c.kind });
      continue;
    }
    out.push({ path: p, root: c.root, kind: c.kind, instruction: c.instruction, passages: changed, text, mtimeMs: st.mtimeMs });
  }
  recordBaselines(silent, env);
  return out;
}

const words = (s) => (s.match(/\S+/g) ?? []).length;

/** Writes the passages into chunk files of at most `chunkWords` words; instruction files go to thorough chunks. */
export function writeChunks(pending, dir, chunkWords, { allThorough = false } = {}) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const chunks = [];
  for (const thorough of [false, true]) {
    let cur = null;
    const flush = () => {
      if (cur && cur.words) {
        const file = path.join(dir, `${thorough ? "thorough" : "fast"}-${chunks.filter((c) => c.thorough === thorough).length + 1}.md`);
        fs.writeFileSync(file, cur.parts.join("\n"));
        chunks.push({ file, thorough, words: cur.words });
      }
      cur = { parts: [], words: 0 };
    };
    flush();
    for (const f of pending.filter((x) => (allThorough || Boolean(x.instruction)) === thorough)) {
      for (const ps of f.passages) {
        const w = words(ps.text);
        if (cur.words && cur.words + w > chunkWords) flush();
        cur.parts.push(`### ${f.path} · ${ps.where}\n\n${ps.text}\n`);
        cur.words += w;
      }
    }
    flush();
  }
  return chunks;
}

/** Accepts the current content of pending files without a reading: used when the last round's fixes are let through. */
export function acceptPending(pending, env = process.env) {
  recordBaselines(pending.map((f) => ({ path: f.path, text: f.text, mtimeMs: f.mtimeMs, kind: f.kind })), env);
  clearUnread(pending.map((f) => f.path), env);
}

/** Remembers the content each pending file had when it was listed for the readers, and marks it unread. */
export function recordListed(sessionId, pending, env = process.env) {
  const dir = path.join(sessionDir(sessionId, env), "listed");
  fs.mkdirSync(dir, { recursive: true });
  const listed = {};
  for (const f of pending) {
    const file = path.join(dir, sha1(keyOf(f.path)) + ".txt");
    fs.writeFileSync(file, f.text);
    listed[f.path] = { file, mtimeMs: f.mtimeMs, kind: f.kind };
  }
  markUnread(pending.map((f) => f.path), sessionId, env);
  return listed;
}

/**
 * Makes the content the readers saw the new baseline of each listed file. With `current`, the files' current
 * content is accepted instead: used when the last round's fixes are let through unread.
 */
export function acceptListed(sessionId, env = process.env, { current = false } = {}) {
  let accepted = 0;
  updateSession(
    sessionId,
    (session) => {
      const items = [];
      for (const [p, { file, mtimeMs, kind }] of Object.entries(session.listed ?? {})) {
        try {
          if (current) {
            const st = fs.statSync(p);
            items.push({ path: p, text: read(p), mtimeMs: st.mtimeMs, kind });
          } else items.push({ path: p, text: read(file), mtimeMs, kind });
        } catch {
          // The file or its listed copy is gone: nothing to accept.
        }
      }
      recordBaselines(items, env);
      clearUnread(Object.keys(session.listed ?? {}), env);
      accepted = items.length;
      session.listed = {};
    },
    env,
  );
  return accepted;
}

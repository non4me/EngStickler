// The English text the agent wrote that the readers have not yet read, and the chunk files it is written to
// for them.
//
// A passage is known when it was present before the agent wrote anything in its file, or when the readers
// have read it. The existing text of a project, and of the user's own files, becomes known once, the first
// time a session starts there. After that, only the files the agent touches are looked at: the files it
// edits with the edit tools, and the files changed by a command it runs. The passages in those files that
// are not yet known are the English text for the readers to read.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { claudeDir, classify } from "./config.mjs";
import { walk, matchesAny } from "./glob.mjs";
import { passages } from "./extract.mjs";
import {
  keyOf,
  knownPassages,
  addKnown,
  passageKey,
  unreadFiles,
  markUnread,
  clearUnread,
  getSession,
  newSession,
  updateSession,
  isSetUp,
  markSetUp,
} from "./store.mjs";

const read = (p) => fs.readFileSync(p, "utf8");

/** The root folder of the git work tree that contains `cwd`, or null outside a git repository. */
export function gitRoot(cwd) {
  const r = spawnSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  return r.status === 0 && r.stdout.trim() ? path.resolve(r.stdout.trim()) : null;
}
export const projectRoot = (cwd) => gitRoot(cwd) ?? path.resolve(cwd);

const inProject = (rel, cfg) => matchesAny(rel, cfg.project.include) && !matchesAny(rel, cfg.project.exclude);

// The files in scope that lie in folders git ignores but the checks cover, such as the agent's working notes.
function ignoredInScope(root, cfg, since = 0) {
  const out = [];
  for (const dir of cfg.project.ignoredInScope ?? []) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    for (const p of walk(abs, ["**/*"], cfg.project.exclude)) {
      if (!inProject(path.relative(root, p).replace(/\\/g, "/"), cfg)) continue;
      if (since && fs.statSync(p).mtimeMs < since) continue;
      out.push(p);
    }
  }
  return out;
}

/**
 * The project's files in scope: the files git tracks, the untracked files it does not ignore, and the files in
 * the ignored folders that the checks cover.
 */
function projectFiles(root, cfg) {
  const r = spawnSync("git", ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
  if (r.status !== 0) return [];
  const files = r.stdout.split("\0").filter((rel) => rel && inProject(rel, cfg)).map((rel) => path.join(root, rel));
  return files.concat(ignoredInScope(root, cfg));
}

const userFiles = (cfg, env) => walk(claudeDir(env), cfg.user.include, cfg.user.exclude ?? []);

const passageKeys = (text, kind) => passages(text, kind).map((p) => passageKey(p.text));

/** Adds the current passages of the given files to the known ones: the text they had before the agent wrote in them. */
export function absorb(paths, cfg, { cwd, env = process.env, root } = {}) {
  const keys = [];
  for (const p of paths) {
    const c = classify(p, cfg, { cwd, env, root });
    if (!c) continue;
    try {
      keys.push(...passageKeys(read(p), c.kind));
    } catch {
      // A file that cannot be read has no text to record.
    }
  }
  addKnown(keys, env);
  return keys.length;
}

/** Once per project, and once for the user's own files, makes every passage that exists in them known. */
export function ensureSetUp(cwd, cfg, env = process.env) {
  const todo = [];
  const root = cwd ? gitRoot(cwd) : null;
  if (root && !isSetUp(root, env)) todo.push({ root, files: () => projectFiles(root, cfg) });
  const claude = claudeDir(env);
  if (fs.existsSync(claude) && !isSetUp(claude, env)) todo.push({ root: claude, files: () => userFiles(cfg, env) });
  for (const { root: r, files } of todo) {
    const list = files();
    if (list.length > cfg.limits.maxFiles) {
      process.stderr.write(`EngStickler: ${list.length} files in ${r}, more than ${cfg.limits.maxFiles}; their existing text is not recorded.\n`);
    } else absorb(list, cfg, { env, root: r });
    markSetUp(r, env);
  }
  return todo.length;
}

/**
 * The files in scope whose modification time is not earlier than `since`, among what git reports as changed in
 * the project, the files in the ignored folders that the checks cover, and the user's own files.
 */
export function changedSince(since, cwd, cfg, env = process.env) {
  const out = new Map();
  const add = (p) => {
    try {
      if (fs.statSync(p).mtimeMs >= since) out.set(keyOf(p), p);
    } catch {
      // A file that has been deleted has no English text to read.
    }
  };
  const root = cwd ? gitRoot(cwd) : null;
  if (root) {
    const r = spawnSync("git", ["-C", root, "status", "--porcelain", "-z", "--untracked-files=all"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    const recs = (r.stdout ?? "").split("\0");
    for (let i = 0; i < recs.length; i++) {
      const rec = recs[i];
      if (rec.length < 4) continue;
      const rel = rec.slice(3);
      if (/^[RC]/.test(rec)) i++; // a rename or a copy is followed by its old path
      if (inProject(rel, cfg)) add(path.join(root, rel));
    }
    for (const p of ignoredInScope(root, cfg, since)) add(p);
  }
  for (const p of userFiles(cfg, env)) add(p);
  return [...out.values()];
}

export const loadSession = (id, env = process.env) => getSession(id, env) ?? newSession();

/** The files the agent touched in this session that contain passages not yet known, each with those passages. */
export function collectPending({ sessionId, cwd, cfg, env = process.env }) {
  const session = loadSession(sessionId, env);
  const candidates = new Map();
  for (const p of [...session.touched, ...(session.changed ?? [])]) candidates.set(keyOf(p), p);
  for (const { session: sid, path: p } of Object.values(unreadFiles(env))) if (sid === sessionId) candidates.set(keyOf(p), p);
  const known = knownPassages(env);
  const out = [];
  for (const p of candidates.values()) {
    const c = classify(p, cfg, { cwd, env });
    if (!c) continue;
    let text;
    try {
      text = read(p);
    } catch {
      continue;
    }
    const seen = new Set();
    const fresh = passages(text, c.kind).filter((ps) => {
      const k = passageKey(ps.text);
      if (known.has(k) || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (fresh.length) out.push({ path: p, root: c.root, kind: c.kind, instruction: c.instruction, passages: fresh });
  }
  return out;
}

const words = (s) => (s.match(/\S+/g) ?? []).length;

/**
 * Writes the passages into chunk files of at most `chunkWords` words. Passages from instruction files go into
 * chunks for the thorough check.
 */
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

// A batch is the English handed to the readers at one stop. The readers run in the background, so several
// batches may be open at once; each keeps its own chunk folder until the agent marks it as read.

const wordSet = (text) => new Set(text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []);

/** How alike two passages are: the share of their distinct words they have in common, from 0 to 1. */
export function likeness(a, b) {
  const x = wordSet(a);
  const y = wordSet(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}

/** The passages in the session's open batches, by key. */
export const openKeys = (session) =>
  new Set(Object.values(session.batches ?? {}).flatMap((b) => b.passages.map((p) => p.key)));

/**
 * Gives each pending passage its depth: 0 for new text, or one more than the depth of the passage in the same file
 * that it most resembles among those the readers have seen, when the two are alike enough to be a fix of one
 * another. Passages already in an open batch are dropped.
 */
export function withDepth(pending, session, minLikeness = 0.5) {
  const open = openKeys(session);
  const seen = [...Object.values(session.batches ?? {}).flatMap((b) => b.passages), ...(session.read ?? [])];
  const out = [];
  for (const f of pending) {
    const here = seen.filter((p) => keyOf(p.path) === keyOf(f.path));
    const passages = [];
    for (const ps of f.passages) {
      const key = passageKey(ps.text);
      if (open.has(key)) continue;
      let depth = 0;
      let best = minLikeness;
      for (const p of here) {
        const l = likeness(ps.text, p.text);
        if (l >= best) {
          best = l;
          depth = p.depth + 1;
        }
      }
      passages.push({ ...ps, key, depth });
    }
    if (passages.length) out.push({ ...f, passages });
  }
  return out;
}

/** Records the pending passages as a new open batch of the session, and marks their files as unread. Returns its number. */
export function openBatch(sessionId, pending, dir, env = process.env) {
  let n = 0;
  updateSession(
    sessionId,
    (session) => {
      n = session.nextBatch ?? 1;
      session.nextBatch = n + 1;
      session.batches ??= {};
      session.batches[n] = {
        dir: path.join(dir, `b${n}`),
        passages: pending.flatMap((f) => f.passages.map((ps) => ({ path: f.path, key: ps.key, text: ps.text, depth: ps.depth }))),
      };
    },
    env,
  );
  markUnread(pending.map((f) => f.path), sessionId, env);
  return n;
}

/** Accepts pending passages without the readers reading them: used for a fix of a fix, which is not read again. */
export function acceptPending(pending, env = process.env) {
  addKnown(pending.flatMap((f) => f.passages.map((ps) => passageKey(ps.text))), env);
}

/**
 * Marks as known the passages of the given batches, or of every open batch when none is given, and removes their
 * chunk folders. A file stays unread while another open batch still contains text from it. The passages are kept as
 * read, so that a fix of one of them can be recognised. Returns the number of batches closed.
 */
export function closeBatches(sessionId, numbers, env = process.env, keepRead = 200) {
  let closed = 0;
  updateSession(
    sessionId,
    (session) => {
      const batches = session.batches ?? {};
      const which = numbers?.length ? numbers.map(String).filter((n) => batches[n]) : Object.keys(batches);
      const done = which.flatMap((n) => batches[n].passages);
      addKnown(done.map((p) => p.key), env);
      for (const n of which) {
        fs.rmSync(batches[n].dir, { recursive: true, force: true });
        delete batches[n];
      }
      const stillOpen = new Set(Object.values(batches).flatMap((b) => b.passages.map((p) => keyOf(p.path))));
      clearUnread([...new Set(done.map((p) => p.path))].filter((p) => !stillOpen.has(keyOf(p))), env);
      session.read = [...(session.read ?? []), ...done].slice(-keepRead);
      closed = which.length;
    },
    env,
  );
  return closed;
}

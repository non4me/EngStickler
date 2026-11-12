// The state folder: the passages already known (present before the agent wrote, or read by the readers),
// the roots whose existing text has been recorded, the sessions, the files with unread English text, and the
// commit messages and pushes that have been checked. Every read-and-rewrite of a shared file runs under a
// lock, and every write goes to a temporary file that is then renamed, so that two concurrent sessions never
// overwrite each other's entries.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { stateDir } from "./config.mjs";

export const sha1 = (s) => crypto.createHash("sha1").update(s).digest("hex");
export const keyOf = (p) => path.resolve(p).replace(/\\/g, "/").toLowerCase();

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/**
 * Runs `fn` while holding `<file>.lock`. A lock older than 30 s is assumed to have been left behind by a process
 * that has died, and is removed.
 */
export function withLock(file, fn) {
  const lock = `${file}.lock`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const deadline = Date.now() + 10000;
  for (;;) {
    try {
      fs.closeSync(fs.openSync(lock, "wx"));
      break;
    } catch {
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 30000) fs.rmSync(lock, { force: true });
      } catch {
        // The lock went away between the two calls: try again.
      }
      if (Date.now() > deadline) break; // Better a rare lost entry than a hook that hangs.
      sleep(20);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};
const writeJson = (file, data) => atomicWrite(file, JSON.stringify(data));
const updateJson = (file, fallback, fn) =>
  withLock(file, () => {
    const data = readJson(file, fallback);
    const out = fn(data) ?? data;
    writeJson(file, out);
    return out;
  });

// The hashes of known passages, one per line. New hashes are appended, and the file is compacted when
// duplicate lines outnumber the distinct hashes.
const knownFile = (env) => path.join(stateDir(env), "known-passages.txt");
export const passageKey = (text) => sha1(text.replace(/\s+/g, " ").trim()).slice(0, 16);

export function knownPassages(env = process.env) {
  let lines;
  try {
    lines = fs.readFileSync(knownFile(env), "utf8").split("\n").filter(Boolean);
  } catch {
    return new Set();
  }
  const set = new Set(lines);
  if (lines.length > 1000 && lines.length > set.size * 2) {
    withLock(knownFile(env), () => atomicWrite(knownFile(env), [...set].join("\n") + "\n"));
  }
  return set;
}

export function addKnown(keys, env = process.env) {
  if (!keys.length) return;
  fs.mkdirSync(stateDir(env), { recursive: true });
  withLock(knownFile(env), () => fs.appendFileSync(knownFile(env), keys.join("\n") + "\n"));
}

// The roots whose existing text has been recorded as known: a project's work tree, and ~/.claude.
const rootsFile = (env) => path.join(stateDir(env), "roots.json");
export const isSetUp = (root, env = process.env) => Boolean(readJson(rootsFile(env), {})[keyOf(root)]);
export const markSetUp = (root, env = process.env) =>
  updateJson(rootsFile(env), {}, (r) => {
    r[keyOf(root)] = new Date().toISOString();
  });

// Files whose English text was listed for the readers and has not yet been accepted: no other session
// records their text as known.
const unreadFile = (env) => path.join(stateDir(env), "unread.json");
export const unreadFiles = (env = process.env) => readJson(unreadFile(env), {});
export const markUnread = (paths, sessionId, env = process.env) =>
  paths.length && updateJson(unreadFile(env), {}, (u) => paths.forEach((p) => (u[keyOf(p)] = { session: sessionId, path: p })));
export const clearUnread = (paths, env = process.env) =>
  paths.length && updateJson(unreadFile(env), {}, (u) => paths.forEach((p) => delete u[keyOf(p)]));

export const sessionDir = (id, env = process.env) => path.join(stateDir(env), "sessions", id);
const sessionFile = (env, id) => path.join(stateDir(env), "sessions", `${id}.json`);

export const getSession = (id, env = process.env) => readJson(sessionFile(env, id), null);

export function newSession() {
  return { startedAt: Date.now(), touched: [], changed: [], batches: {}, nextBatch: 1, read: [], bashSince: null, lastScan: null };
}

export const saveSession = (id, s, env = process.env) => writeJson(sessionFile(env, id), s);

/** Reads, changes and saves a session's record under its lock. */
export const updateSession = (id, fn, env = process.env) => updateJson(sessionFile(env, id), newSession(), fn);

const checkedFile = (env) => path.join(stateDir(env), "checked.json");
export const messageKey = (message) => sha1(message.replace(/\s+/g, " ").trim());

export const markChecked = (kind, key, env = process.env) =>
  updateJson(checkedFile(env), {}, (all) => {
    all[`${kind}:${key}`] = new Date().toISOString();
  });

export const isChecked = (kind, key, env = process.env) => Boolean(readJson(checkedFile(env), {})[`${kind}:${key}`]);

// The state folder: baselines (the content of each file as the readers last read it), sessions,
// the files with unread English, the passages already known, and checked commit messages and pushes.
// Every read-and-rewrite of a shared file runs under a lock, and every write goes through a rename,
// so that two sessions at once never lose each other's entries.
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

/** Runs `fn` while holding `<file>.lock`; a lock older than 30 s is taken as left by a dead process. */
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

const indexFile = (env) => path.join(stateDir(env), "baselines.json");
const contentFile = (env, p) => path.join(stateDir(env), "baselines", sha1(keyOf(p)) + ".txt");

export const baselineIndex = (env = process.env) => readJson(indexFile(env), {});

export function getBaseline(p, env = process.env, index = baselineIndex(env)) {
  const rec = index[keyOf(p)];
  if (!rec) return null;
  try {
    return { ...rec, text: fs.readFileSync(contentFile(env, p), "utf8") };
  } catch {
    return null;
  }
}

/** Records the baselines of many files with one locked update of the index. */
export function setBaselines(items, env = process.env, onText = () => {}) {
  if (!items.length) return;
  for (const { path: p, text } of items) {
    atomicWrite(contentFile(env, p), text);
    onText(text);
  }
  updateJson(indexFile(env), {}, (index) => {
    for (const { path: p, text, mtimeMs } of items) index[keyOf(p)] = { mtimeMs, hash: sha1(text) };
  });
}

export const setBaseline = (p, text, mtimeMs, env = process.env) => setBaselines([{ path: p, text, mtimeMs }], env);

// The hashes of passages already read or already present in a baseline, one per line, appended.
const knownFile = (env) => path.join(stateDir(env), "known-passages.txt");
export const passageKey = (text) => sha1(text.replace(/\s+/g, " ").trim()).slice(0, 16);

export function knownPassages(env = process.env) {
  try {
    return new Set(fs.readFileSync(knownFile(env), "utf8").split("\n").filter(Boolean));
  } catch {
    return new Set();
  }
}

export function addKnown(keys, env = process.env) {
  if (!keys.length) return;
  fs.mkdirSync(stateDir(env), { recursive: true });
  fs.appendFileSync(knownFile(env), keys.join("\n") + "\n");
}

// Files whose English was listed for the readers and not yet accepted: never absorbed at a session start.
const unreadFile = (env) => path.join(stateDir(env), "unread.json");
export const unreadFiles = (env = process.env) => readJson(unreadFile(env), {});
export const markUnread = (paths, sessionId, env = process.env) =>
  paths.length && updateJson(unreadFile(env), {}, (u) => paths.forEach((p) => (u[keyOf(p)] = sessionId)));
export const clearUnread = (paths, env = process.env) =>
  paths.length && updateJson(unreadFile(env), {}, (u) => paths.forEach((p) => delete u[keyOf(p)]));

export const sessionDir = (id, env = process.env) => path.join(stateDir(env), "sessions", id);
const sessionFile = (env, id) => path.join(stateDir(env), "sessions", `${id}.json`);

export const getSession = (id, env = process.env) => readJson(sessionFile(env, id), null);

export function newSession() {
  const now = Date.now();
  return { startedAt: now, since: now, touched: [], round: 0, listed: {} };
}

export const saveSession = (id, s, env = process.env) => writeJson(sessionFile(env, id), s);

/** Reads, changes and saves a session under its lock. */
export const updateSession = (id, fn, env = process.env) => updateJson(sessionFile(env, id), newSession(), fn);

const checkedFile = (env) => path.join(stateDir(env), "checked.json");
export const messageKey = (message) => sha1(message.replace(/\s+/g, " ").trim());

export const markChecked = (kind, key, env = process.env) =>
  updateJson(checkedFile(env), {}, (all) => {
    all[`${kind}:${key}`] = new Date().toISOString();
  });

export const isChecked = (kind, key, env = process.env) => Boolean(readJson(checkedFile(env), {})[`${kind}:${key}`]);

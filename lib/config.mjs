// The configuration: defaults merged with the user's config file, and how the checks classify a path.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { matchesAny } from "./glob.mjs";

export const DEFAULTS = {
  language: "Russian",
  languageCode: "ru",
  terms: ["~/.claude/skills/vt/terms-ru.md"],
  project: {
    include: ["**/*.md", "**/*.mdx", "specs/**/*.json", ".ai_docs/**/*.json", "**/*.{ts,tsx,js,mjs,cjs,py}"],
    exclude: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**", "**/coverage/**", "**/*.min.js", "**/package-lock.json"],
    articles: ["**/articles/**"],
    // Folders git ignores whose files are still in scope: the agent's working notes.
    ignoredInScope: [".ai_docs"],
  },
  user: {
    include: ["CLAUDE.md", "skills/**/*.md", "agents/**/*.md", "projects/*/memory/**/*.md", ".ai_docs/**/*.md"],
    exclude: ["skills/.trash/**", "**/node_modules/**", "**/.git/**"],
    notInstruction: [".ai_docs/**"],
  },
  instruction: ["**/CLAUDE.md", "**/AGENTS.md", "**/SKILL.md", ".claude/**/*.md"],
  limits: { sentenceWords: 25, chunkWords: 2500, warnings: 20, rounds: 2, maxFiles: 20000 },
};

export const homeDir = (env = process.env) => env.ENGSTICKLER_USER_HOME || os.homedir();
export const claudeDir = (env = process.env) => path.join(homeDir(env), ".claude");
export const stateDir = (env = process.env) => env.ENGSTICKLER_HOME || path.join(claudeDir(env), "engstickler");

export const expandHome = (p, env = process.env) => (p.startsWith("~/") ? path.join(homeDir(env), p.slice(2)) : p);

const merge = (base, over) => {
  if (Array.isArray(base) || typeof base !== "object" || base === null) return over ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over ?? {})) out[k] = merge(base[k], v);
  return out;
};

export function loadConfig(env = process.env) {
  let user = {};
  try {
    user = JSON.parse(fs.readFileSync(path.join(stateDir(env), "config.json"), "utf8"));
  } catch {
    // No config file: the defaults apply.
  }
  return merge(DEFAULTS, user);
}

const norm = (p) => path.resolve(p).replace(/\\/g, "/");
const inside = (p, dir) => {
  const a = norm(p).toLowerCase();
  const b = norm(dir).toLowerCase().replace(/\/$/, "");
  return a === b || a.startsWith(b + "/");
};

/** The root that the configured globs are relative to for a file: ~/.claude, its git work tree, the cwd, or its directory. */
export function rootOf(absPath, { cwd, env = process.env } = {}) {
  const claude = claudeDir(env);
  if (inside(absPath, claude)) return { root: claude, user: true };
  const dir = path.dirname(absPath);
  if (fs.existsSync(dir)) {
    const r = spawnSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
    if (r.status === 0 && r.stdout.trim()) return { root: path.resolve(r.stdout.trim()), user: false };
  }
  if (cwd && inside(absPath, cwd)) return { root: path.resolve(cwd), user: false };
  return { root: dir, user: false };
}

const kindOf = (rel) => {
  if (/\.(md|mdx)$/i.test(rel)) return "markdown";
  if (/\.json$/i.test(rel)) return "json";
  if (/\.(ts|tsx|js|mjs|cjs|py)$/i.test(rel)) return "code";
  return null;
};

/** How the checks classify a path, or null if it is out of scope. */
export function classify(absPath, cfg, { cwd, env = process.env, root } = {}) {
  const r = root ? { root, user: inside(absPath, claudeDir(env)) } : rootOf(absPath, { cwd, env });
  const rel = path.relative(r.root, absPath).replace(/\\/g, "/");
  if (rel.startsWith("..")) return null;
  const kind = kindOf(rel);
  if (!kind) return null;
  if (r.user) {
    if (!matchesAny(rel, cfg.user.include) || matchesAny(rel, cfg.user.exclude ?? [])) return null;
    return { root: r.root, rel, kind, instruction: !matchesAny(rel, cfg.user.notInstruction), article: false };
  }
  if (!matchesAny(rel, cfg.project.include) || matchesAny(rel, cfg.project.exclude)) return null;
  return {
    root: r.root,
    rel,
    kind,
    instruction: matchesAny(rel, cfg.instruction),
    article: matchesAny(rel, cfg.project.articles),
  };
}

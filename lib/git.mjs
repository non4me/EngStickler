// Recognising a commit and a push in a shell command, finding the commit's message, and finding what a push
// would send.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { classify } from "./config.mjs";
import { changedPassages, isEnglishProse } from "./extract.mjs";

const git = (cwd, args) => {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
};

const BASH_HEREDOC = /<<-?\s*(['"]?)(\w+)\1[^\n]*\r?\n([\s\S]*?)\r?\n[ \t]*\2[ \t]*(?=\r?\n|$)/g;
const PS_HERESTRING = /@(['"])\r?\n([\s\S]*?)\r?\n\1@/g;

/**
 * The command with each heredoc body and each PowerShell here-string replaced by a placeholder, and the
 * bodies by placeholder: their text must never read as a command.
 */
function lift(cmd) {
  const bodies = [];
  const keep = (body) => `\u0000H${bodies.push(body) - 1}\u0000`;
  const out = cmd.replace(BASH_HEREDOC, (_, _q, _tag, body) => `<<${keep(body)}`).replace(PS_HERESTRING, (_, _q, body) => keep(body));
  return { cmd: out, bodies };
}

const unlift = (s, bodies) => s.replace(/\u0000H(\d+)\u0000/g, (_, i) => bodies[Number(i)]);

/** Splits a command line into its simple commands, each as a list of words with quotes resolved. */
function simpleCommands(cmd) {
  const cmds = [];
  let words = [];
  let word = null;
  const end = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  const endCmd = () => {
    end();
    if (words.length) cmds.push(words);
    words = [];
  };
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (c === "'") {
      const j = cmd.indexOf("'", i + 1);
      word = (word ?? "") + cmd.slice(i + 1, j < 0 ? cmd.length : j);
      i = j < 0 ? cmd.length : j;
    } else if (c === '"') {
      let s = "";
      let j = i + 1;
      for (; j < cmd.length && cmd[j] !== '"'; j++) {
        if (cmd[j] === "\\" && /["\\$`]/.test(cmd[j + 1] ?? "")) s += cmd[++j];
        else if (cmd[j] === "`" && /["`$]/.test(cmd[j + 1] ?? "")) s += cmd[++j];
        else s += cmd[j];
      }
      word = (word ?? "") + s;
      i = j;
    } else if (c === ";" || c === "\n" || c === "|" || c === "&" || c === "(" || c === ")") {
      endCmd();
    } else if (/\s/.test(c)) end();
    else word = (word ?? "") + c;
  }
  endCmd();
  return cmds;
}

/** The git invocations of a command line: each with its options before the subcommand, the subcommand and its arguments. */
function gitCalls(cmdLine) {
  const { cmd, bodies } = lift(cmdLine);
  const calls = [];
  let cdDir = null;
  for (const words of simpleCommands(cmd)) {
    let i = 0;
    while (i < words.length && /^\w+=/.test(words[i])) i++;
    const exe = words[i];
    if (exe === "cd" || exe === "Set-Location" || exe === "pushd") {
      cdDir = words[i + 1] ?? null;
      continue;
    }
    if (!/^(git|git\.exe|.*[\\/]git(\.exe)?)$/.test(exe ?? "")) continue;
    i++;
    let dir = cdDir;
    while (i < words.length && words[i].startsWith("-")) {
      if (words[i] === "-C") dir = dir && words[i + 1] && !path.isAbsolute(words[i + 1]) ? path.join(dir, words[i + 1]) : words[i + 1];
      i += ["-C", "-c", "--git-dir", "--work-tree"].includes(words[i]) ? 2 : 1;
    }
    calls.push({ sub: words[i], args: words.slice(i + 1).map((w) => unlift(w, bodies)), dir, bodies });
  }
  return calls;
}

export const isCommit = (cmd) => gitCalls(cmd).some((c) => c.sub === "commit");
export const isPush = (cmd) => gitCalls(cmd).some((c) => c.sub === "push");

/** A git call that moves HEAD or brings in commits, so that what a push in the same line sends is unknown beforehand. */
export const movesHead = (cmd) => gitCalls(cmd).some((c) => ["commit", "merge", "rebase", "pull", "cherry-pick", "am", "reset", "revert"].includes(c.sub));

/**
 * The message a `git commit` call gives: `{message}`; `{message: null}` when it names none (it opens an editor
 * or reuses a message); `{unreadable: true}` when it names one this parser cannot read.
 */
export function commitMessage(cmdLine, cwd = ".") {
  const call = gitCalls(cmdLine).find((c) => c.sub === "commit");
  if (!call) return { message: null };
  const parts = [];
  let named = false;
  const a = call.args;
  for (let i = 0; i < a.length; i++) {
    const w = a[i];
    let value = null;
    let file = null;
    if (/^-[a-zA-Z]*m$/.test(w) && !w.startsWith("--")) value = a[++i];
    else if (/^-m./.test(w)) value = w.slice(2);
    else if (w === "--message") value = a[++i];
    else if (w.startsWith("--message=")) value = w.slice(10);
    else if (w === "-F" || w === "--file") file = a[++i];
    else if (/^-F./.test(w)) file = w.slice(2);
    else if (w.startsWith("--file=")) file = w.slice(7);
    else continue;
    named = true;
    if (file === "-") {
      const here = a.find((x) => x.startsWith("<<"));
      value = here ? here.slice(2) : null;
    } else if (file) {
      try {
        value = fs.readFileSync(path.resolve(cwd, call.dir ?? ".", file), "utf8");
      } catch {
        value = null;
      }
    }
    if (value !== null && value !== undefined) {
      const sub = value.match(/^\$\(cat\s*<<([\s\S]*)\)\s*$/);
      parts.push((sub ? sub[1] : value).trim());
    }
  }
  const message = parts.filter(Boolean).join("\n\n");
  if (named && !message) return { unreadable: true };
  return { message: message || null };
}

/** The refs a `git push` call sends, the folder it runs in, and whether it only deletes. */
export function pushTarget(cmdLine, cwd = ".") {
  const call = gitCalls(cmdLine).find((c) => c.sub === "push");
  if (!call) return null;
  const dir = path.resolve(cwd, call.dir ?? ".");
  const positional = [];
  let all = false;
  let del = false;
  const withValue = new Set(["--repo", "--receive-pack", "--exec", "-o", "--push-option", "--recurse-submodules"]);
  for (let i = 0; i < call.args.length; i++) {
    const w = call.args[i];
    if (w === "--all" || w === "--mirror" || w === "--branches") all = true;
    else if (w === "--delete" || w === "-d") del = true;
    else if (withValue.has(w)) i++;
    else if (!w.startsWith("-")) positional.push(w);
  }
  const specs = positional.slice(1);
  if (del) return { dir, refs: [] };
  if (all) return { dir, refs: ["--branches"] };
  if (!specs.length) return { dir, refs: ["HEAD"] };
  const refs = specs
    .map((s) => s.replace(/^\+/, "").split(":")[0])
    .filter((src) => src !== "" && !src.startsWith("refs/tags/"));
  return { dir, refs };
}

/** What pushing `refs` from `dir` would send that no remote has: the commits and the commit they start from. */
export function pushRange(dir, refs = ["HEAD"]) {
  if (!refs.length) return null;
  const revs = refs.flatMap((r) => (r === "--branches" ? ["--branches"] : [r]));
  const commits = (git(dir, ["rev-list", ...revs, "--not", "--remotes"]) ?? "").split("\n").filter(Boolean);
  if (!commits.length) return null;
  const heads = refs.map((r) => (r === "--branches" ? null : git(dir, ["rev-parse", r])?.trim())).filter(Boolean);
  const oldest = commits[commits.length - 1];
  const base = git(dir, ["rev-parse", `${oldest}^`])?.trim() ?? null;
  const key = [...commits].sort().join(",").slice(0, 4000);
  return { head: heads[0] ?? commits[0], base, commits, key };
}

/** The English that a push would send and that its base commit did not have, as pending entries for the thorough check. */
export function pushPending(target, cfg, env = process.env) {
  const range = pushRange(target.dir, target.refs);
  if (!range) return { range: null, pending: [] };
  const root = path.resolve(git(target.dir, ["rev-parse", "--show-toplevel"]).trim());
  const names = range.base
    ? git(root, ["diff", "--name-only", range.base, range.head])
    : git(root, ["ls-tree", "-r", "--name-only", range.head]);
  const pending = [];
  for (const rel of (names ?? "").split("\n").filter(Boolean)) {
    const abs = path.join(root, rel);
    const c = classify(abs, cfg, { root, env });
    if (!c) continue;
    const now = git(root, ["show", `${range.head}:${rel}`]);
    if (now === null) continue;
    const before = range.base ? git(root, ["show", `${range.base}:${rel}`]) ?? "" : "";
    const passages = changedPassages(before, now, c.kind);
    if (passages.length) pending.push({ path: abs, root, instruction: true, passages });
  }
  for (const sha of range.commits) {
    const msg = (git(root, ["log", "-1", "--format=%B", sha]) ?? "").trim();
    if (isEnglishProse(msg)) pending.push({ path: `commit ${sha.slice(0, 10)}`, root, instruction: true, passages: [{ where: "message", text: msg }] });
  }
  return { range, pending, root };
}

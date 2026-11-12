// The user's language. Everything particular to one language is in languages/<code>/:
// language.json (its name), calques.json (known calques in English written by its speakers),
// benchmark/ (known errors with their key), test/ (texts the calque list must not flag).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const LANGUAGES_DIR = fileURLToPath(new URL("../languages/", import.meta.url));

export const languageFile = (code, ...rel) => path.join(LANGUAGES_DIR, code, ...rel);

/** The codes of the languages the plugin has a folder for. */
export const listLanguages = () =>
  fs.readdirSync(LANGUAGES_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);

/** `{code, name}` of a language, or null when the plugin has no folder for it. */
export function languageInfo(code) {
  if (!code || !/^[a-z]{2,3}(-[A-Za-z0-9]+)?$/.test(code)) return null;
  try {
    return JSON.parse(fs.readFileSync(languageFile(code, "language.json"), "utf8"));
  } catch {
    return null;
  }
}

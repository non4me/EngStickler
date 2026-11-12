// Writes agents/reader-thorough.md from agents/reader.md: the same instructions, its own name, model and effort.
import fs from "node:fs";

const fast = fs.readFileSync(new URL("../agents/reader.md", import.meta.url), "utf8");
const swap = (text, from, to) => {
  if (!text.includes(from)) throw new Error(`not found in agents/reader.md: ${from}`);
  return text.replace(from, to);
};
let thorough = swap(fast, "name: reader\n", "name: reader-thorough\n");
thorough = swap(
  thorough,
  "description: EngStickler's fast reader.",
  "description: EngStickler's thorough reader, run beside the fast reader before a push and on instruction files.",
);
thorough = swap(thorough, "model: sonnet\neffort: high", "model: fable\neffort: medium");
fs.writeFileSync(new URL("../agents/reader-thorough.md", import.meta.url), thorough);

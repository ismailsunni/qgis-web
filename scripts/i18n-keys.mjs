// Lists the translatable strings (t("…") and N_("…") calls) in src/, and reports per language
// which are missing from src/i18n/<code>.json. With --write, adds missing keys (empty) to each file.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const keys = new Set();
for (const file of walk("src").filter((f) => /\.(ts|svelte)$/.test(f)))
  for (const [literal] of readFileSync(file, "utf8").matchAll(/(?<=\b(?:t|N_)\(\s*)(["'`])(?:\\.|(?!\1).)*\1/g)) keys.add(new Function(`return ${literal}`)());

const sorted = [...keys].sort();
for (const f of readdirSync("src/i18n").filter((f) => f.endsWith(".json"))) {
  const path = join("src/i18n", f);
  const dict = JSON.parse(readFileSync(path, "utf8"));
  const missing = sorted.filter((k) => !dict[k]);
  const unused = Object.keys(dict).filter((k) => !keys.has(k));
  console.log(`${f}: ${sorted.length - missing.length}/${sorted.length} translated, ${unused.length} unused`);
  if (process.argv.includes("--write")) writeFileSync(path, JSON.stringify(Object.fromEntries(sorted.map((k) => [k, dict[k] ?? ""])), null, 1) + "\n");
}
if (process.argv.includes("--list")) console.log(JSON.stringify(sorted, null, 1));

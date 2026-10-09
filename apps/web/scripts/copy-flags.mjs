// Copies the MIT-licensed country-flag-icons SVGs (3:2) into public/flags so
// flags render identically everywhere — Windows has no flag emoji glyphs, so
// regional-indicator emoji would show as bare letters there. Only the flags a
// page actually uses are ever requested. Runs before `dev` and `build`.
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const src = join(dirname(require.resolve("country-flag-icons/package.json")), "3x2");
const dest = join(here, "..", "public", "flags");

if (!existsSync(src)) {
  console.warn("copy-flags: country-flag-icons not installed; skipping");
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
let n = 0;
for (const f of readdirSync(src)) {
  if (!/^[A-Z]{2}\.svg$/.test(f)) continue;
  cpSync(join(src, f), join(dest, f));
  n++;
}
console.log(`copy-flags: ${n} flags → public/flags`);

// Inlines iterations.json into explorer.template.html so explorer.html opens
// straight from disk — no server, no fetch, no CORS. Re-run after editing either.
//
//   node blog/2-how-meridian-was-built/build-explorer.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const data = readFileSync(join(here, "iterations.json"), "utf8");
const template = readFileSync(join(here, "explorer.template.html"), "utf8");

if (!template.includes("__DATA__")) {
  throw new Error("explorer.template.html no longer has a __DATA__ placeholder");
}

// A literal </script> inside the JSON would close the host <script> tag early.
const safe = JSON.stringify(JSON.parse(data)).replaceAll("</", "<\\/");
const out = template.replace("__DATA__", () => safe);

writeFileSync(join(here, "explorer.html"), out);
console.log(
  `explorer.html — ${JSON.parse(data).iterations.length} iterations, ` +
    `${(out.length / 1024).toFixed(0)} kB`,
);

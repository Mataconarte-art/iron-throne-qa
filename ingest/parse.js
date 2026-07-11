// ingest/parse.js  (Phase 1 — step 1: extract + sample)
// Extracts each PDF in ingest/data/ to a raw .txt in ingest/out/,
// and prints sample windows so we can calibrate cleaning + chapter
// detection to the REAL text formatting before writing chunk logic.
//
// Usage: node ingest/parse.js
// Requires: npm install pdf-parse@1.1.1

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, basename } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pdf = require("pdf-parse/lib/pdf-parse.js");

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, "data");
const OUT_DIR = join(HERE, "out");

// short, stable id per source file (edit if you like)
function idFor(filename) {
  const f = filename.toLowerCase();
  if (f.includes("bundle") || f.includes("game of thrones")) return "bundle-1-4";
  if (f.includes("fire")) return "fire-and-blood";
  if (f.includes("knight")) return "knight-seven-kingdoms";
  return basename(filename, ".pdf").replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 40);
}

function sample(text, frac, len = 900) {
  const start = Math.max(0, Math.floor(text.length * frac));
  return text.slice(start, start + len);
}

await mkdir(OUT_DIR, { recursive: true });

const files = (await readdir(DATA_DIR)).filter((f) => extname(f).toLowerCase() === ".pdf");
if (files.length === 0) {
  console.log(`No PDFs in ${DATA_DIR}`);
  process.exit(0);
}

for (const f of files.sort()) {
  const id = idFor(f);
  const buf = await readFile(join(DATA_DIR, f));
  const data = await pdf(buf);
  const raw = data.text || "";
  const outPath = join(OUT_DIR, `raw-${id}.txt`);
  await writeFile(outPath, raw, "utf8");

  console.log("\n" + "=".repeat(80));
  console.log(`SOURCE: ${f}`);
  console.log(`id=${id}  pages=${data.numpages}  chars=${raw.length}  -> ${basename(outPath)}`);
  console.log("=".repeat(80));

  for (const frac of [0.0, 0.12, 0.5]) {
    console.log(`\n----- sample @ ${Math.round(frac * 100)}% -----`);
    // show whitespace/newlines explicitly so heading structure is visible
    console.log(JSON.stringify(sample(raw, frac)).slice(1, -1));
  }
}

console.log(
  "\n\nDone. Raw text written to ingest/out/. " +
  "Paste the samples above back so chapter/book detection can be calibrated.\n"
);

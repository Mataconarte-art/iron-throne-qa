// ingest/check-pdfs.js
// Diagnostic: is each PDF real selectable text, or a scanned image?
// Usage: node ingest/check-pdfs.js
// Requires: npm install pdf-parse@1.1.1

import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// Require the internal implementation directly. pdf-parse's index.js wrapper
// runs debug/test code and doesn't export cleanly under ESM, which causes
// "pdf is not a function". The lib file exports the function directly.
const pdf = require("pdf-parse/lib/pdf-parse.js");

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "data");

// Below this many extracted characters per page, a PDF is almost
// certainly a scan (images of pages) with little or no embedded text.
const SCANNED_THRESHOLD = 100;

function verdict(charsPerPage) {
  if (charsPerPage >= 800) return "TEXT      ✅ real selectable text";
  if (charsPerPage >= SCANNED_THRESHOLD) return "PARTIAL   ⚠️  some text (maybe mixed / sparse)";
  return "SCANNED   ❌ image-only, needs OCR";
}

const files = (await readdir(DATA_DIR)).filter((f) => extname(f).toLowerCase() === ".pdf");

if (files.length === 0) {
  console.log(`No PDFs found in ${DATA_DIR}`);
  console.log("Drop your book PDFs into ingest/data/ and run again.");
  process.exit(0);
}

console.log(`\nChecking ${files.length} PDF(s) in ingest/data/\n`);
console.log("file".padEnd(42), "pages".padStart(6), "chars/pg".padStart(10), "  verdict");
console.log("-".repeat(90));

let anyScanned = false;
for (const f of files.sort()) {
  try {
    const buf = await readFile(join(DATA_DIR, f));
    const data = await pdf(buf);
    const pages = data.numpages || 1;
    const chars = (data.text || "").replace(/\s+/g, " ").trim().length;
    const perPage = Math.round(chars / pages);
    if (perPage < SCANNED_THRESHOLD) anyScanned = true;
    const name = f.length > 40 ? f.slice(0, 37) + "..." : f;
    console.log(name.padEnd(42), String(pages).padStart(6), String(perPage).padStart(10), "  " + verdict(perPage));
  } catch (err) {
    console.log(f.slice(0, 40).padEnd(42), "  ERROR:", err.message);
  }
}

console.log("-".repeat(90));
console.log(
  anyScanned
    ? "\n→ At least one PDF looks scanned. We'll add an OCR step (Colab) for those.\n"
    : "\n→ All PDFs have real text. Ingest stays simple and local — no OCR needed.\n"
);

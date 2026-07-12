// Phase 1 — load: upsert embedded vectors into Cloudflare Vectorize.
//
// Reads ingest/out/embeddings.ndjson (produced by embed.js) and inserts it into
// the `iron-throne` index via `wrangler vectorize insert`. Cloudflare caps each
// NDJSON upload at 5000 vectors, so we split into parts and insert each.
//
// PREREQUISITE (one-time, before first load): the bookId metadata index must
// exist so source filtering works —
//   npx wrangler vectorize create-metadata-index iron-throne --property-name=bookId --type=string
//
// `insert` errors on duplicate ids; use `upsert` to overwrite. Pass --upsert to
// this script (npm run ingest:load -- --upsert) to re-load without recreating.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const IN = path.join(ROOT, "ingest", "out", "embeddings.ndjson");
const PARTS_DIR = path.join(ROOT, "ingest", "out", "parts");

const INDEX = "iron-throne";
const MAX_PER_FILE = 5000; // Cloudflare hard cap per NDJSON upload
const MODE = process.argv.includes("--upsert") ? "upsert" : "insert";
// Local wrangler entry point — invoked directly via Node (see insertPart).
const WRANGLER = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");

function splitIntoParts() {
  if (!fs.existsSync(IN)) {
    console.error(`[ingest:load] Missing ${IN}. Run \`npm run ingest:embed\` first.`);
    process.exit(1);
  }
  fs.rmSync(PARTS_DIR, { recursive: true, force: true });
  fs.mkdirSync(PARTS_DIR, { recursive: true });

  const lines = fs.readFileSync(IN, "utf8").split(/\r?\n/).filter((l) => l.trim());
  const files = [];
  for (let i = 0; i < lines.length; i += MAX_PER_FILE) {
    const part = lines.slice(i, i + MAX_PER_FILE);
    const file = path.join(PARTS_DIR, `part-${String(files.length + 1).padStart(3, "0")}.ndjson`);
    fs.writeFileSync(file, part.join("\n") + "\n");
    files.push({ file, count: part.length });
  }
  console.log(`[ingest:load] ${lines.length} vectors → ${files.length} part file(s) of ≤${MAX_PER_FILE}.`);
  return files;
}

function insertPart({ file, count }, i, n) {
  console.log(`[ingest:load] (${i + 1}/${n}) ${MODE} ${count} vectors from ${path.basename(file)} …`);
  // Run the local wrangler entry point directly via Node (not npx.cmd). Node 20+
  // refuses to execFileSync a .cmd without a shell (EINVAL on Windows); invoking
  // wrangler.js through process.execPath avoids that and sidesteps shell-quoting
  // of the spaces in the repo path.
  execFileSync(
    process.execPath,
    [WRANGLER, "vectorize", MODE, INDEX, "--file", file],
    { cwd: ROOT, stdio: "inherit" }
  );
}

function main() {
  const files = splitIntoParts();
  files.forEach((f, i) => insertPart(f, i, files.length));
  console.log(`\n[ingest:load] Done. Confirm with:`);
  console.log(`  npx wrangler vectorize info ${INDEX}`);
  console.log(`[ingest:load] Note: Vectorize indexing is async — counts may lag a few minutes.`);
}

main();

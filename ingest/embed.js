// Phase 1 — embed: chunks.jsonl -> 384-dim vectors via Workers AI bge-small-en-v1.5.
//
// Runs LOCALLY (Node) and calls Workers AI over REST. The SAME model is used at
// query time via the [ai] binding (functions/_lib/retrieval.js) — do not change
// one without the other, or vectors won't be comparable.
//
// Output: ingest/out/embeddings.ndjson — one Vectorize record per line:
//   {"id","values":[384 floats],"metadata":{bookId,book,chunkIndex,text}}
// Resumable: reruns skip ids already present in the output file.
//
// Env (from .dev.vars, gitignored): CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN.

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const IN = path.join(ROOT, "ingest", "out", "chunks.jsonl");
const OUT = path.join(ROOT, "ingest", "out", "embeddings.ndjson");

const EMBED_MODEL = "@cf/baai/bge-small-en-v1.5"; // 384-dim, mean pooling (Workers AI default)
const DIM = 384;
const BATCH = 100; // Workers AI hard cap is 100 inputs per request
const MAX_RETRIES = 5;

// --- Minimal .dev.vars parser (KEY=VALUE, optional quotes; no dependency). ---
function loadDevVars() {
  const p = path.join(ROOT, ".dev.vars");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    if (line.trim().startsWith("#")) continue;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadDevVars();

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
if (!ACCOUNT_ID || !API_TOKEN) {
  console.error(
    "[ingest:embed] Missing CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN.\n" +
      "  Add them to .dev.vars (see .dev.vars.example). The token needs\n" +
      "  Workers AI (Read) + Vectorize (Edit)."
  );
  process.exit(1);
}
const URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${EMBED_MODEL}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function embedBatch(texts, attempt = 1) {
  const res = await fetch(URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: texts }),
  });

  if (res.status === 429 || res.status >= 500) {
    if (attempt > MAX_RETRIES) throw new Error(`HTTP ${res.status} after ${MAX_RETRIES} retries`);
    const wait = Math.min(30000, 1000 * 2 ** (attempt - 1)); // 1s,2s,4s,8s,16s
    console.warn(`  ↳ HTTP ${res.status}; retry ${attempt}/${MAX_RETRIES} in ${wait}ms`);
    await sleep(wait);
    return embedBatch(texts, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

  const json = await res.json();
  const data = json?.result?.data;
  if (!Array.isArray(data) || data.length !== texts.length) {
    throw new Error(`Unexpected response shape (got ${data?.length} vectors for ${texts.length} texts)`);
  }
  for (const v of data) {
    if (!Array.isArray(v) || v.length !== DIM) throw new Error(`Expected ${DIM}-dim, got ${v?.length}`);
  }
  return data;
}

// --- Which ids are already embedded (resume support). ---
function readDoneIds() {
  const done = new Set();
  if (!fs.existsSync(OUT)) return done;
  for (const line of fs.readFileSync(OUT, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { done.add(JSON.parse(line).id); } catch { /* ignore partial trailing line */ }
  }
  return done;
}

async function main() {
  if (!fs.existsSync(IN)) {
    console.error(`[ingest:embed] Missing ${IN}. Run \`npm run ingest:chunk\` first.`);
    process.exit(1);
  }
  const done = readDoneIds();
  if (done.size) console.log(`[ingest:embed] Resuming — ${done.size} chunks already embedded, skipping those.`);

  const out = fs.createWriteStream(OUT, { flags: "a" });
  const rl = readline.createInterface({ input: fs.createReadStream(IN), crlfDelay: Infinity });

  let pending = []; // { id, bookId, book, chunkIndex, text }
  let total = 0, embedded = 0;

  async function flush() {
    if (!pending.length) return;
    const vecs = await embedBatch(pending.map((c) => c.text));
    for (let i = 0; i < pending.length; i++) {
      const c = pending[i];
      out.write(
        JSON.stringify({
          id: c.id,
          values: vecs[i],
          metadata: { bookId: c.bookId, book: c.book, chunkIndex: c.chunkIndex, text: c.text },
        }) + "\n"
      );
    }
    embedded += pending.length;
    process.stdout.write(`\r  embedded ${embedded} (scanned ${total})   `);
    pending = [];
  }

  for await (const line of rl) {
    if (!line.trim()) continue;
    total++;
    const c = JSON.parse(line);
    if (done.has(c.id)) continue;
    pending.push(c);
    if (pending.length >= BATCH) await flush();
  }
  await flush();
  await new Promise((r) => out.end(r));

  console.log(`\n[ingest:embed] Done. Newly embedded ${embedded}; output → ingest/out/embeddings.ndjson`);
  console.log(`[ingest:embed] Next: \`npm run ingest:load\``);
}

main().catch((e) => {
  console.error(`\n[ingest:embed] FAILED: ${e.message}`);
  console.error("  (Safe to rerun — already-embedded chunks are skipped.)");
  process.exit(1);
});

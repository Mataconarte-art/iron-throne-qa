// extract-edges — Phase 2. Mine genealogy relations (parent / spouse) from the
// corpus with an LLM, so the curated seed can be AUGMENTED with reviewed facts.
//
// This is the "extraction" half of "curated seed + reviewed extraction". It runs
// LOCALLY (Node) and calls a Workers AI text model over REST — the same auth
// pattern as ingest/embed.js. It NEVER writes to the graph directly: it emits
// CANDIDATES for a human to approve (ingest/review-edges.js). Curated data stays
// the source of truth; a single wrong edge tanks genealogy accuracy (critique 3).
//
// Output: ingest/out/edge-candidates.jsonl — one candidate per line:
//   { type, from?, to?, a?, b?, rawSubject, rawObject, relation, evidence,
//     chunkId, bookId, resolved, status:"pending" }
// Resumable: reruns skip chunkIds already processed.
//
// Usage (from repo root):
//   node ingest/extract-edges.js                  # default: Fire & Blood (fab)
//   node ingest/extract-edges.js --books=fab,agot # widen the corpus
//   node ingest/extract-edges.js --limit=200      # cap chunks (cost control)
//   node ingest/extract-edges.js --model=@cf/meta/llama-3.1-70b-instruct
//
// Env (from .dev.vars): CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN (Workers AI Read).

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { buildGraph, normalizeName } from "../graph/compile.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const IN = path.join(ROOT, "ingest", "out", "chunks.jsonl");
const SEED = path.join(ROOT, "graph", "seed-targaryen.json");
const REVIEWED = path.join(ROOT, "graph", "reviewed-edges.json");
const OUT = path.join(ROOT, "ingest", "out", "edge-candidates.jsonl");

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
}));
const BOOKS = (args.books ? String(args.books) : "fab").split(",").map((s) => s.trim()).filter(Boolean);
const LIMIT = args.limit ? parseInt(args.limit, 10) : Infinity;
const MODEL = args.model ? String(args.model) : "@cf/meta/llama-3.1-8b-instruct";
const MAX_RETRIES = 5;

// --- .dev.vars loader (same as embed.js) ---
function loadDevVars() {
  const p = path.join(ROOT, ".dev.vars");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    if (line.trim().startsWith("#")) continue;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadDevVars();
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
if (!ACCOUNT_ID || !API_TOKEN) {
  console.error("[extract-edges] Missing CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN (see .dev.vars.example).");
  process.exit(1);
}
const URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${MODEL}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- resolution against the compiled graph (compiled here from the same
//     sources the Function uses, so the alias index is identical). ---
const seedData = JSON.parse(fs.readFileSync(SEED, "utf8"));
const reviewedData = fs.existsSync(REVIEWED) ? JSON.parse(fs.readFileSync(REVIEWED, "utf8")) : [];
const graph = buildGraph(seedData, reviewedData);
// Resolve a raw name to a node id: longest index key that is contained in the
// normalized name (or vice-versa). Returns id or null. Ambiguous -> null.
function resolveName(raw) {
  const n = normalizeName(raw);
  if (!n) return null;
  const exact = graph.index[n];
  if (exact && exact.length === 1) return exact[0];
  let best = null;
  for (const [k, ids] of Object.entries(graph.index)) {
    if (ids.length !== 1) continue;
    if (k.length < 5) continue;
    if (n === k || n.includes(k) || k.includes(n)) {
      if (!best || k.length > best.k.length) best = { k, id: ids[0] };
    }
  }
  return best ? best.id : null;
}

const SYSTEM = `You extract family relationships from A Song of Ice and Fire / Fire & Blood text.
Return ONLY a compact JSON array (no prose). Each item:
  {"subject":"<full name>","relation":"parent-of"|"spouse-of","object":"<full name>","evidence":"<short quote>"}
Rules:
- "parent-of": subject is the PARENT, object is the CHILD. Never reverse it.
- "spouse-of": subject and object are/were married.
- Use full names exactly as written. Do not invent relationships not stated in the text.
- If the passage states no clear family relationship, return [].`;

async function extractChunk(text, attempt = 1) {
  const res = await fetch(URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Passage:\n"""${text.slice(0, 4000)}"""\n\nJSON array:` },
      ],
      max_tokens: 800,
      temperature: 0,
    }),
  });
  if (res.status === 429 || res.status >= 500) {
    if (attempt > MAX_RETRIES) throw new Error(`HTTP ${res.status} after ${MAX_RETRIES} retries`);
    const wait = Math.min(30000, 1000 * 2 ** (attempt - 1));
    console.warn(`  ↳ HTTP ${res.status}; retry ${attempt}/${MAX_RETRIES} in ${wait}ms`);
    await sleep(wait);
    return extractChunk(text, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const raw = json?.result?.response ?? "";
  return parseJsonArray(raw);
}

// Models wrap JSON in prose / code fences sometimes. Extract the first [...] block.
function parseJsonArray(s) {
  if (!s) return [];
  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];
  try {
    const arr = JSON.parse(s.slice(start, end + 1));
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function toCandidate(rel, chunk) {
  const subjId = resolveName(rel.subject);
  const objId = resolveName(rel.object);
  const base = {
    rawSubject: rel.subject, rawObject: rel.object, relation: rel.relation,
    evidence: (rel.evidence || "").slice(0, 300),
    chunkId: chunk.id, bookId: chunk.bookId, status: "pending",
    resolved: !!(subjId && objId),
  };
  if (rel.relation === "parent-of") return { type: "parent", from: subjId, to: objId, ...base };
  if (rel.relation === "spouse-of") return { type: "spouse", a: subjId, b: objId, ...base };
  return null;
}

function readProcessedChunkIds() {
  const done = new Set();
  if (!fs.existsSync(OUT)) return done;
  for (const line of fs.readFileSync(OUT, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); if (r.__processed) done.add(r.__processed); else if (r.chunkId) done.add(r.chunkId); } catch {}
  }
  return done;
}

async function main() {
  if (!fs.existsSync(IN)) { console.error(`[extract-edges] Missing ${IN}. Run \`npm run ingest:chunk\` first.`); process.exit(1); }
  const processed = readProcessedChunkIds();
  console.log(`[extract-edges] model=${MODEL} books=[${BOOKS.join(",")}] limit=${LIMIT}`);
  if (processed.size) console.log(`[extract-edges] resuming — ${processed.size} chunks already processed.`);

  const out = fs.createWriteStream(OUT, { flags: "a" });
  const rl = readline.createInterface({ input: fs.createReadStream(IN), crlfDelay: Infinity });

  let scanned = 0, used = 0, candidates = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    let c; try { c = JSON.parse(line); } catch { continue; }
    if (!BOOKS.includes(c.bookId)) continue;
    if (processed.has(c.id)) continue;
    if (used >= LIMIT) break;
    scanned++; used++;

    let rels = [];
    try { rels = await extractChunk(c.text); }
    catch (e) { console.warn(`\n  chunk ${c.id}: ${e.message}`); continue; }

    for (const rel of rels) {
      const cand = toCandidate(rel, c);
      if (cand) { out.write(JSON.stringify(cand) + "\n"); candidates++; }
    }
    // Sentinel so resume knows this chunk was processed even if it yielded nothing.
    out.write(JSON.stringify({ __processed: c.id }) + "\n");
    if (used % 25 === 0) process.stdout.write(`\r  processed ${used} chunks, ${candidates} candidates   `);
  }
  await new Promise((r) => out.end(r));
  console.log(`\n[extract-edges] Done. ${used} chunks -> ${candidates} candidate edges -> ingest/out/edge-candidates.jsonl`);
  console.log(`[extract-edges] Next: \`node ingest/review-edges.js\` to approve/reject.`);
}

main().catch((e) => { console.error(`\n[extract-edges] FAILED: ${e.message}`); process.exit(1); });

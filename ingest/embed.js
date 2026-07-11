// Phase 0 stub. embed: chunks -> 384-dim vectors via Workers AI
// bge-small-en-v1.5. MUST match the query-time embedder in the Function.
const EMBED_MODEL = "@cf/baai/bge-small-en-v1.5"; // 384-dim
console.log(`[ingest:embed] stub — Phase 1. Model=${EMBED_MODEL} (384-dim). Same model used at query time.`);
process.exit(0);

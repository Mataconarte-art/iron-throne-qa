// Swappable vector-DB interface (critique 1). Vectorize is the default, but the
// free tier is bounded by stored *dimensions* (5M ≈ ~13k chunks at 384-dim), so
// retrieval must never bind to a single provider. Every backend implements the
// same shape: upsert(vectors), query(embedding, {topK, filter}).
//
// Contract for a match: { id, score, metadata: { work, locator, type, url, text } }

// --- Default: Cloudflare Vectorize (needs [[vectorize]] binding in wrangler.toml)
export function vectorizeStore(env) {
  return {
    name: "vectorize",
    async upsert(vectors) {
      if (!env.VECTORIZE) throw new Error("VECTORIZE binding not configured");
      return env.VECTORIZE.upsert(vectors);
    },
    async query(embedding, { topK = 8, filter } = {}) {
      if (!env.VECTORIZE) throw new Error("VECTORIZE binding not configured");
      const res = await env.VECTORIZE.query(embedding, {
        topK,
        filter,
        returnMetadata: true,
      });
      return (res.matches || []).map((m) => ({
        id: m.id,
        score: m.score,
        metadata: m.metadata || {},
      }));
    },
  };
}

// --- Fallbacks (implement when/if the corpus outgrows Vectorize free tier).
export function upstashStore(/* env */) {
  return {
    name: "upstash",
    async upsert() { throw new Error("upstashStore.upsert not implemented (Phase 1)"); },
    async query() { throw new Error("upstashStore.query not implemented (Phase 1)"); },
  };
}

export function qdrantStore(/* env */) {
  return {
    name: "qdrant",
    async upsert() { throw new Error("qdrantStore.upsert not implemented (Phase 1)"); },
    async query() { throw new Error("qdrantStore.query not implemented (Phase 1)"); },
  };
}

// Factory: pick backend by env, default Vectorize.
export function getVectorStore(env) {
  switch ((env && env.VECTOR_BACKEND) || "vectorize") {
    case "upstash": return upstashStore(env);
    case "qdrant": return qdrantStore(env);
    default: return vectorizeStore(env);
  }
}

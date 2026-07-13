// Hybrid retrieval behind one interface: vector hits (Vectorize) merged with
// graph-traversal facts, filtered by the selected sources.
//
// Phase 1 REAL path (vector side live; graph traversal is a later phase):
//   1. embed(question)  — Workers AI bge-small-en-v1.5, 384-dim (same as ingest)
//   2. getVectorStore(env).query(embedding, { topK, filter: sourceFilter(sources) })
//   3. normalize matches into the { work, locator, url, text } shape ask.js/adapter expect
//
// If the AI or VECTORIZE binding is missing (e.g. `wrangler pages dev` without
// remote bindings), we fall back to an empty result so the app shell still
// responds instead of 500-ing.

import { getVectorStore } from "./vectorStore.js";
import { queryGraph } from "./graph.js";

const EMBED_MODEL = "@cf/baai/bge-small-en-v1.5"; // MUST match ingest/embed.js
const TOP_K = 8;

// UI source category (checkbox `value` in public/index.html) -> corpus bookIds.
// bookIds come from ingest/chunk.js. Categories with no corpus yet (show/wiki)
// map to nothing and are simply dropped from the filter.
const SOURCE_TO_BOOKIDS = {
  "A Song of Ice and Fire": ["agot", "acok", "asos", "affc"], // + "adwd" once book 5 is ingested
  "fire-and-blood": ["fab"],
  "knight": ["kotsk"],
  // "got" / "hotd" (show transcripts) and "wiki" — Phase 2+, no vectors yet.
};

// Turn selected UI sources into a Vectorize metadata filter on bookId.
// Returns undefined when nothing maps (→ unfiltered query over all books).
export function sourceFilter(sources) {
  if (!sources || !sources.length) return undefined;
  const ids = [...new Set(sources.flatMap((s) => SOURCE_TO_BOOKIDS[s] || []))];
  if (!ids.length) return undefined;
  return { bookId: { $in: ids } };
}

async function embedQuestion(question, env) {
  const res = await env.AI.run(EMBED_MODEL, { text: [question] });
  const vec = res?.data?.[0];
  if (!Array.isArray(vec) || vec.length !== 384) {
    throw new Error(`Query embedding wrong shape: ${vec?.length}`);
  }
  return vec;
}

// Normalize a stored Vectorize match into the citation shape the adapter uses.
function toSnippet(m) {
  const md = m.metadata || {};
  return {
    id: m.id,
    score: m.score,
    metadata: {
      work: md.book,                     // e.g. "A Game of Thrones"
      locator: `chunk ${md.chunkIndex}`, // stable in-book locator
      type: "novel",
      bookId: md.bookId,
      url: null,                         // no per-passage URL for book text
      text: md.text,
    },
  };
}

export async function retrieve({ question, sources, env }) {
  const allowed = sources && sources.length ? sources : ["A Song of Ice and Fire"];

  // Graph traversal (Phase 2) is independent of the vector bindings — it reads
  // the bundled genealogy graph (or D1) — so it runs even in local dev without
  // remote AI/Vectorize. `queryGraph` never throws; a miss just returns [].
  const graphRes = await queryGraph(env, question);

  // Graceful fallback if vector bindings aren't present (local dev without
  // remote). We can still answer relational questions from the graph alone.
  if (!env || !env.AI || !env.VECTORIZE) {
    return {
      vector: [],
      graph: graphRes.facts,
      graphMeta: { relation: graphRes.relation, entities: graphRes.entities, ambiguous: graphRes.ambiguous },
      sourcesUsed: allowed,
      stub: true,
      note: "AI/VECTORIZE binding missing (graph still active)",
    };
  }

  const embedding = await embedQuestion(question, env);
  const store = getVectorStore(env);
  const matches = await store.query(embedding, { topK: TOP_K, filter: sourceFilter(allowed) });

  return {
    vector: matches.map(toSnippet),
    graph: graphRes.facts,
    graphMeta: { relation: graphRes.relation, entities: graphRes.entities, ambiguous: graphRes.ambiguous },
    sourcesUsed: allowed,
    stub: false,
  };
}

// Hybrid retrieval behind one interface: vector hits merged with graph-traversal
// facts, filtered by the selected sources. Phase 0 returns canned, source-tagged
// snippets so the end-to-end contract is exercised without any data loaded.
//
// Phase 1+ real path:
//   1. embed(question)  — Workers AI bge-small-en-v1.5, 384-dim (same as ingest)
//   2. getVectorStore(env).query(embedding, { topK, filter: sourceFilter(sources) })
//   3. graph facts: traverse graph/seed-targaryen.json for relational questions
//   4. merge + de-dupe + rank

// import { getVectorStore } from "./vectorStore.js";

export async function retrieve({ question, sources /*, env */ }) {
  // STUB: a single canned, cited snippet. Shape matches what the real
  // retriever will return so ask.js and the client never change.
  const allowed = sources && sources.length ? sources : ["novels"];
  return {
    vector: [
      {
        id: "stub-1",
        score: 1.0,
        metadata: {
          work: "Fire & Blood",
          locator: "The Heirs of the Dragon",
          type: "history",
          url: "https://awoiaf.westeros.org/index.php/Rhaenyra_Targaryen",
          text:
            "Rhaenyra Targaryen was the only daughter of King Viserys I Targaryen " +
            "and his first wife, Queen Aemma Arryn.",
        },
      },
    ],
    graph: [
      {
        subject: "Rhaenyra Targaryen",
        relation: "father",
        object: "Viserys I Targaryen",
        source: "seed-targaryen.json",
      },
    ],
    sourcesUsed: allowed,
    stub: true,
  };
}

// Turn UI source keys into a vector-store metadata filter (Phase 1 wiring).
export function sourceFilter(sources) {
  if (!sources || !sources.length) return undefined;
  return { work: { $in: sources } };
}

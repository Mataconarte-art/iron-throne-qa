# Ingest pipeline (offline)

Runs **locally**, never deployed. Turns source files into a source-tagged,
384-dim vector index plus the genealogy graph. Book files live in `./data/`
(gitignored — copyright).

## Order

```bash
npm run ingest:parse    # source files -> normalized text + metadata
npm run ingest:chunk    # normalized text -> ~few-hundred-token chunks (coarse side)
npm run ingest:embed    # chunks -> 384-dim vectors (Workers AI bge-small-en-v1.5)
npm run ingest:load     # vectors -> Vectorize (or swapped backend)
npm run ingest:graph    # curated seed + reviewed extraction -> graph
```

## Rules that keep us under the free tier / correct

- **384-dim embeddings**, chunk on the coarse side — Vectorize free tier is
  bounded by stored dimensions (~13k chunks at 384-dim).
- **Same embedder at ingest and query.** If you change the model here, change
  it in the Function too, or similarity is meaningless.
- Every chunk is tagged `{ work, book/season, chapter/episode, type, url }`.
- The genealogy graph is **seeded from curated data first**; LLM extraction is
  reviewed augmentation, not the source of truth.

## Phase 0 status

All five scripts are stubs that print their intended contract and exit. No data
is processed yet — that's Phase 1.

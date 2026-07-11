# Iron Throne Q&A

A single-user, private, **cited** Q&A app over the ASOIAF universe (the novels, *Fire & Blood*, *A Knight of the Seven Kingdoms*, plus the GoT + HotD shows and bounded wiki fill-in). The engineering bet is that correctness lives in **retrieval, not generation**: a small, swappable model writes the sentence; a hybrid vector search over source-tagged chunks plus a **genealogy knowledge graph** supply the facts and the citations.

> **Status: Phase 0 — setup & scaffold.** Theme-aware PWA shell + stub serverless functions. No book data, no real retrieval yet.

## Architecture at a glance

**Offline (one-time)**: parse → clean → chunk → tag `{work, book/season, chapter/episode, type, url}` → embed (384-dim) → load into vector DB. Separately, extract characters + relations into a graph.

**Online (per query)**: PWA sends question + source filter → Function checks auth → embeds question (same model as ingest) → filters candidates by selected sources → merges vector hits with graph-traversal facts → prompts a model through an adapter to answer **only** from retrieved material, one citation per claim, refusing when sources don't cover it.

Everything targets **free tiers**, with two things swappable behind interfaces from day one: the **inference model** (`_lib/modelAdapter.js`) and the **vector DB** (`_lib/vectorStore.js`).

## Key decisions (locked for Phase 0)

- **Embeddings:** Workers AI `bge-small-en-v1.5`, **384-dim**, same model at ingest and query — keeps under the Vectorize free-tier ceiling (5M stored *dimensions* ≈ 13k chunks at 384-dim) and guarantees dimensional consistency.
- **Vector DB:** Cloudflare Vectorize by default, behind a swappable interface (Upstash Vector / Qdrant Cloud as fallbacks if the corpus outgrows the free tier).
- **Graph store:** bundled in-memory `graph/seed-targaryen.json` for v1; migrate to Cloudflare D1 (`graph/schema.sql`) only if it grows.
- **Genealogy source of truth:** a hand-curated Targaryen (+ major-house) backbone; LLM relation extraction is reviewed *augmentation*, not the primary path.
- **Auth:** server-side token check in the Function before any retrieval; book text lives server-side only.
- **Inference:** Gemini 3 Flash free tier by default; Groq / Cerebras alternates; optional local Gemma via Ollama with auto-fallback.

## Repo layout

```
public/       theme-aware installable PWA (served by Cloudflare Pages)
functions/    Cloudflare Pages Functions (server side) — Phase 0 stubs
  api/        ask.js (stub cited answer), health.js
  _lib/       auth, modelAdapter, retrieval, vectorStore interfaces
ingest/       offline pipeline (runs locally, NOT deployed)
graph/        curated genealogy seed + D1 schema
eval/         10-question test set + hybrid scorer harness
docs/         strategy, roadmap, test questions, phase notes
```

## Local development

Requires **Node 22+** and a Cloudflare account (for later phases).

```bash
npm install
cp .dev.vars.example .dev.vars   # then edit AUTH_TOKEN
npm run dev                      # wrangler pages dev — serves public/ + functions/
```

Open the printed localhost URL. `/api/health` should return ok; `/api/ask` returns a canned cited answer; the theme switcher cycles Blackfyre / Old Valyria / The Wall.

## Deploy (Phase 0 exit)

```bash
npx wrangler login
npm run deploy                   # wrangler pages deploy public
```

Then install the PWA on your phone from the deployed URL (Add to Home Screen).

## Phase 0 exit criteria

- [ ] PWA shell deployed to a Cloudflare Pages URL
- [ ] Installable on iPhone/iPad/desktop; works as a plain tab too
- [ ] `/api/health` live; `/api/ask` returns a canned cited answer
- [ ] Theme switcher cycles all three looks, persisted in `localStorage`
- [ ] Repo pushed to git (private)

See `docs/phase0-notes.md` for the running log and next steps.

# Iron Throne Q&A — Handoff v2 (Phase 1 code DONE → run + verify remaining)

Resume point for a fresh chat. All Phase 1 code is written and syntax-checked.
What's left is *running* the ingest against your Cloudflare account and verifying
end-to-end — the parts that can't run from the assistant sandbox.

## Where things stand

- **Phase 0 — DONE** (scaffold + deploy). See `PHASE-0-SUMMARY.md`.
- **Phase 1 — parse + chunk DONE** (8,800 chunks in `ingest/out/chunks.jsonl`).
- **Phase 1 — embed/load/query code DONE this session.** Not yet run.

## What was written this session

| File | Change |
|---|---|
| `wrangler.toml` | Activated `[ai]` + `[[vectorize]]` (index `iron-throne`). D1 block still commented until its id is pasted. |
| `ingest/embed.js` | Real embedder: `chunks.jsonl` → Workers AI `bge-small-en-v1.5` over REST, batches of 100, retry/backoff, **resumable** → `ingest/out/embeddings.ndjson`. |
| `ingest/load.js` | Splits embeddings into ≤5,000-vector NDJSON parts (→ 5000 + 3800) and `wrangler vectorize insert`s each. `-- --upsert` to reload. |
| `functions/_lib/retrieval.js` | Real `retrieve()`: embeds question (same model), queries Vectorize, filters by a **source→bookId** map. |
| `functions/_lib/vectorStore.js` | `returnMetadata: "all"` so passage `text` comes back. |
| `functions/_lib/modelAdapter.js` | Meta string updated to "phase 1 — retrieval live". |
| `.dev.vars` / `.dev.vars.example` | Added `CLOUDFLARE_ACCOUNT_ID` (set) + `CLOUDFLARE_API_TOKEN` (blank). |
| `.gitignore` | **Fixed** — the `ingest/out/` rule was corrupted (stray PowerShell `echo >>` as UTF-16). Book text is now properly ignored; `git ls-files` confirms none tracked. |

## Key facts / locked decisions (unchanged)

- **Embedding model:** `@cf/baai/bge-small-en-v1.5`, **384-dim**, mean pooling.
  IDENTICAL at ingest (`ingest/embed.js`) and query (`functions/_lib/retrieval.js`).
- **Vectorize index:** `iron-throne`, 384-dim, cosine. Metadata index on `bookId`
  MUST be created **before** inserting vectors (source filtering depends on it).
- **Source→bookId map** (in `retrieval.js`): Novels `A Song of Ice and Fire` →
  `[agot,acok,asos,affc]`; `fire-and-blood` → `[fab]`; `knight` → `[kotsk]`.
  Show/Wiki (`got`/`hotd`/`wiki`) have no corpus yet → fall through to unfiltered.
- **Cloudflare account ID:** `61f49617fffaae40b669331a1616c677` (already in `.dev.vars`).
- **Wrangler:** pinned **v3** (`node_modules` = 3.114.17). Run commands **from the
  repo root** so `npx wrangler` uses local v3 — running outside the repo pulls v4.
  If Wrangler prompts to auto-install "Cloudflare skills", answer **n**.

## Exact next steps (run on Windows, from repo root)

1. **API token** (only thing still missing): Cloudflare → My Profile → API Tokens →
   Create Token with **Workers AI (Read)** + **Vectorize (Edit)**. Paste into
   `CLOUDFLARE_API_TOKEN` in `.dev.vars`. (Provisioning + `vectorize insert` run on
   your existing OAuth login — token is only for `embed.js`'s REST calls.)

2. **Provision:**
   ```powershell
   npx wrangler vectorize create iron-throne --dimensions=384 --metric=cosine
   npx wrangler vectorize create-metadata-index iron-throne --property-name=bookId --type=string
   npx wrangler d1 create iron-throne-graph
   # paste database_id into wrangler.toml, uncomment [[d1_databases]], then:
   npx wrangler d1 execute iron-throne-graph --remote --file=graph/schema.sql
   ```

3. **Embed → Load:**
   ```powershell
   npm run ingest:embed        # resumable; rerun if a rate limit kills it
   npm run ingest:load
   npx wrangler vectorize info iron-throne   # expect ~8,800 vectors (async; may lag)
   ```

4. **Deploy + verify:**
   ```powershell
   npm run deploy
   ```
   Then POST to `/api/ask`:
   ```powershell
   $body = @{ question = "Who is Jon Snow's father?"; sources = @("A Song of Ice and Fire") } | ConvertTo-Json
   Invoke-RestMethod -Uri "https://iron-throne-qa.pages.dev/api/ask" -Method Post -ContentType "application/json" -Body $body
   ```

## Phase 1 exit criteria
- [ ] `vectorize info` shows ~8,800 vectors
- [ ] `/api/ask` returns a **real book passage** (not the Phase 0 Rhaenyra stub)
- [ ] Citation names the correct book
- [ ] Source filter narrows results (e.g. a `fire-and-blood`-scoped question cites
      *Fire & Blood*, not a novel)

Full detail: `docs/phase1-runbook.md`.

## Gotchas carried forward
- **OneDrive/bash caching:** the assistant sandbox saw stale file sizes for
  just-edited files — cosmetic, real files are correct. On your machine, pause
  OneDrive sync if git/npm throws "unable to access".
- **Git history purge (still pending):** book text was committed in `16f1b05`
  before being untracked. Repo is private+solo so not urgent, but before it ever
  goes public: `git filter-repo --path ingest/out --invert-paths --force`, re-add
  remote, force-push. Back up `ingest/out/` first.
- **A Dance with Dragons** (book 5) still missing — add `adwd` to the source map
  in `retrieval.js` once ingested.

## Task list state
- [x] Add Cloudflare bindings to wrangler.toml
- [x] Write embed.js (chunks → 384-dim vectors)
- [x] Write load.js (upsert into Vectorize)
- [x] Wire query-side retrieval + ask.js
- [ ] **Run** provisioning + embed + load (on your machine)
- [ ] **Verify** retrieval end-to-end

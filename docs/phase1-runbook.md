# Phase 1 — Ingest Runbook (provision → embed → load → verify)

All code is written and syntax-checked. These steps run on the **Windows dev
machine** against **your** Cloudflare account (they can't run from the assistant
sandbox). Run each from the repo root in PowerShell, in order.

## 0. One-time credentials for local ingest

`ingest/embed.js` calls Workers AI over REST and needs an account ID + token.

1. **Account ID:** Cloudflare dashboard → *Workers & Pages* → right sidebar.
2. **API token:** *My Profile → API Tokens → Create Token* (custom), permissions:
   - **Workers AI → Read**
   - **Vectorize → Edit**
3. Put both in `.dev.vars` (gitignored — see `.dev.vars.example`):

   ```
   CLOUDFLARE_ACCOUNT_ID="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
   CLOUDFLARE_API_TOKEN="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
   ```

## 1. Provision Cloudflare infra

```powershell
# Vector index — 384-dim / cosine to match bge-small-en-v1.5
npx wrangler vectorize create iron-throne --dimensions=384 --metric=cosine

# Metadata index on bookId — MUST exist BEFORE inserting vectors, or source
# filtering won't work.
npx wrangler vectorize create-metadata-index iron-throne --property-name=bookId --type=string

# D1 graph DB (infra now; query path wired in a later phase)
npx wrangler d1 create iron-throne-graph
# -> copy the printed database_id, paste into wrangler.toml under [[d1_databases]],
#    and uncomment that block. Then apply the schema:
npx wrangler d1 execute iron-throne-graph --remote --file=graph/schema.sql
```

`wrangler.toml` already has the `[ai]` and `[[vectorize]]` bindings active. Only
the D1 block is left commented until you paste its id.

## 2. Embed (chunks → 384-dim vectors)

```powershell
npm run ingest:embed
```

- Reads `ingest/out/chunks.jsonl` (8,800 chunks), calls Workers AI in batches of 100.
- Writes `ingest/out/embeddings.ndjson`.
- **Resumable:** if it dies on a rate limit, just rerun — already-embedded chunks
  are skipped. (~88 requests total; expect a few minutes.)

## 3. Load into Vectorize

```powershell
npm run ingest:load
```

- Splits the embeddings into `ingest/out/parts/part-*.ndjson` (≤5,000 each → 2 files)
  and runs `wrangler vectorize insert` on each.
- Re-loading later? `npm run ingest:load -- --upsert` (overwrites instead of erroring
  on duplicate ids).
- Confirm the count (indexing is async, may lag a few minutes):

  ```powershell
  npx wrangler vectorize info iron-throne
  ```

## 4. Verify end-to-end

Deploy (bindings only take effect on the deployed Function, or via
`wrangler pages dev` with `--remote` bindings):

```powershell
npm run deploy
```

Then ask a question with a known answer and confirm real passages + correct book
citations. From PowerShell:

```powershell
$body = @{ question = "Who is Jon Snow's father?"; sources = @("A Song of Ice and Fire") } | ConvertTo-Json
Invoke-RestMethod -Uri "https://iron-throne-qa.pages.dev/api/ask" -Method Post `
  -ContentType "application/json" -Body $body
```

Expect: `answer` = a real passage from the novels, `citations[0].work` = a novel
title (e.g. "A Game of Thrones"), `meta` shows `phase 1 — retrieval live`.

Try a **filter** check too: ask something Fire & Blood-specific with
`sources = @("fire-and-blood")` and confirm the citation is *Fire & Blood*, not a
novel — that proves the `bookId` metadata filter works.

### Success criteria (Phase 1 exit)
- [ ] `vectorize info` shows ~8,800 vectors
- [ ] `/api/ask` returns real book passages (not the Phase 0 canned Rhaenyra stub)
- [ ] Citations name the correct book
- [ ] Source filter narrows results to the selected book(s)

## Notes / gotchas
- **Same model both sides:** ingest and query both use `@cf/baai/bge-small-en-v1.5`
  (mean pooling). Never change one without the other.
- **Show/Wiki sources:** `got`, `hotd`, `wiki` have no corpus yet. Selecting *only*
  those currently falls back to an unfiltered search — real handling arrives with
  Phase 2 transcripts. Default selection (novels + F&B + knight) behaves correctly.
- **A Dance with Dragons** (book 5) is still missing — add `adwd` to
  `SOURCE_TO_BOOKIDS` in `functions/_lib/retrieval.js` once ingested.
- **OneDrive:** pause syncing if git/npm throws "unable to access".

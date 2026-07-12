# Phase 1 — Summary (COMPLETE ✅)

Retrieval is live end-to-end. `/api/ask` now embeds the question, queries
Vectorize (filtered by source), and returns real, cited book passages —
replacing the Phase 0 canned stub. Ingest ran against the live Cloudflare
account: all **8,800 chunks embedded and indexed**.

Deployed: https://iron-throne-qa.pages.dev
Final commit: `65d4eb3` — "Phase 1 live: relocate functions/ under functions dir,
fix load.js Node24 spawn, wire D1 binding, ingest 8800 vectors".

## Exit criteria — all met

- [x] `vectorize info` shows **8,800** vectors (384-dim, cosine).
- [x] `/api/ask` returns a **real book passage**, not the Phase 0 Rhaenyra stub.
- [x] Citation names the correct book (Q1 → *A Game of Thrones*; Q2 → *Fire & Blood*).
- [x] Source filter narrows results — a `fire-and-blood`-scoped question cited
      *Fire & Blood* (chunk 138), not a novel.

Verification queries (both returned correct, source-appropriate passages):
- "Who is Jon Snow's father?" scoped to `A Song of Ice and Fire` → AGoT appendix
  listing Jon Snow as Eddard Stark's bastard son.
- "Who was the first Targaryen king of Westeros?" scoped to `fire-and-blood` →
  *Fire & Blood* succession passage (Aenys → Maegor).

## What this session actually did (vs. the handoff's assumed state)

The Phase 1 *code* was already written; the handoff's remaining work was "run +
verify." Three things had to be fixed before it would run/deploy correctly:

1. **Function files had drifted to the repo root** (`_lib/`, `api/`) instead of
   living under `functions/`. Cloudflare Pages only routes files under
   `functions/`, so `/api/ask` would have 404'd after deploy. Moved all six back
   under `functions/` (content unchanged); removed the stray root copies.
2. **`ingest/load.js` crashed on Node 24 / Windows** — `execFileSync("npx.cmd", …)`
   throws `EINVAL` because Node 20+ refuses to spawn a `.cmd` without a shell.
   Patched to invoke the local wrangler entry point directly via
   `process.execPath` + `node_modules/wrangler/bin/wrangler.js` (also sidesteps
   shell-quoting of the spaces in the OneDrive repo path).
3. **D1 binding wired** — `iron-throne-graph` already existed
   (`database_id = e461f784-dd8e-400c-9064-61b435c7e726`); uncommented the
   `[[d1_databases]]` block in `wrangler.toml` and applied `graph/schema.sql`
   (4 tables/queries, `--remote`).

Also cleared a stale `.git/index.lock` left by a tooling process.

## Provisioning state (live on the account)

- **Vectorize** `iron-throne` — 384-dim, cosine, **8,800 vectors**.
- **Metadata index** on `bookId` (String) — created *before* load, so source
  filtering works.
- **D1** `iron-throne-graph` — schema applied; graph query path is a later phase.
- **Workers AI** — `@cf/baai/bge-small-en-v1.5`, identical model at ingest
  (`ingest/embed.js`, REST) and query (`functions/_lib/retrieval.js`, `env.AI`).

## Data-quality note (checked, not a blocker)

Console output showed `â` / `Â·` mojibake. Verified against `ingest/out/chunks.jsonl`:
the **stored text is clean UTF-8** (proper `—`, `"…"`, `Storm's End`) — the
garble was only PowerShell rendering UTF-8 as Windows-1252. The one *real*
artifact is minor PDF-extraction noise in appendix/roster chunks (stray spaces
like `BLOU NT`, an occasional dropped `fi`-ligature). Localized, low-impact,
**no re-parse/re-embed needed.**

## Source → bookId map (in `functions/_lib/retrieval.js`)

- `A Song of Ice and Fire` → `[agot, acok, asos, affc]`  (+ `adwd` once ingested)
- `fire-and-blood` → `[fab]`
- `knight` → `[kotsk]`
- `got` / `hotd` / `wiki` → no corpus yet; fall through to unfiltered.

## Carried forward into Phase 2 (none blocking Phase 1)

- **Generation is still stubbed.** `/api/ask` echoes the top passage's text; it
  does not yet *write* an answer. Wiring a provider (Gemini / Groq / Cerebras via
  `functions/_lib/modelAdapter.js`, with the strict "answer only from context,
  one citation per claim, refuse if uncovered" prompt) is the main Phase 3 task.
- **A Dance with Dragons (book 5) not ingested.** Add `adwd` to the source map in
  `retrieval.js` once its chunks are embedded + loaded.
- **Git history purge still pending.** Book text was committed in an early commit
  before being untracked. Repo is private+solo so not urgent, but before it ever
  goes public: back up `ingest/out/`, then
  `git filter-repo --path ingest/out --invert-paths --force`, re-add remote,
  force-push.
- **Wrangler v3 pinned** (`3.114.17`). Run ingest/deploy commands **from the repo
  root** so `npx` uses local v3; it warns about v4 — ignore. If it offers to
  auto-install "Cloudflare skills," answer **n**.
- **`.dev.vars` holds the Workers AI REST token** (`CLOUDFLARE_API_TOKEN`) and is
  gitignored — never commit it.

## OneDrive caution (bit us this session)

The repo lives under OneDrive with Files On-Demand, which dehydrates files
mid-operation — it made tracked docs show as `deleted` in `git status` and
silently dropped a new file write. Before git/file work, set the folder to
**"Always keep on this device"** (or pause syncing). If files show as deleted
after a sync hiccup, recover with `git restore <path>` — do **not** commit the
deletions.

## How to re-run ingest (if ever needed)

```powershell
# from repo root, PowerShell
npm run ingest:embed                       # resumable; skips already-embedded ids
npm run ingest:load                        # insert; add `-- --upsert` to overwrite
npx wrangler vectorize info iron-throne     # confirm count (async, may lag)
npm run deploy
```

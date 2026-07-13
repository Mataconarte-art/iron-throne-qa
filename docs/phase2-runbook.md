# Phase 2 — Runbook (genealogy graph)

Everything here runs on the Windows dev machine, **from the repo root**
(`iron-throne-qa/`), so `npx` uses the pinned local Wrangler v3. If Wrangler
offers to auto-install "Cloudflare skills", answer **n**.

## Files

| File | Role | Committed? |
|---|---|---|
| `graph/seed-targaryen.json` | Curated, verified backbone. Source of truth. | ✅ |
| `graph/reviewed-edges.json` | Approved extracted edges (array; `[]` to start). | ✅ |
| `graph/compile.js` | Shared builder used by tooling AND the Function. | ✅ |
| `functions/_lib/graph.js` | Entity resolution + traversal + D1 backend. | ✅ |
| `graph/graph.json` | Compiled graph (inspection). Derived. | ❌ gitignored |
| `graph/edges.sql` | D1 load (nodes + edges). Derived. | ❌ gitignored |

The Function compiles the graph from the two committed JSON files at cold start —
**no build step is required to deploy** the default (memory) backend.

## Common tasks

### Just deploy (memory backend, default)
Nothing graph-specific to do. `npm run deploy`. Relational questions work
immediately from the committed seed.

### Inspect / rebuild the compiled artifacts
```powershell
npm run ingest:graph          # -> graph/graph.json + graph/edges.sql
npm run ingest:graph -- --strict   # exit non-zero if any validation warning
```
Expect: `nodes=92 parent=147 spouse=29 ... validation clean.`

### Switch to the robust D1 backend
```powershell
npm run ingest:graph                                   # regenerate edges.sql
npx wrangler d1 execute iron-throne-graph --remote --file=graph/edges.sql
npx wrangler pages secret put GRAPH_BACKEND            # enter: d1
npm run deploy
```
(Or set `GRAPH_BACKEND = "d1"` under `[vars]` in `wrangler.toml` for a
non-secret toggle.) The recursive-CTE queries live in `functions/_lib/graph.js`.
Switch back by removing the var → defaults to `memory`.

## Widening the graph with reviewed extraction

Only needed to add coverage beyond the curated Targaryen backbone. Requires the
local corpus (`ingest/out/chunks.jsonl`, from Phase 1) and the Workers AI token
in `.dev.vars` (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`).

```powershell
# 1) Extract candidate edges from the corpus (default: Fire & Blood).
npm run ingest:extract                       # -> ingest/out/edge-candidates.jsonl
#   options: -- --books=fab,agot  --limit=200  --model=@cf/meta/llama-3.1-70b-instruct

# 2) Triage: writes a markdown worklist, approves nothing on its own.
npm run ingest:review                        # -> ingest/out/edges-to-review.md

# 3) Approve interactively ([a]/[r]/[s]/[q]) -> graph/reviewed-edges.json
npm run ingest:review -- --interactive

# 4) Recompile (approved edges are ADD-only; curated always wins).
npm run ingest:graph
#   Re-run the D1 load in step "Switch to D1" if you use that backend.

# 5) Redeploy.
npm run deploy
```

Classification in step 2:
- **confirms-seed** — the extracted edge already exists in the curated seed.
  Auto-skipped (a confirmation, nothing to do).
- **novel** — resolves to two known nodes but isn't in the seed. **Review these.**
- **needs-node** — a name didn't resolve to a known node. To accept it, first add
  the person to `graph/seed-targaryen.json` (with a stable slug + aliases), then
  re-run extraction/review.

Guardrails: extracted edges may only *add* to the graph; the compiler drops any
that reference unknown nodes and flags suspicious merges (e.g. a node ending up
with three parents). Curated edges never get overridden.

## Verifying

```powershell
# Local dev server (graph works even without remote bindings):
npm run dev
# then, in another shell:
$body = @{ question = "Who were the parents of Aegon III Targaryen?"; sources = @("fire-and-blood") } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:8788/api/ask" -Method Post -ContentType "application/json" -Body $body

# Eval harness (deterministic checks; genealogy Q3-Q8 added this phase):
$env:BASE_URL="http://localhost:8788"; npm run eval
```

Expected: the answer names Rhaenyra and Daemon, with `Genealogy graph` citations.

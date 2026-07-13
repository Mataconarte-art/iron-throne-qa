# Iron Throne Q&A — Handoff for Phase 3 (wire the real LLM)

Resume point for a fresh chat. Phases 0–2 are done and verified. Phase 3 replaces
the **stubbed generation** with a real model call, adds the **LLM-as-judge** eval,
and keeps the strict grounding contract.

## Where things stand

- **Phase 0 — DONE.** Scaffold + deploy. `docs/phase0-notes.md`.
- **Phase 1 — DONE.** 8,800 chunks embedded + indexed in Vectorize; real vector
  retrieval. `docs/PHASE-1-SUMMARY.md`.
- **Phase 2 — DONE.** Genealogy graph (92-node Targaryen dynasty) + traversal +
  extraction/review pipeline. `docs/PHASE-2-SUMMARY.md`, `docs/phase2-runbook.md`.
- **Phase 3 — NOT STARTED.** Generation is still deterministic/stubbed.

Verified on the dev machine: `npm run test:graph` → 10/10; `npm run eval` against
`npm run dev` → 9/10 (Q9's only miss is `citation-present`, because Vectorize
isn't bound in plain local dev — green on deploy or with `npm run dev:vec`).

## The one job of Phase 3

Right now `functions/_lib/modelAdapter.js` `answer()` does NOT call a provider. It:
- composes genealogy answers deterministically from graph facts, and
- otherwise echoes the top retrieved passage's text.

Phase 3 swaps that stub body for a real provider call, feeding the model the
retrieved context (graph facts + vector passages) under a strict prompt, while
**keeping citations derived from retrieval, not invented by the model**.

### The grounding contract (do not weaken)
- Answer **only** from the provided context. If the context doesn't cover it,
  refuse ("The sources provided do not cover that.").
- **One citation per claim.** Citations come from `retrieved` (graph facts +
  vector snippets), never fabricated by the model.
- Respect the **spoiler ceiling**: the graph already omits R+L=J; do not let the
  model infer beyond the passages provided. (Per-chunk spoiler tags are Phase 6.)
- Prefer **graph facts** for relational questions (they're exact/verified); use
  vector passages for prose/context.

### Suggested prompt shape
```
System: You answer questions about the ASOIAF universe using ONLY the CONTEXT.
  If the context does not contain the answer, say you don't know. Every factual
  sentence must be supported by a provided source; do not add facts not in CONTEXT.
User:
  QUESTION: <question>
  CONTEXT:
    [Graph facts]  <subject> — <relation> → <object>   (×N, high confidence)
    [Passages]     <work> · <locator>: <text>          (×K)
  Write a concise answer grounded in CONTEXT.
```
Keep the returned `citations` array built from `retrieved` (as the stub already
does), so the model text and the citations can be cross-checked.

## Providers (already scaffolded)
`modelAdapter.js` has `PROVIDERS` + `selectProvider(env)` and `answerWithFallback`.
Wire them in this order of effort:
- **Gemini 3 Flash** (default) — needs `GEMINI_API_KEY` (already a dev.var slot).
  ~1,500 req/day free. Start here.
- **Groq / Cerebras** — `GROQ_API_KEY` / `CEREBRAS_API_KEY`, llama-3.3-70b. Hosted
  fallbacks; `answerWithFallback` is the hook.
- **Ollama** (local gemma2:2b) is Phase 4 (auto-fallback so the phone always
  answers) — don't do it now.

Keys are set with `wrangler pages secret put GEMINI_API_KEY` (NOT in the repo).
`.dev.vars` already reserves the slots for local dev.

## Eval: turn on the judge
`eval/run-eval.js` has a `judge()` hook that currently returns "skipped (Phase 3)".
Phase 3 implements it as an **LLM-as-judge** call (critique 8) — use a DIFFERENT
provider than the one under test to reduce self-preference bias. It grades
correctness/grounding against each question's rubric. The deterministic checks
(citation-present, expected-facts, refusal, spoiler-ceiling) stay as the fast gate;
the judge adds the correctness signal. Also wire the `[graph on/off, local/api]`
config sweep noted at the bottom of `run-eval.js`.

## Files Phase 3 will touch
- `functions/_lib/modelAdapter.js` — real `answer()` body + `answerWithFallback`.
- `eval/run-eval.js` — implement `judge()`, add config sweep.
- `.dev.vars` / secrets — provider API key(s).
- (No retrieval/graph changes expected — that contract is stable.)

## What NOT to change
- The retrieval interface (`retrieve()` returns `{vector, graph, graphMeta, ...}`)
  and the graph — stable as of Phase 2.
- Citation construction from `retrieved` — keep it; don't let the model mint
  citations.
- The genealogy composition path is a good deterministic fallback if the provider
  is down — keep it reachable.

## Gotchas carried forward
- **OneDrive/bash caching + `.git/index.lock`:** as in Phase 1/2, set the repo to
  "Always keep on this device" (or pause sync) before git work; if git complains
  about `index.lock`, delete `.git/index.lock` and retry.
- **Wrangler v3 pinned** (3.114.17). Run from repo root; ignore the v4 upsell;
  answer **n** to "Cloudflare skills".
- **Vectorize not bound in plain local dev** — use `npm run dev:vec`
  (`--experimental-vectorize-bind-to-prod`) to test the vector side locally; it
  incurs real Workers AI / Vectorize usage.
- **A Dance with Dragons (book 5)** still not ingested — add `adwd` to the source
  map in `retrieval.js` once its chunks are embedded/loaded.
- **Git history purge still pending** (book text in early commit `16f1b05`) —
  before the repo ever goes public: back up `ingest/out/`, then
  `git filter-repo --path ingest/out --invert-paths --force`, re-add remote,
  force-push.

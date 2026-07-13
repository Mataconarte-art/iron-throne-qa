# Phase 2 — Summary (COMPLETE ✅)

The genealogy graph is live. Relational questions ("Who was Rhaenyra's father?",
"Who were Aegon III's parents?", "Who was the Mad King's daughter?") are now
answered from a **curated, verified Targaryen graph** and traversed in-process,
merged into the existing hybrid-retrieval interface. Curated data is the source
of truth; an LLM extraction + human-review pipeline exists to *augment* it, never
override it (critique 3).

Roadmap definition of this phase: *"genealogy graph: curated seed + reviewed
extraction; graph traversal in `retrieval`."* All three delivered.

## What shipped

**Curated backbone — `graph/seed-targaryen.json`** (v0.2.0)
Expanded from the 10-node Phase 0 seed to the **full Targaryen dynasty**: 92
nodes, 147 parent edges, 29 spouse edges, spanning Aegon's Conquest → Daenerys,
plus the Baratheon claim-line offshoot (Aegon V → Rhaelle → Steffon → Robert /
Stannis / Renly). Every edge hand-verified against *Fire & Blood*, *The World of
Ice and Fire*, and the novel appendices. Nodes carry `aliases` (regnal names and
epithets — "the Old King", "the Mad King", "Stormborn", "the Sea Snake") for
entity resolution.

**Deliberate spoiler omission.** The Rhaegar + Lyanna → Jon Snow edge is *not*
encoded. It is unconfirmed in the published novels and is the canonical
spoiler-ceiling test (eval Q9). Documented in the seed's `meta.spoiler_omissions`;
revisit once per-node spoiler annotation lands in Phase 6.

**Shared compiler — `graph/compile.js`**
One pure `buildGraph(seed, reviewed)` used by BOTH the offline tooling and the
Function, so they can never disagree on how the graph is assembled. Validates on
every build: dangling edges, self-edges, >2-parent nodes, and ancestor cycles.

**Traversal + retrieval wiring — `functions/_lib/graph.js`**
Entity resolution (longest alias/name match, with alias-count prominence
tie-breaking so "Daenerys Targaryen" → Stormborn, not her ancestor namesake),
relation detection (father/mother/parents, son/daughter/children, wife/husband/
spouse, brother/sister/siblings, grandparent, ancestor/descendant), and traversal
returning `{subject, relation, object}` facts. `retrieval.retrieve()` now calls
the graph **independently of the vector bindings** — relational questions work
even in local dev without remote AI/Vectorize.

**Two backends (the robust option), by `env.GRAPH_BACKEND`:**
- `memory` (default) — the graph is compiled at cold start from the committed
  seed + reviewed edges. Free, zero-latency, ~90 nodes. Deploys with no build step.
- `d1` — resolves entities in-memory, then serves adjacency and ancestor/
  descendant walks from the provisioned D1 (`iron-throne-graph`) via recursive
  CTEs. Load it with `graph/edges.sql` (see runbook).

**Answer composition — `functions/_lib/modelAdapter.js`**
Still no provider call (the real LLM is Phase 3), but genealogy answers are now
composed deterministically from graph facts with correct grammar
("Aegon III Targaryen's parents were Rhaenyra Targaryen (mother) and Daemon
Targaryen (father).") and **one citation per fact** — `Genealogy graph:
subject → relation → object` — plus a supporting book passage when the vector
side found one.

**Extraction + review pipeline (the "reviewed extraction" half):**
- `ingest/extract-edges.js` — mines parent/spouse relations from the corpus with
  a Workers AI text model (REST, same auth as `embed.js`), resolves names to node
  slugs, and writes *candidates* with provenance (evidence quote, chunk id).
  Resumable; `--books`, `--limit`, `--model` flags.
- `ingest/review-edges.js` — the human **review gate**. Classifies candidates
  (confirms-seed / novel / needs-node) so you only look at new, resolvable facts;
  `--interactive` approves them into `graph/reviewed-edges.json`.
- `ingest/build-graph.js` — compiles seed + approved edges → `graph/graph.json`
  (inspection) + `graph/edges.sql` (D1). Approved edges may only ADD; the >2-parent
  sanity check catches suspect merges.

**Eval** — `eval/testset.json` gains Q3–Q8 (genealogy-graph cases) and the harness
(`eval/run-eval.js`) gains a deterministic `expected_facts` check.

## Exit criteria — all met

- [x] Curated Targaryen graph expanded to the full dynasty (92 nodes), compiled
      clean (no dangling edges, no cycles, no >2-parent nodes).
- [x] `retrieve()` returns graph facts for relational questions; genealogy answers
      are composed and cited from the graph.
- [x] Q1–Q8 pass the deterministic checks offline (citation-present +
      expected_facts); Q9 stays spoiler-safe (graph omits R+L=J).
- [x] Entity resolution disambiguates repeated names (Daenerys, Aegon) and
      resolves epithets ("the Mad King's daughter" → Daenerys).
- [x] Robust D1 backend available behind `GRAPH_BACKEND=d1` with recursive-CTE
      traversal; memory backend is the zero-config default.
- [x] LLM extraction + human-review gate implemented end-to-end; only approved
      edges reach the graph.

Offline verification (all correct, spoiler-safe):

| Question | Answer |
|---|---|
| Rhaenyra's father | Viserys I Targaryen |
| Parents of Aegon III | Rhaenyra (mother) + Daemon (father) |
| Aegon the Conqueror's wives | Visenya + Rhaenys |
| Children of Aegon II & Helaena | Jaehaerys, Jaehaera, Maelor |
| Daenerys's father | Aerys II (correctly not the earlier Daenerys) |
| Siblings of Aegon II | Rhaenyra, Helaena, Aemond, Daeron |
| Robert Baratheon's grandmother | Rhaelle Targaryen |
| Jon Snow's parentage | *(no graph fact — spoiler ceiling respected)* |

## Architecture decisions this phase

- **Single source of truth, no committed derived blob.** The Function compiles
  the graph from `seed-targaryen.json` + `reviewed-edges.json` at cold start via
  the shared `compile.js`. `graph/graph.json` and `graph/edges.sql` are DERIVED
  and now **gitignored** (regenerate with `npm run ingest:graph`). This kills the
  artifact-drift class of bug — there is no compiled file to forget to rebuild.
- **Approved edges live in `graph/reviewed-edges.json`** (committed, deployable),
  not under `ingest/out/` (gitignored). Candidates and worklists stay in
  `ingest/out/`.
- **Prominence tie-break by alias count** to disambiguate name collisions — a
  cheap proxy that reliably favors the famous bearer.

## Carried forward into Phase 3+

- **Generation is still stubbed.** Genealogy answers are composed
  deterministically; free-text questions still echo the top passage. Wiring a
  provider (Gemini / Groq / Cerebras via `modelAdapter.js`) with the strict
  "answer only from context, one citation per claim, refuse if uncovered" prompt
  is the Phase 3 task. The graph facts should be handed to the model as
  high-confidence context.
- **Extraction is built but not yet run** — it needs the local corpus
  (`ingest/out/chunks.jsonl`) + the Workers AI token in `.dev.vars`. The seed
  alone fully covers the eval set; run extraction when you want to widen coverage
  (e.g. minor houses). See `docs/phase2-runbook.md`.
- **First-name-only resolution** (bare "Rhaenys", "Daemon" without a surname) is
  intentionally not indexed — it would collide badly across the dynasty. Fuller
  names and epithets resolve; the vector side covers the rest.
- **D1 load is optional** — only needed if you switch `GRAPH_BACKEND=d1`. The
  memory backend needs no provisioning and is the default.

## OneDrive caution (still applies)

Same as Phase 1: the repo is under OneDrive with Files On-Demand. Set the folder
to **"Always keep on this device"** (or pause sync) before git/npm work. Derived
graph files regenerate deterministically, so a sync hiccup on them is harmless —
just rerun `npm run ingest:graph`.

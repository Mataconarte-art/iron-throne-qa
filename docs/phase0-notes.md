# Phase 0 — running notes

## Decisions locked (from the Phase 0 brief + confirmation)

- Repo: **private GitHub**. Node **22** (current LTS).
- 384-dim embeddings (Workers AI `bge-small-en-v1.5`), vector DB swappable.
- Graph store: bundled `graph/seed-targaryen.json` now; D1 later.
- Genealogy: curated Targaryen backbone as source of truth; LLM extraction is reviewed augmentation.
- Auth: server-side token check before any retrieval.

## What Phase 0 delivers

- Theme-aware installable PWA shell (`public/`), 3 themes via `tokens.css`, persisted in `localStorage`.
- `/api/health` (live) and `/api/ask` (canned cited answer) as Pages Functions.
- Stub interfaces already in their final shape: `auth`, `vectorStore` (swappable), `retrieval` (vector+graph merge), `modelAdapter` (provider-agnostic).
- Offline `ingest/` pipeline stubs (parse → chunk → embed → load → build-graph).
- Curated genealogy seed + D1 schema.
- Hybrid eval harness (deterministic checks live; LLM-judge hooked, Phase 3).

## Local run

```bash
npm install
cp .dev.vars.example .dev.vars     # set AUTH_TOKEN
npm run dev                        # wrangler pages dev
# health:  curl localhost:8788/api/health
# ask:     curl -XPOST localhost:8788/api/ask -H 'content-type: application/json' \
#               -d '{"question":"Who was Rhaenyra Targaryen'\''s father?","sources":["fire-and-blood"]}'
```

## First git push (private)

```bash
cd iron-throne-qa
git init -b main
git add .
git commit -m "Phase 0: theme-aware PWA shell + stub Functions + interfaces"
# create an EMPTY private repo on GitHub named iron-throne-qa, then:
git remote add origin git@github.com:<you>/iron-throne-qa.git
git push -u origin main
```

## Deploy (Phase 0 exit)

```bash
npx wrangler login
npm run deploy                     # wrangler pages deploy public
# then Add to Home Screen on the phone from the deployed URL
```

## Still needed (Phase 1+, not blocking Phase 0)

- Cloudflare account + Pages project; create Vectorize index at **384-dim**.
- Book files into `ingest/data/` (gitignored).
- Gemini API key (AI Studio) — Phase 3.
- Real `docs/GoT-RAG-Strategy-and-Roadmap.md` and `docs/Eval-Test-Questions.md` (placeholders below).

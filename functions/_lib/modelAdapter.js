// Model-agnostic answer adapter. The model only writes the sentence; facts and
// citations come from `retrieved`. Providers are swappable and named explicitly
// (critique 7 — pin the model, log limits). Optional local Gemma via Ollama
// with automatic fallback so the phone always gets an answer.
//
// Phase 0: `answer()` composes a grounded, cited response from the stub
// retrieval WITHOUT calling any provider — no keys required to run the scaffold.

const PROVIDERS = {
  // Defaults chosen per critique 7. Limits move; log them, don't trust them.
  gemini:   { model: "gemini-3-flash",    note: "~1,500 req/day, 250k TPM, 1M ctx" },
  groq:     { model: "llama-3.3-70b",     note: "alternate hosted free tier" },
  cerebras: { model: "llama-3.3-70b",     note: "alternate hosted free tier" },
  ollama:   { model: "gemma2:2b",         note: "local, opportunistic; never an uptime dependency" },
};

export function selectProvider(env) {
  const pref = (env && env.MODEL_PROVIDER) || "gemini";
  return PROVIDERS[pref] ? pref : "gemini";
}

// The single entry point ask.js calls.
export async function answer({ question, sources, retrieved, env }) {
  const provider = selectProvider(env);

  // Phase 0 STUB: build a cited answer directly from retrieved material.
  // (Later: call the provider with a strict "answer only from context, one
  //  citation per claim, refuse if uncovered" prompt.)
  const snippet = retrieved?.vector?.[0]?.metadata;
  const graphFact = retrieved?.graph?.[0];

  const answerText = snippet
    ? snippet.text
    : "The sources provided do not cover that. (stub)";

  const citations = [];
  if (snippet) {
    citations.push({ work: snippet.work, locator: snippet.locator, url: snippet.url });
  }
  if (graphFact) {
    citations.push({
      work: "Genealogy graph",
      locator: `${graphFact.subject} → ${graphFact.relation} → ${graphFact.object}`,
      url: null,
    });
  }

  return {
    answer: answerText,
    citations,
    meta:
      `stub · provider=${provider} (${PROVIDERS[provider].model}) · ` +
      `sources=[${(sources || []).join(", ")}] · phase 0 — no model called`,
  };
}

// Phase 2 fallback shape: try local, fall back to hosted, so the phone always
// gets an answer. Wired up when providers are implemented.
export async function answerWithFallback(args) {
  try {
    return await answer(args);
  } catch {
    return await answer({ ...args, env: { ...args.env, MODEL_PROVIDER: "gemini" } });
  }
}

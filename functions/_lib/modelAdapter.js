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

// Compose a deterministic sentence from graph facts (Phase 2). Groups objects by
// their relation to the same subject: "Rhaenyra Targaryen's parents were Viserys
// I Targaryen (father) and Aemma Arryn (mother)." No model involved — the facts
// come straight from the curated genealogy graph.
const GROUP_PLURAL = { parent: "parents", child: "children", spouse: "spouses", sibling: "siblings", grandparent: "grandparents", grandchild: "grandchildren", ancestor: "ancestors", descendant: "descendants" };
const LABEL_PLURAL = { father: "fathers", mother: "mothers", son: "sons", daughter: "daughters", wife: "wives", husband: "husbands", brother: "brothers", sister: "sisters", grandfather: "grandfathers", grandmother: "grandmothers", grandson: "grandsons", granddaughter: "granddaughters", parent: "parents", child: "children", spouse: "spouses", sibling: "siblings", grandparent: "grandparents", grandchild: "grandchildren", ancestor: "ancestors", descendant: "descendants" };

export function composeGenealogyAnswer(facts, graphMeta) {
  if (!facts || !facts.length) return null;
  const bySubject = new Map();
  for (const f of facts) {
    if (!bySubject.has(f.subject)) bySubject.set(f.subject, []);
    bySubject.get(f.subject).push(f);
  }
  const clauses = [];
  for (const [subject, fs] of bySubject) {
    const labels = [...new Set(fs.map((f) => f.relation))];
    let noun, items;
    if (labels.length === 1) {
      // Homogeneous (e.g. all "father"): use the gendered noun, plain objects.
      noun = fs.length > 1 ? LABEL_PLURAL[labels[0]] || labels[0] : labels[0];
      items = fs.map((f) => f.object);
    } else {
      // Mixed (e.g. father + mother): collapse to the group noun, annotate each.
      const rel = (graphMeta && graphMeta.relation) || "relative";
      noun = GROUP_PLURAL[rel] || rel;
      items = fs.map((f) => `${f.object} (${f.relation})`);
    }
    const verb = fs.length > 1 ? "were" : "was";
    clauses.push(`${subject}'s ${noun} ${verb} ${listJoin(items)}.`);
  }
  let text = clauses.join(" ");
  if (graphMeta && graphMeta.ambiguous) {
    text += " (Note: the name matched more than one person in the genealogy; results are shown for each.)";
  }
  return text;
}

function listJoin(arr) {
  if (arr.length <= 1) return arr[0] || "";
  if (arr.length === 2) return `${arr[0]} and ${arr[1]}`;
  return `${arr.slice(0, -1).join(", ")}, and ${arr[arr.length - 1]}`;
}

// The single entry point ask.js calls.
export async function answer({ question, sources, retrieved, env }) {
  const provider = selectProvider(env);

  // Phase 2 STUB (still no provider call — real LLM lands in Phase 3): build a
  // cited answer directly from retrieved material. Relational questions are
  // answered from the genealogy GRAPH (exact, verified); everything else falls
  // back to the top book passage.
  const snippet = retrieved?.vector?.[0]?.metadata;
  const graphFacts = retrieved?.graph || [];
  const graphMeta = retrieved?.graphMeta || {};

  const citations = [];
  let answerText;

  const genealogy = composeGenealogyAnswer(graphFacts, graphMeta);
  if (genealogy) {
    answerText = genealogy;
    // One citation per graph fact (critique 3 — every relational claim is grounded).
    for (const f of graphFacts) {
      citations.push({ work: "Genealogy graph", locator: `${f.subject} → ${f.relation} → ${f.object}`, url: null });
    }
    // Attach a supporting book passage if retrieval found one.
    if (snippet) citations.push({ work: snippet.work, locator: snippet.locator, url: snippet.url });
  } else if (snippet) {
    answerText = snippet.text;
    citations.push({ work: snippet.work, locator: snippet.locator, url: snippet.url });
  } else {
    answerText = "The sources provided do not cover that. (stub)";
  }

  return {
    answer: answerText,
    citations,
    meta:
      `provider=${provider} (${PROVIDERS[provider].model}) · ` +
      `sources=[${(sources || []).join(", ")}] · phase 2 — retrieval + genealogy graph live, generation stubbed (LLM in phase 3)`,
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

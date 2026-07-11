// POST /api/ask — Phase 0 STUB.
// Contract is real; the answer is canned. Later phases replace the body of
// this handler with: auth -> embed question -> vectorStore.query (filtered by
// sources) -> retrieval.merge(vector, graph) -> modelAdapter.answer(...).

import { requireAuth } from "../_lib/auth.js";
import { retrieve } from "../_lib/retrieval.js";
import { answer as generate } from "../_lib/modelAdapter.js";

export async function onRequestPost(context) {
  const { request, env } = context;

  // 1) Server-side gate (critique 5). Book text never leaves the server
  //    without a valid token. In Phase 0 this is a permissive stub.
  const auth = requireAuth(request, env);
  if (!auth.ok) {
    return json({ error: auth.reason || "unauthorized" }, 401);
  }

  // 2) Parse request.
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const question = (body.question || "").trim();
  const sources = Array.isArray(body.sources) ? body.sources : [];
  if (!question) return json({ error: "question is required" }, 400);

  // 3) Retrieval (stub returns canned, source-tagged snippets).
  const retrieved = await retrieve({ question, sources, env });

  // 4) Generation through the adapter (stub echoes a grounded, cited answer).
  const result = await generate({ question, sources, retrieved, env });

  return json(result, 200);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

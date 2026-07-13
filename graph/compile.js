// Shared graph compiler (Phase 2). ONE builder used by both:
//   - ingest/build-graph.js  (offline: emits graph.json + edges.sql for D1)
//   - functions/_lib/graph.js (runtime: builds in-memory at cold start)
// so the Function and the tooling can never disagree about how the graph is
// assembled. Pure: no fs, no network — inputs in, graph out.
//
// Inputs:
//   seed      : graph/seed-targaryen.json  (curated, source of truth)
//   reviewed  : array of approved extracted edges (graph/reviewed-edges.json)
// Curated edges always win; reviewed edges may only ADD, never override
// (critique 3).

// Normalization for entity resolution. Keep IN SYNC everywhere that resolves
// names (extract-edges.js has its own copy of this exact function).
export function normalizeName(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")          // strip diacritics
    .replace(/[^a-z0-9 ]+/g, " ")   // punctuation -> space
    .replace(/\s+/g, " ")
    .trim();
}

export function edgeKey(e) {
  if (e.type === "parent") return `parent|${e.from}|${e.to}`;
  if (e.type === "spouse") { const [a, b] = [e.a, e.b].sort(); return `spouse|${a}|${b}`; }
  return `${e.type}|${JSON.stringify(e)}`;
}

// Build the runtime graph. Returns { meta, nodes, parents, children, spouses,
// index, edges, warnings }. `warnings` is diagnostic only — callers decide
// whether to treat them as fatal (build-graph --strict does).
export function buildGraph(seed, reviewed = []) {
  const warnings = [];
  const nodes = new Map();
  for (const n of seed.nodes) {
    if (nodes.has(n.id)) warnings.push(`duplicate node id: ${n.id}`);
    nodes.set(n.id, { id: n.id, name: n.name, house: n.house || null, gender: n.gender || null, aliases: n.aliases || [] });
  }

  const seen = new Set();
  const edges = [];
  const addEdge = (e, curated) => {
    const key = edgeKey(e);
    if (seen.has(key)) { if (curated) warnings.push(`duplicate curated edge: ${key}`); return false; }
    seen.add(key); edges.push(e); return true;
  };
  for (const e of seed.edges) addEdge(e, true);

  let addedFromReview = 0;
  for (const e of reviewed) {
    if (e.status && e.status !== "approved") continue;
    const ids = e.type === "parent" ? [e.from, e.to] : [e.a, e.b];
    if (ids.some((id) => !nodes.has(id))) { warnings.push(`reviewed edge references unknown node(s): ${edgeKey(e)}`); continue; }
    if (addEdge({ ...e, source: e.source || "extracted:reviewed" }, false)) addedFromReview++;
  }

  const parents = {}, children = {}, spouses = {};
  const push = (o, k, v) => { (o[k] ||= []); if (!o[k].includes(v)) o[k].push(v); };
  for (const e of edges) {
    if (e.type === "parent") {
      if (e.from === e.to) { warnings.push(`self parent edge: ${e.from}`); continue; }
      push(children, e.from, e.to); push(parents, e.to, e.from);
    } else if (e.type === "spouse") {
      if (e.a === e.b) { warnings.push(`self spouse edge: ${e.a}`); continue; }
      push(spouses, e.a, e.b); push(spouses, e.b, e.a);
    } else warnings.push(`unknown edge type: ${e.type}`);
  }

  for (const [child, ps] of Object.entries(parents)) {
    if (ps.length > 2) warnings.push(`node ${child} has ${ps.length} parents: ${ps.join(", ")}`);
  }
  for (const id of nodes.keys()) {
    const seenA = new Set(); const stack = [...(parents[id] || [])];
    while (stack.length) {
      const cur = stack.pop();
      if (cur === id) { warnings.push(`ancestor cycle through ${id}`); break; }
      if (seenA.has(cur)) continue; seenA.add(cur); stack.push(...(parents[cur] || []));
    }
  }

  const index = {};
  for (const n of nodes.values()) {
    const keys = [n.name, ...(n.aliases || [])].map(normalizeName).filter(Boolean);
    for (const k of new Set(keys)) push(index, k, n.id);
  }

  return {
    meta: {
      ...(seed.meta || {}),
      counts: {
        nodes: nodes.size,
        parentEdges: edges.filter((e) => e.type === "parent").length,
        spouseEdges: edges.filter((e) => e.type === "spouse").length,
        addedFromReview,
      },
    },
    nodes: Object.fromEntries([...nodes.entries()]),
    parents, children, spouses, index, edges, warnings,
  };
}

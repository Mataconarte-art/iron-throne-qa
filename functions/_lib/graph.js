// Genealogy graph backend selector (Phase 2). The traversal LOGIC lives in
// graph/traverse.js (pure, unit-testable under bare Node); this module wires it
// to the Function: it compiles the graph at cold start and adds the D1 backend.
//
// Two backends behind one interface, chosen by env.GRAPH_BACKEND:
//   "memory" (default) — traverse the in-process graph. Free, zero latency; the
//                        graph is small (critique 2).
//   "d1"               — resolve entities in-memory (needs the alias index), then
//                        run adjacency/ancestor queries against D1 (recursive
//                        CTEs). The "robust" path for when the graph grows.
//
// Curated data is the source of truth; a single wrong edge tanks genealogy
// accuracy (critique 3). The graph is compiled from committed sources by the
// shared graph/compile.js — the same code the offline tooling uses.

import seed from "../../graph/seed-targaryen.json";
import reviewed from "../../graph/reviewed-edges.json";
import { buildGraph } from "../../graph/compile.js";
import { queryGraphMemory, resolveEntities, detectRelation, normalizeName as _normalizeName } from "../../graph/traverse.js";

const graphData = buildGraph(seed, reviewed);
export const normalizeName = _normalizeName;
export { detectRelation, resolveEntities };

const nameOf = (id) => graphData.nodes[id]?.name || id;

const REL_LABEL = {
  parent: { male: "father", female: "mother", any: "parent" },
  child: { male: "son", female: "daughter", any: "child" },
  spouse: { male: "husband", female: "wife", any: "spouse" },
  sibling: { male: "brother", female: "sister", any: "sibling" },
  grandparent: { male: "grandfather", female: "grandmother", any: "grandparent" },
  grandchild: { male: "grandson", female: "granddaughter", any: "grandchild" },
  ancestor: { any: "ancestor" }, descendant: { any: "descendant" },
};
const relLabel = (rel, g) => { const m = REL_LABEL[rel] || { any: rel }; return (g && m[g]) || m.any || rel; };

// ---- D1 backend (robust path). Entity resolution + relation detection still
//      happen in-memory (the alias index lives in the bundle); D1 serves the
//      adjacency / recursive walks. ----
async function d1Parents(db, id) {
  const { results } = await db.prepare("SELECT n.id, n.name, n.gender FROM edges e JOIN nodes n ON n.id = e.src WHERE e.dst = ?1 AND e.type = 'parent'").bind(id).all();
  return results || [];
}
async function d1Children(db, id) {
  const { results } = await db.prepare("SELECT n.id, n.name, n.gender FROM edges e JOIN nodes n ON n.id = e.dst WHERE e.src = ?1 AND e.type = 'parent'").bind(id).all();
  return results || [];
}
async function d1Spouses(db, id) {
  const { results } = await db.prepare(
    `SELECT n.id, n.name, n.gender FROM nodes n WHERE n.id IN (
       SELECT dst FROM edges WHERE src = ?1 AND type = 'spouse'
       UNION SELECT src FROM edges WHERE dst = ?1 AND type = 'spouse')`
  ).bind(id).all();
  return results || [];
}
async function d1Ancestors(db, id) {
  const { results } = await db.prepare(
    `WITH RECURSIVE anc(id, depth) AS (
       SELECT src, 1 FROM edges WHERE dst = ?1 AND type = 'parent'
       UNION SELECT e.src, a.depth + 1 FROM edges e JOIN anc a ON e.dst = a.id AND e.type = 'parent')
     SELECT n.id, n.name, n.gender FROM anc a JOIN nodes n ON n.id = a.id`
  ).bind(id).all();
  return results || [];
}
async function d1Descendants(db, id) {
  const { results } = await db.prepare(
    `WITH RECURSIVE des(id, depth) AS (
       SELECT dst, 1 FROM edges WHERE src = ?1 AND type = 'parent'
       UNION SELECT e.dst, d.depth + 1 FROM edges e JOIN des d ON e.src = d.id AND e.type = 'parent')
     SELECT n.id, n.name, n.gender FROM des d JOIN nodes n ON n.id = d.id`
  ).bind(id).all();
  return results || [];
}
async function d1Siblings(db, id) {
  const { results } = await db.prepare(
    `SELECT DISTINCT n.id, n.name, n.gender FROM edges p1
       JOIN edges p2 ON p1.src = p2.src AND p2.type = 'parent'
       JOIN nodes n ON n.id = p2.dst
     WHERE p1.dst = ?1 AND p1.type = 'parent' AND p2.dst <> ?1`
  ).bind(id).all();
  return results || [];
}

export async function queryGraphD1(env, question) {
  const db = env.DB;
  if (!db) return queryGraphMemory(graphData, question);
  const relation = detectRelation(question);
  const ents = resolveEntities(question, graphData);
  if (!relation || !ents.length) return { facts: [], entities: [], relation: relation?.rel || null, ambiguous: false };

  const facts = [];
  for (const id of ents[0].ids) {
    let rows = [];
    switch (relation.rel) {
      case "parent": rows = await d1Parents(db, id); break;
      case "child": rows = await d1Children(db, id); break;
      case "spouse": rows = await d1Spouses(db, id); break;
      case "sibling": rows = await d1Siblings(db, id); break;
      case "ancestor": rows = await d1Ancestors(db, id); break;
      case "descendant": rows = await d1Descendants(db, id); break;
      case "grandparent": { const ps = await d1Parents(db, id); for (const p of ps) rows.push(...await d1Parents(db, p.id)); break; }
      case "grandchild": { const cs = await d1Children(db, id); for (const c of cs) rows.push(...await d1Children(db, c.id)); break; }
      default: rows = [];
    }
    if (relation.gender) rows = rows.filter((r) => r.gender === relation.gender);
    const subject = nameOf(id);
    for (const r of rows) facts.push({ subject, subjectId: id, relation: relLabel(relation.rel, r.gender), object: r.name, objectId: r.id, source: "genealogy-graph" });
  }
  const seen = new Set();
  const deduped = facts.filter((f) => { const k = `${f.subjectId}|${f.relation}|${f.objectId}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return { facts: deduped.slice(0, 12), entities: ents[0].ids.map((id) => nameOf(id)), relation: relation.rel, ambiguous: !!ents[0].ambiguous };
}

// Unified entry: pick backend by env. Never throws — a graph miss just yields no
// facts and the vector side carries the answer.
export async function queryGraph(env, question) {
  try {
    if (env && env.GRAPH_BACKEND === "d1" && env.DB) return await queryGraphD1(env, question);
    return queryGraphMemory(graphData, question);
  } catch (e) {
    return { facts: [], entities: [], relation: null, ambiguous: false, error: String(e?.message || e) };
  }
}

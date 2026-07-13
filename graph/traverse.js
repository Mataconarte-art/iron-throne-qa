// Pure genealogy traversal (Phase 2). No env, no JSON imports, no network — it
// takes an already-compiled graph (from graph/compile.js buildGraph) plus a
// question string and returns cited facts. Kept separate from
// functions/_lib/graph.js so it is directly runnable under bare Node (the
// Function module uses bundler-only JSON imports and adds the D1 backend on top).

import { normalizeName } from "./compile.js";
export { normalizeName };

// Relation intent → canonical relation + optional gender constraint on the answer.
// Order matters: longer / more specific phrases first.
const RELATION_PATTERNS = [
  { re: /\bgrand ?father\b/, rel: "grandparent", gender: "male" },
  { re: /\bgrand ?mother\b/, rel: "grandparent", gender: "female" },
  { re: /\bgrand ?parents?\b/, rel: "grandparent" },
  { re: /\bgrand ?sons?\b/, rel: "grandchild", gender: "male" },
  { re: /\bgrand ?daughters?\b/, rel: "grandchild", gender: "female" },
  { re: /\bgrand ?child(ren)?\b/, rel: "grandchild" },
  { re: /\bancestors?|ancestry|forebears?|descended from\b/, rel: "ancestor" },
  { re: /\bdescend(ants?|ed)\b/, rel: "descendant" },
  { re: /\bfather\b|\bsire\b/, rel: "parent", gender: "male" },
  { re: /\bmother\b/, rel: "parent", gender: "female" },
  { re: /\bparents?|parentage|born to\b/, rel: "parent" },
  { re: /\bsons?\b/, rel: "child", gender: "male" },
  { re: /\bdaughters?\b/, rel: "child", gender: "female" },
  { re: /\bchild(ren)?|issue|offspring\b/, rel: "child" },
  { re: /\bwi(fe|ves)\b/, rel: "spouse", gender: "female" },
  { re: /\bhusbands?\b/, rel: "spouse", gender: "male" },
  { re: /\bspouses?|married to|wed(ded)?|consort\b/, rel: "spouse" },
  { re: /\bbrothers?\b/, rel: "sibling", gender: "male" },
  { re: /\bsisters?\b/, rel: "sibling", gender: "female" },
  { re: /\bsiblings?\b/, rel: "sibling" },
];

export function detectRelation(question) {
  const q = " " + normalizeName(question) + " ";
  for (const p of RELATION_PATTERNS) if (p.re.test(q)) return p;
  return null;
}

// Resolve the person named in the question to node id(s). Longest alias/name
// match wins; on a name collision, prefer the most prominent (alias-count proxy),
// else surface every candidate and flag ambiguity.
export function resolveEntities(question, graph) {
  const q = normalizeName(question);
  const keys = Object.keys(graph.index)
    .filter((k) => k.length >= 4 && q.includes(k))
    .sort((a, b) => b.length - a.length);
  if (!keys.length) return [];
  const best = keys[0];
  const chosen = keys.filter((k) => k.length === best.length);
  let ids = [...new Set(chosen.flatMap((k) => graph.index[k]))];
  let ambiguous = false;
  if (ids.length > 1) {
    const aliasCount = (id) => graph.nodes[id]?.aliases?.length || 0;
    const max = Math.max(...ids.map(aliasCount));
    const top = ids.filter((id) => aliasCount(id) === max);
    ids = top;
    ambiguous = top.length > 1;
  }
  return [{ key: best, ids, ambiguous }];
}

const nameOf = (g, id) => g.nodes[id]?.name || id;
const genderOf = (g, id) => g.nodes[id]?.gender || null;
const byGender = (g, ids, gender) => (gender ? ids.filter((id) => genderOf(g, id) === gender) : ids);
const parentsOf = (g, id) => g.parents[id] || [];
const childrenOf = (g, id) => g.children[id] || [];
const spousesOf = (g, id) => g.spouses[id] || [];

function siblingsOf(g, id) {
  const sibs = new Set();
  for (const p of parentsOf(g, id)) for (const c of childrenOf(g, p)) if (c !== id) sibs.add(c);
  return [...sibs];
}
function walkUp(g, id, out, seen) {
  for (const p of parentsOf(g, id)) { if (seen.has(p)) continue; seen.add(p); out.push(p); walkUp(g, p, out, seen); }
}
function walkDown(g, id, out, seen) {
  for (const c of childrenOf(g, id)) { if (seen.has(c)) continue; seen.add(c); out.push(c); walkDown(g, c, out, seen); }
}

const REL_LABEL = {
  parent: { male: "father", female: "mother", any: "parent" },
  child: { male: "son", female: "daughter", any: "child" },
  spouse: { male: "husband", female: "wife", any: "spouse" },
  sibling: { male: "brother", female: "sister", any: "sibling" },
  grandparent: { male: "grandfather", female: "grandmother", any: "grandparent" },
  grandchild: { male: "grandson", female: "granddaughter", any: "grandchild" },
  ancestor: { any: "ancestor" },
  descendant: { any: "descendant" },
};
function relLabel(rel, objGender) {
  const m = REL_LABEL[rel] || { any: rel };
  return (objGender && m[objGender]) || m.any || rel;
}

function factsFor(g, subjectId, relation) {
  const subject = nameOf(g, subjectId);
  let targets = [];
  switch (relation.rel) {
    case "parent": targets = parentsOf(g, subjectId); break;
    case "child": targets = childrenOf(g, subjectId); break;
    case "spouse": targets = spousesOf(g, subjectId); break;
    case "sibling": targets = siblingsOf(g, subjectId); break;
    case "grandparent": { const s = new Set(); for (const p of parentsOf(g, subjectId)) for (const gp of parentsOf(g, p)) s.add(gp); targets = [...s]; break; }
    case "grandchild": { const s = new Set(); for (const c of childrenOf(g, subjectId)) for (const gc of childrenOf(g, c)) s.add(gc); targets = [...s]; break; }
    case "ancestor": { const o = []; walkUp(g, subjectId, o, new Set()); targets = o; break; }
    case "descendant": { const o = []; walkDown(g, subjectId, o, new Set()); targets = o; break; }
    default: targets = [];
  }
  targets = byGender(g, targets, relation.gender);
  return targets.map((id) => ({
    subject, subjectId,
    relation: relLabel(relation.rel, genderOf(g, id)),
    object: nameOf(g, id), objectId: id,
    source: "genealogy-graph",
  }));
}

// Main entry for the memory backend: question -> cited facts over `graph`.
export function queryGraphMemory(graph, question) {
  const relation = detectRelation(question);
  const ents = resolveEntities(question, graph);
  if (!relation || !ents.length) return { facts: [], entities: [], relation: relation?.rel || null, ambiguous: false };

  const facts = [];
  for (const id of ents[0].ids) facts.push(...factsFor(graph, id, relation));

  const seen = new Set();
  const deduped = facts.filter((f) => { const k = `${f.subjectId}|${f.relation}|${f.objectId}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return {
    facts: deduped.slice(0, 12),
    entities: ents[0].ids.map((id) => nameOf(graph, id)),
    relation: relation.rel,
    ambiguous: !!ents[0].ambiguous,
  };
}

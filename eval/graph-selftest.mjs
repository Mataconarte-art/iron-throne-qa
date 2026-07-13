// Graph self-test (Phase 2). Runs the eval questions through the genealogy graph
// with ZERO external dependencies — no Cloudflare, no dev server, no network.
// Compiles the graph from the committed sources and checks the graph's own
// responsibilities: correct facts, spoiler ceiling, and refusal on out-of-corpus.
//
//   npm run test:graph
//
// (The full end-to-end eval — including the vector side — is `npm run eval`
//  against a running `npm run dev` server.)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildGraph } from "../graph/compile.js";
import { queryGraphMemory } from "../graph/traverse.js";
import { composeGenealogyAnswer } from "../functions/_lib/modelAdapter.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

const graph = buildGraph(read("graph/seed-targaryen.json"), read("graph/reviewed-edges.json"));
const { questions } = read("eval/testset.json");

console.log(`Graph: ${graph.meta.counts.nodes} nodes, ${graph.meta.counts.parentEdges} parent + ${graph.meta.counts.spouseEdges} spouse edges`);
if (graph.warnings.length) { console.log("VALIDATION WARNINGS:"); for (const w of graph.warnings) console.log("  - " + w); }
console.log("");

let pass = 0, fail = 0;
for (const q of questions) {
  const r = queryGraphMemory(graph, q.question);
  const ans = composeGenealogyAnswer(r.facts, { relation: r.relation, ambiguous: r.ambiguous })
    || "The sources provided do not cover that.";
  const text = ans.toLowerCase();
  const checks = [];

  const isGraphQ = /genealogy/.test(q.type || "");
  if (isGraphQ) checks.push(["has-facts", r.facts.length > 0]);
  if (Array.isArray(q.expected_facts) && q.expected_facts.length) {
    const missing = q.expected_facts.filter((f) => !text.includes(f.toLowerCase()));
    checks.push(["expected-facts", missing.length === 0, missing]);
  }
  if (Array.isArray(q.must_not_reveal)) {
    const leaked = q.must_not_reveal.filter((f) => text.includes(f.toLowerCase()));
    checks.push(["spoiler-safe", leaked.length === 0, leaked]);
  }
  if (q.must_refuse) {
    // The graph alone should surface nothing for an out-of-corpus question.
    checks.push(["graph-empty (vector must refuse)", r.facts.length === 0]);
  }

  const bad = checks.some((c) => c[1] === false);
  bad ? fail++ : pass++;
  console.log(`${bad ? "FAIL" : "OK  "} ${q.id}  ${q.question}`);
  console.log(`      → ${ans}`);
  for (const c of checks) console.log(`        ${c[1] ? "✓" : "✗"} ${c[0]}${c[2] && c[2].length ? " " + JSON.stringify(c[2]) : ""}`);
}

console.log(`\n${pass} ok, ${fail} fail  (graph-only; run \`npm run eval\` for the full pipeline)`);
process.exitCode = fail > 0 ? 1 : 0;

// Hybrid eval harness (critique 8): deterministic checks for mechanical criteria
// (citations present, source filter respected, correct refusal, spoiler ceiling
// not exceeded) + LLM-as-judge for correctness/grounding. Phase 0 implements the
// deterministic half against the /api/ask stub and leaves the judge as a hook.
//
// Usage: BASE_URL=http://localhost:8788 AUTH_TOKEN=... node eval/run-eval.js
//        (configs to sweep in later phases: graph on/off, local vs API)

import { readFile } from "node:fs/promises";

const BASE_URL = process.env.BASE_URL || "http://localhost:8788";
const AUTH_TOKEN = process.env.AUTH_TOKEN || "";

async function ask(question, sources) {
  const res = await fetch(`${BASE_URL}/api/ask`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {}),
    },
    body: JSON.stringify({ question, sources }),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

// Deterministic checks — return {name, pass, detail}.
function mechanicalChecks(q, resp) {
  const checks = [];
  const text = (resp.data.answer || "").toLowerCase();
  const cites = resp.data.citations || [];

  if (q.required_citation) {
    checks.push({ name: "citation-present", pass: cites.length > 0 });
  }
  if (Array.isArray(q.expected_facts) && q.expected_facts.length) {
    const missing = q.expected_facts.filter((f) => !text.includes(f.toLowerCase()));
    checks.push({ name: "expected-facts-present", pass: missing.length === 0, detail: missing.length ? missing : undefined });
  }
  if (q.must_refuse) {
    const refused = /do not cover|cannot|no( relevant)? (information|answer)|not (found|covered)/i.test(
      resp.data.answer || ""
    );
    checks.push({ name: "refuses-out-of-corpus", pass: refused });
  }
  if (Array.isArray(q.must_not_reveal)) {
    const leaked = q.must_not_reveal.filter((f) => text.includes(f.toLowerCase()));
    checks.push({ name: "spoiler-ceiling-respected", pass: leaked.length === 0, detail: leaked });
  }
  return checks;
}

// LLM-as-judge hook (Phase 3+). Different provider than the one under test to
// reduce self-preference bias. Stubbed as "skipped" for now.
async function judge(/* q, resp */) {
  return { name: "llm-judge-correctness", pass: null, detail: "skipped (Phase 3)" };
}

async function main() {
  const raw = await readFile(new URL("./testset.json", import.meta.url), "utf8");
  const { questions } = JSON.parse(raw);

  let passed = 0, failed = 0, skipped = 0;
  for (const q of questions) {
    let resp;
    try {
      resp = await ask(q.question, q.sources);
    } catch (e) {
      console.log(`  ${q.id}  NETWORK ERROR (${e.message}) — is \`npm run dev\` up?`);
      failed++;
      continue;
    }
    const checks = mechanicalChecks(q, resp);
    const j = await judge(q, resp);
    checks.push(j);

    const hardFail = checks.some((c) => c.pass === false);
    const status = hardFail ? "FAIL" : "OK  ";
    if (hardFail) failed++; else passed++;

    console.log(`  ${status} ${q.id}  ${q.question}`);
    for (const c of checks) {
      const mark = c.pass === true ? "✓" : c.pass === false ? "✗" : "·";
      const d = c.detail ? ` (${JSON.stringify(c.detail)})` : "";
      console.log(`         ${mark} ${c.name}${d}`);
      if (c.pass === null) skipped++;
    }
  }
  console.log(`\n  configs: [graph on/off, local/api] not yet swept (Phase 3+)`);
  console.log(`  totals: ${passed} ok, ${failed} fail, ${skipped} judge-checks skipped\n`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main();

// Ask form → /api/ask. Phase 0: the endpoint returns a canned cited answer,
// but the client contract (question + source filter in, answer + citations
// out) is the real one we'll keep in later phases.

const form = document.getElementById("ask-form");
const input = document.getElementById("question");
const answerEl = document.getElementById("answer");
const bodyEl = answerEl.querySelector(".answer-body");
const citesEl = answerEl.querySelector(".citations");
const metaEl = answerEl.querySelector(".answer-meta");

const SOURCES_KEY = "itqa.sources";

// Restore last source selection.
try {
  const saved = JSON.parse(localStorage.getItem(SOURCES_KEY) || "null");
  if (Array.isArray(saved)) {
    document.querySelectorAll('input[name="source"]').forEach((cb) => {
      cb.checked = saved.includes(cb.value);
    });
  }
} catch {}

function selectedSources() {
  return [...document.querySelectorAll('input[name="source"]:checked')].map((c) => c.value);
}

function render(data) {
  answerEl.hidden = false;
  bodyEl.textContent = data.answer || "(no answer)";
  citesEl.innerHTML = "";
  (data.citations || []).forEach((c) => {
    const li = document.createElement("li");
    const label = [c.work, c.locator].filter(Boolean).join(" — ");
    if (c.url) {
      const a = document.createElement("a");
      a.href = c.url; a.target = "_blank"; a.rel = "noopener";
      a.textContent = label || c.url;
      li.appendChild(a);
    } else {
      li.textContent = label || "(source)";
    }
    citesEl.appendChild(li);
  });
  metaEl.textContent = data.meta || "";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const question = input.value.trim();
  if (!question) return;

  const sources = selectedSources();
  try { localStorage.setItem(SOURCES_KEY, JSON.stringify(sources)); } catch {}

  const btn = form.querySelector(".ask-btn");
  btn.disabled = true;
  bodyEl.textContent = "Consulting the maesters…";
  answerEl.hidden = false;
  citesEl.innerHTML = "";
  metaEl.textContent = "";

  try {
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, sources }),
    });
    const data = await res.json();
    if (!res.ok) {
      bodyEl.textContent = data.error || `Request failed (${res.status}).`;
    } else {
      render(data);
    }
  } catch (err) {
    bodyEl.textContent = "Network error — the raven did not return.";
  } finally {
    btn.disabled = false;
  }
});

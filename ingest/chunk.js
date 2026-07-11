// ingest/chunk.js  (Phase 1 — step 2: clean + split into books + chunk)
// Reads ingest/out/raw-*.txt (from parse.js), cleans the text, splits the
// 4-book bundle into its 4 novels, then produces overlapping chunks with
// citation metadata into ingest/out/chunks.jsonl.
//
// Usage: node ingest/chunk.js
// No external deps.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "out");

// ---- tuning ---------------------------------------------------------------
const TARGET_CHARS = 1200; // ~300 tokens; safely under bge-small's 512-token limit
const OVERLAP_CHARS = 150; // carry-over between adjacent chunks for context
// ---------------------------------------------------------------------------

// Books within a bundle MUST be listed in reading order.
// `startMarker` (optional): used when a book's title page has NO extractable
// title text (e.g. it's an image). A Feast for Crows is exactly this case in
// this bundle — its only in-text mention after the contents list is the praise
// blurb that sits at the very start of the book's section, so we anchor there.
const SOURCES = [
  {
    rawId: "bundle-1-4",
    split: [
      { bookId: "agot", title: "A Game of Thrones" },
      { bookId: "acok", title: "A Clash of Kings" },
      { bookId: "asos", title: "A Storm of Swords" },
      { bookId: "affc", title: "A Feast for Crows", startMarker: /Feast for Crows is a fast-paced/i },
    ],
  },
  { rawId: "fire-and-blood", split: [{ bookId: "fab", title: "Fire & Blood" }] },
  { rawId: "knight-seven-kingdoms", split: [{ bookId: "kotsk", title: "A Knight of the Seven Kingdoms" }] },
];

// ---- cleaning -------------------------------------------------------------
function clean(raw) {
  let t = raw.replace(/\r/g, "");
  // de-hyphenate words split across a line break: "imag-\nination" -> "imagination"
  t = t.replace(/([A-Za-z])-\n([a-z])/g, "$1$2");
  const paras = t
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, " ").replace(/[ \t]{2,}/g, " ").trim())
    .filter((p) => p.length > 0);
  return paras;
}

// Find the character offset where each book's story begins. ORDER-AWARE: each
// book must start after the previous one. Detection order per book:
//   1) a real title page (title on its own line + publishing boilerplate),
//   2) an explicit startMarker (for image-only title pages),
//   3) fallback: first title occurrence after the previous book.
function findBookStarts(fullText, split) {
  if (split.length === 1) return [{ ...split[0], start: 0 }];
  const lower = fullText.toLowerCase();
  const titleSet = split.map((s) => s.title.toLowerCase());
  const marks = [];
  let minStart = 0;
  for (const b of split) {
    const esc = b.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|\\n)[ \\t]*${esc}[ \\t]*(?=\\n)`, "gi");
    let m, chosen = -1;
    while ((m = re.exec(fullText)) !== null) {
      const titleAt = m.index + (m[1] ? m[1].length : 0);
      if (titleAt < minStart) continue; // must come after the previous book
      const after = fullText.slice(titleAt + b.title.length, titleAt + b.title.length + 200);
      const nextLines = after.split(/\n/).map((l) => l.trim().toLowerCase()).filter(Boolean);
      const first = nextLines[0] || "";
      const nextIsBookTitle = titleSet.some((t) => first.startsWith(t.slice(0, 8)));
      const nextIsFrontMatter = /^(about the author|also by|excerpt|contents|cover|title page|table of contents|maps?|appendix|dramatis)/.test(first);
      const hasBoilerplate = /bantam|spectra|publishing history/.test(after.toLowerCase());
      if (!nextIsBookTitle && !nextIsFrontMatter && hasBoilerplate) {
        chosen = titleAt;
        break;
      }
    }
    // (2) explicit startMarker for image-only title pages
    if (chosen < 0 && b.startMarker) {
      const rel = fullText.slice(minStart).search(b.startMarker);
      if (rel >= 0) chosen = minStart + rel;
    }
    // (3) fallback: first title occurrence after the previous book
    if (chosen < 0) {
      const idx = lower.indexOf(b.title.toLowerCase(), minStart);
      chosen = idx < 0 ? minStart : idx;
    }
    marks.push({ ...b, start: chosen });
    minStart = chosen + 1;
  }
  marks.sort((a, b) => a.start - b.start);
  return marks;
}

// ---- chunking -------------------------------------------------------------
function chunkParagraphs(paras, bookId, book) {
  const chunks = [];
  let buf = "";
  let idx = 0;
  const flush = () => {
    const text = buf.trim();
    if (text.length < 50) return; // skip tiny fragments
    chunks.push({ id: `${bookId}#${idx}`, bookId, book, chunkIndex: idx, chars: text.length, text });
    idx += 1;
  };
  for (const p of paras) {
    if (buf.length + p.length + 1 > TARGET_CHARS && buf.length > 0) {
      flush();
      buf = buf.slice(Math.max(0, buf.length - OVERLAP_CHARS)); // overlap tail
    }
    buf += (buf ? " " : "") + p;
    while (buf.length > TARGET_CHARS * 1.6) {
      const cut = buf.lastIndexOf(" ", TARGET_CHARS);
      const at = cut > TARGET_CHARS * 0.5 ? cut : TARGET_CHARS;
      const piece = buf.slice(0, at);
      const rest = buf.slice(at - OVERLAP_CHARS);
      buf = piece;
      flush();
      buf = rest.trimStart();
    }
  }
  flush();
  return chunks;
}

// ---- run ------------------------------------------------------------------
const allChunks = [];
const report = [];

for (const src of SOURCES) {
  let raw;
  try {
    raw = await readFile(join(OUT_DIR, `raw-${src.rawId}.txt`), "utf8");
  } catch {
    console.log(`(skip) missing ingest/out/raw-${src.rawId}.txt — run parse.js first`);
    continue;
  }
  const starts = findBookStarts(raw, src.split);
  for (let i = 0; i < starts.length; i++) {
    const b = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1].start : raw.length;
    const slice = raw.slice(b.start, end);
    const paras = clean(slice);
    const chunks = chunkParagraphs(paras, b.bookId, b.title);
    allChunks.push(...chunks);
    report.push({ book: b.title, bookId: b.bookId, startOffset: b.start, chunks: chunks.length });
  }
}

const outPath = join(OUT_DIR, "chunks.jsonl");
await writeFile(outPath, allChunks.map((c) => JSON.stringify(c)).join("\n") + "\n", "utf8");

// ---- diagnostics ----------------------------------------------------------
console.log("\nBOOK SPLIT + CHUNK REPORT");
console.log("-".repeat(70));
for (const r of report) {
  console.log(
    `${r.bookId.padEnd(6)} ${r.book.padEnd(32)} offset=${String(r.startOffset).padStart(9)}  chunks=${r.chunks}`
  );
}
console.log("-".repeat(70));
console.log(`TOTAL chunks: ${allChunks.length}  ->  ${join("ingest/out", "chunks.jsonl")}`);

console.log("\nSAMPLE CHUNKS (first of each book):");
const seen = new Set();
for (const c of allChunks) {
  if (seen.has(c.bookId)) continue;
  seen.add(c.bookId);
  console.log(`\n[${c.id}] (${c.chars} chars)`);
  console.log(c.text.slice(0, 240) + "...");
}
console.log("");

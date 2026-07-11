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

// Which raw files to process, and how to label them.
// The bundle is split into 4 novels by detecting each title page.
const SOURCES = [
  {
    rawId: "bundle-1-4",
    split: [
      { bookId: "agot", title: "A Game of Thrones" },
      { bookId: "acok", title: "A Clash of Kings" },
      { bookId: "asos", title: "A Storm of Swords" },
      { bookId: "affc", title: "A Feast for Crows" },
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
  // split into paragraphs on blank lines, join wrapped lines within a paragraph
  const paras = t
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, " ").replace(/[ \t]{2,}/g, " ").trim())
    .filter((p) => p.length > 0);
  return paras;
}

// Find the character offset where each book's story begins, by locating its
// title page: the title line followed shortly by publishing/copyright text.
function findBookStarts(fullText, split) {
  if (split.length === 1) return [{ ...split[0], start: 0 }];
  const marks = [];
  for (const b of split) {
    // Match the TITLE-CASE title as its own line, CASE-SENSITIVELY. The
    // CONTENTS list is ALL-CAPS ("A GAME OF THRONES") so it won't match;
    // only the real title page ("A Game of Thrones") does. We additionally
    // require publishing boilerplate just after, to skip running headers.
    const esc = b.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|\\n)[ \\t]*${esc}[ \\t]*(?=\\n)`, "g"); // no "i" flag
    let m, chosen = -1;
    while ((m = re.exec(fullText)) !== null) {
      const titleAt = m.index + (m[1] ? m[1].length : 0);
      const after = fullText.slice(titleAt + b.title.length, titleAt + b.title.length + 400);
      if (/Bantam|PUBLISHING HISTORY|Spectra/i.test(after)) {
        chosen = titleAt;
        break;
      }
    }
    marks.push({ ...b, start: chosen });
  }
  // fall back to first occurrence if a title page wasn't matched
  for (const mk of marks) {
    if (mk.start < 0) {
      const idx = fullText.toLowerCase().indexOf(mk.title.toLowerCase());
      mk.start = idx < 0 ? 0 : idx;
    }
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
    chunks.push({
      id: `${bookId}#${idx}`,
      bookId,
      book,
      chunkIndex: idx,
      chars: text.length,
      text,
    });
    idx += 1;
  };
  for (const p of paras) {
    if (buf.length + p.length + 1 > TARGET_CHARS && buf.length > 0) {
      flush();
      buf = buf.slice(Math.max(0, buf.length - OVERLAP_CHARS)); // overlap tail
    }
    buf += (buf ? " " : "") + p;
    // a single very long paragraph: hard-split it
    while (buf.length > TARGET_CHARS * 1.6) {
      const cut = buf.lastIndexOf(" ", TARGET_CHARS);
      const at = cut > TARGET_CHARS * 0.5 ? cut : TARGET_CHARS;
      const piece = buf.slice(0, at);
      buf = buf.slice(at - OVERLAP_CHARS);
      const saved = buf;
      buf = piece;
      flush();
      buf = saved.trimStart();
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

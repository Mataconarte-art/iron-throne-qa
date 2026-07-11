-- Cloudflare D1 schema. Only used if the in-memory graph.json outgrows memory
-- (critique 2). Adjacency queried with recursive CTEs. Not active in Phase 0.

CREATE TABLE IF NOT EXISTS nodes (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL,
  house   TEXT,
  gender  TEXT
);

CREATE TABLE IF NOT EXISTS edges (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  type      TEXT NOT NULL,          -- 'parent' | 'spouse' | ...
  src       TEXT NOT NULL REFERENCES nodes(id),
  dst       TEXT NOT NULL REFERENCES nodes(id),
  source    TEXT                    -- provenance: 'seed' | 'extracted:reviewed'
);

CREATE INDEX IF NOT EXISTS idx_edges_src ON edges(src, type);
CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst, type);

-- Example ancestor walk (recursive CTE):
--   WITH RECURSIVE ancestors(id, depth) AS (
--     SELECT src, 1 FROM edges WHERE dst = ?1 AND type = 'parent'
--     UNION ALL
--     SELECT e.src, a.depth + 1 FROM edges e
--       JOIN ancestors a ON e.dst = a.id AND e.type = 'parent'
--   )
--   SELECT n.* FROM ancestors a JOIN nodes n ON n.id = a.id;

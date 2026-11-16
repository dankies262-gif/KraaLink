-- Private and public file metadata. Files are never served straight from disk:
-- the API enforces ownership and role rules on every read (FR-BRD-13, NFR-05).

CREATE TABLE IF NOT EXISTS files (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  owner_id   TEXT,
  path       TEXT NOT NULL,
  mime       TEXT NOT NULL,
  bytes      INTEGER NOT NULL,
  is_public  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_files_owner ON files(owner_id, kind);

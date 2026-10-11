PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('problem', 'suggestion', 'feature')),
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  contact TEXT NOT NULL,
  version TEXT NOT NULL,
  os TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('app', 'website'))
);

CREATE INDEX IF NOT EXISTS feedback_created_at ON feedback(created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS feedback_attachments (
  feedback_id TEXT NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 1048576),
  sha256 TEXT NOT NULL,
  data_base64 TEXT NOT NULL,
  PRIMARY KEY (feedback_id, filename)
);

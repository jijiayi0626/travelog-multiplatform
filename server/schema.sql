-- 旅记 · Cloudflare D1 schema
-- 执行：wrangler d1 execute travelog --file=./schema.sql --remote

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  sync_code TEXT UNIQUE NOT NULL,
  token TEXT NOT NULL,
  nickname TEXT,
  created_at INTEGER NOT NULL
);

-- 所有业务实体统一存放，按 (user_id, kind, id) 唯一
CREATE TABLE IF NOT EXISTS entities (
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, kind, id)
);

CREATE INDEX IF NOT EXISTS idx_entities_cursor ON entities (user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_users_token ON users (token);
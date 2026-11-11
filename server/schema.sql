-- 旅记 · Cloudflare D1 schema（单 Worker 同时托管前端与 API）
-- 执行：wrangler d1 execute travelog --file=./schema.sql --remote

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  sync_code TEXT UNIQUE NOT NULL,
  token TEXT NOT NULL,
  nickname TEXT,
  created_at INTEGER NOT NULL
);

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

-- 管理面板配置：AI 接口、管理员凭据、站点信息
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 用户扩展信息（不改原表，兼容已有数据库）
CREATE TABLE IF NOT EXISTS user_meta (
  user_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active',
  last_seen_at INTEGER,
  note TEXT
);

CREATE INDEX IF NOT EXISTS idx_user_meta_status ON user_meta (status);
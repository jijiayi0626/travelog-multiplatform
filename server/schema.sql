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

-- 旅程协作：member 通过邀请码加入 owner 的某趟旅程
-- 共享后，member 的读写都重定向到 owner 的实体空间，实现真正的多人同步
CREATE TABLE IF NOT EXISTS trip_shares (
  trip_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (trip_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_trip_shares_member ON trip_shares (member_id);
CREATE INDEX IF NOT EXISTS idx_trip_shares_owner ON trip_shares (owner_id);

-- ============ 账号密码 / 会员 / 邀请码 / 登录风控 ============

-- 账号密码（与 users 一对一；老用户可先只保留同步码，登录后补设账号密码）
-- username 保留用户输入的大小写用于展示，username_lower 用于唯一性与登录匹配
CREATE TABLE IF NOT EXISTS user_credentials (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  username_lower TEXT NOT NULL UNIQUE,
  salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_credentials_username ON user_credentials (username_lower);

-- 多设备登录令牌：同一账号可在多台设备同时登录，互不顶掉
CREATE TABLE IF NOT EXISTS user_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_user_tokens_user ON user_tokens (user_id);

-- 会员兑换码：兑换后给账号增加 days 天会员
CREATE TABLE IF NOT EXISTS membership_codes (
  code TEXT PRIMARY KEY,
  days INTEGER NOT NULL,
  note TEXT,
  max_uses INTEGER NOT NULL DEFAULT 1,
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  created_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_membership_codes_created ON membership_codes (created_at DESC);

-- 会员状态：expires_at 为到期时间（毫秒时间戳）
CREATE TABLE IF NOT EXISTS user_membership (
  user_id TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  source TEXT,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_membership_expiry ON user_membership (expires_at);

-- 注册邀请码：管理后台可开关「注册必须填写邀请码」
CREATE TABLE IF NOT EXISTS invite_codes (
  code TEXT PRIMARY KEY,
  note TEXT,
  max_uses INTEGER NOT NULL DEFAULT 1,
  used_count INTEGER NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  created_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_invite_codes_created ON invite_codes (created_at DESC);

-- 登录/注册审计：IP、浏览器、地区，管理员可在后台查看
CREATE TABLE IF NOT EXISTS user_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  country TEXT,
  region TEXT,
  city TEXT,
  colo TEXT,
  asn INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_activity_user ON user_activity (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_activity_time ON user_activity (created_at DESC);

-- 固定窗口限流（登录、注册、兑换码、公共接口防刷）
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_reset ON rate_limits (reset_at);
-- 照片云端存储（文件本体在 R2，桶绑定名 PHOTOS）
CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  access_key TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_photos_user ON photos (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_photos_time ON photos (created_at DESC);

-- AI 异步任务：提交后由 waitUntil 后台执行，用户可离开页面稍后查看
CREATE TABLE IF NOT EXISTS ai_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  prompt TEXT NOT NULL,
  system TEXT NOT NULL DEFAULT '',
  temperature REAL NOT NULL DEFAULT 0.6,
  result TEXT,
  error TEXT,
  model TEXT,
  endpoint TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_ai_jobs_user ON ai_jobs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_status ON ai_jobs (status, created_at);

-- 用户头像（文件本体在 R2，按用户保留最新一张）
CREATE TABLE IF NOT EXISTS avatars (
  user_id TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL,
  access_key TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 2026-11-21 · 账号邮箱与登录设备信息
-- 适用于已存在的 travelog D1；新库直接执行 server/schema.sql 即可。
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN email_lower TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email_lower) WHERE email_lower IS NOT NULL;

ALTER TABLE user_tokens ADD COLUMN device_name TEXT;
ALTER TABLE user_tokens ADD COLUMN user_agent TEXT;
ALTER TABLE user_tokens ADD COLUMN ip TEXT;
/**
 * 旅记 · Cloudflare Worker
 *
 * 一个 Worker 同时提供：
 *   1. /api/*     鉴权、增量同步、AI 代理、天气/地理编码、管理面板接口
 *   2. 其余路径   前端静态资源（../dist，SPA 回退）
 *
 * 部署：npm run build → cd server → wrangler d1 create travelog →
 *      填写 database_id → wrangler d1 execute … --file=schema.sql --remote → wrangler deploy
 */

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }
const ADMIN_KEYS = [
  'admin.username',
  'admin.salt',
  'admin.password',
  'admin.token',
  'site.name',
  'registration.invite_required',
  'ai.enabled',
  'ai.membership_required',
  'ai.endpoints',
  'ai.provider',
  'ai.openaiKey',
  'ai.openaiBase',
  'ai.openaiModel',
  'ai.workersModel',
  'ai.temperature',
]

class HttpError extends Error {
  constructor(status, message, code) {
    super(message)
    this.status = status
    this.code = code
  }
}

function corsHeaders(env, request) {
  const configured = (env.CORS_ORIGIN || '*').split(',').map((item) => item.trim())
  const origin = request.headers.get('Origin') || ''
  const allow = configured.includes('*') ? '*' : configured.includes(origin) ? origin : configured[0]
  return {
    'access-control-allow-origin': allow,
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-max-age': '86400',
    vary: 'origin',
  }
}

function json(data, status, env, request) {
  return new Response(JSON.stringify(data), {
    status: status ?? 200,
    headers: { ...JSON_HEADERS, ...corsHeaders(env, request) },
  })
}

async function readJSON(request) {
  try {
    return await request.json()
  } catch {
    throw new HttpError(400, '请求体不是合法 JSON')
  }
}

function randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return [...bytes].map((n) => alphabet[n % alphabet.length]).join('')
}

function randomToken(bytesLen = 24) {
  const bytes = crypto.getRandomValues(new Uint8Array(bytesLen))
  return [...bytes].map((n) => n.toString(16).padStart(2, '0')).join('')
}

async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(password)),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 60000, hash: 'SHA-256' },
    key,
    256,
  )
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/* ---------------- 账号 / 风控 / 审计 ---------------- */

const USERNAME_RE = /^[\p{L}\p{N}_.-]{2,24}$/u
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function normalizeUsername(raw) {
  const username = String(raw || '').trim()
  if (!USERNAME_RE.test(username)) {
    throw new HttpError(400, '账号需为 2–24 位字母、数字、汉字或 _ . -')
  }
  return username
}

function normalizeEmail(raw) {
  const email = String(raw || '').trim()
  if (!email) return ''
  if (email.length > 120 || !EMAIL_RE.test(email)) throw new HttpError(400, '邮箱格式不正确')
  return email
}

function emailLower(email) {
  return email ? email.toLowerCase() : null
}

function checkPassword(password) {
  const value = String(password || '')
  if (value.length < 6) throw new HttpError(400, '密码至少 6 位')
  if (value.length > 128) throw new HttpError(400, '密码过长')
  return value
}

/** 客户端信息：IP、浏览器、Cloudflare 地区，用于登录审计 */
function clientInfo(request) {
  const cf = request.cf || {}
  const forwarded = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim()
  return {
    ip: request.headers.get('cf-connecting-ip') || forwarded || '',
    userAgent: (request.headers.get('user-agent') || '').slice(0, 300),
    country: cf.country || '',
    region: cf.region || cf.regionCode || '',
    city: cf.city || '',
    colo: cf.colo || '',
    asn: Number(cf.asn) || 0,
  }
}

function bucketKey(request, prefix) {
  return `${prefix}:${clientInfo(request).ip || 'unknown'}`
}

/** D1 固定窗口限流：超限抛 429 */
async function rateLimit(env, bucket, limit, windowSec, message) {
  const now = Date.now()
  const row = await env.DB.prepare('SELECT count, reset_at FROM rate_limits WHERE bucket = ?')
    .bind(bucket)
    .first()
  if (!row || row.reset_at <= now) {
    const resetAt = now + windowSec * 1000
    await env.DB.prepare(
      `INSERT INTO rate_limits (bucket, count, reset_at) VALUES (?, 1, ?)
       ON CONFLICT (bucket) DO UPDATE SET count = 1, reset_at = excluded.reset_at`,
    )
      .bind(bucket, resetAt)
      .run()
    return
  }
  if (row.count >= limit) {
    throw new HttpError(429, message || '操作太频繁，请稍后再试')
  }
  await env.DB.prepare('UPDATE rate_limits SET count = count + 1 WHERE bucket = ?').bind(bucket).run()
}

/** 记录登录/注册活动；顺带低频清理过期限流与 180 天前审计 */
async function logActivity(env, request, userId, kind) {
  const info = clientInfo(request)
  await env.DB.prepare(
    `INSERT INTO user_activity (user_id, kind, ip, user_agent, country, region, city, colo, asn, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(userId, kind, info.ip, info.userAgent, info.country, info.region, info.city, info.colo, info.asn, Date.now())
    .run()
  if (Math.random() < 0.05) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM rate_limits WHERE reset_at < ?').bind(Date.now() - 864e5),
      env.DB.prepare('DELETE FROM user_activity WHERE created_at < ?').bind(Date.now() - 180 * 864e5),
    ]).catch(() => {})
  }
}

async function getMembership(env, userId) {
  const row = await env.DB.prepare('SELECT expires_at FROM user_membership WHERE user_id = ?')
    .bind(userId)
    .first()
  return membershipPayload(row?.expires_at)
}

function membershipPayload(expiresAt) {
  const expires = Number(expiresAt) || 0
  return { active: expires > Date.now(), expiresAt: expires }
}

/** 签发多设备令牌，并兼容旧版单 token 字段 */
async function issueUserToken(env, userId, meta = {}) {
  const token = randomToken()
  const now = Date.now()
  const info = meta.info || {}
  const deviceName = String(meta.deviceName || '').trim().slice(0, 80) || '未命名设备'
  // 升级前的老设备可能只在 users.token 里保存令牌，先迁移到 user_tokens 再换新，
  // 这样在新设备登录不会把老设备顶下线。
  const previous = await env.DB.prepare('SELECT token FROM users WHERE id = ?').bind(userId).first()
  const statements = []
  if (previous?.token) {
    statements.push(
      env.DB.prepare(
        'INSERT OR IGNORE INTO user_tokens (token, user_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)',
      ).bind(previous.token, userId, now, now),
    )
  }
  statements.push(
    env.DB.prepare(
      `INSERT INTO user_tokens (token, user_id, created_at, last_seen_at, device_name, user_agent, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(token, userId, now, now, deviceName, info.userAgent || '', info.ip || ''),
    env.DB.prepare('UPDATE users SET token = ? WHERE id = ?').bind(token, userId),
  )
  await env.DB.batch(statements)
  return token
}

/** 设备列表里只暴露令牌的哈希摘要，不泄露原始令牌 */
async function deviceIdOf(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(token)))
  return [...new Uint8Array(digest).slice(0, 12)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function listDevices(env, userId, currentToken = '') {
  const { results } = await env.DB.prepare(
    `SELECT token, device_name, user_agent, ip, created_at, last_seen_at
     FROM user_tokens WHERE user_id = ?
     ORDER BY COALESCE(last_seen_at, created_at) DESC`,
  )
    .bind(userId)
    .all()
  return Promise.all(
    (results || []).map(async (row) => ({
      id: await deviceIdOf(row.token),
      name: row.device_name || '未命名设备',
      userAgent: row.user_agent || '',
      ip: row.ip || '',
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at || 0,
      current: Boolean(currentToken) && row.token === currentToken,
    })),
  )
}

async function revokeDevice(env, userId, deviceId) {
  const { results } = await env.DB.prepare('SELECT token FROM user_tokens WHERE user_id = ?')
    .bind(userId)
    .all()
  let match = ''
  for (const row of results || []) {
    if ((await deviceIdOf(row.token)) === deviceId) {
      match = row.token
      break
    }
  }
  if (!match) throw new HttpError(404, '设备不存在或已退出')
  await env.DB.batch([
    env.DB.prepare('DELETE FROM user_tokens WHERE token = ?').bind(match),
    env.DB.prepare('UPDATE users SET token = ? WHERE id = ? AND token = ?').bind('', userId, match),
  ])
  return match
}

async function registrationSettings(env) {
  const row = await env.DB.prepare(
    "SELECT value FROM settings WHERE key = 'registration.invite_required'",
  )
    .first()
  return { inviteRequired: row?.value === '1' }
}

/** 校验并消费注册邀请码；开启强制邀请时无码直接拒绝 */
async function consumeInviteCode(env, rawCode, required) {
  const code = String(rawCode || '').trim().toUpperCase()
  if (!code) {
    if (required) throw new HttpError(403, '本站开启了邀请注册，请填写邀请码')
    return null
  }
  const row = await env.DB.prepare(
    'SELECT code, max_uses, used_count, disabled, created_at FROM invite_codes WHERE code = ?',
  )
    .bind(code)
    .first()
  if (!row || row.disabled || row.used_count >= row.max_uses) {
    throw new HttpError(403, '邀请码无效或已用完')
  }
  const result = await env.DB.prepare(
    `UPDATE invite_codes SET used_count = used_count + 1
     WHERE code = ? AND disabled = 0 AND used_count < max_uses`,
  )
    .bind(code)
    .run()
  if (!result.meta?.changes) throw new HttpError(403, '邀请码无效或已用完')
  return code
}

/* ---------------- settings ---------------- */

async function getSetting(env, key) {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first()
  return row ? row.value : null
}

async function getSettings(env, keys) {
  if (keys.length === 0) return {}
  const placeholders = keys.map(() => '?').join(',')
  const { results } = await env.DB.prepare(
    `SELECT key, value FROM settings WHERE key IN (${placeholders})`,
  )
    .bind(...keys)
    .all()
  return Object.fromEntries((results || []).map((row) => [row.key, row.value]))
}

async function setSetting(env, key, value) {
  await env.DB.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  )
    .bind(key, String(value), Date.now())
    .run()
}

/* ---------------- 管理员 ---------------- */

async function adminBootstrap(env) {
  if (await getSetting(env, 'admin.username')) return
  const username = env.ADMIN_USER || 'admin'
  const password = env.ADMIN_TOKEN || 'admin'
  const salt = randomToken(16)
  await setSetting(env, 'admin.username', username)
  await setSetting(env, 'admin.salt', salt)
  await setSetting(env, 'admin.password', await hashPassword(password, salt))
  await setSetting(env, 'admin.token', '')
}

async function requireAdmin(request, env) {
  const header = request.headers.get('Authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) throw new HttpError(401, '缺少管理员令牌')
  const current = (await getSetting(env, 'admin.token')) || ''
  if (!current || token !== current) throw new HttpError(401, '管理员令牌无效，请重新登录')
}

async function handleAdminLogin(request, env) {
  await rateLimit(env, bucketKey(request, 'admin-login'), 15, 900, '登录尝试过于频繁，请 15 分钟后再试')
  await adminBootstrap(env)
  const body = await readJSON(request)
  const username = String(body.username || '').trim()
  const password = String(body.password || '')
  const config = await getSettings(env, ['admin.username', 'admin.salt', 'admin.password'])
  if (username !== config['admin.username']) throw new HttpError(401, '用户名或密码不正确')
  const hash = await hashPassword(password, config['admin.salt'])
  if (hash !== config['admin.password']) throw new HttpError(401, '用户名或密码不正确')
  const token = randomToken(32)
  await setSetting(env, 'admin.token', token)
  return json({ token, username }, 200, env, request)
}

async function handleAdminLogout(request, env) {
  await setSetting(env, 'admin.token', '')
  return json({ ok: true }, 200, env, request)
}

async function handleAdminPassword(request, env) {
  await requireAdmin(request, env)
  const body = await readJSON(request)
  const password = String(body.password || '')
  if (password.length < 8) throw new HttpError(400, '口令至少 8 位')
  const salt = randomToken(16)
  await setSetting(env, 'admin.salt', salt)
  await setSetting(env, 'admin.password', await hashPassword(password, salt))
  await setSetting(env, 'admin.token', '')
  return json({ ok: true }, 200, env, request)
}

async function handleAdminOverview(request, env) {
  await requireAdmin(request, env)
  const now = Date.now()
  const [users, active7, entities, members, settings, photos] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS n FROM users').first(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM user_meta WHERE last_seen_at > ? AND status = 'active'`)
      .bind(now - 7 * 864e5)
      .first(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM entities WHERE deleted = 0').first(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM user_membership WHERE expires_at > ?').bind(now).first(),
    getSettings(env, ['site.name', 'ai.enabled', 'ai.provider', 'ai.openaiModel', 'ai.workersModel', 'registration.invite_required']),
    env.DB.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM photos').first(),
  ])
  return json(
    {
      site: settings['site.name'] || env.SITE_NAME || '旅记 Travelog',
      users: users?.n ?? 0,
      active7Days: active7?.n ?? 0,
      entities: entities?.n ?? 0,
      members: members?.n ?? 0,
      photos: { count: photos?.n ?? 0, bytes: photos?.bytes ?? 0 },
      registration: { inviteRequired: settings['registration.invite_required'] === '1' },
      ai: {
        enabled: settings['ai.enabled'] !== '0',
        provider: settings['ai.provider'] || (env.OPENAI_API_KEY ? 'openai' : 'workers'),
        model: settings['ai.openaiModel'] || settings['ai.workersModel'] || 'gpt-4o-mini',
        workersBound: Boolean(env.AI),
      },
      time: now,
    },
    200,
    env,
    request,
  )
}

async function handleAdminUsers(request, env, url) {
  await requireAdmin(request, env)
  const query = (url.searchParams.get('q') || '').trim()
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 50), 1), 200)
  const offset = Math.max(Number(url.searchParams.get('offset') || 0), 0)
  const like = `%${query}%`
  const { results } = await env.DB.prepare(
    `WITH last_activity AS (
       SELECT user_id, ip, user_agent, country, region, city, colo, created_at,
              ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rn
       FROM user_activity
     )
     SELECT u.id, u.nickname, u.sync_code, u.created_at, u.email,
            COALESCE(m.status, 'active') AS status,
            m.last_seen_at,
            c.username, c.updated_at AS password_updated_at,
            um.expires_at AS membership_expires_at,
            la.ip AS last_ip, la.user_agent AS last_user_agent, la.country AS last_country,
            la.region AS last_region, la.city AS last_city, la.colo AS last_colo,
            la.created_at AS last_login_at,
            (SELECT COUNT(*) FROM entities e WHERE e.user_id = u.id AND e.deleted = 0) AS entity_count,
            (SELECT COUNT(*) FROM photos p WHERE p.user_id = u.id) AS photo_count,
            (SELECT COALESCE(SUM(size), 0) FROM photos p WHERE p.user_id = u.id) AS photo_bytes,
            (SELECT COALESCE(SUM(size), 0) FROM avatars a WHERE a.user_id = u.id) AS avatar_bytes,
            (SELECT COUNT(*) FROM user_tokens t WHERE t.user_id = u.id) AS device_count
     FROM users u
     LEFT JOIN user_meta m ON m.user_id = u.id
     LEFT JOIN user_credentials c ON c.user_id = u.id
     LEFT JOIN user_membership um ON um.user_id = u.id
     LEFT JOIN last_activity la ON la.user_id = u.id AND la.rn = 1
     WHERE (? = '' OR u.nickname LIKE ? OR u.sync_code LIKE ? OR c.username LIKE ? OR u.email LIKE ?)
     ORDER BY u.created_at DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(query, like, like, like, like, limit, offset)
    .all()
  const total = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM users u
     LEFT JOIN user_credentials c ON c.user_id = u.id
     WHERE (? = '' OR u.nickname LIKE ? OR u.sync_code LIKE ? OR c.username LIKE ? OR u.email LIKE ?)`,
  )
    .bind(query, like, like, like, like)
    .first()
  return json(
    {
      total: total?.n ?? 0,
      users: (results || []).map((row) => ({
        id: row.id,
        nickname: row.nickname,
        email: row.email || '',
        username: row.username || '',
        hasPassword: Boolean(row.username),
        passwordUpdatedAt: row.password_updated_at || 0,
        deviceCount: row.device_count || 0,
        syncCode: row.sync_code,
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at || 0,
        status: row.status,
        entityCount: row.entity_count,
        photoCount: row.photo_count || 0,
        photoBytes: row.photo_bytes || 0,
        avatarBytes: row.avatar_bytes || 0,
        membership: membershipPayload(row.membership_expires_at),
        lastLoginAt: row.last_login_at || 0,
        lastIp: row.last_ip || '',
        lastUserAgent: row.last_user_agent || '',
        lastCountry: row.last_country || '',
        lastRegion: row.last_region || '',
        lastCity: row.last_city || '',
        lastColo: row.last_colo || '',
      })),
    },
    200,
    env,
    request,
  )
}

async function handleAdminUserPatch(request, env, userId) {
  await requireAdmin(request, env)
  const body = await readJSON(request)
  const exists = await env.DB.prepare('SELECT id, email FROM users WHERE id = ?').bind(userId).first()
  if (!exists) throw new HttpError(404, '用户不存在')
  if (body.nickname !== undefined) {
    await env.DB.prepare('UPDATE users SET nickname = ? WHERE id = ?')
      .bind(String(body.nickname).slice(0, 24), userId)
      .run()
  }
  if (body.email !== undefined) {
    const email = normalizeEmail(body.email)
    if (email) {
      const taken = await env.DB.prepare('SELECT id FROM users WHERE email_lower = ? AND id != ?')
        .bind(email.toLowerCase(), userId)
        .first()
      if (taken) throw new HttpError(409, '这个邮箱已被其他账号使用')
    }
    await env.DB.prepare('UPDATE users SET email = ?, email_lower = ? WHERE id = ?')
      .bind(email || null, emailLower(email), userId)
      .run()
  }
  if (body.status !== undefined) {
    const status = body.status === 'disabled' ? 'disabled' : 'active'
    await env.DB.prepare(
      `INSERT INTO user_meta (user_id, status) VALUES (?, ?)
       ON CONFLICT (user_id) DO UPDATE SET status = excluded.status`,
    )
      .bind(userId, status)
      .run()
  }
  if (body.note !== undefined) {
    await env.DB.prepare(
      `INSERT INTO user_meta (user_id, note) VALUES (?, ?)
       ON CONFLICT (user_id) DO UPDATE SET note = excluded.note`,
    )
      .bind(userId, String(body.note).slice(0, 200))
      .run()
  }
  if (body.membershipDays !== undefined) {
    const days = Math.floor(Number(body.membershipDays) || 0)
    if (days <= 0) {
      await env.DB.prepare('DELETE FROM user_membership WHERE user_id = ?').bind(userId).run()
    } else {
      const current = await env.DB.prepare('SELECT expires_at FROM user_membership WHERE user_id = ?')
        .bind(userId)
        .first()
      const base = Math.max(Date.now(), Number(current?.expires_at) || 0)
      const expiresAt = base + Math.min(days, 3650) * 864e5
      await env.DB.prepare(
        `INSERT INTO user_membership (user_id, expires_at, source, updated_at) VALUES (?, ?, 'admin', ?)
         ON CONFLICT (user_id) DO UPDATE SET expires_at = excluded.expires_at, source = 'admin', updated_at = excluded.updated_at`,
      )
        .bind(userId, expiresAt, Date.now())
        .run()
    }
  }

  // 管理员可改账号名 / 重置密码；密码只存 PBKDF2 加盐哈希，不可反向查看
  const wantsPassword = body.password !== undefined && String(body.password).length > 0
  const wantsUsername = body.username !== undefined && String(body.username).trim().length > 0
  if (wantsPassword || wantsUsername) {
    const existing = await env.DB.prepare(
      'SELECT username, salt, password_hash FROM user_credentials WHERE user_id = ?',
    )
      .bind(userId)
      .first()
    const username = wantsUsername ? normalizeUsername(body.username) : existing?.username || ''
    if (!username) throw new HttpError(400, '该用户还没有账号名，请同时填写账号名')
    if (wantsUsername) {
      const taken = await env.DB.prepare(
        'SELECT user_id FROM user_credentials WHERE username_lower = ? AND user_id != ?',
      )
        .bind(username.toLowerCase(), userId)
        .first()
      if (taken) throw new HttpError(409, '这个账号名已被使用')
    }
    const salt = wantsPassword ? randomToken(16) : existing?.salt
    const passwordHash = wantsPassword
      ? await hashPassword(checkPassword(body.password), salt)
      : existing?.password_hash
    if (!salt || !passwordHash) throw new HttpError(400, '请设置新密码')
    await env.DB.prepare(
      `INSERT INTO user_credentials (user_id, username, username_lower, salt, password_hash, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         username = excluded.username, username_lower = excluded.username_lower,
         salt = excluded.salt, password_hash = excluded.password_hash, updated_at = excluded.updated_at`,
    )
      .bind(userId, username, username.toLowerCase(), salt, passwordHash, Date.now())
      .run()
    if (wantsPassword) {
      // 管理员重置密码后，所有设备令牌立即失效，用户需用新密码重新登录
      await env.DB.batch([
        env.DB.prepare('DELETE FROM user_tokens WHERE user_id = ?').bind(userId),
        env.DB.prepare('UPDATE users SET token = ? WHERE id = ?').bind('', userId),
      ])
      await logActivity(env, request, userId, 'admin-password-reset').catch(() => {})
    }
  }

  const updated = await env.DB.prepare(
    'SELECT u.nickname, u.email, c.username FROM users u LEFT JOIN user_credentials c ON c.user_id = u.id WHERE u.id = ?',
  )
    .bind(userId)
    .first()
  return json(
    {
      ok: true,
      nickname: updated?.nickname || '',
      email: updated?.email || '',
      username: updated?.username || '',
      hasPassword: Boolean(updated?.username),
    },
    200,
    env,
    request,
  )
}

/** 管理员查看某用户的登录设备 */
async function handleAdminUserDevices(request, env, userId) {
  await requireAdmin(request, env)
  const exists = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first()
  if (!exists) throw new HttpError(404, '用户不存在')
  return json({ devices: await listDevices(env, userId) }, 200, env, request)
}

/** 管理员强制某台设备下线 */
async function handleAdminUserDeviceRevoke(request, env, userId, deviceId) {
  await requireAdmin(request, env)
  await revokeDevice(env, userId, deviceId)
  await logActivity(env, request, userId, 'admin-device-revoke').catch(() => {})
  return json({ ok: true }, 200, env, request)
}

async function handleAdminUserResetCode(request, env, userId) {
  await requireAdmin(request, env)
  const exists = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first()
  if (!exists) throw new HttpError(404, '用户不存在')
  const syncCode = randomCode()
  await env.DB.prepare('UPDATE users SET sync_code = ? WHERE id = ?').bind(syncCode, userId).run()
  return json({ syncCode }, 200, env, request)
}

async function handleAdminUserDelete(request, env, userId) {
  await requireAdmin(request, env)
  // 先清 R2 里的照片与头像文件，再删数据库记录
  if (env.PHOTOS) {
    const [photoRows, avatarRows] = await Promise.all([
      env.DB.prepare('SELECT r2_key FROM photos WHERE user_id = ?').bind(userId).all(),
      env.DB.prepare('SELECT r2_key FROM avatars WHERE user_id = ?').bind(userId).all(),
    ])
    const keys = [...(photoRows.results || []), ...(avatarRows.results || [])].map((row) => row.r2_key)
    for (let index = 0; index < keys.length; index += 900) {
      try {
        await env.PHOTOS.delete(keys.slice(index, index + 900))
      } catch {
        /* R2 删除失败不阻塞账号删除 */
      }
    }
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM entities WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM ai_jobs WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM photos WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM avatars WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM user_meta WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM user_credentials WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM user_tokens WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM user_membership WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM user_activity WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM trip_shares WHERE member_id = ? OR owner_id = ?').bind(userId, userId),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId),
  ])
  return json({ ok: true }, 200, env, request)
}

/* ---------------- 会员码 / 邀请码管理 ---------------- */

function codeType(raw) {
  return raw === 'invite' ? 'invite' : 'membership'
}

async function handleAdminCodesList(request, env, url) {
  await requireAdmin(request, env)
  const type = codeType(url.searchParams.get('type'))
  if (type === 'invite') {
    const { results } = await env.DB.prepare(
      `SELECT code, note, max_uses, used_count, disabled, created_at
       FROM invite_codes ORDER BY created_at DESC LIMIT 200`,
    ).all()
    return json(
      {
        type,
        codes: (results || []).map((row) => ({
          code: row.code,
          note: row.note || '',
          maxUses: row.max_uses,
          usedCount: row.used_count,
          disabled: Boolean(row.disabled),
          createdAt: row.created_at,
        })),
      },
      200,
      env,
      request,
    )
  }
  const { results } = await env.DB.prepare(
    `SELECT code, days, note, max_uses, used_count, expires_at, created_at
     FROM membership_codes ORDER BY created_at DESC LIMIT 200`,
  ).all()
  return json(
    {
      type,
      codes: (results || []).map((row) => ({
        code: row.code,
        days: row.days,
        note: row.note || '',
        maxUses: row.max_uses,
        usedCount: row.used_count,
        expiresAt: row.expires_at || 0,
        createdAt: row.created_at,
      })),
    },
    200,
    env,
    request,
  )
}

async function handleAdminCodesCreate(request, env) {
  await requireAdmin(request, env)
  const body = await readJSON(request)
  const type = codeType(body.type)
  const count = Math.min(Math.max(Math.floor(Number(body.count) || 1), 1), 50)
  const maxUses = Math.min(Math.max(Math.floor(Number(body.maxUses) || 1), 1), 10000)
  const note = String(body.note || '').slice(0, 100)
  const days = type === 'membership' ? Math.min(Math.max(Math.floor(Number(body.days) || 30), 1), 3650) : 0
  const now = Date.now()
  const created = []
  for (let i = 0; i < count; i += 1) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = randomCode()
      try {
        if (type === 'invite') {
          await env.DB.prepare(
            `INSERT INTO invite_codes (code, note, max_uses, used_count, disabled, created_at)
             VALUES (?, ?, ?, 0, 0, ?)`,
          )
            .bind(code, note, maxUses, now)
            .run()
        } else {
          await env.DB.prepare(
            `INSERT INTO membership_codes (code, days, note, max_uses, used_count, created_at)
             VALUES (?, ?, ?, ?, 0, ?)`,
          )
            .bind(code, days, note, maxUses, now)
            .run()
        }
        created.push(code)
        break
      } catch {
        // 极小概率撞码，重试
      }
    }
  }
  return json({ type, codes: created, days, maxUses }, 201, env, request)
}

async function handleAdminCodeDelete(request, env, type, code) {
  await requireAdmin(request, env)
  if (codeType(type) === 'invite') {
    await env.DB.prepare('DELETE FROM invite_codes WHERE code = ?').bind(code).run()
  } else {
    await env.DB.prepare('DELETE FROM membership_codes WHERE code = ?').bind(code).run()
  }
  return json({ ok: true }, 200, env, request)
}

function maskKey(key) {
  if (!key) return ''
  return `${key.slice(0, 5)}…${key.slice(-4)}`
}

async function readRawEndpoints(env) {
  const raw = await getSetting(env, 'ai.endpoints')
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function handleAdminSettingsGet(request, env) {
  await requireAdmin(request, env)
  const map = await getSettings(env, ADMIN_KEYS)
  const config = await loadEndpoints(env)
  return json(
    {
      site: { name: map['site.name'] || env.SITE_NAME || '旅记 Travelog' },
      registration: { inviteRequired: map['registration.invite_required'] === '1' },
      ai: {
        enabled: map['ai.enabled'] !== '0',
        membershipRequired: map['ai.membership_required'] !== '0',
        temperature: Number(map['ai.temperature'] || 0.6),
        workersBound: Boolean(env.AI),
        endpoints: config.all.map((item) => ({
          id: item.id,
          name: item.name || item.type,
          type: item.type === 'workers' ? 'workers' : 'openai',
          base: item.base || '',
          model: item.model || '',
          models: endpointModels(item),
          key: maskKey(item.key),
          hasKey: Boolean(item.key),
          weight: Number(item.weight) || 1,
          enabled: item.enabled !== false,
          usable: item.type === 'workers' ? Boolean(env.AI) : Boolean(item.key),
        })),
      },
    },
    200,
    env,
    request,
  )
}

async function handleAdminSettingsPut(request, env) {
  await requireAdmin(request, env)
  const body = await readJSON(request)
  const ai = body.ai || {}
  const site = body.site || {}
  const registration = body.registration || {}
  if (site.name !== undefined) await setSetting(env, 'site.name', String(site.name).slice(0, 60))
  if (registration.inviteRequired !== undefined) {
    await setSetting(env, 'registration.invite_required', registration.inviteRequired ? '1' : '0')
  }
  if (ai.enabled !== undefined) await setSetting(env, 'ai.enabled', ai.enabled ? '1' : '0')
  if (ai.membershipRequired !== undefined) {
    await setSetting(env, 'ai.membership_required', ai.membershipRequired ? '1' : '0')
  }

  // 多接口：按 id 合并，密钥留空或带掩码时保留原值
  if (Array.isArray(ai.endpoints)) {
    const previous = await readRawEndpoints(env)
    const byId = new Map(previous.map((item) => [item.id, item]))
    const next = ai.endpoints.slice(0, 8).map((item, index) => {
      const prev = byId.get(item.id) || {}
      const typed = typeof item.key === 'string' ? item.key.trim() : ''
      const keepKey = !typed || typed.includes('…')
      const models = endpointModels(item)
      return {
        id: String(item.id || `ep${index + 1}`),
        name: String(item.name || `接口 ${index + 1}`).slice(0, 30),
        type: item.type === 'workers' ? 'workers' : 'openai',
        base: String(item.base || 'https://api.openai.com/v1').slice(0, 200),
        model: models[0] || '',
        models,
        key: keepKey ? prev.key || '' : typed,
        weight: Math.max(1, Math.min(10, Number(item.weight) || 1)),
        enabled: item.enabled !== false,
      }
    })
    await setSetting(env, 'ai.endpoints', JSON.stringify(next))
  }

  if (ai.temperature !== undefined) {
    const t = Math.min(Math.max(Number(ai.temperature) || 0.6, 0), 1)
    await setSetting(env, 'ai.temperature', String(t))
  }
  return json({ ok: true }, 200, env, request)
}

/** 测试单个接口或全部接口，返回每个的耗时与样本 */
async function handleAdminAITest(request, env) {
  await requireAdmin(request, env)
  const body = await readJSON(request).catch(() => ({}))
  const config = await loadEndpoints(env)
  const targetId = String(body.endpointId || '')
  const targets = targetId
    ? config.endpoints.filter((item) => item.id === targetId)
    : config.endpoints

  if (targets.length === 0) throw new HttpError(400, '没有可用的 AI 接口')

  const messages = [{ role: 'user', content: '用一句话介绍你自己。' }]
  const results = []
  for (const endpoint of targets) {
    try {
      const result = await callEndpoint(env, endpoint, messages, 0.4)
      results.push({
        id: endpoint.id,
        name: endpoint.name,
        model: result.model,
        ms: result.ms,
        ok: true,
        sample: result.text.slice(0, 120),
      })
    } catch (error) {
      results.push({
        id: endpoint.id,
        name: endpoint.name,
        model: endpoint.model,
        ms: 0,
        ok: false,
        error: error.message,
      })
    }
  }
  return json({ ok: results.some((item) => item.ok), results }, 200, env, request)
}

/** 拉取模型列表：OpenAI 兼容走 /models，Workers AI 返回内置候选 */
async function handleAdminAIModels(request, env, url) {
  await requireAdmin(request, env)
  const config = await loadEndpoints(env)
  const endpoint = config.endpoints.find((item) => item.id === url.searchParams.get('endpointId'))
  if (!endpoint) throw new HttpError(404, '接口不存在')

  if (endpoint.type === 'workers') {
    return json(
      {
        models: [
          '@cf/meta/llama-3.1-8b-instruct-fp8',
          '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
          '@cf/qwen/qwen1.5-14b-chat-awq',
          '@cf/mistral/mistral-7b-instruct-v0.2',
        ],
      },
      200,
      env,
      request,
    )
  }

  const base = (endpoint.base || 'https://api.openai.com/v1').replace(/\/$/, '')
  const response = await fetch(`${base}/models`, {
    headers: { authorization: `Bearer ${endpoint.key}` },
  })
  if (!response.ok) throw new HttpError(502, `拉取模型失败：${response.status}`)
  const data = await response.json()
  const models = (data.data || [])
    .map((item) => item.id)
    .filter(Boolean)
    .sort()
  return json({ models: models.slice(0, 200) }, 200, env, request)
}

/* ---------------- 普通用户 ---------------- */

function bearerToken(request) {
  const header = request.headers.get('Authorization') || ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() : ''
}

async function requireUser(request, env) {
  const token = bearerToken(request)
  if (!token) throw new HttpError(401, '缺少访问令牌')
  const select = `SELECT u.id, u.sync_code, u.nickname, u.created_at, u.email,
                         c.username, c.updated_at AS password_updated_at,
                         um.expires_at AS membership_expires_at
                  FROM users u
                  LEFT JOIN user_credentials c ON c.user_id = u.id
                  LEFT JOIN user_membership um ON um.user_id = u.id`
  let row = await env.DB.prepare(
    `${select} JOIN user_tokens t ON t.user_id = u.id WHERE t.token = ?`,
  )
    .bind(token)
    .first()
  if (row) {
    await env.DB.prepare('UPDATE user_tokens SET last_seen_at = ? WHERE token = ?')
      .bind(Date.now(), token)
      .run()
  } else {
    // 兼容升级前签发的旧 token：命中后自动登记为多设备令牌
    row = await env.DB.prepare(`${select} WHERE u.token = ?`).bind(token).first()
    if (row) {
      const now = Date.now()
      await env.DB.prepare(
        `INSERT OR IGNORE INTO user_tokens (token, user_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)`,
      )
        .bind(token, row.id, now, now)
        .run()
    }
  }
  if (!row) throw new HttpError(401, '访问令牌无效，请重新登录')
  const meta = await env.DB.prepare('SELECT status FROM user_meta WHERE user_id = ?').bind(row.id).first()
  if (meta?.status === 'disabled') throw new HttpError(403, '该账号已被停用')
  await env.DB.prepare(
    `INSERT INTO user_meta (user_id, status, last_seen_at) VALUES (?, 'active', ?)
     ON CONFLICT (user_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
  )
    .bind(row.id, Date.now())
    .run()
  return {
    ...row,
    membership: membershipPayload(row.membership_expires_at),
    needsCredentials: !row.username,
    hasPassword: Boolean(row.username),
    passwordUpdatedAt: row.password_updated_at || 0,
  }
}

async function uniqueSyncCode(env) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = randomCode()
    const hit = await env.DB.prepare('SELECT 1 AS x FROM users WHERE sync_code = ?').bind(code).first()
    if (!hit) return code
  }
  throw new HttpError(500, '生成同步码失败，请重试')
}

function authPayload(userId, token, row, username) {
  return {
    userId,
    token,
    syncCode: row.sync_code,
    nickname: row.nickname,
    username: username || '',
    email: row.email || '',
    membership: membershipPayload(row.membership_expires_at),
    needsCredentials: !username,
  }
}

/** GET /api/auth/config：注册页据此决定是否显示邀请码 */
async function handleAuthConfig(request, env) {
  const registration = await registrationSettings(env)
  return json(
    {
      site: (await getSetting(env, 'site.name')) || env.SITE_NAME || '旅记 Travelog',
      inviteRequired: registration.inviteRequired,
    },
    200,
    env,
    request,
  )
}

async function handleRegister(request, env) {
  await rateLimit(env, bucketKey(request, 'register'), 10, 3600, '注册过于频繁，请稍后再试')
  const body = await readJSON(request).catch(() => ({}))
  const nickname = String(body.nickname || '旅人').trim().slice(0, 24) || '旅人'
  const rawUsername = String(body.username || '').trim()
  const rawPassword = String(body.password || '')
  const withCredentials = Boolean(rawUsername || rawPassword)
  let username = ''
  let password = ''
  if (withCredentials) {
    username = normalizeUsername(rawUsername)
    password = checkPassword(rawPassword)
    const taken = await env.DB.prepare('SELECT 1 AS x FROM user_credentials WHERE username_lower = ?')
      .bind(username.toLowerCase())
      .first()
    if (taken) throw new HttpError(409, '这个账号已被使用')
  }

  const registration = await registrationSettings(env)
  const inviteCode = await consumeInviteCode(env, body.inviteCode, registration.inviteRequired)

  const id = crypto.randomUUID()
  const syncCode = await uniqueSyncCode(env)
  const token = randomToken()
  const now = Date.now()
  const info = clientInfo(request)
  const deviceName = String(body.deviceName || '').trim().slice(0, 80) || '未命名设备'
  const statements = [
    env.DB.prepare(
      'INSERT INTO users (id, sync_code, token, nickname, created_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(id, syncCode, token, nickname, now),
    env.DB.prepare(
      `INSERT INTO user_meta (user_id, status, last_seen_at) VALUES (?, 'active', ?)
       ON CONFLICT (user_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
    ).bind(id, now),
    env.DB.prepare(
      `INSERT INTO user_tokens (token, user_id, created_at, last_seen_at, device_name, user_agent, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(token, id, now, now, deviceName, info.userAgent, info.ip),
  ]
  if (withCredentials) {
    const salt = randomToken(16)
    statements.push(
      env.DB.prepare(
        `INSERT INTO user_credentials (user_id, username, username_lower, salt, password_hash, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(id, username, username.toLowerCase(), salt, await hashPassword(password, salt), now),
    )
  }
  try {
    await env.DB.batch(statements)
  } catch (error) {
    if (String(error.message || '').includes('UNIQUE')) {
      throw new HttpError(409, '账号或同步码已被占用，请重试')
    }
    throw error
  }
  await logActivity(env, request, id, 'register')
  return json(
    {
      ...authPayload(id, token, { sync_code: syncCode, nickname, membership_expires_at: 0 }, username),
      inviteCode,
    },
    201,
    env,
    request,
  )
}

async function handleLogin(request, env) {
  const body = await readJSON(request)
  const usernameRaw = String(body.username || '').trim()

  if (usernameRaw) {
    await rateLimit(env, bucketKey(request, 'login'), 30, 900, '登录尝试过于频繁，请 15 分钟后再试')
    await rateLimit(env, `login-user:${usernameRaw.toLowerCase()}`, 10, 900, '该账号尝试次数过多，请 15 分钟后再试')
    const cred = await env.DB.prepare(
      `SELECT c.user_id, c.username, c.salt, c.password_hash,
              u.nickname, u.sync_code, u.created_at, u.email
       FROM user_credentials c JOIN users u ON u.id = c.user_id
       WHERE c.username_lower = ?`,
    )
      .bind(usernameRaw.toLowerCase())
      .first()
    if (!cred) throw new HttpError(401, '账号或密码不正确')
    const hash = await hashPassword(String(body.password || ''), cred.salt)
    if (hash !== cred.password_hash) throw new HttpError(401, '账号或密码不正确')
    const meta = await env.DB.prepare('SELECT status FROM user_meta WHERE user_id = ?').bind(cred.user_id).first()
    if (meta?.status === 'disabled') throw new HttpError(403, '该账号已被停用')
    const token = await issueUserToken(env, cred.user_id, {
      deviceName: String(body.deviceName || '').trim(),
      info: clientInfo(request),
    })
    await logActivity(env, request, cred.user_id, 'login')
    const membership = await getMembership(env, cred.user_id)
    return json(
      {
        userId: cred.user_id,
        token,
        syncCode: cred.sync_code,
        nickname: cred.nickname,
        username: cred.username,
        email: cred.email || '',
        membership,
        needsCredentials: false,
      },
      200,
      env,
      request,
    )
  }

  // 兼容旧版：同步码登录（多人共享设备/旅伴仍可使用）
  const code = String(body.syncCode || '').trim().toUpperCase()
  if (!code) throw new HttpError(400, '请输入账号密码或同步码')
  await rateLimit(env, bucketKey(request, 'login-code'), 20, 900, '登录尝试过于频繁，请 15 分钟后再试')
  const row = await env.DB.prepare(
    'SELECT id, nickname, sync_code, created_at, email FROM users WHERE sync_code = ?',
  )
    .bind(code)
    .first()
  if (!row) throw new HttpError(404, '同步码不存在')
  const meta = await env.DB.prepare('SELECT status FROM user_meta WHERE user_id = ?').bind(row.id).first()
  if (meta?.status === 'disabled') throw new HttpError(403, '该账号已被停用')
  const cred = await env.DB.prepare('SELECT username FROM user_credentials WHERE user_id = ?').bind(row.id).first()
  const token = await issueUserToken(env, row.id, {
    deviceName: String(body.deviceName || '').trim(),
    info: clientInfo(request),
  })
  await logActivity(env, request, row.id, 'login-code')
  const membership = await getMembership(env, row.id)
  return json(
    {
      userId: row.id,
      token,
      syncCode: row.sync_code,
      nickname: row.nickname,
      username: cred?.username || '',
      email: row.email || '',
      membership,
      needsCredentials: !cred,
      loginMethod: 'syncCode',
    },
    200,
    env,
    request,
  )
}

/** POST /api/auth/logout：注销当前设备令牌，不影响其他设备 */
async function handleLogout(request, env) {
  const token = bearerToken(request)
  if (!token) return json({ ok: true }, 200, env, request)
  const user = await requireUser(request, env)
  await env.DB.batch([
    env.DB.prepare('DELETE FROM user_tokens WHERE token = ?').bind(token),
    // 若注销的正是旧版单 token 字段里的令牌，一并清空，避免下次登录被重新迁回
    env.DB.prepare('UPDATE users SET token = ? WHERE id = ? AND token = ?').bind('', user.id, token),
  ])
  return json({ ok: true }, 200, env, request)
}

/** GET /api/auth/me：账号资料 + 会员状态 */
async function handleMe(request, env) {
  const user = await requireUser(request, env)
  const device = await env.DB.prepare('SELECT COUNT(*) AS n FROM user_tokens WHERE user_id = ?')
    .bind(user.id)
    .first()
  return json(
    {
      userId: user.id,
      nickname: user.nickname,
      username: user.username || '',
      email: user.email || '',
      syncCode: user.sync_code,
      createdAt: user.created_at,
      membership: user.membership,
      needsCredentials: user.needsCredentials,
      hasPassword: user.hasPassword,
      passwordUpdatedAt: user.passwordUpdatedAt,
      deviceCount: device?.n ?? 0,
    },
    200,
    env,
    request,
  )
}

/** POST /api/auth/credentials：老账号补设 / 修改账号密码 */
async function handleSetCredentials(request, env) {
  const user = await requireUser(request, env)
  const body = await readJSON(request)
  const username = normalizeUsername(body.username)
  const password = checkPassword(body.password)
  const existing = await env.DB.prepare(
    'SELECT salt, password_hash FROM user_credentials WHERE user_id = ?',
  )
    .bind(user.id)
    .first()
  if (existing) {
    const current = String(body.currentPassword || '')
    if (!current) throw new HttpError(400, '修改密码需要先输入当前密码')
    const hash = await hashPassword(current, existing.salt)
    if (hash !== existing.password_hash) throw new HttpError(403, '当前密码不正确')
  }
  const taken = await env.DB.prepare(
    'SELECT user_id FROM user_credentials WHERE username_lower = ? AND user_id != ?',
  )
    .bind(username.toLowerCase(), user.id)
    .first()
  if (taken) throw new HttpError(409, '这个账号已被使用')

  const salt = randomToken(16)
  const now = Date.now()
  await env.DB.prepare(
    `INSERT INTO user_credentials (user_id, username, username_lower, salt, password_hash, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET
       username = excluded.username, username_lower = excluded.username_lower,
       salt = excluded.salt, password_hash = excluded.password_hash, updated_at = excluded.updated_at`,
  )
    .bind(user.id, username, username.toLowerCase(), salt, await hashPassword(password, salt), now)
    .run()

  // 修改密码后，其他设备令牌全部失效，当前设备保持登录
  if (existing) {
    const currentToken = bearerToken(request)
    await env.DB.batch([
      env.DB.prepare('DELETE FROM user_tokens WHERE user_id = ? AND token != ?')
        .bind(user.id, currentToken),
      // 旧版单 token 字段同步指向当前设备，防止被删除的令牌在下次登录时被重新迁回
      env.DB.prepare('UPDATE users SET token = ? WHERE id = ?').bind(currentToken, user.id),
    ])
  }
  await logActivity(env, request, user.id, existing ? 'password-change' : 'credentials-set')
  return json({ ok: true, username }, 200, env, request)
}

/** POST /api/membership/redeem：兑换会员码，到期时间累加 */
async function handleMembershipRedeem(request, env) {
  const user = await requireUser(request, env)
  await rateLimit(env, `membership:${user.id}`, 10, 3600, '兑换太频繁，请稍后再试')
  const body = await readJSON(request)
  const code = String(body.code || '').trim().toUpperCase()
  if (!code) throw new HttpError(400, '请输入会员码')
  const row = await env.DB.prepare(
    'SELECT code, days, max_uses, used_count, expires_at FROM membership_codes WHERE code = ?',
  )
    .bind(code)
    .first()
  if (!row) throw new HttpError(404, '会员码不存在')
  if (row.expires_at && row.expires_at <= Date.now()) throw new HttpError(410, '会员码已过期')

  const result = await env.DB.prepare(
    `UPDATE membership_codes SET used_count = used_count + 1
     WHERE code = ? AND used_count < max_uses AND (expires_at IS NULL OR expires_at > ?)`,
  )
    .bind(code, Date.now())
    .run()
  if (!result.meta?.changes) throw new HttpError(409, '会员码已被用完')

  const days = Math.max(1, Math.floor(Number(row.days) || 0))
  const current = await env.DB.prepare('SELECT expires_at FROM user_membership WHERE user_id = ?')
    .bind(user.id)
    .first()
  const base = Math.max(Date.now(), Number(current?.expires_at) || 0)
  const expiresAt = base + days * 864e5
  await env.DB.prepare(
    `INSERT INTO user_membership (user_id, expires_at, source, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET expires_at = excluded.expires_at, source = excluded.source, updated_at = excluded.updated_at`,
  )
    .bind(user.id, expiresAt, `code:${code}`, Date.now())
    .run()
  await logActivity(env, request, user.id, 'membership')
  return json(
    { ok: true, addedDays: days, membership: membershipPayload(expiresAt) },
    200,
    env,
    request,
  )
}

/** 修改当前账号昵称 / 邮箱（登录后可用） */
async function handleUpdateAccount(request, env) {
  const user = await requireUser(request, env)
  const body = await readJSON(request).catch(() => ({}))
  let nickname = user.nickname || ''
  let email = user.email || ''
  if (body.nickname !== undefined) {
    nickname = String(body.nickname || '').trim()
    if (!nickname) throw new HttpError(400, '昵称不能为空')
    if (nickname.length > 24) throw new HttpError(400, '昵称最多 24 个字符')
    await env.DB.prepare('UPDATE users SET nickname = ? WHERE id = ?').bind(nickname, user.id).run()
  }
  if (body.email !== undefined) {
    email = normalizeEmail(body.email)
    if (email) {
      const taken = await env.DB.prepare('SELECT id FROM users WHERE email_lower = ? AND id != ?')
        .bind(email.toLowerCase(), user.id)
        .first()
      if (taken) throw new HttpError(409, '这个邮箱已被其他账号使用')
    }
    await env.DB.prepare('UPDATE users SET email = ?, email_lower = ? WHERE id = ?')
      .bind(email || null, emailLower(email), user.id)
      .run()
  }
  return json({ userId: user.id, nickname, email }, 200, env, request)
}

/** 当前账号的登录设备列表 */
async function handleAccountDevices(request, env) {
  const user = await requireUser(request, env)
  const devices = await listDevices(env, user.id, bearerToken(request))
  return json({ devices }, 200, env, request)
}

/** 当前账号主动让某台设备下线 */
async function handleAccountDeviceRevoke(request, env, deviceId) {
  const user = await requireUser(request, env)
  const token = await revokeDevice(env, user.id, deviceId)
  await logActivity(env, request, user.id, token === bearerToken(request) ? 'logout' : 'device-revoke')
  return json({ ok: true }, 200, env, request)
}

/**
 * 游标由「updated_at + kind + id」组成，避免同一毫秒的多条实体在分页边界被跳过。
 * 兼容旧版纯数字游标（按 updated_at 处理）。
 */
function decodeSyncCursor(raw) {
  const text = String(raw ?? 0)
  const parts = text.split('~')
  if (parts.length >= 3 && /^\d+$/.test(parts[0])) {
    return {
      updatedAt: Number(parts[0]),
      kind: parts[1],
      id: parts.slice(2).join('~'),
      raw: text,
    }
  }
  const numeric = Number(text)
  return {
    updatedAt: Number.isFinite(numeric) && numeric > 0 ? numeric : 0,
    kind: '',
    id: '',
    raw: text,
  }
}

function encodeSyncCursor(row) {
  return `${row.updated_at}~${row.kind}~${row.id}`
}

async function handlePull(request, env, url) {
  const user = await requireUser(request, env)
  const cursor = decodeSyncCursor(url.searchParams.get('cursor'))
  const limit = Math.min(Number(url.searchParams.get('limit') || 500), 1000)
  // 同时拉取自己 + 已加入的共享旅程（owner 的实体）
  const { results } = await env.DB.prepare(
    `WITH shared AS (SELECT trip_id, owner_id FROM trip_shares WHERE member_id = ?)
     SELECT e.kind, e.id, e.data, e.updated_at, e.deleted FROM entities e
     WHERE (
         e.updated_at > ?
         OR (e.updated_at = ? AND (e.kind > ? OR (e.kind = ? AND e.id > ?)))
       )
       AND (
         e.user_id = ?
         OR e.user_id = (SELECT owner_id FROM shared WHERE e.kind = 'trips' AND shared.trip_id = e.id)
         OR e.user_id = (SELECT owner_id FROM shared WHERE e.kind != 'trips' AND shared.trip_id = json_extract(e.data, '$.tripId'))
       )
     ORDER BY e.updated_at ASC, e.kind ASC, e.id ASC LIMIT ?`,
  )
    .bind(
      user.id,
      cursor.updatedAt,
      cursor.updatedAt,
      cursor.kind,
      cursor.kind,
      cursor.id,
      user.id,
      limit,
    )
    .all()

  const entities = (results || []).map((row) => ({
    kind: row.kind,
    id: row.id,
    data: row.deleted ? null : JSON.parse(row.data),
    updatedAt: row.updated_at,
    deleted: Boolean(row.deleted),
  }))
  const nextCursor = results?.length ? encodeSyncCursor(results[results.length - 1]) : cursor.raw
  return json({ cursor: nextCursor, entities, hasMore: entities.length === limit }, 200, env, request)
}

async function handlePush(request, env) {
  const user = await requireUser(request, env)
  const body = await readJSON(request)
  const incoming = Array.isArray(body.entities) ? body.entities : []
  if (incoming.length === 0) return json({ applied: 0, skipped: 0, cursor: 0 }, 200, env, request)
  if (incoming.length > 500) throw new HttpError(413, '单次最多推送 500 条')

  // 已加入的共享旅程：member 的写入重定向到 owner 的实体空间，实现真协作
  const { results: shareRows } = await env.DB.prepare(
    'SELECT trip_id, owner_id FROM trip_shares WHERE member_id = ?',
  )
    .bind(user.id)
    .all()
  const shareMap = new Map((shareRows || []).map((row) => [row.trip_id, row.owner_id]))

  let applied = 0
  let invalid = 0
  const statements = []
  const now = Date.now()
  // 单行 JSON 超过这个体积（常见于未上传的 data URL 图片）直接跳过，
  // 否则会把整个 batch 打挂，导致用户一直同步失败
  const MAX_ENTITY_BYTES = 1_500_000

  for (const item of incoming) {
    const kind = String(item.kind || '')
    const id = String(item.id || '')
    if (!kind || !id) {
      invalid++
      continue
    }

    const tripId = kind === 'trips' ? id : String(item.data?.tripId || '')
    const ownerId = tripId && shareMap.has(tripId) ? shareMap.get(tripId) : user.id

    // 客户端时钟可能不准：限制在 now+5 分钟内，避免未来时间戳永久压住后续更新
    const rawUpdatedAt = Number(item.updatedAt)
    const updatedAt = Number.isFinite(rawUpdatedAt) && rawUpdatedAt > 0
      ? Math.min(rawUpdatedAt, now + 5 * 60 * 1000)
      : now
    const deleted = item.deleted ? 1 : 0
    const data = item.deleted ? '{}' : JSON.stringify(item.data ?? {})
    if (data.length > MAX_ENTITY_BYTES) {
      console.warn(`[sync] 跳过超大实体 kind=${kind} id=${id} bytes=${data.length}`)
      invalid++
      continue
    }

    statements.push(
      env.DB.prepare(
        `INSERT INTO entities (user_id, kind, id, data, updated_at, deleted)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, kind, id) DO UPDATE SET
           data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted
         WHERE excluded.updated_at >= entities.updated_at`,
      ).bind(ownerId, kind, id, data, updatedAt, deleted),
    )
  }

  if (statements.length > 0) {
    // D1 的 batch 返回每条语句的 meta.changes；被 LWW 拒绝的旧数据不会计入 applied
    const results = await env.DB.batch(statements)
    for (const result of results) applied += Number(result?.meta?.changes || 0)
  }
  return json(
    { applied, skipped: invalid + (statements.length - applied), cursor: now },
    200,
    env,
    request,
  )
}

/** 用邀请码加入别人的旅程（trip 级共享） */
async function handleJoinTrip(request, env) {
  const user = await requireUser(request, env)
  const body = await readJSON(request)
  const code = String(body.inviteCode || '')
    .trim()
    .toUpperCase()
  if (!code) throw new HttpError(400, '请输入邀请码')

  const row = await env.DB.prepare(
    `SELECT user_id, id, data FROM entities
     WHERE kind = 'trips' AND deleted = 0 AND json_extract(data, '$.inviteCode') = ?
     LIMIT 1`,
  )
    .bind(code)
    .first()

  if (!row) throw new HttpError(404, '邀请码不存在，或这趟旅程已被删除')
  if (row.user_id === user.id) throw new HttpError(400, '这是你自己的旅程')

  await env.DB.prepare(
    `INSERT INTO trip_shares (trip_id, owner_id, member_id, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (trip_id, member_id) DO NOTHING`,
  )
    .bind(row.id, row.user_id, user.id, Date.now())
    .run()

  // 在 owner 的成员列表里登记一条，owner 端能看到「谁加入了」
  const trip = JSON.parse(row.data)
  const memberId = crypto.randomUUID()
  const memberData = {
    id: memberId,
    tripId: row.id,
    userId: user.id,
    name: user.nickname || '旅伴',
    role: 'member',
    joinedAt: Date.now(),
    emojiSeed: Math.floor(Math.random() * 1000),
  }
  await env.DB.prepare(
    `INSERT INTO entities (user_id, kind, id, data, updated_at, deleted)
     VALUES (?, 'members', ?, ?, ?, 0)
     ON CONFLICT (user_id, kind, id) DO UPDATE SET
       data = excluded.data, updated_at = excluded.updated_at, deleted = 0`,
  )
    .bind(row.user_id, memberId, JSON.stringify(memberData), Date.now())
    .run()

  const owner = await env.DB.prepare('SELECT nickname FROM users WHERE id = ?').bind(row.user_id).first()

  return json(
    {
      tripId: row.id,
      title: trip.title || '',
      owner: owner?.nickname || '旅伴',
      shared: true,
    },
    200,
    env,
    request,
  )
}

/** 列出我加入的共享旅程 */
async function handleListShares(request, env) {
  const user = await requireUser(request, env)
  const { results } = await env.DB.prepare(
    `SELECT s.trip_id, s.owner_id, s.created_at, u.nickname AS owner_name,
            json_extract(e.data, '$.title') AS title
     FROM trip_shares s
     LEFT JOIN users u ON u.id = s.owner_id
     LEFT JOIN entities e ON e.user_id = s.owner_id AND e.kind = 'trips' AND e.id = s.trip_id AND e.deleted = 0
     WHERE s.member_id = ?
     ORDER BY s.created_at DESC`,
  )
    .bind(user.id)
    .all()
  return json(
    {
      shares: (results || []).map((row) => ({
        tripId: row.trip_id,
        owner: row.owner_name || '旅伴',
        title: row.title || '',
        joinedAt: row.created_at,
      })),
    },
    200,
    env,
    request,
  )
}

/** 公开的只读分享：按邀请码返回旅程与日程，不含账目、成员、照片 */
async function handleSharedTrip(request, env, rawCode) {
  const code = String(rawCode || '')
    .trim()
    .toUpperCase()
  if (!code) throw new HttpError(404, '分享链接无效或已取消')

  const row = await env.DB.prepare(
    `SELECT user_id, id, data FROM entities
     WHERE kind = 'trips' AND deleted = 0 AND json_extract(data, '$.inviteCode') = ?
     LIMIT 1`,
  )
    .bind(code)
    .first()
  if (!row) throw new HttpError(404, '分享链接无效或已取消')

  let trip = {}
  try {
    trip = JSON.parse(row.data)
  } catch {
    trip = {}
  }

  const { results } = await env.DB.prepare(
    `SELECT data FROM entities
     WHERE user_id = ? AND kind = 'plans' AND deleted = 0
       AND json_extract(data, '$.tripId') = ?`,
  )
    .bind(row.user_id, row.id)
    .all()

  const plans = (results || [])
    .map((item) => {
      try {
        return JSON.parse(item.data)
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        (Number(a.dayIndex) || 1) - (Number(b.dayIndex) || 1) ||
        String(a.time || '').localeCompare(String(b.time || '')) ||
        (Number(a.order) || 0) - (Number(b.order) || 0),
    )
    .map((plan) => ({
      dayIndex: Number(plan.dayIndex) || 1,
      time: String(plan.time || ''),
      title: String(plan.title || ''),
      place: String(plan.place || ''),
      kind: String(plan.kind || 'activity'),
      done: Boolean(plan.done),
      note: String(plan.note || ''),
      order: Number(plan.order) || 0,
    }))

  return json(
    {
      trip: {
        title: String(trip.title || ''),
        destination: String(trip.destination || ''),
        startDate: Number(trip.startDate) || 0,
        endDate: Number(trip.endDate) || 0,
        note: String(trip.note || ''),
        cover: Number(trip.cover) || 0,
        coverImage: String(trip.coverImage || ''),
      },
      plans,
    },
    200,
    env,
    request,
  )
}

async function handleLeaveShare(request, env, tripId) {
  const user = await requireUser(request, env)
  const share = await env.DB.prepare(
    'SELECT owner_id FROM trip_shares WHERE trip_id = ? AND member_id = ?',
  )
    .bind(tripId, user.id)
    .first()
  await env.DB.prepare('DELETE FROM trip_shares WHERE trip_id = ? AND member_id = ?')
    .bind(tripId, user.id)
    .run()

  // 同步删除 owner 旅程里的成员记录，避免退出后仍显示「已加入」
  if (share?.owner_id) {
    const now = Date.now()
    await env.DB.prepare(
      `UPDATE entities SET deleted = 1, data = '{}', updated_at = ?
       WHERE user_id = ? AND kind = 'members' AND deleted = 0
         AND json_extract(data, '$.tripId') = ?
         AND json_extract(data, '$.userId') = ?`,
    )
      .bind(now, share.owner_id, tripId, user.id)
      .run()
      .catch(() => {})
  }
  return json({ ok: true }, 200, env, request)
}

async function handleStats(request, env) {
  const user = await requireUser(request, env)
  const { results } = await env.DB.prepare(
    'SELECT kind, COUNT(*) AS n FROM entities WHERE user_id = ? AND deleted = 0 GROUP BY kind',
  )
    .bind(user.id)
    .all()
  const counts = Object.fromEntries((results || []).map((row) => [row.kind, row.n]))
  return json({ userId: user.id, syncCode: user.sync_code, counts }, 200, env, request)
}

/* ---------------- AI ---------------- */

/** 兼容 model 逗号分隔与 models 数组，最多 6 个模型 */
function endpointModels(item) {
  const values = []
  if (Array.isArray(item.models)) values.push(...item.models)
  if (item.model) values.push(...String(item.model).split(/[,，\s]+/))
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))].slice(0, 6)
}

async function loadEndpoints(env) {
  const map = await getSettings(env, [
    'ai.enabled',
    'ai.membership_required',
    'ai.endpoints',
    'ai.temperature',
    'ai.openaiKey',
    'ai.openaiBase',
    'ai.openaiModel',
    'ai.workersModel',
  ])

  let list = []
  if (map['ai.endpoints']) {
    try {
      const parsed = JSON.parse(map['ai.endpoints'])
      if (Array.isArray(parsed)) list = parsed
    } catch {
      list = []
    }
  }
  // 兼容旧的单接口配置
  if (list.length === 0) {
    if (map['ai.openaiKey'] || env.OPENAI_API_KEY) {
      list.push({
        id: 'legacy-openai',
        name: 'OpenAI',
        type: 'openai',
        base: map['ai.openaiBase'] || env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
        key: map['ai.openaiKey'] || env.OPENAI_API_KEY || '',
        model: map['ai.openaiModel'] || env.OPENAI_MODEL || 'gpt-4o-mini',
        weight: 1,
        enabled: true,
      })
    }
    if (env.AI) {
      list.push({
        id: 'legacy-workers',
        name: 'Workers AI',
        type: 'workers',
        model: map['ai.workersModel'] || env.AI_MODEL || '@cf/meta/llama-3.1-8b-instruct-fp8',
        weight: 1,
        enabled: true,
      })
    }
  }

  const usable = []
  for (const item of list) {
    if (item.enabled === false) continue
    if (item.type === 'workers' && !env.AI) continue
    if (item.type !== 'workers' && !item.key) continue
    // 一个站点（base + key）可以绑定多个模型：每个模型展开成可独立选择的入口
    for (const model of endpointModels(item)) {
      usable.push({ ...item, id: `${item.id}::${model}`, baseId: item.id, model })
    }
  }

  return {
    enabled: map['ai.enabled'] !== '0',
    requireMembership: map['ai.membership_required'] !== '0',
    temperature: Number(map['ai.temperature'] || 0.6),
    all: list,
    endpoints: usable,
  }
}

/** 按权重随机挑一个，实现简单负载均衡 */
function pickEndpoint(endpoints) {
  const pool = []
  for (const item of endpoints) {
    const weight = Math.max(1, Math.min(10, Number(item.weight) || 1))
    for (let i = 0; i < weight; i += 1) pool.push(item)
  }
  return pool[Math.floor(Math.random() * pool.length)]
}

async function callEndpoint(env, endpoint, messages, temperature) {
  const started = Date.now()

  if (endpoint.type === 'workers') {
    if (!env.AI) throw new Error('Workers AI 未绑定')
    const output = await env.AI.run(endpoint.model, { messages, temperature })
    return {
      text: (output.response || '').trim(),
      model: endpoint.model,
      endpoint: endpoint.name,
      ms: Date.now() - started,
    }
  }

  const base = (endpoint.base || 'https://api.openai.com/v1').replace(/\/$/, '')
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${endpoint.key}` },
    body: JSON.stringify({
      model: endpoint.model,
      messages,
      temperature,
      max_tokens: 800,
    }),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`${endpoint.name || 'OpenAI'} 返回 ${response.status}：${text.slice(0, 160)}`)
  }
  const data = await response.json()
  return {
    text: data.choices?.[0]?.message?.content?.trim() || '',
    model: endpoint.model,
    endpoint: endpoint.name,
    ms: Date.now() - started,
  }
}

/** 多个接口按权重随机，失败自动切换到下一个；指定 endpointId 时只跑该模型（用于多模型对比） */
async function runAI(env, messages, temperature, endpointId = '') {
  const config = await loadEndpoints(env)
  if (!config.enabled) throw new HttpError(503, 'AI 已在管理面板中关闭')
  if (config.endpoints.length === 0) {
    throw new HttpError(503, 'AI 未配置：在管理面板添加接口，或绑定 Workers AI')
  }

  const temp = temperature ?? config.temperature
  if (endpointId) {
    const chosen = config.endpoints.find((item) => item.id === endpointId)
    if (!chosen) throw new HttpError(400, '所选模型不可用，请刷新后重试')
    try {
      return await callEndpoint(env, chosen, messages, temp)
    } catch (error) {
      throw new HttpError(502, `${chosen.name || chosen.model} 生成失败：${error.message}`)
    }
  }

  const tried = new Set()
  let lastError = null
  for (let attempt = 0; attempt < config.endpoints.length; attempt += 1) {
    const candidates = config.endpoints.filter((item) => !tried.has(item.id))
    if (candidates.length === 0) break
    const endpoint = pickEndpoint(candidates)
    tried.add(endpoint.id)
    try {
      return await callEndpoint(env, endpoint, messages, temp)
    } catch (error) {
      lastError = error
      console.error(`ai endpoint failed: ${endpoint.name} ${error.message}`)
    }
  }
  throw new HttpError(502, `所有 AI 接口都失败了：${lastError?.message || '未知错误'}`)
}

async function handleAI(request, env) {
  const user = await requireUser(request, env)
  await requireAIAccess(env, user)
  const body = await readJSON(request)
  const system = String(body.system || '').slice(0, 2000)
  const prompt = String(body.prompt || '').slice(0, 4000)
  if (!prompt.trim()) throw new HttpError(400, 'prompt 不能为空')
  const messages = []
  if (system) messages.push({ role: 'system', content: system })
  messages.push({ role: 'user', content: prompt })
  const temperature = Math.min(Math.max(Number(body.temperature) || 0.6, 0), 1)
  const endpointId = String(body.endpointId || '').slice(0, 160)
  const result = await runAI(env, messages, temperature, endpointId)
  console.log(`ai user=${user.id} model=${result.model} chars=${result.text.length}`)
  return json(result, 200, env, request)
}

/* ---------------- 小票 OCR ---------------- */

const RECEIPT_CURRENCIES = ['CNY', 'JPY', 'USD', 'EUR', 'THB']
const RECEIPT_CATEGORIES = ['food', 'transport', 'stay', 'ticket', 'shopping', 'other']

const RECEIPT_SYSTEM_PROMPT = `你是旅行记账助手，负责从小票或收据照片中提取信息。
只返回一个 JSON 对象，不要输出任何解释、Markdown 或代码块围栏。字段要求：
- amount：number，消费总金额（不含货币符号）
- currency：string，只能是 CNY / JPY / USD / EUR / THB 之一，无法判断时用 CNY
- category：string，只能是 food / transport / stay / ticket / shopping / other 之一
- note：string，不超过 20 字的简短说明，例如店名或消费内容
看不清时尽量推断；金额必须大于 0。`

function parseJsonText(text) {
  return String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
}

/** 校验并归一化小票识别结果 */
function parseReceipt(text) {
  let parsed
  try {
    parsed = JSON.parse(parseJsonText(text))
  } catch {
    return null
  }
  const amount = Number(parsed?.amount)
  if (!Number.isFinite(amount) || amount <= 0) return null
  const currency = String(parsed?.currency || '').toUpperCase()
  if (!RECEIPT_CURRENCIES.includes(currency)) return null
  const category = String(parsed?.category || '').toLowerCase()
  if (!RECEIPT_CATEGORIES.includes(category)) return null
  return {
    amount: Math.round(amount * 100) / 100,
    currency,
    category,
    note: String(parsed?.note || '').slice(0, 60),
  }
}

async function handleReceipt(request, env) {
  const user = await requireUser(request, env)
  await requireAIAccess(env, user)
  await rateLimit(env, bucketKey(request, 'ai-receipt'), 30, 3600, '识别太频繁，请稍后再试')

  const body = await readJSON(request)
  const image = String(body.image || '').trim()
  if (!image) throw new HttpError(400, '请提供小票图片')
  if (image.length > 8_000_000) throw new HttpError(400, '图片过大，请压缩后重试')

  const messages = [
    { role: 'system', content: RECEIPT_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: '请识别这张小票，严格按要求只返回 JSON。' },
        { type: 'image_url', image_url: { url: image } },
      ],
    },
  ]
  let receipt = null
  try {
    const result = await runAI(env, messages, 0.1)
    receipt = parseReceipt(result.text)
  } catch {
    receipt = null
  }
  if (!receipt) {
    throw new HttpError(
      422,
      '当前 AI 模型不支持看图识别，请在管理后台换用支持图片的模型；也可以手动填写金额',
    )
  }

  return json(receipt, 200, env, request)
}

/* ---------------- AI 异步任务 ---------------- */

const AI_JOB_MAX = 30
const AI_JOB_STALE_MS = 15 * 60 * 1000

/** AI 开关与会员门禁；所有 AI 入口共用 */
async function requireAIAccess(env, user) {
  const config = await loadEndpoints(env)
  if (!config.enabled) throw new HttpError(503, 'AI 已在管理面板中关闭')
  if (config.requireMembership && !user.membership?.active) {
    throw new HttpError(
      403,
      'AI 是会员功能，请先在「云同步」兑换会员码后使用',
      'membership_required',
    )
  }
  return config
}

function aiJobPayload(row) {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    result: row.result || '',
    error: row.error || '',
    model: row.model || '',
    endpoint: row.endpoint || '',
    createdAt: row.created_at,
    startedAt: row.started_at || 0,
    finishedAt: row.finished_at || 0,
  }
}

/** 把失效的 running 任务标成失败，避免客户端永远转圈；无过期任务时不写库 */
async function markStaleAIJobs(env, userId) {
  const now = Date.now()
  const stale = await env.DB.prepare(
    `SELECT id FROM ai_jobs
     WHERE user_id = ? AND status IN ('queued', 'running') AND created_at < ? LIMIT 1`,
  )
    .bind(userId, now - AI_JOB_STALE_MS)
    .first()
    .catch(() => null)
  if (!stale) return
  await env.DB.prepare(
    `UPDATE ai_jobs SET status = 'error', error = ?, finished_at = ?
     WHERE user_id = ? AND status IN ('queued', 'running') AND created_at < ?`,
  )
    .bind('任务超时，请重新发起', now, userId, now - AI_JOB_STALE_MS)
    .run()
    .catch(() => {})
}

/** 新建任务后清理：兜底过期任务，并只保留最近 30 条 */
async function pruneAIJobs(env, userId) {
  await markStaleAIJobs(env, userId)
  await env.DB.prepare(
    `DELETE FROM ai_jobs WHERE user_id = ? AND id NOT IN (
       SELECT id FROM ai_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT ${AI_JOB_MAX}
     )`,
  )
    .bind(userId, userId)
    .run()
    .catch(() => {})
}

/** 后台执行：waitUntil 提交后即返回，用户可离开页面 */
async function runAIJob(env, jobId) {
  const job = await env.DB.prepare('SELECT * FROM ai_jobs WHERE id = ?').bind(jobId).first()
  if (!job || job.status !== 'queued') return
  await env.DB.prepare(`UPDATE ai_jobs SET status = 'running', started_at = ? WHERE id = ?`)
    .bind(Date.now(), jobId)
    .run()
  const messages = []
  if (job.system) messages.push({ role: 'system', content: job.system })
  messages.push({ role: 'user', content: job.prompt })
  try {
    const result = await runAI(env, messages, job.temperature, job.endpoint || '')
    await env.DB.prepare(
      `UPDATE ai_jobs SET status = 'done', result = ?, model = ?, endpoint = ?, finished_at = ?
       WHERE id = ?`,
    )
      .bind(result.text, result.model || '', result.endpoint || '', Date.now(), jobId)
      .run()
  } catch (error) {
    const message = String(error?.message || '生成失败').slice(0, 300)
    await env.DB.prepare(
      `UPDATE ai_jobs SET status = 'error', error = ?, finished_at = ? WHERE id = ?`,
    )
      .bind(message, Date.now(), jobId)
      .run()
    console.error(`ai job failed id=${jobId}: ${message}`)
  }
}

/** GET /api/ai/config：客户端据此提前展示会员提示 */
async function handleAIConfig(request, env) {
  const user = await requireUser(request, env)
  const config = await loadEndpoints(env)
  return json(
    {
      enabled: config.enabled,
      membershipRequired: config.requireMembership,
      member: Boolean(user.membership.active),
      membershipExpiresAt: user.membership.expiresAt,
      canUse:
        config.enabled &&
        config.endpoints.length > 0 &&
        (!config.requireMembership || user.membership.active),
      endpoints: config.endpoints.length,
    },
    200,
    env,
    request,
  )
}

/** GET /api/ai/models：当前可用模型列表（一个站点可绑定多个模型） */
async function handleAIModels(request, env) {
  const user = await requireUser(request, env)
  const config = await loadEndpoints(env)
  const member = Boolean(user.membership?.active)
  const canUse =
    config.enabled && config.endpoints.length > 0 && (!config.requireMembership || member)
  return json(
    {
      enabled: config.enabled,
      canUse,
      member,
      membershipRequired: config.requireMembership,
      models: canUse
        ? config.endpoints.map((item) => ({
            id: item.id,
            name: item.name || item.model,
            model: item.model,
            type: item.type || 'openai',
          }))
        : [],
    },
    200,
    env,
    request,
  )
}

/** POST /api/ai/jobs：入队后立即返回 202 */
async function handleAIJobCreate(request, env, ctx) {
  const user = await requireUser(request, env)
  const aiConfig = await requireAIAccess(env, user)
  await rateLimit(env, bucketKey(request, 'ai-job'), 40, 3600, 'AI 任务提交太频繁，请稍后再试')
  const body = await readJSON(request)
  const kind = String(body.kind || 'custom').slice(0, 24)
  const system = String(body.system || '').slice(0, 2000)
  const prompt = String(body.prompt || '').slice(0, 8000)
  if (!prompt.trim()) throw new HttpError(400, 'prompt 不能为空')
  const temperature = Math.min(Math.max(Number(body.temperature) || 0.6, 0), 1)
  const endpointId = String(body.endpointId || '').slice(0, 160)
  if (endpointId && !aiConfig.endpoints.some((item) => item.id === endpointId)) {
    throw new HttpError(400, '所选模型不可用，请刷新后重试')
  }
  const id = randomToken(12)
  const now = Date.now()
  await env.DB.prepare(
    `INSERT INTO ai_jobs (id, user_id, kind, status, prompt, system, temperature, endpoint, created_at)
     VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?)`,
  )
    .bind(id, user.id, kind, prompt, system, temperature, endpointId, now)
    .run()
  await pruneAIJobs(env, user.id)

  const job = {
    id,
    kind,
    status: 'queued',
    result: '',
    error: '',
    model: '',
    endpoint: endpointId,
    createdAt: now,
    startedAt: 0,
    finishedAt: 0,
  }
  const task = runAIJob(env, id).catch((error) => {
    console.error(`ai job crashed id=${id}: ${error?.message || error}`)
  })
  if (ctx?.waitUntil) ctx.waitUntil(task)
  else await task
  return json({ job }, 202, env, request)
}

async function handleAIJobsList(request, env, url) {
  const user = await requireUser(request, env)
  await markStaleAIJobs(env, user.id)
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 20, 1), 30)
  const { results } = await env.DB.prepare(
    `SELECT * FROM ai_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(user.id, limit)
    .all()
  return json({ jobs: (results || []).map(aiJobPayload) }, 200, env, request)
}

async function handleAIJobGet(request, env, jobId) {
  const user = await requireUser(request, env)
  const job = await env.DB.prepare('SELECT * FROM ai_jobs WHERE id = ? AND user_id = ?')
    .bind(jobId, user.id)
    .first()
  if (!job) throw new HttpError(404, 'AI 任务不存在')
  return json({ job: aiJobPayload(job) }, 200, env, request)
}

async function handleAIJobDelete(request, env, jobId) {
  const user = await requireUser(request, env)
  const result = await env.DB.prepare('DELETE FROM ai_jobs WHERE id = ? AND user_id = ?')
    .bind(jobId, user.id)
    .run()
  if (!result.meta?.changes) throw new HttpError(404, 'AI 任务不存在')
  return json({ ok: true }, 200, env, request)
}

/* ---------------- 天气 / 地理编码 ---------------- */

async function handleWeather(request, env, url) {
  const lat = Number(url.searchParams.get('lat'))
  const lon = Number(url.searchParams.get('lon'))
  const days = Math.min(Math.max(Number(url.searchParams.get('days') || 5), 1), 14)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new HttpError(400, '缺少坐标')
  const target =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
    `&forecast_days=${days}&timezone=auto`
  const response = await fetch(target, { cf: { cacheTtl: 1800 } })
  if (!response.ok) throw new HttpError(502, '天气服务不可用')
  return json(await response.json(), 200, env, request)
}

async function handleGeocode(request, env, url) {
  const query = (url.searchParams.get('q') || '').trim().slice(0, 60)
  if (!query) throw new HttpError(400, '缺少地名')
  const target =
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}` +
    `&count=1&language=zh&format=json`
  const response = await fetch(target, { cf: { cacheTtl: 86400 } })
  if (!response.ok) throw new HttpError(502, '地理编码服务不可用')
  const data = await response.json()
  const hit = data.results?.[0]
  if (!hit) return json({ found: false }, 200, env, request)
  return json(
    {
      found: true,
      name: hit.name,
      admin1: hit.admin1,
      country: hit.country,
      latitude: hit.latitude,
      longitude: hit.longitude,
      timezone: hit.timezone,
    },
    200,
    env,
    request,
  )
}

/* ---------------- 地点搜索（POI） ---------------- */

/**
 * OSM 中国地址里 city 常填成区（如「青羊区」），地级市只出现在 display_name。
 * 这里统一归一化省 / 市 / 区县 / 街道，保证手动与自动打卡语义一致。
 */
function normalizeOsmAddress(address = {}, displayName = '') {
  const tokens = String(displayName || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  const prefecture =
    tokens.find(
      (item) => item.length <= 12 && /(市|自治州|州|盟|地区)$/.test(item),
    ) || ''
  const displayDistrict =
    tokens.find((item) => item.length <= 12 && /(区|县|旗)$/.test(item)) || ''
  const rawCity = address.city || address.town || address.municipality || address.village || ''
  const cityIsDistrict = /(区|县|旗)$/.test(rawCity)
  const city = cityIsDistrict
    ? prefecture || address.state_district || ''
    : rawCity || prefecture || address.county || ''
  const district =
    address.city_district ||
    address.district ||
    address.borough ||
    address.county ||
    (cityIsDistrict ? rawCity : '') ||
    displayDistrict ||
    address.suburb ||
    ''
  const street =
    address.road ||
    address.pedestrian ||
    address.footway ||
    address.cycling_path ||
    address.suburb ||
    address.neighbourhood ||
    address.quarter ||
    ''
  const neighbourhood = address.quarter || address.neighbourhood || ''
  return {
    city,
    district,
    street,
    neighbourhood,
    province: address.state || address.province || address.region || '',
    country: address.country || '',
    countryCode: String(address.country_code || '').toUpperCase(),
  }
}

/**
 * 附近地点搜索：代理 OpenStreetMap Nominatim。
 * 带 viewbox 时只搜附近，适合「宽窄巷子」「人民公园」这类具体地点。
 */
async function handlePOI(request, env, url) {
  await rateLimit(env, bucketKey(request, 'poi'), 120, 3600, '地点搜索太频繁，请稍后再试')
  const lat = Number(url.searchParams.get('lat'))
  const lon = Number(url.searchParams.get('lon'))
  const query = (url.searchParams.get('q') || '').trim().slice(0, 60)
  if (!query) throw new HttpError(400, '缺少关键词')

  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: '8',
    'accept-language': 'zh',
    addressdetails: '1',
  })
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    const delta = 0.08
    params.set('viewbox', `${lon - delta},${lat + delta},${lon + delta},${lat - delta}`)
    params.set('bounded', '1')
  }

  const response = await fetch(
    `${env.NOMINATIM_BASE || 'https://nominatim.openstreetmap.org'}/search?${params.toString()}`,
    {
      headers: { 'User-Agent': 'Travelog/1.8 (personal travel diary)' },
      cf: { cacheTtl: 3600 },
    },
  )
  if (!response.ok) throw new HttpError(502, '地点搜索暂时不可用')

  const data = await response.json()
  const results = (Array.isArray(data) ? data : [])
    .map((item) => {
      const normalized = normalizeOsmAddress(item.address || {}, item.display_name || '')
      return {
        name: item.name || String(item.display_name || '').split(',')[0] || '',
        displayName: item.display_name || '',
        latitude: Number(item.lat),
        longitude: Number(item.lon),
        type: item.type || '',
        city: normalized.city,
        district: normalized.district,
        street: normalized.street,
      }
    })
    .filter((item) => item.name && Number.isFinite(item.latitude) && Number.isFinite(item.longitude))

  return json({ results }, 200, env, request)
}

/**
 * 逆地理编码：把坐标解析到区县 / 街道，供手动打卡与自动打卡使用。
 * 通过 Cloudflare 缓存降低对 Nominatim 的请求量。
 */
async function handleReverseGeo(request, env, url) {
  const lat = Number(url.searchParams.get('lat'))
  const lon = Number(url.searchParams.get('lon'))
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) {
    throw new HttpError(400, '缺少坐标')
  }
  await rateLimit(env, bucketKey(request, 'reverse-geo'), 180, 3600, '定位解析太频繁，请稍后再试')

  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    format: 'jsonv2',
    addressdetails: '1',
    zoom: '18',
    'accept-language': 'zh',
  })
  const response = await fetch(
    `${env.NOMINATIM_BASE || 'https://nominatim.openstreetmap.org'}/reverse?${params.toString()}`,
    {
      headers: { 'User-Agent': 'Travelog/1.8 (personal travel diary)' },
      cf: { cacheTtl: 86400 },
    },
  )
  if (!response.ok) throw new HttpError(502, '定位解析暂时不可用')

  const data = await response.json()
  const address = data.address || {}
  const normalized = normalizeOsmAddress(address, data.display_name || '')
  const { city, district, street, province, country, countryCode } = normalized
  const name =
    data.name ||
    address.tourism ||
    address.amenity ||
    address.shop ||
    address.building ||
    normalized.neighbourhood ||
    address.suburb ||
    street ||
    district ||
    city ||
    ''
  const parts = [province, city, district, street]
    .map((value) => String(value || '').trim())
    .filter((value, index, list) => value && list.indexOf(value) === index)
  return json(
    {
      found: Boolean(name || district || city),
      name,
      displayName: data.display_name || '',
      country,
      countryCode,
      province,
      city,
      district,
      street,
      areaLabel: parts.join(' · '),
      latitude: Number(data.lat) || lat,
      longitude: Number(data.lon) || lon,
    },
    200,
    env,
    request,
  )
}

/* ---------------- 照片（R2） ---------------- */

const MAX_PHOTO_BYTES = 8 * 1024 * 1024
const PHOTO_MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

/** 校验图片真实类型：不信任 data URL 里声明的 MIME */
function sniffImageMime(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return 'image/png'
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  return ''
}

function decodeBase64(input) {
  const binary = atob(input)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function photoUrl(request, id, accessKey) {
  const origin = new URL(request.url).origin
  return `${origin}/api/photos/${encodeURIComponent(id)}?k=${encodeURIComponent(accessKey)}`
}

async function handlePhotoUpload(request, env) {
  const user = await requireUser(request, env)
  if (!env.PHOTOS) throw new HttpError(503, '照片存储未配置：请绑定 R2 桶 PHOTOS')
  const body = await readJSON(request)
  const dataUrl = String(body.dataUrl || '')
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/)
  if (!match) throw new HttpError(400, '仅支持 JPEG / PNG / WebP 图片')
  // base64 长度上限先做粗判，避免解出超大数组
  if (match[2].length > Math.ceil((MAX_PHOTO_BYTES * 4) / 3) + 16) {
    throw new HttpError(413, '单张照片不能超过 8MB，请压缩后再试')
  }
  let bytes
  try {
    bytes = decodeBase64(match[2].replace(/[\r\n]/g, ''))
  } catch {
    throw new HttpError(400, '图片数据损坏，请重新选择')
  }
  if (bytes.length === 0) throw new HttpError(400, '图片内容为空')
  if (bytes.length > MAX_PHOTO_BYTES) throw new HttpError(413, '单张照片不能超过 8MB，请压缩后再试')
  const mime = sniffImageMime(bytes)
  if (!mime) throw new HttpError(400, '文件不是有效图片')

  const id = randomToken(9)
  const accessKey = randomToken(18)
  const r2Key = `users/${user.id}/${id}.${PHOTO_MIME_EXT[mime]}`
  const createdAt = Date.now()
  await env.PHOTOS.put(r2Key, bytes, {
    httpMetadata: { contentType: mime, cacheControl: 'private, max-age=31536000, immutable' },
  })
  await env.DB.prepare(
    `INSERT INTO photos (id, user_id, r2_key, access_key, mime, size, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, user.id, r2Key, accessKey, mime, bytes.length, createdAt)
    .run()
  return json({ id, url: photoUrl(request, id, accessKey), size: bytes.length, mime, createdAt }, 201, env, request)
}

async function handlePhotoGet(request, env, id, url) {
  if (!env.PHOTOS) throw new HttpError(503, '照片存储未配置')
  const key = url.searchParams.get('k') || ''
  const row = await env.DB.prepare('SELECT r2_key, access_key, mime FROM photos WHERE id = ?').bind(id).first()
  // 统一 404，避免暴露照片是否存在
  if (!row || !key || key !== row.access_key) throw new HttpError(404, '照片不存在')
  const object = await env.PHOTOS.get(row.r2_key)
  if (!object) throw new HttpError(404, '照片不存在')

  const headers = {
    'content-type': object.httpMetadata?.contentType || row.mime || 'image/jpeg',
    'cache-control': 'private, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
    'content-disposition': 'inline',
    etag: object.httpEtag,
    ...corsHeaders(env, request),
  }
  if (request.headers.get('If-None-Match') === object.httpEtag) {
    return new Response(null, { status: 304, headers })
  }
  return new Response(request.method === 'HEAD' ? null : object.body, { status: 200, headers })
}

async function handlePhotoDelete(request, env, id) {
  const user = await requireUser(request, env)
  const row = await env.DB.prepare('SELECT user_id, r2_key FROM photos WHERE id = ?').bind(id).first()
  if (!row) throw new HttpError(404, '照片不存在')
  if (row.user_id !== user.id) throw new HttpError(403, '无权删除这张照片')
  if (env.PHOTOS) await env.PHOTOS.delete(row.r2_key)
  await env.DB.prepare('DELETE FROM photos WHERE id = ?').bind(id).run()
  return json({ ok: true }, 200, env, request)
}

const MAX_AVATAR_BYTES = Math.floor(1.5 * 1024 * 1024)

function avatarUrl(request, userId, accessKey) {
  const origin = new URL(request.url).origin
  return `${origin}/api/avatar/${encodeURIComponent(userId)}?k=${encodeURIComponent(accessKey)}`
}

async function handlePhotoList(request, env, url) {
  const user = await requireUser(request, env)
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 60), 1), 200)
  const offset = Math.max(Number(url.searchParams.get('offset') || 0), 0)
  const [rows, totals] = await Promise.all([
    env.DB.prepare(
      `SELECT id, access_key, mime, size, created_at FROM photos
       WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
      .bind(user.id, limit, offset)
      .all(),
    env.DB.prepare(
      'SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes FROM photos WHERE user_id = ?',
    )
      .bind(user.id)
      .first(),
  ])
  return json(
    {
      total: totals?.count ?? 0,
      bytes: totals?.bytes ?? 0,
      photos: (rows.results || []).map((row) => ({
        id: row.id,
        url: photoUrl(request, row.id, row.access_key),
        size: row.size,
        mime: row.mime,
        createdAt: row.created_at,
      })),
    },
    200,
    env,
    request,
  )
}

async function handleAccountStorage(request, env) {
  const user = await requireUser(request, env)
  const [photos, avatar] = await Promise.all([
    env.DB.prepare(
      'SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes FROM photos WHERE user_id = ?',
    )
      .bind(user.id)
      .first(),
    env.DB.prepare('SELECT size, updated_at FROM avatars WHERE user_id = ?').bind(user.id).first(),
  ])
  return json(
    {
      photos: { count: photos?.count ?? 0, bytes: photos?.bytes ?? 0 },
      avatar: avatar ? { size: avatar.size, updatedAt: avatar.updated_at } : null,
    },
    200,
    env,
    request,
  )
}

async function handleAvatarUpload(request, env) {
  const user = await requireUser(request, env)
  if (!env.PHOTOS) throw new HttpError(503, '照片存储未配置：请绑定 R2 桶 PHOTOS')
  const body = await readJSON(request)
  const dataUrl = String(body.dataUrl || '')
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/)
  if (!match) throw new HttpError(400, '仅支持 JPEG / PNG / WebP 图片')
  if (match[2].length > Math.ceil((MAX_AVATAR_BYTES * 4) / 3) + 16) {
    throw new HttpError(413, '头像不能超过 1.5MB，请重新选择')
  }
  let bytes
  try {
    bytes = decodeBase64(match[2].replace(/[\r\n]/g, ''))
  } catch {
    throw new HttpError(400, '图片数据损坏，请重新选择')
  }
  if (bytes.length === 0) throw new HttpError(400, '图片内容为空')
  if (bytes.length > MAX_AVATAR_BYTES) throw new HttpError(413, '头像不能超过 1.5MB，请重新选择')
  const mime = sniffImageMime(bytes)
  if (!mime) throw new HttpError(400, '文件不是有效图片')

  const id = randomToken(9)
  const accessKey = randomToken(18)
  const r2Key = `avatars/${user.id}/${id}.${PHOTO_MIME_EXT[mime]}`
  const updatedAt = Date.now()
  const previous = await env.DB.prepare('SELECT r2_key FROM avatars WHERE user_id = ?').bind(user.id).first()
  await env.PHOTOS.put(r2Key, bytes, {
    httpMetadata: { contentType: mime, cacheControl: 'private, max-age=31536000, immutable' },
  })
  await env.DB.prepare(
    `INSERT INTO avatars (user_id, r2_key, access_key, mime, size, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       r2_key = excluded.r2_key,
       access_key = excluded.access_key,
       mime = excluded.mime,
       size = excluded.size,
       updated_at = excluded.updated_at`,
  )
    .bind(user.id, r2Key, accessKey, mime, bytes.length, updatedAt)
    .run()
  if (previous?.r2_key && previous.r2_key !== r2Key) {
    await env.PHOTOS.delete(previous.r2_key).catch(() => undefined)
  }
  return json(
    { url: avatarUrl(request, user.id, accessKey), size: bytes.length, mime, updatedAt },
    200,
    env,
    request,
  )
}

async function handleAvatarDelete(request, env) {
  const user = await requireUser(request, env)
  if (!env.PHOTOS) throw new HttpError(503, '照片存储未配置')
  const row = await env.DB.prepare('SELECT r2_key FROM avatars WHERE user_id = ?').bind(user.id).first()
  if (row?.r2_key) {
    await env.PHOTOS.delete(row.r2_key).catch(() => undefined)
    await env.DB.prepare('DELETE FROM avatars WHERE user_id = ?').bind(user.id).run()
  }
  return json({ ok: true }, 200, env, request)
}

async function handleAvatarGet(request, env, userId, url) {
  if (!env.PHOTOS) throw new HttpError(503, '照片存储未配置')
  const key = url.searchParams.get('k') || ''
  const row = await env.DB.prepare('SELECT r2_key, access_key, mime FROM avatars WHERE user_id = ?')
    .bind(userId)
    .first()
  if (!row || !key || key !== row.access_key) throw new HttpError(404, '头像不存在')
  const object = await env.PHOTOS.get(row.r2_key)
  if (!object) throw new HttpError(404, '头像不存在')

  const headers = {
    'content-type': object.httpMetadata?.contentType || row.mime || 'image/jpeg',
    'cache-control': 'private, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
    'content-disposition': 'inline',
    etag: object.httpEtag,
    ...corsHeaders(env, request),
  }
  if (request.headers.get('If-None-Match') === object.httpEtag) {
    return new Response(null, { status: 304, headers })
  }
  return new Response(request.method === 'HEAD' ? null : object.body, { status: 200, headers })
}

async function handleAdminPhotos(request, env, url) {
  await requireAdmin(request, env)
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 60), 1), 200)
  const offset = Math.max(Number(url.searchParams.get('offset') || 0), 0)
  const q = (url.searchParams.get('q') || '').trim().slice(0, 80)
  const mimeRaw = (url.searchParams.get('mime') || '').trim().toLowerCase()
  const mime = /^image\/(jpeg|png|webp)$/.test(mimeRaw) ? mimeRaw : ''

  const where = []
  const binds = []
  if (q) {
    where.push('(p.id LIKE ? OR p.user_id LIKE ? OR u.nickname LIKE ? OR u.sync_code LIKE ? OR c.username LIKE ?)')
    const like = `%${q}%`
    binds.push(like, like, like, like, like)
  }
  if (mime) {
    where.push('p.mime = ?')
    binds.push(mime)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const fromSql = `FROM photos p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN user_credentials c ON c.user_id = p.user_id`
  const [total, overall, rows] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(p.size), 0) AS bytes, COUNT(DISTINCT p.user_id) AS users
       ${fromSql} ${whereSql}`,
    )
      .bind(...binds)
      .first(),
    env.DB.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM photos').first(),
    env.DB.prepare(
      `SELECT p.id, p.user_id, p.access_key, p.mime, p.size, p.created_at,
              u.nickname, u.sync_code, u.created_at AS user_created_at, c.username
       ${fromSql} ${whereSql}
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
    )
      .bind(...binds, limit, offset)
      .all(),
  ])
  return json(
    {
      total: total?.n ?? 0,
      bytes: total?.bytes ?? 0,
      users: total?.users ?? 0,
      allTotal: overall?.n ?? 0,
      allBytes: overall?.bytes ?? 0,
      photos: (rows.results || []).map((row) => ({
        id: row.id,
        userId: row.user_id,
        nickname: row.nickname || '',
        username: row.username || '',
        syncCode: row.sync_code || '',
        userCreatedAt: row.user_created_at || 0,
        mime: row.mime,
        size: row.size,
        createdAt: row.created_at,
        url: photoUrl(request, row.id, row.access_key),
      })),
    },
    200,
    env,
    request,
  )
}

async function handleAdminPhotoDelete(request, env, id) {
  await requireAdmin(request, env)
  const row = await env.DB.prepare('SELECT r2_key FROM photos WHERE id = ?').bind(id).first()
  if (!row) throw new HttpError(404, '照片不存在')
  if (env.PHOTOS) await env.PHOTOS.delete(row.r2_key)
  await env.DB.prepare('DELETE FROM photos WHERE id = ?').bind(id).run()
  return json({ ok: true }, 200, env, request)
}

/* ---------------- 入口 ---------------- */

const APP_REPO = 'jijiayi0626/travelog-multiplatform'

/** GET /api/app/latest：服务端代理 GitHub Releases，避免客户端被限流/直连不稳 */
async function handleAppLatest(request, env) {
  const response = await fetch(`https://api.github.com/repos/${APP_REPO}/releases/latest`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'travelog-app' },
    cf: { cacheTtl: 600, cacheEverything: true, cacheKey: 'travelog-latest-release-v1' },
  }).catch(() => null)
  if (!response || !response.ok) throw new HttpError(502, '检查更新失败，请稍后再试')
  const release = await response.json()
  const assets = (release.assets || [])
    .filter((asset) => String(asset.name || '').toLowerCase().endsWith('.apk'))
    .map((asset) => ({
      name: String(asset.name || ''),
      size: Number(asset.size) || 0,
      url: String(asset.browser_download_url || ''),
    }))
  return json(
    {
      version: String(release.tag_name || '').replace(/^v/, ''),
      tag: String(release.tag_name || ''),
      name: String(release.name || ''),
      publishedAt: Number(new Date(release.published_at || 0)) || 0,
      notes: String(release.body || '').slice(0, 2000),
      assets,
    },
    200,
    env,
    request,
  )
}

async function handleApi(request, env, url, ctx) {
  const route = `${request.method} ${url.pathname}`

  if (route === 'GET /api/app/latest') return await handleAppLatest(request, env)

  if (route === 'GET /api/health') {
    const ai = await loadEndpoints(env).catch(() => null)
    return json(
      {
        ok: true,
        ai: Boolean(ai?.enabled && ai.endpoints.length > 0),
        endpoints: ai?.endpoints.length ?? 0,
        site: env.SITE_NAME || '旅记 Travelog',
        time: Date.now(),
      },
      200,
      env,
      request,
    )
  }

  if (route === 'POST /api/admin/login') return await handleAdminLogin(request, env)
  if (route === 'POST /api/admin/logout') return await handleAdminLogout(request, env)
  if (route === 'POST /api/admin/password') return await handleAdminPassword(request, env)
  if (route === 'GET /api/admin/overview') return await handleAdminOverview(request, env)
  if (route === 'GET /api/admin/users') return await handleAdminUsers(request, env, url)
  if (route === 'GET /api/admin/settings') return await handleAdminSettingsGet(request, env)
  if (route === 'PUT /api/admin/settings') return await handleAdminSettingsPut(request, env)
  if (route === 'POST /api/admin/ai/test') return await handleAdminAITest(request, env)
  if (route === 'GET /api/admin/ai/models') return await handleAdminAIModels(request, env, url)
  if (route === 'GET /api/admin/codes') return await handleAdminCodesList(request, env, url)
  if (route === 'POST /api/admin/codes') return await handleAdminCodesCreate(request, env)
  if (route === 'GET /api/admin/photos') return await handleAdminPhotos(request, env, url)

  const adminPhotoMatch = url.pathname.match(/^\/api\/admin\/photos\/([^/]+)$/)
  if (adminPhotoMatch && request.method === 'DELETE') {
    return await handleAdminPhotoDelete(request, env, decodeURIComponent(adminPhotoMatch[1]))
  }

  const adminCodeMatch = url.pathname.match(/^\/api\/admin\/codes\/(membership|invite)\/([^/]+)$/)
  if (adminCodeMatch && request.method === 'DELETE') {
    return await handleAdminCodeDelete(
      request,
      env,
      adminCodeMatch[1],
      decodeURIComponent(adminCodeMatch[2]),
    )
  }

  const userMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/)
  if (userMatch && request.method === 'PATCH') {
    return await handleAdminUserPatch(request, env, decodeURIComponent(userMatch[1]))
  }
  if (userMatch && request.method === 'DELETE') {
    return await handleAdminUserDelete(request, env, decodeURIComponent(userMatch[1]))
  }
  const userDevicesMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/devices$/)
  if (userDevicesMatch && request.method === 'GET') {
    return await handleAdminUserDevices(request, env, decodeURIComponent(userDevicesMatch[1]))
  }
  const userDeviceMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/devices\/([^/]+)$/)
  if (userDeviceMatch && request.method === 'DELETE') {
    return await handleAdminUserDeviceRevoke(
      request,
      env,
      decodeURIComponent(userDeviceMatch[1]),
      decodeURIComponent(userDeviceMatch[2]),
    )
  }
  const resetMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/reset-code$/)
  if (resetMatch && request.method === 'POST') {
    return await handleAdminUserResetCode(request, env, decodeURIComponent(resetMatch[1]))
  }

  if (route === 'POST /api/auth/register') return await handleRegister(request, env)
  if (route === 'POST /api/auth/login') return await handleLogin(request, env)
  if (route === 'POST /api/auth/logout') return await handleLogout(request, env)
  if (route === 'GET /api/auth/config') return await handleAuthConfig(request, env)
  if (route === 'GET /api/auth/me') return await handleMe(request, env)
  if (route === 'POST /api/auth/credentials') return await handleSetCredentials(request, env)
  if (route === 'POST /api/membership/redeem') return await handleMembershipRedeem(request, env)
  if (route === 'PATCH /api/account') return await handleUpdateAccount(request, env)
  if (route === 'GET /api/account/storage') return await handleAccountStorage(request, env)
  if (route === 'GET /api/account/devices') return await handleAccountDevices(request, env)
  const accountDeviceMatch = url.pathname.match(/^\/api\/account\/devices\/([A-Za-z0-9]+)$/)
  if (accountDeviceMatch && request.method === 'DELETE') {
    return await handleAccountDeviceRevoke(request, env, accountDeviceMatch[1])
  }
  if (route === 'POST /api/photos') return await handlePhotoUpload(request, env)
  if (route === 'GET /api/photos') return await handlePhotoList(request, env, url)
  const photoMatch = url.pathname.match(/^\/api\/photos\/([A-Za-z0-9]+)$/)
  if (photoMatch && (request.method === 'GET' || request.method === 'HEAD')) {
    return await handlePhotoGet(request, env, photoMatch[1], url)
  }
  if (photoMatch && request.method === 'DELETE') {
    return await handlePhotoDelete(request, env, photoMatch[1])
  }

  if (route === 'POST /api/avatar') return await handleAvatarUpload(request, env)
  if (route === 'DELETE /api/avatar') return await handleAvatarDelete(request, env)
  const avatarMatch = url.pathname.match(/^\/api\/avatar\/([A-Za-z0-9-]+)$/)
  if (avatarMatch && (request.method === 'GET' || request.method === 'HEAD')) {
    return await handleAvatarGet(request, env, avatarMatch[1], url)
  }
  if (route === 'GET /api/sync/pull') return await handlePull(request, env, url)
  if (route === 'POST /api/sync/push') return await handlePush(request, env)
  if (route === 'GET /api/sync/stats') return await handleStats(request, env)
  if (route === 'POST /api/trips/join') return await handleJoinTrip(request, env)
  if (route === 'GET /api/trips/shares') return await handleListShares(request, env)
  const shareMatch = url.pathname.match(/^\/api\/share\/([^/]+)$/)
  if (shareMatch && request.method === 'GET') {
    return await handleSharedTrip(request, env, decodeURIComponent(shareMatch[1]))
  }
  const leaveMatch = url.pathname.match(/^\/api\/trips\/shares\/([^/]+)$/)
  if (leaveMatch && request.method === 'DELETE') {
    return await handleLeaveShare(request, env, decodeURIComponent(leaveMatch[1]))
  }
  if (route === 'POST /api/ai/complete') return await handleAI(request, env)
  if (route === 'POST /api/ai/receipt') return await handleReceipt(request, env)
  if (route === 'GET /api/ai/config') return await handleAIConfig(request, env)
  if (route === 'GET /api/ai/models') return await handleAIModels(request, env)
  if (route === 'POST /api/ai/jobs') return await handleAIJobCreate(request, env, ctx)
  if (route === 'GET /api/ai/jobs') return await handleAIJobsList(request, env, url)
  const aiJobMatch = url.pathname.match(/^\/api\/ai\/jobs\/([A-Za-z0-9]+)$/)
  if (aiJobMatch && request.method === 'GET') {
    return await handleAIJobGet(request, env, aiJobMatch[1])
  }
  if (aiJobMatch && request.method === 'DELETE') {
    return await handleAIJobDelete(request, env, aiJobMatch[1])
  }
  if (route === 'GET /api/weather') return await handleWeather(request, env, url)
  if (route === 'GET /api/geocode') return await handleGeocode(request, env, url)
  if (route === 'GET /api/geo/reverse') return await handleReverseGeo(request, env, url)
  if (route === 'GET /api/poi') return await handlePOI(request, env, url)

  return json({ error: 'Not Found', path: url.pathname }, 404, env, request)
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders(env, request) })
      }
      try {
        return await handleApi(request, env, url, ctx)
      } catch (error) {
        const status = error instanceof HttpError ? error.status : 500
        if (status >= 500) console.error(error)
        return json(
          { error: error.message || '服务器错误', ...(error.code ? { code: error.code } : {}) },
          status,
          env,
          request,
        )
      }
    }
    if (env.ASSETS) return env.ASSETS.fetch(request)
    return new Response('前端资源未绑定：请配置 wrangler.toml 的 [assets] 后重新部署', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  },
}
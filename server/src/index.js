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
  'ai.enabled',
  'ai.endpoints',
  'ai.provider',
  'ai.openaiKey',
  'ai.openaiBase',
  'ai.openaiModel',
  'ai.workersModel',
  'ai.temperature',
]

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
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
  const [users, active7, entities, settings] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS n FROM users').first(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM user_meta WHERE last_seen_at > ? AND status = 'active'`)
      .bind(Date.now() - 7 * 864e5)
      .first(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM entities WHERE deleted = 0').first(),
    getSettings(env, ['site.name', 'ai.enabled', 'ai.provider', 'ai.openaiModel', 'ai.workersModel']),
  ])
  return json(
    {
      site: settings['site.name'] || env.SITE_NAME || '旅记 Travelog',
      users: users?.n ?? 0,
      active7Days: active7?.n ?? 0,
      entities: entities?.n ?? 0,
      ai: {
        enabled: settings['ai.enabled'] !== '0',
        provider: settings['ai.provider'] || (env.OPENAI_API_KEY ? 'openai' : 'workers'),
        model: settings['ai.openaiModel'] || settings['ai.workersModel'] || 'gpt-4o-mini',
        workersBound: Boolean(env.AI),
      },
      time: Date.now(),
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
    `SELECT u.id, u.nickname, u.sync_code, u.created_at,
            COALESCE(m.status, 'active') AS status,
            m.last_seen_at,
            (SELECT COUNT(*) FROM entities e WHERE e.user_id = u.id AND e.deleted = 0) AS entity_count
     FROM users u
     LEFT JOIN user_meta m ON m.user_id = u.id
     WHERE (? = '' OR u.nickname LIKE ? OR u.sync_code LIKE ?)
     ORDER BY u.created_at DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(query, like, like, limit, offset)
    .all()
  const total = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM users WHERE (? = '' OR nickname LIKE ? OR sync_code LIKE ?)`,
  )
    .bind(query, like, like)
    .first()
  return json(
    {
      total: total?.n ?? 0,
      users: (results || []).map((row) => ({
        id: row.id,
        nickname: row.nickname,
        syncCode: row.sync_code,
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at || 0,
        status: row.status,
        entityCount: row.entity_count,
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
  const exists = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first()
  if (!exists) throw new HttpError(404, '用户不存在')
  if (body.nickname !== undefined) {
    await env.DB.prepare('UPDATE users SET nickname = ? WHERE id = ?')
      .bind(String(body.nickname).slice(0, 24), userId)
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
  await env.DB.batch([
    env.DB.prepare('DELETE FROM entities WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM user_meta WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId),
  ])
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
      ai: {
        enabled: map['ai.enabled'] !== '0',
        temperature: Number(map['ai.temperature'] || 0.6),
        workersBound: Boolean(env.AI),
        endpoints: config.all.map((item) => ({
          id: item.id,
          name: item.name || item.type,
          type: item.type === 'workers' ? 'workers' : 'openai',
          base: item.base || '',
          model: item.model || '',
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
  if (site.name !== undefined) await setSetting(env, 'site.name', String(site.name).slice(0, 60))
  if (ai.enabled !== undefined) await setSetting(env, 'ai.enabled', ai.enabled ? '1' : '0')

  // 多接口：按 id 合并，密钥留空或带掩码时保留原值
  if (Array.isArray(ai.endpoints)) {
    const previous = await readRawEndpoints(env)
    const byId = new Map(previous.map((item) => [item.id, item]))
    const next = ai.endpoints.slice(0, 8).map((item, index) => {
      const prev = byId.get(item.id) || {}
      const typed = typeof item.key === 'string' ? item.key.trim() : ''
      const keepKey = !typed || typed.includes('…')
      return {
        id: String(item.id || `ep${index + 1}`),
        name: String(item.name || `接口 ${index + 1}`).slice(0, 30),
        type: item.type === 'workers' ? 'workers' : 'openai',
        base: String(item.base || 'https://api.openai.com/v1').slice(0, 200),
        model: String(item.model || '').slice(0, 80),
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
          '@cf/meta/llama-3.1-8b-instruct',
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

async function requireUser(request, env) {
  const header = request.headers.get('Authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) throw new HttpError(401, '缺少访问令牌')
  const row = await env.DB.prepare('SELECT id, sync_code, nickname FROM users WHERE token = ?')
    .bind(token)
    .first()
  if (!row) throw new HttpError(401, '访问令牌无效')
  const meta = await env.DB.prepare('SELECT status FROM user_meta WHERE user_id = ?').bind(row.id).first()
  if (meta?.status === 'disabled') throw new HttpError(403, '该账号已被停用')
  await env.DB.prepare(
    `INSERT INTO user_meta (user_id, status, last_seen_at) VALUES (?, 'active', ?)
     ON CONFLICT (user_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
  )
    .bind(row.id, Date.now())
    .run()
  return row
}

async function handleRegister(request, env) {
  const body = await readJSON(request).catch(() => ({}))
  const nickname = String(body.nickname || '旅人').slice(0, 24)
  const id = crypto.randomUUID()
  const syncCode = randomCode()
  const token = randomToken()
  await env.DB.prepare(
    'INSERT INTO users (id, sync_code, token, nickname, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, syncCode, token, nickname, Date.now())
    .run()
  await env.DB.prepare(
    `INSERT INTO user_meta (user_id, status, last_seen_at) VALUES (?, 'active', ?)
     ON CONFLICT (user_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
  )
    .bind(id, Date.now())
    .run()
  return json({ userId: id, syncCode, token, nickname }, 201, env, request)
}

async function handleLogin(request, env) {
  const body = await readJSON(request)
  const code = String(body.syncCode || '').trim().toUpperCase()
  if (!code) throw new HttpError(400, '请输入同步码')
  const row = await env.DB.prepare('SELECT id, nickname FROM users WHERE sync_code = ?').bind(code).first()
  if (!row) throw new HttpError(404, '同步码不存在')
  const token = randomToken()
  await env.DB.prepare('UPDATE users SET token = ? WHERE id = ?').bind(token, row.id).run()
  return json({ userId: row.id, token, nickname: row.nickname, syncCode: code }, 200, env, request)
}

async function handlePull(request, env, url) {
  const user = await requireUser(request, env)
  const cursor = Number(url.searchParams.get('cursor') || 0)
  const limit = Math.min(Number(url.searchParams.get('limit') || 500), 1000)
  const { results } = await env.DB.prepare(
    `SELECT kind, id, data, updated_at, deleted FROM entities
     WHERE user_id = ? AND updated_at > ?
     ORDER BY updated_at ASC LIMIT ?`,
  )
    .bind(user.id, cursor, limit)
    .all()
  const entities = (results || []).map((row) => ({
    kind: row.kind,
    id: row.id,
    data: row.deleted ? null : JSON.parse(row.data),
    updatedAt: row.updated_at,
    deleted: Boolean(row.deleted),
  }))
  const nextCursor = entities.length > 0 ? entities[entities.length - 1].updatedAt : cursor
  return json({ cursor: nextCursor, entities, hasMore: entities.length === limit }, 200, env, request)
}

async function handlePush(request, env) {
  const user = await requireUser(request, env)
  const body = await readJSON(request)
  const incoming = Array.isArray(body.entities) ? body.entities : []
  if (incoming.length === 0) return json({ applied: 0, skipped: 0, cursor: 0 }, 200, env, request)
  if (incoming.length > 500) throw new HttpError(413, '单次最多推送 500 条')
  let applied = 0
  let skipped = 0
  const statements = []
  const now = Date.now()
  for (const item of incoming) {
    const kind = String(item.kind || '')
    const id = String(item.id || '')
    if (!kind || !id) {
      skipped++
      continue
    }
    const updatedAt = Number(item.updatedAt) || now
    const deleted = item.deleted ? 1 : 0
    const data = item.deleted ? '{}' : JSON.stringify(item.data ?? {})
    statements.push(
      env.DB.prepare(
        `INSERT INTO entities (user_id, kind, id, data, updated_at, deleted)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, kind, id) DO UPDATE SET
           data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted
         WHERE excluded.updated_at >= entities.updated_at`,
      ).bind(user.id, kind, id, data, updatedAt, deleted),
    )
    applied++
  }
  if (statements.length > 0) await env.DB.batch(statements)
  return json({ applied, skipped, cursor: now }, 200, env, request)
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

async function loadEndpoints(env) {
  const map = await getSettings(env, [
    'ai.enabled',
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
        model: map['ai.workersModel'] || env.AI_MODEL || '@cf/meta/llama-3.1-8b-instruct',
        weight: 1,
        enabled: true,
      })
    }
  }

  const usable = list.filter((item) => {
    if (item.enabled === false) return false
    if (item.type === 'workers') return Boolean(env.AI)
    return Boolean(item.key)
  })

  return {
    enabled: map['ai.enabled'] !== '0',
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

/** 多个接口按权重随机，失败自动切换到下一个 */
async function runAI(env, messages, temperature) {
  const config = await loadEndpoints(env)
  if (!config.enabled) throw new HttpError(503, 'AI 已在管理面板中关闭')
  if (config.endpoints.length === 0) {
    throw new HttpError(503, 'AI 未配置：在管理面板添加接口，或绑定 Workers AI')
  }

  const tried = new Set()
  let lastError = null
  for (let attempt = 0; attempt < config.endpoints.length; attempt += 1) {
    const candidates = config.endpoints.filter((item) => !tried.has(item.id))
    if (candidates.length === 0) break
    const endpoint = pickEndpoint(candidates)
    tried.add(endpoint.id)
    try {
      return await callEndpoint(env, endpoint, messages, temperature ?? config.temperature)
    } catch (error) {
      lastError = error
      console.error(`ai endpoint failed: ${endpoint.name} ${error.message}`)
    }
  }
  throw new HttpError(502, `所有 AI 接口都失败了：${lastError?.message || '未知错误'}`)
}

async function handleAI(request, env) {
  const user = await requireUser(request, env)
  const body = await readJSON(request)
  const system = String(body.system || '').slice(0, 2000)
  const prompt = String(body.prompt || '').slice(0, 4000)
  if (!prompt.trim()) throw new HttpError(400, 'prompt 不能为空')
  const messages = []
  if (system) messages.push({ role: 'system', content: system })
  messages.push({ role: 'user', content: prompt })
  const temperature = Math.min(Math.max(Number(body.temperature) || 0.6, 0), 1)
  const result = await runAI(env, messages, temperature)
  console.log(`ai user=${user.id} model=${result.model} chars=${result.text.length}`)
  return json(result, 200, env, request)
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

/* ---------------- 入口 ---------------- */

async function handleApi(request, env, url) {
  const route = `${request.method} ${url.pathname}`

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

  const userMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/)
  if (userMatch && request.method === 'PATCH') {
    return await handleAdminUserPatch(request, env, decodeURIComponent(userMatch[1]))
  }
  if (userMatch && request.method === 'DELETE') {
    return await handleAdminUserDelete(request, env, decodeURIComponent(userMatch[1]))
  }
  const resetMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/reset-code$/)
  if (resetMatch && request.method === 'POST') {
    return await handleAdminUserResetCode(request, env, decodeURIComponent(resetMatch[1]))
  }

  if (route === 'POST /api/auth/register') return await handleRegister(request, env)
  if (route === 'POST /api/auth/login') return await handleLogin(request, env)
  if (route === 'GET /api/sync/pull') return await handlePull(request, env, url)
  if (route === 'POST /api/sync/push') return await handlePush(request, env)
  if (route === 'GET /api/sync/stats') return await handleStats(request, env)
  if (route === 'POST /api/ai/complete') return await handleAI(request, env)
  if (route === 'GET /api/weather') return await handleWeather(request, env, url)
  if (route === 'GET /api/geocode') return await handleGeocode(request, env, url)

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
        return await handleApi(request, env, url)
      } catch (error) {
        const status = error instanceof HttpError ? error.status : 500
        if (status >= 500) console.error(error)
        return json({ error: error.message || '服务器错误' }, status, env, request)
      }
    }
    if (env.ASSETS) return env.ASSETS.fetch(request)
    return new Response('前端资源未绑定：请配置 wrangler.toml 的 [assets] 后重新部署', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  },
}
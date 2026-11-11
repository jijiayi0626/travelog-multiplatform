/**
 * 旅记 API · Cloudflare Worker
 * 零依赖：路由 + 鉴权 + 增量同步 + AI 代理 + 天气/地理编码代理
 *
 * 部署：wrangler d1 create travelog → 填 database_id → wrangler deploy
 */

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }

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
    'access-control-allow-methods': 'GET, POST, OPTIONS',
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

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return [...bytes].map((n) => n.toString(16).padStart(2, '0')).join('')
}

async function requireUser(request, env) {
  const header = request.headers.get('Authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) throw new HttpError(401, '缺少访问令牌')
  const row = await env.DB.prepare('SELECT id, sync_code, nickname FROM users WHERE token = ?')
    .bind(token)
    .first()
  if (!row) throw new HttpError(401, '访问令牌无效')
  return row
}

/* ---------------- 路由 ---------------- */

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
  return json({ userId: id, syncCode, token, nickname }, 201, env, request)
}

async function handleLogin(request, env) {
  const body = await readJSON(request)
  const code = String(body.syncCode || '').trim().toUpperCase()
  if (!code) throw new HttpError(400, '请输入同步码')
  const row = await env.DB.prepare('SELECT id, nickname FROM users WHERE sync_code = ?')
    .bind(code)
    .first()
  if (!row) throw new HttpError(404, '同步码不存在')
  // 轮换令牌，旧设备需要重新登录
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

    // LWW：远端更新时间更晚则跳过
    statements.push(
      env.DB.prepare(
        `INSERT INTO entities (user_id, kind, id, data, updated_at, deleted)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, kind, id) DO UPDATE SET
           data = excluded.data,
           updated_at = excluded.updated_at,
           deleted = excluded.deleted
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

async function runAI(env, messages, temperature = 0.6) {
  if (env.OPENAI_API_KEY) {
    const base = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
    const model = env.OPENAI_MODEL || 'gpt-4o-mini'
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ model, messages, temperature, max_tokens: 800 }),
    })
    if (!response.ok) {
      const text = await response.text()
      throw new HttpError(502, `上游 AI 失败：${text.slice(0, 200)}`)
    }
    const data = await response.json()
    return { text: data.choices?.[0]?.message?.content?.trim() || '', model }
  }

  if (env.AI) {
    const model = env.AI_MODEL || '@cf/meta/llama-3.1-8b-instruct'
    const output = await env.AI.run(model, { messages, temperature })
    return { text: (output.response || '').trim(), model }
  }

  throw new HttpError(503, 'AI 未配置：绑定 Workers AI，或 wrangler secret put OPENAI_API_KEY')
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

/* ---------------- 天气 / 地理编码代理 ---------------- */

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
  const data = await response.json()
  return json(data, 200, env, request)
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env, request) })
    }

    try {
      const route = `${request.method} ${url.pathname}`

      if (url.pathname === '/api/health') {
        return json({ ok: true, ai: Boolean(env.AI || env.OPENAI_API_KEY), time: Date.now() }, 200, env, request)
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
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      if (status >= 500) console.error(error)
      return json({ error: error.message || '服务器错误' }, status, env, request)
    }
  },
}
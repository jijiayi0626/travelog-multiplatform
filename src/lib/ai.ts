import { aiComplete, isSignedIn } from './cloud'
import type { ExpenseCategory, PlanKind } from './types'

export class AIUnavailableError extends Error {
  constructor(message = 'AI 不可用：请先在「云同步」登录，并让服务端配置 Workers AI 或 OPENAI_API_KEY') {
    super(message)
  }
}

function ensureReady(): void {
  if (!isSignedIn()) throw new AIUnavailableError()
}

/** 润色一段游记文字，保留事实，只提升画面感 */
export async function polishMoment(
  content: string,
  context: { trip?: string; location?: string; date?: string },
): Promise<string> {
  ensureReady()
  if (content.trim().length < 4) throw new Error('文字太短，先写几句再润色')

  const system =
    '你是一位克制的中文旅行写作者。把用户的一段旅行草稿改写成有画面感的短文：' +
    '保留全部真实细节与地名，不编造事实，不堆砌形容词，不用感叹号，不使用"绝美、治愈、封神"这类词。' +
    '长度控制在原文的 0.8–1.3 倍。只输出改写后的正文，不要任何解释或引号。'

  const prompt = [
    context.trip ? `旅程：${context.trip}` : '',
    context.location ? `地点：${context.location}` : '',
    context.date ? `时间：${context.date}` : '',
    '草稿：',
    content,
  ]
    .filter(Boolean)
    .join('\n')

  const result = await aiComplete(prompt, system, 0.7)
  const text = result.text.replace(/^["“']|["”']$/g, '').trim()
  if (!text) throw new Error('AI 没有返回内容，稍后再试')
  return text
}

export interface GeneratedPlanItem {
  dayIndex: number
  time: string
  title: string
  place: string
  kind: PlanKind
  note: string
}

const VALID_KINDS: PlanKind[] = ['transport', 'stay', 'food', 'activity', 'shopping']

const PLAN_SYSTEM =
  '你是旅行行程规划师。只输出一个 JSON 对象，不要 Markdown、不要解释。' +
  '结构：{"items":[{"dayIndex":1,"time":"09:00","title":"...","place":"...","kind":"transport|stay|food|activity|shopping","note":""}]}。' +
  '要求：dayIndex 从 1 开始且不超过总天数；每天 3-5 条；时间按 08:00-21:00 递进；' +
  '同一天不要重复同一类型的活动；title 不超过 20 字，place 可留空，note 不超过 30 字。'

export async function generatePlan(input: {
  destination: string
  days: number
  style?: string
  budget?: string
}): Promise<GeneratedPlanItem[]> {
  ensureReady()
  const days = Math.min(Math.max(Math.round(input.days) || 3, 1), 14)
  const prompt = [
    `目的地：${input.destination || '未指定'}`,
    `天数：${days} 天`,
    input.style ? `偏好：${input.style}` : '',
    input.budget ? `预算：${input.budget}` : '',
    '请给出逐日行程。',
  ]
    .filter(Boolean)
    .join('\n')

  const result = await aiComplete(prompt, PLAN_SYSTEM, 0.5)
  const raw = result.text
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('AI 返回格式不正确，稍后再试')

  let parsed: { items?: unknown }
  try {
    parsed = JSON.parse(raw.slice(start, end + 1)) as { items?: unknown }
  } catch {
    throw new Error('AI 返回的不是合法 JSON，稍后再试')
  }

  const items = Array.isArray(parsed.items) ? parsed.items : []
  const cleaned: GeneratedPlanItem[] = []
  for (const item of items as Array<Record<string, unknown>>) {
    const title = String(item.title ?? '').trim()
    if (!title) continue
    const dayIndex = Number(item.dayIndex)
    const kind = String(item.kind ?? 'activity') as PlanKind
    cleaned.push({
      dayIndex: Number.isFinite(dayIndex) ? Math.min(Math.max(dayIndex, 1), days) : 1,
      time: /^\d{1,2}:\d{2}$/.test(String(item.time ?? '')) ? String(item.time) : '',
      title: title.slice(0, 40),
      place: String(item.place ?? '').slice(0, 40),
      kind: VALID_KINDS.includes(kind) ? kind : 'activity',
      note: String(item.note ?? '').slice(0, 60),
    })
  }
  if (cleaned.length === 0) throw new Error('AI 没有给出可用的行程')
  return cleaned.slice(0, days * 5)
}

const CATEGORY_SYSTEM =
  '你是记账分类助手。根据备注判断消费分类，只输出其中一个英文单词：' +
  'food, transport, stay, ticket, shopping, other。不要输出其他内容。'

export async function guessCategory(note: string, amount?: number): Promise<ExpenseCategory | null> {
  if (!isSignedIn() || !note.trim()) return null
  try {
    const result = await aiComplete(
      `备注：${note}${amount ? `\n金额：${amount}` : ''}`,
      CATEGORY_SYSTEM,
      0.1,
    )
    const value = result.text.trim().toLowerCase()
    const allowed: ExpenseCategory[] = ['food', 'transport', 'stay', 'ticket', 'shopping', 'other']
    const hit = allowed.find((item) => value.includes(item))
    return hit ?? null
  } catch {
    return null
  }
}

/** 给旅程写一段开场白（用于封面备注建议） */
export async function suggestTripNote(destination: string, days: number): Promise<string> {
  ensureReady()
  const system = '你是中文旅行编辑。写一句 20–36 字的旅程开场白，克制、有画面、不用感叹号。只输出这一句。'
  const result = await aiComplete(`目的地：${destination}\n天数：${days} 天`, system, 0.8)
  return result.text.replace(/^["“']|["”']$/g, '').trim()
}
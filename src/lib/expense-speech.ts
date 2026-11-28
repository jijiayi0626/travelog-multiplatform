import type { ExpenseCategory } from './types'

export interface ParsedExpenseSpeech {
  amount: number
  note: string
  category: ExpenseCategory
}

const CN_DIGITS: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
}

const CN_UNITS: Record<string, number> = {
  十: 10,
  百: 100,
  千: 1000,
}

/** 把「三百」「三十五」「一百二十」这类简单中文数字转成阿拉伯数字 */
function chineseToNumber(text: string): number | null {
  let section = 0
  let digit = 0
  for (const char of text) {
    if (char in CN_DIGITS) {
      digit = CN_DIGITS[char]
      continue
    }
    const unit = CN_UNITS[char]
    if (!unit) return null
    section += (digit || 1) * unit
    digit = 0
  }
  return section + digit
}

const CANDIDATE_RE = /\d+(?:[.,]\d+)?|[零一二三四五六七八九十百千两]+/g
const CURRENCY_AFTER_RE = /^\s*(?:元|块|圆|钱|人民币|rmb)/i
const COUNTER_AFTER_RE =
  /^\s*(?:张|个|份|人|位|杯|碗|瓶|次|晚|天|件|盒|包|只|条|双|听|罐|串|斤|公斤|克|千米|公里|米|间|桌)/
const CURRENCY_BEFORE_RE = /[¥￥]\s*$/

interface Candidate {
  start: number
  end: number
  value: number
  score: number
}

/** 找出最像价格的一个数字（带「元」、小数、靠后的更优先；量词前的折扣） */
function pickAmount(text: string): Candidate | null {
  let best: Candidate | null = null
  CANDIDATE_RE.lastIndex = 0
  let match: RegExpExecArray | null = CANDIDATE_RE.exec(text)
  while (match !== null) {
    const raw = match[0]
    const isChinese = /^[零一二三四五六七八九十百千两]+$/.test(raw)
    const value = isChinese
      ? chineseToNumber(raw)
      : Number.parseFloat(raw.replace(/,/g, ''))
    if (value === null || !Number.isFinite(value) || value <= 0) {
      match = CANDIDATE_RE.exec(text)
      continue
    }

    const after = text.slice(match.index + raw.length)
    const before = text.slice(Math.max(0, match.index - 2), match.index)
    const unitMatch = after.match(CURRENCY_AFTER_RE)
    const currencyAfter = Boolean(unitMatch)
    const currencyBefore = CURRENCY_BEFORE_RE.test(before)
    const counterAfter = COUNTER_AFTER_RE.test(after)
    const decimal = raw.includes('.')

    let score = 0
    if (currencyAfter) score += 100
    else if (currencyBefore) score += 90
    if (decimal) score += 40
    if (counterAfter && !currencyAfter) score -= 60
    if (value >= 1) score += 10
    // 同等条件下更靠后的数字通常是价格（如「门票 2 张 120」）
    score += (match.index / Math.max(1, text.length)) * 5

    const beforeSymbol = before.match(CURRENCY_BEFORE_RE)?.[0] ?? ''
    const candidate: Candidate = {
      start: match.index - beforeSymbol.length,
      end: match.index + raw.length + (unitMatch?.[0].length ?? 0),
      value,
      score,
    }
    if (!best || candidate.score > best.score) best = candidate
    match = CANDIDATE_RE.exec(text)
  }
  return best
}

function cleanNote(text: string, start: number, end: number): string {
  const merged = `${text.slice(0, start)} ${text.slice(end)}`
  return merged
    .replace(/\s+/g, ' ')
    .replace(/^[\s，。,.、;；:：-]+/, '')
    .replace(/[\s，。,.、;；:：-]+$/, '')
    .trim()
}

const CATEGORY_KEYWORDS: Array<[ExpenseCategory, string[]]> = [
  ['food', ['饭', '早餐', '午餐', '晚餐', '咖啡', '奶茶']],
  ['transport', ['打车', '地铁', '公交', '高铁', '机票', '加油']],
  ['stay', ['酒店', '民宿', '住宿']],
  ['ticket', ['门票', '景区', '滑雪']],
  ['shopping', ['买', '购物', '纪念品']],
]

function categorize(text: string): ExpenseCategory {
  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some((keyword) => text.includes(keyword))) return category
  }
  return 'other'
}

/**
 * 把一条语音识别文本解析成账目：
 * 「午饭 35」「打车 12.5 元」「住宿三百」「门票 2 张 120」。
 * 没有识别到金额时 amount 为 0，note 保留原文（去掉数字部分）。
 */
export function parseExpenseSpeech(text: string): ParsedExpenseSpeech {
  const source = text.trim()
  if (!source) return { amount: 0, note: '', category: 'other' }

  const candidate = pickAmount(source)
  if (!candidate) {
    return { amount: 0, note: cleanNote(source, 0, 0), category: categorize(source) }
  }

  return {
    amount: Math.round(candidate.value * 100) / 100,
    note: cleanNote(source, candidate.start, candidate.end),
    category: categorize(source),
  }
}

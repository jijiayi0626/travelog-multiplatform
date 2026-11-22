import type { Currency, ExpenseCategory } from './types'

export { recognizeReceiptText } from './ocr-model'

export interface ParsedReceipt {
  amount: number
  currency: Currency
  category: ExpenseCategory
  note: string
}

const CATEGORY_HINTS: Array<{ category: ExpenseCategory; words: string[] }> = [
  { category: 'food', words: ['餐', '饭', '咖啡', '奶茶', '小吃', '火锅', '烧烤', 'food', 'cafe', 'restaurant', 'burger', 'pizza'] },
  { category: 'transport', words: ['地铁', '公交', '出租', '打车', '车费', '加油', '停车', 'taxi', 'metro', 'bus', 'fuel', 'parking'] },
  { category: 'stay', words: ['酒店', '民宿', '住宿', '房费', 'hotel', 'hostel', 'stay'] },
  { category: 'ticket', words: ['门票', '景区', '博物馆', 'ticket', 'museum', 'entry'] },
  { category: 'shopping', words: ['超市', '商场', '购物', '便利店', 'shop', 'store', 'market'] },
]

function detectCurrency(text: string): Currency {
  if (/(?:USD|US\$|\$)/i.test(text)) return 'USD'
  if (/(?:EUR|€)/i.test(text)) return 'EUR'
  if (/(?:THB|฿)/i.test(text)) return 'THB'
  if (/(?:JPY|日元|円)/i.test(text)) return 'JPY'
  return 'CNY'
}

function detectCategory(text: string): ExpenseCategory {
  const lower = text.toLowerCase()
  for (const hint of CATEGORY_HINTS) {
    if (hint.words.some((word) => lower.includes(word))) return hint.category
  }
  return 'other'
}

/** 从识别出的文本里尽量猜出总金额，猜不到返回 null */
export function parseReceiptText(raw: string): ParsedReceipt | null {
  const text = raw.replace(/，/g, ',').replace(/：/g, ':')
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const totalLines = lines.filter((line) =>
    /(合计|总计|应付|实付|金额|小计|total|amount|sum)/i.test(line),
  )
  const pool = totalLines.length > 0 ? totalLines : lines

  let amount = 0
  for (const line of pool) {
    const matches = line.match(/\d{1,6}(?:[.,]\d{1,2})?/g)
    if (!matches) continue
    for (const match of matches) {
      const value = Number(match.replace(',', '.'))
      // 排除年份、电话等明显不是金额的数字
      if (!Number.isFinite(value) || value <= 0 || value >= 1000000) continue
      if (value >= 1900 && value <= 2100 && !/[.¥￥$€฿]/.test(line)) continue
      if (value > amount) amount = value
    }
  }
  if (amount <= 0) return null

  const note =
    lines.find((line) => line.length <= 24 && !/\d{3,}/.test(line) && line !== String(amount))?.slice(0, 24) ??
    ''

  return {
    amount: Math.round(amount * 100) / 100,
    currency: detectCurrency(text),
    category: detectCategory(text),
    note,
  }
}

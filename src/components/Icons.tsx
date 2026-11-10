import type { Icon } from '@phosphor-icons/react'
import {
  Bed,
  ForkKnife,
  Receipt,
  ShoppingBag,
  Ticket,
  Train,
} from '@phosphor-icons/react'
import type { ExpenseCategory } from '../lib/types'

export const CATEGORY_ICON: Record<ExpenseCategory, Icon> = {
  food: ForkKnife,
  transport: Train,
  stay: Bed,
  ticket: Ticket,
  shopping: ShoppingBag,
  other: Receipt,
}

export function CategoryGlyph({ category, size = 18 }: { category: ExpenseCategory; size?: number }) {
  const Glyph = CATEGORY_ICON[category]
  return <Glyph size={size} weight="regular" aria-hidden="true" />
}
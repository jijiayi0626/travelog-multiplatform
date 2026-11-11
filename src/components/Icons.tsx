import type { Icon } from '@phosphor-icons/react'
import {
  Bed,
  Camera,
  ForkKnife,
  Receipt,
  ShoppingBag,
  Ticket,
  Train,
} from '@phosphor-icons/react'
import type { ExpenseCategory, PlanKind } from '../lib/types'

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

export const PLAN_ICON: Record<PlanKind, Icon> = {
  transport: Train,
  activity: Camera,
  food: ForkKnife,
  stay: Bed,
  shopping: ShoppingBag,
}

export function PlanGlyph({ kind, size = 16 }: { kind: PlanKind; size?: number }) {
  const Glyph = PLAN_ICON[kind]
  return <Glyph size={size} weight="regular" aria-hidden="true" />
}
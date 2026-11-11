export type SyncState = 0 | 1
export type TripStatus = 'planned' | 'ongoing' | 'finished'
export type MemberRole = 'owner' | 'member'
export type ExpenseCategory = 'food' | 'transport' | 'stay' | 'ticket' | 'shopping' | 'other'
export type Currency = 'CNY' | 'JPY' | 'USD' | 'EUR' | 'THB'
export type TripTemplate = 'blank' | 'city' | 'beach' | 'road' | 'ski'
export type PlanKind = 'transport' | 'stay' | 'food' | 'activity' | 'shopping'

export interface Trip {
  id: string
  title: string
  destination: string
  startDate: number
  endDate: number
  note: string
  cover: number
  ownerId: string
  inviteCode: string
  createdAt: number
  updatedAt: number
  syncState: SyncState
  budget?: number
  currency?: Currency
  template?: TripTemplate
}

export interface TripView extends Trip {
  momentCount: number
  expenseTotal: number
  expenseTotalCny: number
  planCount: number
  planDoneCount: number
}

export interface Photo {
  id: string
  src: string
  caption?: string
}

export interface Moment {
  id: string
  tripId: string
  dayIndex: number
  content: string
  locationName: string
  latitude: number
  longitude: number
  createdAt: number
  updatedAt: number
  syncState: SyncState
  photos: Photo[]
  tags?: string[]
}

export interface Expense {
  id: string
  tripId: string
  amount: number
  category: ExpenseCategory
  note: string
  spentAt: number
  createdAt: number
  syncState: SyncState
  currency?: Currency
  amountCny?: number
}

export interface ChecklistItem {
  id: string
  tripId: string
  title: string
  done: boolean
  createdAt: number
  group?: string
}

/** 行程计划：出发前或旅途中排好的一天日程 */
export interface Plan {
  id: string
  tripId: string
  /** 第几天，从 1 开始 */
  dayIndex: number
  /** 'HH:mm'，空字符串表示未定时间 */
  time: string
  title: string
  place: string
  kind: PlanKind
  note: string
  done: boolean
  /** 同一天内的排序，越小越靠前 */
  order: number
  createdAt: number
}

export interface Footprint {
  id: string
  tripId: string
  placeName: string
  city: string
  latitude: number
  longitude: number
  note: string
  visitedAt: number
  createdAt: number
}

export interface Member {
  id: string
  tripId: string
  userId: string
  name: string
  role: MemberRole
  joinedAt: number
  emojiSeed: number
}

export interface Profile {
  id: string
  nickname: string
  avatar: string
  createdAt: number
}

export interface AppStats {
  tripCount: number
  momentCount: number
  footprintCount: number
  expenseCount: number
  cityCount: number
  pendingSync: number
  totalCny: number
  totalDays: number
  photoCount: number
  planCount: number
  planDoneCount: number
}

export interface CategoryStat {
  category: ExpenseCategory
  amount: number
  count: number
  ratio: number
}

export interface MonthStat {
  key: string
  label: string
  amount: number
}

export type TabKey = 'plan' | 'timeline' | 'ledger' | 'checklist' | 'members'

export type View =
  | { name: 'trips' }
  | { name: 'trip'; id: string; tab: TabKey }
  | { name: 'footprints' }
  | { name: 'album' }
  | { name: 'recap' }
  | { name: 'expenses' }
  | { name: 'profile' }
  | { name: 'tripEditor'; id?: string; template?: TripTemplate }
  | { name: 'momentEditor'; tripId: string; momentId?: string }
  | { name: 'expenseEditor'; tripId: string; expenseId?: string }
  | { name: 'footprintEditor' }
  | { name: 'planEditor'; tripId: string; planId?: string; dayIndex?: number }
  | { name: 'sync' }
  | { name: 'admin' }

export interface SearchResult {
  kind: 'trip' | 'moment' | 'expense' | 'footprint' | 'plan'
  id: string
  tripId?: string
  title: string
  subtitle: string
  score: number
}
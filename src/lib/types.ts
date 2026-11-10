export type SyncState = 0 | 1
export type TripStatus = 'planned' | 'ongoing' | 'finished'
export type MemberRole = 'owner' | 'member'
export type ExpenseCategory = 'food' | 'transport' | 'stay' | 'ticket' | 'shopping' | 'other'

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
}

export interface TripView extends Trip {
  momentCount: number
  expenseTotal: number
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
}

export interface ChecklistItem {
  id: string
  tripId: string
  title: string
  done: boolean
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
}

export interface CategoryStat {
  category: ExpenseCategory
  amount: number
  count: number
  ratio: number
}

export type TabKey = 'timeline' | 'ledger' | 'checklist' | 'members'

export type View =
  | { name: 'trips' }
  | { name: 'trip'; id: string; tab: TabKey }
  | { name: 'footprints' }
  | { name: 'expenses' }
  | { name: 'profile' }
  | { name: 'tripEditor'; id?: string }
  | { name: 'momentEditor'; tripId: string; momentId?: string }
  | { name: 'expenseEditor'; tripId: string; expenseId?: string }
  | { name: 'footprintEditor' }
  | { name: 'sync' }
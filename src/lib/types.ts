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
  /** 自定义封面：本地压缩后的 data URL 或 R2 地址 */
  coverImage?: string
  /** 封面已上传到 R2 时的照片 id，用于换封面时清理旧图 */
  coverCloudId?: string
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
  /** 已上传到 R2 的云照片 id；src 为云端地址时存在 */
  cloudId?: string
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
  /** 付款的旅伴 id，用于同行分摊结算 */
  payerId?: string
  /** 付款人昵称快照，旅伴被移除后仍可显示 */
  payerName?: string
}

export interface ChecklistItem {
  id: string
  tripId: string
  title: string
  done: boolean
  createdAt: number
  group?: string
  /** 勾选完成的人，便于多人协作时看到是谁做的 */
  doneBy?: string
  doneAt?: number
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
  /** 是否在开始前发送提醒（旧数据未设置时按全局偏好处理） */
  remind?: boolean
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
  /** 联系方式：手机号 / 微信号 / 邮箱，可留空 */
  contact?: string
  /** 备注：过敏、饮食禁忌、房型偏好等 */
  note?: string
}

export interface Profile {
  id: string
  nickname: string
  avatar: string
  createdAt: number
  /** 参与云端同步的更新时间；旧数据可能没有 */
  updatedAt?: number
  syncState?: number
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

/** 行程内的旅伴评论 */
export interface Comment {
  id: string
  tripId: string
  userId: string
  name: string
  text: string
  createdAt: number
  updatedAt: number
  syncState: SyncState
}

export interface PollOption {
  id: string
  text: string
  /** 投票用户的 id 列表；同一用户只会出现在一个选项里 */
  votes: string[]
}

/** 行程内的旅伴投票 */
export interface Poll {
  id: string
  tripId: string
  question: string
  options: PollOption[]
  createdBy: string
  closed: boolean
  createdAt: number
  updatedAt: number
  syncState: SyncState
}

export type TabKey = 'plan' | 'timeline' | 'ledger' | 'checklist' | 'members' | 'collab'

export type View =
  | { name: 'trips' }
  | { name: 'trip'; id: string; tab: TabKey }
  | { name: 'footprints' }
  | { name: 'album' }
  | { name: 'cloud' }
  | { name: 'recap' }
  | { name: 'expenses' }
  | { name: 'profile' }
  | { name: 'tripEditor'; id?: string; template?: TripTemplate }
  | { name: 'momentEditor'; tripId: string; momentId?: string }
  | { name: 'expenseEditor'; tripId: string; expenseId?: string }
  | { name: 'footprintEditor' }
  | { name: 'planEditor'; tripId: string; planId?: string; dayIndex?: number }
  | { name: 'sync'; mode?: 'login' | 'register' }
  | { name: 'about' }
  | { name: 'download' }
  | { name: 'ocrModel' }
  | { name: 'changelog' }
  | { name: 'admin' }
  | { name: 'passport' }
  | { name: 'monthly' }
  | { name: 'persona' }
  | { name: 'emergency' }
  | { name: 'share'; code: string }

export interface SearchResult {
  kind: 'trip' | 'moment' | 'expense' | 'footprint' | 'plan'
  id: string
  tripId?: string
  title: string
  subtitle: string
  score: number
}
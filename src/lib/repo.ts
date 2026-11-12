import type {
  AppStats,
  CategoryStat,
  ChecklistItem,
  Currency,
  Expense,
  Footprint,
  Member,
  Moment,
  MonthStat,
  Plan,
  PlanKind,
  Profile,
  SearchResult,
  Trip,
  TripTemplate,
  TripView,
} from './types'
import { clearStore, deleteOne, getAll, getOne, putOne, type StoreName } from './db'
import {
  CATEGORY_ORDER,
  clockToMinutes,
  dayIndexOfDate,
  lastMonths,
  monthKey,
  monthLabel,
  normalizeClock,
  toCny,
  tripDayCount,
  uid,
} from './utils'
import { seedIfNeeded } from './seed'

/* ---------------- 删除墓碑（同步用） ---------------- */

async function tomb(kind: string, id: string): Promise<void> {
  await putOne('tombstones', { id: `${kind}:${id}`, kind, value: id, deletedAt: Date.now() })
}

/** 本地删除统一入口：先写墓碑再真删，保证下一次同步能把删除推给服务端 */
async function trackedDelete(store: StoreName, id: string): Promise<void> {
  await tomb(store, id)
  await deleteOne(store, id)
}

/* ---------------- 归一化（兼容旧版本数据） ---------------- */

function normalizeTrip(raw: Trip): Trip {
  return {
    ...raw,
    note: raw.note ?? '',
    cover: raw.cover ?? 0,
    budget: raw.budget ?? 0,
    currency: raw.currency ?? 'CNY',
    template: raw.template ?? 'blank',
  }
}

function normalizeExpense(raw: Expense): Expense {
  const currency: Currency = raw.currency ?? 'CNY'
  return {
    ...raw,
    note: raw.note ?? '',
    currency,
    amountCny: raw.amountCny ?? toCny(raw.amount, currency),
  }
}

function normalizeMoment(raw: Moment): Moment {
  return {
    ...raw,
    photos: raw.photos ?? [],
    tags: raw.tags ?? [],
  }
}

function normalizePlan(raw: Plan): Plan {
  return {
    ...raw,
    time: raw.time ?? '',
    place: raw.place ?? '',
    note: raw.note ?? '',
    kind: raw.kind ?? 'activity',
    done: Boolean(raw.done),
    dayIndex: raw.dayIndex || 1,
    order: Number.isFinite(raw.order) ? raw.order : 0,
  }
}

export async function ensureReady(): Promise<void> {
  await seedIfNeeded()
}

/* ---------------- 旅行 ---------------- */

export async function listTrips(): Promise<TripView[]> {
  const [rawTrips, rawMoments, rawExpenses, rawPlans] = await Promise.all([
    getAll<Trip>('trips'),
    getAll<Moment>('moments'),
    getAll<Expense>('expenses'),
    getAll<Plan>('plans'),
  ])
  const trips = rawTrips.map(normalizeTrip)
  const moments = rawMoments.map(normalizeMoment)
  const expenses = rawExpenses.map(normalizeExpense)
  const plans = rawPlans.map(normalizePlan)
  const views = trips.map((trip) => {
    const tripMoments = moments.filter((item) => item.tripId === trip.id)
    const tripExpenses = expenses.filter((item) => item.tripId === trip.id)
    const tripPlans = plans.filter((item) => item.tripId === trip.id)
    return {
      ...trip,
      momentCount: tripMoments.length,
      expenseTotal: tripExpenses.reduce((sum, item) => sum + item.amount, 0),
      expenseTotalCny: tripExpenses.reduce((sum, item) => sum + (item.amountCny ?? 0), 0),
      planCount: tripPlans.length,
      planDoneCount: tripPlans.filter((item) => item.done).length,
    }
  })
  return views.sort((a, b) => (b.startDate || b.createdAt) - (a.startDate || a.createdAt))
}

export async function getTrip(id: string): Promise<Trip | undefined> {
  const raw = await getOne<Trip>('trips', id)
  return raw ? normalizeTrip(raw) : undefined
}

export async function saveTrip(trip: Trip): Promise<Trip> {
  const now = Date.now()
  const next: Trip = { ...trip }
  if (!next.id) {
    next.id = uid()
    next.createdAt = now
    next.ownerId = next.ownerId || 'local-user'
    next.inviteCode = next.inviteCode || next.id.slice(0, 6).toUpperCase()
  }
  next.updatedAt = now
  next.syncState = 1
  await putOne('trips', next)
  return next
}

export async function deleteTrip(id: string): Promise<void> {
  const [moments, expenses, checklist, footprints, members, plans] = await Promise.all([
    getAll<Moment>('moments'),
    getAll<Expense>('expenses'),
    getAll<ChecklistItem>('checklist'),
    getAll<Footprint>('footprints'),
    getAll<Member>('members'),
    getAll<Plan>('plans'),
  ])
  await Promise.all([
    trackedDelete('trips', id),
    ...moments.filter((item) => item.tripId === id).map((item) => trackedDelete('moments', item.id)),
    ...expenses.filter((item) => item.tripId === id).map((item) => trackedDelete('expenses', item.id)),
    ...checklist.filter((item) => item.tripId === id).map((item) => trackedDelete('checklist', item.id)),
    ...footprints.filter((item) => item.tripId === id).map((item) => trackedDelete('footprints', item.id)),
    ...members.filter((item) => item.tripId === id).map((item) => trackedDelete('members', item.id)),
    ...plans.filter((item) => item.tripId === id).map((item) => trackedDelete('plans', item.id)),
  ])
}

export async function duplicateTrip(id: string): Promise<Trip | undefined> {
  const source = await getTrip(id)
  if (!source) return undefined
  const now = Date.now()
  const copy: Trip = {
    ...source,
    id: uid(),
    title: `${source.title} 副本`,
    inviteCode: '',
    createdAt: now,
    updatedAt: now,
    syncState: 1,
  }
  await putOne('trips', copy)

  const checklist = await getAll<ChecklistItem>('checklist')
  for (const item of checklist.filter((entry) => entry.tripId === id)) {
    await putOne('checklist', { ...item, id: uid(), tripId: copy.id, done: false, createdAt: now + Math.random() })
  }

  const plans = await listPlans(id)
  for (const plan of plans) {
    await putOne('plans', { ...plan, id: uid(), tripId: copy.id, done: false, createdAt: now + Math.random() })
  }

  return copy
}

/* ---------------- 图文记录 ---------------- */

export async function listMoments(tripId: string): Promise<Moment[]> {
  const all = await getAll<Moment>('moments')
  return all
    .map(normalizeMoment)
    .filter((item) => item.tripId === tripId)
    .sort((a, b) => a.dayIndex - b.dayIndex || a.createdAt - b.createdAt)
}

export async function listAllMoments(): Promise<Moment[]> {
  const all = await getAll<Moment>('moments')
  return all.map(normalizeMoment).sort((a, b) => b.createdAt - a.createdAt)
}

export async function saveMoment(moment: Moment): Promise<Moment> {
  const now = Date.now()
  const next: Moment = { ...moment, photos: [...moment.photos], tags: [...(moment.tags ?? [])] }
  if (!next.id) {
    next.id = uid()
    next.createdAt = now
  }
  next.updatedAt = now
  next.syncState = 1
  await putOne('moments', next)
  return next
}

export async function deleteMoment(id: string): Promise<void> {
  await trackedDelete('moments', id)
}

/* ---------------- 记账 ---------------- */

export async function listExpenses(tripId?: string): Promise<Expense[]> {
  const all = await getAll<Expense>('expenses')
  return all
    .map(normalizeExpense)
    .filter((item) => (tripId ? item.tripId === tripId : true))
    .sort((a, b) => b.spentAt - a.spentAt || b.createdAt - a.createdAt)
}

export async function saveExpense(expense: Expense): Promise<Expense> {
  const next: Expense = { ...expense }
  if (!next.id) {
    next.id = uid()
    next.createdAt = Date.now()
  }
  next.currency = next.currency ?? 'CNY'
  next.amountCny = toCny(next.amount, next.currency)
  next.syncState = 1
  await putOne('expenses', next)
  return next
}

export async function deleteExpense(id: string): Promise<void> {
  await trackedDelete('expenses', id)
}

export function sumExpense(expenses: Expense[]): number {
  return expenses.reduce((sum, item) => sum + item.amount, 0)
}

export function sumExpenseCny(expenses: Expense[]): number {
  return expenses.reduce((sum, item) => sum + (item.amountCny ?? toCny(item.amount, item.currency)), 0)
}

export function categoryStats(expenses: Expense[]): CategoryStat[] {
  const stats: CategoryStat[] = CATEGORY_ORDER.map((category) => ({
    category,
    amount: 0,
    count: 0,
    ratio: 0,
  }))
  for (const expense of expenses) {
    const stat = stats.find((item) => item.category === expense.category)
    if (stat) {
      stat.amount += expense.amountCny ?? toCny(expense.amount, expense.currency)
      stat.count += 1
    }
  }
  const max = stats.reduce((value, item) => Math.max(value, item.amount), 0)
  for (const stat of stats) {
    stat.ratio = max > 0 ? stat.amount / max : 0
  }
  return stats.filter((item) => item.amount > 0)
}

export function monthlyStats(expenses: Expense[], months = 6): MonthStat[] {
  const keys = lastMonths(months)
  const totals = new Map<string, number>()
  for (const key of keys) totals.set(key, 0)
  for (const expense of expenses) {
    const key = monthKey(expense.spentAt || expense.createdAt)
    if (totals.has(key)) {
      totals.set(key, (totals.get(key) ?? 0) + (expense.amountCny ?? toCny(expense.amount, expense.currency)))
    }
  }
  return keys.map((key) => ({ key, label: monthLabel(key), amount: totals.get(key) ?? 0 }))
}

/* ---------------- 行程计划 ---------------- */

export async function listPlans(tripId: string): Promise<Plan[]> {
  const all = await getAll<Plan>('plans')
  return all
    .map(normalizePlan)
    .filter((item) => item.tripId === tripId)
    .sort(
      (a, b) =>
        a.dayIndex - b.dayIndex ||
        clockToMinutes(a.time) - clockToMinutes(b.time) ||
        a.order - b.order ||
        a.createdAt - b.createdAt,
    )
}

/** 全部计划（首页的今日 / 出发前提示用） */
export async function listAllPlans(): Promise<Plan[]> {
  const all = await getAll<Plan>('plans')
  return all.map(normalizePlan).sort((a, b) => a.dayIndex - b.dayIndex || clockToMinutes(a.time) - clockToMinutes(b.time))
}

export async function savePlan(plan: Plan): Promise<Plan> {
  const next: Plan = { ...plan, time: normalizeClock(plan.time) || plan.time.trim(), place: plan.place.trim() }
  if (!next.id) {
    next.id = uid()
    next.createdAt = Date.now()
    if (!Number.isFinite(next.order)) {
      const sameDay = (await listPlans(next.tripId)).filter((item) => item.dayIndex === next.dayIndex)
      next.order = sameDay.length
    }
  }
  await putOne('plans', next)
  return next
}

export async function deletePlan(id: string): Promise<void> {
  await trackedDelete('plans', id)
}

export async function togglePlan(plan: Plan, done: boolean): Promise<void> {
  await putOne('plans', { ...plan, done })
}

/** delta 为 -1 上移、1 下移：与同一天内相邻条目交换 order */
export async function movePlan(tripId: string, planId: string, delta: number): Promise<void> {
  const plans = await listPlans(tripId)
  const target = plans.find((item) => item.id === planId)
  if (!target) return
  const sameDay = plans.filter((item) => item.dayIndex === target.dayIndex)
  const index = sameDay.findIndex((item) => item.id === planId)
  const neighbor = sameDay[index + delta]
  if (!neighbor) return
  await Promise.all([
    putOne('plans', { ...target, order: neighbor.order }),
    putOne('plans', { ...neighbor, order: target.order }),
  ])
}

interface PlanTemplateItem {
  dayIndex: number
  time: string
  title: string
  place: string
  kind: PlanKind
  note?: string
}

export interface PlanTemplate {
  key: string
  label: string
  hint: string
  items: PlanTemplateItem[]
}

export const PLAN_TEMPLATES: PlanTemplate[] = [
  {
    key: 'city',
    label: '城市漫步',
    hint: '博物馆、老街与夜市',
    items: [
      { dayIndex: 1, time: '10:00', title: '抵达并入住', place: '酒店', kind: 'transport', note: '先放下行李再出门' },
      { dayIndex: 1, time: '12:30', title: '街边小店午餐', place: '', kind: 'food' },
      { dayIndex: 1, time: '14:00', title: '老城区散步', place: '', kind: 'activity' },
      { dayIndex: 1, time: '18:30', title: '夜市小吃', place: '', kind: 'food' },
      { dayIndex: 2, time: '09:30', title: '博物馆 / 美术馆', place: '', kind: 'activity', note: '提前查好闭馆日' },
      { dayIndex: 2, time: '12:00', title: '咖啡馆休息', place: '', kind: 'food' },
      { dayIndex: 2, time: '15:00', title: '独立书店', place: '', kind: 'shopping' },
      { dayIndex: 2, time: '19:30', title: '看夜景', place: '', kind: 'activity' },
      { dayIndex: 3, time: '10:00', title: '早午餐', place: '', kind: 'food' },
      { dayIndex: 3, time: '13:00', title: '买伴手礼', place: '', kind: 'shopping' },
      { dayIndex: 3, time: '16:00', title: '返程', place: '', kind: 'transport' },
    ],
  },
  {
    key: 'beach',
    label: '海岛度假',
    hint: '浮潜、日落与慢早餐',
    items: [
      { dayIndex: 1, time: '11:00', title: '入住海景房', place: '', kind: 'stay' },
      { dayIndex: 1, time: '15:00', title: '沙滩漫步', place: '', kind: 'activity' },
      { dayIndex: 1, time: '18:30', title: '看一场落日', place: '', kind: 'activity' },
      { dayIndex: 2, time: '09:00', title: '浮潜', place: '', kind: 'activity', note: '带防水手机袋' },
      { dayIndex: 2, time: '13:00', title: '海鲜午餐', place: '', kind: 'food' },
      { dayIndex: 2, time: '17:00', title: '港口闲逛', place: '', kind: 'shopping' },
      { dayIndex: 3, time: '10:00', title: '慢早餐', place: '', kind: 'food' },
      { dayIndex: 3, time: '14:00', title: '退房返程', place: '', kind: 'transport' },
    ],
  },
  {
    key: 'road',
    label: '自驾公路',
    hint: '加油、观景台与夜路',
    items: [
      { dayIndex: 1, time: '08:00', title: '取车', place: '租车门店', kind: 'transport', note: '检查轮胎与油量' },
      { dayIndex: 1, time: '11:00', title: '沿海公路', place: '', kind: 'activity' },
      { dayIndex: 1, time: '13:00', title: '路边简餐', place: '', kind: 'food' },
      { dayIndex: 1, time: '17:30', title: '入住中途小镇', place: '', kind: 'stay' },
      { dayIndex: 2, time: '07:30', title: '出发看日出', place: '', kind: 'activity' },
      { dayIndex: 2, time: '12:00', title: '观景台午餐', place: '', kind: 'food' },
      { dayIndex: 2, time: '16:00', title: '加满油', place: '加油站', kind: 'transport' },
      { dayIndex: 3, time: '09:00', title: '还车', place: '', kind: 'transport' },
    ],
  },
  {
    key: 'ski',
    label: '滑雪',
    hint: '雪票、缆车与温泉',
    items: [
      { dayIndex: 1, time: '12:00', title: '入住雪场酒店', place: '', kind: 'stay' },
      { dayIndex: 1, time: '15:00', title: '租装备', place: '雪具店', kind: 'shopping' },
      { dayIndex: 1, time: '18:30', title: '温泉与晚餐', place: '', kind: 'food' },
      { dayIndex: 2, time: '08:30', title: '上缆车', place: '', kind: 'transport' },
      { dayIndex: 2, time: '10:00', title: '初级道练习', place: '', kind: 'activity' },
      { dayIndex: 2, time: '13:00', title: '雪场餐厅', place: '', kind: 'food' },
      { dayIndex: 2, time: '15:30', title: '压轴一趟', place: '', kind: 'activity' },
      { dayIndex: 3, time: '10:00', title: '退房返程', place: '', kind: 'transport' },
    ],
  },
]

export async function applyPlanTemplate(tripId: string, templateKey: string, dayCount = 0): Promise<number> {
  const template = PLAN_TEMPLATES.find((item) => item.key === templateKey)
  if (!template) return 0
  const existing = await listPlans(tripId)
  const existingKeys = new Set(existing.map((item) => `${item.dayIndex}|${item.title}`))
  const limit = dayCount > 0 ? dayCount : Number.MAX_SAFE_INTEGER
  const base = Date.now()
  let added = 0
  for (const [index, item] of template.items.entries()) {
    if (item.dayIndex > limit) continue
    if (existingKeys.has(`${item.dayIndex}|${item.title}`)) continue
    await putOne('plans', {
      id: uid(),
      tripId,
      dayIndex: item.dayIndex,
      time: item.time,
      title: item.title,
      place: item.place,
      kind: item.kind,
      note: item.note ?? '',
      done: false,
      order: existing.filter((entry) => entry.dayIndex === item.dayIndex).length + index,
      createdAt: base + index,
    })
    added++
  }
  return added
}

export function planSummary(plans: Plan[]): { total: number; done: number } {
  return { total: plans.length, done: plans.filter((item) => item.done).length }
}

/** 找出旅程中「接下来」的一条计划：优先未完成且时间在未来的 */
export function nextPlanOf(plans: Plan[], tripStart: number, tripEnd: number): Plan | undefined {
  const pending = plans.filter((item) => !item.done)
  if (pending.length === 0) return undefined

  const todayIndex = tripStart > 0 ? dayIndexOfDate(tripStart) : 0
  const now = new Date()
  const nowMinutes = now.getHours() * 60 + now.getMinutes()

  const upcoming = pending.filter(
    (item) =>
      item.dayIndex > todayIndex ||
      (item.dayIndex === todayIndex && clockToMinutes(item.time) >= nowMinutes),
  )
  if (upcoming.length > 0) return upcoming[0]
  if (tripEnd > 0 && Date.now() < tripEnd) return pending[0]
  return pending[0]
}

export interface PlanGroup {
  dayIndex: number
  plans: Plan[]
}

export function groupPlans(plans: Plan[]): PlanGroup[] {
  const map = new Map<number, Plan[]>()
  for (const plan of plans) {
    const bucket = map.get(plan.dayIndex)
    if (bucket) bucket.push(plan)
    else map.set(plan.dayIndex, [plan])
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([dayIndex, items]) => ({ dayIndex, plans: items }))
}

/* ---------------- 清单 ---------------- */

export async function listChecklist(tripId: string): Promise<ChecklistItem[]> {
  const all = await getAll<ChecklistItem>('checklist')
  return all.filter((item) => item.tripId === tripId).sort((a, b) => a.createdAt - b.createdAt)
}

export async function saveChecklistItem(item: ChecklistItem): Promise<ChecklistItem> {
  const next: ChecklistItem = { ...item }
  if (!next.id) {
    next.id = uid()
    next.createdAt = Date.now()
  }
  await putOne('checklist', next)
  return next
}

export async function deleteChecklistItem(id: string): Promise<void> {
  await trackedDelete('checklist', id)
}

export const CHECKLIST_TEMPLATES: Array<{ key: string; label: string; items: string[] }> = [
  { key: 'city', label: '城市漫步', items: ['舒适的鞋', '折叠雨伞', '交通卡 / 一日券', '充电宝', '离线地图'] },
  { key: 'beach', label: '海岛度假', items: ['泳衣', '防晒霜', '浮潜装备', '防水手机袋', '晕船药'] },
  { key: 'road', label: '自驾公路', items: ['驾驶证与翻译件', '离线地图', '车载充电器', '零食与水', '备胎工具'] },
  { key: 'ski', label: '滑雪', items: ['雪镜', '保暖内衣', '雪票', '护具', '润唇膏'] },
  { key: 'photo', label: '摄影之旅', items: ['备用电池', '存储卡', '三脚架', '清洁布', '渐变灰镜'] },
]

export async function applyChecklistTemplate(tripId: string, templateKey: string): Promise<number> {
  const template = CHECKLIST_TEMPLATES.find((item) => item.key === templateKey)
  if (!template) return 0
  const existing = await listChecklist(tripId)
  const existingTitles = new Set(existing.map((item) => item.title))
  let added = 0
  for (const title of template.items) {
    if (existingTitles.has(title)) continue
    await putOne('checklist', { id: uid(), tripId, title, done: false, createdAt: Date.now() + added })
    added++
  }
  return added
}

/* ---------------- 足迹 ---------------- */

export async function listFootprints(): Promise<Footprint[]> {
  const all = await getAll<Footprint>('footprints')
  return all.sort((a, b) => b.visitedAt - a.visitedAt || b.createdAt - a.createdAt)
}

export async function saveFootprint(item: Footprint): Promise<Footprint> {
  const next: Footprint = { ...item }
  if (!next.id) {
    next.id = uid()
    next.createdAt = Date.now()
  }
  await putOne('footprints', next)
  return next
}

export async function deleteFootprint(id: string): Promise<void> {
  await trackedDelete('footprints', id)
}

/* ---------------- 旅伴 ---------------- */

export async function listMembers(tripId: string): Promise<Member[]> {
  const all = await getAll<Member>('members')
  return all.filter((item) => item.tripId === tripId).sort((a, b) => a.joinedAt - b.joinedAt)
}

export async function addMember(
  tripId: string,
  name: string,
  role: Member['role'] = 'member',
  extra: { contact?: string; note?: string } = {},
): Promise<Member> {
  const member: Member = {
    id: uid(),
    tripId,
    userId: 'local-' + uid().slice(0, 8),
    name,
    role,
    joinedAt: Date.now(),
    emojiSeed: Math.floor(Math.random() * 1000),
    contact: extra.contact?.trim() || undefined,
    note: extra.note?.trim() || undefined,
  }
  await putOne('members', member)
  return member
}

export async function removeMember(id: string): Promise<void> {
  await trackedDelete('members', id)
}

/* ---------------- 账号 ---------------- */

export async function getProfile(): Promise<Profile> {
  const existing = await getOne<Profile>('profile', 'local-user')
  if (existing) return existing
  const profile: Profile = { id: 'local-user', nickname: '陈行舟', avatar: '', createdAt: Date.now() }
  await putOne('profile', profile)
  return profile
}

export async function saveProfile(profile: Profile): Promise<Profile> {
  const next: Profile = { ...profile, id: profile.id || 'local-user' }
  await putOne('profile', next)
  return next
}

/* ---------------- 统计 ---------------- */

export async function stats(): Promise<AppStats> {
  const [rawTrips, rawMoments, footprints, rawExpenses, rawPlans] = await Promise.all([
    getAll<Trip>('trips'),
    getAll<Moment>('moments'),
    getAll<Footprint>('footprints'),
    getAll<Expense>('expenses'),
    getAll<Plan>('plans'),
  ])
  const trips = rawTrips.map(normalizeTrip)
  const moments = rawMoments.map(normalizeMoment)
  const expenses = rawExpenses.map(normalizeExpense)
  const plans = rawPlans.map(normalizePlan)
  const cities = new Set(footprints.map((item) => item.city).filter(Boolean))
  const pending =
    trips.filter((item) => item.syncState === 1).length +
    moments.filter((item) => item.syncState === 1).length +
    expenses.filter((item) => item.syncState === 1).length
  return {
    tripCount: trips.length,
    momentCount: moments.length,
    footprintCount: footprints.length,
    expenseCount: expenses.length,
    cityCount: cities.size,
    pendingSync: pending,
    totalCny: expenses.reduce((sum, item) => sum + (item.amountCny ?? 0), 0),
    totalDays: trips.reduce((sum, trip) => sum + tripDayCount(trip.startDate, trip.endDate), 0),
    photoCount: moments.reduce((sum, item) => sum + item.photos.length, 0),
    planCount: plans.length,
    planDoneCount: plans.filter((item) => item.done).length,
  }
}

/* ---------------- 组合视图 ---------------- */

export interface MomentGroup {
  dayIndex: number
  moments: Moment[]
}

export function groupMoments(moments: Moment[]): MomentGroup[] {
  const groups: MomentGroup[] = []
  for (const moment of moments) {
    let group = groups.find((item) => item.dayIndex === moment.dayIndex)
    if (!group) {
      group = { dayIndex: moment.dayIndex, moments: [] }
      groups.push(group)
    }
    group.moments.push(moment)
  }
  return groups
}

export function checklistProgress(items: ChecklistItem[]): { done: number; total: number } {
  return { done: items.filter((item) => item.done).length, total: items.length }
}

/* ---------------- 记忆 / 往年今日 ---------------- */

export interface MemoryItem {
  moment: Moment
  trip: TripView | undefined
  yearsAgo: number
}

/** 找出与今天同月同日、但不同年份的记录；不足时回退到最近 30 天的记录 */
export function memoriesOf(moments: Moment[], trips: TripView[]): MemoryItem[] {
  const today = new Date()
  const tripMap = new Map(trips.map((trip) => [trip.id, trip]))
  const sameDay: MemoryItem[] = []
  const recent: MemoryItem[] = []

  for (const moment of moments) {
    const date = new Date(moment.createdAt)
    const yearsAgo = today.getFullYear() - date.getFullYear()
    if (yearsAgo > 0 && date.getMonth() === today.getMonth() && date.getDate() === today.getDate()) {
      sameDay.push({ moment, trip: tripMap.get(moment.tripId), yearsAgo })
      continue
    }
    const diffDays = Math.floor((Date.now() - moment.createdAt) / 864e5)
    if (diffDays >= 0 && diffDays <= 30) {
      recent.push({ moment, trip: tripMap.get(moment.tripId), yearsAgo: 0 })
    }
  }

  if (sameDay.length > 0) {
    // 往年今日优先；不足 3 张时用最近一个月的记录补齐，避免横滑区留白
    const seen = new Set(sameDay.map((item) => item.moment.id))
    const filler = recent.filter((item) => !seen.has(item.moment.id))
    return [...sameDay.sort((a, b) => b.yearsAgo - a.yearsAgo), ...filler].slice(0, 6)
  }
  return recent.slice(0, 6)
}

/* ---------------- 全局搜索 ---------------- */

function scoreOf(text: string, query: string): number {
  if (!text) return 0
  const lower = text.toLowerCase()
  if (lower === query) return 120
  if (lower.startsWith(query)) return 90
  if (lower.includes(query)) return 60
  return 0
}

export async function searchAll(query: string): Promise<SearchResult[]> {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const [trips, moments, expenses, footprints, plans] = await Promise.all([
    listTrips(),
    listAllMoments(),
    listExpenses(),
    listFootprints(),
    getAll<Plan>('plans'),
  ])
  const tripTitle = new Map(trips.map((trip) => [trip.id, trip.title]))
  const results: SearchResult[] = []

  for (const trip of trips) {
    const titleScore = scoreOf(trip.title, q)
    const score = Math.max(
      titleScore > 0 ? titleScore + 20 : 0,
      scoreOf(trip.destination, q),
      scoreOf(trip.note, q),
    )
    if (score > 0) {
      results.push({
        kind: 'trip',
        id: trip.id,
        title: trip.title,
        subtitle: `${trip.destination || '目的地待定'} · ${trip.momentCount} 条记录`,
        score,
      })
    }
  }

  for (const moment of moments) {
    const contentScore = scoreOf(moment.content, q)
    const score = Math.max(
      contentScore > 0 ? contentScore + 10 : 0,
      scoreOf(moment.locationName, q),
      scoreOf((moment.tags ?? []).join(' '), q),
    )
    if (score > 0) {
      results.push({
        kind: 'moment',
        id: moment.id,
        tripId: moment.tripId,
        title: moment.locationName || moment.content.slice(0, 24) || '未命名记录',
        subtitle: tripTitle.get(moment.tripId) ?? '记录',
        score,
      })
    }
  }

  for (const expense of expenses) {
    const score = Math.max(scoreOf(expense.note, q), scoreOf(expense.category, q))
    if (score > 0) {
      results.push({
        kind: 'expense',
        id: expense.id,
        tripId: expense.tripId,
        title: expense.note || '未备注账目',
        subtitle: `${tripTitle.get(expense.tripId) ?? '未关联旅程'} · ${expense.amount}`,
        score,
      })
    }
  }

  for (const footprint of footprints) {
    const placeScore = scoreOf(footprint.placeName, q)
    const score = Math.max(
      placeScore > 0 ? placeScore + 10 : 0,
      scoreOf(footprint.city, q),
      scoreOf(footprint.note, q),
    )
    if (score > 0) {
      results.push({
        kind: 'footprint',
        id: footprint.id,
        title: footprint.placeName,
        subtitle: footprint.city || '足迹',
        score,
      })
    }
  }

  for (const plan of plans.map(normalizePlan)) {
    const titleScore = scoreOf(plan.title, q)
    const score = Math.max(
      titleScore > 0 ? titleScore + 8 : 0,
      scoreOf(plan.place, q),
      scoreOf(plan.note, q),
    )
    if (score > 0) {
      results.push({
        kind: 'plan',
        id: plan.id,
        tripId: plan.tripId,
        title: plan.title,
        subtitle: `第 ${plan.dayIndex} 天${plan.time ? ` · ${plan.time}` : ''} · ${
          tripTitle.get(plan.tripId) ?? '计划'
        }`,
        score,
      })
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 24)
}

/* ---------------- 备份与恢复 ---------------- */

export const EXPORT_VERSION = 3

interface BackupPayload {
  app: string
  version: number
  exportedAt: number
  trips: Trip[]
  moments: Moment[]
  expenses: Expense[]
  checklist: ChecklistItem[]
  footprints: Footprint[]
  members: Member[]
  plans?: Plan[]
  profile?: Profile
}

export async function exportAll(): Promise<string> {
  const [trips, moments, expenses, checklist, footprints, members, plans, profile] = await Promise.all([
    getAll<Trip>('trips'),
    getAll<Moment>('moments'),
    getAll<Expense>('expenses'),
    getAll<ChecklistItem>('checklist'),
    getAll<Footprint>('footprints'),
    getAll<Member>('members'),
    getAll<Plan>('plans'),
    getProfile(),
  ])
  const payload: BackupPayload = {
    app: 'travelog',
    version: EXPORT_VERSION,
    exportedAt: Date.now(),
    trips,
    moments,
    expenses,
    checklist,
    footprints,
    members,
    plans,
    profile,
  }
  return JSON.stringify(payload, null, 2)
}

export interface ImportSummary {
  trips: number
  moments: number
  expenses: number
  checklist: number
  footprints: number
  plans: number
}

export async function importAll(json: string): Promise<ImportSummary> {
  const parsed = JSON.parse(json) as Partial<BackupPayload>
  if (parsed.app !== 'travelog' || !Array.isArray(parsed.trips)) {
    throw new Error('不是有效的旅记备份文件')
  }
  await Promise.all([
    clearStore('trips'),
    clearStore('moments'),
    clearStore('expenses'),
    clearStore('checklist'),
    clearStore('footprints'),
    clearStore('members'),
    clearStore('plans'),
  ])
  const summary: ImportSummary = {
    trips: 0,
    moments: 0,
    expenses: 0,
    checklist: 0,
    footprints: 0,
    plans: 0,
  }
  for (const row of parsed.trips ?? []) {
    await putOne('trips', normalizeTrip(row))
    summary.trips++
  }
  for (const row of parsed.moments ?? []) {
    await putOne('moments', normalizeMoment(row))
    summary.moments++
  }
  for (const row of parsed.expenses ?? []) {
    await putOne('expenses', normalizeExpense(row))
    summary.expenses++
  }
  for (const row of parsed.checklist ?? []) {
    await putOne('checklist', row)
    summary.checklist++
  }
  for (const row of parsed.footprints ?? []) {
    await putOne('footprints', row)
    summary.footprints++
  }
  for (const row of parsed.members ?? []) {
    await putOne('members', row)
  }
  for (const row of parsed.plans ?? []) {
    await putOne('plans', normalizePlan(row))
    summary.plans++
  }
  if (parsed.profile) {
    await putOne('profile', parsed.profile)
  }
  return summary
}

export async function resetAll(): Promise<void> {
  await Promise.all(
    (['trips', 'moments', 'expenses', 'checklist', 'footprints', 'members', 'plans', 'profile'] as const).map(
      (store) => clearStore(store),
    ),
  )
  await seedIfNeeded(true)
}

export type { TripTemplate }
/* ---------------- 云同步 ---------------- */

// 包含 profile：昵称/头像也随账号同步到其他设备
export const SYNC_KINDS = [
  'trips',
  'moments',
  'expenses',
  'checklist',
  'footprints',
  'members',
  'plans',
  'profile',
] as const
export type SyncKind = (typeof SYNC_KINDS)[number]

export interface SyncEntity {
  kind: SyncKind
  id: string
  data: unknown
  updatedAt: number
  deleted?: boolean
}

/**
 * 以云端为准全量覆盖本地。
 * 用于「输入同步码登录后，先拉取云端数据」的场景——不做 LWW 比较，直接替换。
 * 调用方需保证 entities 非空，避免误清空本地。
 */
export async function replaceAllWithRemote(entities: SyncEntity[]): Promise<number> {
  for (const kind of SYNC_KINDS) await clearStore(kind)
  await clearStore('tombstones')
  let applied = 0
  for (const entity of entities) {
    if (entity.deleted || !entity.data || typeof entity.data !== 'object') continue
    await putOne(entity.kind, entity.data as { id: string })
    applied++
  }
  return applied
}

/** 导出本次需要推送的全部实体（含墓碑） */
export async function exportAllEntities(): Promise<SyncEntity[]> {
  const out: SyncEntity[] = []
  for (const kind of SYNC_KINDS) {
    const rows = await getAll<{ id: string; updatedAt?: number; createdAt?: number }>(kind)
    for (const row of rows) {
      out.push({
        kind,
        id: row.id,
        data: row,
        updatedAt: row.updatedAt ?? row.createdAt ?? Date.now(),
      })
    }
  }
  const tombs = await getAll<{ id: string; kind: SyncKind; value: string; deletedAt: number }>('tombstones')
  for (const item of tombs) {
    if (!SYNC_KINDS.includes(item.kind)) continue
    out.push({ kind: item.kind, id: item.value, data: null, updatedAt: item.deletedAt, deleted: true })
  }
  return out
}

/** 应用服务端下发的实体；删除不再写墓碑，避免被回推 */
export async function applyRemoteEntities(
  entities: SyncEntity[],
): Promise<{ applied: number; removed: number }> {
  let applied = 0
  let removed = 0
  for (const entity of entities) {
    if (!SYNC_KINDS.includes(entity.kind)) continue

    // 本地优先：本地更新时间更新时不接受远程版本，避免刚编辑/AI 生成的内容被旧数据覆盖
    const local = await getOne<{ updatedAt?: number }>(entity.kind, entity.id)
    const localAt = local?.updatedAt ?? 0

    if (entity.deleted) {
      if (!local || localAt <= entity.updatedAt) {
        await deleteOne(entity.kind, entity.id)
        removed++
      }
      continue
    }
    if (entity.data && typeof entity.data === 'object') {
      if (local && localAt > entity.updatedAt) continue
      await putOne(entity.kind, entity.data as { id: string })
      applied++
    }
  }
  return { applied, removed }
}

export async function clearTombstones(): Promise<void> {
  await clearStore('tombstones')
}

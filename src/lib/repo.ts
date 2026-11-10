import type {
  AppStats,
  CategoryStat,
  ChecklistItem,
  Expense,
  Footprint,
  Member,
  Moment,
  Profile,
  Trip,
  TripView,
} from './types'
import { clearStore, deleteOne, getAll, getOne, putOne } from './db'
import { CATEGORY_ORDER, uid } from './utils'
import { seedIfNeeded } from './seed'

export async function ensureReady(): Promise<void> {
  await seedIfNeeded()
}

/* ---------------- 旅行 ---------------- */

export async function listTrips(): Promise<TripView[]> {
  const [trips, moments, expenses] = await Promise.all([
    getAll<Trip>('trips'),
    getAll<Moment>('moments'),
    getAll<Expense>('expenses'),
  ])
  const views = trips.map((trip) => {
    const momentCount = moments.filter((item) => item.tripId === trip.id).length
    const expenseTotal = expenses
      .filter((item) => item.tripId === trip.id)
      .reduce((sum, item) => sum + item.amount, 0)
    return { ...trip, momentCount, expenseTotal }
  })
  return views.sort((a, b) => {
    const aKey = a.startDate || a.createdAt
    const bKey = b.startDate || b.createdAt
    return bKey - aKey
  })
}

export async function getTrip(id: string): Promise<Trip | undefined> {
  return getOne<Trip>('trips', id)
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
  const [moments, expenses, checklist, footprints, members] = await Promise.all([
    getAll<Moment>('moments'),
    getAll<Expense>('expenses'),
    getAll<ChecklistItem>('checklist'),
    getAll<Footprint>('footprints'),
    getAll<Member>('members'),
  ])
  await Promise.all([
    deleteOne('trips', id),
    ...moments.filter((item) => item.tripId === id).map((item) => deleteOne('moments', item.id)),
    ...expenses.filter((item) => item.tripId === id).map((item) => deleteOne('expenses', item.id)),
    ...checklist.filter((item) => item.tripId === id).map((item) => deleteOne('checklist', item.id)),
    ...footprints.filter((item) => item.tripId === id).map((item) => deleteOne('footprints', item.id)),
    ...members.filter((item) => item.tripId === id).map((item) => deleteOne('members', item.id)),
  ])
}

/* ---------------- 图文记录 ---------------- */

export async function listMoments(tripId: string): Promise<Moment[]> {
  const all = await getAll<Moment>('moments')
  return all
    .filter((item) => item.tripId === tripId)
    .sort((a, b) => (a.dayIndex - b.dayIndex) || (a.createdAt - b.createdAt))
}

export async function listAllMoments(): Promise<Moment[]> {
  const all = await getAll<Moment>('moments')
  return all.sort((a, b) => b.createdAt - a.createdAt)
}

export async function saveMoment(moment: Moment): Promise<Moment> {
  const now = Date.now()
  const next: Moment = { ...moment, photos: [...moment.photos] }
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
  await deleteOne('moments', id)
}

/* ---------------- 记账 ---------------- */

export async function listExpenses(tripId?: string): Promise<Expense[]> {
  const all = await getAll<Expense>('expenses')
  return all
    .filter((item) => (tripId ? item.tripId === tripId : true))
    .sort((a, b) => b.spentAt - a.spentAt || b.createdAt - a.createdAt)
}

export async function saveExpense(expense: Expense): Promise<Expense> {
  const next: Expense = { ...expense }
  if (!next.id) {
    next.id = uid()
    next.createdAt = Date.now()
  }
  next.syncState = 1
  await putOne('expenses', next)
  return next
}

export async function deleteExpense(id: string): Promise<void> {
  await deleteOne('expenses', id)
}

export function sumExpense(expenses: Expense[]): number {
  return expenses.reduce((sum, item) => sum + item.amount, 0)
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
      stat.amount += expense.amount
      stat.count += 1
    }
  }
  const max = stats.reduce((value, item) => Math.max(value, item.amount), 0)
  for (const stat of stats) {
    stat.ratio = max > 0 ? stat.amount / max : 0
  }
  return stats.filter((item) => item.amount > 0)
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
  await deleteOne('checklist', id)
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
  await deleteOne('footprints', id)
}

/* ---------------- 旅伴 ---------------- */

export async function listMembers(tripId: string): Promise<Member[]> {
  const all = await getAll<Member>('members')
  return all.filter((item) => item.tripId === tripId).sort((a, b) => a.joinedAt - b.joinedAt)
}

export async function addMember(tripId: string, name: string, role: Member['role'] = 'member'): Promise<Member> {
  const member: Member = {
    id: uid(),
    tripId,
    userId: 'local-' + uid().slice(0, 8),
    name,
    role,
    joinedAt: Date.now(),
    emojiSeed: Math.floor(Math.random() * 1000),
  }
  await putOne('members', member)
  return member
}

export async function removeMember(id: string): Promise<void> {
  await deleteOne('members', id)
}

/* ---------------- 账号 ---------------- */

export async function getProfile(): Promise<Profile> {
  const existing = await getOne<Profile>('profile', 'local-user')
  if (existing) return existing
  const profile: Profile = {
    id: 'local-user',
    nickname: '陈行舟',
    avatar: '',
    createdAt: Date.now(),
  }
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
  const [trips, moments, footprints, expenses] = await Promise.all([
    getAll<Trip>('trips'),
    getAll<Moment>('moments'),
    getAll<Footprint>('footprints'),
    getAll<Expense>('expenses'),
  ])
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

export async function resetAll(): Promise<void> {
  await Promise.all(
    (['trips', 'moments', 'expenses', 'checklist', 'footprints', 'members', 'profile'] as const).map(
      (store) => clearStore(store),
    ),
  )
  await seedIfNeeded(true)
}
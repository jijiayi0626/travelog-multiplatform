import type { Expense, Footprint, Moment, Plan, TripView } from './types'
import { CATEGORY_LABEL, CURRENCY_RATE_TO_CNY, tripDayCount } from './utils'

export interface PersonaTrait {
  key: string
  label: string
  /** 0–100 */
  value: number
  color: string
}

export interface PersonaStat {
  label: string
  value: string
}

export interface TravelPersona {
  id: string
  title: string
  tagline: string
  summary: string
  traits: PersonaTrait[]
  stats: PersonaStat[]
  badges: string[]
}

export interface PersonaInput {
  trips: TripView[]
  moments: Moment[]
  expenses: Expense[]
  footprints: Footprint[]
  plans: Plan[]
}

const ARCHETYPES: Array<{ id: string; title: string; tagline: string }> = [
  { id: 'architect', title: '行程设计师', tagline: '把每一天排得明明白白，路上只管享受。' },
  { id: 'planner', title: '计划控旅人', tagline: '攻略做在前面，意外就少一半。' },
  { id: 'chronicler', title: '旅行记录官', tagline: '走过的路、吃过的店，都被你认真留下。' },
  { id: 'foodie', title: '寻味旅人', tagline: '为了那一口地道味道，多走两条街也值得。' },
  { id: 'hunter', title: '城市猎手', tagline: '一座城接一座城，收集地图上的新坐标。' },
  { id: 'drifter', title: '即兴漫游者', tagline: '不赶行程，走到哪算哪，反而常遇见惊喜。' },
  { id: 'wanderer', title: '自在旅人', tagline: '有计划也有留白，找到自己的旅行节奏。' },
]

const TRAIT_COLORS = {
  planning: '#0f766e',
  exploration: '#b45309',
  documentation: '#4b5563',
  foodie: '#9d174d',
  spontaneity: '#15803d',
}

function clamp(value: number): number {
  return Math.max(5, Math.min(100, Math.round(value)))
}

function archetypeOf(id: string) {
  return ARCHETYPES.find((item) => item.id === id) ?? ARCHETYPES[ARCHETYPES.length - 1]
}

/** 根据行程、记录、花费与足迹，生成一份可分享的旅行人格。 */
export function buildPersona(input: PersonaInput): TravelPersona | null {
  const { trips, moments, expenses, footprints, plans } = input
  if (trips.length === 0 && moments.length === 0 && footprints.length === 0) return null

  const totalDays = trips.reduce((sum, trip) => sum + tripDayCount(trip.startDate, trip.endDate), 0)
  const cities = new Set<string>()
  for (const trip of trips) {
    const destination = (trip.destination || trip.title || '').trim()
    if (destination) cities.add(destination)
  }
  for (const footprint of footprints) {
    const city = (footprint.city || footprint.placeName || '').trim()
    if (city) cities.add(city)
  }

  const photoCount = moments.reduce((sum, moment) => sum + (moment.photos?.length ?? 0), 0)
  const dayBase = Math.max(totalDays, 1)
  const planPerDay = plans.length / dayBase
  const momentPerDay = moments.length / dayBase
  const photoPerDay = photoCount / dayBase

  const totalCny = expenses.reduce(
    (sum, expense) => sum + (expense.amountCny ?? expense.amount * CURRENCY_RATE_TO_CNY[expense.currency ?? 'CNY']),
    0,
  )
  const byCategory = new Map<string, number>()
  for (const expense of expenses) {
    const amount =
      expense.amountCny ?? expense.amount * CURRENCY_RATE_TO_CNY[expense.currency ?? 'CNY']
    byCategory.set(expense.category, (byCategory.get(expense.category) ?? 0) + amount)
  }
  const topCategory = [...byCategory.entries()].sort((a, b) => b[1] - a[1])[0]
  const foodRatio = totalCny > 0 ? (byCategory.get('food') ?? 0) / totalCny : 0

  const planning = clamp(planPerDay * 16 + (plans.length > 0 ? 12 : 0))
  const exploration = clamp(cities.size * 16 + footprints.length * 1.2 + trips.length * 5)
  const documentation = clamp(momentPerDay * 12 + photoPerDay * 1.6 + moments.length * 0.6)
  const foodie = clamp(foodRatio * 150 + (byCategory.get('food') ? 12 : 0))
  const spontaneity = clamp(100 - planning * 0.65 + momentPerDay * 4)

  const traits: PersonaTrait[] = [
    { key: 'planning', label: '计划力', value: planning, color: TRAIT_COLORS.planning },
    { key: 'exploration', label: '探索欲', value: exploration, color: TRAIT_COLORS.exploration },
    { key: 'documentation', label: '记录癖', value: documentation, color: TRAIT_COLORS.documentation },
    { key: 'foodie', label: '寻味度', value: foodie, color: TRAIT_COLORS.foodie },
    { key: 'spontaneity', label: '随性度', value: spontaneity, color: TRAIT_COLORS.spontaneity },
  ]

  let id = 'wanderer'
  if (planning >= 70 && documentation >= 60) id = 'architect'
  else if (planning >= 70) id = 'planner'
  else if (documentation >= 65) id = 'chronicler'
  else if (foodie >= 55) id = 'foodie'
  else if (exploration >= 70) id = 'hunter'
  else if (spontaneity >= 78) id = 'drifter'

  const archetype = archetypeOf(id)

  const parts: string[] = []
  if (cities.size > 0) parts.push(`去过 ${cities.size} 座城市`)
  if (totalDays > 0) parts.push(`在路上 ${totalDays} 天`)
  if (moments.length > 0) parts.push(`留下 ${moments.length} 条记录`)
  if (photoCount > 0) parts.push(`${photoCount} 张照片`)
  let summary = parts.length > 0 ? `${parts.join('，')}。` : '你的旅行才刚刚开始。'
  if (topCategory) {
    const label = CATEGORY_LABEL[topCategory[0] as keyof typeof CATEGORY_LABEL] ?? topCategory[0]
    summary += `花费最多的是${label}${topCategory[0] === 'food' ? '，果然把预算都吃进肚子里了' : ''}。`
  }
  if (planPerDay > 0) {
    summary += `平均每天 ${planPerDay.toFixed(1)} 个安排${planPerDay >= 4 ? '，是妥妥的满档玩家' : '，留白刚刚好'}。`
  }

  const stats: PersonaStat[] = [
    { label: '城市', value: String(cities.size) },
    { label: '天数', value: String(totalDays) },
    { label: '记录', value: String(moments.length) },
    { label: '照片', value: String(photoCount) },
  ]

  const badges = [
    cities.size > 0 ? `${cities.size} 座城市` : '',
    totalDays > 0 ? `${totalDays} 天在路上` : '',
    photoCount > 0 ? `${photoCount} 张照片` : '',
    expenses.length > 0 ? `${expenses.length} 笔账` : '',
  ].filter(Boolean)

  return {
    id: archetype.id,
    title: archetype.title,
    tagline: archetype.tagline,
    summary,
    traits,
    stats,
    badges,
  }
}

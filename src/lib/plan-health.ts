import type { Plan } from './types'
import { clockToMinutes } from './utils'

export interface PlanIssue {
  /** warn 会明显扣分，info 只做提醒 */
  level: 'warn' | 'info'
  /** 针对某一天；不填表示整体建议 */
  dayIndex?: number
  title: string
  detail: string
}

export interface PlanHealth {
  /** 0–100，越高越从容 */
  score: number
  issues: PlanIssue[]
  /** 安排最多的一天 */
  busiestDay: number
  busiestCount: number
  /** 有安排的天数 */
  daysWithPlans: number
}

const TIMED = (plan: Plan) => Boolean(plan.time)

function placeOf(plan: Plan): string {
  return (plan.place || plan.title || '').trim()
}

/**
 * 行程体检：按天看安排密度、时间冲突、赶路间隔、深夜活动与跨天折返。
 * 纯函数，不读写存储，方便在日程页直接复用。
 */
export function planHealth(plans: Plan[], dayCount: number): PlanHealth | null {
  if (plans.length === 0) return null

  const days = new Map<number, Plan[]>()
  for (const plan of plans) {
    const day = Math.max(1, plan.dayIndex || 1)
    const bucket = days.get(day)
    if (bucket) bucket.push(plan)
    else days.set(day, [plan])
  }

  const issues: PlanIssue[] = []
  let busiestDay = 1
  let busiestCount = 0

  for (const [dayIndex, items] of [...days.entries()].sort((a, b) => a[0] - b[0])) {
    if (items.length > busiestCount) {
      busiestCount = items.length
      busiestDay = dayIndex
    }

    const timed = items.filter(TIMED).sort((a, b) => clockToMinutes(a.time) - clockToMinutes(b.time))
    const span =
      timed.length >= 2
        ? clockToMinutes(timed[timed.length - 1].time) - clockToMinutes(timed[0].time)
        : 0

    if (items.length >= 8) {
      issues.push({
        level: 'warn',
        dayIndex,
        title: `排了 ${items.length} 件事`,
        detail: '一天塞太多容易疲于赶场，可以把其中一两件挪到附近的空闲日。',
      })
    } else if (items.length >= 6) {
      issues.push({
        level: 'info',
        dayIndex,
        title: `节奏偏紧`,
        detail: `一共 ${items.length} 项安排，留一点空档给临时发现的小店和休息。`,
      })
    }

    if (span > 12 * 60) {
      issues.push({
        level: 'warn',
        dayIndex,
        title: `时间跨度超过 12 小时`,
        detail: `${timed[0].time} 到 ${timed[timed.length - 1].time} 都在路上，第二天容易没体力。`,
      })
    } else if (span > 9 * 60) {
      issues.push({
        level: 'info',
        dayIndex,
        title: `从早到晚的一天`,
        detail: `${timed[0].time}–${timed[timed.length - 1].time}，记得把吃饭和休息也排进去。`,
      })
    }

    for (let index = 1; index < timed.length; index += 1) {
      const prev = timed[index - 1]
      const current = timed[index]
      const gap = clockToMinutes(current.time) - clockToMinutes(prev.time)
      const prevPlace = placeOf(prev)
      const nextPlace = placeOf(current)
      if (gap <= 0) {
        issues.push({
          level: 'warn',
          dayIndex,
          title: `时间撞车`,
          detail: `「${prev.title}」和「${current.title}」都排在 ${current.time}。`,
        })
        continue
      }
      if (gap < 30 && prevPlace && nextPlace && prevPlace !== nextPlace) {
        issues.push({
          level: 'warn',
          dayIndex,
          title: `只有 ${gap} 分钟赶路`,
          detail: `从「${prevPlace}」到「${nextPlace}」太紧，建议错开至少半小时。`,
        })
      }
    }

    const late = timed.find((plan) => clockToMinutes(plan.time) >= 22 * 60)
    if (late) {
      issues.push({
        level: 'info',
        dayIndex,
        title: `有深夜安排`,
        detail: `「${late.title}」在 ${late.time}，记得确认交通和第二天起床时间。`,
      })
    }

    const walking = items.filter((plan) => plan.kind === 'activity' || plan.kind === 'shopping')
    if (walking.length >= 5) {
      issues.push({
        level: 'info',
        dayIndex,
        title: `步行强度不小`,
        detail: `${walking.length} 个游玩/购物点连在一起，穿双舒服的鞋，中间找地方坐坐。`,
      })
    }
  }

  // 跨天重复同一地点：隔天又回去，通常是折返
  const placeDays = new Map<string, number[]>()
  for (const [dayIndex, items] of days) {
    for (const plan of items) {
      const place = placeOf(plan)
      if (!place) continue
      const list = placeDays.get(place)
      if (list) {
        if (!list.includes(dayIndex)) list.push(dayIndex)
      } else {
        placeDays.set(place, [dayIndex])
      }
    }
  }
  for (const [place, list] of placeDays) {
    if (list.length < 2) continue
    const sorted = [...list].sort((a, b) => a - b)
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index] - sorted[index - 1] >= 2) {
        issues.push({
          level: 'info',
          title: `「${place}」安排了两次`,
          detail: `第 ${sorted[index - 1]} 天和第 ${sorted[index]} 天各去一次，确认是不是需要折返。`,
        })
        break
      }
    }
  }

  if (dayCount > 1) {
    const emptyDays: number[] = []
    for (let day = 1; day <= dayCount; day += 1) {
      if (!days.has(day)) emptyDays.push(day)
    }
    if (emptyDays.length > 0 && emptyDays.length < dayCount) {
      const label = emptyDays.slice(0, 3).map((day) => `第 ${day} 天`).join('、')
      issues.push({
        level: 'info',
        title: `${emptyDays.length} 天还没有安排`,
        detail: `${label}${emptyDays.length > 3 ? ' 等' : ''}还空着，可以留白，也可以补一顿想吃的店。`,
      })
    }
  }

  const warnCount = issues.filter((issue) => issue.level === 'warn').length
  const infoCount = issues.length - warnCount
  const score = Math.max(25, Math.min(100, 100 - warnCount * 12 - infoCount * 5))

  return {
    score,
    issues: issues.sort((a, b) => (a.level === b.level ? 0 : a.level === 'warn' ? -1 : 1)),
    busiestDay,
    busiestCount,
    daysWithPlans: days.size,
  }
}

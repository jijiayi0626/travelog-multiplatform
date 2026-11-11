import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import type { Plan, Trip } from './types'

const native = Capacitor.isNativePlatform()

/** 权限弹窗可能在无用户手势时永远挂起，统一加超时兜底 */
function withTimeout<T>(promise: Promise<T>, fallback: T, ms = 2500): Promise<T> {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ])
}

export interface ReminderPrefs {
  enabled: boolean
  leadMinutes: number
}

const KEY = 'travelog.reminder'
const DEFAULT: ReminderPrefs = { enabled: true, leadMinutes: 15 }

export function getReminderPrefs(): ReminderPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...DEFAULT, ...(JSON.parse(raw) as Partial<ReminderPrefs>) } : { ...DEFAULT }
  } catch {
    return { ...DEFAULT }
  }
}

export function setReminderPrefs(patch: Partial<ReminderPrefs>): ReminderPrefs {
  const next = { ...getReminderPrefs(), ...patch }
  localStorage.setItem(KEY, JSON.stringify(next))
  return next
}

function numericId(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return hash % 2147483647
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (native) {
    const status = await LocalNotifications.checkPermissions()
    if (status.display === 'granted') return true
    const requested = await withTimeout(LocalNotifications.requestPermissions(), {
      display: 'denied' as const,
    })
    return requested.display === 'granted'
  }
  if (typeof Notification === 'undefined') return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  return (await withTimeout(Notification.requestPermission(), 'default')) === 'granted'
}

function triggerAt(plan: Plan, trip: Trip, leadMinutes: number): number | null {
  if (!plan.time || trip.startDate <= 0) return null
  const [hour, minute] = plan.time.split(':').map(Number)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  const day = new Date(trip.startDate + (plan.dayIndex - 1) * 864e5)
  day.setHours(hour, minute, 0, 0)
  const at = day.getTime() - leadMinutes * 60000
  return at > Date.now() + 5000 ? at : null
}

/** 给一条日程安排提醒；时间已过则跳过 */
export async function schedulePlanReminder(
  plan: Plan,
  trip: Trip,
  leadMinutes = getReminderPrefs().leadMinutes,
): Promise<boolean> {
  const at = triggerAt(plan, trip, leadMinutes)
  if (at === null) return false

  if (native) {
    await LocalNotifications.schedule({
      notifications: [
        {
          id: numericId(plan.id),
          title: `${trip.title}`,
          body: `${plan.time} ${plan.title}${plan.place ? ` · ${plan.place}` : ''}`,
          schedule: { at: new Date(at), allowWhileIdle: true },
        },
      ],
    })
    return true
  }

  const delay = at - Date.now()
  if (delay <= 0 || delay > 2 ** 31 - 1) return false
  window.setTimeout(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(`${trip.title}`, {
        body: `${plan.time} ${plan.title}`,
        tag: plan.id,
      })
    }
  }, delay)
  return true
}

export async function cancelPlanReminder(planId: string): Promise<void> {
  if (!native) return
  try {
    await LocalNotifications.cancel({ notifications: [{ id: numericId(planId) }] })
  } catch {
    /* 不存在时忽略 */
  }
}
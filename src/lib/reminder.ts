import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import type { Plan, Trip } from './types'

const native = Capacitor.isNativePlatform()

/** 权限弹窗可能在无用户手势时永远挂起；超时只做兜底，之后会重新查询真实状态 */
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

/** 自定义通知频道：高优先级，提醒才能横幅弹出而不是被折叠 */
const CHANNEL_ID = 'reminders'
let channelReady = false

async function ensureChannel(): Promise<void> {
  if (!native || channelReady) return
  try {
    await LocalNotifications.createChannel({
      id: CHANNEL_ID,
      name: '日程提醒',
      description: '行程安排与出发前提醒',
      importance: 4,
      visibility: 1,
      vibration: true,
      lights: true,
    })
    channelReady = true
  } catch {
    /* Android 8 以下没有通知频道，使用系统默认即可 */
  }
}

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
    try {
      let status = await LocalNotifications.checkPermissions()
      if (status.display !== 'granted') {
        // 授权框需要用户操作，不能用 2.5 秒超时直接当作拒绝
        status = await withTimeout(
          LocalNotifications.requestPermissions(),
          { display: 'denied' as const },
          60_000,
        )
        // 超时后用户可能已经点过「允许」，以系统真实状态为准
        if (status.display !== 'granted') status = await LocalNotifications.checkPermissions()
      }
      if (status.display !== 'granted') return false
      await ensureChannel()
      return true
    } catch {
      return false
    }
  }
  if (typeof Notification === 'undefined') return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  return (await withTimeout(Notification.requestPermission(), 'default', 60_000)) === 'granted'
}

/**
 * Android 12+ 精确闹钟授权：未授权时系统会退化为非精确提醒（可能延迟十几分钟）。
 * 会跳到系统设置页，建议只在用户主动点击「开启通知权限」时调用。
 */
export async function ensureExactAlarmPermission(): Promise<boolean> {
  if (!native) return true
  try {
    const setting = await LocalNotifications.checkExactNotificationSetting()
    if (setting.exact_alarm === 'granted') return true
    const changed = await LocalNotifications.changeExactNotificationSetting()
    return changed.exact_alarm === 'granted'
  } catch {
    /* 旧系统或插件不支持时按可用处理 */
    return true
  }
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

/** 页面关闭后 Web 通知不可用；优先走 Service Worker，安卓 Chrome 不支持 new Notification */
async function showWebNotification(title: string, body: string, tag: string): Promise<void> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  try {
    const registration = await navigator.serviceWorker?.getRegistration()
    if (registration) {
      await registration.showNotification(title, { body, tag })
      return
    }
  } catch {
    /* 继续尝试构造函数 */
  }
  try {
    new Notification(title, { body, tag })
  } catch {
    /* 部分浏览器禁止页面直接构造通知 */
  }
}

/** 网页端提醒的定时器，便于编辑/关闭提醒时取消旧的 */
const webTimers = new Map<string, number>()

/** 给一条日程安排提醒；时间已过则跳过 */
export async function schedulePlanReminder(
  plan: Plan,
  trip: Trip,
  leadMinutes = getReminderPrefs().leadMinutes,
): Promise<boolean> {
  const at = triggerAt(plan, trip, leadMinutes)
  if (at === null) return false

  if (native) {
    await ensureChannel()
    await LocalNotifications.schedule({
      notifications: [
        {
          id: numericId(plan.id),
          title: `${trip.title}`,
          body: `${plan.time} ${plan.title}${plan.place ? ` · ${plan.place}` : ''}`,
          channelId: CHANNEL_ID,
          schedule: { at: new Date(at), allowWhileIdle: true },
        },
      ],
    })
    return true
  }

  const delay = at - Date.now()
  if (delay <= 0 || delay > 2 ** 31 - 1) return false
  const previous = webTimers.get(plan.id)
  if (previous !== undefined) window.clearTimeout(previous)
  const timer = window.setTimeout(() => {
    webTimers.delete(plan.id)
    void showWebNotification(
      `${trip.title}`,
      `${plan.time} ${plan.title}${plan.place ? ` · ${plan.place}` : ''}`,
      plan.id,
    )
  }, delay)
  webTimers.set(plan.id, timer)
  return true
}

export async function cancelPlanReminder(planId: string): Promise<void> {
  const timer = webTimers.get(planId)
  if (timer !== undefined) {
    window.clearTimeout(timer)
    webTimers.delete(planId)
  }
  if (!native) return
  try {
    await LocalNotifications.cancel({ notifications: [{ id: numericId(planId) }] })
  } catch {
    /* 不存在时忽略 */
  }
}

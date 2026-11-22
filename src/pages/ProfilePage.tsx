import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowLeft,
  BellSimple,
  BookOpen,
  CaretDown,
  CaretRight,
  CloudCheck,
  CloudSlash,
  Devices,
  DownloadSimple,
  Crown,
  Images,
  Info,
  Translate,
  ClockCounterClockwise,
  MapPinLine,
  MagnifyingGlass,
  SignIn,
  ShieldCheck,
  Sparkle,
  Moon,
  PaintBrush,
  PencilSimple,
  Sun,
  UploadSimple,
  UserPlus,
  X,
} from '@phosphor-icons/react'
import type { AppStats, Profile } from '../lib/types'
import { exportAll, getProfile, importAll, saveProfile, stats } from '../lib/repo'
import { useLoader } from '../lib/hooks'
import { hasPendingLocalChanges, runSync } from '../lib/sync-engine'
import { useI18n, useNav, useRefresh, useToast } from '../lib/app-context'
import {
  ACCENTS,
  type AccentName,
  currentTheme,
  getAccent,
  getThemeMode,
  getThemeSchedule,
  setAccent,
  setThemeMode,
  setThemeSchedule,
  type ThemeMode,
} from '../lib/theme'
import { compressImage, downloadText, readTextFile, relativeTime } from '../lib/utils'
import { getBestFix, isNative, shareTextFile } from '../lib/native'
import {
  ensureExactAlarmPermission,
  ensureNotificationPermission,
  getDailyReminderEnabled,
  sendTestNotification,
  setDailyReminderEnabled,
} from '../lib/reminder'
import {
  deleteAvatar,
  getAccountMe,
  getCloudConfig,
  getStorageInfo,
  isSignedIn,
  listAccountDevices,
  revokeAccountDevice,
  saveCloudConfig,
  updateAccountProfile,
  uploadAvatar,
  type AccountDevice,
  type AccountInfo,
  type CloudConfig,
  type StorageInfo,
} from '../lib/cloud'
import {
  listTrash,
  purgeTrashEntry,
  restoreTrashEntry,
  type TrashEntry,
} from '../lib/repo'
import { scheduleAutoSync } from '../lib/sync-engine'
import { countPendingImages } from '../lib/photo-sync'
import {
  getActiveAIJobs,
  getAIJobs,
  getUnreadAIJobs,
  subscribeAIJobs,
  type AIJob,
} from '../lib/ai-jobs'
import { openOnboarding } from '../lib/onboarding'
import {
  getAutoCheckinSettings,
  getAutoCheckinStatus,
  setAutoCheckinSettings,
  startAutoCheckin,
  stopAutoCheckin,
} from '../lib/autocheckin'
import { cn } from '../lib/cn'
import { Avatar, ConfirmDialog, Field, Sheet, StatTile } from '../components/ui'

const EMPTY_STATS: AppStats = {
  tripCount: 0,
  momentCount: 0,
  footprintCount: 0,
  expenseCount: 0,
  cityCount: 0,
  pendingSync: 0,
  totalCny: 0,
  totalDays: 0,
  photoCount: 0,
  planCount: 0,
  planDoneCount: 0,
}

export function ProfilePage({ embedded = false }: { embedded?: boolean }) {
  const nav = useNav()
  const toast = useToast()
  const { bump } = useRefresh()
  const { t, tr, lang, setLang } = useI18n()
  const fileRef = useRef<HTMLInputElement>(null)
  const avatarRef = useRef<HTMLInputElement>(null)

  const loader = useCallback(async () => {
    const [profile, stat] = await Promise.all([getProfile(), stats()])
    return { profile, stats: stat }
  }, [])
  const { data, loading } = useLoader(loader, { profile: null as Profile | null, stats: EMPTY_STATS }, 'profile')

  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => getThemeMode())
  const [theme, setTheme] = useState<'light' | 'dark'>(() => currentTheme())
  const [themeSchedule, setThemeScheduleState] = useState(() => getThemeSchedule())
  const [settingsQuery, setSettingsQuery] = useState('')
  const [trashOpen, setTrashOpen] = useState(false)
  const [trashItems, setTrashItems] = useState<TrashEntry[]>([])
  const [accent, setAccentState] = useState<AccentName>(() => getAccent())
  const [editing, setEditing] = useState(false)
  const [nickname, setNickname] = useState('')
  const [email, setEmail] = useState('')
  const [account, setAccount] = useState<AccountInfo | null>(null)
  const [devicesOpen, setDevicesOpen] = useState(false)
  const [devices, setDevices] = useState<AccountDevice[]>([])
  const [devicesBusy, setDevicesBusy] = useState(false)
  const [confirmRevokeAll, setConfirmRevokeAll] = useState(false)
  // 中文输入法下 React state 可能滞后，保存时以输入框实际值为准
  const nicknameRef = useRef<HTMLInputElement>(null)
  const [autoCheckin, setAutoCheckin] = useState(() => getAutoCheckinSettings())
  const [checkinStatus, setCheckinStatus] = useState(() => getAutoCheckinStatus())
  const [cloudConfig, setCloudConfig] = useState<CloudConfig>(() => getCloudConfig())
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null)
  const [pendingImages, setPendingImages] = useState(0)
  const signedIn = Boolean(cloudConfig.token)
  const [importing, setImporting] = useState(false)
  const [aiJobs, setAIJobs] = useState<AIJob[]>(() => getAIJobs())
  const [guestTools, setGuestTools] = useState(false)
  const [dailyReminder, setDailyReminder] = useState(() => getDailyReminderEnabled())
  const [notifyBusy, setNotifyBusy] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [syncBusy, setSyncBusy] = useState(false)
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null)
  const [lastBackupAt, setLastBackupAt] = useState(() =>
    Number(localStorage.getItem('travelog.lastBackupAt') || 0),
  )

  useEffect(() => {
    if (data.profile) setNickname(data.profile.nickname)
  }, [data.profile])

  useEffect(() => subscribeAIJobs(setAIJobs), [])

  useEffect(() => {
    const onCloud = () => setCloudConfig(getCloudConfig())
    window.addEventListener('travelog:cloud-changed', onCloud)
    return () => window.removeEventListener('travelog:cloud-changed', onCloud)
  }, [])

  // 账号资料（邮箱 / 密码状态 / 设备数）与登录设备
  useEffect(() => {
    if (!signedIn) {
      setAccount(null)
      setDevices([])
      return
    }
    let active = true
    const loadAccount = async (attempt = 0) => {
      try {
        const info = await getAccountMe()
        if (!active) return
        setAccount(info)
        setEmail(info.email || '')
        setCloudConfig(getCloudConfig())
      } catch {
        // 弱网下首次读取可能超时，稍后自动重试
        if (active && attempt < 2) window.setTimeout(() => void loadAccount(attempt + 1), 1500)
      }
    }
    void loadAccount()
    return () => {
      active = false
    }
  }, [signedIn])

  const openDevices = async () => {
    setDevicesOpen(true)
    setDevicesBusy(true)
    try {
      const result = await listAccountDevices()
      setDevices(result.devices)
    } catch (error) {
      toast(`读取登录设备失败：${error instanceof Error ? error.message : '请稍后重试'}`)
    } finally {
      setDevicesBusy(false)
    }
  }

  const revokeDevice = async (device: AccountDevice) => {
    setDevicesBusy(true)
    try {
      await revokeAccountDevice(device.id)
      setDevices((list) => list.filter((item) => item.id !== device.id))
      setAccount((prev) => (prev ? { ...prev, deviceCount: Math.max(0, prev.deviceCount - 1) } : prev))
      toast(`已让「${device.name}」下线`)
    } catch (error) {
      toast(`操作失败：${error instanceof Error ? error.message : '请稍后重试'}`)
    } finally {
      setDevicesBusy(false)
    }
  }

  const revokeOtherDevices = async () => {
    const others = devices.filter((device) => !device.current)
    if (others.length === 0) {
      setConfirmRevokeAll(false)
      return
    }
    setDevicesBusy(true)
    try {
      await Promise.all(others.map((device) => revokeAccountDevice(device.id)))
      setDevices((list) => list.filter((device) => device.current))
      setAccount((prev) => (prev ? { ...prev, deviceCount: 1 } : prev))
      toast(tr('已退出其他设备'))
    } catch (error) {
      toast(`操作失败：${error instanceof Error ? error.message : '请稍后重试'}`)
    } finally {
      setDevicesBusy(false)
      setConfirmRevokeAll(false)
    }
  }

  // 云存储占用：进入页面、同步完成后刷新，方便随时看到 R2 用量
  useEffect(() => {
    if (!signedIn) {
      setStorageInfo(null)
      return
    }
    let alive = true
    const refresh = () => {
      getStorageInfo()
        .then((info) => {
          if (alive) setStorageInfo(info)
        })
        .catch(() => undefined)
      countPendingImages()
        .then((count) => {
          if (alive) setPendingImages(count)
        })
        .catch(() => undefined)
    }
    refresh()
    window.addEventListener('travelog:sync-done', refresh)
    return () => {
      alive = false
      window.removeEventListener('travelog:sync-done', refresh)
    }
  }, [signedIn])

  useEffect(() => {
    navigator.storage
      ?.estimate?.()
      .then((info) => setStorage({ usage: info.usage ?? 0, quota: info.quota ?? 0 }))
      .catch(() => undefined)
  }, [])

  const aiActive = getActiveAIJobs(aiJobs)
  const aiUnread = getUnreadAIJobs(aiJobs)

  // 开启后每 2 秒刷新一次诊断信息，方便确认到底卡在定位还是匹配
  useEffect(() => {
    setCheckinStatus(getAutoCheckinStatus())
    if (!autoCheckin.enabled) return
    const timer = window.setInterval(() => setCheckinStatus(getAutoCheckinStatus()), 2000)
    return () => window.clearInterval(timer)
  }, [autoCheckin.enabled])

  const toggleAutoCheckin = () => {
    const next = setAutoCheckinSettings({ enabled: !autoCheckin.enabled })
    setAutoCheckin(next)
    if (next.enabled) {
      startAutoCheckin((event) => {
        if (event.type === 'checked') {
          toast(`已在「${event.place ?? '这里'}」自动打卡`)
          bump()
        } else if (event.type === 'error') {
          toast(event.message ?? '定位失败')
        }
      })
      toast('已开启自动打卡，请保持定位权限')
    } else {
      stopAutoCheckin()
      toast('已关闭自动打卡')
    }
  }

  const cycleRadius = () => {
    const order = [100, 200, 500]
    const index = order.indexOf(autoCheckin.radius)
    const next = setAutoCheckinSettings({ radius: order[(index + 1) % order.length] })
    setAutoCheckin(next)
  }

  const chooseThemeMode = (mode: ThemeMode) => {
    setThemeMode(mode)
    setThemeModeState(mode)
    setTheme(currentTheme())
  }

  const changeSchedule = (patch: { start?: string; end?: string }) => {
    setThemeSchedule(patch)
    setThemeScheduleState((prev) => ({ ...prev, ...patch }))
    setTheme(currentTheme())
  }

  useEffect(() => {
    void listTrash().then(setTrashItems)
  }, [])

  useEffect(() => {
    const onThemeChanged = (event: Event) => {
      const detail = (event as CustomEvent).detail
      setTheme(detail === 'dark' ? 'dark' : 'light')
      setThemeModeState(getThemeMode())
    }
    window.addEventListener('travelog:theme-changed', onThemeChanged)
    return () => window.removeEventListener('travelog:theme-changed', onThemeChanged)
  }, [])

  const chooseAccent = (value: AccentName) => {
    setAccent(value)
    setAccentState(value)
  }

  const saveNickname = async () => {
    // 以输入框实际值为准：中文输入法下 state 可能还停留在旧值
    const name = (nicknameRef.current?.value ?? nickname).trim()
    if (!name) {
      toast('昵称不能为空')
      return
    }
    if (name.length > 24) {
      toast('昵称最多 24 个字符')
      return
    }
    const nextEmail = email.trim()
    if (nextEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(nextEmail)) {
      toast('邮箱格式不正确')
      return
    }
    try {
      const base: Profile =
        data.profile ?? { id: 'local-user', nickname: name, avatar: '', createdAt: Date.now() }
      await saveProfile({ ...base, nickname: name })
      setNickname(name)
      setEditing(false)
      bump()
      if (isSignedIn()) {
        try {
          const saved = await updateAccountProfile({ nickname: name, email: nextEmail })
          setAccount((prev) =>
            prev ? { ...prev, nickname: saved.nickname, email: saved.email } : prev,
          )
          toast(saved.email ? '昵称与邮箱已同步到云端' : '昵称已更新并同步到云端')
        } catch (error) {
          saveCloudConfig({ nickname: name })
          toast(`昵称已保存到本机，云端同步失败：${error instanceof Error ? error.message : '请稍后重试'}`)
        }
      } else {
        toast('昵称已更新；登录「云同步」后可同步到云端')
      }
    } catch (error) {
      toast(`保存失败：${error instanceof Error ? error.message : '请稍后重试'}`)
    }
  }

  const openEdit = () => {
    setNickname(data.profile?.nickname || '')
    setEmail(account?.email || cloudConfig.email || '')
    setEditing(true)
  }

  const pickAvatar = async (file: File | undefined) => {
    if (!file) return
    setAvatarBusy(true)
    try {
      // 头像按 256px 压缩，控制 R2 用量；仍保留本地副本防止上传失败后丢图
      const dataUrl = await compressImage(file, 256, 0.85)
      const base: Profile =
        data.profile ?? {
          id: 'local-user',
          nickname: (nicknameRef.current?.value ?? nickname).trim() || '旅人',
          avatar: '',
          createdAt: Date.now(),
        }
      let avatar = dataUrl
      let uploaded = false
      if (isSignedIn() && navigator.onLine) {
        try {
          const result = await uploadAvatar(dataUrl)
          avatar = result.url
          uploaded = true
        } catch {
          // 上传失败就把 data URL 存在本地，自动同步会继续重试
        }
      }
      await saveProfile({ ...base, avatar })
      bump()
      scheduleAutoSync(500)
      toast(uploaded ? '头像已上传到云端' : '头像已保存到本机，联网后自动上传')
    } catch {
      toast('图片处理失败，换一张试试')
    } finally {
      setAvatarBusy(false)
      if (avatarRef.current) avatarRef.current.value = ''
    }
  }

  const clearAvatar = async () => {
    const base = data.profile
    if (!base) return
    const wasRemote = /^https?:\/\//i.test(base.avatar ?? '')
    await saveProfile({ ...base, avatar: '' })
    if (wasRemote && isSignedIn() && navigator.onLine) {
      void deleteAvatar().catch(() => undefined)
    }
    bump()
    scheduleAutoSync(500)
    toast('已移除头像')
  }

  const doExport = async () => {
    const json = await exportAll()
    const name = `travelog-backup-${new Date().toISOString().slice(0, 10)}.json`
    const shared = await shareTextFile(name, json)
    if (!shared) downloadText(name, json, 'application/json')
    const at = Date.now()
    localStorage.setItem('travelog.lastBackupAt', String(at))
    setLastBackupAt(at)
    toast(shared ? `备份已交给系统保存：${name}` : '备份已导出到浏览器下载目录')
  }

  const doImport = async (file: File | undefined) => {
    if (!file) return
    setImporting(true)
    try {
      const text = await readTextFile(file)
      const summary = await importAll(text)
      bump()
      toast(`已导入 ${summary.trips} 段旅程、${summary.moments} 条记录`)
    } catch {
      toast('导入失败：不是有效的旅记备份')
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }


  const setHomeLocation = async () => {
    const fix = isNative()
      ? await getBestFix()
      : await new Promise<{ latitude: number; longitude: number } | null>((resolve) => {
          if (!navigator.geolocation) return resolve(null)
          navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
            () => resolve(null),
          )
        })
    if (!fix) {
      toast('定位失败，稍后再试')
      return
    }
    const next = setAutoCheckinSettings({
      homeLat: fix.latitude,
      homeLng: fix.longitude,
      homeRadius: 500,
    })
    setAutoCheckin(next)
    toast('已设为常驻地，附近 500 米不再自动打卡')
  }

  const requestNotification = async () => {
    const granted = await ensureNotificationPermission()
    if (!granted) {
      toast('未获得通知权限，请在系统设置里开启')
      return
    }
    const exact = await ensureExactAlarmPermission()
    toast(
      exact ? '已获得通知权限，日程提醒会正常发出' : '通知已开启；精确提醒未授权，系统可能延迟送达',
    )
  }

  const sendTestNotify = async () => {
    if (notifyBusy) return
    setNotifyBusy(true)
    try {
      const granted = await ensureNotificationPermission()
      if (!granted) {
        toast(tr('未获得通知权限，请在系统设置里开启'))
        return
      }
      const sent = await sendTestNotification()
      toast(sent ? tr('测试通知已发出') : tr('发送失败，请检查通知权限'))
    } finally {
      setNotifyBusy(false)
    }
  }

  const toggleDailyReminder = async () => {
    if (!isNative()) {
      toast(tr('仅手机端可用'))
      return
    }
    if (notifyBusy) return
    const next = !dailyReminder
    setNotifyBusy(true)
    try {
      if (next) {
        const granted = await ensureNotificationPermission()
        if (!granted) {
          toast(tr('未获得通知权限，请在系统设置里开启'))
          return
        }
      }
      const ok = await setDailyReminderEnabled(next)
      if (!ok) {
        toast(tr('设置失败，请检查通知权限'))
        return
      }
      setDailyReminder(next)
      toast(next ? tr('已开启每日 08:00 行程提醒') : tr('已关闭每日行程提醒'))
    } finally {
      setNotifyBusy(false)
    }
  }

  const profile = data.profile
  const ThemeGlyph = theme === 'dark' ? Moon : Sun

  const memberActive = cloudConfig.membershipExpiresAt > Date.now()
  const pendingSync = data.stats.pendingSync
  const autoSummary = autoCheckin.enabled
    ? `已开启 · 半径 ${autoCheckin.radius}m`
    : '进入常去地点附近自动补足迹'
  const themeModeLabel =
    themeMode === 'light'
      ? '浅色'
      : themeMode === 'dark'
        ? '深色'
        : themeMode === 'system'
          ? '跟随系统'
          : '定时切换'
  const appearanceSummary = `${themeModeLabel} · ${lang === 'zh' ? '中文' : 'English'}`
  const backupSummary = lastBackupAt
    ? `上次备份 ${new Date(lastBackupAt).toLocaleDateString('zh-CN')}`
    : '导出 / 导入 JSON 备份'
  const settingsSearch = (
    <div className="relative px-4 py-3">
      <MagnifyingGlass
        size={15}
        className="pointer-events-none absolute left-7 top-1/2 -translate-y-1/2 text-ink-3"
      />
      <input
        value={settingsQuery}
        onChange={(event) => setSettingsQuery(event.target.value)}
        placeholder={tr('搜索设置')}
        className="w-full rounded-xl border border-line bg-paper py-2 pl-9 pr-3 text-body-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
      />
    </div>
  )
  const syncSummary = cloudConfig.autoSync
    ? cloudConfig.syncIntervalMinutes === 0
      ? `实时同步${cloudConfig.wifiOnly ? ' · 仅 Wi-Fi' : ''}`
      : `自动 · 每 ${cloudConfig.syncIntervalMinutes} 分钟${cloudConfig.wifiOnly ? ' · 仅 Wi-Fi' : ''}`
    : '仅手动同步'

  const patchCloud = (patch: Partial<CloudConfig>) => setCloudConfig(saveCloudConfig(patch))

  const cloudStorageBytes = (storageInfo?.photos.bytes ?? 0) + (storageInfo?.avatar?.size ?? 0)

  const syncGroup = (
    <SettingsGroup
      icon={<CloudCheck size={17} />}
      title={tr('云同步与存储')}
      summary={syncSummary}
    >
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-body-sm text-ink">自动同步</p>
            <p className="mt-0.5 text-caption leading-4 text-ink-3">
              默认实时：修改后立即同步，前台每约 20 秒检查一次云端更新。
            </p>
          </div>
          <button
            type="button"
            onClick={() => patchCloud({ autoSync: !cloudConfig.autoSync })}
            aria-pressed={cloudConfig.autoSync}
            className={cn(
              'press relative h-6 w-11 shrink-0 rounded-full transition-colors',
              cloudConfig.autoSync ? 'bg-accent' : 'bg-paper-2',
            )}
          >
            <span
              className={cn(
                'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all',
                cloudConfig.autoSync ? 'left-[22px]' : 'left-0.5',
              )}
            />
          </button>
        </div>

        {cloudConfig.autoSync ? (
          <>
            <div>
              <p className="text-caption text-ink-3">同步间隔</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {[0, 1, 5, 15, 30].map((minutes) => (
                  <button
                    key={minutes}
                    type="button"
                    className={cn(
                      'chip px-2.5 py-1 text-caption',
                      cloudConfig.syncIntervalMinutes === minutes && 'chip-active',
                    )}
                    onClick={() => patchCloud({ syncIntervalMinutes: minutes })}
                  >
                    {minutes === 0 ? '实时' : `${minutes} 分钟`}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-body-sm text-ink">仅 Wi-Fi 同步</p>
                <p className="mt-0.5 text-caption leading-4 text-ink-3">
                  移动数据下不自动上传照片，节省流量。
                </p>
              </div>
              <button
                type="button"
                onClick={() => patchCloud({ wifiOnly: !cloudConfig.wifiOnly })}
                aria-pressed={cloudConfig.wifiOnly}
                className={cn(
                  'press relative h-6 w-11 shrink-0 rounded-full transition-colors',
                  cloudConfig.wifiOnly ? 'bg-accent' : 'bg-paper-2',
                )}
              >
                <span
                  className={cn(
                    'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all',
                    cloudConfig.wifiOnly ? 'left-[22px]' : 'left-0.5',
                  )}
                />
              </button>
            </div>
          </>
        ) : null}

        <div className="rounded-xl bg-paper-2/60 p-3 text-caption leading-5 text-ink-3">
          <p>
            云照片 {storageInfo?.photos.count ?? 0} 张 · {formatBytes(storageInfo?.photos.bytes ?? 0)}
            {storageInfo?.avatar ? ` · 头像 ${formatBytes(storageInfo.avatar.size)}` : ''}
          </p>
          <p>云存储合计 {formatBytes(cloudStorageBytes)}</p>
          {pendingImages > 0 ? (
            <p className="text-accent">还有 {pendingImages} 张图片等待上传</p>
          ) : null}
          <p>
            上次同步：{cloudConfig.lastSyncAt > 0 ? relativeTime(cloudConfig.lastSyncAt) : '从未'}
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className="chip px-2.5 py-1 text-caption"
            onClick={() => nav.navigate({ name: 'cloud' })}
          >
            管理云相册
          </button>
          <button
            type="button"
            className="chip px-2.5 py-1 text-caption"
            onClick={() => nav.navigate({ name: 'sync' })}
          >
            账号与服务器
          </button>
          <button
            type="button"
            disabled={syncBusy}
            className="chip px-2.5 py-1 text-caption disabled:opacity-60"
            onClick={async () => {
              if (syncBusy) return
              setSyncBusy(true)
              try {
                const result = await runSync({ pullOnly: !hasPendingLocalChanges() })
                const uploaded = result.photos.uploaded
                if (result.pullOnly && result.pulled === 0) {
                  toast('已是最新，无需同步')
                } else {
                  toast(
                    `同步完成：上传 ${result.pushed}，拉取 ${result.pulled}` +
                      (uploaded > 0 ? `，图片 ${uploaded} 张` : ''),
                  )
                }
              } catch (error) {
                toast(error instanceof Error ? error.message : '同步失败')
              } finally {
                setSyncBusy(false)
              }
            }}
          >
            {syncBusy ? '同步中…' : '立即同步'}
          </button>
        </div>
      </div>
    </SettingsGroup>
  )

  const accountUsername = account?.username ?? cloudConfig.username
  const accountEmail = account?.email ?? cloudConfig.email
  const accountHasPassword = account?.hasPassword ?? Boolean(cloudConfig.username)

  const securityGroup = signedIn ? (
    <SettingsGroup
      icon={<ShieldCheck size={17} />}
      title={tr('账号与安全')}
      summary={accountEmail || (accountUsername ? `@${accountUsername}` : '同步码登录')}
    >
      <div className="space-y-2.5">
        <div className="rounded-xl bg-paper-2/60 p-3 text-caption leading-5 text-ink-3">
          <p>
            账号：{accountUsername ? `@${accountUsername}` : '未设置账号名'}
            {accountHasPassword ? '' : ' · 建议设置密码'}
          </p>
          <p>邮箱：{accountEmail || '未绑定'}</p>
          <p>
            密码：{accountHasPassword ? '已设置（服务端仅保存加盐哈希，无法查看原文）' : '未设置'}
          </p>
          <p>登录设备：{account ? `${account.deviceCount} 台` : '读取中…'}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className="chip px-2.5 py-1 text-caption"
            onClick={openEdit}
          >
            修改昵称 / 邮箱
          </button>
          <button
            type="button"
            className="chip px-2.5 py-1 text-caption"
            onClick={() => nav.navigate({ name: 'sync' })}
          >
            {accountHasPassword ? '修改密码' : '设置密码'}
          </button>
          <button
            type="button"
            className="chip px-2.5 py-1 text-caption"
            onClick={() => void openDevices()}
          >
            <Devices size={12} />
            登录设备
          </button>
        </div>
      </div>
    </SettingsGroup>
  ) : null

  const autoCheckinGroup = (
    <SettingsGroup
      icon={<MapPinLine size={17} />}
      title={tr('自动打卡')}
      summary={autoSummary}
    >
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-body-sm text-ink">自动记录到访地点</p>
            <p className="mt-0.5 text-caption leading-4 text-ink-3">
              开启后会在常去城市附近补一条足迹，不会重复打卡。
            </p>
          </div>
          <button
            type="button"
            onClick={toggleAutoCheckin}
            aria-pressed={autoCheckin.enabled}
            className={cn(
              'press relative h-6 w-11 shrink-0 rounded-full transition-colors',
              autoCheckin.enabled ? 'bg-accent' : 'bg-paper-2',
            )}
          >
            <span
              className={cn(
                'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all',
                autoCheckin.enabled ? 'left-[22px]' : 'left-0.5',
              )}
            />
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {autoCheckin.enabled ? (
            <button type="button" className="chip px-2.5 py-1 text-caption" onClick={cycleRadius}>
              半径 {autoCheckin.radius}m
            </button>
          ) : null}
          <button type="button" className="chip px-2.5 py-1 text-caption" onClick={setHomeLocation}>
            {autoCheckin.homeLat != null ? '重新设置常驻地' : '把当前位置设为常驻地'}
          </button>
          <button type="button" className="chip px-2.5 py-1 text-caption" onClick={requestNotification}>
            通知权限
          </button>
        </div>
        {autoCheckin.enabled ? (
          <div className="rounded-xl bg-paper-2/60 p-3 text-caption leading-4 text-ink-3">
            <p>
              {checkinStatus.running ? '监听中' : '未启动'}
              {checkinStatus.lastFixAt > 0
                ? ` · 最近定位 ${new Date(checkinStatus.lastFixAt).toLocaleTimeString()}`
                : ' · 还没拿到定位（检查系统定位权限 / GPS 是否开启）'}
            </p>
            {checkinStatus.lastMatch ? <p>匹配：{checkinStatus.lastMatch}</p> : null}
            {checkinStatus.lastEvent ? <p>最近：{checkinStatus.lastEvent}</p> : null}
            <p className="pt-0.5">半径 {autoCheckin.radius}m · 无已知地点时按最近城市/区县补足迹</p>
          </div>
        ) : null}
      </div>
    </SettingsGroup>
  )

  const notificationGroup = (
    <SettingsGroup
      icon={<BellSimple size={17} />}
      title={tr('通知')}
      summary={dailyReminder ? tr('每日 08:00 行程提醒') : tr('测试通知与每日提醒')}
    >
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-body-sm text-ink">{tr('发送测试通知')}</p>
            <p className="mt-0.5 text-caption leading-4 text-ink-3">
              {tr('立刻发一条，确认系统通知能正常弹出。')}
            </p>
          </div>
          <button
            type="button"
            className="chip shrink-0 px-2.5 py-1 text-caption"
            disabled={notifyBusy}
            onClick={() => void sendTestNotify()}
          >
            {notifyBusy ? tr('发送中…') : tr('发送')}
          </button>
        </div>

        {isNative() ? (
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-body-sm text-ink">{tr('每日行程提醒')}</p>
              <p className="mt-0.5 text-caption leading-4 text-ink-3">
                {tr('每天 08:00 提醒当天安排、待办与天气。')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void toggleDailyReminder()}
              aria-pressed={dailyReminder}
              disabled={notifyBusy}
              className={cn(
                'press relative h-6 w-11 shrink-0 rounded-full transition-colors',
                dailyReminder ? 'bg-accent' : 'bg-paper-2',
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all',
                  dailyReminder ? 'left-[22px]' : 'left-0.5',
                )}
              />
            </button>
          </div>
        ) : (
          <p className="rounded-xl bg-paper-2/60 p-3 text-caption leading-4 text-ink-3">
            {tr('每日行程提醒仅手机端可用。')}
          </p>
        )}
      </div>
    </SettingsGroup>
  )

  const appearanceGroup = (
    <SettingsGroup
      icon={<PaintBrush size={17} />}
      title={tr('外观与语言')}
      summary={appearanceSummary}
    >
      <div className="border-b border-line py-3">
        <div className="flex items-center gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-paper-2 text-ink-2">
            <ThemeGlyph size={16} />
          </span>
          <span className="min-w-0 flex-1 text-body-sm text-ink">{t('profile.appearance')}</span>
          <span className="shrink-0 text-caption text-ink-3">{theme === 'dark' ? '深色' : '浅色'}</span>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {(
            [
              ['light', '浅色'],
              ['dark', '深色'],
              ['system', '跟随系统'],
              ['schedule', '定时切换'],
            ] as Array<[ThemeMode, string]>
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              aria-pressed={themeMode === mode}
              onClick={() => chooseThemeMode(mode)}
              className={cn(
                'press rounded-lg border px-1 py-1.5 text-caption transition-colors',
                themeMode === mode
                  ? 'border-accent bg-accent/10 font-medium text-accent'
                  : 'border-line text-ink-2',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {themeMode === 'schedule' ? (
          <div className="mt-2 flex items-center gap-2 text-caption text-ink-3">
            <span className="shrink-0">深色时段</span>
            <input
              type="time"
              value={themeSchedule.start}
              onChange={(event) => changeSchedule({ start: event.target.value })}
              className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-2 py-1.5 text-note text-ink"
            />
            <span className="shrink-0">至</span>
            <input
              type="time"
              value={themeSchedule.end}
              onChange={(event) => changeSchedule({ end: event.target.value })}
              className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-2 py-1.5 text-note text-ink"
            />
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-3 border-b border-line py-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-paper-2 text-ink-2">
          <PaintBrush size={15} />
        </span>
        <span className="min-w-0 flex-1 text-body-sm text-ink">主题色</span>
        <div className="flex shrink-0 gap-2">
          {ACCENTS.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-label={item.label}
              onClick={() => chooseAccent(item.value)}
              className={cn(
                'press h-6 w-6 rounded-full ring-2 ring-offset-2 ring-offset-surface transition-all',
                accent === item.value ? 'ring-ink/50' : 'ring-transparent',
              )}
              style={{ backgroundColor: item.swatch }}
            />
          ))}
        </div>
      </div>
      <Row
        icon={<Translate size={16} />}
        title={lang === 'zh' ? '语言' : 'Language'}
        value={lang === 'zh' ? '中文' : 'English'}
        onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
      />
    </SettingsGroup>
  )

  const dataGroup = (
    <SettingsGroup
      icon={<DownloadSimple size={17} />}
      title={tr('数据与备份')}
      summary={backupSummary}
    >
      <Row
        icon={<DownloadSimple size={16} />}
        title={t('profile.export')}
        value="JSON"
        onClick={doExport}
      />
      <Row
        icon={<UploadSimple size={16} />}
        title={importing ? t('common.loading') : t('profile.import')}
        value="JSON"
        onClick={() => fileRef.current?.click()}
      />
      <Row
        icon={<ClockCounterClockwise size={16} />}
        title="回收站"
        value={trashOpen ? '收起' : `${trashItems.length} 项`}
        onClick={() => {
          void (async () => {
            if (trashOpen) {
              setTrashOpen(false)
              return
            }
            setTrashItems(await listTrash())
            setTrashOpen(true)
          })()
        }}
      />
      {trashOpen ? (
        <div className="mt-1 rounded-xl border border-line bg-paper/60">
          {trashItems.length === 0 ? (
            <p className="py-6 text-center text-caption text-ink-3">回收站是空的</p>
          ) : (
            trashItems.map((item) => {
              const daysLeft = Math.max(0, Math.ceil((item.expiresAt - Date.now()) / 86_400_000))
              return (
                <div
                  key={item.id}
                  className="flex items-center gap-2 border-b border-line px-3 py-2.5 last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body-sm text-ink">
                      <span className="mr-1.5 rounded bg-paper-2 px-1.5 py-0.5 text-caption text-ink-3">
                        {item.kind === 'trip' ? '行程' : '记录'}
                      </span>
                      {item.title}
                    </p>
                    <p className="mt-0.5 text-caption text-ink-3">
                      {relativeTime(item.deletedAt)}删除 · {daysLeft} 天后自动清理
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn-ghost h-8 shrink-0 px-2 text-caption"
                    onClick={() => {
                      void (async () => {
                        await restoreTrashEntry(item.id)
                        setTrashItems(await listTrash())
                        bump()
                        toast('已恢复')
                      })()
                    }}
                  >
                    恢复
                  </button>
                  <button
                    type="button"
                    className="btn-ghost h-8 shrink-0 px-2 text-caption text-ink-3"
                    onClick={() => {
                      void (async () => {
                        await purgeTrashEntry(item.id)
                        setTrashItems(await listTrash())
                        toast('已彻底删除')
                      })()
                    }}
                  >
                    删除
                  </button>
                </div>
              )
            })
          )}
        </div>
      ) : null}
      <div className="mt-2 rounded-xl bg-paper-2/60 p-3 text-caption leading-4 text-ink-3">
        <p>
          本地占用 {storage ? formatBytes(storage.usage) : '计算中…'}
          {storage?.quota ? ` · 可用 ${formatBytes(storage.quota)}` : ''}
        </p>
        <p>
          上次备份：
          {lastBackupAt ? new Date(lastBackupAt).toLocaleString('zh-CN') : '还没有备份'}
        </p>
        {pendingSync > 0 ? <p className="text-accent">还有 {pendingSync} 条等待同步</p> : null}
      </div>
    </SettingsGroup>
  )

  const aboutGroup = (
    <SettingsGroup
      icon={<Info size={17} />}
      title={tr('关于与帮助')}
      summary={`v${__APP_VERSION__}`}
    >
      <Row
        icon={<BookOpen size={16} />}
        title={tr('新手引导')}
        value={tr('再看一遍')}
        onClick={() => openOnboarding()}
      />
      <Row
        icon={<Info size={16} />}
        title={tr('关于旅记')}
        value={`v${__APP_VERSION__}`}
        onClick={() => nav.navigate({ name: 'about' })}
      />
    </SettingsGroup>
  )

  const settingGroups = [
    { key: 'sync', title: tr('云同步与备份'), keywords: '同步 云备份 云相册 实时 wifi 备份', node: syncGroup },
    { key: 'security', title: tr('账号与安全'), keywords: '账号 密码 邮箱 设备 登录 头像 资料', node: securityGroup },
    { key: 'auto', title: tr('自动打卡'), keywords: '打卡 签到 自动 定位', node: autoCheckinGroup },
    { key: 'notify', title: tr('通知'), keywords: '通知 提醒 每日 测试 推送', node: notificationGroup },
    { key: 'appearance', title: tr('外观与语言'), keywords: '外观 主题 颜色 深色 浅色 定时 语言 字体', node: appearanceGroup },
    { key: 'data', title: tr('数据与备份'), keywords: '数据 备份 导出 导入 回收站 恢复 删除 清理 重置', node: dataGroup },
    { key: 'about', title: tr('关于与帮助'), keywords: '关于 帮助 版本 更新 开发者 github 仓库 隐私', node: aboutGroup },
  ]
  const normalizedQuery = settingsQuery.trim().toLowerCase()
  const visibleGroups = normalizedQuery
    ? settingGroups.filter((group) =>
        `${group.title} ${group.keywords}`.toLowerCase().includes(normalizedQuery),
      )
    : settingGroups

  if (!signedIn) {
    return (
      <div className="mx-auto w-full max-w-[620px] space-y-4">
        <header className="pt-4">
          <p className="text-caption uppercase tracking-[0.22em] text-ink-3">Account</p>
          <h1 className="mt-1.5 text-heading font-semibold leading-none tracking-tight text-ink sm:text-display">
            {t('profile.title')}
          </h1>
        </header>

        <section className="card overflow-hidden">
          <div className="p-5">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
              <CloudSlash size={22} />
            </span>
            <h2 className="mt-4 text-title font-semibold tracking-tight text-ink">登录或注册</h2>
            <p className="mt-1.5 text-body-sm leading-6 text-ink-3">
              登录后可以在手机、平板和网页之间同步行程、照片与账本。已有账号直接登录，第一次使用可以注册。
            </p>
          </div>
          <div className="grid gap-2 px-5 pb-5">
            <button
              type="button"
              className="btn-primary h-11 w-full"
              onClick={() => nav.navigate({ name: 'sync', mode: 'login' })}
            >
              <SignIn size={16} />
              登录已有账号
            </button>
            <button
              type="button"
              className="btn-ghost h-11 w-full"
              onClick={() => nav.navigate({ name: 'sync', mode: 'register' })}
            >
              <UserPlus size={16} />
              注册新账号
            </button>
          </div>
        </section>

        <button
          type="button"
          onClick={() => setGuestTools((open) => !open)}
          aria-expanded={guestTools}
          className="press mx-auto flex items-center gap-1 text-caption text-ink-3 hover:text-ink"
        >
          {guestTools ? '收起本地功能' : '暂不登录，使用本地功能'}
          <CaretDown
            size={12}
            className={cn('transition-transform', guestTools && 'rotate-180')}
          />
        </button>

        {guestTools ? (
          <section className="overflow-hidden rounded-2xl border border-line bg-surface">
            {settingsSearch}
            {visibleGroups
              .filter((group) => group.key !== 'sync' && group.key !== 'security')
              .map((group) => (
                <Fragment key={group.key}>{group.node}</Fragment>
              ))}
            {normalizedQuery &&
            !visibleGroups.some((group) => group.key !== 'sync' && group.key !== 'security') ? (
              <p className="px-4 py-6 text-center text-caption text-ink-3">没有匹配的设置</p>
            ) : null}
          </section>
        ) : null}

        <p className="pb-2 text-center text-caption text-ink-3">
          所有本地数据仍保存在这台设备，登录不会覆盖它。
        </p>

        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => doImport(event.target.files?.[0])}
        />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-[820px] space-y-5">
      {!embedded && (
        <header className="pt-4">
          <p className="text-caption uppercase tracking-[0.22em] text-ink-3">Account</p>
          <h1 className="mt-1.5 text-heading font-semibold leading-none tracking-tight text-ink sm:text-display">
            {t('profile.title')}
          </h1>
        </header>
      )}

      <section className="flex items-center gap-3.5 border-y border-line py-4">
        <Avatar name={profile?.nickname ?? tr('旅人')} src={profile?.avatar || undefined} size={56} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-title font-semibold tracking-tight text-ink">
            {loading ? tr('加载中…') : profile?.nickname}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption',
                memberActive ? 'bg-accent-soft text-accent' : 'bg-paper-2 text-ink-3',
              )}
            >
              {memberActive ? <Crown size={11} weight="fill" /> : null}
              {memberActive
                ? `会员至 ${new Date(cloudConfig.membershipExpiresAt).toLocaleDateString('zh-CN')}`
                : '本地账号'}
            </span>
            <span className="min-w-0 truncate text-caption text-ink-3">
              {cloudConfig.username ? `@${cloudConfig.username}` : '已连接云端'}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="btn-ghost h-9 shrink-0 px-3 text-note"
          onClick={openEdit}
        >
          <PencilSimple size={14} />
          {tr('编辑')}
        </button>
      </section>

      <div className="flex divide-x divide-line pb-1">
        <div className="min-w-0 flex-1 pr-3">
          <StatTile label={tr('旅行')} value={String(data.stats.tripCount)} />
        </div>
        <div className="min-w-0 flex-1 px-3">
          <StatTile label={tr('记录')} value={String(data.stats.momentCount)} />
        </div>
        <div className="min-w-0 flex-1 px-3">
          <StatTile label={tr('足迹')} value={String(data.stats.footprintCount)} />
        </div>
        <div className="min-w-0 flex-1 pl-3">
          <StatTile label={tr('账目')} value={String(data.stats.expenseCount)} />
        </div>
      </div>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <QuickAction
          icon={<Images size={18} />}
          title={lang === 'zh' ? '相册' : 'Album'}
          value={`${data.stats.photoCount} 张`}
          onClick={() => nav.navigate({ name: 'album' })}
        />
        <QuickAction
          icon={<CloudSlash size={18} />}
          title={t('profile.sync')}
          value={pendingSync > 0 ? `${pendingSync} 条待同步` : '已连接'}
          onClick={() => nav.navigate({ name: 'sync' })}
        />
        {aiJobs.length > 0 ? (
          <QuickAction
            icon={<Sparkle size={18} />}
            title={tr('AI 任务')}
            value={
              aiActive.length > 0
                ? tr('生成中 {n}', { n: aiActive.length })
                : aiUnread.length > 0
                  ? tr('{n} 条新结果', { n: aiUnread.length })
                  : tr('{n} 条记录', { n: aiJobs.length })
            }
            onClick={() => window.dispatchEvent(new Event('travelog:ai-open'))}
          />
        ) : (
          <QuickAction
            icon={<Crown size={18} />}
            title={tr('会员')}
            value={memberActive ? '已开通' : '未开通'}
            onClick={() => nav.navigate({ name: 'sync' })}
          />
        )}
        <QuickAction
          icon={<BookOpen size={18} />}
          title={t('profile.recap')}
          value={tr('{n} 天', { n: data.stats.totalDays })}
          onClick={() => nav.navigate({ name: 'recap' })}
        />
      </section>

      <section className="overflow-hidden rounded-2xl border border-line bg-surface">
        {settingsSearch}
        {visibleGroups.map((group) => (
          <Fragment key={group.key}>{group.node}</Fragment>
        ))}
        {normalizedQuery && visibleGroups.length === 0 ? (
          <p className="px-4 py-6 text-center text-caption text-ink-3">没有匹配的设置</p>
        ) : null}
      </section>

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => doImport(event.target.files?.[0])}
      />
      <input
        ref={avatarRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => pickAvatar(event.target.files?.[0])}
      />

      <p className="pb-2 text-center text-caption uppercase tracking-[0.18em] text-ink-3">
        Travelog · Web / Android / iOS
      </p>

      <Sheet
        open={editing}
        title="编辑资料"
        onClose={() => setEditing(false)}
        footer={
          <button type="button" className="btn-primary w-full" onClick={saveNickname}>
            保存
          </button>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Avatar name={nickname || '旅人'} src={data.profile?.avatar || undefined} size={52} />
            <div className="min-w-0 flex-1">
              <p className="text-note leading-5 text-ink-3">
                头像会压缩到 256px 后上传到 R2，其他设备同步后可见。
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  className="chip px-2.5 py-1 text-caption"
                  onClick={() => avatarRef.current?.click()}
                  disabled={avatarBusy}
                >
                  {avatarBusy ? '处理中…' : data.profile?.avatar ? '更换头像' : '上传头像'}
                </button>
                {data.profile?.avatar ? (
                  <button
                    type="button"
                    className="chip px-2.5 py-1 text-caption text-ink-3"
                    onClick={clearAvatar}
                    disabled={avatarBusy}
                  >
                    移除头像
                  </button>
                ) : null}
              </div>
            </div>
          </div>
          <Field label="昵称">
            <input
              ref={nicknameRef}
              type="text"
              inputMode="text"
              autoComplete="off"
              className="input"
              value={nickname}
              maxLength={16}
              onChange={(event) => setNickname(event.target.value)}
              placeholder="给自己起个名字"
            />
          </Field>
          {signedIn ? (
            <Field label="邮箱" hint="仅用于账号联系与找回，不会公开">
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                className="input"
                value={email}
                maxLength={120}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
              />
            </Field>
          ) : null}
        </div>
      </Sheet>

      <Sheet
        open={devicesOpen}
        title="登录设备"
        onClose={() => setDevicesOpen(false)}
        footer={
          <div className="flex gap-2">
            {devices.some((device) => !device.current) ? (
              <button
                type="button"
                className="btn-ghost flex-1 text-danger"
                disabled={devicesBusy}
                onClick={() => setConfirmRevokeAll(true)}
              >
                退出其他设备
              </button>
            ) : null}
            <button type="button" className="btn-ghost flex-1" onClick={() => setDevicesOpen(false)}>
              关闭
            </button>
          </div>
        }
      >
        <div className="space-y-2">
          <p className="text-caption leading-5 text-ink-3">
            同一账号可在多台设备同时登录。发现陌生设备时，可立即让它下线；修改密码会让全部设备重新登录。
          </p>
          {devicesBusy && devices.length === 0 ? (
            <p className="py-6 text-center text-caption text-ink-3">正在读取设备…</p>
          ) : devices.length === 0 ? (
            <p className="py-6 text-center text-caption text-ink-3">还没有其他登录设备</p>
          ) : (
            devices.map((device) => (
              <div key={device.id} className="rounded-xl border border-line p-3">
                <div className="flex items-center gap-2">
                  <Devices size={16} className="shrink-0 text-ink-3" />
                  <p className="min-w-0 flex-1 truncate text-body-sm text-ink">{device.name}</p>
                  {device.current ? (
                    <span className="shrink-0 rounded-full bg-accent-soft px-1.5 py-0.5 text-caption text-accent">
                      当前设备
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="chip px-2.5 py-1 text-caption text-danger"
                      disabled={devicesBusy}
                      onClick={() => void revokeDevice(device)}
                    >
                      下线
                    </button>
                  )}
                </div>
                <p className="mt-1 text-caption text-ink-3">
                  {device.lastSeenAt > 0
                    ? `最近活跃 ${relativeTime(device.lastSeenAt)}`
                    : `登录于 ${relativeTime(device.createdAt)}`}
                  {device.ip ? ` · ${device.ip}` : ''}
                </p>
                {device.userAgent ? (
                  <p className="mt-0.5 truncate text-caption text-ink-3" title={device.userAgent}>
                    {device.userAgent}
                  </p>
                ) : null}
              </div>
            ))
          )}
        </div>
      </Sheet>

      <ConfirmDialog
        open={confirmRevokeAll}
        title="退出其他设备"
        message="除当前设备外的所有设备都会退出登录，需要重新输入账号密码。"
        confirmText="全部退出"
        onConfirm={() => void revokeOtherDevices()}
        onClose={() => setConfirmRevokeAll(false)}
      />
    </div>
  )
}

function SettingsGroup({
  icon,
  title,
  summary,
  children,
  defaultOpen = false,
}: {
  icon: ReactNode
  title: string
  summary?: string
  children: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const wide = useWideLayout()

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const header = (
    <>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-paper-2 text-ink-2">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body text-ink">{title}</span>
        {summary ? (
          <span className="mt-0.5 block truncate text-caption text-ink-3">{summary}</span>
        ) : null}
      </span>
    </>
  )

  return (
    <>
      <div className="border-b border-line last:border-b-0">
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
          className="press flex w-full items-center gap-3 px-4 py-3.5 text-left"
        >
          {header}
          <CaretRight size={15} className="shrink-0 text-ink-3" />
        </button>
      </div>
      {open
        ? createPortal(
            wide ? (
              <div
                className="sheet-backdrop fixed inset-0 z-[70] flex items-center justify-center bg-[#0b0b0a]/35 p-6 backdrop-blur-[2px]"
                onClick={() => setOpen(false)}
              >
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-label={title}
                  className="sheet-panel flex max-h-[86vh] w-[400px] flex-col overflow-hidden rounded-[28px] border border-line bg-paper shadow-[var(--shadow-float)]"
                  onClick={(event) => event.stopPropagation()}
                >
                  <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
                    {header}
                    <button
                      type="button"
                      aria-label="关闭"
                      className="press flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-paper-2 text-ink-2"
                      onClick={() => setOpen(false)}
                    >
                      <X size={16} />
                    </button>
                  </header>
                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
                    {children}
                  </div>
                </div>
              </div>
            ) : (
              <div className="fixed inset-0 z-[70] flex flex-col bg-paper">
                <header className="safe-top flex shrink-0 items-center gap-2 border-b border-line px-3 pb-2 pt-3">
                  <button
                    type="button"
                    aria-label="返回"
                    className="press flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink"
                    onClick={() => setOpen(false)}
                  >
                    <ArrowLeft size={19} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-title">{title}</p>
                    {summary ? <p className="truncate text-caption text-ink-3">{summary}</p> : null}
                  </div>
                </header>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+28px)]">
                  {children}
                </div>
              </div>
            ),
            document.body,
          )
        : null}
    </>
  )
}

/** 屏幕够宽（平板 / 桌面）时设置项用居中的手机尺寸弹窗，否则跳转到整页。 */
function useWideLayout() {
  const [wide, setWide] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia('(min-width: 768px)').matches,
  )
  useEffect(() => {
    const query = window.matchMedia('(min-width: 768px)')
    const onChange = () => setWide(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return wide
}

function Row({
  icon,
  title,
  value,
  onClick,
}: {
  icon?: ReactNode
  title: string
  value?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="press flex w-full items-center gap-3 border-b border-line py-3 text-left last:border-b-0"
    >
      {icon ? (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-paper-2 text-ink-2">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 text-body-sm text-ink">{title}</span>
      {value ? <span className="shrink-0 text-note text-ink-3">{value}</span> : null}
      <CaretRight size={13} className="shrink-0 text-ink-3" />
    </button>
  )
}

function QuickAction({
  icon,
  title,
  value,
  onClick,
}: {
  icon: ReactNode
  title: string
  value: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="press card flex items-start gap-2.5 p-3.5 text-left"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body-sm font-medium text-ink">{title}</span>
        <span className="mt-0.5 block truncate text-caption text-ink-3">{value}</span>
      </span>
    </button>
  )
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

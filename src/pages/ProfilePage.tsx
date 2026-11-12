import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  CaretRight,
  CloudSlash,
  DownloadSimple,
  GearSix,
  Images,
  Translate,
  MapPinLine,
  Sparkle,
  Moon,
  PaintBrush,
  PencilSimple,
  Sun,
  UploadSimple,
} from '@phosphor-icons/react'
import type { AppStats, Profile } from '../lib/types'
import { exportAll, getProfile, importAll, resetAll, saveProfile, stats } from '../lib/repo'
import { useLoader } from '../lib/hooks'
import { useI18n, useNav, useRefresh, useToast } from '../lib/app-context'
import { ACCENTS, type AccentName, currentTheme, getAccent, setAccent, setThemeMode } from '../lib/theme'
import { downloadText, formatCny, readTextFile } from '../lib/utils'
import { getBestFix, isNative, shareTextFile } from '../lib/native'
import { ensureExactAlarmPermission, ensureNotificationPermission } from '../lib/reminder'
import { isSignedIn, saveCloudConfig, updateAccountNickname } from '../lib/cloud'
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

export function ProfilePage() {
  const nav = useNav()
  const toast = useToast()
  const { bump } = useRefresh()
  const { t, tr, lang, setLang } = useI18n()
  const fileRef = useRef<HTMLInputElement>(null)

  const loader = useCallback(async () => {
    const [profile, stat] = await Promise.all([getProfile(), stats()])
    return { profile, stats: stat }
  }, [])
  const { data, loading } = useLoader(loader, { profile: null as Profile | null, stats: EMPTY_STATS }, 'profile')

  const [theme, setTheme] = useState<'light' | 'dark'>(() => currentTheme())
  const [accent, setAccentState] = useState<AccentName>(() => getAccent())
  const [editing, setEditing] = useState(false)
  const [nickname, setNickname] = useState('')
  // 中文输入法下 React state 可能滞后，保存时以输入框实际值为准
  const nicknameRef = useRef<HTMLInputElement>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [autoCheckin, setAutoCheckin] = useState(() => getAutoCheckinSettings())
  const [checkinStatus, setCheckinStatus] = useState(() => getAutoCheckinStatus())
  const signedIn = isSignedIn()
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    if (data.profile) setNickname(data.profile.nickname)
  }, [data.profile])

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

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setThemeMode(next)
    setTheme(next)
  }

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
    try {
      const base: Profile =
        data.profile ?? { id: 'local-user', nickname: name, avatar: '', createdAt: Date.now() }
      await saveProfile({ ...base, nickname: name })
      setNickname(name)
      setEditing(false)
      bump()
      if (isSignedIn()) {
        try {
          await updateAccountNickname(name)
          toast('昵称已更新并同步到云端')
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

  const doReset = async () => {
    await resetAll()
    bump()
    toast('已恢复示例数据')
  }

  const doExport = async () => {
    const json = await exportAll()
    const name = `travelog-backup-${new Date().toISOString().slice(0, 10)}.json`
    const shared = await shareTextFile(name, json)
    if (!shared) downloadText(name, json, 'application/json')
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

  const profile = data.profile
  const ThemeGlyph = theme === 'dark' ? Moon : Sun
  const planRatio =
    data.stats.planCount > 0 ? Math.round((data.stats.planDoneCount / data.stats.planCount) * 100) : 0

  return (
    <div className="mx-auto w-full max-w-[820px] space-y-5">
      <header className="pt-4">
        <p className="text-caption uppercase tracking-[0.22em] text-ink-3">Account</p>
        <h1 className="mt-1.5 text-heading font-semibold leading-none tracking-tight text-ink sm:text-display">
          {t('profile.title')}
        </h1>
      </header>

      <section className="flex items-center gap-3.5 border-y border-line py-4">
        <Avatar name={profile?.nickname ?? tr('旅人')} size={56} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-title font-semibold tracking-tight text-ink">
            {loading ? tr('加载中…') : profile?.nickname}
          </p>
          <p className="mt-0.5 text-note text-ink-3">{tr('本地账号 · 数据保存在这台设备')}</p>
        </div>
        <button type="button" className="btn-ghost h-9 shrink-0 px-3 text-note" onClick={() => setEditing(true)}>
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

      <section className="card p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-note font-semibold tracking-tight text-ink">{t('profile.recap')}</h2>
          <button
            type="button"
            onClick={() => nav.navigate({ name: 'recap' })}
            className="press inline-flex items-center gap-0.5 text-caption text-accent"
          >
            {tr('查看完整')}
            <CaretRight size={12} />
          </button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-4">
          <StatTile label={tr('在路上')} value={tr('{n} 天', { n: data.stats.totalDays })} />
          <StatTile label={tr('照片')} value={tr('{n} 张', { n: data.stats.photoCount })} />
          <StatTile label={tr('城市')} value={tr('{n} 座', { n: data.stats.cityCount })} />
          <StatTile label={tr('总花费')} value={formatCny(data.stats.totalCny)} />
        </div>
        <div className="mt-3 border-t border-line pt-3">
          <div className="flex items-baseline justify-between text-note">
            <span className="text-ink-3">{tr('日程完成度')}</span>
            <span className="tabular-nums text-ink-2">
              {data.stats.planDoneCount}/{data.stats.planCount} · {planRatio}%
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-paper-2">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-500"
              style={{ width: `${planRatio}%` }}
            />
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-line bg-surface">
        <SettingRow
          icon={<Images size={17} />}
          title={lang === 'zh' ? '相册' : 'Album'}
          value={`${data.stats.photoCount} 张照片`}
          onClick={() => nav.navigate({ name: 'album' })}
        />
        <SettingRow
          icon={<CloudSlash size={17} />}
          title={t('profile.sync')}
          value={data.stats.pendingSync > 0 ? `${data.stats.pendingSync} 条待同步` : '未连接云端'}
          onClick={() => nav.navigate({ name: 'sync' })}
        />
        <SettingRow
          icon={<GearSix size={17} />}
          title={tr('管理面板')}
          value={tr('用户、AI 接口与站点设置')}
          onClick={() => nav.navigate({ name: 'admin' })}
        />
        <div className="flex w-full items-center gap-3 border-b border-line px-4 py-3.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-paper-2 text-ink-2">
            <MapPinLine size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-body text-ink">自动打卡</p>
            <p className="text-caption text-ink-3">
              {autoCheckin.enabled ? `已开启 · 半径 ${autoCheckin.radius}m（点右侧切换）` : '进入常去地点附近自动补足迹'}
            </p>
          </div>
          {autoCheckin.enabled ? (
            <button
              type="button"
              onClick={cycleRadius}
              className="press shrink-0 rounded-full border border-line px-2 py-0.5 text-caption text-ink-2"
            >
              {autoCheckin.radius}m
            </button>
          ) : null}
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
        {autoCheckin.enabled ? (
          <div className="space-y-0.5 px-4 pb-3 text-caption leading-4 text-ink-3">
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
        {/* 这两个入口不依赖自动打卡开关，始终保持可见 */}
        <div className="flex flex-wrap gap-1.5 px-4 pb-3">
          <button
            type="button"
            className="chip px-2.5 py-1 text-caption"
            onClick={async () => {
              const fix = isNative()
                ? await getBestFix()
                : await new Promise<{ latitude: number; longitude: number } | null>((resolve) => {
                    if (!navigator.geolocation) return resolve(null)
                    navigator.geolocation.getCurrentPosition(
                      (pos) =>
                        resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
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
            }}
          >
            {autoCheckin.homeLat != null ? '重新设置常驻地' : '把当前位置设为常驻地'}
          </button>
          <button
            type="button"
            className="chip px-2.5 py-1 text-caption"
            onClick={async () => {
              const granted = await ensureNotificationPermission()
              if (!granted) {
                toast('未获得通知权限，请在系统设置里开启')
                return
              }
              const exact = await ensureExactAlarmPermission()
              toast(
                exact
                  ? '已获得通知权限，日程提醒会正常发出'
                  : '通知已开启；精确提醒未授权，系统可能延迟送达',
              )
            }}
          >
            开启通知权限
          </button>
        </div>
        <SettingRow
          icon={<Sparkle size={17} />}
          title="AI 助手"
          value={signedIn ? '已就绪' : '需登录云同步'}
          onClick={() => nav.navigate({ name: 'sync' })}
        />
        <SettingRow
          icon={<ArrowClockwise size={17} />}
          title={tr('强制更新')}
          value={tr('清除缓存并重新加载')}
          onClick={async () => {
            try {
              const regs = navigator.serviceWorker ? await navigator.serviceWorker.getRegistrations() : []
              await Promise.all(regs.map((item) => item.unregister()))
              const keys = await caches.keys()
              await Promise.all(keys.map((key) => caches.delete(key)))
              toast(tr('缓存已清除，正在重新加载'))
              window.setTimeout(() => window.location.reload(), 600)
            } catch {
              window.location.reload()
            }
          }}
        />
        <SettingRow
          icon={<Translate size={17} />}
          title={lang === 'zh' ? '语言' : 'Language'}
          value={lang === 'zh' ? '中文' : 'English'}
          onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
        />
        <SettingRow
          icon={<ThemeGlyph size={17} />}
          title={t('profile.appearance')}
          value={theme === 'dark' ? '深色' : '浅色'}
          onClick={toggleTheme}
        />
        <div className="flex w-full items-center gap-3 border-b border-line px-4 py-3.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-paper-2 text-ink-2">
            <PaintBrush size={17} />
          </span>
          <span className="min-w-0 flex-1 text-body text-ink">主题色</span>
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
        <SettingRow icon={<DownloadSimple size={17} />} title={t('profile.export')} value="JSON" onClick={doExport} />
        <SettingRow
          icon={<UploadSimple size={17} />}
          title={importing ? t('common.loading') : t('profile.import')}
          value="JSON"
          onClick={() => fileRef.current?.click()}
        />
        <SettingRow
          icon={<ArrowCounterClockwise size={17} />}
          title="恢复示例数据"
          value="清空本地数据"
          onClick={() => setConfirmReset(true)}
        />
      </section>

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => doImport(event.target.files?.[0])}
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
            <Avatar name={nickname || '旅人'} size={52} />
            <p className="text-note leading-5 text-ink-3">
              头像目前用名字首字生成。
              <br />
              接入账号体系后可上传真实头像。
            </p>
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
        </div>
      </Sheet>

      <ConfirmDialog
        open={confirmReset}
        title="恢复示例数据？"
        message="本机上现有的旅行、日程、记录与账目都会被替换为最初的示例内容。建议先导出备份。"
        confirmText="恢复"
        onClose={() => setConfirmReset(false)}
        onConfirm={doReset}
      />
    </div>
  )
}

function SettingRow({
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
      className="press flex w-full items-center gap-3 border-b border-line px-4 py-3.5 text-left last:border-b-0 hover:bg-paper-2/60"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-paper-2 text-ink-2">
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-body text-ink">{title}</span>
      <span className="shrink-0 text-note text-ink-3">{value}</span>
      <CaretRight size={14} className="shrink-0 text-ink-3" />
    </button>
  )
}
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowCounterClockwise,
  CaretRight,
  CloudSlash,
  DownloadSimple,
  Images,
  Moon,
  PaintBrush,
  PencilSimple,
  Sun,
  UploadSimple,
} from '@phosphor-icons/react'
import type { AppStats, Profile } from '../lib/types'
import { exportAll, getProfile, importAll, resetAll, saveProfile, stats } from '../lib/repo'
import { useLoader } from '../lib/hooks'
import { useNav, useRefresh, useToast } from '../lib/app-context'
import { ACCENTS, type AccentName, currentTheme, getAccent, setAccent, setThemeMode } from '../lib/theme'
import { downloadText, formatCny, readTextFile } from '../lib/utils'
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
  const [confirmReset, setConfirmReset] = useState(false)
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    if (data.profile) setNickname(data.profile.nickname)
  }, [data.profile])

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
    if (!data.profile) return
    const name = nickname.trim()
    if (!name) {
      toast('昵称不能为空')
      return
    }
    await saveProfile({ ...data.profile, nickname: name })
    setEditing(false)
    bump()
    toast('资料已更新')
  }

  const doReset = async () => {
    await resetAll()
    bump()
    toast('已恢复示例数据')
  }

  const doExport = async () => {
    const json = await exportAll()
    downloadText(`travelog-backup-${new Date().toISOString().slice(0, 10)}.json`, json, 'application/json')
    toast('备份已导出')
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
          我的
        </h1>
      </header>

      <section className="flex items-center gap-3.5 border-y border-line py-4">
        <Avatar name={profile?.nickname ?? '旅人'} size={56} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-title font-semibold tracking-tight text-ink">
            {loading ? '加载中…' : profile?.nickname}
          </p>
          <p className="mt-0.5 text-note text-ink-3">本地账号 · 数据保存在这台设备</p>
        </div>
        <button type="button" className="btn-ghost h-9 shrink-0 px-3 text-note" onClick={() => setEditing(true)}>
          <PencilSimple size={14} />
          编辑
        </button>
      </section>

      <div className="flex divide-x divide-line pb-1">
        <div className="min-w-0 flex-1 pr-3">
          <StatTile label="旅行" value={String(data.stats.tripCount)} />
        </div>
        <div className="min-w-0 flex-1 px-3">
          <StatTile label="记录" value={String(data.stats.momentCount)} />
        </div>
        <div className="min-w-0 flex-1 px-3">
          <StatTile label="足迹" value={String(data.stats.footprintCount)} />
        </div>
        <div className="min-w-0 flex-1 pl-3">
          <StatTile label="账目" value={String(data.stats.expenseCount)} />
        </div>
      </div>

      <section className="card p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-note font-semibold tracking-tight text-ink">年度回顾</h2>
          <span className="text-caption text-ink-3">全部旅程累计</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-4">
          <StatTile label="在路上" value={`${data.stats.totalDays} 天`} />
          <StatTile label="照片" value={`${data.stats.photoCount} 张`} />
          <StatTile label="城市" value={`${data.stats.cityCount} 座`} />
          <StatTile label="总花费" value={formatCny(data.stats.totalCny)} />
        </div>
        <div className="mt-3 border-t border-line pt-3">
          <div className="flex items-baseline justify-between text-note">
            <span className="text-ink-3">日程完成度</span>
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
          title="相册"
          value={`${data.stats.photoCount} 张照片`}
          onClick={() => nav.navigate({ name: 'album' })}
        />
        <SettingRow
          icon={<CloudSlash size={17} />}
          title="云同步"
          value={data.stats.pendingSync > 0 ? `${data.stats.pendingSync} 条待同步` : '未连接云端'}
          onClick={() => nav.navigate({ name: 'sync' })}
        />
        <SettingRow
          icon={<ThemeGlyph size={17} />}
          title="外观"
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
        <SettingRow icon={<DownloadSimple size={17} />} title="导出备份" value="JSON" onClick={doExport} />
        <SettingRow
          icon={<UploadSimple size={17} />}
          title={importing ? '导入中…' : '导入备份'}
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
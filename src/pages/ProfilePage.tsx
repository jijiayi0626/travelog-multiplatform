import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowCounterClockwise,
  CaretRight,
  CloudSlash,
  Info,
  Moon,
  PencilSimple,
  Sun,
} from '@phosphor-icons/react'
import type { AppStats, Profile } from '../lib/types'
import { getProfile, resetAll, saveProfile, stats } from '../lib/repo'
import { useLoader } from '../lib/hooks'
import { useNav, useRefresh, useToast } from '../lib/app-context'
import { currentTheme, setThemeMode } from '../lib/theme'
import { Avatar, ConfirmDialog, Field, Sheet, StatTile } from '../components/ui'

const EMPTY_STATS: AppStats = {
  tripCount: 0,
  momentCount: 0,
  footprintCount: 0,
  expenseCount: 0,
  cityCount: 0,
  pendingSync: 0,
}

export function ProfilePage() {
  const nav = useNav()
  const toast = useToast()
  const { bump } = useRefresh()

  const loader = useCallback(async () => {
    const [profile, stat] = await Promise.all([getProfile(), stats()])
    return { profile, stats: stat }
  }, [])
  const { data, loading } = useLoader(
    loader,
    { profile: null as Profile | null, stats: EMPTY_STATS },
    'profile',
  )

  const [theme, setTheme] = useState<'light' | 'dark'>(() => currentTheme())
  const [editing, setEditing] = useState(false)
  const [nickname, setNickname] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)

  useEffect(() => {
    if (data.profile) setNickname(data.profile.nickname)
  }, [data.profile])

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setThemeMode(next)
    setTheme(next)
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

  const profile = data.profile
  const ThemeGlyph = theme === 'dark' ? Moon : Sun

  return (
    <div className="mx-auto w-full max-w-[820px] space-y-5">
      <header className="pt-4">
        <p className="text-[10.5px] uppercase tracking-[0.22em] text-ink-3">Account</p>
        <h1 className="mt-1.5 text-[27px] font-semibold leading-none tracking-tight text-ink sm:text-[32px]">
          我的
        </h1>
      </header>

      <section className="flex items-center gap-3.5 border-y border-line py-4">
        <Avatar name={profile?.nickname ?? '旅人'} size={56} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] font-semibold tracking-tight text-ink">
            {loading ? '加载中…' : profile?.nickname}
          </p>
          <p className="mt-0.5 text-[11.5px] text-ink-3">本地账号 · 数据保存在这台设备</p>
        </div>
        <button
          type="button"
          className="btn-ghost h-9 shrink-0 px-3 text-[12px]"
          onClick={() => setEditing(true)}
        >
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

      <section className="overflow-hidden rounded-2xl border border-line bg-surface">
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
        <SettingRow
          icon={<ArrowCounterClockwise size={17} />}
          title="恢复示例数据"
          value="清空本地数据"
          onClick={() => setConfirmReset(true)}
        />
        <SettingRow
          icon={<Info size={17} />}
          title="关于旅记"
          value="v1.0"
          onClick={() => toast('旅记 v1.0 · 记录旅程、图文时刻与花费')}
        />
      </section>

      <p className="pb-2 text-center text-[10.5px] uppercase tracking-[0.18em] text-ink-3">
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
            <p className="text-[12px] leading-5 text-ink-3">
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
        message="本机上现有的旅行、记录与账目都会被替换为最初的示例内容。"
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
      <span className="min-w-0 flex-1 text-[13.5px] text-ink">{title}</span>
      <span className="shrink-0 text-[11.5px] text-ink-3">{value}</span>
      <CaretRight size={14} className="shrink-0 text-ink-3" />
    </button>
  )
}
import { useCallback, useEffect, useState } from 'react'
import {
  ArrowClockwise,
  ArrowLeft,
  CheckCircle,
  MagnifyingGlass,
  SignOut,
  Sparkle,
  Trash,
} from '@phosphor-icons/react'
import { useI18n, useNav, useToast } from '../lib/app-context'
import {
  adminChangePassword,
  adminDeleteUser,
  adminGetSettings,
  adminListUsers,
  adminLogin,
  adminLogout,
  adminOverview,
  adminPatchUser,
  adminResetSyncCode,
  adminSaveSettings,
  adminTestAI,
  ApiError,
  getAdminSession,
  type AdminOverview,
  type AdminSettings,
  type AdminUser,
} from '../lib/cloud'
import { formatDateCn, relativeTime } from '../lib/utils'
import { cn } from '../lib/cn'
import {
  ConfirmDialog,
  EmptyState,
  Field,
  IconButton,
  SegmentedTabs,
  SkeletonList,
  StatTile,
} from '../components/ui'

type Tab = 'users' | 'ai' | 'site'

export function AdminPage() {
  const nav = useNav()
  const toast = useToast()
  const { tr } = useI18n()

  const [session, setSession] = useState(() => getAdminSession())
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [loggingIn, setLoggingIn] = useState(false)

  const [tab, setTab] = useState<Tab>('users')
  const [overview, setOverview] = useState<AdminOverview | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [total, setTotal] = useState(0)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [settings, setSettings] = useState<AdminSettings | null>(null)
  const [pendingDelete, setPendingDelete] = useState<AdminUser | null>(null)

  const signedIn = Boolean(session?.token)

  const handleError = (error: unknown) => {
    const message = error instanceof Error ? error.message : tr('操作失败')
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      saveSession(null)
    }
    toast(message)
  }

  const saveSession = (next: { token: string; username: string } | null) => {
    if (!next) {
      void adminLogout()
      setSession(null)
      setOverview(null)
      setUsers([])
      setSettings(null)
      return
    }
    setSession(next)
  }

  const load = useCallback(async () => {
    if (!getAdminSession()?.token) return
    setLoading(true)
    try {
      const [nextOverview, list, config] = await Promise.all([
        adminOverview(),
        adminListUsers(query.trim()),
        adminGetSettings(),
      ])
      setOverview(nextOverview)
      setUsers(list.users)
      setTotal(list.total)
      setSettings(config)
    } catch (error) {
      handleError(error)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  useEffect(() => {
    if (signedIn) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn])

  const doLogin = async () => {
    if (!username.trim() || !password) {
      toast(tr('请填写用户名和口令'))
      return
    }
    setLoggingIn(true)
    try {
      const next = await adminLogin(username.trim(), password)
      setPassword('')
      saveSession(next)
      toast(tr('登录成功'))
    } catch (error) {
      handleError(error)
    } finally {
      setLoggingIn(false)
    }
  }

  /* ---------------- 未登录 ---------------- */

  if (!signedIn) {
    return (
      <div className="pt-3">
        <div className="flex items-center gap-2.5">
          <IconButton label={tr('返回')} onClick={() => nav.back()}>
            <ArrowLeft size={18} />
          </IconButton>
          <span className="text-note text-ink-3">{tr('我的 / 管理面板')}</span>
        </div>

        <div className="mx-auto mt-8 w-full max-w-[420px] space-y-4">
          <div className="card space-y-4 p-5">
            <div>
              <h1 className="text-title font-semibold tracking-tight text-ink">{tr('管理面板')}</h1>
              <p className="mt-1 text-note leading-5 text-ink-3">
                {tr('管理用户、AI 接口与站点设置。首次登录用部署时配置的 ADMIN_USER / ADMIN_TOKEN，登录后请立即修改。')}
              </p>
            </div>
            <Field label={tr('用户名')}>
              <input
                className="input"
                value={username}
                autoComplete="username"
                onChange={(event) => setUsername(event.target.value)}
              />
            </Field>
            <Field label={tr('口令')}>
              <input
                className="input"
                type="password"
                value={password}
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void doLogin()
                }}
              />
            </Field>
            <button type="button" className="btn-primary w-full" onClick={doLogin} disabled={loggingIn}>
              {loggingIn ? tr('登录中…') : tr('登录')}
            </button>
          </div>
          <p className="px-1 text-center text-caption leading-4 text-ink-3">
            {tr('管理接口只在部署后的线上环境可用。')}
          </p>
        </div>
      </div>
    )
  }

  /* ---------------- 已登录 ---------------- */

  return (
    <div className="pt-3">
      <div className="flex items-center gap-2.5">
        <IconButton label={tr('返回')} onClick={() => nav.back()}>
          <ArrowLeft size={18} />
        </IconButton>
        <span className="min-w-0 truncate text-note text-ink-3">
          {tr('我的 / 管理面板')}
          <span className="text-ink-2"> · {session?.username}</span>
        </span>
        <button
          type="button"
          className="press ml-auto flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-line px-2.5 text-caption text-ink-2 hover:text-ink"
          onClick={() => {
            saveSession(null)
            toast(tr('已退出管理面板'))
          }}
        >
          <SignOut size={13} />
          {tr('退出')}
        </button>
        <button
          type="button"
          aria-label={tr('刷新')}
          className="press flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line text-ink-2 hover:text-ink"
          onClick={() => void load()}
        >
          <ArrowClockwise size={14} />
        </button>
      </div>

      <div className="mx-auto mt-4 w-full max-w-[860px] space-y-4 pb-6">
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="card p-3.5">
            <StatTile label={tr('用户')} value={String(overview?.users ?? '—')} />
          </div>
          <div className="card p-3.5">
            <StatTile label={tr('7 日活跃')} value={String(overview?.active7Days ?? '—')} />
          </div>
          <div className="card p-3.5">
            <StatTile label={tr('云端实体')} value={String(overview?.entities ?? '—')} />
          </div>
          <div className="card p-3.5">
            <StatTile
              label={tr('AI')}
              value={
                overview
                  ? overview.ai.enabled
                    ? overview.ai.provider === 'openai'
                      ? tr('OpenAI')
                      : tr('Workers AI')
                    : tr('已关闭')
                  : '—'
              }
            />
          </div>
        </section>

        <SegmentedTabs
          value={tab}
          options={[
            { value: 'users', label: tr('用户') },
            { value: 'ai', label: tr('AI 接口') },
            { value: 'site', label: tr('站点') },
          ]}
          onChange={setTab}
          className="max-w-[420px]"
        />

        {tab === 'users' ? (
          <section className="space-y-3">
            <div className="flex gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-line bg-surface px-3">
                <MagnifyingGlass size={15} className="shrink-0 text-ink-3" />
                <input
                  className="min-w-0 flex-1 bg-transparent py-2.5 text-body-sm text-ink outline-none placeholder:text-ink-3"
                  value={query}
                  placeholder={tr('搜索昵称或同步码')}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void load()
                  }}
                />
              </div>
              <button type="button" className="btn-ghost h-[42px] shrink-0 px-4 text-body-sm" onClick={() => void load()}>
                {tr('搜索')}
              </button>
            </div>

            {loading ? (
              <SkeletonList rows={3} />
            ) : users.length === 0 ? (
              <EmptyState
                icon={<MagnifyingGlass size={20} />}
                title={tr('没有匹配的用户')}
                hint={tr('换个关键词，或让用户先注册。')}
              />
            ) : (
              <div className="space-y-2">
                <p className="px-1 text-caption text-ink-3">
                  {tr('共 {n} 位用户', { n: total })}
                </p>
                {users.map((user) => (
                  <article key={user.id} className="card space-y-2.5 p-3.5">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 truncate text-body font-medium text-ink">
                          {user.nickname || tr('未命名用户')}
                          <span
                            className={cn(
                              'shrink-0 rounded-full px-1.5 py-0.5 text-caption',
                              user.status === 'active'
                                ? 'bg-accent-soft text-accent'
                                : 'bg-danger/10 text-danger',
                            )}
                          >
                            {user.status === 'active' ? tr('正常') : tr('已停用')}
                          </span>
                        </p>
                        <p className="mt-0.5 font-mono text-caption tracking-[0.14em] text-ink-3">
                          {user.syncCode}
                        </p>
                      </div>
                      <span className="shrink-0 text-caption tabular-nums text-ink-3">
                        {user.entityCount} {tr('条')}
                      </span>
                    </div>

                    <p className="text-caption text-ink-3">
                      {tr('注册 {created}', { created: formatDateCn(user.createdAt) })}
                      {' · '}
                      {user.lastSeenAt > 0
                        ? tr('最近活跃 {time}', { time: relativeTime(user.lastSeenAt) })
                        : tr('从未活跃')}
                    </p>

                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        className="chip px-2.5 py-1 text-caption"
                        onClick={async () => {
                          try {
                            await adminPatchUser(user.id, {
                              status: user.status === 'active' ? 'disabled' : 'active',
                            })
                            toast(user.status === 'active' ? tr('已停用该用户') : tr('已恢复该用户'))
                            void load()
                          } catch (error) {
                            handleError(error)
                          }
                        }}
                      >
                        {user.status === 'active' ? tr('停用') : tr('启用')}
                      </button>
                      <button
                        type="button"
                        className="chip px-2.5 py-1 text-caption"
                        onClick={async () => {
                          try {
                            const result = await adminResetSyncCode(user.id)
                            toast(tr('新同步码：{code}', { code: result.syncCode }))
                            void load()
                          } catch (error) {
                            handleError(error)
                          }
                        }}
                      >
                        {tr('重置同步码')}
                      </button>
                      <button
                        type="button"
                        className="chip px-2.5 py-1 text-caption text-danger"
                        onClick={() => setPendingDelete(user)}
                      >
                        <Trash size={12} />
                        {tr('删除')}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        ) : null}

        {tab === 'ai' && settings ? (
          <AISettings
            settings={settings}
            onSaved={() => void load()}
            onError={handleError}
          />
        ) : null}

        {tab === 'site' && settings ? (
          <SiteSettings settings={settings} onSaved={() => void load()} onError={handleError} />
        ) : null}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={tr('删除该用户？')}
        message={
          pendingDelete
            ? tr('「{name}」及其云端数据会被永久删除。', {
                name: pendingDelete.nickname || pendingDelete.syncCode,
              })
            : ''
        }
        onClose={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (!pendingDelete) return
          try {
            await adminDeleteUser(pendingDelete.id)
            toast(tr('用户已删除'))
            setPendingDelete(null)
            void load()
          } catch (error) {
            handleError(error)
          }
        }}
      />
    </div>
  )
}

function AISettings({
  settings,
  onSaved,
  onError,
}: {
  settings: AdminSettings
  onSaved: () => void
  onError: (error: unknown) => void
}) {
  const toast = useToast()
  const { tr } = useI18n()
  const [enabled, setEnabled] = useState(settings.ai.enabled)
  const [provider, setProvider] = useState<'openai' | 'workers'>(settings.ai.provider)
  const [openaiKey, setOpenaiKey] = useState('')
  const [openaiBase, setOpenaiBase] = useState(settings.ai.openaiBase)
  const [openaiModel, setOpenaiModel] = useState(settings.ai.openaiModel)
  const [workersModel, setWorkersModel] = useState(settings.ai.workersModel)
  const [temperature, setTemperature] = useState(String(settings.ai.temperature))
  const [busy, setBusy] = useState<'save' | 'test' | null>(null)
  const [sample, setSample] = useState('')

  const save = async () => {
    setBusy('save')
    try {
      await adminSaveSettings({
        ai: {
          enabled,
          provider,
          openaiBase,
          openaiModel,
          workersModel,
          temperature: Number(temperature) || 0.6,
          ...(openaiKey.trim() ? { openaiKey: openaiKey.trim() } : {}),
        },
      })
      setOpenaiKey('')
      toast(tr('AI 配置已保存'))
      onSaved()
    } catch (error) {
      onError(error)
    } finally {
      setBusy(null)
    }
  }

  const test = async () => {
    setBusy('test')
    setSample('')
    try {
      const result = await adminTestAI()
      setSample(`${result.model} · ${result.sample}`)
      toast(tr('AI 连接正常'))
    } catch (error) {
      onError(error)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="card space-y-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-body-sm font-semibold tracking-tight text-ink">
            <Sparkle size={15} className="text-accent" />
            {tr('AI 接口')}
          </h2>
          <p className="mt-0.5 text-caption leading-4 text-ink-3">
            {tr('配置保存在数据库，改完立即生效，不需要重新部署。')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEnabled((value) => !value)}
          aria-pressed={enabled}
          className={cn(
            'press relative h-6 w-11 shrink-0 rounded-full transition-colors',
            enabled ? 'bg-accent' : 'bg-paper-2',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all',
              enabled ? 'left-[22px]' : 'left-0.5',
            )}
          />
        </button>
      </div>

      <div className="space-y-1.5">
        <span className="field-label">{tr('服务来源')}</span>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className={cn('chip px-2.5 py-1 text-note', provider === 'openai' && 'chip-active')}
            onClick={() => setProvider('openai')}
          >
            {tr('OpenAI 兼容接口')}
          </button>
          <button
            type="button"
            className={cn('chip px-2.5 py-1 text-note', provider === 'workers' && 'chip-active')}
            onClick={() => setProvider('workers')}
          >
            {tr('Workers AI')}
          </button>
        </div>
      </div>

      {provider === 'openai' ? (
        <>
          <Field
            label={tr('API Key')}
            hint={
              settings.ai.hasOpenaiKey
                ? tr('已保存（{masked}），留空则不修改', { masked: settings.ai.openaiKey })
                : tr('填写你的 OpenAI 或兼容服务密钥')
            }
          >
            <input
              className="input font-mono"
              type="password"
              value={openaiKey}
              placeholder="sk-…"
              onChange={(event) => setOpenaiKey(event.target.value)}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={tr('接口地址')}>
              <input
                className="input"
                value={openaiBase}
                placeholder="https://api.openai.com/v1"
                onChange={(event) => setOpenaiBase(event.target.value)}
              />
            </Field>
            <Field label={tr('模型')}>
              <input
                className="input"
                value={openaiModel}
                placeholder="gpt-4o-mini"
                onChange={(event) => setOpenaiModel(event.target.value)}
              />
            </Field>
          </div>
        </>
      ) : (
        <Field
          label={tr('Workers AI 模型')}
          hint={
            settings.ai.workersBound
              ? tr('已绑定 Workers AI 服务')
              : tr('未绑定 Workers AI，需要在 wrangler.toml 开启 [ai]')
          }
        >
          <input
            className="input font-mono"
            value={workersModel}
            onChange={(event) => setWorkersModel(event.target.value)}
          />
        </Field>
      )}

      <Field label={tr('温度')} hint={tr('0 更稳定，1 更发散')}>
        <input
          className="input"
          inputMode="decimal"
          value={temperature}
          onChange={(event) => setTemperature(event.target.value.replace(/[^\d.]/g, ''))}
        />
      </Field>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" onClick={save} disabled={busy !== null}>
          {busy === 'save' ? tr('保存中…') : tr('保存配置')}
        </button>
        <button type="button" className="btn-ghost" onClick={test} disabled={busy !== null}>
          {busy === 'test' ? tr('测试中…') : tr('测试连接')}
        </button>
      </div>

      {sample ? (
        <p className="flex items-start gap-1.5 rounded-xl bg-accent-soft/70 px-3 py-2 text-caption leading-4 text-accent">
          <CheckCircle size={13} className="mt-0.5 shrink-0" weight="fill" />
          <span className="min-w-0 break-all">{sample}</span>
        </p>
      ) : null}
    </section>
  )
}

function SiteSettings({
  settings,
  onSaved,
  onError,
}: {
  settings: AdminSettings
  onSaved: () => void
  onError: (error: unknown) => void
}) {
  const toast = useToast()
  const { tr } = useI18n()
  const [name, setName] = useState(settings.site.name)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<'site' | 'password' | null>(null)

  return (
    <div className="space-y-3">
      <section className="card space-y-4 p-5">
        <h2 className="text-body-sm font-semibold tracking-tight text-ink">{tr('站点信息')}</h2>
        <Field label={tr('站点名称')} hint={tr('显示在管理面板和健康检查里')}>
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <button
          type="button"
          className="btn-primary"
          disabled={busy !== null}
          onClick={async () => {
            setBusy('site')
            try {
              await adminSaveSettings({ site: { name } })
              toast(tr('站点信息已保存'))
              onSaved()
            } catch (error) {
              onError(error)
            } finally {
              setBusy(null)
            }
          }}
        >
          {busy === 'site' ? tr('保存中…') : tr('保存')}
        </button>
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="text-body-sm font-semibold tracking-tight text-ink">{tr('管理员口令')}</h2>
        <p className="text-caption leading-4 text-ink-3">
          {tr('修改后当前会话会失效，需要用新口令重新登录。')}
        </p>
        <Field label={tr('新口令')} hint={tr('至少 8 位')}>
          <input
            className="input"
            type="password"
            value={password}
            autoComplete="new-password"
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <button
          type="button"
          className="btn-primary"
          disabled={busy !== null || password.length < 8}
          onClick={async () => {
            setBusy('password')
            try {
              await adminChangePassword(password)
              toast(tr('口令已更新，请重新登录'))
              setPassword('')
            } catch (error) {
              onError(error)
            } finally {
              setBusy(null)
            }
          }}
        >
          {busy === 'password' ? tr('保存中…') : tr('更新口令')}
        </button>
      </section>
    </div>
  )
}
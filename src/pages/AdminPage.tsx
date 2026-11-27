import { useCallback, useEffect, useState } from 'react'
import {
  ArrowClockwise,
  ArrowLeft,
  CheckCircle,
  Copy,
  Crown,
  Devices,
  DownloadSimple,
  Images,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  SignOut,
  Sparkle,
  Trash,
} from '@phosphor-icons/react'
import { useI18n, useNav, useToast } from '../lib/app-context'
import {
  adminChangePassword,
  adminCreateCodes,
  adminDeleteCode,
  adminDeletePhoto,
  adminDeleteUser,
  adminGetSettings,
  adminListCodes,
  adminListModels,
  adminListPhotos,
  adminListUserDevices,
  adminListUsers,
  adminLogin,
  adminLogout,
  adminOverview,
  adminPatchUser,
  adminResetSyncCode,
  adminRevokeUserDevice,
  adminSaveSettings,
  adminTestAI,
  ApiError,
  getAdminSession,
  type AccountDevice,
  type AdminAITestResult,
  type AdminCode,
  type AdminEndpoint,
  type AdminOverview,
  type AdminPhoto,
  type AdminPhotoPage,
  type AdminSettings,
  type AdminUser,
} from '../lib/cloud'
import { copyText, formatDateCn, relativeTime } from '../lib/utils'
import { cn } from '../lib/cn'
import { Lightbox } from '../components/Lightbox'
import {
  ConfirmDialog,
  EmptyState,
  Field,
  IconButton,
  SegmentedTabs,
  Sheet,
  SkeletonList,
  StatTile,
} from '../components/ui'

type Tab = 'users' | 'codes' | 'photos' | 'ai' | 'site'

export function AdminPage({ embedded = false }: { embedded?: boolean }) {
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
  const [photoQuery, setPhotoQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [settings, setSettings] = useState<AdminSettings | null>(null)
  const [pendingDelete, setPendingDelete] = useState<AdminUser | null>(null)
  const [managing, setManaging] = useState<AdminUser | null>(null)
  const [formNickname, setFormNickname] = useState('')
  const [formEmail, setFormEmail] = useState('')
  const [formUsername, setFormUsername] = useState('')
  const [formPassword, setFormPassword] = useState('')
  const [savingUser, setSavingUser] = useState(false)
  const [devices, setDevices] = useState<AccountDevice[]>([])
  const [devicesLoading, setDevicesLoading] = useState(false)

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

  const refreshDevices = async (userId: string) => {
    setDevicesLoading(true)
    try {
      const result = await adminListUserDevices(userId)
      setDevices(result.devices)
    } catch (error) {
      handleError(error)
    } finally {
      setDevicesLoading(false)
    }
  }

  const openManage = (user: AdminUser) => {
    setManaging(user)
    setFormNickname(user.nickname || '')
    setFormEmail(user.email || '')
    setFormUsername(user.username || '')
    setFormPassword('')
    setDevices([])
    void refreshDevices(user.id)
  }

  const saveManagedUser = async () => {
    if (!managing) return
    if (formPassword && formPassword.length < 6) {
      toast(tr('新密码至少 6 位'))
      return
    }
    setSavingUser(true)
    try {
      const passwordChanged = Boolean(formPassword)
      await adminPatchUser(managing.id, {
        nickname: formNickname.trim(),
        email: formEmail.trim(),
        username: formUsername.trim() || undefined,
        password: formPassword || undefined,
      })
      toast(
        passwordChanged
          ? tr('已保存，密码已重置，该用户的所有设备已下线')
          : tr('用户资料已更新'),
      )
      setManaging(null)
      setFormPassword('')
      void load()
    } catch (error) {
      handleError(error)
    } finally {
      setSavingUser(false)
    }
  }

  const revokeManagedDevice = async (device: AccountDevice) => {
    if (!managing) return
    setDevicesLoading(true)
    try {
      await adminRevokeUserDevice(managing.id, device.id)
      setDevices((list) => list.filter((item) => item.id !== device.id))
      toast(tr('已强制该设备下线'))
      void load()
    } catch (error) {
      handleError(error)
    } finally {
      setDevicesLoading(false)
    }
  }

  /* ---------------- 未登录 ---------------- */

  if (!signedIn) {
    return (
      <div className={embedded ? '' : 'pt-3'}>
        <div className="flex items-center gap-2.5">
          {!embedded && (
            <IconButton label={tr('返回')} onClick={() => nav.back()}>
              <ArrowLeft size={18} />
            </IconButton>
          )}
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
                type="text"
                inputMode="text"
                autoComplete="username"
                className="input"
                value={username}
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
    <div className={embedded ? '' : 'pt-3'}>
      <div className="flex items-center gap-2.5">
        {!embedded && (
          <IconButton label={tr('返回')} onClick={() => nav.back()}>
            <ArrowLeft size={18} />
          </IconButton>
        )}
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
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-6">
          <div className="card p-3.5">
            <StatTile label={tr('用户')} value={String(overview?.users ?? '—')} />
          </div>
          <div className="card p-3.5">
            <StatTile label={tr('会员')} value={String(overview?.members ?? '—')} />
          </div>
          <div className="card p-3.5">
            <StatTile label={tr('7 日活跃')} value={String(overview?.active7Days ?? '—')} />
          </div>
          <div className="card p-3.5">
            <StatTile label={tr('云端实体')} value={String(overview?.entities ?? '—')} />
          </div>
          <div className="card p-3.5">
            <StatTile
              label={tr('云照片')}
              value={String(overview?.photos.count ?? '—')}
              sub={overview ? formatBytes(overview.photos.bytes) : undefined}
            />
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
            { value: 'codes', label: tr('会员码 / 邀请码') },
            { value: 'photos', label: tr('照片') },
            { value: 'ai', label: tr('AI 接口') },
            { value: 'site', label: tr('站点') },
          ]}
          onChange={(next) => {
            if (next === 'photos') setPhotoQuery('')
            setTab(next)
          }}
          className="max-w-[560px]"
        />

        {tab === 'users' ? (
          <section className="space-y-3">
            <div className="flex gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-line bg-surface px-3">
                <MagnifyingGlass size={15} className="shrink-0 text-ink-3" />
                <input
                  type="search"
                  inputMode="search"
                  autoComplete="off"
                  className="min-w-0 flex-1 bg-transparent py-2.5 text-body-sm text-ink outline-none placeholder:text-ink-3"
                  value={query}
                  placeholder={tr('搜索昵称、账号或同步码')}
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
                          {user.membership.active ? (
                            <span className="shrink-0 rounded-full bg-accent-soft px-1.5 py-0.5 text-caption text-accent">
                              {tr('会员')}
                            </span>
                          ) : null}
                        </p>
                        <p className="mt-0.5 text-caption text-ink-3">
                          {user.username ? `@${user.username}` : tr('未设账号密码')}
                          <span className="mx-1.5">·</span>
                          <span className="font-mono tracking-[0.14em]">{user.syncCode}</span>
                        </p>
                        <p className="mt-0.5 text-caption text-ink-3">
                          {user.email || tr('未绑定邮箱')}
                          <span className="mx-1.5">·</span>
                          {user.hasPassword ? tr('密码已设置') : tr('未设密码')}
                          <span className="mx-1.5">·</span>
                          {tr('{n} 台设备在线', { n: user.deviceCount ?? 0 })}
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
                    <p className="text-caption text-ink-3">
                      云端 {user.entityCount} 条 · 照片 {user.photoCount} 张 ·{' '}
                      {formatBytes((user.photoBytes ?? 0) + (user.avatarBytes ?? 0))}
                    </p>
                    <p className="text-caption text-ink-3">
                      {user.membership.active
                        ? tr('会员至 {date}', { date: formatDateCn(user.membership.expiresAt) })
                        : tr('非会员')}
                      {user.lastLoginAt > 0
                        ? ` · ${tr('登录 {time}', { time: relativeTime(user.lastLoginAt) })}`
                        : ''}
                    </p>
                    {user.lastIp || user.lastUserAgent ? (
                      <p
                        className="truncate text-caption text-ink-3"
                        title={`${user.lastIp}\n${user.lastUserAgent}`}
                      >
                        {[
                          user.lastIp,
                          user.lastCountry,
                          user.lastRegion,
                          user.lastCity,
                          user.lastColo ? `CF-${user.lastColo}` : '',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                        {user.lastUserAgent ? ` · ${user.lastUserAgent}` : ''}
                      </p>
                    ) : null}

                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        className="chip px-2.5 py-1 text-caption"
                        onClick={() => openManage(user)}
                      >
                        <PencilSimple size={12} />
                        {tr('编辑资料')}
                      </button>
                      {user.photoCount > 0 ? (
                        <button
                          type="button"
                          className="chip px-2.5 py-1 text-caption"
                          onClick={() => {
                            setPhotoQuery(user.nickname || user.syncCode || user.id)
                            setTab('photos')
                          }}
                        >
                          <Images size={12} />
                          {tr('查看云照片')}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="chip px-2.5 py-1 text-caption"
                        onClick={async () => {
                          try {
                            await adminPatchUser(user.id, { membershipDays: 30 })
                            toast(tr('已赠送 30 天会员'))
                            void load()
                          } catch (error) {
                            handleError(error)
                          }
                        }}
                      >
                        <Crown size={12} />
                        {tr('+30 天会员')}
                      </button>
                      {user.membership.active ? (
                        <button
                          type="button"
                          className="chip px-2.5 py-1 text-caption"
                          onClick={async () => {
                            try {
                              await adminPatchUser(user.id, { membershipDays: 0 })
                              toast(tr('已取消会员'))
                              void load()
                            } catch (error) {
                              handleError(error)
                            }
                          }}
                        >
                          {tr('取消会员')}
                        </button>
                      ) : null}
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

        {tab === 'codes' ? (
          <CodesSettings onError={handleError} />
        ) : null}

        {tab === 'photos' ? <PhotosPanel onError={handleError} initialQuery={photoQuery} /> : null}

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

      <Sheet
        open={managing !== null}
        title={tr('编辑用户')}
        onClose={() => {
          if (!savingUser) setManaging(null)
        }}
        footer={
          <button
            type="button"
            className="btn-primary w-full"
            onClick={() => void saveManagedUser()}
            disabled={savingUser}
          >
            {savingUser ? tr('保存中…') : tr('保存修改')}
          </button>
        }
      >
        {managing ? (
          <div className="space-y-4">
            <div className="rounded-xl bg-paper-2/60 p-3 text-caption leading-5 text-ink-3">
              <p className="font-mono tracking-[0.14em] text-ink-2">{managing.syncCode}</p>
              <p className="break-all">{managing.id}</p>
            </div>
            <Field label={tr('昵称')}>
              <input
                className="input"
                type="text"
                value={formNickname}
                maxLength={24}
                onChange={(event) => setFormNickname(event.target.value)}
              />
            </Field>
            <Field label={tr('邮箱')} hint={tr('可留空；同一邮箱只能绑定一个账号')}>
              <input
                className="input"
                type="email"
                inputMode="email"
                autoComplete="off"
                value={formEmail}
                maxLength={120}
                placeholder="you@example.com"
                onChange={(event) => setFormEmail(event.target.value)}
              />
            </Field>
            <Field label={tr('账号名')} hint={tr('用于账号密码登录，2–24 位')}>
              <input
                className="input"
                type="text"
                autoComplete="off"
                value={formUsername}
                onChange={(event) => setFormUsername(event.target.value)}
              />
            </Field>
            <Field
              label={tr('重置密码')}
              hint={tr('留空则不修改。密码只保存加盐哈希，无法查看原文；重置后该用户所有设备会下线。')}
            >
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={formPassword}
                placeholder={tr('至少 6 位')}
                onChange={(event) => setFormPassword(event.target.value)}
              />
            </Field>

            <div className="space-y-2 border-t border-line pt-3">
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 text-body-sm font-medium text-ink">
                  {tr('登录设备（{n}）', { n: devices.length })}
                </p>
                <button
                  type="button"
                  className="chip px-2.5 py-1 text-caption"
                  disabled={devicesLoading}
                  onClick={() => void refreshDevices(managing.id)}
                >
                  {devicesLoading ? tr('读取中…') : tr('刷新')}
                </button>
              </div>
              {devices.length === 0 && !devicesLoading ? (
                <p className="py-2 text-caption text-ink-3">{tr('没有已登录设备')}</p>
              ) : (
                devices.map((device) => (
                  <div key={device.id} className="flex items-start gap-2 rounded-xl border border-line p-2.5">
                    <Devices size={15} className="mt-0.5 shrink-0 text-ink-3" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body-sm text-ink">{device.deviceName}</p>
                      <p className="text-caption text-ink-3">
                        {device.lastSeenAt > 0
                          ? tr('最近活跃 {time}', { time: relativeTime(device.lastSeenAt) })
                          : tr('登录于 {time}', { time: relativeTime(device.createdAt) })}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="chip shrink-0 px-2 py-1 text-caption text-danger"
                      disabled={devicesLoading}
                      onClick={() => void revokeManagedDevice(device)}
                    >
                      {tr('下线')}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : null}
      </Sheet>

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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

const PHOTO_PAGE = 60

const PHOTO_MIME_FILTERS = [
  { value: '', label: '全部' },
  { value: 'image/jpeg', label: 'JPEG' },
  { value: 'image/png', label: 'PNG' },
  { value: 'image/webp', label: 'WebP' },
] as const

function mimeExt(mime: string): string {
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  return 'jpg'
}

function PhotosPanel({
  onError,
  initialQuery = '',
}: {
  onError: (error: unknown) => void
  initialQuery?: string
}) {
  const { tr } = useI18n()
  const toast = useToast()
  const [offset, setOffset] = useState(0)
  const [query, setQuery] = useState(initialQuery)
  const [search, setSearch] = useState(initialQuery)
  const [mime, setMime] = useState('')
  const [items, setItems] = useState<AdminPhoto[]>([])
  const [summary, setSummary] = useState<AdminPhotoPage | null>(null)
  const [loading, setLoading] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [preview, setPreview] = useState<number | null>(null)
  const [pendingDelete, setPendingDelete] = useState<AdminPhoto | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [dimensions, setDimensions] = useState<Record<string, string>>({})

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(query.trim())
      setOffset(0)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [query])

  const load = useCallback(
    async (nextOffset: number) => {
      setLoading(true)
      try {
        const result = await adminListPhotos(PHOTO_PAGE, nextOffset, { q: search, mime })
        setItems(result.photos)
        setSummary(result)
        setActiveId((current) => (result.photos.some((photo) => photo.id === current) ? current : null))
      } catch (error) {
        onError(error)
      } finally {
        setLoading(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [search, mime],
  )

  useEffect(() => {
    void load(offset)
  }, [offset, load])

  const active = items.find((photo) => photo.id === activeId) ?? null
  const filtered = Boolean(search || mime)
  const previewPhotos = items.map((photo) => ({
    id: photo.id,
    src: photo.url,
    caption: `${photo.nickname || photo.username || photo.syncCode} · ${formatDateCn(photo.createdAt)} · ${formatBytes(photo.size)}`,
  }))

  const downloadPhoto = async (photo: AdminPhoto) => {
    try {
      const response = await fetch(photo.url)
      if (!response.ok) throw new Error(tr('下载失败'))
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `travelog-${photo.id}.${mimeExt(photo.mime)}`
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      onError(error)
    }
  }

  const confirmDelete = async () => {
    if (!pendingDelete || deleting) return
    setDeleting(true)
    try {
      await adminDeletePhoto(pendingDelete.id)
      toast(tr('照片已删除'))
      setPendingDelete(null)
      setActiveId(null)
      if (items.length === 1 && offset > 0) setOffset(Math.max(0, offset - PHOTO_PAGE))
      else void load(offset)
    } catch (error) {
      onError(error)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-caption text-ink-3">
          {summary
            ? filtered
              ? tr('筛选出 {n} 张 · {size}', {
                  n: summary.total,
                  size: formatBytes(summary.bytes),
                })
              : tr('共 {n} 张照片 · {size} · {users} 位用户', {
                  n: summary.allTotal,
                  size: formatBytes(summary.allBytes),
                  users: summary.users,
                })
            : tr('加载中…')}
        </p>
        <button
          type="button"
          className="press flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-line px-3 text-caption text-ink-2 hover:text-ink"
          onClick={() => void load(offset)}
          disabled={loading}
        >
          <ArrowClockwise size={13} />
          {tr('刷新')}
        </button>
      </div>

      <div className="flex items-center gap-2 rounded-full border border-line bg-surface px-3">
        <MagnifyingGlass size={14} className="shrink-0 text-ink-3" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={tr('搜索昵称、账号、同步码、照片 ID')}
          className="h-9 min-w-0 flex-1 bg-transparent text-note text-ink outline-none placeholder:text-ink-3"
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {PHOTO_MIME_FILTERS.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => {
              setMime(item.value)
              setOffset(0)
            }}
            className={cn(
              'press rounded-full border px-3 py-1 text-caption transition-colors',
              mime === item.value
                ? 'border-ink bg-ink text-paper'
                : 'border-line text-ink-2 hover:text-ink',
            )}
          >
            {item.value === '' ? tr('全部') : item.label}
          </button>
        ))}
      </div>

      {loading ? (
        <SkeletonList rows={2} />
      ) : items.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Images size={24} />}
            title={filtered ? tr('没有匹配的照片') : tr('暂无云端照片')}
            hint={filtered ? tr('换个关键词或类型再试。') : tr('用户同步照片后会出现在这里。')}
          />
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
          {items.map((photo) => (
            <button
              key={photo.id}
              type="button"
              onClick={() => setActiveId(photo.id)}
              className="press group relative aspect-square overflow-hidden rounded-xl border border-line bg-surface"
            >
              <img
                src={photo.url}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
              />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-2 pb-1.5 pt-5 text-left">
                <span className="block truncate text-[11px] font-medium text-white">
                  {photo.nickname || photo.username || photo.syncCode}
                </span>
                <span className="block truncate text-[10px] text-white/70">
                  {formatDateCn(photo.createdAt)} · {formatBytes(photo.size)}
                </span>
              </span>
              <span className="absolute right-1.5 top-1.5 rounded-full bg-black/45 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-white/85 backdrop-blur-sm">
                {mimeExt(photo.mime)}
              </span>
            </button>
          ))}
        </div>
      )}

      {summary && summary.total > PHOTO_PAGE ? (
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            className="btn-ghost h-9 px-3 text-caption"
            disabled={offset === 0 || loading}
            onClick={() => setOffset(Math.max(0, offset - PHOTO_PAGE))}
          >
            {tr('上一页')}
          </button>
          <span className="text-caption tabular-nums text-ink-3">
            {Math.floor(offset / PHOTO_PAGE) + 1} / {Math.ceil(summary.total / PHOTO_PAGE)}
          </span>
          <button
            type="button"
            className="btn-ghost h-9 px-3 text-caption"
            disabled={offset + PHOTO_PAGE >= summary.total || loading}
            onClick={() => setOffset(offset + PHOTO_PAGE)}
          >
            {tr('下一页')}
          </button>
        </div>
      ) : null}

      <Sheet
        open={active !== null}
        title={active ? active.nickname || active.username || tr('照片详情') : tr('照片详情')}
        onClose={() => setActiveId(null)}
        wide
        footer={
          active ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-ghost h-10 flex-1 px-3 text-note"
                onClick={() => {
                  const index = items.findIndex((photo) => photo.id === active.id)
                  if (index >= 0) setPreview(index)
                }}
              >
                <Images size={15} />
                {tr('查看大图')}
              </button>
              <button
                type="button"
                className="btn-ghost h-10 flex-1 px-3 text-note"
                onClick={() => void downloadPhoto(active)}
              >
                <DownloadSimple size={15} />
                {tr('下载')}
              </button>
              <button
                type="button"
                className="press flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-danger/30 px-3 text-note text-danger"
                onClick={() => setPendingDelete(active)}
              >
                <Trash size={15} />
                {tr('删除')}
              </button>
            </div>
          ) : null
        }
      >
        {active ? (
          <div className="space-y-4">
            <div className="overflow-hidden rounded-xl bg-paper-2">
              <img
                src={active.url}
                alt=""
                className="mx-auto max-h-[46vh] w-auto object-contain"
                onLoad={(event) => {
                  // 先取出尺寸再 setState：updater 延迟执行时 currentTarget 已被置空
                  const { naturalWidth, naturalHeight } = event.currentTarget
                  setDimensions((current) => ({
                    ...current,
                    [active.id]: `${naturalWidth} × ${naturalHeight}`,
                  }))
                }}
              />
            </div>

            <dl className="divide-y divide-line rounded-xl border border-line px-3">
              <PhotoDetailRow label={tr('上传者')} value={active.nickname || tr('未设置昵称')} />
              <PhotoDetailRow label={tr('账号')} value={active.username ? `@${active.username}` : tr('未设置账号')} />
              <PhotoDetailRow label={tr('同步码')} value={active.syncCode || '—'} mono />
              <PhotoDetailRow
                label={tr('照片 ID')}
                value={active.id}
                mono
                onCopy={() => {
                  void copyText(active.id)
                  toast(tr('已复制照片 ID'))
                }}
              />
              <PhotoDetailRow
                label={tr('用户 ID')}
                value={active.userId}
                mono
                onCopy={() => {
                  void copyText(active.userId)
                  toast(tr('已复制用户 ID'))
                }}
              />
              <PhotoDetailRow label={tr('类型')} value={active.mime} mono />
              <PhotoDetailRow
                label={tr('尺寸')}
                value={dimensions[active.id] ?? tr('读取中…')}
              />
              <PhotoDetailRow label={tr('大小')} value={formatBytes(active.size)} />
              <PhotoDetailRow
                label={tr('上传时间')}
                value={`${formatDateCn(active.createdAt)} · ${relativeTime(active.createdAt)}`}
              />
              <PhotoDetailRow
                label={tr('注册时间')}
                value={active.userCreatedAt ? formatDateCn(active.userCreatedAt) : '—'}
              />
            </dl>
          </div>
        ) : null}
      </Sheet>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={tr('删除这张照片？')}
        message={
          pendingDelete
            ? tr('「{id}」会从 R2 存储和数据库里永久删除，无法恢复。', { id: pendingDelete.id })
            : ''
        }
        confirmText={deleting ? tr('删除中…') : tr('删除')}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />

      {preview !== null ? (
        <Lightbox photos={previewPhotos} startIndex={preview} onClose={() => setPreview(null)} />
      ) : null}
    </section>
  )
}

function PhotoDetailRow({
  label,
  value,
  mono = false,
  onCopy,
}: {
  label: string
  value: string
  mono?: boolean
  onCopy?: () => void
}) {
  const { tr } = useI18n()
  return (
    <div className="flex items-start gap-3 py-2.5">
      <dt className="w-20 shrink-0 text-caption leading-5 text-ink-3">{label}</dt>
      <dd
        className={cn(
          'min-w-0 flex-1 break-all text-note leading-5 text-ink',
          mono && 'font-mono text-caption',
        )}
      >
        {value}
      </dd>
      {onCopy ? (
        <button
          type="button"
          className="press flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-paper-2 hover:text-ink"
          onClick={onCopy}
          aria-label={tr('复制')}
        >
          <Copy size={12} />
        </button>
      ) : null}
    </div>
  )
}

function CodesSettings({ onError }: { onError: (error: unknown) => void }) {
  const toast = useToast()
  const { tr } = useI18n()
  const [type, setType] = useState<'membership' | 'invite'>('membership')
  const [codes, setCodes] = useState<AdminCode[]>([])
  const [loading, setLoading] = useState(false)
  const [days, setDays] = useState('30')
  const [count, setCount] = useState('5')
  const [maxUses, setMaxUses] = useState('1')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<string[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await adminListCodes(type)
      setCodes(result.codes)
    } catch (error) {
      onError(error)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type])

  useEffect(() => {
    setCreated([])
    void load()
  }, [load])

  const create = async () => {
    setBusy(true)
    try {
      const result = await adminCreateCodes({
        type,
        count: Number(count) || 1,
        days: type === 'membership' ? Number(days) || 30 : undefined,
        maxUses: Number(maxUses) || 1,
        note,
      })
      setCreated(result.codes)
      toast(
        type === 'membership'
          ? tr('已生成 {n} 个会员码（每个 {d} 天）', { n: result.codes.length, d: result.days })
          : tr('已生成 {n} 个邀请码', { n: result.codes.length }),
      )
      void load()
    } catch (error) {
      onError(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card space-y-4 p-5">
      <div>
        <h2 className="flex items-center gap-1.5 text-body-sm font-semibold tracking-tight text-ink">
          <Crown size={15} className="text-accent" />
          {tr('会员码 / 注册邀请码')}
        </h2>
        <p className="mt-0.5 text-caption leading-4 text-ink-3">
          {tr('会员码由用户在「云同步 → 会员」兑换；邀请码用于开启邀请注册后的新用户注册。')}
        </p>
      </div>

      <SegmentedTabs
        value={type}
        options={[
          { value: 'membership', label: tr('会员码') },
          { value: 'invite', label: tr('注册邀请码') },
        ]}
        onChange={(value) => setType(value as 'membership' | 'invite')}
        className="max-w-[320px]"
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {type === 'membership' ? (
          <Field label={tr('天数')}>
            <input
              className="input"
              inputMode="numeric"
              value={days}
              onChange={(event) => setDays(event.target.value.replace(/\D/g, ''))}
            />
          </Field>
        ) : null}
        <Field label={tr('数量')} hint={tr('最多 50')}>
          <input
            className="input"
            inputMode="numeric"
            value={count}
            onChange={(event) => setCount(event.target.value.replace(/\D/g, ''))}
          />
        </Field>
        <Field label={tr('每码可用次数')}>
          <input
            className="input"
            inputMode="numeric"
            value={maxUses}
            onChange={(event) => setMaxUses(event.target.value.replace(/\D/g, ''))}
          />
        </Field>
        <Field label={tr('备注')}>
          <input
            className="input"
            autoComplete="off"
            value={note}
            placeholder={tr('选填')}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
      </div>

      <button type="button" className="btn-primary" onClick={create} disabled={busy}>
        <Plus size={14} weight="bold" />
        {busy ? tr('生成中…') : tr('生成')}
      </button>

      {created.length > 0 ? (
        <div className="rounded-2xl bg-accent-soft/60 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-caption font-medium text-accent">{tr('本次生成（点击复制）')}</p>
            <button
              type="button"
              className="press flex items-center gap-1 text-caption text-accent"
              onClick={async () => {
                const ok = await copyText(created.join('\n'))
                toast(ok ? tr('已复制全部') : tr('复制失败'))
              }}
            >
              <Copy size={12} />
              {tr('复制全部')}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {created.map((code) => (
              <button
                key={code}
                type="button"
                className="press rounded-lg bg-surface px-2 py-1 font-mono text-body-sm tracking-[0.14em] text-ink"
                onClick={async () => {
                  const ok = await copyText(code)
                  toast(ok ? tr('已复制 {code}', { code }) : tr('复制失败'))
                }}
              >
                {code}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="border-t border-line pt-3">
        <div className="flex items-center justify-between">
          <p className="text-caption text-ink-3">{tr('最近生成')}</p>
          {loading ? <span className="text-caption text-ink-3">{tr('加载中…')}</span> : null}
        </div>
        {codes.length === 0 && !loading ? (
          <p className="mt-2 text-note text-ink-3">{tr('还没有生成过这种码。')}</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {codes.map((item) => (
              <li key={item.code} className="flex items-center gap-2 py-2">
                <button
                  type="button"
                  className="press shrink-0 font-mono text-body-sm tracking-[0.14em] text-ink"
                  onClick={async () => {
                    const ok = await copyText(item.code)
                    toast(ok ? tr('已复制 {code}', { code: item.code }) : tr('复制失败'))
                  }}
                >
                  {item.code}
                </button>
                <span className="min-w-0 flex-1 truncate text-caption text-ink-3">
                  {item.days ? `${item.days}${tr('天')} · ` : ''}
                  {tr('已用 {used}/{max}', { used: item.usedCount, max: item.maxUses })}
                  {item.note ? ` · ${item.note}` : ''}
                  {` · ${formatDateCn(item.createdAt)}`}
                </span>
                <button
                  type="button"
                  aria-label={tr('删除')}
                  className="press shrink-0 text-ink-3 hover:text-danger"
                  onClick={async () => {
                    try {
                      await adminDeleteCode(type, item.code)
                      toast(tr('已删除'))
                      void load()
                    } catch (error) {
                      onError(error)
                    }
                  }}
                >
                  <Trash size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
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
  const [membershipRequired, setMembershipRequired] = useState(settings.ai.membershipRequired)
  const [temperature, setTemperature] = useState(String(settings.ai.temperature))
  const [drafts, setDrafts] = useState<AdminEndpoint[]>(() =>
    settings.ai.endpoints.map((item) => ({
      ...item,
      model: item.models?.length ? item.models.join(',') : item.model,
    })),
  )
  const [busy, setBusy] = useState<'save' | 'test' | 'models' | null>(null)
  const [testResults, setTestResults] = useState<AdminAITestResult[]>([])
  const [modelOptions, setModelOptions] = useState<Record<string, string[]>>({})

  const patchDraft = (id: string, patch: Partial<AdminEndpoint>) => {
    setDrafts((list) => list.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  const addEndpoint = () => {
    setDrafts((list) => [
      ...list,
      {
        id: `ep${Date.now().toString(36)}`,
        name: `接口 ${list.length + 1}`,
        type: 'openai',
        base: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        key: '',
        hasKey: false,
        weight: 1,
        enabled: true,
        usable: true,
      },
    ])
  }

  const removeEndpoint = (id: string) => {
    setDrafts((list) => list.filter((item) => item.id !== id))
  }

  const loadModels = async (id: string) => {
    setBusy('models')
    try {
      const result = await adminListModels(id)
      setModelOptions((map) => ({ ...map, [id]: result.models }))
      toast(tr('已拉取 {n} 个模型', { n: result.models.length }))
    } catch (error) {
      onError(error)
    } finally {
      setBusy(null)
    }
  }

  const save = async () => {
    setBusy('save')
    try {
      await adminSaveSettings({
        ai: {
          enabled,
          membershipRequired,
          temperature: Number(temperature) || 0.6,
          endpoints: drafts.map((item) => ({
            id: item.id,
            name: item.name,
            type: item.type,
            base: item.base,
            model: item.model,
            key: item.key,
            weight: item.weight,
            enabled: item.enabled,
          })),
        },
      })
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
    setTestResults([])
    try {
      const result = await adminTestAI()
      setTestResults(result.results)
      toast(result.ok ? tr('测试完成') : tr('全部接口都失败了'))
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

      <button
        type="button"
        onClick={() => setMembershipRequired((value) => !value)}
        aria-pressed={membershipRequired}
        className="flex w-full items-center justify-between gap-3 rounded-2xl border border-line px-3 py-2.5 text-left"
      >
        <span className="min-w-0">
          <span className="block text-body-sm font-medium text-ink">{tr('AI 需要会员')}</span>
          <span className="mt-0.5 block text-caption leading-4 text-ink-3">
            {tr('开启后，只有会员可以使用 AI；关闭则所有登录用户可用。')}
          </span>
        </span>
        <span
          className={cn(
            'relative h-6 w-11 shrink-0 rounded-full transition-colors',
            membershipRequired ? 'bg-accent' : 'bg-paper-2',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all',
              membershipRequired ? 'left-[22px]' : 'left-0.5',
            )}
          />
        </span>
      </button>

      <div className="space-y-2">
        {drafts.map((item) => (
          <div key={item.id} className="space-y-2.5 rounded-2xl border border-line p-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="text"
                autoComplete="off"
                className="input h-9 flex-1"
                value={item.name}
                onChange={(event) => patchDraft(item.id, { name: event.target.value })}
              />
              <button
                type="button"
                className={cn('chip px-2 py-1 text-caption', item.enabled && 'chip-active')}
                onClick={() => patchDraft(item.id, { enabled: !item.enabled })}
              >
                {item.enabled ? tr('启用') : tr('停用')}
              </button>
              <button
                type="button"
                className="chip px-2 py-1 text-caption text-danger"
                onClick={() => removeEndpoint(item.id)}
              >
                <Trash size={12} />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                className={cn('chip px-2 py-1 text-caption', item.type === 'openai' && 'chip-active')}
                onClick={() => patchDraft(item.id, { type: 'openai' })}
              >
                {tr('OpenAI 兼容')}
              </button>
              <button
                type="button"
                className={cn('chip px-2 py-1 text-caption', item.type === 'workers' && 'chip-active')}
                onClick={() => patchDraft(item.id, { type: 'workers' })}
              >
                {tr('Workers AI')}
              </button>
              <span className="ml-auto flex items-center gap-1 text-caption text-ink-3">
                {tr('权重')}
                <input
                  className="input h-7 w-12 px-1 text-center"
                  inputMode="numeric"
                  value={item.weight}
                  onChange={(event) =>
                    patchDraft(item.id, { weight: Number(event.target.value.replace(/\D/g, '')) || 1 })
                  }
                />
              </span>
            </div>

            {item.type === 'openai' ? (
              <>
                <input
                  className="input font-mono"
                  type="password"
                  placeholder={item.hasKey ? tr('已保存，留空则不改') : 'sk-…'}
                  value={item.key}
                  onChange={(event) => patchDraft(item.id, { key: event.target.value })}
                />
                <input
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  autoCapitalize="off"
                  className="input"
                  placeholder="https://api.openai.com/v1"
                  value={item.base}
                  onChange={(event) => patchDraft(item.id, { base: event.target.value })}
                />
              </>
            ) : null}

            <div className="flex gap-2">
              <input
                type="text"
                inputMode="text"
                autoComplete="off"
                autoCapitalize="off"
                className="input flex-1 font-mono"
                placeholder={
                  item.type === 'workers' ? '@cf/meta/llama-3.1-8b-instruct' : 'gpt-4o-mini'
                }
                value={item.model}
                onChange={(event) => patchDraft(item.id, { model: event.target.value })}
              />
              <button
                type="button"
                className="btn-ghost h-[42px] shrink-0 px-3 text-caption"
                disabled={busy !== null}
                onClick={() => void loadModels(item.id)}
              >
                {tr('拉取模型')}
              </button>
            </div>
            <p className="text-caption leading-4 text-ink-3">
              {tr('一个站点可绑定多个模型：用逗号分隔，例如 gpt-4o-mini,gpt-4o；保存后会展开成多个可对比入口。')}
            </p>
            {modelOptions[item.id]?.length ? (
              <div className="flex flex-wrap gap-1">
                {modelOptions[item.id].slice(0, 12).map((model) => {
                  const active = item.model
                    .split(/[,，\s]+/)
                    .filter(Boolean)
                    .includes(model)
                  return (
                    <button
                      key={model}
                      type="button"
                      aria-pressed={active}
                      className={cn('chip px-2 py-0.5 text-caption', active && 'chip-active')}
                      onClick={() => {
                        const current = item.model.split(/[,，\s]+/).filter(Boolean)
                        const next = active
                          ? current.filter((value) => value !== model)
                          : [...current, model].slice(0, 6)
                        patchDraft(item.id, { model: next.join(',') })
                      }}
                    >
                      {model}
                    </button>
                  )
                })}
              </div>
            ) : null}

            <div className="flex items-center gap-2 text-caption text-ink-3">
              <span className={cn('h-1.5 w-1.5 rounded-full', item.usable ? 'bg-accent' : 'bg-danger')} />
              {item.usable
                ? tr('可用')
                : item.type === 'workers'
                  ? tr('未绑定 Workers AI')
                  : tr('缺少密钥')}
            </div>
          </div>
        ))}
        <button type="button" className="btn-ghost w-full" onClick={addEndpoint}>
          <Plus size={14} weight="bold" />
          {tr('新增接口')}
        </button>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="field-label">{tr('温度')}</span>
        <input
          className="input max-w-[96px]"
          inputMode="decimal"
          value={temperature}
          onChange={(event) => setTemperature(event.target.value.replace(/[^\d.]/g, ''))}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" onClick={save} disabled={busy !== null}>
          {busy === 'save' ? tr('保存中…') : tr('保存配置')}
        </button>
        <button type="button" className="btn-ghost" onClick={test} disabled={busy !== null}>
          {busy === 'test' ? tr('测试中…') : tr('测试全部')}
        </button>
      </div>

      {testResults.length > 0 ? (
        <div className="space-y-1.5">
          {testResults.map((item) => (
            <p
              key={item.id}
              className={cn(
                'flex items-start gap-1.5 rounded-xl px-3 py-2 text-caption leading-4',
                item.ok ? 'bg-accent-soft/70 text-accent' : 'bg-danger/10 text-danger',
              )}
            >
              <CheckCircle size={13} className="mt-0.5 shrink-0" weight="fill" />
              <span className="min-w-0 break-all">
                {item.name} · {item.ok ? `${item.ms}ms · ${item.sample}` : item.error}
              </span>
            </p>
          ))}
        </div>
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
  const [inviteRequired, setInviteRequired] = useState(settings.registration.inviteRequired)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<'site' | 'invite' | 'password' | null>(null)

  return (
    <div className="space-y-3">
      <section className="card space-y-4 p-5">
        <h2 className="text-body-sm font-semibold tracking-tight text-ink">{tr('站点信息')}</h2>
        <Field label={tr('站点名称')} hint={tr('显示在管理面板和健康检查里')}>
          <input
            type="text"
            inputMode="text"
            autoComplete="off"
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
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
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-body-sm font-semibold tracking-tight text-ink">{tr('注册设置')}</h2>
            <p className="mt-0.5 text-caption leading-4 text-ink-3">
              {tr('开启后，新用户注册必须填写「会员码 / 邀请码」页生成的邀请码。')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setInviteRequired((value) => !value)}
            aria-pressed={inviteRequired}
            className={cn(
              'press relative h-6 w-11 shrink-0 rounded-full transition-colors',
              inviteRequired ? 'bg-accent' : 'bg-paper-2',
            )}
          >
            <span
              className={cn(
                'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all',
                inviteRequired ? 'left-[22px]' : 'left-0.5',
              )}
            />
          </button>
        </div>
        <button
          type="button"
          className="btn-primary"
          disabled={busy !== null}
          onClick={async () => {
            setBusy('invite')
            try {
              await adminSaveSettings({ registration: { inviteRequired } })
              toast(inviteRequired ? tr('已开启邀请注册') : tr('已关闭邀请注册'))
              onSaved()
            } catch (error) {
              onError(error)
            } finally {
              setBusy(null)
            }
          }}
        >
          {busy === 'invite' ? tr('保存中…') : tr('保存注册设置')}
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
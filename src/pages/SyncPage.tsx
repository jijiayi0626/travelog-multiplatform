import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  CheckCircle,
  CloudCheck,
  CloudSlash,
  Copy,
  CaretDown,
  Crown,
  Key,
  Plugs,
  SignIn,
  SignOut,
  UserPlus,
  ArrowsClockwise,
} from '@phosphor-icons/react'
import { useNav, useI18n, useRefresh, useToast } from '../lib/app-context'
import {
  checkHealth,
  clearCloudConfig,
  getAccountMe,
  getAuthConfig,
  getCloudConfig,
  loginCloud,
  loginWithPassword,
  logoutCloud,
  redeemMembershipCode,
  registerCloud,
  saveAccountCredentials,
  saveCloudConfig,
  type AccountInfo,
  type AuthConfig,
  type HealthInfo,
} from '../lib/cloud'
import { bootstrapAfterAuth, pullOverwrite, runSync } from '../lib/sync-engine'
import { getProfile, saveProfile } from '../lib/repo'
import { copyText, relativeTime } from '../lib/utils'
import { cn } from '../lib/cn'
import { Field, IconButton } from '../components/ui'

const ENDPOINTS = [
  { method: 'POST', path: '/api/auth/register', note: '创建账号' },
  { method: 'POST', path: '/api/auth/login', note: '账号密码 / 同步码登录' },
  { method: 'GET', path: '/api/auth/me', note: '账号资料与会员状态' },
  { method: 'POST', path: '/api/membership/redeem', note: '兑换会员码' },
  { method: 'GET', path: '/api/sync/pull', note: '游标增量拉取' },
  { method: 'POST', path: '/api/sync/push', note: 'LWW 增量推送' },
  { method: 'POST', path: '/api/ai/complete', note: 'AI 调用代理' },
]

function formatDate(ts: number): string {
  if (!ts) return ''
  return new Date(ts).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export function SyncPage({ mode, embedded = false }: { mode?: 'login' | 'register'; embedded?: boolean }) {
  const nav = useNav()
  const toast = useToast()
  const { bump } = useRefresh()
  const { tr } = useI18n()

  const [config, setConfig] = useState(() => getCloudConfig())
  const [baseUrl, setBaseUrl] = useState(config.baseUrl)
  const [health, setHealth] = useState<HealthInfo | null>(null)
  const [busy, setBusy] = useState<
    'health' | 'register' | 'login' | 'sync' | 'restore' | 'redeem' | 'credentials' | null
  >(null)
  const [confirmRestore, setConfirmRestore] = useState(false)
  const [result, setResult] = useState('')
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null)
  const [account, setAccount] = useState<AccountInfo | null>(null)

  // 注册
  const nicknameRef = useRef<HTMLInputElement>(null)
  const [regUsername, setRegUsername] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [regInvite, setRegInvite] = useState('')
  // 登录
  const [loginMode, setLoginMode] = useState<'password' | 'code'>('password')
  const [loginUsername, setLoginUsername] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [code, setCode] = useState('')
  // 老账号补设 / 修改密码
  const [credForm, setCredForm] = useState(false)
  const [credUsername, setCredUsername] = useState('')
  const [credPassword, setCredPassword] = useState('')
  const [credCurrent, setCredCurrent] = useState('')
  // 会员码
  const [memberCode, setMemberCode] = useState('')
  const [authMode, setAuthMode] = useState<'login' | 'register'>(mode === 'register' ? 'register' : 'login')
  const [showAdvanced, setShowAdvanced] = useState(false)

  useEffect(() => {
    if (mode) setAuthMode(mode)
  }, [mode])

  const signedIn = Boolean(config.token)
  const hasCredentials = Boolean(account?.username || config.username)
  const memberActive = (account?.membership.expiresAt ?? config.membershipExpiresAt) > Date.now()

  useEffect(() => {
    getAuthConfig()
      .then(setAuthConfig)
      .catch(() => setAuthConfig(null))
  }, [])

  useEffect(() => {
    if (!signedIn) {
      setAccount(null)
      return
    }
    let cancelled = false
    getAccountMe()
      .then((info) => {
        if (cancelled) return
        setAccount(info)
        setConfig(getCloudConfig())
      })
      .catch((error) => {
        if (cancelled) return
        if (error && typeof error === 'object' && 'status' in error && (error as { status: number }).status === 401) {
          clearCloudConfig()
          setConfig(getCloudConfig())
          toast(tr('登录已过期，请重新登录'))
        }
      })
    return () => {
      cancelled = true
    }
    // 只在登录状态变化时拉取账号资料；toast/tr 每次渲染都是新函数，不能放进依赖
  }, [signedIn])

  const saveBaseUrl = () => {
    const next = saveCloudConfig({ baseUrl: baseUrl.trim() })
    setConfig(next)
    setHealth(null)
    toast(tr('服务器地址已保存'))
  }

  const testConnection = async () => {
    setBusy('health')
    try {
      saveCloudConfig({ baseUrl: baseUrl.trim() })
      const info = await checkHealth()
      setHealth(info)
      toast(tr('连接正常'))
    } catch (error) {
      setHealth(null)
      toast(error instanceof Error ? error.message : tr('连接失败'))
    } finally {
      setBusy(null)
    }
  }

  const applyNickname = async (nickname: string) => {
    const localProfile = await getProfile()
    if (nickname && localProfile.nickname !== nickname) {
      await saveProfile({ ...localProfile, nickname })
      bump()
    }
  }

  /** 登录/注册成功后立刻触发一次双向同步（头像、封面、照片会一并上传） */
  const requestImmediateSync = () => {
    window.setTimeout(() => {
      window.dispatchEvent(new Event('travelog:sync-now'))
    }, 400)
  }

  /**
   * 登录/注册成功后的收尾：必须先拉云端覆盖本地，再应用昵称。
   * 否则新设备上的本地种子数据（updatedAt 最新）会把云端资料顶掉。
   */
  const finishAuth = async (nickname: string, successMessage: string) => {
    let empty = true
    try {
      const boot = await bootstrapAfterAuth()
      empty = boot.empty
    } catch (error) {
      console.warn('[sync] 首次拉取失败：', error instanceof Error ? error.message : error)
    }
    await applyNickname(nickname)
    setConfig(getCloudConfig())
    if (empty) {
      toast(successMessage)
      requestImmediateSync()
    } else {
      // 不调用 bump()：bump 会把本地重新标记为脏并触发全量推送，刚恢复完没必要
      window.dispatchEvent(new CustomEvent('travelog:sync-done', { detail: { at: Date.now() } }))
      toast(tr('已从云端恢复，正在校验本地数据…'))
      requestImmediateSync()
    }
  }

  const doRegister = async () => {
    const name = (nicknameRef.current?.value ?? '').trim()
    if (!name) {
      toast(tr('先填一个昵称'))
      return
    }
    if (!regUsername.trim() || !regPassword) {
      toast(tr('请填写账号和密码'))
      return
    }
    setBusy('register')
    try {
      saveCloudConfig({ baseUrl: baseUrl.trim() })
      const auth = await registerCloud(name, regUsername.trim(), regPassword, regInvite.trim())
      setResult(tr('账号已创建，同步码：{code}', { code: auth.syncCode }))
      await finishAuth(auth.nickname, tr('注册成功，正在同步数据…'))
    } catch (error) {
      toast(error instanceof Error ? error.message : tr('注册失败'))
    } finally {
      setBusy(null)
    }
  }

  const doLogin = async () => {
    if (loginMode === 'password') {
      if (!loginUsername.trim() || !loginPassword) {
        toast(tr('请输入账号和密码'))
        return
      }
      setBusy('login')
      try {
        saveCloudConfig({ baseUrl: baseUrl.trim() })
        const auth = await loginWithPassword(loginUsername.trim(), loginPassword)
        await finishAuth(auth.nickname, tr('登录成功，正在同步数据…'))
      } catch (error) {
        toast(error instanceof Error ? error.message : tr('登录失败'))
      } finally {
        setBusy(null)
      }
      return
    }

    if (!code.trim()) {
      toast(tr('请输入同步码'))
      return
    }
    setBusy('login')
    try {
      saveCloudConfig({ baseUrl: baseUrl.trim() })
      const auth = await loginCloud(code.trim())
      await finishAuth(
        auth.nickname,
        auth.needsCredentials ? tr('已用同步码登录，建议设置账号密码') : tr('登录成功，正在同步数据…'),
      )
    } catch (error) {
      toast(error instanceof Error ? error.message : tr('登录失败'))
    } finally {
      setBusy(null)
    }
  }

  const doSetCredentials = async () => {
    if (!credUsername.trim() || !credPassword) {
      toast(tr('请填写账号和密码'))
      return
    }
    setBusy('credentials')
    try {
      const saved = await saveAccountCredentials(
        credUsername.trim(),
        credPassword,
        hasCredentials ? credCurrent : undefined,
      )
      setConfig(getCloudConfig())
      setAccount((prev) => (prev ? { ...prev, username: saved.username, needsCredentials: false } : prev))
      setCredForm(false)
      setCredPassword('')
      setCredCurrent('')
      toast(tr('账号密码已保存'))
    } catch (error) {
      toast(error instanceof Error ? error.message : tr('保存失败'))
    } finally {
      setBusy(null)
    }
  }

  const doRedeem = async () => {
    if (!memberCode.trim()) {
      toast(tr('请输入会员码'))
      return
    }
    setBusy('redeem')
    try {
      const res = await redeemMembershipCode(memberCode.trim().toUpperCase())
      setConfig(getCloudConfig())
      setAccount((prev) => (prev ? { ...prev, membership: res.membership } : prev))
      setMemberCode('')
      toast(tr('会员已到账，增加 {n} 天', { n: res.addedDays }))
    } catch (error) {
      toast(error instanceof Error ? error.message : tr('兑换失败'))
    } finally {
      setBusy(null)
    }
  }

  const doSync = async () => {
    setConfirmRestore(false)
    setBusy('sync')
    try {
      const sync = await runSync()
      setConfig(getCloudConfig())
      const parts = [
        tr('推送 {push} 条 · 拉取 {pull} 条 · 删除 {del} 条', {
          push: sync.pushed,
          pull: sync.pulled,
          del: sync.removed,
        }),
      ]
      if (sync.photos.uploaded > 0) {
        parts.push(tr('图片上传 {n} 张', { n: sync.photos.uploaded }))
      }
      if (sync.photos.failed > 0) {
        parts.push(tr('图片失败 {n} 张', { n: sync.photos.failed }))
      }
      if (sync.photos.remaining > 0) {
        parts.push(tr('还有 {n} 张待上传', { n: sync.photos.remaining }))
      }
      setResult(parts.join(' · '))
      if (sync.photos.failed > 0) {
        toast(
          sync.photos.remaining > 0
            ? tr('同步完成，但有 {n} 张图片上传失败，下次会自动重试', { n: sync.photos.failed })
            : tr('同步完成，有 {n} 张图片上传失败，请检查网络后重试', { n: sync.photos.failed }),
        )
      } else {
        toast(
          sync.photos.remaining > 0
            ? tr('已同步数据，图片还在后台继续上传（剩 {n} 张）', { n: sync.photos.remaining })
            : tr('同步完成'),
        )
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : tr('同步失败'))
    } finally {
      setBusy(null)
    }
  }

  // 换机恢复：以云端为准覆盖本机，两步确认避免误触
  const doRestore = async () => {
    if (!confirmRestore) {
      setConfirmRestore(true)
      toast(tr('再次点击确认：用云端数据覆盖本机'))
      return
    }
    setConfirmRestore(false)
    setBusy('restore')
    try {
      const { pulled } = await pullOverwrite()
      setConfig(getCloudConfig())
      window.dispatchEvent(new CustomEvent('travelog:sync-done', { detail: { at: Date.now(), pulled } }))
      setResult(tr('已从云端恢复 {n} 条数据', { n: pulled }))
      toast(pulled > 0 ? tr('已用云端数据覆盖本机') : tr('云端暂无数据，本机未改动'))
    } catch (error) {
      toast(error instanceof Error ? error.message : tr('恢复失败'))
    } finally {
      setBusy(null)
    }
  }

  const doLogout = async () => {
    setConfirmRestore(false)
    await logoutCloud()
    setConfig(getCloudConfig())
    setResult('')
    toast(tr('已退出云同步'))
  }

  const toggleAuto = () => {
    const next = saveCloudConfig({ autoSync: !config.autoSync })
    setConfig(next)
  }

  return (
    <div className={embedded ? '' : 'pt-3'}>
      {!embedded && (
        <div className="flex items-center gap-2.5">
          <IconButton label={tr('返回')} onClick={() => nav.back()}>
            <ArrowLeft size={18} />
          </IconButton>
          <span className="text-note text-ink-3">{tr('我的 / 云同步')}</span>
        </div>
      )}

      <div className={embedded ? 'mx-auto w-full max-w-[640px] space-y-4 pb-6' : 'mx-auto mt-4 w-full max-w-[640px] space-y-4 pb-6'}>
        {!signedIn ? (
          <section className="card overflow-hidden">
            <div className="flex items-start gap-3 p-5 pb-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-paper-2 text-ink-2">
                <CloudSlash size={20} />
              </span>
              <div className="min-w-0 flex-1">
                <h1 className="text-title font-semibold tracking-tight text-ink">
                  {tr('登录或注册')}
                </h1>
                <p className="mt-1 text-note leading-5 text-ink-3">
                  {tr('登录后，手机、平板和网页之间可以互相同步。已有账号直接登录；第一次使用可以注册。')}
                </p>
              </div>
            </div>

            <div className="px-5">
              <div className="flex rounded-xl bg-paper-2 p-1 text-note">
                <button
                  type="button"
                  className={cn(
                    'press flex-1 rounded-lg px-2 py-1.5',
                    authMode === 'login' ? 'bg-surface text-ink shadow-sm' : 'text-ink-3',
                  )}
                  onClick={() => setAuthMode('login')}
                >
                  {tr('登录')}
                </button>
                <button
                  type="button"
                  className={cn(
                    'press flex-1 rounded-lg px-2 py-1.5',
                    authMode === 'register' ? 'bg-surface text-ink shadow-sm' : 'text-ink-3',
                  )}
                  onClick={() => setAuthMode('register')}
                >
                  {tr('注册')}
                </button>
              </div>
            </div>

            <div className="p-5 pt-4">
              {authMode === 'login' ? (
                <div className="space-y-3">
                  <div className="flex rounded-xl bg-paper-2 p-1 text-note">
                    <button
                      type="button"
                      className={cn(
                        'press flex-1 rounded-lg px-2 py-1.5',
                        loginMode === 'password' ? 'bg-surface text-ink shadow-sm' : 'text-ink-3',
                      )}
                      onClick={() => setLoginMode('password')}
                    >
                      {tr('账号密码')}
                    </button>
                    <button
                      type="button"
                      className={cn(
                        'press flex-1 rounded-lg px-2 py-1.5',
                        loginMode === 'code' ? 'bg-surface text-ink shadow-sm' : 'text-ink-3',
                      )}
                      onClick={() => setLoginMode('code')}
                    >
                      {tr('同步码')}
                    </button>
                  </div>

                  {loginMode === 'password' ? (
                    <div className="space-y-2">
                      <input
                        className="input"
                        autoComplete="username"
                        value={loginUsername}
                        placeholder={tr('账号')}
                        onChange={(event) => setLoginUsername(event.target.value)}
                      />
                      <div className="flex gap-2">
                        <input
                          className="input"
                          type="password"
                          autoComplete="current-password"
                          value={loginPassword}
                          placeholder={tr('密码')}
                          onChange={(event) => setLoginPassword(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') doLogin()
                          }}
                        />
                        <button
                          type="button"
                          className="btn-primary h-[46px] shrink-0 px-4"
                          onClick={doLogin}
                          disabled={busy === 'login'}
                        >
                          <SignIn size={15} />
                          {tr('登录')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          inputMode="text"
                          autoComplete="off"
                          autoCapitalize="characters"
                          className="input font-mono uppercase tracking-[0.2em]"
                          value={code}
                          placeholder="ABCD2345"
                          maxLength={8}
                          onChange={(event) => setCode(event.target.value.toUpperCase())}
                        />
                        <button
                          type="button"
                          className="btn-ghost h-[46px] shrink-0 px-4"
                          onClick={doLogin}
                          disabled={busy === 'login'}
                        >
                          <SignIn size={15} />
                          {tr('登录')}
                        </button>
                      </div>
                      <p className="text-caption leading-4 text-ink-3">
                        {tr('同步码适合老账号或多设备共享；登录后建议设置账号密码。')}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <input
                    ref={nicknameRef}
                    type="text"
                    inputMode="text"
                    autoComplete="nickname"
                    className="input"
                    placeholder={tr('昵称')}
                    maxLength={24}
                  />
                  <input
                    className="input"
                    autoComplete="username"
                    value={regUsername}
                    placeholder={tr('账号（2–24 位）')}
                    onChange={(event) => setRegUsername(event.target.value)}
                  />
                  <input
                    className="input"
                    type="password"
                    autoComplete="new-password"
                    value={regPassword}
                    placeholder={tr('密码（至少 6 位）')}
                    onChange={(event) => setRegPassword(event.target.value)}
                  />
                  {authConfig?.inviteRequired || regInvite ? (
                    <input
                      className="input font-mono uppercase tracking-[0.18em]"
                      autoComplete="off"
                      autoCapitalize="characters"
                      value={regInvite}
                      placeholder={authConfig?.inviteRequired ? tr('邀请码（必填）') : tr('邀请码（选填）')}
                      maxLength={12}
                      onChange={(event) => setRegInvite(event.target.value.toUpperCase())}
                    />
                  ) : (
                    <button
                      type="button"
                      className="press text-left text-caption text-ink-3 underline-offset-2 hover:underline"
                      onClick={() => setRegInvite(' ')}
                    >
                      {tr('有邀请码？点此填写')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-primary h-10 w-full"
                    onClick={doRegister}
                    disabled={busy === 'register'}
                  >
                    <UserPlus size={15} />
                    {busy === 'register' ? tr('创建中…') : tr('注册并登录')}
                  </button>
                  <p className="text-caption leading-4 text-ink-3">
                    {tr('注册后数据会加密传输到你配置的服务器，本机仍保留一份完整副本。')}
                  </p>
                </div>
              )}
            </div>
          </section>
        ) : (
          <section className="card p-5">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                <CloudCheck size={20} />
              </span>
              <div className="min-w-0 flex-1">
                <h1 className="text-title font-semibold tracking-tight text-ink">
                  {tr('已连接云端')}
                </h1>
                <p className="mt-1 text-note leading-5 text-ink-3">
                  {tr('数据按 updatedAt 较新者为准合并；同步码仍可用于多设备与多人共享。')}
                </p>
              </div>
            </div>

            <dl className="mt-4 space-y-2.5 border-t border-line pt-3.5 text-body-sm">
              <div className="flex items-center justify-between">
                <dt className="text-ink-3">{tr('状态')}</dt>
                <dd className="font-medium text-accent">{tr('已登录')}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="shrink-0 text-ink-3">{tr('登录账号')}</dt>
                <dd className="min-w-0 truncate text-ink">
                  {account?.username || config.username || tr('仅同步码（建议设置密码）')}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="shrink-0 text-ink-3">{tr('账号名称')}</dt>
                <dd className="min-w-0 truncate text-ink">{config.nickname || tr('未设置')}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="shrink-0 text-ink-3">{tr('会员')}</dt>
                <dd className={cn('text-right', memberActive ? 'text-accent' : 'text-ink-3')}>
                  {memberActive
                    ? tr('有效期至 {date}', {
                        date: formatDate(account?.membership.expiresAt ?? config.membershipExpiresAt),
                      })
                    : tr('未开通')}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="shrink-0 text-ink-3">{tr('同步码')}</dt>
                <dd className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate font-mono text-body tracking-[0.16em] text-ink">
                    {config.syncCode}
                  </span>
                  <button
                    type="button"
                    aria-label={tr('复制同步码')}
                    onClick={async () => {
                      const ok = await copyText(config.syncCode)
                      toast(ok ? tr('同步码已复制') : tr('复制失败'))
                    }}
                    className="press shrink-0 text-ink-3 hover:text-ink"
                  >
                    <Copy size={13} />
                  </button>
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-3">{tr('上次同步')}</dt>
                <dd className="text-ink">
                  {config.lastSyncAt > 0 ? relativeTime(config.lastSyncAt) : tr('从未')}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-3">{tr('自动同步')}</dt>
                <dd>
                  <button
                    type="button"
                    onClick={toggleAuto}
                    className={cn(
                      'press relative h-6 w-11 rounded-full transition-colors',
                      config.autoSync ? 'bg-accent' : 'bg-paper-2',
                    )}
                    aria-pressed={config.autoSync}
                  >
                    <span
                      className={cn(
                        'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all',
                        config.autoSync ? 'left-[22px]' : 'left-0.5',
                      )}
                    />
                  </button>
                </dd>
              </div>
            </dl>

            <p className="mt-2 text-caption leading-4 text-ink-3">
              {config.autoSync
                ? (config.syncIntervalMinutes === 0
                    ? tr('自动同步已开启：实时模式，修改后立即同步，前台约每 20 秒检查一次云端更新。')
                    : tr('自动同步已开启：打开应用、切回前台或改动后自动同步，前台每 {n} 分钟检查一次。', {
                        n: config.syncIntervalMinutes,
                      })) + (config.wifiOnly ? tr('仅在 Wi-Fi 下自动同步。') : '')
                : tr('自动同步已关闭：只有点击「立即同步」时才会同步。')}
            </p>

            {result ? (
              <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-accent-soft/70 px-3 py-2 text-note leading-5 text-accent">
                <CheckCircle size={14} className="mt-0.5 shrink-0" weight="fill" />
                <span className="min-w-0 break-all">{result}</span>
              </p>
            ) : null}

            <div className="mt-4 space-y-2">
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-primary flex-1"
                  onClick={doSync}
                  disabled={busy === 'sync' || busy === 'restore'}
                >
                  <ArrowsClockwise size={16} className={busy === 'sync' ? 'animate-spin' : undefined} />
                  {busy === 'sync' ? tr('同步中…') : tr('立即同步')}
                </button>
                <button type="button" className="btn-ghost" onClick={doLogout}>
                  <SignOut size={15} />
                  {tr('退出')}
                </button>
              </div>
              <button
                type="button"
                className={cn('btn-ghost h-9 w-full text-body-sm', confirmRestore && 'border-danger text-danger')}
                onClick={doRestore}
                disabled={busy === 'sync' || busy === 'restore'}
              >
                {busy === 'restore'
                  ? tr('恢复中…')
                  : confirmRestore
                    ? tr('确认覆盖本机数据？')
                    : tr('从云端恢复本机数据')}
              </button>
              <button
                type="button"
                className="btn-ghost h-9 w-full text-body-sm"
                onClick={() => {
                  setCredForm((open) => !open)
                  setCredUsername(account?.username || config.username || '')
                }}
              >
                <Key size={14} />
                {hasCredentials ? tr('修改账号密码') : tr('设置账号密码')}
              </button>
            </div>
          </section>
        )}

        {signedIn && credForm ? (
          <section className="card space-y-3 p-5">
            <h2 className="text-body-sm font-semibold tracking-tight text-ink">
              {hasCredentials ? tr('修改账号密码') : tr('设置账号密码')}
            </h2>
            <p className="text-note leading-5 text-ink-3">
              {tr('设置后可用账号密码登录；同步码继续用于多设备与多人共享。')}
            </p>
            <Field label={tr('账号')}>
              <input
                className="input"
                autoComplete="username"
                value={credUsername}
                placeholder={tr('2–24 位字母、数字或汉字')}
                onChange={(event) => setCredUsername(event.target.value)}
              />
            </Field>
            {hasCredentials ? (
              <Field label={tr('当前密码')}>
                <input
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  value={credCurrent}
                  onChange={(event) => setCredCurrent(event.target.value)}
                />
              </Field>
            ) : null}
            <Field label={tr('新密码')} hint={tr('至少 6 位')}>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={credPassword}
                onChange={(event) => setCredPassword(event.target.value)}
              />
            </Field>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-primary flex-1"
                onClick={doSetCredentials}
                disabled={busy === 'credentials'}
              >
                {busy === 'credentials' ? tr('保存中…') : tr('保存')}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setCredForm(false)}>
                {tr('取消')}
              </button>
            </div>
          </section>
        ) : null}

        {signedIn ? (
          <section className="card space-y-3 p-5">
            <h2 className="flex items-center gap-1.5 text-body-sm font-semibold tracking-tight text-ink">
              <Crown size={15} />
              {tr('会员')}
            </h2>
            <p className="text-note leading-5 text-ink-3">
              {memberActive
                ? tr('会员有效期至 {date}。兑换新的会员码会自动累加天数。', {
                    date: formatDate(account?.membership.expiresAt ?? config.membershipExpiresAt),
                  })
                : tr('输入会员码可开通会员；会员到期时间会在兑换后累加。')}
            </p>
            <div className="flex gap-2">
              <input
                className="input font-mono uppercase tracking-[0.18em]"
                autoComplete="off"
                autoCapitalize="characters"
                value={memberCode}
                placeholder={tr('会员码')}
                maxLength={12}
                onChange={(event) => setMemberCode(event.target.value.toUpperCase())}
              />
              <button
                type="button"
                className="btn-primary h-[46px] shrink-0 px-4"
                onClick={doRedeem}
                disabled={busy === 'redeem'}
              >
                {busy === 'redeem' ? tr('兑换中…') : tr('兑换')}
              </button>
            </div>
          </section>
        ) : null}

        <section className="card overflow-hidden">
          <button
            type="button"
            aria-expanded={showAdvanced}
            onClick={() => setShowAdvanced((open) => !open)}
            className="press flex w-full items-center gap-3 px-5 py-4 text-left"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-paper-2 text-ink-2">
              <Plugs size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-body font-medium text-ink">{tr('服务器与接口')}</span>
              <span className="mt-0.5 block truncate text-caption text-ink-3">
                {baseUrl.trim() || tr('使用当前站点同源的 /api')}
              </span>
            </span>
            <CaretDown
              size={16}
              className={cn('shrink-0 text-ink-3 transition-transform', showAdvanced && 'rotate-180')}
            />
          </button>
          {showAdvanced ? (
            <div className="space-y-4 border-t border-line p-5">
              <Field label={tr('API 地址')} hint={tr('留空则使用当前站点同源的 /api')}>
                <input
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  autoCapitalize="off"
                  className="input"
                  value={baseUrl}
                  placeholder="https://travelog-api.your-name.workers.dev"
                  onChange={(event) => setBaseUrl(event.target.value)}
                  onBlur={saveBaseUrl}
                />
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn-ghost h-9 px-3 text-body-sm"
                  onClick={testConnection}
                  disabled={busy === 'health'}
                >
                  {busy === 'health' ? tr('测试中…') : tr('测试连接')}
                </button>
                {health ? (
                  <span className="inline-flex items-center gap-1.5 text-caption text-accent">
                    <CheckCircle size={13} weight="fill" />
                    {health.ai ? tr('服务正常 · AI 可用') : tr('服务正常 · AI 未配置')}
                  </span>
                ) : null}
              </div>
              <div>
                <p className="text-caption font-medium tracking-wide text-ink-3">{tr('接口')}</p>
                <ul className="mt-1 divide-y divide-line">
                  {ENDPOINTS.map((item) => (
                    <li key={item.path} className="flex items-center gap-2.5 py-2.5 text-note">
                      <span className="w-[38px] shrink-0 font-mono text-caption text-accent">
                        {item.method}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-caption text-ink-2">
                        {item.path}
                      </span>
                      <span className="shrink-0 text-caption text-ink-3">{tr(item.note)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
        </section>

        <section className="rounded-2xl border border-line bg-surface p-4">
          <p className="text-note leading-4 text-ink-3">
            {tr('同步在本地优先的前提下工作：写入先落本机，联网后自动推送。冲突按 updatedAt 较新者胜出，删除会以墓碑记录推送，不会在下次拉取时被复活。')}
          </p>
        </section>
      </div>
    </div>
  )
}

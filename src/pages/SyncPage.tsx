import { useState } from 'react'
import {
  ArrowLeft,
  CheckCircle,
  CloudCheck,
  CloudSlash,
  Copy,
  Key,
  Plugs,
  SignIn,
  SignOut,
  ArrowsClockwise,
} from '@phosphor-icons/react'
import { useNav, useI18n, useToast } from '../lib/app-context'
import {
  checkHealth,
  clearCloudConfig,
  getCloudConfig,
  loginCloud,
  registerCloud,
  saveCloudConfig,
  type HealthInfo,
} from '../lib/cloud'
import { runSync } from '../lib/sync-engine'
import { copyText, relativeTime } from '../lib/utils'
import { cn } from '../lib/cn'
import { Field, IconButton } from '../components/ui'

const ENDPOINTS = [
  { method: 'POST', path: '/api/auth/register', note: '创建同步账号' },
  { method: 'POST', path: '/api/auth/login', note: '用同步码登录' },
  { method: 'GET', path: '/api/sync/pull', note: '游标增量拉取' },
  { method: 'POST', path: '/api/sync/push', note: 'LWW 增量推送' },
  { method: 'POST', path: '/api/ai/complete', note: 'AI 调用代理' },
  { method: 'GET', path: '/api/weather', note: '天气代理' },
]

export function SyncPage() {
  const nav = useNav()
  const toast = useToast()
  const { tr } = useI18n()

  const [config, setConfig] = useState(() => getCloudConfig())
  const [baseUrl, setBaseUrl] = useState(config.baseUrl)
  const [nickname, setNickname] = useState('')
  const [code, setCode] = useState('')
  const [health, setHealth] = useState<HealthInfo | null>(null)
  const [busy, setBusy] = useState<'health' | 'register' | 'login' | 'sync' | null>(null)
  const [result, setResult] = useState('')

  const signedIn = Boolean(config.token)

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

  const doRegister = async () => {
    if (!nickname.trim()) {
      toast(tr('先填一个昵称'))
      return
    }
    setBusy('register')
    try {
      saveCloudConfig({ baseUrl: baseUrl.trim() })
      const auth = await registerCloud(nickname.trim())
      setConfig(getCloudConfig())
      setResult(tr('同步码：{code}', { code: auth.syncCode }))
      toast(tr('账号已创建，请记下同步码'))
    } catch (error) {
      toast(error instanceof Error ? error.message : tr('注册失败'))
    } finally {
      setBusy(null)
    }
  }

  const doLogin = async () => {
    if (!code.trim()) {
      toast(tr('请输入同步码'))
      return
    }
    setBusy('login')
    try {
      saveCloudConfig({ baseUrl: baseUrl.trim() })
      await loginCloud(code.trim())
      setConfig(getCloudConfig())
      toast(tr('登录成功，可以同步了'))
    } catch (error) {
      toast(error instanceof Error ? error.message : tr('登录失败'))
    } finally {
      setBusy(null)
    }
  }

  const doSync = async () => {
    setBusy('sync')
    try {
      const sync = await runSync()
      setConfig(getCloudConfig())
      setResult(
        tr('推送 {push} 条 · 拉取 {pull} 条 · 删除 {del} 条', {
          push: sync.pushed,
          pull: sync.pulled,
          del: sync.removed,
        }),
      )
      toast(tr('同步完成'))
    } catch (error) {
      toast(error instanceof Error ? error.message : tr('同步失败'))
    } finally {
      setBusy(null)
    }
  }

  const doLogout = () => {
    clearCloudConfig()
    setConfig(getCloudConfig())
    setResult('')
    toast(tr('已退出云同步'))
  }

  const toggleAuto = () => {
    const next = saveCloudConfig({ autoSync: !config.autoSync })
    setConfig(next)
  }

  return (
    <div className="pt-3">
      <div className="flex items-center gap-2.5">
        <IconButton label={tr('返回')} onClick={() => nav.back()}>
          <ArrowLeft size={18} />
        </IconButton>
        <span className="text-note text-ink-3">{tr('我的 / 云同步')}</span>
      </div>

      <div className="mx-auto mt-4 w-full max-w-[640px] space-y-4 pb-6">
        <section className="card p-5">
          <div className="flex items-start gap-3">
            <span
              className={cn(
                'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl',
                signedIn ? 'bg-accent-soft text-accent' : 'bg-paper-2 text-ink-2',
              )}
            >
              {signedIn ? <CloudCheck size={20} /> : <CloudSlash size={20} />}
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="text-title font-semibold tracking-tight text-ink">
                {signedIn ? tr('已连接云端') : tr('未连接云端')}
              </h1>
              <p className="mt-1 text-note leading-5 text-ink-3">
                {signedIn
                  ? tr('多台设备可以共用同一个同步码，数据按 updatedAt 较新者为准合并。')
                  : tr('所有数据都保存在这台设备。登录云同步后，手机、平板和网页之间可以互相同步。')}
              </p>
            </div>
          </div>

          <dl className="mt-4 space-y-2.5 border-t border-line pt-3.5 text-body-sm">
            <div className="flex items-center justify-between">
              <dt className="text-ink-3">{tr('状态')}</dt>
              <dd className={cn('font-medium', signedIn ? 'text-accent' : 'text-ink')}>
                {signedIn ? tr('已登录') : tr('仅本地')}
              </dd>
            </div>
            {signedIn ? (
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
            ) : null}
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

          {result ? (
            <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-accent-soft/70 px-3 py-2 text-note leading-5 text-accent">
              <CheckCircle size={14} className="mt-0.5 shrink-0" weight="fill" />
              <span className="min-w-0 break-all">{result}</span>
            </p>
          ) : null}

          {signedIn ? (
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="btn-primary flex-1"
                onClick={doSync}
                disabled={busy === 'sync'}
              >
                <ArrowsClockwise size={16} className={busy === 'sync' ? 'animate-spin' : undefined} />
                {busy === 'sync' ? tr('同步中…') : tr('立即同步')}
              </button>
              <button type="button" className="btn-ghost" onClick={doLogout}>
                <SignOut size={15} />
                {tr('退出')}
              </button>
            </div>
          ) : null}
        </section>

        <section className="card space-y-3 p-5">
          <h2 className="flex items-center gap-1.5 text-body-sm font-semibold tracking-tight text-ink">
            <Plugs size={15} />
            {tr('服务器')}
          </h2>
          <Field label={tr('API 地址')} hint={tr('留空则使用当前站点同源的 /api')}>
            <input
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
        </section>

        {!signedIn ? (
          <section className="card space-y-4 p-5">
            <h2 className="flex items-center gap-1.5 text-body-sm font-semibold tracking-tight text-ink">
              <Key size={15} />
              {tr('账号')}
            </h2>

            <div className="space-y-2 rounded-2xl border border-line p-3">
              <p className="text-note text-ink-3">{tr('第一次用：创建一个同步账号')}</p>
              <div className="flex gap-2">
                <input
                  className="input"
                  value={nickname}
                  placeholder={tr('昵称')}
                  maxLength={24}
                  onChange={(event) => setNickname(event.target.value)}
                />
                <button
                  type="button"
                  className="btn-primary h-[46px] shrink-0 px-4"
                  onClick={doRegister}
                  disabled={busy === 'register'}
                >
                  {busy === 'register' ? tr('创建中…') : tr('创建')}
                </button>
              </div>
            </div>

            <div className="space-y-2 rounded-2xl border border-line p-3">
              <p className="text-note text-ink-3">{tr('已有账号：输入 8 位同步码')}</p>
              <div className="flex gap-2">
                <input
                  className="input font-mono tracking-[0.2em] uppercase"
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
            </div>
          </section>
        ) : null}

        <section className="card p-5">
          <h2 className="text-body-sm font-semibold tracking-tight text-ink">{tr('接口')}</h2>
          <ul className="mt-2 divide-y divide-line">
            {ENDPOINTS.map((item) => (
              <li key={item.path} className="flex items-center gap-2.5 py-2.5 text-note">
                <span className="w-[38px] shrink-0 font-mono text-caption text-accent">{item.method}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-caption text-ink-2">{item.path}</span>
                <span className="shrink-0 text-caption text-ink-3">{tr(item.note)}</span>
              </li>
            ))}
          </ul>
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
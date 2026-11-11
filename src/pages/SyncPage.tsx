import { ArrowLeft, CloudSlash, Link, ShieldCheck } from '@phosphor-icons/react'
import { useLoader } from '../lib/hooks'
import { stats } from '../lib/repo'
import { useNav, useToast } from '../lib/app-context'
import { IconButton } from '../components/ui'

const ENDPOINTS = [
  { method: 'POST', path: '/v1/auth/login', note: '换取 JWT' },
  { method: 'GET', path: '/v1/sync/pull?cursor=', note: '增量拉取' },
  { method: 'POST', path: '/v1/sync/push', note: '增量推送' },
  { method: 'POST', path: '/v1/media', note: '图片上传' },
]

export function SyncPage() {
  const nav = useNav()
  const toast = useToast()
  const { data } = useLoader(
    () => stats(),
    {
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
    },
    'sync-stats',
  )

  return (
    <div className="pt-3">
      <div className="flex items-center gap-2.5">
        <IconButton label="返回" onClick={() => nav.back()}>
          <ArrowLeft size={18} />
        </IconButton>
        <span className="text-note text-ink-3">我的 / 云同步</span>
      </div>

      <div className="mx-auto mt-4 w-full max-w-[640px] space-y-4">
        <section className="card p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-paper-2 text-ink-2">
              <CloudSlash size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="text-title font-semibold tracking-tight text-ink">未连接云端</h1>
              <p className="mt-1 text-note leading-5 text-ink-3">
                当前所有数据都保存在这台设备。接入后端后，同一段旅程可以在手机、平板和网页之间同步。
              </p>
            </div>
          </div>

          <dl className="mt-4 space-y-2.5 border-t border-line pt-3.5 text-body-sm">
            <div className="flex items-center justify-between">
              <dt className="text-ink-3">状态</dt>
              <dd className="text-ink">仅本地</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-ink-3">待同步改动</dt>
              <dd className="tabular-nums text-ink">{data.pendingSync} 条</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-ink-3">上次同步</dt>
              <dd className="text-ink">从未</dd>
            </div>
          </dl>

          <button
            type="button"
            className="btn-primary mt-4 w-full"
            onClick={() => toast('本地模式暂无云端可同步')}
          >
            立即同步
          </button>
        </section>

        <section className="card p-5">
          <h2 className="flex items-center gap-1.5 text-body-sm font-semibold tracking-tight text-ink">
            <Link size={15} />
            同步接口契约
          </h2>
          <p className="mt-1.5 text-note leading-5 text-ink-3">
            客户端通过 Repository 与 SyncService 两个抽象访问数据。后端实现同一组接口后，替换注入点即可，页面无需改动。
          </p>
          <ul className="mt-3 divide-y divide-line">
            {ENDPOINTS.map((item) => (
              <li key={item.path} className="flex items-center gap-2.5 py-2.5 text-note">
                <span className="w-[38px] shrink-0 font-mono text-caption text-accent">{item.method}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-caption text-ink-2">{item.path}</span>
                <span className="shrink-0 text-caption text-ink-3">{item.note}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-line bg-surface p-4">
          <p className="flex items-center gap-1.5 text-note font-medium text-ink">
            <ShieldCheck size={15} className="text-accent" />
            本地优先
          </p>
          <p className="mt-1.5 text-note leading-4 text-ink-3">
            读写先落本地，网络失败不影响记录；同步以 updatedAt 较新者为准，删除通过墓碑记录避免回滚。
          </p>
        </section>
      </div>
    </div>
  )
}
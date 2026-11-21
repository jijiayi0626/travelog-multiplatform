import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, CloudCheck, DownloadSimple, Trash } from '@phosphor-icons/react'
import {
  deleteCloudPhoto,
  getStorageInfo,
  isSignedIn,
  listMyPhotos,
  type CloudPhoto,
  type StorageInfo,
} from '../lib/cloud'
import { useI18n, useNav, useToast } from '../lib/app-context'
import { formatDateCn } from '../lib/utils'
import { ConfirmDialog, EmptyState, IconButton, Sheet, StatTile } from '../components/ui'
import { EmptyArt } from '../components/EmptyArt'

const PAGE_SIZE = 60

export function CloudGalleryPage() {
  const nav = useNav()
  const toast = useToast()
  const { tr } = useI18n()
  const signedIn = isSignedIn()

  const [photos, setPhotos] = useState<CloudPhoto[]>([])
  const [total, setTotal] = useState(0)
  const [bytes, setBytes] = useState(0)
  const [storage, setStorage] = useState<StorageInfo | null>(null)
  const [loading, setLoading] = useState(signedIn)
  const [loadingMore, setLoadingMore] = useState(false)
  const [active, setActive] = useState<CloudPhoto | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [page, info] = await Promise.all([listMyPhotos(PAGE_SIZE, 0), getStorageInfo()])
      setPhotos(page.photos)
      setTotal(page.total)
      setBytes(page.bytes)
      setStorage(info)
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('加载失败'))
    } finally {
      setLoading(false)
    }
  }, [tr])

  useEffect(() => {
    if (signedIn) void load()
  }, [signedIn, load])

  // 同步完成后自动刷新，刚上传的照片立刻出现
  useEffect(() => {
    if (!signedIn) return
    const refresh = () => void load()
    window.addEventListener('travelog:sync-done', refresh)
    return () => window.removeEventListener('travelog:sync-done', refresh)
  }, [signedIn, load])

  const loadMore = async () => {
    if (loadingMore || photos.length >= total) return
    setLoadingMore(true)
    try {
      const page = await listMyPhotos(PAGE_SIZE, photos.length)
      setPhotos((current) => {
        const seen = new Set(current.map((item) => item.id))
        return [...current, ...page.photos.filter((item) => !seen.has(item.id))]
      })
      setTotal(page.total)
      setBytes(page.bytes)
    } catch (err) {
      toast(err instanceof Error ? err.message : tr('加载失败'))
    } finally {
      setLoadingMore(false)
    }
  }

  const doDelete = async () => {
    if (!active) return
    try {
      await deleteCloudPhoto(active.id)
      setPhotos((current) => current.filter((item) => item.id !== active.id))
      setTotal((value) => Math.max(value - 1, 0))
      setBytes((value) => Math.max(value - active.size, 0))
      setStorage((current) =>
        current
          ? {
              ...current,
              photos: {
                count: Math.max(current.photos.count - 1, 0),
                bytes: Math.max(current.photos.bytes - active.size, 0),
              },
            }
          : current,
      )
      setConfirmDelete(false)
      setActive(null)
      toast(tr('云端照片已删除'))
    } catch (err) {
      toast(err instanceof Error ? err.message : tr('删除失败'))
    }
  }

  return (
    <div className="pt-3">
      <div className="flex items-center gap-2.5">
        <IconButton label={tr('返回')} onClick={() => nav.back()}>
          <ArrowLeft size={18} />
        </IconButton>
        <span className="text-note text-ink-3">{tr('我的 / 云相册')}</span>
      </div>

      <div className="mx-auto mt-4 w-full max-w-[820px] space-y-5 pb-8">
        <header className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-caption uppercase tracking-[0.22em] text-ink-3">Cloud Album</p>
            <h1 className="mt-1.5 text-heading font-semibold leading-none tracking-tight text-ink sm:text-display">
              {tr('云相册')}
            </h1>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <button
              type="button"
              className="chip px-2.5 py-1 text-caption"
              onClick={() => nav.navigate({ name: 'album' })}
            >
              {tr('本机相册')}
            </button>
            <button
              type="button"
              className="chip px-2.5 py-1 text-caption"
              onClick={() => void load()}
              disabled={loading}
            >
              {loading ? tr('刷新中…') : tr('刷新')}
            </button>
          </div>
        </header>

        {!signedIn ? (
          <section className="card p-5">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent-soft text-accent">
              <CloudCheck size={20} />
            </span>
            <h2 className="mt-3 text-title font-semibold tracking-tight text-ink">
              {tr('登录后查看云相册')}
            </h2>
            <p className="mt-1.5 text-body-sm leading-6 text-ink-3">
              {tr('照片上传到 R2 后会出现在这里，可以查看原图、占用空间并随时清理。')}
            </p>
            <button
              type="button"
              className="btn-primary mt-4 h-10"
              onClick={() => nav.navigate({ name: 'sync', mode: 'login' })}
            >
              {tr('去登录')}
            </button>
          </section>
        ) : (
          <>
            <div className="flex divide-x divide-line border-y border-line py-3.5">
              <div className="min-w-0 flex-1 pr-3">
                <StatTile label={tr('云端照片')} value={String(total)} sub={tr('张')} />
              </div>
              <div className="min-w-0 flex-1 px-3">
                <StatTile label={tr('照片占用')} value={formatBytes(bytes)} />
              </div>
              <div className="min-w-0 flex-1 pl-3">
                <StatTile
                  label={tr('头像')}
                  value={storage?.avatar ? formatBytes(storage.avatar.size) : tr('未上传')}
                />
              </div>
            </div>

            {error ? (
              <p className="rounded-xl bg-danger/10 px-3 py-2 text-note leading-5 text-danger">
                {error}
              </p>
            ) : null}

            {loading && photos.length === 0 ? (
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-6">
                {Array.from({ length: 9 }).map((_, index) => (
                  <div key={index} className="skeleton aspect-square rounded-xl" />
                ))}
              </div>
            ) : photos.length === 0 ? (
              <EmptyState
                icon={<EmptyArt variant="photo" />}
                title={tr('云端还没有照片')}
                hint={tr('在记录或旅行封面里添加照片并完成同步后，会显示在这里。')}
                action={
                  <button
                    type="button"
                    className="btn-ghost mt-1"
                    onClick={() => nav.navigate({ name: 'sync' })}
                  >
                    <CloudCheck size={15} />
                    {tr('去云同步')}
                  </button>
                }
              />
            ) : (
              <>
                <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-6">
                  {photos.map((photo) => (
                    <button
                      key={photo.id}
                      type="button"
                      onClick={() => setActive(photo)}
                      className="press group relative aspect-square overflow-hidden rounded-xl bg-paper-2"
                    >
                      <img
                        src={photo.url}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                      />
                      <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent px-2 pb-1.5 pt-4 text-left text-[10px] tabular-nums text-white/90">
                        {formatBytes(photo.size)}
                      </span>
                    </button>
                  ))}
                </div>
                {photos.length < total ? (
                  <button
                    type="button"
                    className="btn-ghost mx-auto h-9 px-4 text-body-sm"
                    onClick={() => void loadMore()}
                    disabled={loadingMore}
                  >
                    {loadingMore
                      ? tr('加载中…')
                      : tr('加载更多（还有 {n} 张）', { n: total - photos.length })}
                  </button>
                ) : (
                  <p className="text-center text-caption text-ink-3">
                    {tr('共 {n} 张 · {size}', { n: total, size: formatBytes(bytes) })}
                  </p>
                )}
              </>
            )}
          </>
        )}

        <section className="rounded-2xl border border-line bg-surface p-4">
          <p className="text-note leading-4 text-ink-3">
            {tr('云相册直接读取 R2 里的原图；删除照片会同时清理云端文件，记录里引用它的图片将无法显示。')}
          </p>
        </section>
      </div>

      <Sheet
        open={active !== null}
        title={tr('照片详情')}
        onClose={() => setActive(null)}
        footer={
          active ? (
            <div className="flex gap-2">
              <a
                className="btn-ghost h-10 flex-1"
                href={active.url}
                download={`travelog-${active.id}.${extOf(active.mime)}`}
              >
                <DownloadSimple size={15} />
                {tr('下载原图')}
              </a>
              <button
                type="button"
                className="btn-ghost h-10 flex-1 border-danger/40 text-danger"
                onClick={() => setConfirmDelete(true)}
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
            <img
              src={active.url}
              alt=""
              className="max-h-[46dvh] w-full rounded-xl bg-paper-2 object-contain"
            />
            <dl className="space-y-2.5 text-body-sm">
              <div className="flex items-center justify-between">
                <dt className="text-ink-3">{tr('格式')}</dt>
                <dd className="text-ink">{extOf(active.mime).toUpperCase()}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-3">{tr('大小')}</dt>
                <dd className="tabular-nums text-ink">{formatBytes(active.size)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-3">{tr('上传时间')}</dt>
                <dd className="text-ink">{formatDateCn(active.createdAt)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="shrink-0 text-ink-3">{tr('照片 ID')}</dt>
                <dd className="min-w-0 truncate font-mono text-caption text-ink-2">{active.id}</dd>
              </div>
            </dl>
          </div>
        ) : null}
      </Sheet>

      <ConfirmDialog
        open={confirmDelete}
        title={tr('删除这张云端照片？')}
        message={tr('R2 里的原图会被永久删除，记录中引用它的图片将无法显示，且无法恢复。')}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void doDelete()}
      />
    </div>
  )
}

function extOf(mime: string): string {
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  return 'jpg'
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

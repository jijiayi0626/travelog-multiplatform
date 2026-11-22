import { useState } from 'react'
import {
  ArrowLeft,
  CheckCircle,
  DownloadSimple,
  Trash,
  WarningCircle,
} from '@phosphor-icons/react'
import { useI18n, useNav, useToast } from '../lib/app-context'
import {
  OCR_MODEL_SIZE_MB,
  deleteOcrModel,
  downloadOcrModel,
  getOcrModelError,
  isOcrModelReady,
} from '../lib/ocr-model'

export function OcrModelPage() {
  const nav = useNav()
  const toast = useToast()
  const { tr } = useI18n()
  const [ready, setReady] = useState(() => isOcrModelReady())
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')

  const download = async () => {
    if (busy) return
    setBusy(true)
    setProgress(0)
    setError('')
    try {
      const ok = await downloadOcrModel((value) => setProgress(value))
      if (ok) {
        setReady(true)
        toast(tr('识别模型下载完成，现在可以离线识别小票'))
      } else {
        setError(getOcrModelError() || tr('下载失败，请检查网络后重试'))
        toast(tr('模型下载失败'))
      }
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    await deleteOcrModel()
    setReady(false)
    setProgress(0)
    setError('')
    toast(tr('识别模型已删除'))
  }

  return (
    <div className="mx-auto w-full max-w-[820px] space-y-5">
      <header className="flex items-start gap-2 pt-4">
        <button
          type="button"
          onClick={() => nav.back()}
          aria-label={tr('返回')}
          className="press mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-2 hover:bg-paper-2"
        >
          <ArrowLeft size={19} />
        </button>
        <div>
          <p className="text-caption uppercase tracking-[0.22em] text-ink-3">OCR Model</p>
          <h1 className="mt-1.5 text-heading font-semibold leading-none tracking-tight text-ink sm:text-display">
            {tr('离线识别模型')}
          </h1>
        </div>
      </header>

      <section className="rounded-2xl border border-line bg-surface p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-body font-medium text-ink">{tr('中文小票识别模型')}</p>
            <p className="mt-0.5 text-caption text-ink-3">
              {tr('引擎已内置，中文模型约 {size}MB，只在首次下载。', {
                size: OCR_MODEL_SIZE_MB,
              })}
            </p>
          </div>
          <span
            className={
              ready
                ? 'shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-caption text-accent'
                : 'shrink-0 rounded-full bg-paper-2 px-2 py-0.5 text-caption text-ink-3'
            }
          >
            {ready ? tr('已下载') : tr('未下载')}
          </span>
        </div>

        {busy ? (
          <div className="mt-4 space-y-2">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-paper-2">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-300"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <p className="text-caption text-ink-3">
              {tr('正在下载… {percent}%', { percent: Math.round(progress * 100) })}
            </p>
          </div>
        ) : null}

        {error ? (
          <p className="mt-3 flex items-start gap-1.5 break-all text-caption leading-5 text-warn">
            <WarningCircle size={14} className="mt-0.5 shrink-0" />
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex gap-2">
          {ready ? (
            <button type="button" className="btn-ghost h-10 flex-1 text-note" onClick={() => void remove()}>
              <Trash size={14} />
              {tr('删除模型')}
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary h-10 flex-1 text-note"
              disabled={busy}
              onClick={() => void download()}
            >
              <DownloadSimple size={15} />
              {busy ? tr('下载中…') : tr('下载模型')}
            </button>
          )}
        </div>

        <p className="mt-3 text-caption leading-5 text-ink-3">
          {tr('模型从 GitHub 仓库下载，失败时会自动切换备用镜像。识别全程在本机完成，不会上传小票图片。')}
        </p>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-4">
        <p className="flex items-center gap-1.5 text-body-sm text-ink">
          {ready ? (
            <CheckCircle size={15} className="text-accent" />
          ) : (
            <WarningCircle size={15} className="text-ink-3" />
          )}
          {ready ? tr('已可在「记一笔」里拍照识别小票') : tr('下载后才能在「记一笔」里拍照识别小票')}
        </p>
        <p className="mt-1.5 text-caption leading-5 text-ink-3">
          {tr('删除模型不会影响已保存的账目；需要识别时重新下载即可。')}
        </p>
      </section>
    </div>
  )
}

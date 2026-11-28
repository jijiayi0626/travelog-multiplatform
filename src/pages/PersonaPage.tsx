import { useCallback, useState } from 'react'
import { ArrowLeft, Compass, DownloadSimple, Sparkle } from '@phosphor-icons/react'
import type { Expense, Footprint, Moment, Plan, TripView } from '../lib/types'
import { listAllMoments, listAllPlans, listExpenses, listFootprints, listTrips } from '../lib/repo'
import { buildPersona } from '../lib/persona'
import { useLoader } from '../lib/hooks'
import { useI18n, useNav, useToast } from '../lib/app-context'
import { exportErrorText, sharePngBlob } from '../lib/share-image'
import {
  getPosterTemplate,
  renderPoster,
  setPosterTemplate,
  type PosterData,
  type PosterTemplate,
} from '../lib/poster'
import { cn } from '../lib/cn'
import { EmptyState, IconButton, PosterTemplatePicker } from '../components/ui'
import { EmptyArt } from '../components/EmptyArt'

interface PersonaData {
  trips: TripView[]
  moments: Moment[]
  expenses: Expense[]
  footprints: Footprint[]
  plans: Plan[]
}

export function PersonaPage() {
  const nav = useNav()
  const toast = useToast()
  const { tr } = useI18n()
  const [exporting, setExporting] = useState(false)
  const [template, setTemplate] = useState<PosterTemplate>(() => getPosterTemplate())

  const chooseTemplate = (value: PosterTemplate) => {
    setTemplate(value)
    setPosterTemplate(value)
  }

  const loader = useCallback(async (): Promise<PersonaData> => {
    const [trips, moments, expenses, footprints, plans] = await Promise.all([
      listTrips(),
      listAllMoments(),
      listExpenses(),
      listFootprints(),
      listAllPlans(),
    ])
    return { trips, moments, expenses, footprints, plans }
  }, [])
  const { data, loading } = useLoader<PersonaData>(
    loader,
    { trips: [], moments: [], expenses: [], footprints: [], plans: [] },
    'persona',
  )

  const persona = buildPersona(data)

  const exportPoster = async () => {
    if (!persona || exporting) return
    setExporting(true)
    try {
      const poster: PosterData = {
        kind: 'trip',
        eyebrow: 'TRAVELOG · TRAVEL PERSONA',
        title: persona.title,
        subtitle: persona.tagline,
        stats: persona.stats,
        categories: persona.traits.map((trait) => ({
          label: trait.label,
          value: String(trait.value),
          ratio: trait.value / 100,
          color: trait.color,
        })),
        categoriesLabel: tr('旅行特质'),
        footnote: persona.badges.join(' · '),
        footer: tr('旅记 Travelog · 我的旅行人格'),
      }
      const blob = await renderPoster(poster, template)
      await sharePngBlob(blob, `travelog-persona-${persona.id}.png`)
      toast(tr('人格长图已生成，可分享或保存'))
    } catch (error) {
      toast(exportErrorText(error))
    } finally {
      setExporting(false)
    }
  }

  const topTrait = persona ? [...persona.traits].sort((a, b) => b.value - a.value)[0] : null

  return (
    <div className="mx-auto w-full max-w-[860px] space-y-5 pb-6">
      <div className="flex items-center gap-2.5 pt-3">
        <IconButton label={tr('返回')} onClick={() => nav.back()}>
          <ArrowLeft size={18} />
        </IconButton>
        <span className="text-note text-ink-3">
          {tr('我的')} / <span className="text-ink-2">{tr('旅行人格')}</span>
        </span>
      </div>

      <header className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-caption uppercase tracking-[0.22em] text-ink-3">Travel persona</p>
          <h1 className="mt-1.5 text-heading font-semibold leading-none tracking-tight text-ink">
            {tr('旅行人格')}
          </h1>
        </div>
        {persona ? (
          <button
            type="button"
            className="btn-ghost h-9 shrink-0 px-3 text-note"
            onClick={() => void exportPoster()}
            disabled={exporting}
          >
            <DownloadSimple size={15} />
            {exporting ? tr('生成中…') : tr('生成长图')}
          </button>
        ) : null}
      </header>

      {loading ? (
        <div className="space-y-3">
          <div className="skeleton h-44 rounded-[1.6rem]" />
          <div className="skeleton h-40 rounded-2xl" />
        </div>
      ) : !persona ? (
        <EmptyState
          icon={<EmptyArt variant="compass" />}
          title={tr('还没有足够的旅行数据')}
          hint={tr('记录一段旅程、写下几条记录，就能生成属于你的旅行人格。')}
          action={
            <button
              type="button"
              className="btn-primary mt-1"
              onClick={() => nav.navigate({ name: 'trips' })}
            >
              <Compass size={15} />
              {tr('去看看行程')}
            </button>
          }
        />
      ) : (
        <>
          <section className="relative overflow-hidden rounded-[1.6rem] bg-[linear-gradient(135deg,#0f766e_0%,#115e59_55%,#134e4a_100%)] p-5 text-white">
            <span className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10" />
            <span className="pointer-events-none absolute -bottom-16 -left-8 h-44 w-44 rounded-full bg-white/5" />
            <p className="relative flex items-center gap-1.5 text-caption uppercase tracking-[0.2em] text-white/70">
              <Sparkle size={12} weight="fill" />
              {tr('你的旅行人格')}
            </p>
            <h2 className="relative mt-3 text-display font-semibold leading-tight tracking-tight">
              {persona.title}
            </h2>
            <p className="relative mt-2 max-w-[36ch] text-body-sm leading-6 text-white/80">
              {persona.tagline}
            </p>
            {persona.badges.length > 0 ? (
              <div className="relative mt-4 flex flex-wrap gap-1.5">
                {persona.badges.map((badge) => (
                  <span
                    key={badge}
                    className="rounded-full bg-white/15 px-2.5 py-1 text-caption text-white/90 backdrop-blur-sm"
                  >
                    {badge}
                  </span>
                ))}
              </div>
            ) : null}
            {topTrait ? (
              <p className="relative mt-4 text-caption text-white/70">
                {tr('最突出：{label} {value}', { label: topTrait.label, value: topTrait.value })}
              </p>
            ) : null}
          </section>

          <section className="rounded-2xl border border-line bg-surface p-4">
            <div className="flex items-center gap-1.5">
              <Compass size={15} className="text-accent" />
              <p className="text-body font-medium text-ink">{tr('旅行特质')}</p>
            </div>
            <div className="mt-3 space-y-3">
              {persona.traits.map((trait) => (
                <div key={trait.key} className="flex items-center gap-2.5">
                  <span className="w-[52px] shrink-0 text-body-sm text-ink-2">{trait.label}</span>
                  <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-paper-2">
                    <span
                      className={cn('block h-full rounded-full transition-[width] duration-500')}
                      style={{ width: `${Math.max(trait.value, 3)}%`, backgroundColor: trait.color }}
                    />
                  </span>
                  <span className="w-8 shrink-0 text-right text-caption tabular-nums text-ink-3">
                    {trait.value}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-line bg-surface p-4">
            <p className="text-body font-medium text-ink">{tr('旅记里的你')}</p>
            <p className="mt-2 text-body-sm leading-6 text-ink-2">{persona.summary}</p>
            <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {persona.stats.map((stat) => (
                <div key={stat.label} className="rounded-xl bg-paper-2/60 px-3 py-2.5">
                  <p className="text-caption text-ink-3">{stat.label}</p>
                  <p className="mt-0.5 text-title font-semibold tabular-nums tracking-tight text-ink">
                    {stat.value}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <div className="space-y-1.5">
            <p className="text-caption font-medium tracking-wide text-ink-3">{tr('长图模板')}</p>
            <PosterTemplatePicker value={template} onChange={chooseTemplate} />
          </div>

          <button
            type="button"
            className="btn-primary h-11 w-full"
            disabled={exporting}
            onClick={() => void exportPoster()}
          >
            <DownloadSimple size={16} />
            {exporting ? tr('正在生成…') : tr('生成旅行人格长图')}
          </button>

          <p className="text-center text-caption leading-4 text-ink-3">
            {tr('人格完全根据本机数据生成，不上传任何内容。')}
          </p>
        </>
      )}
    </div>
  )
}

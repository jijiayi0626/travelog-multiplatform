import { useCallback, useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowsLeftRight,
  CloudSlash,
  Copy,
  CurrencyCircleDollar,
  FirstAidKit,
  MapPinLine,
  Phone,
  Plus,
  Trash,
} from '@phosphor-icons/react'
import type { Currency, TripView } from '../lib/types'
import { listTrips } from '../lib/repo'
import { useLoader } from '../lib/hooks'
import { useI18n, useNav, useToast } from '../lib/app-context'
import {
  CURRENCY_LABEL,
  CURRENCY_ORDER,
  CURRENCY_RATE_TO_CNY,
  CURRENCY_SYMBOL,
  copyText,
  formatMoney,
} from '../lib/utils'
import { cn } from '../lib/cn'
import { IconButton } from '../components/ui'

interface EmergencyLine {
  label: string
  number: string
}

interface Country {
  key: string
  label: string
  lines: EmergencyLine[]
}

const COUNTRIES: Country[] = [
  {
    key: 'cn',
    label: '中国',
    lines: [
      { label: '报警', number: '110' },
      { label: '急救', number: '120' },
      { label: '火警', number: '119' },
      { label: '交通事故', number: '122' },
    ],
  },
  {
    key: 'jp',
    label: '日本',
    lines: [
      { label: '警察', number: '110' },
      { label: '火警 / 急救', number: '119' },
    ],
  },
  {
    key: 'th',
    label: '泰国',
    lines: [
      { label: '警察', number: '191' },
      { label: '急救', number: '1669' },
      { label: '火警', number: '199' },
    ],
  },
  {
    key: 'kr',
    label: '韩国',
    lines: [
      { label: '警察', number: '112' },
      { label: '火警 / 急救', number: '119' },
    ],
  },
  {
    key: 'sg',
    label: '新加坡',
    lines: [
      { label: '警察', number: '999' },
      { label: '火警 / 急救', number: '995' },
    ],
  },
  {
    key: 'us',
    label: '美国',
    lines: [{ label: '报警 / 急救', number: '911' }],
  },
  {
    key: 'uk',
    label: '英国',
    lines: [{ label: '报警 / 急救', number: '999' }],
  },
  {
    key: 'eu',
    label: '欧洲通用',
    lines: [{ label: '报警 / 急救', number: '112' }],
  },
]

const EMBASSIES: Array<{ city: string; country: string; phone: string }> = [
  { city: '东京', country: '日本', phone: '+81-3-3403-3065' },
  { city: '大阪', country: '日本', phone: '+81-6-6445-9481' },
  { city: '曼谷', country: '泰国', phone: '+66-2-245-0088' },
  { city: '首尔', country: '韩国', phone: '+82-2-755-0473' },
  { city: '新加坡', country: '新加坡', phone: '+65-6471-2117' },
  { city: '华盛顿', country: '美国', phone: '+1-202-495-2216' },
  { city: '伦敦', country: '英国', phone: '+44-20-7436-8291' },
]

const PHRASES: Array<{ group: string; zh: string; en: string }> = [
  { group: '求助', zh: '请帮帮我', en: 'Help me, please.' },
  { group: '求助', zh: '我迷路了', en: "I'm lost." },
  { group: '求助', zh: '我需要看医生', en: 'I need a doctor.' },
  { group: '求助', zh: '我的护照丢了', en: 'I lost my passport.' },
  { group: '交通', zh: '请送我到这个地址', en: 'Please take me to this address.' },
  { group: '交通', zh: '去这里多少钱？', en: 'How much does it cost to get here?' },
  { group: '交通', zh: '洗手间在哪里？', en: 'Where is the toilet?' },
  { group: '餐饮', zh: '不要辣，谢谢', en: 'Not spicy, please.' },
  { group: '餐饮', zh: '我对花生过敏', en: "I'm allergic to peanuts." },
  { group: '餐饮', zh: '买单，谢谢', en: 'The bill, please.' },
  { group: '住宿', zh: '我预订了房间', en: 'I have a reservation.' },
  { group: '住宿', zh: '可以寄存行李吗？', en: 'Can I leave my luggage here?' },
  { group: '购物', zh: '太贵了，能便宜点吗？', en: "That's too expensive. Can you make it cheaper?" },
  { group: '购物', zh: '可以刷卡吗？', en: 'Can I pay by card?' },
]

const PHRASE_GROUPS = ['求助', '交通', '餐饮', '住宿', '购物']
const CONTACTS_KEY = 'travelog.emergencyContacts'

interface EmergencyContact {
  id: string
  name: string
  phone: string
}

function loadContacts(): EmergencyContact[] {
  try {
    const raw = localStorage.getItem(CONTACTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as EmergencyContact[]
    return Array.isArray(parsed)
      ? parsed.filter((item) => item && item.name && item.phone)
      : []
  } catch {
    return []
  }
}

function saveContacts(list: EmergencyContact[]): void {
  try {
    localStorage.setItem(CONTACTS_KEY, JSON.stringify(list))
  } catch {
    /* 隐私模式忽略 */
  }
}

function detectCountry(trips: TripView[]): string {
  const text = trips.map((trip) => `${trip.destination} ${trip.title}`).join(' ')
  if (/日本|东京|大阪|京都|北海道|冲绳|福冈|名古屋/.test(text)) return 'jp'
  if (/泰国|曼谷|清迈|普吉|芭提雅/.test(text)) return 'th'
  if (/韩国|首尔|釜山|济州/.test(text)) return 'kr'
  if (/新加坡/.test(text)) return 'sg'
  if (/美国|纽约|洛杉矶|旧金山|夏威夷/.test(text)) return 'us'
  if (/英国|伦敦|爱丁堡/.test(text)) return 'uk'
  if (/法国|巴黎|德国|意大利|西班牙|荷兰|欧洲/.test(text)) return 'eu'
  return 'cn'
}

function telHref(number: string): string {
  return `tel:${number.replace(/[^\d+]/g, '')}`
}

export function EmergencyPage() {
  const nav = useNav()
  const toast = useToast()
  const { tr } = useI18n()

  const loader = useCallback(async () => ({ trips: await listTrips() }), [])
  const { data } = useLoader<{ trips: TripView[] }>(loader, { trips: [] }, 'emergency')

  const [manualCountry, setManualCountry] = useState<string | null>(null)
  const [amount, setAmount] = useState('100')
  const [currency, setCurrency] = useState<Currency>('JPY')
  const [toCny, setToCny] = useState(true)
  const [contacts, setContacts] = useState<EmergencyContact[]>(() => loadContacts())
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')

  // 用户没手动切换时，按行程目的地推荐
  const countryKey = manualCountry ?? detectCountry(data.trips)

  const country = COUNTRIES.find((item) => item.key === countryKey) ?? COUNTRIES[0]

  const converted = useMemo(() => {
    const value = Number(amount.replace(/[^\d.]/g, ''))
    if (!Number.isFinite(value) || value <= 0) return null
    const rate = CURRENCY_RATE_TO_CNY[currency]
    return toCny ? value * rate : value / rate
  }, [amount, currency, toCny])

  const copyPhrase = async (phrase: { zh: string; en: string }) => {
    const ok = await copyText(`${phrase.zh}\n${phrase.en}`)
    toast(ok ? tr('已复制，可拿给当地人看') : tr('复制失败，请手动记录'))
  }

  const addContact = () => {
    const name = newName.trim()
    const phone = newPhone.trim()
    if (!name || !phone) {
      toast(tr('填写称呼和电话'))
      return
    }
    const next = [...contacts, { id: `${Date.now()}`, name, phone }]
    setContacts(next)
    saveContacts(next)
    setNewName('')
    setNewPhone('')
  }

  const removeContact = (id: string) => {
    const next = contacts.filter((item) => item.id !== id)
    setContacts(next)
    saveContacts(next)
  }

  return (
    <div className="mx-auto w-full max-w-[860px] space-y-5 pb-6">
      <div className="flex items-center gap-2.5 pt-3">
        <IconButton label={tr('返回')} onClick={() => nav.back()}>
          <ArrowLeft size={18} />
        </IconButton>
        <span className="text-note text-ink-3">
          {tr('我的')} / <span className="text-ink-2">{tr('离线应急包')}</span>
        </span>
      </div>

      <header>
        <p className="text-caption uppercase tracking-[0.22em] text-ink-3">Emergency kit</p>
        <h1 className="mt-1.5 text-heading font-semibold leading-none tracking-tight text-ink">
          {tr('离线应急包')}
        </h1>
        <p className="mt-2 flex items-center gap-1.5 text-note text-ink-3">
          <CloudSlash size={14} />
          {tr('全部内容保存在本机，没有网络也能用。')}
        </p>
      </header>

      <section className="rounded-2xl border border-line bg-surface p-4">
        <div className="flex items-center gap-1.5">
          <FirstAidKit size={16} className="text-accent" />
          <p className="text-body font-medium text-ink">{tr('紧急电话')}</p>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {COUNTRIES.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setManualCountry(item.key)}
              className={cn(
                'press rounded-full border px-2.5 py-1 text-note',
                item.key === countryKey
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-line text-ink-2 hover:text-ink',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {country.lines.map((line) => (
            <a
              key={line.number}
              href={telHref(line.number)}
              className="press flex items-center gap-2.5 rounded-xl border border-line bg-paper-2/40 px-3 py-2.5"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-white">
                <Phone size={15} weight="fill" />
              </span>
              <span className="min-w-0">
                <span className="block text-note text-ink-3">{line.label}</span>
                <span className="block text-body font-semibold tabular-nums text-ink">{line.number}</span>
              </span>
            </a>
          ))}
        </div>
        <a
          href={telHref('+861012308')}
          className="press mt-2 flex items-center gap-2.5 rounded-xl border border-accent/30 bg-accent-soft/60 px-3 py-2.5"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-white">
            <Phone size={15} weight="fill" />
          </span>
          <span className="min-w-0">
            <span className="block text-note text-ink-2">{tr('中国外交部全球领事保护热线')}</span>
            <span className="block text-body font-semibold tabular-nums text-ink">+86 10 12308</span>
          </span>
        </a>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-4">
        <div className="flex items-center gap-1.5">
          <MapPinLine size={16} className="text-accent" />
          <p className="text-body font-medium text-ink">{tr('中国使领馆')}</p>
        </div>
        <p className="mt-1 text-caption text-ink-3">{tr('护照丢失、人身安全等问题可联系就近使领馆。')}</p>
        <div className="mt-2.5 divide-y divide-line">
          {EMBASSIES.map((item) => (
            <a
              key={`${item.city}-${item.phone}`}
              href={telHref(item.phone)}
              className="press flex items-center justify-between gap-2 py-2.5"
            >
              <span className="min-w-0 truncate text-body-sm text-ink">
                {item.city} <span className="text-caption text-ink-3">{item.country}</span>
              </span>
              <span className="shrink-0 text-caption tabular-nums text-accent">{item.phone}</span>
            </a>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-4">
        <div className="flex items-center gap-1.5">
          <Copy size={16} className="text-accent" />
          <p className="text-body font-medium text-ink">{tr('常用语')}</p>
        </div>
        <p className="mt-1 text-caption text-ink-3">{tr('点一下复制中英文，直接拿给当地人看。')}</p>
        <div className="mt-2.5 space-y-3">
          {PHRASE_GROUPS.map((group) => (
            <div key={group}>
              <p className="text-caption font-medium tracking-wide text-ink-3">{group}</p>
              <div className="mt-1.5 space-y-1.5">
                {PHRASES.filter((phrase) => phrase.group === group).map((phrase) => (
                  <button
                    key={phrase.zh}
                    type="button"
                    onClick={() => void copyPhrase(phrase)}
                    className="press flex w-full items-center gap-2 rounded-xl bg-paper-2/50 px-3 py-2 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-body-sm text-ink">{phrase.zh}</span>
                      <span className="block text-caption leading-4 text-ink-3">{phrase.en}</span>
                    </span>
                    <Copy size={14} className="shrink-0 text-ink-3" />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-4">
        <div className="flex items-center gap-1.5">
          <CurrencyCircleDollar size={16} className="text-accent" />
          <p className="text-body font-medium text-ink">{tr('汇率换算')}</p>
        </div>
        <div className="mt-2.5 flex gap-2">
          <input
            className="input flex-1 tabular-nums"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ''))}
            placeholder="100"
            aria-label={tr('金额')}
          />
          <select
            className="input w-[120px] shrink-0"
            value={currency}
            onChange={(event) => setCurrency(event.target.value as Currency)}
            aria-label={tr('币种')}
          >
            {CURRENCY_ORDER.map((item) => (
              <option key={item} value={item}>
                {CURRENCY_LABEL[item]}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => setToCny((value) => !value)}
          className="press mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl bg-paper-2/50 px-3 py-2 text-note text-ink-2"
        >
          <ArrowsLeftRight size={14} />
          {toCny ? tr('外币 → 人民币') : tr('人民币 → 外币')}
        </button>
        <p className="mt-2.5 text-center text-title font-semibold tabular-nums tracking-tight text-ink">
          {converted == null
            ? '—'
            : toCny
              ? `¥${formatMoney(converted)}`
              : `${CURRENCY_SYMBOL[currency]}${formatMoney(converted)}`}
        </p>
        <p className="mt-1 text-center text-caption text-ink-3">
          {tr('离线参考汇率：1 {currency} ≈ ¥{rate}', {
            currency,
            rate: CURRENCY_RATE_TO_CNY[currency],
          })}
        </p>
      </section>

      <section className="rounded-2xl border border-line bg-surface p-4">
        <div className="flex items-center gap-1.5">
          <Phone size={16} className="text-accent" />
          <p className="text-body font-medium text-ink">{tr('我的紧急联系人')}</p>
        </div>
        {contacts.length > 0 ? (
          <div className="mt-2.5 space-y-1.5">
            {contacts.map((contact) => (
              <div
                key={contact.id}
                className="flex items-center gap-2 rounded-xl bg-paper-2/50 px-3 py-2"
              >
                <a href={telHref(contact.phone)} className="min-w-0 flex-1">
                  <span className="block text-body-sm text-ink">{contact.name}</span>
                  <span className="block text-caption tabular-nums text-accent">{contact.phone}</span>
                </a>
                <button
                  type="button"
                  onClick={() => removeContact(contact.id)}
                  aria-label={tr('删除')}
                  className="press flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-3 hover:bg-paper-2 hover:text-ink"
                >
                  <Trash size={14} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-caption text-ink-3">{tr('加上家人或同伴的电话，紧急时一键拨打。')}</p>
        )}
        <div className="mt-2.5 flex gap-2">
          <input
            className="input min-w-0 flex-1"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder={tr('称呼')}
            aria-label={tr('称呼')}
          />
          <input
            className="input min-w-0 flex-1 tabular-nums"
            value={newPhone}
            onChange={(event) => setNewPhone(event.target.value)}
            placeholder={tr('电话')}
            inputMode="tel"
            aria-label={tr('电话')}
          />
          <button
            type="button"
            onClick={addContact}
            aria-label={tr('添加')}
            className="press flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent text-white"
          >
            <Plus size={17} weight="bold" />
          </button>
        </div>
      </section>
    </div>
  )
}

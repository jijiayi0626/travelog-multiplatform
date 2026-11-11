import { EN_TEXT } from './i18n-en'

export type Lang = 'zh' | 'en'

export type Vars = Record<string, string | number>

const KEY = 'travelog.lang'

const ZH = {
  'nav.trips': '行程',
  'nav.album': '相册',
  'nav.footprints': '足迹',
  'nav.expenses': '账本',
  'nav.profile': '我的',
  'nav.search': '搜索',
  'nav.shortcuts': '快捷键',
  'nav.dark': '切换到深色',
  'nav.light': '切换到浅色',
  'nav.local': '本地优先',

  'trips.title': '我的旅行',
  'trips.subtitle': 'Your journeys',
  'trips.new': '新建',
  'trips.list': '列表',
  'trips.calendar': '日历',
  'trips.all': '全部',
  'trips.planned': '计划中',
  'trips.ongoing': '进行中',
  'trips.finished': '已结束',
  'trips.empty': '还没有旅行记录',
  'trips.emptyHint': '新建一段旅程，把日程、照片、地点和花费都收进来。',

  'album.title': '相册',
  'album.subtitle': 'Album',
  'album.byTrip': '按旅程',
  'album.byTime': '按时间',
  'album.empty': '相册还是空的',

  'footprints.title': '我的足迹',
  'footprints.subtitle': 'Footprints',
  'footprints.china': '中国',
  'footprints.stars': '星图',
  'footprints.list': '列表',
  'footprints.checkin': '打卡',
  'footprints.empty': '还没有足迹',

  'expenses.title': '账本',
  'expenses.subtitle': 'Ledger',
  'expenses.add': '记一笔',
  'expenses.total': '当前筛选合计',
  'expenses.empty': '当前筛选没有账目',

  'profile.title': '我的',
  'profile.subtitle': 'Account',
  'profile.recap': '年度回顾',
  'profile.sync': '云同步',
  'profile.appearance': '外观',
  'profile.accent': '主题色',
  'profile.export': '导出备份',
  'profile.import': '导入备份',
  'profile.reset': '恢复示例数据',
  'profile.autoCheckin': '自动打卡',
  'profile.ai': 'AI 助手',

  'recap.title': '年度回顾',
  'recap.subtitle': 'Year in review',
  'recap.spend': '全年花费',
  'recap.categories': '花在哪',
  'recap.moment': '这一刻',

  'sync.title': '云同步',
  'sync.connected': '已连接云端',
  'sync.disconnected': '未连接云端',
  'sync.server': '服务器',
  'sync.account': '账号',
  'sync.syncNow': '立即同步',
  'sync.signOut': '退出',
  'sync.autoSync': '自动同步',
  'sync.lastSync': '上次同步',
  'sync.never': '从未',

  'common.save': '保存',
  'common.cancel': '取消',
  'common.delete': '删除',
  'common.add': '添加',
  'common.export': '导出',
  'common.empty': '暂无内容',
  'common.today': '今天',
  'common.loading': '加载中…',
} as const

type DictKey = keyof typeof ZH

const EN: Record<DictKey, string> = {
  'nav.trips': 'Trips',
  'nav.album': 'Album',
  'nav.footprints': 'Footprints',
  'nav.expenses': 'Ledger',
  'nav.profile': 'Profile',
  'nav.search': 'Search',
  'nav.shortcuts': 'Shortcuts',
  'nav.dark': 'Switch to dark',
  'nav.light': 'Switch to light',
  'nav.local': 'Local-first',

  'trips.title': 'My trips',
  'trips.subtitle': 'Your journeys',
  'trips.new': 'New',
  'trips.list': 'List',
  'trips.calendar': 'Calendar',
  'trips.all': 'All',
  'trips.planned': 'Planned',
  'trips.ongoing': 'Ongoing',
  'trips.finished': 'Finished',
  'trips.empty': 'No trips yet',
  'trips.emptyHint': 'Create a trip to collect plans, photos, places and spending.',

  'album.title': 'Album',
  'album.subtitle': 'Album',
  'album.byTrip': 'By trip',
  'album.byTime': 'By date',
  'album.empty': 'Album is empty',

  'footprints.title': 'Footprints',
  'footprints.subtitle': 'Footprints',
  'footprints.china': 'China',
  'footprints.stars': 'Map',
  'footprints.list': 'List',
  'footprints.checkin': 'Check in',
  'footprints.empty': 'No footprints yet',

  'expenses.title': 'Ledger',
  'expenses.subtitle': 'Ledger',
  'expenses.add': 'Add',
  'expenses.total': 'Filtered total',
  'expenses.empty': 'No expenses match the filters',

  'profile.title': 'Profile',
  'profile.subtitle': 'Account',
  'profile.recap': 'Year in review',
  'profile.sync': 'Cloud sync',
  'profile.appearance': 'Appearance',
  'profile.accent': 'Accent',
  'profile.export': 'Export backup',
  'profile.import': 'Import backup',
  'profile.reset': 'Restore demo data',
  'profile.autoCheckin': 'Auto check-in',
  'profile.ai': 'AI assistant',

  'recap.title': 'Year in review',
  'recap.subtitle': 'Year in review',
  'recap.spend': 'Spending',
  'recap.categories': 'Where it went',
  'recap.moment': 'Highlights',

  'sync.title': 'Cloud sync',
  'sync.connected': 'Connected',
  'sync.disconnected': 'Not connected',
  'sync.server': 'Server',
  'sync.account': 'Account',
  'sync.syncNow': 'Sync now',
  'sync.signOut': 'Sign out',
  'sync.autoSync': 'Auto sync',
  'sync.lastSync': 'Last sync',
  'sync.never': 'Never',

  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.add': 'Add',
  'common.export': 'Export',
  'common.empty': 'Nothing here',
  'common.today': 'Today',
  'common.loading': 'Loading…',
}

const DICTS: Record<Lang, Record<DictKey, string>> = { zh: ZH, en: EN }

export function getLang(): Lang {
  const stored = localStorage.getItem(KEY)
  return stored === 'en' ? 'en' : 'zh'
}

export function setLang(lang: Lang): void {
  localStorage.setItem(KEY, lang)
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN'
}

export function translate(lang: Lang, key: DictKey): string {
  return DICTS[lang][key] ?? DICTS.zh[key] ?? key
}

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  )
}

/**
 * 中文原文 → 目标语言（支持 {name} 插值）。
 * 用于渐进式接入的页面：调用处不必发明英文 key，直接把原文包进 tr('…') 即可。
 */
export function translateText(lang: Lang, zh: string, vars?: Vars): string {
  const base = lang === 'en' ? EN_TEXT[zh] ?? zh : zh
  return interpolate(base, vars)
}

export type { DictKey }
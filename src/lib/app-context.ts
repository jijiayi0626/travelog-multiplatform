import { createContext, useContext } from 'react'
import type { View } from './types'
import { translate, type DictKey, type Lang, type Vars } from './i18n'

export const ToastContext = createContext<(message: string) => void>(() => {})

export interface RefreshApi {
  tick: number
  bump: () => void
}

export const RefreshContext = createContext<RefreshApi>({ tick: 0, bump: () => {} })

export interface NavApi {
  navigate: (view: View) => void
  back: () => void
}

export const NavContext = createContext<NavApi>({ navigate: () => {}, back: () => {} })

export const SearchContext = createContext<() => void>(() => {})

export const ShortcutsContext = createContext<() => void>(() => {})

export function useToast(): (message: string) => void {
  return useContext(ToastContext)
}

export function useRefresh(): RefreshApi {
  return useContext(RefreshContext)
}

export function useNav(): NavApi {
  return useContext(NavContext)
}

export function useSearch(): () => void {
  return useContext(SearchContext)
}

export function useShortcuts(): () => void {
  return useContext(ShortcutsContext)
}

export interface I18nApi {
  lang: Lang
  setLang: (lang: Lang) => void
  t: (key: DictKey) => string
  tr: (zh: string, vars?: Vars) => string
}

export const I18nContext = createContext<I18nApi>({
  lang: 'zh',
  setLang: () => {},
  t: (key) => translate('zh', key),
  tr: (zh) => zh,
})

export function useI18n(): I18nApi {
  return useContext(I18nContext)
}

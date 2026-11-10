import { createContext, useContext } from 'react'
import type { View } from './types'

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

export function useToast(): (message: string) => void {
  return useContext(ToastContext)
}

export function useRefresh(): RefreshApi {
  return useContext(RefreshContext)
}

export function useNav(): NavApi {
  return useContext(NavContext)
}
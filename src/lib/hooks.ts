import { useCallback, useEffect, useRef, useState } from 'react'
import { useRefresh } from './app-context'

export function useLoader<T>(loader: () => Promise<T>, initial: T, key = ''): { data: T; loading: boolean } {
  const { tick } = useRefresh()
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const [data, setData] = useState<T>(initial)
  const [loading, setLoading] = useState(true)
  const keyRef = useRef(key)
  const loadedRef = useRef(false)

  useEffect(() => {
    let alive = true
    if (keyRef.current !== key) {
      keyRef.current = key
      loadedRef.current = false
    }
    // 只有首次加载或切换数据源时显示骨架屏；同步等后台刷新静默更新，避免整页闪一下
    if (!loadedRef.current) setLoading(true)
    loaderRef.current()
      .then((value) => {
        if (alive) {
          loadedRef.current = true
          setData(value)
          setLoading(false)
        }
      })
      .catch(() => {
        if (alive) {
          loadedRef.current = true
          setLoading(false)
        }
      })
    return () => {
      alive = false
    }
  }, [tick, key])

  return { data, loading }
}

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (callback: () => void) => {
      const media = window.matchMedia(query)
      media.addEventListener('change', callback)
      return () => media.removeEventListener('change', callback)
    },
    [query],
  )
  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query])
  return useSyncExternalStoreCompat(subscribe, getSnapshot)
}

function useSyncExternalStoreCompat(subscribe: (cb: () => void) => () => void, getSnapshot: () => boolean): boolean {
  const [value, setValue] = useState(() => getSnapshot())
  useEffect(() => {
    const unsubscribe = subscribe(() => setValue(getSnapshot()))
    setValue(getSnapshot())
    return unsubscribe
  }, [subscribe, getSnapshot])
  return value
}

export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 1024px)')
}
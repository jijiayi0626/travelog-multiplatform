import { useCallback, useEffect, useRef, useState } from 'react'
import { useRefresh } from './app-context'

export function useLoader<T>(loader: () => Promise<T>, initial: T, key = ''): { data: T; loading: boolean } {
  const { tick } = useRefresh()
  const loaderRef = useRef(loader)
  loaderRef.current = loader
  const [data, setData] = useState<T>(initial)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    loaderRef.current()
      .then((value) => {
        if (alive) {
          setData(value)
          setLoading(false)
        }
      })
      .catch(() => {
        if (alive) {
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
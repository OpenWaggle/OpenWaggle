import { useSyncExternalStore } from 'react'

function getServerSnapshot(): boolean {
  return false
}

export function useMediaQuery(query: string): boolean {
  function subscribe(callback: () => void): () => void {
    if (typeof window === 'undefined') return () => {}
    const mediaQueryList = window.matchMedia(query)
    mediaQueryList.addEventListener('change', callback)
    return () => mediaQueryList.removeEventListener('change', callback)
  }

  function getSnapshot(): boolean {
    if (typeof window === 'undefined') return false
    return window.matchMedia(query).matches
  }

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

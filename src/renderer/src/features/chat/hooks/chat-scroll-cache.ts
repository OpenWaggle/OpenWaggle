import { isMatching, P } from '@diegogbrisa/ts-match'

export const SCROLL_UP_HYSTERESIS_PX = 1
export const SCROLLBAR_HIDE_DELAY_MS = 800
export const SCROLL_PERSIST_DEBOUNCE_MS = 150
export const SESSION_RESTORE_RETRY_MS = 96

const SCROLL_CACHE_MAX_ENTRIES = 100
const SCROLL_CACHE_KEY = 'openwaggle:scroll-positions'

function isScrollCacheEntry(value: unknown): value is readonly [string, number] {
  return isMatching(P.tuple([P.string, P.finite]), value)
}

export function loadScrollCache(): Map<string, number> {
  try {
    const raw = localStorage.getItem(SCROLL_CACHE_KEY)
    if (!raw) return new Map()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Map()
    const entries = parsed.filter(isScrollCacheEntry)
    return new Map<string, number>(entries)
  } catch {
    return new Map()
  }
}

export function saveScrollCache(cache: Map<string, number>) {
  while (cache.size > SCROLL_CACHE_MAX_ENTRIES) {
    const firstKey: string | undefined = cache.keys().next().value
    if (firstKey === undefined) break
    cache.delete(firstKey)
  }
  try {
    localStorage.setItem(SCROLL_CACHE_KEY, JSON.stringify([...cache]))
  } catch {
    // Ignore storage errors.
  }
}

import { create } from 'zustand'
import type { StateStorage } from 'zustand/middleware'
import { createJSONStorage, persist } from 'zustand/middleware'
import { normalizeBrowserPreviewUrl } from '../lib/browser-preview-url'

export const BROWSER_PREVIEW_RECENT_URL_LIMIT = 10
export const BROWSER_PREVIEW_RECENT_STORAGE_KEY = 'openwaggle:browser-preview-recents:v1'
const RECENT_TITLE_LENGTH_LIMIT = 512

export interface BrowserPreviewRecentUrl {
  readonly url: string
  readonly title: string
  readonly visitedAt: number
}

interface BrowserPreviewRecentState {
  readonly entries: readonly BrowserPreviewRecentUrl[]
  readonly remember: (entry: BrowserPreviewRecentUrl) => void
  readonly clear: () => void
}

const memoryStorage = new Map<string, string>()

function fallbackStorage(): StateStorage {
  return {
    getItem: (key) => memoryStorage.get(key) ?? null,
    setItem: (key, value) => {
      memoryStorage.set(key, value)
    },
    removeItem: (key) => {
      memoryStorage.delete(key)
    },
  }
}

function resolveStorage(): StateStorage {
  return typeof window === 'undefined' ? fallbackStorage() : window.localStorage
}

function sanitizeEntry(value: unknown): BrowserPreviewRecentUrl | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const urlValue = 'url' in value ? value.url : undefined
  const titleValue = 'title' in value ? value.title : undefined
  const visitedAtValue = 'visitedAt' in value ? value.visitedAt : undefined
  if (typeof urlValue !== 'string') return null
  const url = normalizeBrowserPreviewUrl(urlValue)
  if (url === null) return null
  const title =
    typeof titleValue === 'string' && titleValue.trim().length > 0
      ? titleValue.trim().slice(0, RECENT_TITLE_LENGTH_LIMIT)
      : new URL(url).hostname
  const visitedAt =
    typeof visitedAtValue === 'number' && Number.isFinite(visitedAtValue) && visitedAtValue >= 0
      ? visitedAtValue
      : 0
  return { url, title, visitedAt }
}

export function sanitizeBrowserPreviewRecentUrls(
  value: unknown,
): readonly BrowserPreviewRecentUrl[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const entries: BrowserPreviewRecentUrl[] = []
  for (const candidate of value) {
    const entry = sanitizeEntry(candidate)
    if (entry === null || seen.has(entry.url)) continue
    seen.add(entry.url)
    entries.push(entry)
    if (entries.length === BROWSER_PREVIEW_RECENT_URL_LIMIT) break
  }
  return entries
}

export const useBrowserPreviewRecentStore = create<BrowserPreviewRecentState>()(
  persist(
    (set) => ({
      entries: [],
      remember(entry) {
        const sanitized = sanitizeEntry(entry)
        if (sanitized === null) return
        set((state) => ({
          entries: [sanitized, ...state.entries.filter((item) => item.url !== sanitized.url)].slice(
            0,
            BROWSER_PREVIEW_RECENT_URL_LIMIT,
          ),
        }))
      },
      clear: () => set({ entries: [] }),
    }),
    {
      name: BROWSER_PREVIEW_RECENT_STORAGE_KEY,
      storage: createJSONStorage(resolveStorage),
      partialize: (state) => ({ entries: state.entries }),
      merge: (persisted, current) => ({
        ...current,
        entries: sanitizeBrowserPreviewRecentUrls(
          persisted !== null && typeof persisted === 'object'
            ? Reflect.get(persisted, 'entries')
            : undefined,
        ),
      }),
    },
  ),
)

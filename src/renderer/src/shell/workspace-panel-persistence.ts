import { safeDecodeUnknown } from '@shared/schema'
import { browserProfileIdSchema } from '@shared/schemas/browser-profile'
import { DEFAULT_BROWSER_PROFILE_ID } from '@shared/types/browser-profile'
import type { StateStorage } from 'zustand/middleware'
import { normalizeBrowserPreviewUrl } from '@/features/browser-preview'
import {
  type BrowserPreviewTabState,
  browserPreviewTitle,
  lastBrowserSurface,
  MAX_BROWSER_TABS,
  type WorkspacePanelGroupState,
  type WorkspacePanelSurface,
} from './workspace-panel-model'

export const WORKSPACE_PANEL_STORAGE_KEY = 'openwaggle:workspace-panel:v1'

const memoryStorage = new Map<string, string>()

function isUnknownRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function resolveWorkspacePanelStorage(): StateStorage {
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
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

function sanitizeTab(value: unknown, ownerKey: string): BrowserPreviewTabState | null {
  if (!isUnknownRecord(value)) return null
  const { id, url, title } = value
  if (typeof id !== 'string' || id.length === 0) return null
  const decodedProfile = safeDecodeUnknown(browserProfileIdSchema, value.profileId)
  const profileId = decodedProfile.success ? decodedProfile.data : DEFAULT_BROWSER_PROFILE_ID
  if (value.kind === 'launcher') {
    return {
      id,
      ownerKey,
      kind: 'launcher',
      profileId,
      url: '',
      title: typeof title === 'string' && title.length > 0 ? title : 'New tab',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      error: null,
      audioMuted: value.audioMuted === true,
      audible: false,
      favicon: null,
      controller: { kind: 'human' },
    }
  }
  if (typeof url !== 'string') return null
  const normalizedUrl = normalizeBrowserPreviewUrl(url)
  if (normalizedUrl === null) return null
  return {
    id,
    ownerKey,
    kind: 'preview',
    profileId,
    url: normalizedUrl,
    title:
      typeof title === 'string' && title.length > 0 ? title : browserPreviewTitle(normalizedUrl),
    loading: false,
    canGoBack: false,
    canGoForward: false,
    error: null,
    audioMuted: value.audioMuted === true,
    audible: false,
    favicon: null,
    controller: { kind: 'human' },
  }
}

function sanitizeTabs(value: unknown, ownerKey: string): readonly BrowserPreviewTabState[] {
  if (!Array.isArray(value)) return []
  return value
    .flatMap((entry) => {
      const tab = sanitizeTab(entry, ownerKey)
      return tab === null ? [] : [tab]
    })
    .slice(-MAX_BROWSER_TABS)
}

function browserSurface(
  rawActive: Readonly<Record<string, unknown>>,
  browserTabs: readonly BrowserPreviewTabState[],
): WorkspacePanelSurface {
  if (rawActive.kind !== 'browser') return null
  const { previewId } = rawActive
  if (typeof previewId !== 'string') return null
  return browserTabs.some((tab) => tab.id === previewId) ? { kind: 'browser', previewId } : null
}

function sanitizeActiveSurface(
  value: unknown,
  browserTabs: readonly BrowserPreviewTabState[],
): WorkspacePanelSurface {
  if (isUnknownRecord(value)) {
    if (value.kind === 'terminal') return { kind: 'terminal' }
    const activeBrowser = browserSurface(value, browserTabs)
    if (activeBrowser !== null) return activeBrowser
  }
  return lastBrowserSurface(browserTabs)
}

function sanitizeGroup(value: unknown, ownerKey: string): WorkspacePanelGroupState | null {
  if (!isUnknownRecord(value)) return null
  const browserTabs = sanitizeTabs(value.browserTabs, ownerKey)
  const activeSurface = sanitizeActiveSurface(value.activeSurface, browserTabs)
  if (browserTabs.length === 0 && activeSurface?.kind !== 'terminal') return null
  const rawPanelOpen = value.panelOpen
  return {
    browserTabs,
    activeSurface,
    maximized: value.maximized === true,
    panelOpen: typeof rawPanelOpen === 'boolean' ? rawPanelOpen : activeSurface !== null,
  }
}

export function sanitizeWorkspacePanelGroups(
  value: unknown,
): Record<string, WorkspacePanelGroupState> {
  if (!isUnknownRecord(value)) return {}
  const groups: Record<string, WorkspacePanelGroupState> = {}
  for (const [ownerKey, valueAtOwner] of Object.entries(value)) {
    if (ownerKey.length === 0) continue
    const group = sanitizeGroup(valueAtOwner, ownerKey)
    if (group !== null) groups[ownerKey] = group
  }
  return groups
}

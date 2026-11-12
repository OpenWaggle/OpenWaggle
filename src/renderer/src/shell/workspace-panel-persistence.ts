import { safeDecodeUnknown } from '@shared/schema'
import { browserProfileIdSchema } from '@shared/schemas/browser-profile'
import { DEFAULT_BROWSER_PROFILE_ID } from '@shared/types/browser-profile'
import type { UncheckedFields } from '@shared/types/unchecked-fields'
import { isObjectValue } from '@shared/utils/object-shape'
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

/** The fields of a persisted value, each checked on its own so one bad field drops only itself. */
function persistedFields<T>(value: unknown): UncheckedFields<T> | null {
  return isObjectValue(value) ? value : null
}

/** The fields any persisted active surface may carry. */
interface PersistedActiveSurface {
  readonly kind: NonNullable<WorkspacePanelSurface>['kind']
  readonly projectPath: string
  readonly runId: string
  readonly previewId: string
}

export function resolveWorkspacePanelStorage(): StateStorage {
  if (typeof window !== 'undefined') return window.localStorage
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
  const fields = persistedFields<BrowserPreviewTabState>(value)
  if (fields === null) return null
  const { id, url, title } = fields
  if (typeof id !== 'string' || id.length === 0) return null
  const decodedProfile = safeDecodeUnknown(browserProfileIdSchema, fields.profileId)
  const profileId = decodedProfile.success ? decodedProfile.data : DEFAULT_BROWSER_PROFILE_ID
  if (fields.kind === 'launcher') {
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
      audioMuted: fields.audioMuted === true,
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
    audioMuted: fields.audioMuted === true,
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
  rawActive: UncheckedFields<PersistedActiveSurface>,
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
  const surface = persistedFields<PersistedActiveSurface>(value)
  if (surface !== null) {
    const { kind, projectPath, runId } = surface
    if (kind === 'action' && typeof projectPath === 'string' && typeof runId === 'string') {
      if (runId.length > 0) return { kind: 'action', projectPath, runId }
    }
    if (kind === 'terminal') return { kind: 'terminal' }
    if (kind === 'project-actions') return { kind: 'project-actions' }
    if (kind === 'scheduled-tasks') return { kind: 'scheduled-tasks' }
    if (kind === 'all-panels') return { kind: 'all-panels' }
    const activeBrowser = browserSurface(surface, browserTabs)
    if (activeBrowser !== null) return activeBrowser
  }
  return lastBrowserSurface(browserTabs)
}

function sanitizeGroup(value: unknown, ownerKey: string): WorkspacePanelGroupState | null {
  const fields = persistedFields<WorkspacePanelGroupState>(value)
  if (fields === null) return null
  const browserTabs = sanitizeTabs(fields.browserTabs, ownerKey)
  const activeSurface = sanitizeActiveSurface(fields.activeSurface, browserTabs)
  const maximized = fields.maximized === true
  // A group may exist only to remember that the Session's Right panel is maximized.
  if (browserTabs.length === 0 && activeSurface === null && !maximized) return null
  const rawPanelOpen = fields.panelOpen
  return {
    browserTabs,
    activeSurface,
    maximized,
    panelOpen: typeof rawPanelOpen === 'boolean' ? rawPanelOpen : activeSurface !== null,
  }
}

export function sanitizeWorkspacePanelGroups(
  value: unknown,
): Record<string, WorkspacePanelGroupState> {
  if (!isObjectValue(value)) return {}
  const groups: Record<string, WorkspacePanelGroupState> = {}
  for (const [ownerKey, valueAtOwner] of Object.entries(value)) {
    if (ownerKey.length === 0) continue
    const group = sanitizeGroup(valueAtOwner, ownerKey)
    if (group !== null) groups[ownerKey] = group
  }
  return groups
}

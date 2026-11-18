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
function persistedFields<T>(value: unknown) {
  const fields: UncheckedFields<T> | null = isObjectValue(value) ? value : null
  return fields
}

/** The fields any persisted active surface may carry. */
interface PersistedActiveSurface {
  readonly kind: NonNullable<WorkspacePanelSurface>['kind']
  readonly projectPath: string
  readonly runId: string
  readonly previewId: string
}

export function resolveWorkspacePanelStorage() {
  if (typeof window !== 'undefined') {
    const storage: StateStorage = window.localStorage
    return storage
  }
  const storage: StateStorage = {
    getItem: (key) => memoryStorage.get(key) ?? null,
    setItem: (key, value) => {
      memoryStorage.set(key, value)
    },
    removeItem: (key) => {
      memoryStorage.delete(key)
    },
  }
  return storage
}

function sanitizeTab(value: unknown, ownerKey: string) {
  const fields = persistedFields<BrowserPreviewTabState>(value)
  if (fields === null) return null
  const { id, url, title } = fields
  if (typeof id !== 'string' || id.length === 0) return null
  const decodedProfile = safeDecodeUnknown(browserProfileIdSchema, fields.profileId)
  const profileId = decodedProfile.success ? decodedProfile.data : DEFAULT_BROWSER_PROFILE_ID
  if (fields.kind === 'launcher') {
    const state: BrowserPreviewTabState | null = {
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
    return state
  }
  if (typeof url !== 'string') return null
  const normalizedUrl = normalizeBrowserPreviewUrl(url)
  if (normalizedUrl === null) return null
  const state: BrowserPreviewTabState | null = {
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
  return state
}

function sanitizeTabs(value: unknown, ownerKey: string) {
  if (!Array.isArray(value)) {
    const state: readonly BrowserPreviewTabState[] = []
    return state
  }
  const state: readonly BrowserPreviewTabState[] = value
    .flatMap((entry) => {
      const tab = sanitizeTab(entry, ownerKey)
      return tab === null ? [] : [tab]
    })
    .slice(-MAX_BROWSER_TABS)
  return state
}

function browserSurface(
  rawActive: UncheckedFields<PersistedActiveSurface>,
  browserTabs: readonly BrowserPreviewTabState[],
) {
  if (rawActive.kind !== 'browser') return null
  const { previewId } = rawActive
  if (typeof previewId !== 'string') return null
  const surface: WorkspacePanelSurface = browserTabs.some((tab) => tab.id === previewId)
    ? { kind: 'browser', previewId }
    : null
  return surface
}

function sanitizeActiveSurface(value: unknown, browserTabs: readonly BrowserPreviewTabState[]) {
  const surface = persistedFields<PersistedActiveSurface>(value)
  if (surface !== null) {
    const { kind, projectPath, runId } = surface
    if (kind === 'action' && typeof projectPath === 'string' && typeof runId === 'string') {
      if (runId.length > 0) {
        const result: WorkspacePanelSurface = { kind: 'action', projectPath, runId }
        return result
      }
    }
    if (kind === 'terminal') {
      const result: WorkspacePanelSurface = { kind: 'terminal' }
      return result
    }
    if (kind === 'project-actions') {
      const result: WorkspacePanelSurface = { kind: 'project-actions' }
      return result
    }
    if (kind === 'scheduled-tasks') {
      const result: WorkspacePanelSurface = { kind: 'scheduled-tasks' }
      return result
    }
    if (kind === 'all-panels') {
      const result: WorkspacePanelSurface = { kind: 'all-panels' }
      return result
    }
    const activeBrowser = browserSurface(surface, browserTabs)
    if (activeBrowser !== null) {
      const result: WorkspacePanelSurface = activeBrowser
      return result
    }
  }
  const result: WorkspacePanelSurface = lastBrowserSurface(browserTabs)
  return result
}

function sanitizeGroup(value: unknown, ownerKey: string) {
  const fields = persistedFields<WorkspacePanelGroupState>(value)
  if (fields === null) return null
  const browserTabs = sanitizeTabs(fields.browserTabs, ownerKey)
  const activeSurface = sanitizeActiveSurface(fields.activeSurface, browserTabs)
  const maximized = fields.maximized === true
  // A group may exist only to remember that the Session's Right panel is maximized.
  if (browserTabs.length === 0 && activeSurface === null && !maximized) return null
  const rawPanelOpen = fields.panelOpen
  const state: WorkspacePanelGroupState | null = {
    browserTabs,
    activeSurface,
    maximized,
    panelOpen: typeof rawPanelOpen === 'boolean' ? rawPanelOpen : activeSurface !== null,
  }
  return state
}

export function sanitizeWorkspacePanelGroups(value: unknown) {
  if (!isObjectValue(value)) {
    const record: Record<string, WorkspacePanelGroupState> = {}
    return record
  }
  const groups: Record<string, WorkspacePanelGroupState> = {}
  for (const [ownerKey, valueAtOwner] of Object.entries(value)) {
    if (ownerKey.length === 0) continue
    const group = sanitizeGroup(valueAtOwner, ownerKey)
    if (group !== null) groups[ownerKey] = group
  }
  return groups
}

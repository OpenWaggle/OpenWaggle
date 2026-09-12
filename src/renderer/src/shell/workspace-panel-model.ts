import type {
  BrowserPreviewControllerState,
  BrowserPreviewFavicon,
} from '@shared/types/browser-preview'
import { DEFAULT_BROWSER_PROFILE_ID } from '@shared/types/browser-profile'

const RANDOM_ID_RADIX = 36
const RANDOM_ID_START = 2
const RANDOM_ID_END = 12

export const MAX_BROWSER_TABS = 8

export interface BrowserPreviewTabState {
  readonly id: string
  readonly ownerKey: string
  readonly kind: 'launcher' | 'preview'
  readonly profileId: string
  readonly url: string
  readonly title: string
  readonly loading: boolean
  readonly canGoBack: boolean
  readonly canGoForward: boolean
  readonly error: string | null
  readonly audioMuted: boolean
  readonly audible: boolean
  readonly favicon: BrowserPreviewFavicon | null
  readonly controller: BrowserPreviewControllerState
}

export type WorkspacePanelSurface =
  | { readonly kind: 'terminal' }
  | { readonly kind: 'browser'; readonly previewId: string }
  | null

export interface WorkspacePanelGroupState {
  readonly browserTabs: readonly BrowserPreviewTabState[]
  readonly activeSurface: WorkspacePanelSurface
  readonly maximized: boolean
  readonly panelOpen: boolean
}

export const EMPTY_WORKSPACE_PANEL_GROUP: WorkspacePanelGroupState = {
  browserTabs: [],
  activeSurface: null,
  maximized: false,
  panelOpen: false,
}

export function createBrowserPreviewId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `preview-${Date.now()}-${Math.random()
        .toString(RANDOM_ID_RADIX)
        .slice(RANDOM_ID_START, RANDOM_ID_END)}`
}

export function browserPreviewTitle(url: string) {
  try {
    const parsed = new URL(url)
    return parsed.hostname || parsed.href
  } catch {
    return url
  }
}

export function lastBrowserSurface(
  browserTabs: readonly BrowserPreviewTabState[],
): WorkspacePanelSurface {
  const last = browserTabs[browserTabs.length - 1]
  return last === undefined ? null : { kind: 'browser', previewId: last.id }
}

export function createBrowserPreviewTab(
  ownerKey: string,
  url: string,
  profileId = DEFAULT_BROWSER_PROFILE_ID,
  id = createBrowserPreviewId(),
): BrowserPreviewTabState {
  return {
    id,
    ownerKey,
    kind: 'preview',
    profileId,
    url,
    title: browserPreviewTitle(url),
    loading: true,
    canGoBack: false,
    canGoForward: false,
    error: null,
    audioMuted: false,
    audible: false,
    favicon: null,
    controller: { kind: 'human' },
  }
}

export function createBrowserPreviewLauncherTab(
  ownerKey: string,
  profileId = DEFAULT_BROWSER_PROFILE_ID,
  id = createBrowserPreviewId(),
): BrowserPreviewTabState {
  return {
    id,
    ownerKey,
    kind: 'launcher',
    profileId,
    url: '',
    title: 'New tab',
    loading: false,
    canGoBack: false,
    canGoForward: false,
    error: null,
    audioMuted: false,
    audible: false,
    favicon: null,
    controller: { kind: 'human' },
  }
}

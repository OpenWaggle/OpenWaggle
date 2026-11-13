import { matchBy } from '@diegogbrisa/ts-match'
import { isBrowserPreviewUrl, normalizeBrowserPreviewUrl } from '@shared/schemas/browser-preview'
import {
  type BrowserPreviewOpenInput,
  type BrowserPreviewState,
} from '@shared/types/browser-preview'
import { DEFAULT_BROWSER_PREVIEW_CONTROL_STATE } from '@shared/types/browser-preview-controls'
import type { CdpSocketFactory } from './cdp-connection'
import type { CefDevToolsEndpoint } from './cef-devtools-endpoint'
import {
  browserPreviewMarkerUrl,
  type ElectrobunPreviewGuestEvent,
  newBrowserPreviewMarker,
} from './electrobun-preview-cdp-protocol'
import { ElectrobunPreviewGuest, type ElectrobunPreviewView } from './electrobun-preview-guest'
import type { ElectrobunOwnerWindow } from './electrobun-owner-windows'
import type { ElectrobunPreviewOwner, ElectrobunPreviewRecord } from './electrobun-preview-records'
import type { NativeWebviewFrames } from './electrobun-webview-frames'
import type { PrepareBrowserPreviewAnnotation } from '../../browser-preview/annotation/browser-preview-annotation'
import type { BrowserPreviewArtifactStorage } from '../../browser-preview/browser-preview-artifact-storage'
import { emitBrowserPreviewState } from '../../browser-preview/browser-preview-owner-events'
import {
  boundedBrowserPreviewText,
  browserPreviewStateError,
  MAX_TITLE_LENGTH,
} from '../../browser-preview/browser-preview-page-state'
import { browserPreviewPartition } from '../../browser-preview/browser-preview-partitions'
import type { BrowserEngineShape } from '../../../ports/desktop-shell/browser-engine'
import type { RendererSurface } from '../../../ports/desktop-shell/renderer-surfaces'

/** Navigation a CEF preview may make: the web, plus the blank page it starts on. */
export const BROWSER_PREVIEW_NAVIGATION_RULES = ['^*', 'http://*', 'https://*', 'about:blank*']

/** What the Electrobun Browser preview needs from the shell; tests give it fakes. */
export interface ElectrobunPreviewHost {
  /** CEF itself; no view is created before it is ready (on macOS a downloadable component). */
  readonly engine: Pick<BrowserEngineShape, 'ensure' | 'status'>
  /** A sandboxed CEF `BrowserView` in `windowId`, hidden until it is given bounds. */
  readonly createView: (options: {
    readonly windowId: number
    readonly url: string
    readonly partition: string
  }) => ElectrobunPreviewView
  readonly frames: NativeWebviewFrames
  /** CEF's DevTools endpoint, or `null` when the app enables no remote-debugging port. */
  readonly endpoint: () => CefDevToolsEndpoint | null
  readonly openSocket: CdpSocketFactory
  /** The Electrobun window an owner page lives in; `null` when it has none. */
  readonly ownerWindowOf: (owner: RendererSurface) => ElectrobunOwnerWindow | null
  /** A hidden window for previews no owner shows (profile maintenance). */
  readonly maintenanceWindowId: () => number
  readonly artifacts: () => BrowserPreviewArtifactStorage
  readonly revealInFolder: (artifactPath: string) => void
  /** Commits an annotation's screenshot as a composer attachment; the Session Host's by default. */
  readonly prepareAnnotation?: PrepareBrowserPreviewAnnotation
  readonly writeClipboardImage: (png: Uint8Array) => Promise<void>
  readonly isMac: boolean
  /**
   * Whether the engine drops a partition's in-memory data when its last view closes: WebView2's
   * profiles do (Windows), CEF's request contexts do not (`keepingPartitionsLoaded`).
   */
  readonly unloadsPartitionWithLastView: boolean
}

function initialState(input: BrowserPreviewOpenInput, canonicalUrl: string) {
  return {
    previewId: input.previewId,
    ownerKey: input.ownerKey,
    profileId: input.profileId,
    url: canonicalUrl,
    title: '',
    loading: true,
    canGoBack: false,
    canGoForward: false,
    error: null,
    audioMuted: input.audioMuted ?? false,
    // CDP reports no page audio; an Electrobun preview never shows the audible indicator.
    audible: false,
    favicon: null,
    controller: { kind: 'human' },
    controls: {
      ...DEFAULT_BROWSER_PREVIEW_CONTROL_STATE,
      ...input.initialControls,
      viewport: {
        ...(input.initialControls?.viewport ?? DEFAULT_BROWSER_PREVIEW_CONTROL_STATE.viewport),
      },
    },
  } satisfies BrowserPreviewState
}

/** The state after one guest event, or `null` when the event changes no state. */
export function browserPreviewStateAfter(
  state: BrowserPreviewState,
  event: ElectrobunPreviewGuestEvent,
) {
  return matchBy(event, 'kind')
    .with('loading', () => ({ ...state, loading: true, error: null }))
    .with('loaded', () => ({ ...state, loading: false }))
    .with('navigated', ({ url, sameDocument }) => {
      if (!isBrowserPreviewUrl(url)) return null
      const next = normalizeBrowserPreviewUrl(url)
      // A new document reports its own title once it loads.
      const title = sameDocument || next === state.url ? state.title : ''
      return { ...state, url: next, title, error: null }
    })
    .with('title', ({ title }) => ({
      ...state,
      title: boundedBrowserPreviewText(title, MAX_TITLE_LENGTH),
    }))
    .with('history', ({ canGoBack, canGoForward }) => ({ ...state, canGoBack, canGoForward }))
    .with('failed', ({ code, description, url }) => ({
      ...state,
      loading: false,
      error: browserPreviewStateError(code, description, url),
    }))
    .with('crashed', () => ({
      ...state,
      loading: false,
      error: browserPreviewStateError(
        'RENDERER_GONE',
        'The preview page crashed. Reload to recover it.',
        state.url,
      ),
    }))
    .with('key', 'detached', () => null)
    .exhaustive()
}

/** Creates a preview's native view and guest; the record starts hidden and loading. */
export function createElectrobunPreviewRecord(options: {
  readonly host: ElectrobunPreviewHost
  readonly owner: ElectrobunPreviewOwner
  readonly input: BrowserPreviewOpenInput
  readonly canonicalUrl: string
  readonly onOwnerEventFailure: () => void
  readonly onGuestEvent: (
    record: ElectrobunPreviewRecord,
    event: ElectrobunPreviewGuestEvent,
  ) => void
}) {
  const { host, owner, input } = options
  const marker = newBrowserPreviewMarker()
  const view = host.createView({
    windowId: owner.windowId,
    url: browserPreviewMarkerUrl(marker),
    partition: browserPreviewPartition(input.profileId),
  })
  const holder: { record: ElectrobunPreviewRecord | null } = { record: null }
  const guest = new ElectrobunPreviewGuest({
    view,
    marker,
    endpoint: host.endpoint(),
    openSocket: host.openSocket,
    onEvent: (event) => {
      if (holder.record !== null) options.onGuestEvent(holder.record, event)
    },
  })
  const record: ElectrobunPreviewRecord = {
    previewId: input.previewId,
    ownerKey: input.ownerKey,
    profileId: input.profileId,
    owner,
    guest,
    webviewId: view.id,
    state: initialState(input, options.canonicalUrl),
    bounds: null,
    disposed: false,
    claimedShortcutKeys: new Set(),
    onOwnerEventFailure: options.onOwnerEventFailure,
    destroyedListeners: [],
  }
  holder.record = record
  return record
}

/** Applies a guest event to its record and tells the owner. */
export function applyElectrobunPreviewGuestEvent(
  record: ElectrobunPreviewRecord,
  event: ElectrobunPreviewGuestEvent,
) {
  if (record.disposed) return
  const next = browserPreviewStateAfter(record.state, event)
  if (next === null) return
  record.state = next
  emitBrowserPreviewState(record)
}

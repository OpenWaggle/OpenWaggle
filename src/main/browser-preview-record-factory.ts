import type { BrowserPreviewOpenInput } from '@shared/types/browser-preview'
import { DEFAULT_BROWSER_PREVIEW_CONTROL_STATE } from '@shared/types/browser-preview-controls'
import { WebContentsView } from 'electron'
import { browserPreviewWebPreferences, installPreviewSessionPolicy } from './browser-preview-policy'
import type { BrowserPreviewOwnerRecord, BrowserPreviewRecord } from './browser-preview-records'

interface BrowserPreviewRecordInput {
  readonly input: BrowserPreviewOpenInput
  readonly canonicalUrl: string
  readonly owner: BrowserPreviewOwnerRecord
  readonly onOwnerEventFailure: () => void
}

export function createBrowserPreviewRecord(
  options: BrowserPreviewRecordInput,
): BrowserPreviewRecord {
  const { canonicalUrl, input, owner, onOwnerEventFailure } = options
  const controls = {
    ...DEFAULT_BROWSER_PREVIEW_CONTROL_STATE,
    ...input.initialControls,
    viewport: {
      ...(input.initialControls?.viewport ?? DEFAULT_BROWSER_PREVIEW_CONTROL_STATE.viewport),
    },
  }
  const view = new WebContentsView({
    webPreferences: browserPreviewWebPreferences(input.profileId),
  })
  try {
    view.webContents.setIgnoreMenuShortcuts(true)
    view.webContents.setZoomFactor(controls.zoomFactor)
    view.webContents.setAudioMuted(input.audioMuted ?? false)
    installPreviewSessionPolicy(view.webContents.session)
    return {
      previewId: input.previewId,
      ownerKey: input.ownerKey,
      profileId: input.profileId,
      view,
      owner,
      state: {
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
        audible: false,
        favicon: null,
        controller: { kind: 'human' },
        controls,
      },
      bounds: input.visible ? input.bounds : null,
      loadGeneration: 0,
      disposed: false,
      claimedShortcutKeys: new Set(),
      onOwnerEventFailure,
      removeListeners: [],
    }
  } catch (error) {
    try {
      if (!view.webContents.isDestroyed()) view.webContents.close()
    } catch {
      // Preserve the setup failure after making a best effort to release the partial view.
    }
    throw error
  }
}

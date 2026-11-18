import type { BrowserPreviewState } from '@shared/types/browser-preview'
import { type SyntheticEvent, useCallback, useState } from 'react'
import { usePreferencesStore } from '@/features/settings/state'
import { trackBrowserPreviewOwnerWork } from '@/shared/lib/browser-preview-owner-work'
import { api } from '@/shared/lib/ipc'
import {
  isWorkspaceOwnerHandoffPending,
  WORKSPACE_OWNER_HANDOFF_MESSAGE,
} from '@/shared/lib/workspace-owner-handoff'
import type { BrowserPreviewPanelCallbacks, BrowserPreviewTab } from '../browser-preview-model'
import {
  browserPreviewBounds,
  HIDDEN_BROWSER_PREVIEW_BOUNDS,
} from '../lib/browser-preview-native-bounds'
import { normalizeBrowserPreviewUrl } from '../lib/browser-preview-url'

interface ControlOptions extends Pick<BrowserPreviewPanelCallbacks, 'onError' | 'onUpdate'> {
  readonly addressRef: React.RefObject<HTMLInputElement | null>
  readonly onState: (state: BrowserPreviewState) => void
  readonly tab: BrowserPreviewTab
  readonly viewportRef: React.RefObject<HTMLDivElement | null>
}

export function useBrowserPreviewControls(options: ControlOptions) {
  const [address, setAddress] = useState(options.tab.url)
  // The page navigating on its own replaces whatever the address bar held.
  const [shownUrl, setShownUrl] = useState(options.tab.url)
  if (shownUrl !== options.tab.url) {
    setShownUrl(options.tab.url)
    setAddress(options.tab.url)
  }
  const { onError, onState } = options
  const runControl = useCallback(
    (action: () => Promise<BrowserPreviewState>, fallback: string) => {
      void action()
        .then(onState)
        .catch((error: unknown) => {
          onError(error instanceof Error ? error.message : fallback)
        })
    },
    [onError, onState],
  )
  const navigate = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    const url = normalizeBrowserPreviewUrl(address)
    if (url === null) {
      options.onError('Enter a valid http or https address.')
      options.addressRef.current?.select()
      return
    }
    options.onUpdate({ url, loading: true, error: null })
    runControl(() => api.navigateBrowserPreview(options.tab.id, url), 'Preview could not navigate.')
  }
  const retry = () => {
    if (isWorkspaceOwnerHandoffPending(options.tab.ownerKey)) {
      options.onError(WORKSPACE_OWNER_HANDOFF_MESSAGE)
      return
    }
    const reload = async () => {
      try {
        return await api.reloadBrowserPreview(options.tab.id)
      } catch {
        const viewport = options.viewportRef.current
        const visibleBounds = viewport === null ? null : browserPreviewBounds(viewport)
        const settings = usePreferencesStore.getState().settings
        return api.openBrowserPreview({
          previewId: options.tab.id,
          ownerKey: options.tab.ownerKey,
          profileId: options.tab.profileId,
          url: options.tab.url,
          bounds: visibleBounds ?? HIDDEN_BROWSER_PREVIEW_BOUNDS,
          visible: visibleBounds !== null,
          audioMuted: options.tab.audioMuted,
          initialControls: {
            viewport: settings.browserDefaultViewport,
            zoomFactor: settings.browserDefaultZoomFactor,
            appearance: settings.browserDefaultAppearance,
          },
        })
      }
    }
    void trackBrowserPreviewOwnerWork(options.tab.ownerKey, reload)
      .then(options.onState)
      .catch((error: unknown) => {
        options.onError(error instanceof Error ? error.message : 'Preview could not reload.')
      })
    options.onUpdate({ loading: true, error: null })
  }
  return { address, navigate, retry, runControl, setAddress }
}

export type BrowserPreviewControls = ReturnType<typeof useBrowserPreviewControls>

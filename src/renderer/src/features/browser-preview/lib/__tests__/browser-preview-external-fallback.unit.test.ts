import type { BrowserPreviewState } from '@shared/types/browser-preview'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  browserPreviewExternalFallbackForState,
  clearBrowserPreviewExternalFallback,
  registerBrowserPreviewExternalFallback,
} from '../browser-preview-external-fallback'

const STATE: BrowserPreviewState = {
  previewId: 'preview-1',
  ownerKey: 'session-1',
  profileId: 'default',
  url: 'http://127.0.0.1:5173/',
  title: '',
  loading: true,
  canGoBack: false,
  canGoForward: false,
  error: null,
  audioMuted: false,
  audible: false,
  favicon: null,
  controller: { kind: 'human' },
  controls: {
    zoomFactor: 1,
    appearance: 'system',
    viewport: { mode: 'fill' },
    pictureInPicture: false,
    picking: false,
    recording: false,
  },
}

describe('browser preview external fallback', () => {
  beforeEach(() => clearBrowserPreviewExternalFallback(STATE.previewId))

  it('retains a fallback while loading and consumes it exactly once on failure', () => {
    registerBrowserPreviewExternalFallback(STATE.previewId, STATE.url)

    expect(browserPreviewExternalFallbackForState(STATE)).toBeNull()
    expect(
      browserPreviewExternalFallbackForState({
        ...STATE,
        loading: false,
        error: { code: '-102', description: 'Connection refused', url: STATE.url },
      }),
    ).toBe(STATE.url)
    expect(
      browserPreviewExternalFallbackForState({
        ...STATE,
        loading: false,
        error: { code: '-102', description: 'Connection refused', url: STATE.url },
      }),
    ).toBeNull()
  })

  it('clears a pending fallback when the first navigation succeeds', () => {
    registerBrowserPreviewExternalFallback(STATE.previewId, STATE.url)

    expect(browserPreviewExternalFallbackForState({ ...STATE, loading: false })).toBeNull()
    expect(
      browserPreviewExternalFallbackForState({
        ...STATE,
        loading: false,
        error: { code: '-2', description: 'Later failure', url: STATE.url },
      }),
    ).toBeNull()
  })
})

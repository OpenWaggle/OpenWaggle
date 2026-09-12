import type { BrowserPreviewState } from '@shared/types/browser-preview'
import { DEFAULT_BROWSER_PREVIEW_CONTROL_STATE } from '@shared/types/browser-preview-controls'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { drainBrowserPreviewOwnerWork } from '@/shared/lib/browser-preview-owner-work'
import { beginWorkspaceOwnerHandoff } from '@/shared/lib/workspace-owner-handoff'
import type { BrowserPreviewTab } from '../../browser-preview-model'
import { useBrowserPreviewControls } from '../useBrowserPreviewControls'

const api = vi.hoisted(() => ({
  reloadBrowserPreview: vi.fn<() => Promise<BrowserPreviewState>>(),
  openBrowserPreview: vi.fn<() => Promise<BrowserPreviewState>>(),
}))
vi.mock('@/shared/lib/ipc', () => ({ api }))

const tab: BrowserPreviewTab = {
  id: 'retry-preview',
  ownerKey: 'draft:/retry',
  kind: 'preview',
  profileId: 'default',
  url: 'https://example.com/',
  title: 'Example',
  loading: false,
  canGoBack: false,
  canGoForward: false,
  error: null,
  audioMuted: false,
  audible: false,
  favicon: null,
  controller: { kind: 'human' },
}
const state: BrowserPreviewState = {
  ...tab,
  previewId: tab.id,
  error: null,
  controls: DEFAULT_BROWSER_PREVIEW_CONTROL_STATE,
}

function renderControls() {
  const onError = vi.fn()
  const onState = vi.fn()
  const controls = renderHook(() =>
    useBrowserPreviewControls({
      addressRef: createRef<HTMLInputElement>(),
      viewportRef: createRef<HTMLDivElement>(),
      tab,
      onError,
      onState,
      onUpdate: vi.fn(),
    }),
  )
  return { ...controls, onError, onState }
}

describe('browser retry handoff admission', () => {
  beforeEach(() => vi.resetAllMocks())

  it('reports busy without recreating the old owner preview', () => {
    const controls = renderControls()
    const release = beginWorkspaceOwnerHandoff(tab.ownerKey, 'session-retry')
    try {
      act(() => controls.result.current.retry())
      expect(api.reloadBrowserPreview).not.toHaveBeenCalled()
      expect(api.openBrowserPreview).not.toHaveBeenCalled()
      expect(controls.onError).toHaveBeenCalledWith(expect.stringContaining('tabs are moving'))
    } finally {
      release()
    }
  })

  it('drains an admitted retry including its reopen fallback', async () => {
    const reopened = Promise.withResolvers<BrowserPreviewState>()
    api.reloadBrowserPreview.mockRejectedValue(new Error('view was evicted'))
    api.openBrowserPreview.mockReturnValue(reopened.promise)
    const controls = renderControls()
    act(() => controls.result.current.retry())
    const release = beginWorkspaceOwnerHandoff(tab.ownerKey, 'session-retry')
    try {
      let drained = false
      const drain = drainBrowserPreviewOwnerWork(tab.ownerKey).then(() => {
        drained = true
      })
      await waitFor(() => expect(api.openBrowserPreview).toHaveBeenCalledOnce())
      expect(drained).toBe(false)
      await act(async () => reopened.resolve(state))
      await drain
      expect(drained).toBe(true)
      expect(controls.onState).toHaveBeenCalledWith(state)
    } finally {
      reopened.resolve(state)
      release()
    }
  })
})

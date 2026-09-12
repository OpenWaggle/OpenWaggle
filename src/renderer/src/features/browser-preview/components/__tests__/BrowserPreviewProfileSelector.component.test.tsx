import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { BrowserPreviewMaterializedTab } from '../../browser-preview-model'
import { BrowserPreviewProfileSelector } from '../BrowserPreviewProfileSelector'

const api = vi.hoisted(() => ({
  closeBrowserPreview: vi.fn<() => Promise<void>>(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api }))

const TAB: BrowserPreviewMaterializedTab = {
  id: 'preview-1',
  ownerKey: 'session-1',
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

describe('BrowserPreviewProfileSelector', () => {
  it('keeps the current profile when its native preview cannot close', async () => {
    const onError = vi.fn()
    const onUpdate = vi.fn()
    api.closeBrowserPreview.mockRejectedValueOnce(new Error('native close failed'))
    render(<BrowserPreviewProfileSelector tab={TAB} onError={onError} onUpdate={onUpdate} />)

    fireEvent.change(screen.getByRole('combobox', { name: 'Browser profile' }), {
      target: { value: 'incognito' },
    })

    await waitFor(() => expect(onError).toHaveBeenCalledWith('native close failed'))
    expect(onUpdate).not.toHaveBeenCalled()
  })
})

import { act, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  observeBrowserPreviewBounds,
  pageHasOccludingDialog,
} from '../browser-preview-native-bounds'

const api = vi.hoisted(() => ({ setBrowserPreviewBounds: vi.fn(async () => undefined) }))
vi.mock('@/shared/lib/ipc', () => ({ api }))

describe('native preview Session overlay ownership', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    api.setBrowserPreviewBounds.mockClear()
  })

  it('hides and restores native bounds while only its owning Session Summary is displayed', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    const view = render(<div data-testid="viewport" />)
    const viewport = view.getByTestId('viewport')
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 300, 200))
    const dispose = observeBrowserPreviewBounds({
      previewId: 'preview-1',
      ownerKey: 'session-1',
      viewport,
      hasError: () => false,
    })
    await waitFor(() =>
      expect(api.setBrowserPreviewBounds).toHaveBeenLastCalledWith('preview-1', {
        x: 10,
        y: 20,
        width: 300,
        height: 200,
      }),
    )
    view.rerender(
      <>
        <div data-testid="viewport" />
        <aside data-native-preview-occluder="session-2" />
      </>,
    )
    expect(pageHasOccludingDialog('session-1')).toBe(false)
    view.rerender(
      <>
        <div data-testid="viewport" />
        <aside data-native-preview-occluder="session-1" />
      </>,
    )
    expect(pageHasOccludingDialog('session-1')).toBe(true)
    await waitFor(() =>
      expect(api.setBrowserPreviewBounds).toHaveBeenLastCalledWith('preview-1', null),
    )
    view.rerender(<div data-testid="viewport" />)
    await waitFor(() =>
      expect(api.setBrowserPreviewBounds).toHaveBeenLastCalledWith('preview-1', {
        x: 10,
        y: 20,
        width: 300,
        height: 200,
      }),
    )
    act(dispose)
  })
})

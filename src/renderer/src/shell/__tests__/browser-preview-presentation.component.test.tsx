import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  setBrowserPreviewBounds: vi.fn(async () => undefined),
}))

vi.mock('@/shared/lib/ipc', () => ({ api }))

import { waitForBrowserPreviewPresentation } from '../browser-preview-presentation'

describe('browser preview presentation readiness', () => {
  beforeEach(() => vi.clearAllMocks())

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    document.body.replaceChildren()
  })

  it('applies visible floating geometry before reporting presentation ready', async () => {
    const player = document.createElement('section')
    player.dataset.browserPreviewFloating = 'preview-1'
    const viewport = document.createElement('div')
    viewport.dataset.browserPreviewViewport = ''
    player.append(viewport)
    document.body.append(player)
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({
      x: 120,
      y: 64,
      width: 320,
      height: 173,
      top: 64,
      right: 440,
      bottom: 237,
      left: 120,
      toJSON: () => ({}),
    })

    await expect(waitForBrowserPreviewPresentation('preview-1')).resolves.toBe(true)
    expect(api.setBrowserPreviewBounds).toHaveBeenCalledExactlyOnceWith('preview-1', {
      x: 120,
      y: 64,
      width: 320,
      height: 173,
    })
  })

  it('settles without failure when the owner is open in a background Session', async () => {
    vi.useFakeTimers()
    const readiness = waitForBrowserPreviewPresentation('background-preview')

    await vi.advanceTimersByTimeAsync(600)

    await expect(readiness).resolves.toBe(false)
    expect(api.setBrowserPreviewBounds).not.toHaveBeenCalled()
  })
})

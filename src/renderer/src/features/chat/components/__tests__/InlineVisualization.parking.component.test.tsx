import { SessionId } from '@shared/types/brand'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => ({
  registerInlineVisualizationFrame: vi.fn(),
  unregisterInlineVisualizationFrame: vi.fn(),
}))
vi.mock('@/shared/lib/ipc', () => ({ api: apiMock }))

import { InlineVisualization } from '../InlineVisualization'

describe('InlineVisualization frame parking', () => {
  let intersectionCallback: IntersectionObserverCallback | null = null

  beforeEach(() => {
    class TestIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        intersectionCallback = callback
      }
      disconnect = vi.fn()
      observe = vi.fn()
      takeRecords = vi.fn(() => [])
      unobserve = vi.fn()
      root = null
      rootMargin = '400px'
      thresholds = [0]
    }
    vi.stubGlobal('IntersectionObserver', TestIntersectionObserver)
    apiMock.registerInlineVisualizationFrame.mockImplementation(
      async (input: { readonly frameId: string }) => ({
        frameUrl: `openwaggle-visualization://frame-${input.frameId}/document`,
        registrationId: `registration-${input.frameId}`,
      }),
    )
    apiMock.unregisterInlineVisualizationFrame.mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    intersectionCallback = null
    for (const mock of Object.values(apiMock)) mock.mockReset()
  })

  function dispatchIntersection(isIntersecting: boolean) {
    intersectionCallback?.(
      [fromPartial<IntersectionObserverEntry>({ isIntersecting })],
      fromPartial<IntersectionObserver>({}),
    )
  }

  it('releases a distant frame while preserving its measured transcript height', async () => {
    render(
      <InlineVisualization
        sessionId={SessionId('session-visualization-1')}
        interactionSessionId={SessionId('session-visualization-1')}
        reference={{ path: '/repo/parked-map.html', title: 'Parked map' }}
      />,
    )
    expect(apiMock.registerInlineVisualizationFrame).not.toHaveBeenCalled()
    act(() => dispatchIntersection(true))
    const frame = await screen.findByTitle('Parked map')
    if (!(frame instanceof HTMLIFrameElement)) throw new Error('Expected visualization iframe')
    const url = new URL(frame.getAttribute('src') ?? '')
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: frame.contentWindow,
          origin: `${url.protocol}//${url.host}`,
          data: {
            capability: 'test-capability-1234567890',
            type: 'openwaggle:inline-visualization:bootstrap',
          },
        }),
      )
      window.dispatchEvent(
        new MessageEvent('message', {
          source: frame.contentWindow,
          origin: `${url.protocol}//${url.host}`,
          data: {
            capability: 'test-capability-1234567890',
            type: 'openwaggle:inline-visualization:resize',
            height: 900,
          },
        }),
      )
    })
    expect(frame).toHaveStyle({ height: '900px' })

    act(() => dispatchIntersection(false))
    await waitFor(() => expect(screen.queryByTitle('Parked map')).toBeNull())
    expect(screen.getByRole('status')).toHaveStyle({ height: '900px' })
    expect(apiMock.unregisterInlineVisualizationFrame).toHaveBeenCalledTimes(1)

    act(() => dispatchIntersection(true))
    await screen.findByTitle('Parked map')
    expect(apiMock.registerInlineVisualizationFrame).toHaveBeenCalledTimes(2)
  })
})

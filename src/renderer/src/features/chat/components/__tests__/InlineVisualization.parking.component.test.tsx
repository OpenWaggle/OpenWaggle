import { SessionId } from '@shared/types/brand'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import { act, Profiler } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearInlineVisualizationStatesForTests,
  latestInlineVisualizationContext,
} from '../../state/inline-visualization-state'
import { clearPinnedInlineVisualizationFramesForTests } from '../inline-visualization-frame-retention'

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
    clearInlineVisualizationStatesForTests()
    clearPinnedInlineVisualizationFramesForTests()
  })

  function dispatchIntersection(isIntersecting: boolean) {
    intersectionCallback?.(
      [fromPartial<IntersectionObserverEntry>({ isIntersecting })],
      fromPartial<IntersectionObserver>({}),
    )
  }

  it('releases a distant frame while preserving its measured transcript height', async () => {
    const sessionId = SessionId('session-visualization-1')
    const contextsAtUnavailableCommit: ReturnType<typeof latestInlineVisualizationContext>[] = []
    const view = render(
      <Profiler
        id="parking"
        onRender={() => {
          if (screen.queryByRole('alert')) {
            contextsAtUnavailableCommit.push(latestInlineVisualizationContext(sessionId))
          }
        }}
      >
        <InlineVisualization
          sessionId={sessionId}
          interactionSessionId={sessionId}
          reference={{ path: '/repo/parked-map.html', title: 'Parked map' }}
        />
      </Profiler>,
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
      window.dispatchEvent(
        new MessageEvent('message', {
          source: frame.contentWindow,
          origin: `${url.protocol}//${url.host}`,
          data: {
            capability: 'test-capability-1234567890',
            type: 'openwaggle:inline-visualization:state',
            state: { selectedStage: 'sandbox' },
          },
        }),
      )
    })
    expect(frame).toHaveStyle({ height: '900px' })
    act(() => dispatchIntersection(false))
    await waitFor(() => expect(screen.queryByTitle('Parked map')).toBeNull())
    expect(screen.getByRole('status')).toHaveStyle({ height: '900px' })
    expect(apiMock.unregisterInlineVisualizationFrame).toHaveBeenCalledTimes(1)
    expect(latestInlineVisualizationContext(sessionId)?.state).toEqual({
      selectedStage: 'sandbox',
    })

    act(() => dispatchIntersection(true))
    await screen.findByTitle('Parked map')
    expect(apiMock.registerInlineVisualizationFrame).toHaveBeenCalledTimes(2)
    expect(apiMock.registerInlineVisualizationFrame).toHaveBeenLastCalledWith(
      expect.objectContaining({ restoredState: { selectedStage: 'sandbox' } }),
    )

    act(() => dispatchIntersection(false))
    await waitFor(() => expect(screen.queryByTitle('Parked map')).toBeNull())
    apiMock.registerInlineVisualizationFrame.mockRejectedValueOnce(
      new Error('Registration unavailable'),
    )
    act(() => dispatchIntersection(true))
    await screen.findByRole('alert')
    expect(contextsAtUnavailableCommit.length).toBeGreaterThan(0)
    expect(contextsAtUnavailableCommit).toEqual(contextsAtUnavailableCommit.map(() => null))
    expect(latestInlineVisualizationContext(sessionId)).toBeNull()
    view.unmount()
    expect(latestInlineVisualizationContext(sessionId)).toBeNull()
  })

  it('keeps a frame the user is working in loaded after it scrolls away', async () => {
    const sessionId = SessionId('session-visualization-pinned')
    render(
      <InlineVisualization
        sessionId={sessionId}
        interactionSessionId={sessionId}
        reference={{ path: '/repo/picker.html', title: 'Variant picker' }}
      />,
    )
    act(() => dispatchIntersection(true))
    const frame = await screen.findByTitle('Variant picker')
    if (!(frame instanceof HTMLIFrameElement)) throw new Error('Expected visualization iframe')
    // The frame can appear before its passive engagement effect attaches the blur listener.
    await act(async () => {})

    vi.useFakeTimers()
    try {
      act(() => {
        frame.focus()
        window.dispatchEvent(new Event('blur'))
        vi.runOnlyPendingTimers()
      })
    } finally {
      vi.useRealTimers()
    }
    act(() => dispatchIntersection(false))

    expect(screen.getByTitle('Variant picker')).toBe(frame)
    expect(apiMock.unregisterInlineVisualizationFrame).not.toHaveBeenCalled()
    expect(apiMock.registerInlineVisualizationFrame).toHaveBeenCalledOnce()
  })

  it('restores the reported state when a frame parks before its engagement registers', async () => {
    const sessionId = SessionId('session-visualization-race')
    render(
      <InlineVisualization
        sessionId={sessionId}
        interactionSessionId={sessionId}
        reference={{ path: '/repo/race-picker.html', title: 'Race picker' }}
      />,
    )
    act(() => dispatchIntersection(true))
    const frame = await screen.findByTitle('Race picker')
    if (!(frame instanceof HTMLIFrameElement)) throw new Error('Expected visualization iframe')
    const url = new URL(frame.getAttribute('src') ?? '')
    const dispatch = (data: Record<string, unknown>) =>
      window.dispatchEvent(
        new MessageEvent('message', {
          source: frame.contentWindow,
          origin: `${url.protocol}//${url.host}`,
          data: { capability: 'test-capability-1234567890', ...data },
        }),
      )
    act(() => {
      dispatch({ type: 'openwaggle:inline-visualization:bootstrap' })
      dispatch({ type: 'openwaggle:inline-visualization:state', state: { selected: 'X' } })
    })

    vi.useFakeTimers()
    try {
      // The frame parks and commits before the engagement timer gets a turn.
      act(() => {
        frame.focus()
        window.dispatchEvent(new Event('blur'))
        dispatchIntersection(false)
      })
      act(() => vi.runOnlyPendingTimers())
    } finally {
      vi.useRealTimers()
    }
    await waitFor(() => expect(screen.queryByTitle('Race picker')).toBeNull())

    act(() => dispatchIntersection(true))
    await screen.findByTitle('Race picker')
    expect(apiMock.registerInlineVisualizationFrame).toHaveBeenLastCalledWith(
      expect.objectContaining({ restoredState: { selected: 'X' } }),
    )
  })
})

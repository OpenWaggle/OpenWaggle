import { SessionId } from '@shared/types/brand'
import { render, screen } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const FRAME_HEALTH_TIMEOUT_MS = 2_000
const FRAME_HEALTH_INTERVAL_MS = 5_000
const apiMock = vi.hoisted(() => ({
  registerInlineVisualizationFrame: vi.fn(),
  unregisterInlineVisualizationFrame: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api: apiMock }))

import { InlineVisualization } from '../InlineVisualization'

function currentVisualizationFrame(title: string) {
  const element = screen.getByTitle(title)
  if (!(element instanceof HTMLIFrameElement)) {
    throw new Error(`Expected ${title} to be an iframe.`)
  }
  return element
}

function dispatchReady(frame: HTMLIFrameElement) {
  const url = new URL(frame.src)
  for (const type of [
    'openwaggle:inline-visualization:bootstrap',
    'openwaggle:inline-visualization:ready',
  ]) {
    window.dispatchEvent(
      new MessageEvent('message', {
        source: frame.contentWindow,
        origin: `${url.protocol}//${url.host}`,
        data: { type, capability: 'test-capability-1234567890' },
      }),
    )
  }
}

describe('InlineVisualization health checks', () => {
  beforeEach(() => {
    apiMock.registerInlineVisualizationFrame.mockImplementation(
      async (input: { readonly frameId: string }) => ({
        frameUrl: `openwaggle-visualization://frame-${input.frameId}/document`,
        registrationId: `registration-${input.frameId}`,
      }),
    )
    apiMock.unregisterInlineVisualizationFrame.mockResolvedValue(undefined)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    for (const mock of Object.values(apiMock)) mock.mockReset()
  })

  it('removes and replaces a frame that blocks before its load event', async () => {
    render(
      <InlineVisualization
        sessionId={SessionId('session-visualization-1')}
        reference={{ path: '/repo/unresponsive-map.html', title: 'Unresponsive map' }}
      />,
    )
    await act(async () => undefined)
    currentVisualizationFrame('Unresponsive map')
    act(() => vi.advanceTimersByTime(FRAME_HEALTH_TIMEOUT_MS))

    expect(screen.getByRole('alert')).toHaveTextContent('visualization could not be loaded')
    expect(screen.queryByTitle('Unresponsive map')).toBeNull()
  })

  it('removes a loaded frame that stops answering periodic health checks', async () => {
    render(
      <InlineVisualization
        sessionId={SessionId('session-visualization-1')}
        reference={{ path: '/repo/silent-map.html', title: 'Silent map' }}
      />,
    )
    await act(async () => undefined)
    const frame = currentVisualizationFrame('Silent map')
    act(() => {
      dispatchReady(frame)
      vi.advanceTimersByTime(FRAME_HEALTH_INTERVAL_MS + FRAME_HEALTH_TIMEOUT_MS)
    })

    expect(screen.getByRole('alert')).toHaveTextContent('visualization could not be loaded')
  })
})

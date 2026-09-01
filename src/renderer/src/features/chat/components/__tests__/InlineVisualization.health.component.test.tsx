import { SessionId } from '@shared/types/brand'
import { render, screen } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const FRAME_HEALTH_TIMEOUT_MS = 2_000
const FRAME_HEALTH_INTERVAL_MS = 5_000
const apiMock = vi.hoisted(() => ({
  registerInlineVisualizationFrame: vi.fn(),
  unregisterInlineVisualizationFrame: vi.fn(),
  terminateInlineVisualizationFrame: vi.fn(),
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
  window.dispatchEvent(
    new MessageEvent('message', {
      source: frame.contentWindow,
      origin: `${url.protocol}//${url.host}`,
      data: {
        type: 'openwaggle:inline-visualization:ready',
        capability: 'test-capability-1234567890',
      },
    }),
  )
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
    apiMock.terminateInlineVisualizationFrame.mockResolvedValue(true)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    for (const mock of Object.values(apiMock)) mock.mockReset()
  })

  it('terminates and replaces a frame that blocks before its load event', async () => {
    render(
      <InlineVisualization
        sessionId={SessionId('session-visualization-1')}
        reference={{ path: '/repo/unresponsive-map.html', title: 'Unresponsive map' }}
      />,
    )
    await act(async () => undefined)
    const frame = currentVisualizationFrame('Unresponsive map')
    const frameId = new URL(frame.src).host.replace('frame-', '')

    act(() => vi.advanceTimersByTime(FRAME_HEALTH_TIMEOUT_MS))

    expect(apiMock.terminateInlineVisualizationFrame).toHaveBeenCalledWith({
      frameId,
      registrationId: `registration-${frameId}`,
    })
    expect(screen.getByRole('alert')).toHaveTextContent('visualization could not be loaded')
    expect(screen.queryByTitle('Unresponsive map')).toBeNull()
  })

  it('terminates a loaded frame that stops answering periodic health checks', async () => {
    render(
      <InlineVisualization
        sessionId={SessionId('session-visualization-1')}
        reference={{ path: '/repo/silent-map.html', title: 'Silent map' }}
      />,
    )
    await act(async () => undefined)
    const frame = currentVisualizationFrame('Silent map')
    const frameId = new URL(frame.src).host.replace('frame-', '')
    act(() => {
      dispatchReady(frame)
      vi.advanceTimersByTime(FRAME_HEALTH_INTERVAL_MS + FRAME_HEALTH_TIMEOUT_MS)
    })

    expect(apiMock.terminateInlineVisualizationFrame).toHaveBeenCalledWith({
      frameId,
      registrationId: `registration-${frameId}`,
    })
    expect(screen.getByRole('alert')).toHaveTextContent('visualization could not be loaded')
  })
})

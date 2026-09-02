import { SessionId } from '@shared/types/brand'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearInlineVisualizationStatesForTests,
  latestInlineVisualizationContext,
} from '../../state/inline-visualization-state'

const apiMock = vi.hoisted(() => ({
  showConfirm: vi.fn(),
  openExternal: vi.fn(),
  registerInlineVisualizationFrame: vi.fn(),
  unregisterInlineVisualizationFrame: vi.fn(),
  saveInlineVisualizationDownload: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api: apiMock }))

import { InlineVisualization } from '../InlineVisualization'

async function visualizationFrame() {
  const frame = await screen.findByTitle('Service map')
  if (!(frame instanceof HTMLIFrameElement) || !frame.contentWindow) {
    throw new Error('Expected the visualization iframe window.')
  }
  return frame
}

function dispatchFrameMessage(frame: HTMLIFrameElement, data: Record<string, unknown>) {
  const frameWindow = frame.contentWindow
  if (!frameWindow) throw new Error('Expected the visualization iframe window.')
  const url = new URL(frame.src)
  window.dispatchEvent(
    new MessageEvent('message', {
      source: frameWindow,
      origin: `${url.protocol}//${url.host}`,
      data: { capability: 'test-capability-1234567890', ...data },
    }),
  )
}

describe('InlineVisualization interaction state', () => {
  beforeEach(() => {
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
    for (const mock of Object.values(apiMock)) mock.mockReset()
    clearInlineVisualizationStatesForTests()
  })

  it('captures bounded authenticated state only while its frame owns the active session', async () => {
    const activeSessionId = SessionId('active-session')
    const view = render(
      <InlineVisualization
        sessionId={SessionId('source-session')}
        interactionSessionId={activeSessionId}
        reference={{ path: '/repo/service-map.html', title: 'Service map' }}
      />,
    )
    const frame = await visualizationFrame()
    act(() => {
      dispatchFrameMessage(frame, { type: 'openwaggle:inline-visualization:bootstrap' })
      dispatchFrameMessage(frame, {
        type: 'openwaggle:inline-visualization:state',
        state: { selectedService: 'api', filters: ['errors'] },
      })
    })

    await waitFor(() => {
      expect(latestInlineVisualizationContext(activeSessionId)).toEqual({
        title: 'Service map',
        sourcePath: '/repo/service-map.html',
        state: { selectedService: 'api', filters: ['errors'] },
      })
    })

    act(() => {
      dispatchFrameMessage(frame, {
        type: 'openwaggle:inline-visualization:state',
        state: { value: 'x'.repeat(20_000) },
      })
    })
    expect(latestInlineVisualizationContext(activeSessionId)?.state).toEqual({
      selectedService: 'api',
      filters: ['errors'],
    })

    act(() => {
      dispatchFrameMessage(frame, {
        type: 'openwaggle:inline-visualization:state',
        state: null,
      })
    })
    await waitFor(() => expect(latestInlineVisualizationContext(activeSessionId)).toBeNull())

    act(() => {
      dispatchFrameMessage(frame, {
        type: 'openwaggle:inline-visualization:state',
        state: { selectedService: 'worker' },
      })
    })
    const switchedSessionId = SessionId('switched-session')
    view.rerender(
      <InlineVisualization
        sessionId={SessionId('source-session')}
        interactionSessionId={switchedSessionId}
        reference={{ path: '/repo/service-map.html', title: 'Service map' }}
      />,
    )
    expect(latestInlineVisualizationContext(activeSessionId)).toBeNull()
    expect(latestInlineVisualizationContext(switchedSessionId)).toBeNull()

    view.unmount()
    expect(latestInlineVisualizationContext(activeSessionId)).toBeNull()
  })

  it('clears captured state as soon as its frame fails', async () => {
    const activeSessionId = SessionId('active-session')
    render(
      <InlineVisualization
        sessionId={SessionId('source-session')}
        interactionSessionId={activeSessionId}
        reference={{ path: '/repo/service-map.html', title: 'Service map' }}
      />,
    )
    const frame = await visualizationFrame()
    act(() => {
      dispatchFrameMessage(frame, { type: 'openwaggle:inline-visualization:bootstrap' })
      dispatchFrameMessage(frame, {
        type: 'openwaggle:inline-visualization:state',
        state: { selectedService: 'api' },
      })
      dispatchFrameMessage(frame, {
        type: 'openwaggle:inline-visualization:error',
        reason: 'crashed',
      })
    })

    expect(latestInlineVisualizationContext(activeSessionId)).toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent('visualization could not be loaded')
    expect(apiMock.unregisterInlineVisualizationFrame).toHaveBeenCalledOnce()
  })
})

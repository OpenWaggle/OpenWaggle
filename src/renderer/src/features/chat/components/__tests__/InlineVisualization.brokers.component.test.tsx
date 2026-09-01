import { SessionId } from '@shared/types/brand'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMessageQueueStore } from '../../state/message-queue-store'

const apiMock = vi.hoisted(() => ({
  showConfirm: vi.fn(),
  openExternal: vi.fn(),
  registerInlineVisualizationFrame: vi.fn(),
  unregisterInlineVisualizationFrame: vi.fn(),
  saveInlineVisualizationDownload: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api: apiMock }))

import { InlineVisualization } from '../InlineVisualization'

async function visualizationFrame(title: string) {
  const element = await screen.findByTitle(title)
  if (!(element instanceof HTMLIFrameElement)) {
    throw new Error(`Expected ${title} to be an iframe.`)
  }
  return element
}

function visualizationFrameWindow(frame: HTMLIFrameElement) {
  const frameWindow = frame.contentWindow
  if (!frameWindow) throw new Error('Expected visualization iframe window.')
  return frameWindow
}

function frameOrigin(frame: HTMLIFrameElement) {
  const url = new URL(frame.src)
  return `${url.protocol}//${url.host}`
}

function dispatchFrameMessage(
  frame: HTMLIFrameElement,
  data: Record<string, unknown>,
  capability = 'test-capability-1234567890',
) {
  window.dispatchEvent(
    new MessageEvent('message', {
      source: visualizationFrameWindow(frame),
      origin: frameOrigin(frame),
      data: { capability, ...data },
    }),
  )
}

async function activateFrame(frame: HTMLIFrameElement) {
  await act(async () => undefined)
  const postMessage = vi.spyOn(visualizationFrameWindow(frame), 'postMessage')
  fireEvent.load(frame)
  act(() => {
    dispatchFrameMessage(frame, { type: 'openwaggle:inline-visualization:bootstrap' })
    dispatchFrameMessage(frame, { type: 'openwaggle:inline-visualization:ready' })
  })
  await waitFor(() => {
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'openwaggle:inline-visualization:theme' }),
      frameOrigin(frame),
    )
  })
  postMessage.mockRestore()
}

describe('InlineVisualization brokers', () => {
  beforeEach(() => {
    apiMock.registerInlineVisualizationFrame.mockImplementation(
      async (input: {
        readonly frameId: string
        readonly sessionId: string
        readonly sourcePath: string
      }) => ({
        frameUrl: `openwaggle-visualization://frame-${input.frameId}/document`,
        registrationId: `registration-${input.frameId}`,
      }),
    )
    apiMock.unregisterInlineVisualizationFrame.mockResolvedValue(undefined)
    apiMock.saveInlineVisualizationDownload.mockResolvedValue(true)
  })

  afterEach(() => {
    for (const mock of Object.values(apiMock)) mock.mockReset()
    useMessageQueueStore.setState({ queues: new Map() })
  })

  it('opens a network link only after the user confirms the brokered request', async () => {
    apiMock.showConfirm.mockResolvedValue(true)
    render(
      <InlineVisualization
        sessionId={SessionId('session-visualization-1')}
        interactionSessionId={SessionId('session-visualization-1')}
        reference={{ path: '/repo/link-map.html', title: 'Link map' }}
      />,
    )
    const frame = await visualizationFrame('Link map')

    await activateFrame(frame)
    act(() => {
      dispatchFrameMessage(frame, {
        type: 'openwaggle:inline-visualization:open-link',
        url: 'https://example.com/details',
      })
    })

    await waitFor(() => {
      expect(apiMock.showConfirm).toHaveBeenCalledWith(
        'Open external link?',
        'https://example.com/details',
      )
      expect(apiMock.openExternal).toHaveBeenCalledWith('https://example.com/details')
    })
  })

  it('rejects a forged ready before the trusted bootstrap capability', async () => {
    apiMock.showConfirm.mockResolvedValue(true)
    render(
      <InlineVisualization
        sessionId={SessionId('session-visualization-1')}
        interactionSessionId={SessionId('session-visualization-1')}
        reference={{ path: '/repo/capability-map.html', title: 'Capability map' }}
      />,
    )
    const frame = await visualizationFrame('Capability map')

    act(() => {
      dispatchFrameMessage(
        frame,
        { type: 'openwaggle:inline-visualization:ready' },
        'forged-capability-1234567890',
      )
      dispatchFrameMessage(
        frame,
        {
          type: 'openwaggle:inline-visualization:open-link',
          url: 'https://example.com/forged',
        },
        'forged-capability-1234567890',
      )
    })

    expect(apiMock.showConfirm).not.toHaveBeenCalled()

    await activateFrame(frame)

    act(() => {
      dispatchFrameMessage(frame, {
        type: 'openwaggle:inline-visualization:open-link',
        url: 'https://example.com/legitimate',
      })
    })
    await waitFor(() => {
      expect(apiMock.showConfirm).toHaveBeenCalledWith(
        'Open external link?',
        'https://example.com/legitimate',
      )
    })
  })

  it('permits only one pending broker request per frame', async () => {
    apiMock.showConfirm.mockImplementation(() => new Promise<boolean>(() => undefined))
    render(
      <InlineVisualization
        sessionId={SessionId('session-visualization-1')}
        interactionSessionId={SessionId('session-visualization-1')}
        reference={{ path: '/repo/link-map.html', title: 'Single-flight map' }}
      />,
    )
    const frame = await visualizationFrame('Single-flight map')
    await activateFrame(frame)
    act(() => {
      dispatchFrameMessage(frame, {
        type: 'openwaggle:inline-visualization:open-link',
        url: 'https://example.com/first',
      })
      dispatchFrameMessage(frame, {
        type: 'openwaggle:inline-visualization:open-link',
        url: 'https://example.com/second',
      })
    })

    expect(apiMock.showConfirm).toHaveBeenCalledTimes(1)
  })

  it('brokers a bounded local download outside the sandbox', async () => {
    render(
      <InlineVisualization
        sessionId={SessionId('session-visualization-1')}
        interactionSessionId={SessionId('session-visualization-1')}
        reference={{ path: '/repo/download-map.html', title: 'Download map' }}
      />,
    )
    const frame = await visualizationFrame('Download map')
    await activateFrame(frame)
    act(() => {
      dispatchFrameMessage(frame, {
        type: 'openwaggle:inline-visualization:download',
        suggestedName: 'selection.csv',
        mimeType: 'text/csv',
        base64Data: 'YSxiCjEsMgo=',
      })
    })

    await waitFor(() => {
      expect(apiMock.saveInlineVisualizationDownload).toHaveBeenCalledWith({
        suggestedName: 'selection.csv',
        mimeType: 'text/csv',
        base64Data: 'YSxiCjEsMgo=',
      })
    })
  })

  it.each([
    'javascript:alert(1)',
    'file:///etc/passwd',
    'https://user:password@example.com/private',
    'data:text/html,boom',
  ])('rejects an unsafe brokered navigation to %s', async (url) => {
    render(
      <InlineVisualization
        sessionId={SessionId('session-visualization-1')}
        interactionSessionId={SessionId('session-visualization-1')}
        reference={{ path: '/repo/link-map.html', title: 'Link map' }}
      />,
    )
    const frame = await visualizationFrame('Link map')

    await activateFrame(frame)
    act(() => {
      dispatchFrameMessage(frame, {
        type: 'openwaggle:inline-visualization:open-link',
        url,
      })
    })

    await Promise.resolve()
    expect(apiMock.showConfirm).not.toHaveBeenCalled()
    expect(apiMock.openExternal).not.toHaveBeenCalled()
  })

  it('reads from the owning session but queues a confirmed follow-up for the active session', async () => {
    const sourceSessionId = SessionId('source-session')
    const activeSessionId = SessionId('active-session')
    apiMock.showConfirm.mockResolvedValue(true)
    render(
      <InlineVisualization
        sessionId={sourceSessionId}
        interactionSessionId={activeSessionId}
        reference={{ path: '/repo/follow-up-map.html', title: 'Follow-up map' }}
      />,
    )
    const frame = await visualizationFrame('Follow-up map')
    expect(apiMock.registerInlineVisualizationFrame).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: sourceSessionId }),
    )

    await activateFrame(frame)
    const postMessage = vi.spyOn(visualizationFrameWindow(frame), 'postMessage')
    act(() => {
      dispatchFrameMessage(frame, {
        type: 'openwaggle:inline-visualization:follow-up',
        requestId: 'follow-up-request-1',
        prompt: 'Investigate the selected service.',
        title: 'Investigate selection?',
      })
    })

    await waitFor(() => {
      expect(apiMock.showConfirm).toHaveBeenCalledWith(
        'Investigate selection?',
        'Investigate the selected service.',
      )
      expect(useMessageQueueStore.getState().queues.get(activeSessionId)?.[0]?.payload.text).toBe(
        'Investigate the selected service.',
      )
      expect(useMessageQueueStore.getState().queues.has(sourceSessionId)).toBe(false)
      expect(postMessage).toHaveBeenCalledWith(
        {
          type: 'openwaggle:inline-visualization:follow-up-result',
          requestId: 'follow-up-request-1',
          accepted: true,
        },
        frameOrigin(frame),
      )
    })
    postMessage.mockRestore()
  })
})

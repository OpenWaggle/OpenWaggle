import { SessionId } from '@shared/types/brand'
import { render, screen, waitFor } from '@testing-library/react'
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

function activateFrame(frame: HTMLIFrameElement) {
  dispatchFrameMessage(frame, { type: 'openwaggle:inline-visualization:ready' })
}

describe('InlineVisualization brokers', () => {
  beforeEach(() => {
    apiMock.registerInlineVisualizationFrame.mockImplementation(
      async (input: {
        readonly frameId: string
        readonly sessionId: string
        readonly sourcePath: string
      }) => ({
        frameUrl: `openwaggle-visualization://frame-${input.frameId}/document?sessionId=${encodeURIComponent(input.sessionId)}&path=${encodeURIComponent(input.sourcePath)}`,
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
        reference={{ path: '/repo/link-map.html', title: 'Link map' }}
      />,
    )
    const frame = await visualizationFrame('Link map')

    act(() => {
      activateFrame(frame)
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

  it('permits only one pending broker request per frame', async () => {
    apiMock.showConfirm.mockImplementation(() => new Promise<boolean>(() => undefined))
    render(
      <InlineVisualization
        sessionId={SessionId('session-visualization-1')}
        reference={{ path: '/repo/link-map.html', title: 'Single-flight map' }}
      />,
    )
    const frame = await visualizationFrame('Single-flight map')
    act(() => {
      activateFrame(frame)
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
        reference={{ path: '/repo/download-map.html', title: 'Download map' }}
      />,
    )
    const frame = await visualizationFrame('Download map')
    act(() => {
      activateFrame(frame)
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
        reference={{ path: '/repo/link-map.html', title: 'Link map' }}
      />,
    )
    const frame = await visualizationFrame('Link map')

    act(() => {
      activateFrame(frame)
      dispatchFrameMessage(frame, {
        type: 'openwaggle:inline-visualization:open-link',
        url,
      })
    })

    await Promise.resolve()
    expect(apiMock.showConfirm).not.toHaveBeenCalled()
    expect(apiMock.openExternal).not.toHaveBeenCalled()
  })

  it('queues a follow-up for the owning session only after user confirmation', async () => {
    const sessionId = SessionId('session-visualization-1')
    apiMock.showConfirm.mockResolvedValue(true)
    render(
      <InlineVisualization
        sessionId={sessionId}
        reference={{ path: '/repo/follow-up-map.html', title: 'Follow-up map' }}
      />,
    )
    const frame = await visualizationFrame('Follow-up map')

    act(() => {
      activateFrame(frame)
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
      expect(useMessageQueueStore.getState().queues.get(sessionId)?.[0]?.payload.text).toBe(
        'Investigate the selected service.',
      )
    })
  })
})

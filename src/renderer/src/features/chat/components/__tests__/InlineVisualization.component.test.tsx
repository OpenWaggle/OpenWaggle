import { SessionId } from '@shared/types/brand'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Button } from '@/shared/ui/Button'
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

const TEST_BACKGROUND = 'test-background-token'
const TEST_FOREGROUND = 'test-foreground-token'

async function visualizationFrame(title: string) {
  const element = await screen.findByTitle(title)
  if (!(element instanceof HTMLIFrameElement)) {
    throw new Error(`Expected ${title} to be an iframe.`)
  }
  return element
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

async function activateFrame(frame: HTMLIFrameElement, capability = 'test-capability-1234567890') {
  await act(async () => undefined)
  const postMessage = vi.spyOn(visualizationFrameWindow(frame), 'postMessage')
  fireEvent.load(frame)
  act(() => {
    dispatchFrameMessage(frame, { type: 'openwaggle:inline-visualization:bootstrap' }, capability)
    dispatchFrameMessage(frame, { type: 'openwaggle:inline-visualization:ready' }, capability)
  })
  await waitFor(() => {
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'openwaggle:inline-visualization:theme' }),
      frameOrigin(frame),
    )
  })
  const calls = postMessage.mock.calls.map((call) => [...call])
  postMessage.mockRestore()
  return calls
}

function visualizationFrameWindow(frame: HTMLIFrameElement) {
  const frameWindow = frame.contentWindow
  if (!frameWindow) throw new Error('Expected visualization iframe window.')
  return frameWindow
}

describe('InlineVisualization', () => {
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
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.documentElement.style.removeProperty('--color-bg')
    document.documentElement.style.removeProperty('--color-text-primary')
    apiMock.showConfirm.mockReset()
    apiMock.openExternal.mockReset()
    apiMock.registerInlineVisualizationFrame.mockReset()
    apiMock.unregisterInlineVisualizationFrame.mockReset()
    apiMock.saveInlineVisualizationDownload.mockReset()
    useMessageQueueStore.setState({ queues: new Map() })
  })
  it('loads the source in the isolated visualization protocol frame', async () => {
    const sessionId = SessionId('session-visualization-1')
    const sourcePath = '/repo/.openwaggle/visualizations/latency-map.html'

    render(
      <InlineVisualization
        sessionId={sessionId}
        interactionSessionId={sessionId}
        reference={{ path: sourcePath, title: 'Latency map', mode: 'wide' }}
      />,
    )

    const frame = await visualizationFrame('Latency map')
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin')
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer')
    const frameUrl = new URL(frame.getAttribute('src') ?? '')
    expect(frameUrl.protocol).toBe('openwaggle-visualization:')
    expect(frameUrl.host).toMatch(
      /^frame-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(frameUrl.pathname).toBe('/document')
    expect(frameUrl.search).toBe('')
    expect(frameUrl.href).not.toContain(sessionId)
    expect(frameUrl.href).not.toContain(sourcePath)
    expect(frame).toHaveAttribute('data-visualization-mode', 'wide')
    fireEvent.click(screen.getByRole('button', { name: 'Expand visualization' }))
    expect(screen.getByRole('button', { name: 'Close expanded visualization' })).toBeInTheDocument()
    expect(frame).toBeInTheDocument()
  })

  it('accepts intrinsic height only from its own frame and caps pathological content', async () => {
    render(
      <InlineVisualization
        sessionId={SessionId('session-visualization-1')}
        interactionSessionId={SessionId('session-visualization-1')}
        reference={{ path: '/repo/height-map.html', title: 'Height map' }}
      />,
    )
    const frame = await visualizationFrame('Height map')

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: window,
          origin: frameOrigin(frame),
          data: { type: 'openwaggle:inline-visualization:resize', height: 640 },
        }),
      )
    })
    await activateFrame(frame)
    act(() => {
      dispatchFrameMessage(frame, {
        type: 'openwaggle:inline-visualization:resize',
        height: 12_000,
      })
    })

    expect(frame).toHaveStyle({ height: '10000px' })
  })

  it('rejects messages with a forged origin or frame capability', async () => {
    render(
      <InlineVisualization
        sessionId={SessionId('session-visualization-1')}
        interactionSessionId={SessionId('session-visualization-1')}
        reference={{ path: '/repo/security-map.html', title: 'Security map' }}
      />,
    )
    const frame = await visualizationFrame('Security map')
    await activateFrame(frame)
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: visualizationFrameWindow(frame),
          origin: 'openwaggle-visualization://frame-forged',
          data: {
            capability: 'test-capability-1234567890',
            type: 'openwaggle:inline-visualization:resize',
            height: 900,
          },
        }),
      )
      dispatchFrameMessage(
        frame,
        { type: 'openwaggle:inline-visualization:resize', height: 800 },
        'forged-capability-1234567890',
      )
    })

    expect(frame).toHaveStyle({ height: '320px' })
  })

  it('gives sibling visualizations separate unguessable origins', async () => {
    render(
      <>
        <InlineVisualization
          sessionId={SessionId('session-visualization-1')}
          interactionSessionId={SessionId('session-visualization-1')}
          reference={{ path: '/repo/first-map.html', title: 'First map' }}
        />
        <InlineVisualization
          sessionId={SessionId('session-visualization-1')}
          interactionSessionId={SessionId('session-visualization-1')}
          reference={{ path: '/repo/second-map.html', title: 'Second map' }}
        />
      </>,
    )

    const firstHost = new URL((await visualizationFrame('First map')).src).host
    const secondHost = new URL((await visualizationFrame('Second map')).src).host
    expect(firstHost).not.toBe(secondHost)
  })

  it('maps the active OpenWaggle theme to the public visualization token contract', async () => {
    document.documentElement.style.setProperty('--color-bg', TEST_BACKGROUND)
    document.documentElement.style.setProperty('--color-text-primary', TEST_FOREGROUND)
    render(
      <InlineVisualization
        sessionId={SessionId('session-visualization-1')}
        interactionSessionId={SessionId('session-visualization-1')}
        reference={{ path: '/repo/theme-map.html', title: 'Theme map' }}
      />,
    )
    const frame = await visualizationFrame('Theme map')
    const postMessageCalls = await activateFrame(frame)

    expect(postMessageCalls).toContainEqual([
      expect.objectContaining({
        type: 'openwaggle:inline-visualization:theme',
        theme: expect.objectContaining({
          variables: expect.objectContaining({
            '--background': TEST_BACKGROUND,
            '--foreground': TEST_FOREGROUND,
          }),
        }),
      }),
      frameOrigin(frame),
    ])
  })

  it('shows a stable retry fallback when the live source is missing', async () => {
    render(
      <InlineVisualization
        sessionId={SessionId('session-visualization-1')}
        interactionSessionId={SessionId('session-visualization-1')}
        reference={{ path: '/repo/missing-map.html', title: 'Missing map' }}
      />,
    )
    const frame = await visualizationFrame('Missing map')
    const previousOrigin = frameOrigin(frame)

    await activateFrame(frame)
    act(() => {
      dispatchFrameMessage(frame, {
        type: 'openwaggle:inline-visualization:error',
        reason: 'missing',
      })
    })

    expect(screen.getByRole('alert')).toHaveTextContent('source file could not be found')
    expect(screen.queryByTitle('Missing map')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry visualization' }))
    const retriedFrame = await visualizationFrame('Missing map')
    expect(frameOrigin(retriedFrame)).not.toBe(previousOrigin)
  })

  it('uses modal semantics, focus containment, and focus restoration when expanded', async () => {
    render(
      <main data-testid="app-shell">
        <Button variant="unstyled" type="button" data-testid="background-control">
          Background control
        </Button>
        <div
          data-testid="chat-column"
          data-chat-transcript-container
          style={{ containerType: 'inline-size' }}
        >
          <InlineVisualization
            sessionId={SessionId('session-visualization-1')}
            interactionSessionId={SessionId('session-visualization-1')}
            reference={{ path: '/repo/wide-map.html', title: 'Wide map', mode: 'wide' }}
          />
        </div>
      </main>,
    )
    const frame = await visualizationFrame('Wide map')
    const chatColumn = screen.getByTestId('chat-column')
    expect(chatColumn).toContainElement(frame)
    const expandButton = screen.getByRole('button', { name: 'Expand visualization' })
    expandButton.focus()
    fireEvent.click(expandButton)

    const dialog = screen.getByRole('dialog', { name: 'Wide map' })
    const closeButton = screen.getByRole('button', { name: 'Close expanded visualization' })
    const focusLayer = document.querySelector('[data-visualization-focus-layer="true"]')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(focusLayer).toBe(dialog)
    expect(focusLayer?.parentElement).toBe(chatColumn)
    expect(focusLayer).toContainElement(frame)
    expect(chatColumn).toHaveStyle({ containerType: 'normal' })
    expect(screen.getByTestId('background-control')).toHaveProperty('inert', true)
    expect(closeButton).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(chatColumn).toContainElement(frame)
    expect(frame).toBe(await visualizationFrame('Wide map'))
    expect(chatColumn).toHaveStyle({ containerType: 'inline-size' })
    expect(expandButton).toHaveFocus()
  })
})

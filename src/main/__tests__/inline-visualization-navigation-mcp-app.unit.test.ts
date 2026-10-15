import { EventEmitter } from 'node:events'
import { fromPartial } from '@total-typescript/shoehorn'
import type { WebContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeFrame {
  readonly processId: number
  readonly frameToken: string
  readonly url: string
}

const { frames } = vi.hoisted(() => ({ frames: new Map<string, FakeFrame>() }))

vi.mock('electron', () => ({
  webFrameMain: {
    fromId: (processId: number, routingId: number) => frames.get(`${processId}:${routingId}`),
  },
}))
vi.mock('../session-resource-protocol', () => ({ shouldBlockSessionResourceRequest: () => false }))

import { installInlineVisualizationNavigationGuard } from '../inline-visualization-navigation'

const APP_URL = 'openwaggle-mcp-app://frame-12345678-1234-4123-8123-123456789abc/document'

/** The parts of a window's WebContents the guard uses: its events and its frame tree. */
function guardedWebContents() {
  const events = new EventEmitter()
  const mainFrame: { framesInSubtree: FakeFrame[] } = { framesInSubtree: [] }
  installInlineVisualizationNavigationGuard(
    fromPartial<WebContents>({
      on: (event: string, listener: (...args: unknown[]) => void) => {
        events.on(event, listener)
        return fromPartial<WebContents>({})
      },
      mainFrame: fromPartial(mainFrame),
      session: fromPartial({ webRequest: { onBeforeRequest: vi.fn() } }),
    }),
  )
  return { events, mainFrame }
}

/** Emits a frame navigation and returns whether the guard prevented it. */
function prevents(events: EventEmitter, input: Record<string, unknown>) {
  const preventDefault = vi.fn()
  events.emit('will-frame-navigate', {
    isMainFrame: false,
    isSameDocument: false,
    preventDefault,
    ...input,
  })
  return preventDefault.mock.calls.length > 0
}

/** A frame that loaded an App document, as `did-frame-navigate` reports it. */
function loadApp(events: EventEmitter, mainFrame: { framesInSubtree: FakeFrame[] }, token: string) {
  const frame: FakeFrame = { processId: 7, frameToken: token, url: APP_URL }
  frames.set(`7:${token}`, frame)
  mainFrame.framesInSubtree = [frame]
  events.emit('did-frame-navigate', {}, APP_URL, 200, 'OK', false, 7, token)
  return frame
}

beforeEach(() => {
  frames.clear()
})

describe('the navigation guard for MCP App frames', () => {
  it('remembers a frame that loaded an App and keeps it on that document', () => {
    const { events, mainFrame } = guardedWebContents()
    loadApp(events, mainFrame, 'a')
    // Mid-navigation, the frame's URL may no longer read as the App's: the frame is still kept.
    const navigating: FakeFrame = { processId: 7, frameToken: 'a', url: 'about:blank' }
    mainFrame.framesInSubtree = [navigating]

    expect(prevents(events, { url: 'https://attacker.example.com', frame: navigating })).toBe(true)
  })

  it('forgets a frame once it is removed from the page', () => {
    const { events, mainFrame } = guardedWebContents()
    loadApp(events, mainFrame, 'b')
    mainFrame.framesInSubtree = []

    const other: FakeFrame = { processId: 7, frameToken: 'b', url: 'about:blank' }
    expect(prevents(events, { url: 'https://player.example.com', frame: other })).toBe(false)
  })

  it('lets an App frame load, reload, and navigate within its own document', () => {
    const { events, mainFrame } = guardedWebContents()
    const loading: FakeFrame = { processId: 7, frameToken: 'c', url: '' }
    mainFrame.framesInSubtree = [loading]
    expect(prevents(events, { url: APP_URL, frame: loading })).toBe(false)

    const app = loadApp(events, mainFrame, 'c')
    expect(prevents(events, { url: APP_URL, frame: app })).toBe(false)
    expect(prevents(events, { url: `${APP_URL}#issues`, frame: app, isSameDocument: true })).toBe(
      false,
    )
  })
})

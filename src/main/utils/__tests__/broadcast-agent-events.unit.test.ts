import { SessionId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import type { BrowserWindow, WebContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const windows = vi.hoisted(() => {
  const state: { all: BrowserWindow[] } = { all: [] }
  return state
})

vi.mock('../../desktop-ui', () => ({ getAllBrowserWindows: () => windows.all }))

import { SHOWN_SESSION_FLUSH_MS } from '../agent-event-delivery'
import { broadcastAgentEvent, broadcastToWindows, setWindowShownSessions } from '../broadcast'

const SESSION = SessionId('session-1')

function fakeWindow() {
  const sent: Array<readonly unknown[]> = []
  const webContents = fromPartial<WebContents>({
    id: 7,
    send: (...args: unknown[]) => sent.push(args),
    once: vi.fn(),
  })
  const win = fromPartial<BrowserWindow>({ isDestroyed: () => false, webContents })
  return { win, webContents, sent }
}

function token(delta: string, timestamp: number) {
  broadcastAgentEvent({
    sessionId: SESSION,
    event: {
      type: 'message_update',
      messageId: 'm1',
      role: 'assistant',
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta },
      timestamp,
    },
  })
}

describe('agent:event delivery to windows', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    windows.all = []
  })

  it('merges a frame of tokens and sends them before any later message', () => {
    const window = fakeWindow()
    windows.all = [window.win]
    setWindowShownSessions(window.webContents, [SESSION])

    token('Hello', 1)
    token(' there', 2)
    broadcastToWindows('agent:run-completed', { sessionId: SESSION })

    expect(window.sent.map(([channel]) => channel)).toEqual(['agent:event', 'agent:run-completed'])
    expect(window.sent[0]?.[1]).toMatchObject({
      event: { assistantMessageEvent: { delta: 'Hello there' } },
    })
    vi.advanceTimersByTime(SHOWN_SESSION_FLUSH_MS)
    expect(window.sent).toHaveLength(2)
  })
})

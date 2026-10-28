import { SessionId } from '@shared/types/brand'
import type { AgentTransportEvent } from '@shared/types/stream'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import type { BrowserWindow, WebContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { typedHandleMock, windows } = vi.hoisted(() => {
  const state: { all: BrowserWindow[] } = { all: [] }
  return { typedHandleMock: vi.fn(), windows: state }
})

vi.mock('../typed-ipc', async () => {
  const { withLegacyHostOperation } = await import('./legacy-host-operations')
  return { hostHandle: withLegacyHostOperation(typedHandleMock), typedHandle: typedHandleMock }
})
vi.mock('../../desktop-ui', () => ({ getAllBrowserWindows: () => windows.all }))
vi.mock('../../agent/session-cleanup', () => ({ cleanupSessionRun: vi.fn() }))
vi.mock('../../application/local-session-command-dispatcher', () => ({
  dispatchLocalSessionCommand: vi.fn(),
}))
vi.mock('../../application/gui-session-command', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../application/gui-session-command')>()),
  dispatchGuiSessionCommand: vi.fn(),
}))
vi.mock('../../application/agent-session-service', () => ({ getAgentContextUsage: vi.fn() }))
vi.mock('../active-agent-runs', () => ({ cancelAllSessionRuns: vi.fn() }))

import { clearStreamBuffer, emitTransportEvent, startStreamBuffer } from '../../utils/stream-bridge'
import { registerAgentHandlers } from '../agent-handler'

const SESSION_ID = SessionId('session-background-read')

function backgroundRunHandler() {
  registerAgentHandlers()
  const handler = typedHandleMock.mock.calls.find(
    (candidate: readonly unknown[]) => candidate[0] === 'agent:get-background-run',
  )?.[1]
  if (typeof handler !== 'function') {
    throw new Error('Expected agent:get-background-run to be registered')
  }
  return handler
}

function fakeWindow() {
  const sent: Array<readonly unknown[]> = []
  const webContents = fromPartial<WebContents>({
    id: 11,
    send: (...args: unknown[]) => sent.push(args),
    once: vi.fn(),
  })
  return { win: fromPartial<BrowserWindow>({ isDestroyed: () => false, webContents }), sent }
}

const messageStart = {
  type: 'message_start',
  messageId: 'm1',
  role: 'assistant',
  timestamp: 1,
} satisfies AgentTransportEvent

const helloDelta = {
  type: 'message_update',
  messageId: 'm1',
  role: 'assistant',
  assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hello' },
  timestamp: 2,
} satisfies AgentTransportEvent

/*
 * A window that reads a Session's stream buffer merges the snapshot, then appends every delta it
 * receives afterwards. A delta still coalescing in the main process is already in the buffer, so it
 * must reach the window before the read answers, or the window shows its text twice (R2 P1-1).
 */
describe('agent:get-background-run and coalesced deltas', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    typedHandleMock.mockReset()
  })
  afterEach(() => {
    clearStreamBuffer(SESSION_ID)
    vi.useRealTimers()
    windows.all = []
  })

  it('sends the pending delta before answering with a snapshot that contains it', async () => {
    const window = fakeWindow()
    windows.all = [window.win]
    startStreamBuffer(SESSION_ID, fromPartial('anthropic/claude'), 'classic', 'run-1')
    emitTransportEvent(SESSION_ID, messageStart)
    emitTransportEvent(SESSION_ID, helloDelta)
    const sentBeforeRead = window.sent.length

    const snapshot = await Effect.runPromise(backgroundRunHandler()({}, SESSION_ID))

    expect(JSON.stringify(snapshot)).toContain('Hello')
    const delivered = window.sent.slice(sentBeforeRead)
    expect(delivered).toHaveLength(1)
    expect(delivered[0]?.[1]).toMatchObject({
      sessionId: SESSION_ID,
      event: { assistantMessageEvent: { delta: 'Hello' } },
    })
    // Nothing is left to arrive after the snapshot.
    vi.advanceTimersByTime(1_000)
    expect(window.sent.length).toBe(sentBeforeRead + 1)
  })
})

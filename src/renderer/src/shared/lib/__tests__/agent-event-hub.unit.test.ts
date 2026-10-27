import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SessionId } from '@shared/types/brand'
import type { IpcEventPayload } from '@shared/types/ipc'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type AgentEventPayload = IpcEventPayload<'agent:event'>

const bridge = vi.hoisted(() => {
  const callbacks = new Set<(payload: AgentEventPayload) => void>()
  return {
    callbacks,
    onAgentEvent: vi.fn((callback: (payload: AgentEventPayload) => void) => {
      callbacks.add(callback)
      return () => callbacks.delete(callback)
    }),
    setShownSessions: vi.fn(async (_sessionIds: readonly string[]) => {}),
  }
})

vi.mock('../ipc', () => ({
  api: { onAgentEvent: bridge.onAgentEvent, setShownSessions: bridge.setShownSessions },
}))

import {
  agentEventBridgeSubscriptionCount,
  declareShownSessions,
  subscribeAgentEvents,
} from '../agent-event-hub'

function deliver(payload: AgentEventPayload) {
  for (const callback of bridge.callbacks) callback(payload)
}

function payload(sessionId: string): AgentEventPayload {
  return {
    sessionId: SessionId(sessionId),
    event: { type: 'agent_start', runId: 'run-1', timestamp: 1 },
  }
}

describe('agent event hub', () => {
  beforeEach(() => {
    bridge.callbacks.clear()
    bridge.onAgentEvent.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('holds one bridge subscription for every listener, and none when nobody listens', () => {
    const received: string[] = []
    const unsubscribers = ['a', 'b', 'c', 'd', 'e'].map((name) =>
      subscribeAgentEvents(() => received.push(name)),
    )

    expect(bridge.onAgentEvent).toHaveBeenCalledTimes(1)
    deliver(payload('session-1'))
    expect(received).toEqual(['a', 'b', 'c', 'd', 'e'])

    for (const unsubscribe of unsubscribers) unsubscribe()
    expect(agentEventBridgeSubscriptionCount()).toBe(0)
    expect(bridge.callbacks.size).toBe(0)
  })

  it('subscribes the bridge again after the last listener left', () => {
    subscribeAgentEvents(() => undefined)()
    const received = vi.fn()
    const unsubscribe = subscribeAgentEvents(received)

    deliver(payload('session-2'))

    expect(bridge.onAgentEvent).toHaveBeenCalledTimes(2)
    expect(received).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('keeps delivering to the other listeners when one throws, and still reports it', () => {
    const failure = new Error('listener failed')
    const reported: unknown[] = []
    vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((task) => {
      try {
        task()
      } catch (error) {
        reported.push(error)
      }
    })
    const after = vi.fn()
    const unsubscribeFailing = subscribeAgentEvents(() => {
      throw failure
    })
    const unsubscribeAfter = subscribeAgentEvents(after)

    deliver(payload('session-3'))

    expect(after).toHaveBeenCalledTimes(1)
    expect(reported).toEqual([failure])
    unsubscribeFailing()
    unsubscribeAfter()
  })

  it('tells the main process which Sessions this window shows, ignoring a failed call', async () => {
    bridge.setShownSessions.mockRejectedValueOnce(new Error('stale preload'))
    declareShownSessions([SessionId('session-4')])
    await Promise.resolve()
    expect(bridge.setShownSessions).toHaveBeenCalledWith(['session-4'])
  })

  it('is the only renderer module that subscribes to agent:event on the bridge', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
    const offenders: string[] = []
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name)
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') walk(entryPath)
          continue
        }
        if (!/\.tsx?$/u.test(entry.name) || entry.name === 'agent-event-hub.ts') continue
        if (/\.onAgentEvent\(/u.test(readFileSync(entryPath, 'utf8'))) {
          offenders.push(path.relative(root, entryPath))
        }
      }
    }
    walk(root)

    expect(offenders).toEqual([])
  })
})

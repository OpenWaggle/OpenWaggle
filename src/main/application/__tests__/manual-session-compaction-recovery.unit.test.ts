import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { AgentTransportEvent } from '@shared/types/stream'
import { fromAny } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  compactAgentSession: vi.fn(),
  publishSessionHostEvent: vi.fn(),
}))

vi.mock('../agent-session-service', () => ({
  compactAgentSession: mocks.compactAgentSession,
}))
vi.mock('../../session-host/session-host-events', () => ({
  publishSessionHostEvent: mocks.publishSessionHostEvent,
}))

import { activeCompactions, listActiveCompactions } from '../active-session-runs'
import { executeManualSessionCompaction } from '../manual-session-compaction-service'

const SESSION_ID = SessionId('manual-compaction-recovery-session')
const MODEL = SupportedModelId('openai/gpt-5.4')

function compact() {
  return Effect.runPromise(
    fromAny<Effect.Effect<unknown, Error, never>, unknown>(
      executeManualSessionCompaction({
        caller: { callerId: 'gui:local-user' },
        payload: {
          contract: 'local-compaction-v1',
          request: { requestId: 'compact-recovery', sessionId: SESSION_ID, model: MODEL },
        },
      }),
    ),
  )
}

describe('owner manual compaction recovery', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset()
  })

  it('emits a terminal compaction event when persistence fails after kernel success', async () => {
    const successfulEnd: AgentTransportEvent = {
      type: 'compaction_end',
      reason: 'manual',
      result: { summary: 'Compacted context' },
      aborted: false,
      willRetry: false,
      timestamp: 2,
    }
    mocks.compactAgentSession.mockImplementation((input) =>
      Effect.gen(function* () {
        input.onEvent({ type: 'compaction_start', reason: 'manual', timestamp: 1 })
        input.onEvent(successfulEnd)
        return yield* Effect.fail(new Error('snapshot persistence failed'))
      }),
    )

    await expect(compact()).rejects.toThrow('snapshot persistence failed')

    expect(mocks.publishSessionHostEvent).toHaveBeenLastCalledWith({
      kind: 'session-transport',
      sessionId: SESSION_ID,
      event: expect.objectContaining({
        type: 'compaction_end',
        reason: 'manual',
        aborted: true,
        willRetry: false,
        errorMessage: 'snapshot persistence failed',
      }),
    })
    expect(activeCompactions.has(SESSION_ID)).toBe(false)
  })

  it('lists a manual compaction as active until it settles', async () => {
    let finishCompaction: (() => void) | undefined
    mocks.compactAgentSession.mockImplementation((input) =>
      Effect.async<void>((resume) => {
        input.onEvent({ type: 'compaction_start', reason: 'manual', timestamp: 7 })
        finishCompaction = () => resume(Effect.void)
      }),
    )
    const pending = compact()
    await vi.waitFor(() => expect(activeCompactions.has(SESSION_ID)).toBe(true))

    expect(listActiveCompactions()).toContainEqual({
      activity: 'compaction',
      sessionId: SESSION_ID,
      model: MODEL,
      reason: 'manual',
      startedAt: expect.any(Number),
    })

    finishCompaction?.()
    await pending
    expect(activeCompactions.has(SESSION_ID)).toBe(false)
  })
})

import type { AgentSendPayload } from '@shared/types/agent'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import type { UpsertSessionResourceInput } from '../../ports/session-resource-repository'
import { captureSuccessfulRunResources } from '../session-resource-capture'
import { subscribeToSessionResourceInvalidations } from '../session-resource-invalidation'
import { resourceMessages, sessionResourceTestLayer } from './session-resource-capture.fixtures'

describe('successful run resource invalidation', () => {
  it('refreshes the owning Session once after a multi-resource capture batch', async () => {
    const sessionId = SessionId('session-resource-owner')
    const invalidated = vi.fn()
    const unsubscribe = subscribeToSessionResourceInvalidations(invalidated)
    const upserts: UpsertSessionResourceInput[] = []
    const payload: AgentSendPayload = {
      text: 'Review [reference](https://user.example/reference)',
      thinkingLevel: 'medium',
      attachments: [],
    }

    await Effect.runPromise(
      captureSuccessfulRunResources({
        sessionId,
        runId: 'run-one',
        payload,
        messages: resourceMessages(),
      }).pipe(Effect.provide(sessionResourceTestLayer(upserts))),
    )
    unsubscribe()

    expect(upserts.length).toBeGreaterThan(1)
    expect(invalidated).toHaveBeenCalledOnce()
    expect(invalidated).toHaveBeenCalledWith({ sessionId })
  })
})

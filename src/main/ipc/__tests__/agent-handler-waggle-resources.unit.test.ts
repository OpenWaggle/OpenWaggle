import { MessageId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it } from 'vitest'
import { activeRuns, activeWaggleRuns } from '../active-agent-runs'
import {
  handoffMessage,
  MODEL,
  mocks,
  PAYLOAD,
  registerHandlers,
  resetAgentHandlerMocks,
  SESSION_ID,
} from './agent-handler-waggle-handoff.test-harness'

const RESOURCE_MESSAGES = [
  {
    id: MessageId('waggle-resource-message'),
    role: 'assistant' as const,
    createdAt: 2,
    parts: [{ type: 'text' as const, text: '![Design](https://example.test/design.png)' }],
  },
]

function prepareHandoff(outcome: 'success' | 'aborted' | 'error') {
  mocks.executeAgentRun.mockReturnValue(
    Effect.succeed({ outcome: 'success', newMessages: [handoffMessage()] }),
  )
  mocks.executeWaggleRun.mockReturnValue(
    Effect.succeed({
      outcome,
      newMessages: RESOURCE_MESSAGES,
      message: 'Provider stopped after partial output',
      code: 'provider-error',
      resourceMessages: RESOURCE_MESSAGES,
      resourceNodeIds: { 'waggle-resource-message': 'durable-waggle-node' },
      resourceBranchIds: { 'waggle-resource-message': 'waggle-branch' },
    }),
  )
  return registerHandlers()
}

describe('agent-triggered Waggle resource capture', () => {
  beforeEach(resetAgentHandlerMocks)

  it.each(['success', 'aborted', 'error'] as const)(
    'captures durable follow-on resources before completing a %s run',
    async (outcome) => {
      const { send } = prepareHandoff(outcome)

      await Effect.runPromise(send({}, SESSION_ID, PAYLOAD, MODEL))

      expect(mocks.captureSuccessfulRunResources).toHaveBeenCalledExactlyOnceWith({
        sessionId: SESSION_ID,
        runId: `waggle-${SESSION_ID}`,
        payload: expect.objectContaining({
          text: 'Review the durable result.',
          thinkingLevel: PAYLOAD.thinkingLevel,
          attachments: [],
          waggle: expect.objectContaining({ source: 'agent' }),
        }),
        messages: RESOURCE_MESSAGES,
        nodeIdByMessageId: { 'waggle-resource-message': 'durable-waggle-node' },
        branchIdByMessageId: { 'waggle-resource-message': 'waggle-branch' },
      })
      expect(mocks.captureSuccessfulRunResources).toHaveBeenCalledBefore(mocks.emitRunCompleted)
      expect(activeRuns.has(SESSION_ID)).toBe(false)
      expect(activeWaggleRuns.has(SESSION_ID)).toBe(false)
    },
  )

  it('does not lose successful run completion when resource indexing fails', async () => {
    const { send } = prepareHandoff('success')
    mocks.captureSuccessfulRunResources.mockReturnValue(Effect.fail(new Error('Catalog offline')))

    await Effect.runPromise(send({}, SESSION_ID, PAYLOAD, MODEL))

    expect(mocks.captureSuccessfulRunResources).toHaveBeenCalledOnce()
    expect(mocks.emitTransportEvent).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({ type: 'agent_end', runId: `waggle-${SESSION_ID}`, reason: 'stop' }),
    )
    expect(mocks.emitRunCompleted).toHaveBeenCalledOnce()
    expect(activeRuns.has(SESSION_ID)).toBe(false)
    expect(activeWaggleRuns.has(SESSION_ID)).toBe(false)
  })
})

import type { WaggleConfig } from '@shared/types/waggle'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it } from 'vitest'
import { executeWaggleRun } from '../waggle-run-service'
import {
  getTreeMock,
  resetWaggleRunServiceMocks,
  selectedModel,
  sessionId,
  TestLayer,
  waggleConfig,
} from './waggle-run-service.test-harness'

function runInput(config: WaggleConfig, runId: string) {
  return {
    sessionId,
    runId,
    payload: { text: 'Review the implementation', thinkingLevel: 'medium', attachments: [] },
    model: selectedModel,
    config,
    signal: new AbortController().signal,
    onEvent: () => undefined,
    onTurnEvent: () => undefined,
  } as const
}

describe('Waggle resource mapping', () => {
  beforeEach(() => resetWaggleRunServiceMocks())

  it('returns resources from newly persisted transcript nodes', async () => {
    const persistedAssistant = {
      id: 'persisted-assistant-message',
      role: 'assistant' as const,
      parts: [{ type: 'text' as const, text: 'See [the source](https://example.com).' }],
      createdAt: 10,
    }
    getTreeMock
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({ nodes: [{ id: 'existing-node' }] })
      .mockReturnValueOnce({
        nodes: [
          { id: 'existing-node' },
          {
            id: 'persisted-assistant-node',
            message: persistedAssistant,
            branchId: 'session-1:main',
            createdOrder: 2,
          },
        ],
      })

    const result = await Effect.runPromise(
      executeWaggleRun(runInput(waggleConfig, 'run-waggle-resource-mapping')).pipe(
        Effect.provide(TestLayer),
      ),
    )

    expect(result).toMatchObject({
      outcome: 'success',
      resourceMessages: [persistedAssistant],
      resourceNodeIds: { 'persisted-assistant-message': 'persisted-assistant-node' },
      resourceBranchIds: { 'persisted-assistant-message': 'session-1:main' },
    })
  })
})

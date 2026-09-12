import type { WaggleConfig } from '@shared/types/waggle'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it } from 'vitest'
import { SessionProjectionRepositoryError } from '../../errors'
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

  it('keeps a persisted Waggle run successful when the provenance refresh fails', async () => {
    getTreeMock
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({ nodes: [{ id: 'existing-node' }] })
      .mockReturnValueOnce(
        new SessionProjectionRepositoryError({
          operation: 'get-tree',
          cause: new Error('database temporarily unavailable'),
        }),
      )

    const result = await Effect.runPromise(
      executeWaggleRun(runInput(waggleConfig, 'run-waggle-provenance-read-failure')).pipe(
        Effect.provide(TestLayer),
      ),
    )

    expect(result).toMatchObject({
      outcome: 'success',
      resourceMessages: [],
      resourceNodeIds: {},
      resourceBranchIds: {},
    })
  })

  it('retains persisted resource provenance when cancellation follows partial output', async () => {
    const persistedAssistant = {
      id: 'persisted-partial-message',
      role: 'assistant' as const,
      parts: [{ type: 'text' as const, text: '[Partial docs](https://example.test/docs)' }],
      createdAt: 10,
    }
    getTreeMock
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({ nodes: [] })
      .mockReturnValueOnce({
        nodes: [
          {
            id: 'persisted-partial-node',
            message: persistedAssistant,
            branchId: 'session-1:main',
            createdOrder: 1,
          },
        ],
      })
    const controller = new AbortController()
    controller.abort()

    const result = await Effect.runPromise(
      executeWaggleRun({
        ...runInput(waggleConfig, 'run-waggle-partial-abort'),
        signal: controller.signal,
      }).pipe(Effect.provide(TestLayer)),
    )

    expect(result).toMatchObject({
      outcome: 'aborted',
      resourceMessages: [persistedAssistant],
      resourceNodeIds: { 'persisted-partial-message': 'persisted-partial-node' },
      resourceBranchIds: { 'persisted-partial-message': 'session-1:main' },
    })
  })
})

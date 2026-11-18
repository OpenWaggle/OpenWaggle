import { MessageId, SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import type { UpsertSessionResourceInput } from '../../ports/session-resource-repository'
import { captureRunResultResources } from '../session-resource-run-result'
import { sessionResourceTestLayer } from './session-resource-capture.fixtures'

const SESSION_ID = SessionId('hive-worker')
const PAYLOAD = { text: 'Read the spec.', thinkingLevel: 'medium' as const, attachments: [] }
const MESSAGES = [
  {
    id: MessageId('user-1'),
    role: 'user' as const,
    createdAt: 1,
    parts: [{ type: 'text' as const, text: 'Read the spec.' }],
  },
  {
    id: MessageId('assistant-1'),
    role: 'assistant' as const,
    createdAt: 2,
    parts: [{ type: 'text' as const, text: 'See [spec](https://example.test/spec).' }],
  },
]

describe('Session Host run resource capture', () => {
  it.each(['success', 'aborted'] as const)(
    'indexes persisted resources from a %s run using durable node identity',
    async (outcome) => {
      const upserts: UpsertSessionResourceInput[] = []
      await Effect.runPromise(
        captureRunResultResources(SESSION_ID, 'run-1', PAYLOAD, {
          outcome,
          resourceMessages: MESSAGES,
          resourceNodeIds: { 'user-1': 'node-user', 'assistant-1': 'node-assistant' },
          resourceBranchIds: { 'user-1': 'branch-main', 'assistant-1': 'branch-main' },
        }).pipe(Effect.provide(sessionResourceTestLayer(upserts))),
      )

      expect(upserts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            occurrence: expect.objectContaining({
              nodeId: 'node-assistant',
              branchId: 'branch-main',
            }),
          }),
        ]),
      )
    },
  )

  it('does not turn a delivered run into a failure when catalog indexing fails', async () => {
    await expect(
      Effect.runPromise(
        captureRunResultResources(SESSION_ID, 'run-2', PAYLOAD, {
          outcome: 'success',
          resourceMessages: MESSAGES,
        }).pipe(Effect.provide(sessionResourceTestLayer([], { upsertFails: true }))),
      ),
    ).resolves.toBeUndefined()
  })

  it('does not start indexing when persistence produced no resource messages', async () => {
    await expect(
      Effect.runPromise(
        captureRunResultResources(SESSION_ID, 'run-3', PAYLOAD, {
          outcome: 'error',
        }).pipe(Effect.provide(sessionResourceTestLayer([]))),
      ),
    ).resolves.toBeUndefined()
  })
})

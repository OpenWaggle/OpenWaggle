import { MessageId, SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import type { UpsertSessionResourceInput } from '../../ports/session-resource-repository'
import { captureSuccessfulRunResources } from '../session-resource-capture'
import { sessionResourceTestLayer } from './session-resource-capture.fixtures'

describe('session resource capture chronology', () => {
  it('uses persisted node time instead of wall-clock time for payload-only resources', async () => {
    const upserts: UpsertSessionResourceInput[] = []

    await Effect.runPromise(
      captureSuccessfulRunResources({
        sessionId: SessionId('session-1'),
        runId: 'run-1',
        payload: {
          text: 'Review [the source](https://user.example/source)',
          thinkingLevel: 'medium',
          attachments: [],
        },
        messages: [
          {
            id: MessageId('persisted-assistant-node'),
            role: 'assistant',
            parts: [{ type: 'text', text: 'Done.' }],
            createdAt: 4_242,
          },
        ],
      }).pipe(Effect.provide(sessionResourceTestLayer(upserts))),
    )

    expect(upserts).toEqual([
      expect.objectContaining({
        createdAt: 4_242,
        updatedAt: 4_242,
        occurrence: expect.objectContaining({ createdAt: 4_242 }),
      }),
    ])
  })
})

import type { Message } from '@shared/types/agent'
import { MessageId, SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import type { UpsertSessionResourceInput } from '../../ports/session-resource-repository'
import { captureProjectedSessionResources } from '../session-resource-backfill'
import { captureSuccessfulRunResources } from '../session-resource-capture'
import { resourceMessages, sessionResourceTestLayer } from './session-resource-capture.fixtures'

function capturedResource(input: UpsertSessionResourceInput): SessionResource {
  return {
    id: input.id,
    sessionId: input.sessionId,
    canonicalKey: input.canonicalKey,
    kind: input.kind,
    title: input.title,
    mimeType: input.mimeType,
    locator: input.locator,
    available: input.available,
    isSource: input.occurrence.activity !== 'created',
    isOutput: input.occurrence.activity === 'created',
    occurrences: [input.occurrence],
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  }
}

const attachment = {
  id: 'attachment-live',
  kind: 'text' as const,
  name: 'reference.txt',
  path: '/input/reference.txt',
  mimeType: 'text/plain',
  sizeBytes: 1,
  extractedText: 'x',
}

function persistedMessages(): readonly Message[] {
  return [
    {
      id: MessageId('user-live-resource'),
      role: 'user',
      parts: [
        { type: 'text', text: 'Review [reference](https://user.example/reference)' },
        { type: 'attachment', attachment },
      ],
      createdAt: 1000,
    },
    ...resourceMessages().filter((message) => message.role === 'assistant'),
  ]
}

describe('session resource occurrence identity', () => {
  it('reuses live identities instead of duplicating provenance during backfill', async () => {
    const messages = persistedMessages()
    const liveUpserts: UpsertSessionResourceInput[] = []
    await Effect.runPromise(
      captureSuccessfulRunResources({
        sessionId: SessionId('session-1'),
        runId: 'live-run-id',
        payload: {
          text: 'Review [reference](https://user.example/reference)',
          thinkingLevel: 'medium',
          attachments: [attachment],
        },
        messages,
      }).pipe(Effect.provide(sessionResourceTestLayer(liveUpserts))),
    )

    const backfillUpserts: UpsertSessionResourceInput[] = []
    const storedAttachmentFiles: string[] = []
    const storedByteFiles: string[] = []
    await Effect.runPromise(
      captureProjectedSessionResources({
        sessionId: SessionId('session-1'),
        messages,
      }).pipe(
        Effect.provide(
          sessionResourceTestLayer(backfillUpserts, {
            listedResources: liveUpserts.map(capturedResource),
            storedAttachmentFiles,
            storedByteFiles,
          }),
        ),
      ),
    )

    expect(backfillUpserts).toEqual([])
    expect(storedAttachmentFiles).toEqual([])
    expect(storedByteFiles).toEqual([])
  })
})

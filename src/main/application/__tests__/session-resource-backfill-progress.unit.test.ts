import type { Message } from '@shared/types/agent'
import { MessageId, SessionId, ToolCallId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import type { UpsertSessionResourceInput } from '../../ports/session-resource-repository'
import {
  ATTACHMENT_BACKFILL_LIMITS,
  captureProjectedSessionResources,
} from '../session-resource-backfill'
import { GENERATED_IMAGE_CAPTURE_LIMITS } from '../session-resource-capture'
import { PNG_BASE64, sessionResourceTestLayer } from './session-resource-capture.fixtures'

const SESSION_ID = SessionId('session-1')

function attachmentMessage(index: number): Message {
  return {
    id: MessageId(`user-attachment-${String(index)}`),
    role: 'user',
    parts: [
      {
        type: 'attachment',
        attachment: {
          id: `attachment-${String(index)}`,
          kind: 'text',
          name: `attachment-${String(index)}.txt`,
          path: `/input/attachment-${String(index)}.txt`,
          mimeType: 'text/plain',
          sizeBytes: 1,
          extractedText: 'x',
        },
      },
    ],
    createdAt: index,
  }
}

function imageMessage(index: number, data: string): Message {
  return {
    id: MessageId(`assistant-image-${String(index)}`),
    role: 'assistant',
    parts: [
      {
        type: 'tool-result',
        toolResult: {
          id: ToolCallId(`image-${String(index)}`),
          name: 'imagegen',
          args: {},
          result: { content: [{ type: 'image', data, mimeType: 'image/png' }] },
          isError: false,
          duration: 1,
        },
      },
    ],
    createdAt: index,
  }
}

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
    isSource: input.occurrence.activity === 'provided' || input.occurrence.activity === 'read',
    isOutput: input.occurrence.activity === 'created' || input.occurrence.activity === 'updated',
    occurrences: [input.occurrence],
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  }
}

describe('session resource backfill progress', () => {
  it('repairs an available attachment whose managed copy is unreadable', async () => {
    const message = attachmentMessage(0)
    const initialUpserts: UpsertSessionResourceInput[] = []
    await Effect.runPromise(
      captureProjectedSessionResources({ sessionId: SESSION_ID, messages: [message] }).pipe(
        Effect.provide(sessionResourceTestLayer(initialUpserts)),
      ),
    )
    const available = initialUpserts.at(0)
    if (!available) throw new Error('Expected an available attachment resource.')
    const availableResource = capturedResource(available)
    const storedAttachmentFiles: string[] = []
    const inspectedManagedPaths: string[] = []
    const readManagedPaths: string[] = []
    const repairedUpserts: UpsertSessionResourceInput[] = []

    await Effect.runPromise(
      captureProjectedSessionResources({ sessionId: SESSION_ID, messages: [message] }).pipe(
        Effect.provide(
          sessionResourceTestLayer(repairedUpserts, {
            listedResources: [availableResource],
            existingResource: availableResource,
            managedReadFails: true,
            storedAttachmentFiles,
            inspectedManagedPaths,
            readManagedPaths,
          }),
        ),
      ),
    )

    expect(storedAttachmentFiles).toEqual(['attachment-0.txt'])
    expect(inspectedManagedPaths).toEqual([
      '/managed/existing-resource.png',
      '/managed/existing-resource.png',
    ])
    expect(readManagedPaths).toEqual([])
    expect(repairedUpserts).toEqual([
      expect.objectContaining({ id: availableResource.id, available: true }),
    ])
  })

  it('captures later attachments without retrying known unavailable placeholders', async () => {
    const messages = Array.from({ length: ATTACHMENT_BACKFILL_LIMITS.maxCount + 1 }, (_, index) =>
      attachmentMessage(index),
    )
    const unavailableUpserts: UpsertSessionResourceInput[] = []
    await Effect.runPromise(
      captureProjectedSessionResources({ sessionId: SESSION_ID, messages }).pipe(
        Effect.provide(sessionResourceTestLayer(unavailableUpserts, { storeFileFails: true })),
      ),
    )
    const knownUnavailable = unavailableUpserts.map(capturedResource)
    const storedAttachmentFiles: string[] = []

    const secondPass = await Effect.runPromise(
      captureProjectedSessionResources({ sessionId: SESSION_ID, messages }).pipe(
        Effect.provide(
          sessionResourceTestLayer([], {
            listedResources: knownUnavailable,
            storedAttachmentFiles,
          }),
        ),
      ),
    )

    expect(storedAttachmentFiles).toContain(
      `attachment-${String(ATTACHMENT_BACKFILL_LIMITS.maxCount)}.txt`,
    )
    expect(storedAttachmentFiles).toHaveLength(1)
    expect(secondPass.fullyProjected).toBe(true)
  })

  it('advances across rejected image candidates on later bounded passes', async () => {
    const invalidMessages = Array.from(
      { length: GENERATED_IMAGE_CAPTURE_LIMITS.maxAttempts },
      (_, index) => imageMessage(index, 'not-a-valid-png'),
    )
    const messages = [
      ...invalidMessages,
      imageMessage(GENERATED_IMAGE_CAPTURE_LIMITS.maxAttempts, PNG_BASE64),
    ]
    const rejectedUpserts: UpsertSessionResourceInput[] = []
    await Effect.runPromise(
      captureProjectedSessionResources({ sessionId: SESSION_ID, messages }).pipe(
        Effect.provide(sessionResourceTestLayer(rejectedUpserts)),
      ),
    )
    const rejectedResources = rejectedUpserts.map(capturedResource)
    const storedByteFiles: string[] = []

    const secondPass = await Effect.runPromise(
      captureProjectedSessionResources({ sessionId: SESSION_ID, messages }).pipe(
        Effect.provide(
          sessionResourceTestLayer([], {
            listedResources: rejectedResources,
            storedByteFiles,
          }),
        ),
      ),
    )

    expect(rejectedResources).toHaveLength(GENERATED_IMAGE_CAPTURE_LIMITS.maxAttempts)
    expect(storedByteFiles).toHaveLength(1)
    expect(secondPass.fullyProjected).toBe(true)
  })
})

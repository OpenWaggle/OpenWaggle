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
import {
  PNG_BASE64,
  resourceMessages,
  sessionResourceTestLayer,
} from './session-resource-capture.fixtures'

function imageMessage(index: number): Message {
  return {
    id: MessageId(`assistant-backfill-${String(index)}`),
    role: 'assistant',
    parts: [
      {
        type: 'tool-result',
        toolResult: {
          id: ToolCallId(`backfill-image-${String(index)}`),
          name: 'imagegen',
          args: {},
          result: { content: [{ type: 'image', data: PNG_BASE64, mimeType: 'image/png' }] },
          isError: false,
          duration: 1,
        },
      },
    ],
    createdAt: index,
  }
}

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
    isSource: false,
    isOutput: true,
    occurrences: [input.occurrence],
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  }
}

describe('captureProjectedSessionResources', () => {
  it('backfills explicit resources from persisted messages with deterministic occurrences', async () => {
    const upserts: UpsertSessionResourceInput[] = []
    const persisted = resourceMessages()
    await Effect.runPromise(
      captureProjectedSessionResources({
        sessionId: SessionId('session-1'),
        messages: persisted,
      }).pipe(Effect.provide(sessionResourceTestLayer(upserts))),
    )

    expect(upserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          canonicalKey: 'url:https://user.example/reference',
          occurrence: expect.objectContaining({
            id: expect.not.stringContaining('backfill:'),
            nodeId: 'user-message',
          }),
        }),
        expect.objectContaining({
          kind: 'image',
          occurrence: expect.objectContaining({
            id: expect.not.stringContaining('backfill:'),
            nodeId: 'assistant-message',
          }),
        }),
      ]),
    )
  })

  it('does not rewrite managed image bytes when backfill finds the canonical resource', async () => {
    const upserts: UpsertSessionResourceInput[] = []
    const storedByteFiles: string[] = []
    const existingResource: SessionResource = {
      id: 'existing-image',
      sessionId: SessionId('session-1'),
      canonicalKey: `sha256:${'unused'}`,
      kind: 'image',
      title: 'Generated image.png',
      mimeType: 'image/png',
      locator: 'session-resource://existing-image',
      available: true,
      isSource: false,
      isOutput: true,
      occurrences: [],
      createdAt: 1000,
      updatedAt: 1000,
    }
    const assistantMessage = resourceMessages()[1]
    if (!assistantMessage) throw new Error('Expected the assistant fixture message.')

    await Effect.runPromise(
      captureProjectedSessionResources({
        sessionId: SessionId('session-1'),
        messages: [assistantMessage],
      }).pipe(
        Effect.provide(sessionResourceTestLayer(upserts, { existingResource, storedByteFiles })),
      ),
    )

    expect(storedByteFiles).toEqual([])
    expect(upserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'existing-image',
          locator: 'session-resource://existing-image',
        }),
      ]),
    )
  })

  it('replaces a cataloged managed image when its file is no longer readable', async () => {
    const initialUpserts: UpsertSessionResourceInput[] = []
    const initialStored: string[] = []
    const assistantMessage = resourceMessages()[1]
    if (!assistantMessage) throw new Error('Expected the assistant fixture message.')

    await Effect.runPromise(
      captureProjectedSessionResources({
        sessionId: SessionId('session-1'),
        messages: [assistantMessage],
      }).pipe(
        Effect.provide(
          sessionResourceTestLayer(initialUpserts, { storedByteFiles: initialStored }),
        ),
      ),
    )

    const catalogedInput = initialUpserts.find((input) => input.kind === 'image')
    if (!catalogedInput) throw new Error('Expected a cataloged generated image.')
    const existingResource = capturedResource(catalogedInput)
    const replacementUpserts: UpsertSessionResourceInput[] = []
    const storedByteFiles: string[] = []
    const removedPaths: string[] = []

    await Effect.runPromise(
      captureProjectedSessionResources({
        sessionId: SessionId('session-1'),
        messages: [assistantMessage],
      }).pipe(
        Effect.provide(
          sessionResourceTestLayer(replacementUpserts, {
            listedResources: [existingResource],
            existingResource,
            existingManagedPath: '/managed/deleted-image.png',
            managedReadFails: true,
            hasOccurrence: true,
            storedByteFiles,
            removedPaths,
          }),
        ),
      ),
    )

    expect(storedByteFiles).toContain('Generated image.png')
    expect(replacementUpserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          managedPath: expect.stringMatching(/^\/managed\//u),
          locator: expect.stringMatching(/^session-resource:\/\//u),
        }),
      ]),
    )
    expect(removedPaths).toContain('/managed/deleted-image.png')
  })

  it('bounds one lazy backfill pass and resumes from cataloged occurrences', async () => {
    const messages = Array.from(
      { length: GENERATED_IMAGE_CAPTURE_LIMITS.maxCount + 8 },
      (_, index) => imageMessage(index),
    )
    const firstUpserts: UpsertSessionResourceInput[] = []
    const firstStored: string[] = []

    await Effect.runPromise(
      captureProjectedSessionResources({ sessionId: SessionId('session-1'), messages }).pipe(
        Effect.provide(sessionResourceTestLayer(firstUpserts, { storedByteFiles: firstStored })),
      ),
    )

    expect(firstStored).toHaveLength(GENERATED_IMAGE_CAPTURE_LIMITS.maxCount)
    const cataloged = firstUpserts.filter((input) => input.kind === 'image').map(capturedResource)
    const resumedUpserts: UpsertSessionResourceInput[] = []
    const resumedStored: string[] = []

    await Effect.runPromise(
      captureProjectedSessionResources({ sessionId: SessionId('session-1'), messages }).pipe(
        Effect.provide(
          sessionResourceTestLayer(resumedUpserts, {
            listedResources: cataloged,
            storedByteFiles: resumedStored,
          }),
        ),
      ),
    )

    expect(resumedStored).toHaveLength(8)
  })

  it('bounds attachment work per lazy pass and resumes after known occurrences', async () => {
    const remainingCount = 3
    const messages = Array.from(
      { length: ATTACHMENT_BACKFILL_LIMITS.maxCount + remainingCount },
      (_, index) => attachmentMessage(index),
    )
    const firstUpserts: UpsertSessionResourceInput[] = []
    const firstStored: string[] = []

    await Effect.runPromise(
      captureProjectedSessionResources({ sessionId: SessionId('session-1'), messages }).pipe(
        Effect.provide(
          sessionResourceTestLayer(firstUpserts, { storedAttachmentFiles: firstStored }),
        ),
      ),
    )

    expect(firstStored).toHaveLength(ATTACHMENT_BACKFILL_LIMITS.maxCount)
    const cataloged = firstUpserts.map(capturedResource)
    const resumedStored: string[] = []

    await Effect.runPromise(
      captureProjectedSessionResources({ sessionId: SessionId('session-1'), messages }).pipe(
        Effect.provide(
          sessionResourceTestLayer([], {
            listedResources: cataloged,
            storedAttachmentFiles: resumedStored,
          }),
        ),
      ),
    )

    expect(resumedStored).toHaveLength(remainingCount)
  })

  it('retries only the targeted unavailable attachment occurrence', async () => {
    const message = attachmentMessage(0)
    const unavailableUpserts: UpsertSessionResourceInput[] = []

    await Effect.runPromise(
      captureProjectedSessionResources({
        sessionId: SessionId('session-1'),
        messages: [message],
      }).pipe(
        Effect.provide(
          sessionResourceTestLayer(unavailableUpserts, {
            storeFileFails: true,
          }),
        ),
      ),
    )

    const unavailable = unavailableUpserts.at(0)
    if (!unavailable) throw new Error('Expected an unavailable attachment resource.')
    const unavailableResource = capturedResource(unavailable)
    expect(unavailableResource.available).toBe(false)
    const storedAttachmentFiles: string[] = []
    const rekeyedCanonicalKeys: string[] = []

    await Effect.runPromise(
      captureProjectedSessionResources({
        sessionId: SessionId('session-1'),
        messages: [message],
        retryUnavailableResourceId: unavailableResource.id,
      }).pipe(
        Effect.provide(
          sessionResourceTestLayer([], {
            listedResources: [unavailableResource],
            existingResource: unavailableResource,
            hasOccurrence: true,
            storedAttachmentFiles,
            rekeyedCanonicalKeys,
          }),
        ),
      ),
    )

    expect(storedAttachmentFiles).toEqual(['attachment-0.txt'])
    expect(rekeyedCanonicalKeys).toEqual(['sha256:attachment-digest'])
  })
})

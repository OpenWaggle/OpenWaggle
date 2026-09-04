import type { Message } from '@shared/types/agent'
import { MessageId, SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import type { UpsertSessionResourceInput } from '../../ports/session-resource-repository'
import { captureProjectedSessionResources } from '../session-resource-backfill'
import { ATTACHMENT_BACKFILL_LIMITS } from '../session-resource-backfill-budget'
import { sessionResourceTestLayer } from './session-resource-capture.fixtures'

function attachmentMessage(index: number, sourcePath?: string): Message {
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
          path: sourcePath ?? `/input/attachment-${String(index)}.txt`,
          mimeType: 'text/plain',
          sizeBytes: 1,
          extractedText: 'x',
        },
      },
    ],
    createdAt: index,
  }
}

function sharedResource(count: number): SessionResource {
  return {
    id: 'shared-attachment-resource',
    sessionId: SessionId('session-1'),
    canonicalKey: `sha256:${'a'.repeat(64)}`,
    kind: 'file',
    title: 'attachment-0.txt',
    mimeType: 'text/plain',
    locator: '/input/attachment-0.txt',
    managed: true,
    available: true,
    isSource: true,
    isOutput: false,
    occurrences: Array.from({ length: count }, (_, index) => ({
      id: `session-1:user-attachment-${String(index)}:provided:attachment:attachment-${String(index)}:0`,
      nodeId: `user-attachment-${String(index)}`,
      branchId: null,
      actor: 'user' as const,
      activity: 'provided' as const,
      label: null,
      createdAt: index,
    })),
    createdAt: 0,
    updatedAt: count - 1,
  }
}

describe('session resource backfill attachment repair', () => {
  it('stops repairing a shared resource after the first usable source', async () => {
    const resource = sharedResource(2)
    const upserts: UpsertSessionResourceInput[] = []
    const storedAttachmentFiles: string[] = []

    await Effect.runPromise(
      captureProjectedSessionResources({
        sessionId: SessionId('session-1'),
        messages: [attachmentMessage(0), attachmentMessage(1)],
      }).pipe(
        Effect.provide(
          sessionResourceTestLayer(upserts, {
            listedResources: [resource],
            existingResource: resource,
            existingManagedPath: '/managed/missing-shared.txt',
            managedReadFails: true,
            storeFileFailsFor: ['/input/attachment-1.txt'],
            storedAttachmentFiles,
          }),
        ),
      ),
    )

    expect(storedAttachmentFiles).toEqual(['attachment-0.txt'])
    expect(upserts).toHaveLength(1)
    expect(upserts[0]).toMatchObject({
      id: 'shared-attachment-resource',
      managedPath: expect.stringMatching(/^\/managed\//u),
      available: true,
    })
  })

  it('resumes after the last failed source when a shared resource exceeds one pass', async () => {
    const count = ATTACHMENT_BACKFILL_LIMITS.maxCount + 1
    const messages = Array.from({ length: count }, (_, index) => attachmentMessage(index))
    const resource = sharedResource(count)
    const failedPaths = Array.from(
      { length: ATTACHMENT_BACKFILL_LIMITS.maxCount },
      (_, index) => `/input/attachment-${String(index)}.txt`,
    )
    const firstUpserts: UpsertSessionResourceInput[] = []

    await Effect.runPromise(
      captureProjectedSessionResources({ sessionId: SessionId('session-1'), messages }).pipe(
        Effect.provide(
          sessionResourceTestLayer(firstUpserts, {
            listedResources: [resource],
            existingResource: resource,
            existingManagedPath: '/managed/missing-shared.txt',
            managedReadFails: true,
            storeFileFailsFor: failedPaths,
          }),
        ),
      ),
    )

    expect(firstUpserts).toHaveLength(ATTACHMENT_BACKFILL_LIMITS.maxCount)
    const lastFailure = firstUpserts.at(-1)
    expect(lastFailure?.locator).toBe(
      `/input/attachment-${String(ATTACHMENT_BACKFILL_LIMITS.maxCount - 1)}.txt`,
    )
    const retryResource: SessionResource = {
      ...resource,
      locator: lastFailure?.locator ?? resource.locator,
      managed: false,
      available: false,
    }
    const retryUpserts: UpsertSessionResourceInput[] = []
    const retryStored: string[] = []

    await Effect.runPromise(
      captureProjectedSessionResources({
        sessionId: SessionId('session-1'),
        messages,
        retryUnavailableResourceId: resource.id,
      }).pipe(
        Effect.provide(
          sessionResourceTestLayer(retryUpserts, {
            listedResources: [retryResource],
            existingResource: retryResource,
            storeFileFailsFor: failedPaths,
            storedAttachmentFiles: retryStored,
          }),
        ),
      ),
    )

    expect(retryStored).toEqual([`attachment-${String(ATTACHMENT_BACKFILL_LIMITS.maxCount)}.txt`])
    expect(retryUpserts).toContainEqual(
      expect.objectContaining({ id: resource.id, available: true }),
    )
  })

  it('tries each repeated source path once before moving to a usable source', async () => {
    const repeatedCount = ATTACHMENT_BACKFILL_LIMITS.maxCount + 1
    const messages = [
      ...Array.from({ length: repeatedCount }, (_, index) =>
        attachmentMessage(index, '/input/repeated-missing.txt'),
      ),
      attachmentMessage(repeatedCount, '/input/usable.txt'),
    ]
    const resource = {
      ...sharedResource(messages.length),
      locator: '/input/repeated-missing.txt',
    }
    const upserts: UpsertSessionResourceInput[] = []
    const stored: string[] = []

    await Effect.runPromise(
      captureProjectedSessionResources({ sessionId: SessionId('session-1'), messages }).pipe(
        Effect.provide(
          sessionResourceTestLayer(upserts, {
            listedResources: [resource],
            existingResource: resource,
            existingManagedPath: '/managed/missing-shared.txt',
            managedReadFails: true,
            storeFileFailsFor: ['/input/repeated-missing.txt'],
            storedAttachmentFiles: stored,
          }),
        ),
      ),
    )

    expect(stored).toEqual([`attachment-${String(repeatedCount)}.txt`])
    expect(upserts).toHaveLength(2)
    expect(upserts.at(-1)).toMatchObject({ id: resource.id, available: true })
  })
})

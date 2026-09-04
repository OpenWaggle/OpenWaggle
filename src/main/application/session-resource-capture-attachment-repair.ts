import { ATTACHMENT } from '@shared/constants/resource-limits'
import type { SessionResource, SessionResourceOccurrence } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import type { SessionResourceRepositoryShape } from '../ports/session-resource-repository'
import type { SessionResourceStoreShape } from '../ports/session-resource-store'
import type { CaptureAttachmentInput } from './session-resource-capture-attachment'
import {
  inspectManagedCopy,
  occurrence,
  removeReplacedCopy,
} from './session-resource-capture-shared'

function resourceOccurrence(input: CaptureAttachmentInput, id: string): SessionResourceOccurrence {
  return occurrence({
    id,
    nodeId: input.nodeId,
    branchId: input.branchId,
    actor: 'user',
    activity: 'provided',
    createdAt: input.createdAt,
  })
}

function expectedSha256(resource: SessionResource) {
  return resource.canonicalKey.startsWith('sha256:')
    ? resource.canonicalKey.slice('sha256:'.length)
    : undefined
}

export function repairManagedAttachment(
  input: CaptureAttachmentInput,
  occurrenceId: string,
  resource: SessionResource,
  repository: SessionResourceRepositoryShape,
  store: SessionResourceStoreShape,
) {
  return Effect.gen(function* () {
    const stored = yield* store
      .storeFile({
        sessionId: input.sessionId,
        resourceId: resource.id,
        fileName: input.attachment.name,
        sourcePath: input.attachment.path,
        expectedSizeBytes: input.attachment.sizeBytes,
        expectedSha256: input.attachment.contentSha256 ?? expectedSha256(resource),
        maxSizeBytes: ATTACHMENT.MAX_SIZE_BYTES,
      })
      .pipe(Effect.option)
    if (stored._tag === 'None') {
      yield* repository.upsert({
        id: resource.id,
        sessionId: input.sessionId,
        canonicalKey: resource.canonicalKey,
        kind: resource.kind,
        title: input.attachment.name,
        mimeType: input.attachment.mimeType,
        locator: input.attachment.path,
        managedPath: null,
        available: false,
        occurrence: resourceOccurrence(input, occurrenceId),
        createdAt: resource.createdAt,
        updatedAt: input.createdAt,
      })
      return
    }

    const existingCopy = yield* inspectManagedCopy(repository, store, input.sessionId, resource.id)
    const locator = `session-resource://${resource.id}`
    const repaired = yield* repository
      .upsert({
        id: resource.id,
        sessionId: input.sessionId,
        canonicalKey: resource.canonicalKey,
        kind: resource.kind,
        title: input.attachment.name,
        mimeType: input.attachment.mimeType,
        locator,
        managedPath: stored.value.path,
        available: true,
        occurrence: resourceOccurrence(input, occurrenceId),
        createdAt: resource.createdAt,
        updatedAt: input.createdAt,
      })
      .pipe(
        Effect.tapError(() =>
          store.remove(stored.value.path).pipe(Effect.catchAll(() => Effect.void)),
        ),
      )
    if (repaired.locator !== locator) yield* store.remove(stored.value.path)
    else yield* removeReplacedCopy(store, existingCopy?.managedPath, stored.value.path)
  })
}

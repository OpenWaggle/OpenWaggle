import { randomUUID } from 'node:crypto'
import { ATTACHMENT } from '@shared/constants/resource-limits'
import type { AgentSendPayload } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import type {
  SessionResource,
  SessionResourceKind,
  SessionResourceOccurrence,
} from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import {
  SessionResourceRepository,
  type SessionResourceRepositoryShape,
} from '../ports/session-resource-repository'
import {
  SessionResourceStore,
  type SessionResourceStoreShape,
  type StoredSessionResourceFile,
} from '../ports/session-resource-store'
import {
  inspectManagedCopy,
  occurrence,
  occurrenceId,
  removeReplacedCopy,
} from './session-resource-capture-shared'

interface CaptureAttachmentInput {
  readonly sessionId: SessionId
  readonly runId: string
  readonly attachment: AgentSendPayload['attachments'][number]
  readonly index: number
  readonly nodeId: string | null
  readonly createdAt: number
  readonly branchId?: string | null
}

function attachmentKind(input: CaptureAttachmentInput): SessionResourceKind {
  return input.attachment.kind === 'image' ? 'image' : 'file'
}

function attachmentOccurrence(
  input: CaptureAttachmentInput,
  id: string,
): SessionResourceOccurrence {
  return occurrence({
    id,
    nodeId: input.nodeId,
    branchId: input.branchId,
    actor: 'user',
    activity: 'provided',
    createdAt: input.createdAt,
  })
}

function storeAttachment(
  input: CaptureAttachmentInput,
  id: string,
  resourceId: string,
  fallbackCanonicalKey: string,
  repository: SessionResourceRepositoryShape,
  store: SessionResourceStoreShape,
) {
  return store
    .storeFile({
      sessionId: input.sessionId,
      resourceId,
      fileName: input.attachment.name,
      sourcePath: input.attachment.path,
      expectedSizeBytes: input.attachment.sizeBytes,
      maxSizeBytes: ATTACHMENT.MAX_SIZE_BYTES,
    })
    .pipe(
      Effect.map((stored) => ({ _tag: 'Stored' as const, stored })),
      Effect.catchAll(() =>
        repository
          .upsert({
            id: resourceId,
            sessionId: input.sessionId,
            canonicalKey: fallbackCanonicalKey,
            kind: attachmentKind(input),
            title: input.attachment.name,
            mimeType: input.attachment.mimeType,
            locator: input.attachment.path,
            managedPath: null,
            available: false,
            occurrence: attachmentOccurrence(input, id),
            createdAt: input.createdAt,
            updatedAt: input.createdAt,
          })
          .pipe(Effect.as({ _tag: 'Unavailable' as const })),
      ),
    )
}

function restoreUnavailableAttachment(
  input: CaptureAttachmentInput,
  id: string,
  unavailableResource: SessionResource,
  stored: StoredSessionResourceFile,
  repository: SessionResourceRepositoryShape,
  store: SessionResourceStoreShape,
) {
  return Effect.gen(function* () {
    const canonicalKey = `sha256:${stored.sha256}`
    const rekeyed = yield* repository.rekey({
      sessionId: input.sessionId,
      resourceId: unavailableResource.id,
      canonicalKey,
      updatedAt: input.createdAt,
    })
    const existingCopy = yield* inspectManagedCopy(repository, store, input.sessionId, rekeyed.id)
    if (rekeyed.id !== unavailableResource.id && existingCopy?.readable) {
      yield* reuseExistingAttachment(
        input,
        id,
        canonicalKey,
        rekeyed,
        stored.path,
        repository,
        store,
      )
      return
    }

    const locator = `session-resource://${rekeyed.id}`
    const resource = yield* repository.upsert({
      id: rekeyed.id,
      sessionId: input.sessionId,
      canonicalKey,
      kind: attachmentKind(input),
      title: input.attachment.name,
      mimeType: input.attachment.mimeType,
      locator,
      managedPath: stored.path,
      available: true,
      occurrence: attachmentOccurrence(input, id),
      createdAt: rekeyed.createdAt,
      updatedAt: input.createdAt,
    })
    if (resource.locator !== locator) yield* store.remove(stored.path)
    else yield* removeReplacedCopy(store, existingCopy?.managedPath, stored.path)
  }).pipe(Effect.tapError(() => store.remove(stored.path).pipe(Effect.catchAll(() => Effect.void))))
}

function reuseExistingAttachment(
  input: CaptureAttachmentInput,
  id: string,
  canonicalKey: string,
  existing: SessionResource,
  storedPath: string,
  repository: SessionResourceRepositoryShape,
  store: SessionResourceStoreShape,
) {
  return repository
    .upsert({
      id: existing.id,
      sessionId: input.sessionId,
      canonicalKey,
      kind: attachmentKind(input),
      title: existing.title,
      mimeType: existing.mimeType ?? input.attachment.mimeType,
      locator: existing.locator,
      managedPath: null,
      available: existing.available,
      occurrence: attachmentOccurrence(input, id),
      createdAt: existing.createdAt,
      updatedAt: input.createdAt,
    })
    .pipe(Effect.flatMap(() => store.remove(storedPath)))
}

function captureStoredAttachment(
  input: CaptureAttachmentInput,
  id: string,
  resourceId: string,
  stored: StoredSessionResourceFile,
  repository: SessionResourceRepositoryShape,
  store: SessionResourceStoreShape,
) {
  return Effect.gen(function* () {
    const canonicalKey = `sha256:${stored.sha256}`
    const existing = yield* repository.findByCanonicalKey(input.sessionId, canonicalKey)
    const existingCopy = existing
      ? yield* inspectManagedCopy(repository, store, input.sessionId, existing.id)
      : null
    if (existing && existingCopy?.readable) {
      yield* reuseExistingAttachment(
        input,
        id,
        canonicalKey,
        existing,
        stored.path,
        repository,
        store,
      )
      return
    }
    const locator = `session-resource://${resourceId}`
    const resource = yield* repository
      .upsert({
        id: resourceId,
        sessionId: input.sessionId,
        canonicalKey,
        kind: attachmentKind(input),
        title: input.attachment.name,
        mimeType: input.attachment.mimeType,
        locator,
        managedPath: stored.path,
        available: true,
        occurrence: attachmentOccurrence(input, id),
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      })
      .pipe(
        Effect.tapError(() => store.remove(stored.path).pipe(Effect.catchAll(() => Effect.void))),
      )
    if (resource.locator !== locator) yield* store.remove(stored.path)
    else yield* removeReplacedCopy(store, existingCopy?.managedPath, stored.path)
  })
}

export function captureAttachment(input: CaptureAttachmentInput) {
  return Effect.gen(function* () {
    const repository = yield* SessionResourceRepository
    const fallbackCanonicalKey = `file:${input.attachment.path}`
    const unavailableResource = yield* repository.findByCanonicalKey(
      input.sessionId,
      fallbackCanonicalKey,
    )
    const id = occurrenceId({
      ...input,
      suffix: `provided:attachment:${input.attachment.id}:${String(input.index)}`,
    })
    const occurrenceExists = yield* repository.hasOccurrence(input.sessionId, id)
    if (occurrenceExists && unavailableResource?.available !== false) return
    const store = yield* SessionResourceStore
    const resourceId =
      unavailableResource?.available === false ? unavailableResource.id : randomUUID()
    const storedResult = yield* storeAttachment(
      input,
      id,
      resourceId,
      fallbackCanonicalKey,
      repository,
      store,
    )
    if (storedResult._tag === 'Unavailable') return
    const { stored } = storedResult
    if (unavailableResource?.available === false) {
      yield* restoreUnavailableAttachment(input, id, unavailableResource, stored, repository, store)
      return
    }
    yield* captureStoredAttachment(input, id, resourceId, stored, repository, store)
  })
}

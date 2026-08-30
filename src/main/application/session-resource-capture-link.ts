import { randomUUID } from 'node:crypto'
import type { SessionId } from '@shared/types/brand'
import type { SessionResourceActivity, SessionResourceActor } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import { SessionResourceImageFetcher } from '../ports/session-resource-image-fetcher'
import {
  SessionResourceRepository,
  type SessionResourceRepositoryShape,
} from '../ports/session-resource-repository'
import {
  SessionResourceStore,
  type SessionResourceStoreShape,
} from '../ports/session-resource-store'
import {
  inspectManagedCopy,
  occurrence,
  occurrenceId,
  removeReplacedCopy,
  sha256,
} from './session-resource-capture-shared'
import type { CapturedLink } from './session-resource-extraction'

interface LinkCaptureInput {
  readonly sessionId: SessionId
  readonly runId: string
  readonly link: CapturedLink
  readonly index: number
  readonly nodeId: string | null
  readonly actor: SessionResourceActor
  readonly activity: SessionResourceActivity
  readonly createdAt: number
  readonly branchId?: string | null
}

function linkOccurrence(input: LinkCaptureInput, id: string) {
  return occurrence({
    id,
    nodeId: input.nodeId,
    branchId: input.branchId,
    actor: input.actor,
    activity: input.activity,
    createdAt: input.createdAt,
  })
}

function captureRemoteImage(input: {
  readonly capture: LinkCaptureInput
  readonly id: string
  readonly resourceId: string
  readonly existingManagedPath: string | undefined
  readonly repository: SessionResourceRepositoryShape
  readonly store: SessionResourceStoreShape
}) {
  return Effect.gen(function* () {
    const fetched = yield* SessionResourceImageFetcher.pipe(
      Effect.flatMap((fetcher) => fetcher.fetch(input.capture.link.url)),
      Effect.option,
    )
    if (fetched._tag === 'None') return false
    const stored = yield* input.store.storeBytes({
      sessionId: input.capture.sessionId,
      resourceId: input.resourceId,
      fileName: fetched.value.fileName,
      bytes: fetched.value.bytes,
    })
    const locator = `session-resource://${input.resourceId}`
    const resource = yield* input.repository
      .upsert({
        id: input.resourceId,
        sessionId: input.capture.sessionId,
        canonicalKey: `url:${input.capture.link.url}`,
        kind: 'image',
        title:
          input.capture.link.title === input.capture.link.url
            ? fetched.value.fileName
            : input.capture.link.title,
        mimeType: fetched.value.mimeType,
        locator,
        managedPath: stored.path,
        available: true,
        occurrence: linkOccurrence(input.capture, input.id),
        createdAt: input.capture.createdAt,
        updatedAt: input.capture.createdAt,
      })
      .pipe(
        Effect.tapError(() =>
          input.store.remove(stored.path).pipe(Effect.catchAll(() => Effect.void)),
        ),
      )
    if (resource.locator !== locator) yield* input.store.remove(stored.path)
    else yield* removeReplacedCopy(input.store, input.existingManagedPath, stored.path)
    return true
  })
}

export function captureLink(input: LinkCaptureInput) {
  return Effect.gen(function* () {
    const repository = yield* SessionResourceRepository
    const id = occurrenceId({
      ...input,
      suffix: `${input.activity}:link:${String(input.index)}:${sha256(Buffer.from(input.link.url))}`,
    })
    if (yield* repository.hasOccurrence(input.sessionId, id)) return
    const resourceId = randomUUID()
    const existing = input.link.image
      ? yield* repository.findByCanonicalKey(input.sessionId, `url:${input.link.url}`)
      : null
    const store = yield* SessionResourceStore
    const existingCopy = existing
      ? yield* inspectManagedCopy(repository, store, input.sessionId, existing.id)
      : null
    if (existing?.locator?.startsWith('session-resource://') && existingCopy?.readable) {
      yield* repository.upsert({
        id: existing.id,
        sessionId: input.sessionId,
        canonicalKey: existing.canonicalKey,
        kind: 'image',
        title: existing.title,
        mimeType: existing.mimeType,
        locator: existing.locator,
        managedPath: null,
        available: existing.available,
        occurrence: linkOccurrence(input, id),
        createdAt: existing.createdAt,
        updatedAt: input.createdAt,
      })
      return
    }
    if (input.link.image) {
      const captured = yield* captureRemoteImage({
        capture: input,
        id,
        resourceId,
        existingManagedPath: existingCopy?.managedPath,
        repository,
        store,
      })
      if (captured) return
    }
    yield* repository.upsert({
      id: resourceId,
      sessionId: input.sessionId,
      canonicalKey: `url:${input.link.url}`,
      kind: input.link.image ? 'image' : 'link',
      title: input.link.title,
      mimeType: null,
      locator: input.link.url,
      managedPath: null,
      available: true,
      occurrence: linkOccurrence(input, id),
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    })
  })
}

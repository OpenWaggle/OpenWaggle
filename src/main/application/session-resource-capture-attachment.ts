import { randomUUID } from 'node:crypto'
import type { AgentSendPayload } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { SessionResourceRepository } from '../ports/session-resource-repository'
import { SessionResourceStore } from '../ports/session-resource-store'
import {
  inspectManagedCopy,
  occurrence,
  occurrenceId,
  removeReplacedCopy,
} from './session-resource-capture-shared'

export function captureAttachment(input: {
  readonly sessionId: SessionId
  readonly runId: string
  readonly attachment: AgentSendPayload['attachments'][number]
  readonly index: number
  readonly nodeId: string | null
  readonly createdAt: number
  readonly branchId?: string | null
}) {
  return Effect.gen(function* () {
    const repository = yield* SessionResourceRepository
    const id = occurrenceId({
      ...input,
      suffix: `provided:attachment:${input.attachment.id}:${String(input.index)}`,
    })
    if (yield* repository.hasOccurrence(input.sessionId, id)) return
    const store = yield* SessionResourceStore
    const resourceId = randomUUID()
    const stored = yield* store.storeFile({
      sessionId: input.sessionId,
      resourceId,
      fileName: input.attachment.name,
      sourcePath: input.attachment.path,
    })
    const canonicalKey = `sha256:${stored.sha256}`
    const existing = yield* repository.findByCanonicalKey(input.sessionId, canonicalKey)
    const existingCopy = existing
      ? yield* inspectManagedCopy(repository, store, input.sessionId, existing.id)
      : null
    if (existing && existingCopy?.readable) {
      yield* repository.upsert({
        id: existing.id,
        sessionId: input.sessionId,
        canonicalKey,
        kind: input.attachment.kind === 'image' ? 'image' : 'file',
        title: existing.title,
        mimeType: existing.mimeType ?? input.attachment.mimeType,
        locator: existing.locator,
        managedPath: null,
        available: existing.available,
        occurrence: occurrence({
          id,
          nodeId: input.nodeId,
          branchId: input.branchId,
          actor: 'user',
          activity: 'provided',
          createdAt: input.createdAt,
        }),
        createdAt: existing.createdAt,
        updatedAt: input.createdAt,
      })
      yield* store.remove(stored.path)
      return
    }
    const locator = `session-resource://${resourceId}`
    const resource = yield* repository
      .upsert({
        id: resourceId,
        sessionId: input.sessionId,
        canonicalKey,
        kind: input.attachment.kind === 'image' ? 'image' : 'file',
        title: input.attachment.name,
        mimeType: input.attachment.mimeType,
        locator,
        managedPath: stored.path,
        available: true,
        occurrence: occurrence({
          id,
          nodeId: input.nodeId,
          branchId: input.branchId,
          actor: 'user',
          activity: 'provided',
          createdAt: input.createdAt,
        }),
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

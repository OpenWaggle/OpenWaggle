import { createHash } from 'node:crypto'
import path from 'node:path'
import type { SessionId } from '@shared/types/brand'
import type { SessionResourceActivity, SessionResourceActor } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import type { SessionResourceRepositoryShape } from '../ports/session-resource-repository'
import type { SessionResourceStoreShape } from '../ports/session-resource-store'

export function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

function extensionForMimeType(mimeType: string) {
  if (mimeType === 'image/jpeg') return '.jpg'
  if (mimeType === 'image/webp') return '.webp'
  if (mimeType === 'image/gif') return '.gif'
  if (mimeType === 'image/svg+xml') return '.svg'
  return '.png'
}

export function imageFileName(title: string, mimeType: string) {
  return path.extname(title) ? title : `${title}${extensionForMimeType(mimeType)}`
}

export function occurrence(input: {
  readonly id: string
  readonly nodeId: string | null
  readonly actor: SessionResourceActor
  readonly activity: SessionResourceActivity
  readonly createdAt: number
  readonly branchId?: string | null
}) {
  return {
    id: input.id,
    nodeId: input.nodeId,
    branchId: input.branchId ?? null,
    actor: input.actor,
    activity: input.activity,
    label: null,
    createdAt: input.createdAt,
  }
}

export function occurrenceId(input: {
  readonly sessionId: SessionId
  readonly nodeId: string | null
  readonly suffix: string
}) {
  return `${String(input.sessionId)}:${input.nodeId ?? 'unlinked'}:${input.suffix}`
}

export function inspectManagedCopy(
  repository: SessionResourceRepositoryShape,
  store: SessionResourceStoreShape,
  sessionId: SessionId,
  resourceId: string,
) {
  return Effect.gen(function* () {
    const location = yield* repository.getContentLocation(sessionId, resourceId)
    if (!location) return null
    const readable = yield* store.read(location.managedPath).pipe(
      Effect.as(true),
      Effect.catchAll(() => Effect.succeed(false)),
    )
    return { managedPath: location.managedPath, readable }
  })
}

export function removeReplacedCopy(
  store: SessionResourceStoreShape,
  previousPath: string | undefined,
  currentPath: string,
) {
  if (!previousPath || previousPath === currentPath) return Effect.void
  return store.remove(previousPath).pipe(Effect.catchAll(() => Effect.void))
}

import { type Schema, safeDecodeUnknown } from '@shared/schema'
import {
  archivedItemsChangeSchema,
  archivedItemsQuerySchema,
  archivedItemsRefsQuerySchema,
  archivedSessionIdsSchema,
} from '@shared/schemas/archived-items'
import {
  type ArchivedItemChanged,
  type ArchivedItemChangeFailure,
  type ArchivedItemRef,
  type ArchivedItemsChangeResult,
  type ArchivedSessionsDeletionResult,
  archivedItemKey,
} from '@shared/types/archived-items'
import type { SessionId } from '@shared/types/brand'
import { formatErrorMessage } from '@shared/utils/node-error'
import * as Effect from 'effect/Effect'
import * as Either from 'effect/Either'
import { SessionRepository } from '../ports/session-repository'
import {
  deleteSession,
  mutateLocalUiSession,
  organizeSession,
} from './host-ui-session-lifecycle-operations'
import { invalid, requireArgCount } from './host-ui-session-operation-validation'

function decodeArgument<A, I>(schema: Schema.Schema<A, I, never>, value: unknown, label: string) {
  const decoded = safeDecodeUnknown(schema, value)
  return decoded.success
    ? Effect.succeed(decoded.data)
    : invalid(`${label} is invalid: ${decoded.issues.join('; ')}`)
}

/** `[query]`: one page of Settings > Archived items with its Archive facet counts. */
export function queryArchivedItems(args: readonly unknown[]) {
  return Effect.gen(function* () {
    yield* requireArgCount(args, 1)
    const query = yield* decodeArgument(archivedItemsQuerySchema, args[0], 'Archived items query')
    return yield* (yield* SessionRepository).queryArchivedItems(query)
  })
}

/** `[query]`: the Archived items a filter matches, for Select all. */
export function listArchivedItemRefs(args: readonly unknown[]) {
  return Effect.gen(function* () {
    yield* requireArgCount(args, 1)
    const query = yield* decodeArgument(
      archivedItemsRefsQuerySchema,
      args[0],
      'Archived items selection query',
    )
    return yield* (yield* SessionRepository).listArchivedItemRefs(query)
  })
}

function changeArchivedItem(ref: ArchivedItemRef, archived: boolean) {
  if (ref.kind === 'branch') {
    return mutateLocalUiSession({
      operation: archived ? 'archive-branch' : 'restore-branch',
      sessionId: ref.sessionId,
      branchId: ref.branchId,
    }).pipe(Effect.asVoid)
  }
  return organizeSession(
    { operation: archived ? 'archive' : 'unarchive', sessionId: ref.sessionId },
    archived ? 'session-archived' : 'session-unarchived',
  )
}

/** Whether an item's state (its Archive time, or null) is the one a change starts from. */
function startsFrom(state: number | null | undefined, archived: boolean) {
  if (state === undefined) return false
  return archived ? state === null : state !== null
}

/**
 * `[{ archived, items }]`: restores (or, for Undo, archives again) many Archived items in one call.
 * Each item goes through the same Session Host command as restoring it alone, one after another so
 * two branches of one session never race for its tree. Items already in the requested state, for
 * example restored in another window since they were selected, are skipped, so Undo never archives
 * what this restore did not bring back. Undo puts back the Archive times the restore reported.
 * One item failing does not stop the rest.
 */
export function setArchivedItems(args: readonly unknown[]) {
  return Effect.gen(function* () {
    yield* requireArgCount(args, 1)
    const change = yield* decodeArgument(
      archivedItemsChangeSchema,
      args[0],
      'Archived items change',
    )
    const repository = yield* SessionRepository
    const states = yield* repository.readArchivedItemStates(change.items.map((item) => item.ref))
    const changed: ArchivedItemChanged[] = []
    const skipped: ArchivedItemRef[] = []
    const failed: ArchivedItemChangeFailure[] = []
    for (const item of change.items) {
      const state = states.get(archivedItemKey(item.ref))
      if (!startsFrom(state, change.archived)) {
        skipped.push(item.ref)
        continue
      }
      const outcome = yield* Effect.either(changeArchivedItem(item.ref, change.archived))
      if (Either.isLeft(outcome)) {
        failed.push({ ref: item.ref, message: formatErrorMessage(outcome.left) })
        continue
      }
      changed.push({ ref: item.ref, archivedAt: state ?? null })
    }
    const archiveTimes = change.archived
      ? change.items.flatMap((item) =>
          item.archivedAt !== undefined &&
          changed.some((entry) => archivedItemKey(entry.ref) === archivedItemKey(item.ref))
            ? [{ ref: item.ref, archivedAt: item.archivedAt }]
            : [],
        )
      : []
    if (archiveTimes.length > 0) yield* repository.setArchiveTimes(archiveTimes)
    return { changed, skipped, failed } satisfies ArchivedItemsChangeResult
  })
}

/**
 * `[sessionIds]`: permanently deletes archived sessions, after the user confirmed. A session that
 * is no longer archived (restored elsewhere since it was selected) is skipped, never deleted. A
 * Hive root or fork source is refused while its Workers or forks exist, so failures are retried
 * once more per pass while a pass still deletes something: a "delete all" then removes Workers
 * before their Queen whatever order they were selected in.
 */
export function deleteArchivedSessions(args: readonly unknown[]) {
  return Effect.gen(function* () {
    yield* requireArgCount(args, 1)
    const sessionIds = yield* decodeArgument(archivedSessionIdsSchema, args[0], 'Archived sessions')
    const repository = yield* SessionRepository
    const states = yield* repository.readArchivedItemStates(
      sessionIds.map((sessionId) => ({ kind: 'session', sessionId }) as const),
    )
    const skipped = sessionIds.filter(
      (sessionId) =>
        !startsFrom(states.get(archivedItemKey({ kind: 'session', sessionId })), false),
    )
    const skippedIds = new Set(skipped)
    let pending = sessionIds.filter((sessionId) => !skippedIds.has(sessionId))
    const deleted: SessionId[] = []
    let failed: { sessionId: SessionId; message: string }[] = []
    while (pending.length > 0) {
      failed = []
      for (const sessionId of pending) {
        const outcome = yield* Effect.either(deleteSession([sessionId]))
        if (Either.isRight(outcome)) deleted.push(sessionId)
        else failed.push({ sessionId, message: formatErrorMessage(outcome.left) })
      }
      if (failed.length === pending.length) break
      pending = failed.map((failure) => failure.sessionId)
    }
    return { deleted, skipped, failed } satisfies ArchivedSessionsDeletionResult
  })
}

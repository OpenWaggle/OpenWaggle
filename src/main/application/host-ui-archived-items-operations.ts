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
  type ArchivedItemChangeTarget,
  type ArchivedItemRef,
  type ArchivedItemsChangeResult,
  type ArchivedSessionsDeletionResult,
  archivedItemKey,
  SESSION_ALREADY_DELETED_MESSAGE,
  SESSION_NOT_ARCHIVED_MESSAGE,
} from '@shared/types/archived-items'
import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import * as Either from 'effect/Either'
import { SessionRepository } from '../ports/session-repository'
import { publishSessionHostEvent } from '../session-host/session-host-events'
import { describeError, errorCauseChain, userFacingErrorDetail } from '../utils/describe-error'
import {
  deleteSessionWithOptions,
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
    const items = uniqueTargets(change.items)
    const repository = yield* SessionRepository
    const states = yield* repository.readArchivedItemStates(items.map((item) => item.ref))
    const changed: ArchivedItemChanged[] = []
    const skipped: ArchivedItemRef[] = []
    const failed: ArchivedItemChangeFailure[] = []
    for (const item of items) {
      const state = states.get(archivedItemKey(item.ref))
      if (!startsFrom(state, change.archived)) {
        skipped.push(item.ref)
        continue
      }
      const outcome = yield* Effect.either(changeArchivedItem(item.ref, change.archived))
      if (Either.isLeft(outcome)) {
        failed.push({ ref: item.ref, message: failureReason(outcome.left) })
        continue
      }
      changed.push({ ref: item.ref, archivedAt: state ?? null })
    }
    if (change.archived) yield* putBackArchiveTimes(items, changed)
    return { changed, skipped, failed } satisfies ArchivedItemsChangeResult
  })
}

/**
 * Undo's archive commands stamp now; put back the Archive time each item had before the restore.
 * The archive commands already announced the items, so announce again for other windows to read
 * the times put back rather than the moment of the Undo.
 */
function putBackArchiveTimes(
  items: readonly ArchivedItemChangeTarget[],
  changed: readonly ArchivedItemChanged[],
) {
  return Effect.gen(function* () {
    const changedKeys = new Set(changed.map((entry) => archivedItemKey(entry.ref)))
    const archiveTimes = items.flatMap((item) =>
      item.archivedAt !== undefined && changedKeys.has(archivedItemKey(item.ref))
        ? [{ ref: item.ref, archivedAt: item.archivedAt }]
        : [],
    )
    if (archiveTimes.length === 0) return
    yield* (yield* SessionRepository).setArchiveTimes(archiveTimes)
    for (const sessionId of new Set(archiveTimes.map((entry) => entry.ref.sessionId))) {
      publishSessionHostEvent({ kind: 'session-list-changed', sessionId, change: 'updated' })
    }
  })
}

/**
 * Every message along an error's cause chain. Store failures arrive wrapped in tagged repository
 * errors whose own message is empty, with the reason on a cause.
 */
function causeMessages(error: unknown) {
  return errorCauseChain(error).flatMap((link) => {
    const message = link instanceof Error ? link.message.trim() : ''
    return message ? [message] : []
  })
}

/** The innermost reason an error gives, safe to show the user. */
function failureReason(error: unknown) {
  const reason = causeMessages(error).at(-1) ?? describeError(error)
  return userFacingErrorDetail(reason)
}

/** The first target for each item: a repeated ref would otherwise be changed twice. */
function uniqueTargets(targets: readonly ArchivedItemChangeTarget[]) {
  const seen = new Set<string>()
  return targets.filter((target) => {
    const key = archivedItemKey(target.ref)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** One attempt per pass: deleted, kept because it left the archive, or failed for another reason. */
function deleteIfStillArchived(sessionId: SessionId) {
  return Effect.either(deleteSessionWithOptions(sessionId, { requireArchived: true })).pipe(
    Effect.map((outcome) => {
      if (Either.isRight(outcome)) return { kind: 'deleted' } as const
      const messages = causeMessages(outcome.left)
      if (messages.some((message) => message.includes(SESSION_NOT_ARCHIVED_MESSAGE))) {
        return { kind: 'kept' } as const
      }
      if (messages.some((message) => message.includes(SESSION_ALREADY_DELETED_MESSAGE))) {
        return { kind: 'missing' } as const
      }
      return { kind: 'failed', message: failureReason(outcome.left) } as const
    }),
  )
}

/**
 * `[sessionIds]`: permanently deletes archived sessions, after the user confirmed. Each delete
 * requires the session to still be archived, checked inside the Host's removal fence, so one
 * restored elsewhere at any point in the batch is kept, never deleted. A session already gone is
 * reported as missing. A Hive root or fork source is refused while its Workers or forks exist, so
 * failures are retried while a pass still deletes something: a "delete all" removes Workers
 * before their Queen whatever order they were selected in.
 */
export function deleteArchivedSessions(args: readonly unknown[]) {
  return Effect.gen(function* () {
    yield* requireArgCount(args, 1)
    const decoded = yield* decodeArgument(archivedSessionIdsSchema, args[0], 'Archived sessions')
    const sessionIds = [...new Set(decoded)]
    const states = yield* (yield* SessionRepository).readArchivedItemStates(
      sessionIds.map((sessionId) => ({ kind: 'session', sessionId }) as const),
    )
    const stateOf = (sessionId: SessionId) =>
      states.get(archivedItemKey({ kind: 'session', sessionId }))
    const missing = sessionIds.filter((sessionId) => stateOf(sessionId) === undefined)
    const skipped = sessionIds.filter((sessionId) => stateOf(sessionId) === null)
    let pending = sessionIds.filter((sessionId) => typeof stateOf(sessionId) === 'number')
    const deleted: SessionId[] = []
    let failed: { sessionId: SessionId; message: string }[] = []
    while (pending.length > 0) {
      failed = []
      for (const sessionId of pending) {
        const outcome = yield* deleteIfStillArchived(sessionId)
        if (outcome.kind === 'deleted') deleted.push(sessionId)
        if (outcome.kind === 'kept') skipped.push(sessionId)
        if (outcome.kind === 'missing') missing.push(sessionId)
        if (outcome.kind === 'failed') failed.push({ sessionId, message: outcome.message })
      }
      if (failed.length === 0 || failed.length === pending.length) break
      pending = failed.map((failure) => failure.sessionId)
    }
    return { deleted, skipped, missing, failed } satisfies ArchivedSessionsDeletionResult
  })
}

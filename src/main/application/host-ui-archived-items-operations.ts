import { type Schema, safeDecodeUnknown } from '@shared/schema'
import {
  archivedItemsChangeSchema,
  archivedItemsQuerySchema,
  archivedItemsRefsQuerySchema,
} from '@shared/schemas/archived-items'
import type {
  ArchivedItemChangeFailure,
  ArchivedItemRef,
  ArchivedItemsChangeResult,
} from '@shared/types/archived-items'
import { formatErrorMessage } from '@shared/utils/node-error'
import * as Effect from 'effect/Effect'
import * as Either from 'effect/Either'
import { SessionRepository } from '../ports/session-repository'
import { mutateLocalUiSession, organizeSession } from './host-ui-session-lifecycle-operations'
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

/**
 * `[{ archived, items }]`: restores (or, for Undo, re-archives) many Archived items in one call.
 * Each item goes through the same Session Host command as restoring it alone, one after another so
 * two branches of one session never race for its tree. One item failing does not stop the rest;
 * the result names what changed and what did not.
 */
export function setArchivedItems(args: readonly unknown[]) {
  return Effect.gen(function* () {
    yield* requireArgCount(args, 1)
    const change = yield* decodeArgument(
      archivedItemsChangeSchema,
      args[0],
      'Archived items change',
    )
    const outcomes = yield* Effect.forEach(change.items, (ref) =>
      Effect.either(changeArchivedItem(ref, change.archived)).pipe(
        Effect.map((outcome) => ({ ref, outcome })),
      ),
    )
    const changed: ArchivedItemRef[] = []
    const failed: ArchivedItemChangeFailure[] = []
    for (const { ref, outcome } of outcomes) {
      if (Either.isRight(outcome)) changed.push(ref)
      else failed.push({ ref, message: formatErrorMessage(outcome.left) })
    }
    return { changed, failed } satisfies ArchivedItemsChangeResult
  })
}

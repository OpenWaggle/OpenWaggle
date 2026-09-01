import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { SessionRepository } from '../ports/session-repository'
import { invalid, requireArgCount, validateSessionId } from './host-ui-session-operation-validation'

const MAX_LIMIT = 500
const MAX_CURSOR_LENGTH = 4096
const MAX_IDS = 100
const TWO_ARGUMENTS = 2
const THREE_ARGUMENTS = 3

function validateLimit(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_LIMIT
    ? Effect.succeed(value)
    : invalid('Session page limit must be an integer from 1 to 500.')
}

function validateCursor(value: unknown) {
  if (value === undefined) return Effect.succeed(undefined)
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_CURSOR_LENGTH
    ? Effect.succeed(value)
    : invalid('Session catalog cursor is invalid.')
}

export function listSessionsByIds(args: readonly unknown[]) {
  return Effect.gen(function* () {
    yield* requireArgCount(args, 1)
    if (!Array.isArray(args[0]) || args[0].length > MAX_IDS) {
      return yield* invalid('Session ID list must contain at most 100 entries.')
    }
    const ids = yield* Effect.forEach(args[0], validateSessionId)
    const repository = yield* SessionRepository
    if (!repository.listByIds) return yield* invalid('Session hydration is unavailable.')
    return [...(yield* repository.listByIds(ids))]
  })
}

export function listSessionCatalogPage(args: readonly unknown[]) {
  return Effect.gen(function* () {
    if (args.length < TWO_ARGUMENTS || args.length > THREE_ARGUMENTS) {
      return yield* invalid('Expected 2 or 3 arguments.')
    }
    if (typeof args[0] !== 'boolean') return yield* invalid('Archived filter must be a boolean.')
    const limit = yield* validateLimit(args[1])
    const cursor = yield* validateCursor(args[TWO_ARGUMENTS])
    const repository = yield* SessionRepository
    if (!repository.listCatalogPage) return yield* invalid('Session pagination is unavailable.')
    return yield* repository.listCatalogPage(args[0], limit, cursor)
  })
}

export function listHiveSessionCatalogPage(args: readonly unknown[]) {
  return Effect.gen(function* () {
    if (args.length < TWO_ARGUMENTS || args.length > THREE_ARGUMENTS) {
      return yield* invalid('Expected 2 or 3 arguments.')
    }
    const sessionId: SessionId = yield* validateSessionId(args[0])
    const limit = yield* validateLimit(args[1])
    const cursor = yield* validateCursor(args[TWO_ARGUMENTS])
    const repository = yield* SessionRepository
    if (!repository.listHiveCatalogPage) return yield* invalid('Hive pagination is unavailable.')
    return yield* repository.listHiveCatalogPage(sessionId, limit, cursor)
  })
}

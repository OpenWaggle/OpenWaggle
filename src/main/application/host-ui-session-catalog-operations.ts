import type { SessionId } from '@shared/types/brand'
import type {
  HiveSessionCatalogPage,
  SessionCatalogPage,
  SessionSummary,
} from '@shared/types/session'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import { FollowUpEditHoldRepository } from '../ports/follow-up-edit-hold-repository'
import { SessionRepository } from '../ports/session-repository'
import { SettingsService } from '../services/settings-service'
import { listPendingAgentLoopInteractions } from './agent-loop-interaction-broker'
import { invalid, requireArgCount, validateSessionId } from './host-ui-session-operation-validation'

const MAX_LIMIT = 500
const MAX_CURSOR_LENGTH = 4096
const MAX_PROJECT_SEARCH_LENGTH = 256
const MAX_IDS = 100
const TWO_ARGUMENTS = 2
const THREE_ARGUMENTS = 3

const NO_HELD_SESSIONS: ReadonlyMap<string, number> = new Map()

/**
 * Sessions whose queue waits on the user's Follow-up edit. Optional: a runtime without Session
 * Control persistence has no holds, and a failed read must not hide the catalog.
 */
const followUpEditHeldSessions = Effect.serviceOption(FollowUpEditHoldRepository).pipe(
  Effect.flatMap((holds) =>
    Option.isSome(holds)
      ? holds.value.heldSessions().pipe(Effect.orElseSucceed(() => NO_HELD_SESSIONS))
      : Effect.succeed(NO_HELD_SESSIONS),
  ),
)

function attachPendingInteractions(
  sessions: readonly SessionSummary[],
  heldAtBySessionId: ReadonlyMap<string, number> = NO_HELD_SESSIONS,
) {
  const pendingAtBySessionId = new Map<string, number>()
  for (const interaction of listPendingAgentLoopInteractions()) {
    const sessionId = String(interaction.sessionId)
    const current = pendingAtBySessionId.get(sessionId)
    if (current === undefined || interaction.createdAt < current) {
      pendingAtBySessionId.set(sessionId, interaction.createdAt)
    }
  }
  const pendingInteractionSnapshotAt = Date.now()
  return sessions.map((session) => {
    const pendingInteractionAt = pendingAtBySessionId.get(String(session.id))
    const followUpEditHeldAt = heldAtBySessionId.get(String(session.id))
    return {
      ...session,
      pendingInteractionSnapshotAt,
      ...(pendingInteractionAt === undefined ? {} : { pendingInteractionAt }),
      ...(followUpEditHeldAt === undefined ? {} : { followUpEditHeldAt }),
    }
  })
}

function attachCatalogPendingInteractions(
  page: SessionCatalogPage,
  heldAtBySessionId: ReadonlyMap<string, number>,
): SessionCatalogPage {
  return { ...page, sessions: attachPendingInteractions(page.sessions, heldAtBySessionId) }
}

function attachHivePendingInteractions(
  page: HiveSessionCatalogPage,
  heldAtBySessionId: ReadonlyMap<string, number>,
): HiveSessionCatalogPage {
  return {
    ...page,
    context: attachPendingInteractions(page.context, heldAtBySessionId),
    workers: attachPendingInteractions(page.workers, heldAtBySessionId),
  }
}

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
    const sessions = yield* repository.listByIds(ids)
    return attachPendingInteractions(sessions, yield* followUpEditHeldSessions)
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
    const page = yield* repository.listCatalogPage(args[0], limit, cursor)
    return attachCatalogPendingInteractions(page, yield* followUpEditHeldSessions)
  })
}

export function listSessionProjectPage(args: readonly unknown[]) {
  return Effect.gen(function* () {
    if (args.length < 1 || args.length > THREE_ARGUMENTS) {
      return yield* invalid('Expected 1 to 3 arguments.')
    }
    const limit = yield* validateLimit(args[0])
    const cursor = yield* validateCursor(args[1])
    const rawSearch = args[TWO_ARGUMENTS]
    if (
      rawSearch !== undefined &&
      (typeof rawSearch !== 'string' || rawSearch.length > MAX_PROJECT_SEARCH_LENGTH)
    ) {
      return yield* invalid('Project search must be at most 256 characters.')
    }
    const repository = yield* SessionRepository
    const search = rawSearch?.trim()
    const displayNames = (yield* (yield* SettingsService).get()).projectDisplayNames
    const normalizedSearch = search?.normalize('NFC').toLowerCase()
    const matchingDisplayNamePaths = normalizedSearch
      ? Object.entries(displayNames)
          .filter(([, label]) => label.normalize('NFC').toLowerCase().includes(normalizedSearch))
          .map(([path]) => path)
      : []
    return yield* repository.listProjectPage(limit, cursor, search, matchingDisplayNamePaths)
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
    const page = yield* repository.listHiveCatalogPage(sessionId, limit, cursor)
    return attachHivePendingInteractions(page, yield* followUpEditHeldSessions)
  })
}

export function listArchivedSessionBranchCatalogPage(args: readonly unknown[]) {
  return Effect.gen(function* () {
    if (args.length < 1 || args.length > TWO_ARGUMENTS) {
      return yield* invalid('Expected 1 or 2 arguments.')
    }
    const limit = yield* validateLimit(args[0])
    const cursor = yield* validateCursor(args[1])
    const repository = yield* SessionRepository
    return yield* repository.listArchivedBranchCatalogPage(limit, cursor)
  })
}

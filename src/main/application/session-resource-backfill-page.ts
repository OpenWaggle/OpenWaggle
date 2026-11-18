import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { SessionRepository, type SessionRepositoryShape } from '../ports/session-repository'
import {
  SessionResourceRepository,
  type SessionResourceRepositoryShape,
} from '../ports/session-resource-repository'
import { captureProjectedSessionResources } from './session-resource-backfill'

export const SESSION_RESOURCE_BACKFILL_PAGE_SIZE = 64
const SESSION_RESOURCE_RECHECK_NODE_LIMIT = 64

function recheckCompletedManagedResources(
  sessionId: SessionId,
  repository: SessionResourceRepositoryShape,
  sessions: SessionRepositoryShape,
) {
  return Effect.gen(function* () {
    const nodeIds = new Set(
      yield* repository.listManagedNodeIds(sessionId, SESSION_RESOURCE_RECHECK_NODE_LIMIT),
    )
    if (nodeIds.size === 0) return
    const nodes = yield* sessions.getResourceProjectionNodes(sessionId, [...nodeIds])
    if (nodes.length === 0) return
    yield* captureProjectedSessionResources({ sessionId, nodes }).pipe(
      Effect.catchAll(() => Effect.void),
    )
  })
}

export function advanceSessionResourceBackfillPage(sessionId: SessionId) {
  return Effect.gen(function* () {
    const repository = yield* SessionResourceRepository
    const sessions = yield* SessionRepository
    const cursor = yield* repository.getBackfillCursor(sessionId)
    const page = yield* sessions.listResourceProjectionPage(
      sessionId,
      cursor,
      SESSION_RESOURCE_BACKFILL_PAGE_SIZE,
    )
    if (page.throughCreatedOrder === null) {
      yield* recheckCompletedManagedResources(sessionId, repository, sessions)
      return { backfillComplete: true, progressed: false }
    }
    let backfillComplete = false
    let progressed = false
    const result = yield* captureProjectedSessionResources({
      sessionId,
      nodes: page.nodes,
    }).pipe(Effect.option)
    if (result._tag === 'Some') {
      progressed = result.value.progressed
      if (result.value.fullyProjected) {
        yield* repository.advanceBackfillCursor(sessionId, page.throughCreatedOrder)
        backfillComplete = !page.hasMore
        progressed = true
      }
    }
    return { backfillComplete, progressed }
  })
}

import type * as SqlClient from '@effect/sql/SqlClient'
import { hiveNextActor } from '@shared/domain/hive-next-actor'
import type { HiveNextActor, HivePendingRequest } from '@shared/types/hive-next-actor'
import type { DelegationState } from '@shared/types/session-collaboration'
import type { SessionQueryOutcome } from '@shared/types/session-query'
import type { SessionQueryResponse } from '@shared/types/session-query-response'
import * as Effect from 'effect/Effect'
import {
  type HiveStoredNextActorFacts,
  loadHiveNextActorFacts,
} from './sqlite-hive-next-actor-facts'

/** Parked requests by Session, which only the Host process knows (they are not stored). */
export type HivePendingRequests = ReadonlyMap<string, HivePendingRequest>

/** The Workers an outcome describes, so their facts load in one query. */
function workerSessionIds(outcome: SessionQueryOutcome): readonly string[] {
  if ('error' in outcome) return []
  if ((outcome.operation === 'list' || outcome.operation === 'search') && 'sessions' in outcome) {
    return outcome.sessions.flatMap((session) =>
      session.delegationState === undefined ? [] : [session.sessionId],
    )
  }
  if (outcome.operation === 'read' && 'session' in outcome) return [outcome.session.sessionId]
  if (outcome.operation === 'delegations-list' && 'delegations' in outcome) {
    return outcome.delegations.map((delegation) => delegation.workerSessionId)
  }
  if (outcome.operation === 'delegations-read' && 'delegation' in outcome) {
    return [outcome.delegation.workerSessionId]
  }
  return []
}

/**
 * Adds `nextActor` to every Session summary and Delegation an outcome carries with a Delegation
 * state (ADR 0059), from the same rule the Hive panel uses. The stored facts come from the
 * Delegation; a summary from retired task-runner lineage has none, so only its state counts.
 */
export function withHiveNextActor(
  sql: SqlClient.SqlClient,
  response: SessionQueryResponse,
  pendingRequests: HivePendingRequests,
) {
  const ids = workerSessionIds(response.outcome)
  if (ids.length === 0) return Effect.succeed(response)
  return loadHiveNextActorFacts(sql, [...new Set(ids)]).pipe(
    Effect.map((facts) => {
      const nextActorOf = (sessionId: string, state: DelegationState) =>
        nextActorFor(facts.get(sessionId), state, pendingRequests.get(sessionId))
      return { ...response, outcome: decorate(response.outcome, nextActorOf) }
    }),
  )
}

function nextActorFor(
  stored: HiveStoredNextActorFacts | undefined,
  state: DelegationState,
  pendingRequest: HivePendingRequest | undefined,
): HiveNextActor {
  const next = hiveNextActor({
    delegationState: state,
    attentionCause: stored?.attentionCause ?? null,
    parentWillAct: stored?.parentWillAct ?? false,
    pendingRequest: pendingRequest ?? null,
  })
  // A Delegation state always has a next actor; null only describes a Session without one.
  return next?.nextActor ?? 'worker'
}

function decorate(
  outcome: SessionQueryOutcome,
  nextActorOf: (sessionId: string, state: DelegationState) => HiveNextActor,
): SessionQueryOutcome {
  if ('error' in outcome) return outcome
  if ((outcome.operation === 'list' || outcome.operation === 'search') && 'sessions' in outcome) {
    return {
      ...outcome,
      sessions: outcome.sessions.map((session) =>
        session.delegationState === undefined
          ? session
          : { ...session, nextActor: nextActorOf(session.sessionId, session.delegationState) },
      ),
    }
  }
  if (outcome.operation === 'read' && 'session' in outcome) {
    const { session, delegation } = outcome
    return {
      ...outcome,
      session:
        session.delegationState === undefined
          ? session
          : { ...session, nextActor: nextActorOf(session.sessionId, session.delegationState) },
      ...(delegation
        ? {
            delegation: {
              ...delegation,
              nextActor: nextActorOf(session.sessionId, delegation.state),
            },
          }
        : {}),
    }
  }
  if (outcome.operation === 'delegations-list' && 'delegations' in outcome) {
    return {
      ...outcome,
      delegations: outcome.delegations.map((delegation) => ({
        ...delegation,
        nextActor: nextActorOf(delegation.workerSessionId, delegation.state),
      })),
    }
  }
  if (outcome.operation === 'delegations-read' && 'delegation' in outcome) {
    return {
      ...outcome,
      delegation: {
        ...outcome.delegation,
        nextActor: nextActorOf(outcome.delegation.workerSessionId, outcome.delegation.state),
      },
    }
  }
  return outcome
}

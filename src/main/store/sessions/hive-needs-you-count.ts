import type * as SqlClient from '@effect/sql/SqlClient'
import { hiveNextActor } from '@shared/domain/hive-next-actor'
import type { HivePendingRequest } from '@shared/types/hive-next-actor'
import * as Effect from 'effect/Effect'
import { loadHiveNextActorFacts } from '../../adapters/sqlite-hive-next-actor-facts'

/**
 * How many live members, and the Queen, need the person (ADR 0059), across the whole Hive. The
 * stored facts load in one query; parked requests come from the Host. One rule decides it, the
 * one the panel's Needs you group uses.
 */
export function countHiveNeedsYou(
  sql: SqlClient.SqlClient,
  rootId: string,
  pendingRequests: ReadonlyMap<string, HivePendingRequest>,
) {
  return Effect.gen(function* () {
    const members = yield* sql<{ readonly session_id: string }>`
      SELECT sessions.id AS session_id FROM sessions
      JOIN session_spawn_lineage AS live ON live.child_session_id = sessions.id
      WHERE live.hive_root_session_id = ${rootId}
        AND sessions.id != ${rootId}
        AND sessions.archived = 0
    `
    const memberIds = members.map((member) => member.session_id)
    const facts = yield* loadHiveNextActorFacts(sql, memberIds)
    const needsYou = [rootId, ...memberIds].filter(
      (id) =>
        hiveNextActor({ ...facts.get(id), pendingRequest: pendingRequests.get(id) ?? null })
          ?.nextActor === 'user',
    )
    return needsYou.length
  })
}

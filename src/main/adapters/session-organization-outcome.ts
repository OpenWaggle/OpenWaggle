import type { SessionControlMutationOutcome } from '@shared/types/session-control'
import type { SessionOrganizationCommand } from '@shared/types/session-organization'
import * as Effect from 'effect/Effect'
import { persistSessionReportTitleReference } from './sqlite-session-report-reference-catalog'

export function organizationOutcome(
  command: Exclude<SessionOrganizationCommand, { operation: 'handoff' }>,
) {
  if (command.operation === 'rename') {
    return {
      operation: command.operation,
      effect: 'session-renamed',
      sessionId: command.sessionId,
      title: command.title.trim(),
    } satisfies SessionControlMutationOutcome
  }
  if (command.operation === 'archive') {
    return {
      operation: command.operation,
      effect: 'session-archived',
      sessionId: command.sessionId,
    } satisfies SessionControlMutationOutcome
  }
  return {
    operation: command.operation,
    effect: 'session-unarchived',
    sessionId: command.sessionId,
  } satisfies SessionControlMutationOutcome
}

export function persistOrganizationMutation(
  sql: SqlClient.SqlClient,
  command: Exclude<SessionOrganizationCommand, { operation: 'handoff' }>,
  now: number,
) {
  if (command.operation === 'rename') {
    const title = command.title.trim()
    return Effect.gen(function* () {
      yield* sql`UPDATE sessions SET title = ${title}, updated_at = ${now}
        WHERE id = ${command.sessionId}`
      yield* persistSessionReportTitleReference(sql, command.sessionId, title)
    })
  }
  return sql`UPDATE sessions SET archived = ${command.operation === 'archive' ? 1 : 0},
    updated_at = ${now} WHERE id = ${command.sessionId}`
}

import type * as SqlClient from '@effect/sql/SqlClient'

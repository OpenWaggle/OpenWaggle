import type * as SqlClient from '@effect/sql/SqlClient'
import { parseJsonUnknown, Schema, safeDecodeUnknown } from '@shared/schema'
import type { SessionFollowUpSource } from '@shared/types/session-control-queue'
import * as Effect from 'effect/Effect'
import { profileId, sourceSessionId } from './session-follow-up-authority-support'

/** The Message provenance fields that name who queued a Follow-up. */
const intentSourceSchema = Schema.Struct({
  callerId: Schema.String,
  authorCallerId: Schema.optional(Schema.String),
})

/**
 * Who queued an intent: its author. Sending a Follow-up as the desktop user (`queue-adopt`) makes
 * that user its `callerId` and keeps whoever queued it as `authorCallerId`. The source is
 * display-only, like `returnedSteer`, so an intent without one lists without a source instead of
 * failing the whole queue read.
 */
function intentAuthorCallerId(intentJson: string) {
  const decoded = safeDecodeUnknown(intentSourceSchema, parseJsonUnknown(intentJson))
  return decoded.success ? (decoded.data.authorCallerId ?? decoded.data.callerId) : undefined
}

function profileNames(sql: SqlClient.SqlClient, ids: readonly string[]) {
  if (ids.length === 0) return Effect.succeed(new Map<string, string>())
  return sql<{ readonly id: string; readonly name: string }>`
    SELECT id, name FROM session_client_profiles WHERE id IN ${sql.in([...new Set(ids)])}
  `.pipe(Effect.map((rows) => new Map(rows.map((row) => [row.id, row.name]))))
}

/**
 * The per-item source of a queue-list: who queued each Follow-up, with the agent Session it came
 * from and, for the desktop user only, the name of the CLI profile that queued it.
 */
export function queueListSources(
  sql: SqlClient.SqlClient,
  input: {
    readonly rows: readonly { readonly id: string; readonly intent_json: string }[]
    readonly desktopUser: boolean
  },
) {
  return Effect.gen(function* () {
    const callers = input.rows.flatMap((row) => {
      const callerId = intentAuthorCallerId(row.intent_json)
      return callerId ? [[row.id, callerId] as const] : []
    })
    const names = input.desktopUser
      ? yield* profileNames(
          sql,
          callers.flatMap(([, callerId]) => {
            const id = profileId(callerId)
            return id ? [id] : []
          }),
        )
      : new Map<string, string>()
    return new Map(
      callers.map(([followUpId, callerId]) => {
        const sessionId = sourceSessionId(callerId)
        const profile = profileId(callerId)
        const profileName = profile ? names.get(profile) : undefined
        const source: SessionFollowUpSource = {
          callerId,
          ...(sessionId ? { sessionId } : {}),
          ...(profileName ? { profileName } : {}),
        }
        return [followUpId, { source }] as const
      }),
    )
  })
}

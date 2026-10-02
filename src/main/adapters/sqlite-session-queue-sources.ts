import type * as SqlClient from '@effect/sql/SqlClient'
import { parseJsonUnknown, Schema, safeDecodeUnknown } from '@shared/schema'
import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import type { SessionFollowUpSource } from '@shared/types/session-control-queue'
import * as Effect from 'effect/Effect'
import { profileId, sourceSessionId } from './session-follow-up-authority-support'
import { authorizedSessionScope } from './sqlite-session-query-support'

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
 * The titles of the source Sessions this caller may see, archived or not and in any project: all of
 * them for the desktop user, and for a profile or Session agent those its scope reaches, by the
 * same rule as Session discovery. A caller with neither sees none.
 */
function visibleSessionTitles(
  sql: SqlClient.SqlClient,
  ids: readonly string[],
  caller: { readonly desktopUser: boolean; readonly authority?: LocalSessionProfileAuthority },
) {
  if (ids.length === 0 || (!caller.desktopUser && !caller.authority)) {
    return Effect.succeed(new Map<string, string>())
  }
  const allowed = authorizedSessionScope(caller.desktopUser ? undefined : caller.authority)
  return sql<{ readonly id: string; readonly title: string }>`
    SELECT sessions.id, sessions.title
    FROM sessions
    LEFT JOIN session_spawn_lineage ON session_spawn_lineage.child_session_id = sessions.id
    WHERE sessions.id IN ${sql.in([...new Set(ids)])}
      AND (
        ${allowed.all} = 1
        OR sessions.project_path IN ${sql.in(allowed.projectPaths)}
        OR sessions.id IN ${sql.in(allowed.sessionIds)}
        OR COALESCE(session_spawn_lineage.hive_root_session_id, sessions.id)
          IN ${sql.in(allowed.hiveRootSessionIds)}
      )
  `.pipe(Effect.map((rows) => new Map(rows.map((row) => [row.id, row.title]))))
}

/**
 * The per-item source of a queue-list: who queued each Follow-up, with the agent Session it came
 * from and that Session's title when the caller may see it, and, for the desktop user only, the
 * name of the CLI profile that queued it.
 */
export function queueListSources(
  sql: SqlClient.SqlClient,
  input: {
    readonly rows: readonly { readonly id: string; readonly intent_json: string }[]
    readonly desktopUser: boolean
    /** The querying profile or Session agent's authority; absent for the desktop user. */
    readonly authority?: LocalSessionProfileAuthority
  },
) {
  return Effect.gen(function* () {
    const callers = input.rows.flatMap((row) => {
      const callerId = intentAuthorCallerId(row.intent_json)
      return callerId ? [[row.id, callerId] as const] : []
    })
    const titles = yield* visibleSessionTitles(
      sql,
      callers.flatMap(([, callerId]) => {
        const id = sourceSessionId(callerId)
        return id ? [id] : []
      }),
      input,
    )
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
        const sessionTitle = sessionId ? titles.get(sessionId) : undefined
        const source: SessionFollowUpSource = {
          callerId,
          ...(sessionId ? { sessionId } : {}),
          ...(sessionTitle !== undefined ? { sessionTitle } : {}),
          ...(profileName ? { profileName } : {}),
        }
        return [followUpId, { source }] as const
      }),
    )
  })
}

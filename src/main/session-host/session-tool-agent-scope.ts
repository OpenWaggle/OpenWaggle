import type * as SqlClient from '@effect/sql/SqlClient'
import type { LocalSessionProfileScope } from '@shared/types/local-session-profile'

interface ScopedOrigin {
  readonly scope: LocalSessionProfileScope
}

function scopeSqlValues(origin: ScopedOrigin | undefined) {
  const scope = origin?.scope
  return {
    all: !scope || scope.all === true ? 1 : 0,
    projectPaths: scope?.projectPaths ?? [],
    sessionIds: scope?.sessionIds ?? [],
    hiveRootSessionIds: scope?.hiveRootSessionIds ?? [],
  }
}

export function loadScopedSessionAgentTargets(
  sql: SqlClient.SqlClient,
  input: {
    readonly sessionId: string
    readonly projectPath: string | null
    readonly isWorker: boolean
    readonly origin: ScopedOrigin | undefined
    readonly snapshotOrigin: ScopedOrigin | undefined
  },
) {
  const live = scopeSqlValues(input.origin)
  const snapshot = scopeSqlValues(input.snapshotOrigin)
  const worker = input.isWorker ? 1 : 0
  return sql<{ readonly session_id: string }>`
    SELECT sessions.id AS session_id
    FROM sessions
    LEFT JOIN session_spawn_lineage AS lineage ON lineage.child_session_id = sessions.id
    LEFT JOIN sessions AS parent ON parent.id = lineage.parent_session_id
    LEFT JOIN session_spawn_lineage AS parent_lineage
      ON parent_lineage.child_session_id = parent.id
    WHERE (
      (${worker} = 1 AND sessions.id = ${input.sessionId})
      OR (${worker} = 0 AND sessions.project_path IS ${input.projectPath})
    )
      AND (
        ${live.all} = 1
        OR sessions.project_path IN ${sql.in(live.projectPaths)}
        OR sessions.id IN ${sql.in(live.sessionIds)}
        OR COALESCE(lineage.hive_root_session_id, sessions.id)
          IN ${sql.in(live.hiveRootSessionIds)}
        OR (${worker} = 1 AND (
          parent.project_path IN ${sql.in(live.projectPaths)}
          OR parent.id IN ${sql.in(live.sessionIds)}
          OR COALESCE(parent_lineage.hive_root_session_id, parent.id)
            IN ${sql.in(live.hiveRootSessionIds)}
        ))
      )
      AND (
        ${snapshot.all} = 1
        OR sessions.project_path IN ${sql.in(snapshot.projectPaths)}
        OR sessions.id IN ${sql.in(snapshot.sessionIds)}
        OR COALESCE(lineage.hive_root_session_id, sessions.id)
          IN ${sql.in(snapshot.hiveRootSessionIds)}
        OR (${worker} = 1 AND (
          parent.project_path IN ${sql.in(snapshot.projectPaths)}
          OR parent.id IN ${sql.in(snapshot.sessionIds)}
          OR COALESCE(parent_lineage.hive_root_session_id, parent.id)
            IN ${sql.in(snapshot.hiveRootSessionIds)}
        ))
      )
    ORDER BY sessions.id
  `
}

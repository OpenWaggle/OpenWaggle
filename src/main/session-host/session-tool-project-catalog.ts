import type * as SqlClient from '@effect/sql/SqlClient'
import type { LocalSessionProfileScope } from '@shared/types/local-session-profile'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import * as Effect from 'effect/Effect'

function lifecycleTargetProjectPath(payload: LocalSessionCommandPayload) {
  if (payload.contract !== 'session-lifecycle-v2') return undefined
  const command = payload.request.command
  return command.operation === 'launch' || command.operation === 'create'
    ? command.projectPath
    : undefined
}

/**
 * A Session agent may launch or create Sessions only in a project OpenWaggle already knows: one
 * with a Session or a Workspace in the catalog. Reaching every project (ADR 0040) means every
 * project in the catalog, not every directory on disk; otherwise a prompt-injected agent could
 * start a Session in `~/Downloads/untrusted-repo` and load its instructions and skills.
 */
export function assertSessionAgentLifecycleProjectKnown(
  sql: SqlClient.SqlClient,
  callerScope: LocalSessionProfileScope,
  payload: LocalSessionCommandPayload,
) {
  // Only a catalog-wide caller can name a project outside its own; a narrower caller is refused by
  // its scope, and checking for it here would tell it which paths are projects.
  if (callerScope.all !== true) return Effect.void
  const projectPath = lifecycleTargetProjectPath(payload)
  if (projectPath === undefined) return Effect.void
  return Effect.gen(function* () {
    const rows = yield* sql<{ readonly known: number }>`
      SELECT EXISTS (SELECT 1 FROM sessions WHERE project_path = ${projectPath})
        OR EXISTS (SELECT 1 FROM workspace_resources WHERE project_path = ${projectPath})
        AS known
    `
    if (rows[0]?.known === 1) return
    return yield* Effect.fail(
      new Error(
        `Session command refused: ${projectPath} is not a project in OpenWaggle. A Session agent can only launch or create Sessions in a project that already has a Session or Workspace in OpenWaggle. Pass its absolute path exactly as list with catalogScope all shows it, or open the project in OpenWaggle first.`,
      ),
    )
  })
}

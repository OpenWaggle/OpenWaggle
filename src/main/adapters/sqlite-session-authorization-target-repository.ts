import fs from 'node:fs/promises'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import type { LocalSessionProfileScope } from '@shared/types/local-session-profile'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SessionAuthorizationTargetRepositoryError } from '../errors'
import { SessionAuthorizationTargetRepository } from '../ports/session-authorization-target-repository'
import { isPathInsideDirectory } from '../utils/project-path-validation'
import { listLiveScopedDerivedAuthorities } from './sqlite-session-derived-authority'
import { authorizedSessionScope } from './sqlite-session-query-support'

interface TargetRow {
  readonly session_id: string
  readonly project_path: string | null
  readonly working_path: string | null
  readonly hive_root_session_id: string | null
  readonly authorization_ceiling: 'yolo' | 'ask-for-approval'
}

function workspaceDescendantPrefix(root: string) {
  return root.endsWith(path.sep) ? root : `${root}${path.sep}`
}

function resolveSessionTarget(sql: SqlClient.SqlClient, sessionId: string) {
  return Effect.gen(function* () {
    const rows = yield* sql<TargetRow>`
      SELECT sessions.id AS session_id, sessions.project_path, workspace.working_path,
        session_spawn_lineage.hive_root_session_id,
        session_execution_profiles.authorization_ceiling
      FROM sessions
      LEFT JOIN session_spawn_lineage ON session_spawn_lineage.child_session_id = sessions.id
      LEFT JOIN session_workspace_bindings AS binding ON binding.session_id = sessions.id
      LEFT JOIN workspace_resources AS workspace ON workspace.id = binding.workspace_id
      JOIN session_execution_profiles ON session_execution_profiles.session_id = sessions.id
      WHERE sessions.id = ${sessionId}
      LIMIT 1
    `
    const row = rows[0]
    if (!row) {
      return yield* Effect.fail(
        new SessionAuthorizationTargetRepositoryError({
          operation: 'session-not-found',
          cause: { sessionId },
        }),
      )
    }
    if (!row.project_path) {
      return yield* Effect.fail(
        new SessionAuthorizationTargetRepositoryError({
          operation: 'session-project-missing',
          cause: { sessionId },
        }),
      )
    }
    return {
      sessionId: row.session_id,
      projectPath: row.project_path,
      ...(row.working_path ? { workingPath: row.working_path } : {}),
      hiveRootSessionId: row.hive_root_session_id ?? row.session_id,
      authorizationCeiling: row.authorization_ceiling,
    }
  })
}

function mapTargetError(effect: ReturnType<typeof resolveSessionTarget>) {
  return effect.pipe(
    Effect.mapError((cause) =>
      cause instanceof SessionAuthorizationTargetRepositoryError
        ? cause
        : new SessionAuthorizationTargetRepositoryError({
            operation: 'resolve-target',
            cause,
          }),
    ),
  )
}

async function canonicalWorkspaceProjects(
  canonicalRoots: readonly string[],
  projectPaths: readonly string[],
) {
  const allowed: string[] = []
  for (const projectPath of projectPaths) {
    try {
      const candidate = await fs.realpath(projectPath)
      if (canonicalRoots.some((root) => isPathInsideDirectory(root, candidate))) {
        allowed.push(candidate)
      }
    } catch {
      // Missing or inaccessible projects are outside the live workspace grant.
    }
  }
  return [...new Set(allowed)]
}

function listAuthorizedSessionIds(sql: SqlClient.SqlClient, scope: LocalSessionProfileScope) {
  const allowed = authorizedSessionScope({
    profileId: 'event-admission',
    profileName: 'event-admission',
    capabilities: [],
    scope,
    authorizationCeiling: 'ask-for-approval',
  })
  return sql<{ readonly session_id: string }>`
    SELECT sessions.id AS session_id FROM sessions
    LEFT JOIN session_spawn_lineage
      ON session_spawn_lineage.child_session_id = sessions.id
    WHERE ${allowed.all} = 1
      OR sessions.project_path IN ${sql.in(allowed.projectPaths)}
      OR sessions.id IN ${sql.in(allowed.sessionIds)}
      OR COALESCE(session_spawn_lineage.hive_root_session_id, sessions.id)
        IN ${sql.in(allowed.hiveRootSessionIds)}
    ORDER BY sessions.id
  `.pipe(
    Effect.map((rows) => rows.map((row) => row.session_id)),
    Effect.mapError(
      (cause) =>
        new SessionAuthorizationTargetRepositoryError({
          operation: 'list-authorized-session-ids',
          cause,
        }),
    ),
  )
}

function listActiveDescendantTargets(sql: SqlClient.SqlClient, ancestorSessionId: string) {
  return sql<TargetRow>`
    WITH RECURSIVE descendants(session_id, depth) AS (
      SELECT child_session_id, 1
      FROM session_spawn_lineage
      WHERE parent_session_id = ${ancestorSessionId}
      UNION ALL
      SELECT lineage.child_session_id, descendants.depth + 1
      FROM session_spawn_lineage AS lineage
      JOIN descendants ON lineage.parent_session_id = descendants.session_id
    )
    SELECT sessions.id AS session_id, sessions.project_path, workspace.working_path,
      lineage.hive_root_session_id, session_execution_profiles.authorization_ceiling
    FROM descendants
    JOIN sessions ON sessions.id = descendants.session_id
    JOIN session_control_states AS states ON states.session_id = descendants.session_id
    JOIN session_runs AS runs
      ON runs.id = states.active_run_id AND runs.session_id = descendants.session_id
    LEFT JOIN session_spawn_lineage AS lineage ON lineage.child_session_id = sessions.id
    LEFT JOIN session_workspace_bindings AS binding ON binding.session_id = sessions.id
    LEFT JOIN workspace_resources AS workspace ON workspace.id = binding.workspace_id
    JOIN session_execution_profiles ON session_execution_profiles.session_id = sessions.id
    WHERE runs.status IN ('starting', 'active')
    ORDER BY descendants.depth DESC, descendants.session_id ASC
  `.pipe(
    Effect.flatMap((rows) =>
      Effect.forEach(rows, (row) =>
        row.project_path
          ? Effect.succeed({
              sessionId: row.session_id,
              projectPath: row.project_path,
              ...(row.working_path ? { workingPath: row.working_path } : {}),
              hiveRootSessionId: row.hive_root_session_id ?? row.session_id,
              authorizationCeiling: row.authorization_ceiling,
            })
          : Effect.fail(
              new SessionAuthorizationTargetRepositoryError({
                operation: 'session-project-missing',
                cause: { sessionId: row.session_id },
              }),
            ),
      ),
    ),
    Effect.mapError((cause) =>
      cause instanceof SessionAuthorizationTargetRepositoryError
        ? cause
        : new SessionAuthorizationTargetRepositoryError({
            operation: 'list-active-descendant-targets',
            cause,
          }),
    ),
  )
}

export const SqliteSessionAuthorizationTargetRepositoryLive = Layer.effect(
  SessionAuthorizationTargetRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return SessionAuthorizationTargetRepository.of({
      listActiveDescendantTargets: (ancestorSessionId) =>
        listActiveDescendantTargets(sql, ancestorSessionId),
      listAuthorizedSessionIds: (scope) => listAuthorizedSessionIds(sql, scope),
      resolveWorkspaceProjectPaths: (workspaceRoots) =>
        Effect.gen(function* () {
          const canonicalRoots = yield* Effect.tryPromise({
            try: async () => {
              const roots = await Promise.all(
                workspaceRoots.map(async (root) => ({
                  absolute: path.resolve(root),
                  canonical: await fs.realpath(root),
                })),
              )
              const changed = roots.find((root) => root.absolute !== root.canonical)
              if (changed) {
                throw new Error(`Workspace root changed after it was granted: ${changed.absolute}`)
              }
              return roots.map((root) => root.canonical)
            },
            catch: (cause) =>
              new SessionAuthorizationTargetRepositoryError({
                operation: 'resolve-workspace-roots',
                cause,
              }),
          })
          const queryRoots = canonicalRoots
          const rows = yield* Effect.forEach(queryRoots, (root) => {
            const descendantPrefix = workspaceDescendantPrefix(root)
            return sql<{ readonly project_path: string }>`
              SELECT DISTINCT project_path FROM sessions
              WHERE project_path = ${root}
                OR (project_path >= ${descendantPrefix}
                  AND project_path < ${`${descendantPrefix}\u{10ffff}`})
            `
          }).pipe(Effect.map((groups) => groups.flat()))
          return yield* Effect.tryPromise({
            try: () =>
              canonicalWorkspaceProjects(
                canonicalRoots,
                rows.map((row) => row.project_path),
              ),
            catch: (cause) =>
              new SessionAuthorizationTargetRepositoryError({
                operation: 'resolve-workspace-project-paths',
                cause,
              }),
          })
        }).pipe(
          Effect.mapError((cause) =>
            cause instanceof SessionAuthorizationTargetRepositoryError
              ? cause
              : new SessionAuthorizationTargetRepositoryError({
                  operation: 'resolve-workspace-project-paths',
                  cause,
                }),
          ),
        ),
      resolve: (sessionId) => mapTargetError(resolveSessionTarget(sql, sessionId)),
      resolveDelegation: (delegationId) =>
        Effect.gen(function* () {
          const rows = yield* sql<{ readonly child_session_id: string }>`
            SELECT child_session_id FROM delegation_contracts WHERE id = ${delegationId} LIMIT 1
          `
          const sessionId = rows[0]?.child_session_id
          if (!sessionId) {
            return yield* Effect.fail(
              new SessionAuthorizationTargetRepositoryError({
                operation: 'delegation-not-found',
                cause: { delegationId },
              }),
            )
          }
          return yield* resolveSessionTarget(sql, sessionId)
        }).pipe(mapTargetError),
      listLiveDerivedAuthorities: (callerId, originScope) =>
        listLiveScopedDerivedAuthorities(sql, callerId, originScope),
    })
  }),
)

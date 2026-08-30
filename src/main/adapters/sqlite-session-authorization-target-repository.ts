import fs from 'node:fs/promises'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SESSION_CAPABILITIES, type SessionCapability } from '@shared/types/session-capability'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SessionAuthorizationTargetRepositoryError } from '../errors'
import { SessionAuthorizationTargetRepository } from '../ports/session-authorization-target-repository'
import { isPathInsideDirectory } from '../utils/project-path-validation'

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

function decodeCapabilities(value: string): readonly SessionCapability[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter(
          (candidate): candidate is SessionCapability =>
            typeof candidate === 'string' &&
            SESSION_CAPABILITIES.some((capability) => capability === candidate),
        )
      : []
  } catch {
    return []
  }
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

export const SqliteSessionAuthorizationTargetRepositoryLive = Layer.effect(
  SessionAuthorizationTargetRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return SessionAuthorizationTargetRepository.of({
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
      listLiveDerivedAuthorities: (callerId) =>
        Effect.gen(function* () {
          const rows = yield* sql<{
            readonly child_session_id: string
            readonly capabilities_json: string
            readonly authorization_ceiling: 'yolo' | 'ask-for-approval'
          }>`
            SELECT child_session_id, capabilities_json, authorization_ceiling
            FROM derived_child_management_grants
            WHERE source_caller_id = ${callerId} AND revoked_at IS NULL
            ORDER BY child_session_id
          `
          return rows.map((row) => ({
            sessionId: row.child_session_id,
            capabilities: decodeCapabilities(row.capabilities_json),
            authorizationCeiling: row.authorization_ceiling,
          }))
        }).pipe(
          Effect.mapError((cause) =>
            cause instanceof SessionAuthorizationTargetRepositoryError
              ? cause
              : new SessionAuthorizationTargetRepositoryError({
                  operation: 'list-derived-authorities',
                  cause,
                }),
          ),
        ),
    })
  }),
)

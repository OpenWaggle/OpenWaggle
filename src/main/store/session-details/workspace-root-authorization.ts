import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { runStoreEffect } from '../store-runtime'

/** Exact indexed roots only. Workspace resources must still belong to a Session. */
export function findSessionWorkspaceRoot(requestedPath: string, canonicalPath: string) {
  const candidates = [...new Set([path.resolve(requestedPath), canonicalPath])]
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const projects = yield* sql<{ readonly root: string }>`
        SELECT project_path AS root FROM sessions
        WHERE project_path IN ${sql.in(candidates)} LIMIT 1
      `
      if (projects[0]) return projects[0].root
      const workspaces = yield* sql<{ readonly root: string }>`
        SELECT working_path AS root FROM workspace_resources
        WHERE working_path IN ${sql.in(candidates)} AND lifecycle_state = ${'ready'}
          AND EXISTS (
            SELECT 1 FROM session_workspace_bindings
            WHERE workspace_id = workspace_resources.id
          )
        LIMIT 1
      `
      return workspaces[0]?.root ?? null
    }),
  )
}

const ROOT_PAGE_SIZE = 64

/** Legacy aliases need a live realpath check; page only distinct, currently owned roots. */
export function listSessionWorkspaceRootPage(afterRoot?: string) {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{ readonly root: string }>`
        SELECT root FROM (
          SELECT root FROM (
            SELECT DISTINCT project_path AS root FROM sessions
            WHERE project_path > ${afterRoot ?? ''}
            ORDER BY project_path LIMIT ${ROOT_PAGE_SIZE}
          )
          UNION
          SELECT root FROM (
            SELECT DISTINCT working_path AS root FROM workspace_resources
            WHERE working_path > ${afterRoot ?? ''} AND lifecycle_state = ${'ready'}
              AND EXISTS (
                SELECT 1 FROM session_workspace_bindings
                WHERE workspace_id = workspace_resources.id
              )
            ORDER BY working_path LIMIT ${ROOT_PAGE_SIZE}
          )
        ) ORDER BY root LIMIT ${ROOT_PAGE_SIZE}
      `
      return rows.map((row) => row.root)
    }),
  )
}

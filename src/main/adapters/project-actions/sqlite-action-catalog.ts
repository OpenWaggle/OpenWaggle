import * as SqlClient from '@effect/sql/SqlClient'
import { decodeUnknownExactOrThrow } from '@shared/schema'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { ActionCatalogService } from '../../ports/action-catalog-service'
import { createActionCatalog } from './action-catalog'
import {
  type ActionStatePersistence,
  decodeLocalActionState,
  localActionStateSchema,
} from './local-action-state'
import { discoverProjectTasks } from './task-discovery'

interface CatalogRow {
  readonly revision: number
  readonly state_json: string
}
const catalogError = (cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause)))

export function createSqliteActionStatePersistence(
  sql: SqlClient.SqlClient,
): ActionStatePersistence {
  return {
    read: (projectPath) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const rows =
            yield* sql<CatalogRow>`SELECT revision, state_json FROM project_action_catalogs WHERE project_path = ${projectPath}`
          const row = rows[0]
          return row
            ? { revision: row.revision, state: decodeLocalActionState(row.state_json) }
            : null
        }),
      ),
    write: (projectPath, expectedRevision, input) =>
      Effect.runPromise(
        sql.withTransaction(
          Effect.gen(function* () {
            const state = decodeUnknownExactOrThrow(localActionStateSchema, input)
            const rows =
              yield* sql<CatalogRow>`SELECT revision, state_json FROM project_action_catalogs WHERE project_path = ${projectPath}`
            if ((rows[0]?.revision ?? 0) !== expectedRevision)
              return yield* Effect.fail(
                new Error('Project Actions changed in local storage. Reload before saving.'),
              )
            const revision = expectedRevision + 1
            yield* sql`INSERT INTO project_action_catalogs (project_path, revision, state_json, updated_at)
        VALUES (${projectPath}, ${revision}, ${JSON.stringify(state)}, ${Date.now()})
        ON CONFLICT(project_path) DO UPDATE SET revision = excluded.revision, state_json = excluded.state_json, updated_at = excluded.updated_at`
            return { revision, state }
          }),
        ),
      ),
  }
}

export const SqliteActionCatalogServiceLive = Layer.effect(
  ActionCatalogService,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const catalog = createActionCatalog(createSqliteActionStatePersistence(sql))
    return {
      read: (scope) => Effect.tryPromise({ try: () => catalog.read(scope), catch: catalogError }),
      edit: (scope, revision, edit) =>
        Effect.tryPromise({ try: () => catalog.edit(scope, revision, edit), catch: catalogError }),
      discover: (workspacePath) =>
        Effect.tryPromise({ try: () => discoverProjectTasks(workspacePath), catch: catalogError }),
    }
  }),
)

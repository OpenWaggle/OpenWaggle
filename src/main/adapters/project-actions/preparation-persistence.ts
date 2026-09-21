import type * as SqlClient from '@effect/sql/SqlClient'
import { decodeUnknownExactOrThrow, parseJsonUnknown } from '@shared/schema'
import { storedWorkspacePreparationSchema } from '@shared/schemas/workspace-preparation'
import type { WorkspacePreparation } from '@shared/types/workspace-preparation'
import * as Effect from 'effect/Effect'
import type { PreparedEnvironment } from '../../domain/prepared-environment'

export interface StoredWorkspacePreparation extends Omit<WorkspacePreparation, 'updateAvailable'> {
  readonly environment: PreparedEnvironment
}
export interface PreparationPersistence {
  readonly read: (workspaceId: string) => Promise<StoredWorkspacePreparation | null>
  readonly write: (state: StoredWorkspacePreparation, expectedRevision: number) => Promise<void>
  readonly list: () => Promise<readonly StoredWorkspacePreparation[]>
}
interface Row {
  readonly state_json: string
}
const decode = (row: Row): StoredWorkspacePreparation =>
  decodeUnknownExactOrThrow(storedWorkspacePreparationSchema, parseJsonUnknown(row.state_json))
export function createPreparationPersistence(sql: SqlClient.SqlClient): PreparationPersistence {
  return {
    read: (workspaceId) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const rows =
            yield* sql<Row>`SELECT state_json FROM workspace_preparation WHERE workspace_id = ${workspaceId}`
          return rows[0] ? decode(rows[0]) : null
        }),
      ),
    list: () =>
      Effect.runPromise(
        sql<Row>`SELECT state_json FROM workspace_preparation`.pipe(
          Effect.map((rows) => rows.map(decode)),
        ),
      ),
    write: (state, expectedRevision) =>
      Effect.runPromise(
        sql.withTransaction(
          Effect.gen(function* () {
            const valid = decodeUnknownExactOrThrow(storedWorkspacePreparationSchema, state)
            const rows = yield* sql<{
              readonly revision: number
            }>`SELECT revision FROM workspace_preparation WHERE workspace_id = ${state.workspaceId}`
            if ((rows[0]?.revision ?? 0) !== expectedRevision)
              return yield* Effect.fail(
                new Error('Workspace preparation changed. Reload before continuing.'),
              )
            yield* sql`INSERT INTO workspace_preparation (workspace_id, revision, state_json) VALUES (${state.workspaceId}, ${state.revision}, ${JSON.stringify(valid)}) ON CONFLICT(workspace_id) DO UPDATE SET revision = excluded.revision, state_json = excluded.state_json`
          }),
        ),
      ),
  }
}

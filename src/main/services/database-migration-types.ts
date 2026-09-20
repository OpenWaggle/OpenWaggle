import type * as SqlClient from '@effect/sql/SqlClient'
import type * as Effect from 'effect/Effect'

export interface AppMigration {
  readonly id: number
  readonly name: string
  readonly statements: readonly string[]
  readonly run?: (sql: SqlClient.SqlClient) => Effect.Effect<void, unknown>
  /** Skip a column migration already applied under an earlier ledger id. */
  readonly skipIfColumn?: { readonly table: string; readonly column: string }
}

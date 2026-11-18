import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'

// These exact unreleased branch entries occupied main's subsequently shipped Setup IDs.
// Keep the allowlist fixed. Future migrations must not become implicit remapping candidates.
const LEGACY_SUMMARY_MIGRATIONS = [
  { id: 26, name: 'session-hive-lineage' },
  { id: 27, name: 'session-resource-catalog' },
  { id: 28, name: 'session-resource-backfill-state' },
  { id: 29, name: 'session-resource-cleanup-queue' },
  { id: 30, name: 'session-output-retry-queue' },
  { id: 31, name: 'session-output-retry-node-provenance' },
  { id: 32, name: 'session-output-retry-branch-provenance' },
  { id: 33, name: 'session-resource-identity-isolation' },
  { id: 34, name: 'session-output-retry-metadata-revision' },
  { id: 35, name: 'session-output-retry-metadata-revision-backfill' },
  { id: 36, name: 'session-resource-occurrence-locator' },
  { id: 37, name: 'session-resource-source-projection' },
  { id: 38, name: 'session-resource-output-projection' },
  { id: 39, name: 'session-resource-role-projection-backfill' },
  { id: 40, name: 'session-resource-bounded-catalog-indexes' },
  { id: 41, name: 'session-resource-active-branch-order-index' },
  { id: 42, name: 'session-resource-catalog-revision' },
  { id: 43, name: 'session-resource-change-request-catalog-index' },
] as const
const SUMMARY_MIGRATION_ID_OFFSET = 2

export function normalizeSessionSummaryMigrationLedger(sql: SqlClient.SqlClient) {
  return sql.withTransaction(
    Effect.gen(function* () {
      const ledger = yield* sql<{
        readonly id: number
        readonly name: string
      }>`SELECT id, name FROM _migrations`
      const rowsById = new Map(ledger.map((row) => [row.id, row]))
      const moves = LEGACY_SUMMARY_MIGRATIONS.filter(
        (legacy) => rowsById.get(legacy.id)?.name === legacy.name,
      )
      const movingIds = new Set<number>(moves.map(({ id }) => id))
      // Validate every destination before moving any row. Unknown ledger entries are never
      // overwritten or interpreted as Summary migrations merely because their ID overlaps.
      for (const move of moves) {
        const destination = move.id + SUMMARY_MIGRATION_ID_OFFSET
        const occupied = rowsById.get(destination)
        if (occupied && !movingIds.has(destination)) {
          return yield* Effect.fail(
            new Error(
              `Cannot migrate Session Summary ledger: migration ${destination} is occupied by ${occupied.name}.`,
            ),
          )
        }
      }
      // Moving highest IDs first frees every overlapping destination. One transaction preserves
      // the complete original ledger if any update fails or the process stops before commit.
      for (const move of [...moves].reverse()) {
        yield* sql`UPDATE _migrations SET id = ${move.id + SUMMARY_MIGRATION_ID_OFFSET}
        WHERE id = ${move.id} AND name = ${move.name}`
      }
    }),
  )
}

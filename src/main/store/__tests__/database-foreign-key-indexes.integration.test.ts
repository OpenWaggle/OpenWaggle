import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runStoreEffect } from '../store-runtime'

const state = vi.hoisted(() => ({ userDataDir: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => state.userDataDir },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}))

interface ForeignKeyColumn {
  readonly child: string
  readonly column: string
  readonly parent: string
  readonly indexed: number
}

/**
 * Every foreign-key child column must lead some index. SQLite checks and cascades a parent's
 * delete by looking up its children, and without an index each lookup scans the whole child
 * table. `session_nodes.parent_id` had none: one node delete scanned every stored transcript
 * (about 170 ms on a 1.2 GB database), so deleting a 770-node Session blocked the Session Host
 * for 160 s and snapshot reconciliation stalled it for seconds during Runs.
 */
async function unindexedForeignKeys() {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return yield* sql<ForeignKeyColumn>`
        WITH foreign_keys AS (
          SELECT tables.name AS child, keys."from" AS column, keys."table" AS parent
          FROM sqlite_master AS tables, pragma_foreign_key_list(tables.name) AS keys
          WHERE tables.type = 'table' AND keys.seq = 0
        ),
        leading_columns AS (
          SELECT tables.name AS child, columns.name AS column
          FROM sqlite_master AS tables,
            pragma_index_list(tables.name) AS indexes,
            pragma_index_info(indexes.name) AS columns
          WHERE tables.type = 'table' AND columns.seqno = 0
        )
        SELECT child, column, parent,
          EXISTS (
            SELECT 1 FROM leading_columns
            WHERE leading_columns.child = foreign_keys.child
              AND leading_columns.column = foreign_keys.column
          ) AS indexed
        FROM foreign_keys
        ORDER BY child, column
      `
    }),
  )
}

beforeEach(async () => {
  state.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-foreign-key-indexes-'))
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
})

afterEach(async () => {
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
  await fs.rm(state.userDataDir, { recursive: true, force: true })
})

describe('Session Host database foreign keys', () => {
  it('indexes every foreign-key child column', async () => {
    const keys = await unindexedForeignKeys()

    expect(keys.length).toBeGreaterThan(0)
    expect(
      keys.filter((key) => key.indexed === 0).map((key) => `${key.child}.${key.column}`),
    ).toEqual([])
  })
})

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyMigrations,
  insertSession,
  withMigrationDatabase,
} from './database-migrations.test-harness'

const AUTHORIZATION_MIGRATION_ID = 25
const WORKTREE_SETUP_MIGRATION_ID = 26
const WORKTREE_SETUP_RECEIPT_MIGRATION_ID = 27
let tmpRoot = ''

describe('Session worktree Setup dispatch migration', () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-setup-migrations-'))
  })

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('adds the pending-dispatch table without scheduling Setup for older sessions', async () => {
    const result = await withMigrationDatabase(tmpRoot, (sql) =>
      Effect.gen(function* () {
        yield* applyMigrations(sql, AUTHORIZATION_MIGRATION_ID)
        yield* insertSession(sql, 'older-session')
        yield* applyMigrations(sql, WORKTREE_SETUP_MIGRATION_ID)

        const tables = yield* sql<{ readonly name: string }>`
          SELECT name FROM sqlite_master WHERE type = 'table'
        `
        const pending = yield* sql<{ readonly session_id: string }>`
          SELECT session_id FROM session_worktree_setup
        `
        return { tables, pending }
      }),
    )

    expect(result.tables.map((table) => table.name)).toContain('session_worktree_setup')
    expect(result.pending).toEqual([])
  })

  it('upgrades a pending dispatch to the crash-safe state model without consuming it', async () => {
    const dispatch = await withMigrationDatabase(tmpRoot, (sql) =>
      Effect.gen(function* () {
        yield* applyMigrations(sql, WORKTREE_SETUP_MIGRATION_ID)
        yield* insertSession(sql, 'session-with-pending-setup')
        yield* sql`
          INSERT INTO session_worktree_setup (
            session_id, worktree_path, generation, created_at, updated_at
          )
          VALUES (
            ${'session-with-pending-setup'}, ${'/worktree'}, ${'generation-1'}, ${1}, ${1}
          )
        `

        yield* applyMigrations(sql, WORKTREE_SETUP_RECEIPT_MIGRATION_ID)

        return yield* sql<{
          readonly dispatch_state: string
          readonly claim_token: string | null
          readonly accepted_at: number | null
        }>`
          SELECT dispatch_state, claim_token, accepted_at
          FROM session_worktree_setup
          WHERE session_id = ${'session-with-pending-setup'}
        `
      }),
    )

    expect(dispatch).toEqual([{ dispatch_state: 'pending', claim_token: null, accepted_at: null }])
  })

  it('deletes a durable Setup dispatch receipt with its Session', async () => {
    const pending = await withMigrationDatabase(tmpRoot, (sql) =>
      Effect.gen(function* () {
        yield* applyMigrations(sql, WORKTREE_SETUP_RECEIPT_MIGRATION_ID)
        yield* sql`PRAGMA foreign_keys = ON`
        yield* insertSession(sql, 'session-with-setup')
        yield* sql`
          INSERT INTO session_worktree_setup (
            session_id, worktree_path, generation, created_at, updated_at
          )
          VALUES (
            ${'session-with-setup'}, ${'/worktree'}, ${'generation-1'}, ${1}, ${1}
          )
        `
        yield* sql`DELETE FROM sessions WHERE id = ${'session-with-setup'}`
        return yield* sql<{ readonly session_id: string }>`
          SELECT session_id FROM session_worktree_setup
        `
      }),
    )

    expect(pending).toEqual([])
  })
})

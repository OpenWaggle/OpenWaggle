import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import * as ManagedRuntime from 'effect/ManagedRuntime'
import { afterEach, describe, expect, it, vi } from 'vitest'

const appState = vi.hoisted(() => ({ userDataRoot: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => appState.userDataRoot },
}))

import { AppDatabase, AppDatabaseLive, configureAppDatabaseAccess } from '../database-service'

let temporaryRoot: string | null = null

afterEach(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true })
  temporaryRoot = null
})

describe('attached GUI database isolation', () => {
  it('uses a private in-memory store without opening or migrating the canonical Host database', async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), 'openwaggle-gui-db-'))
    appState.userDataRoot = temporaryRoot
    const canonicalPath = join(temporaryRoot, 'session-host', 'session-host.sqlite')
    await mkdir(dirname(canonicalPath), { recursive: true })
    const canonical = new DatabaseSync(canonicalPath)
    canonical.exec('CREATE TABLE sentinel (value TEXT NOT NULL)')
    canonical.close()

    configureAppDatabaseAccess('client-isolated')
    const runtime = ManagedRuntime.make(AppDatabaseLive)
    try {
      const result = await runtime.runPromise(
        Effect.gen(function* () {
          const database = yield* AppDatabase
          const sql = yield* SqlClient.SqlClient
          const rows = yield* sql<{ readonly name: string }>`
            SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sentinel'
          `
          return { path: database.path, sentinelCount: rows.length }
        }),
      )

      expect(result).toEqual({ path: ':memory:', sentinelCount: 0 })
    } finally {
      await runtime.dispose()
    }

    const reopened = new DatabaseSync(canonicalPath, { readOnly: true })
    try {
      const migrations = reopened
        .prepare("SELECT count(*) AS count FROM sqlite_master WHERE name = '_migrations'")
        .get()
      expect(migrations).toEqual({ count: 0 })
    } finally {
      reopened.close()
    }
  })
})

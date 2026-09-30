import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import {
  prepareSessionScratchDirectory,
  sessionScratchRoot,
} from '../../utils/session-scratch-directory'
import { sweepSessionScratchDirectoriesOnce } from '../session-scratch-sweep-background'

const TWO_HOURS_MS = 2 * 60 * 60 * 1000

describe('Session scratch sweep at Host startup', () => {
  let temporaryDirectory = ''

  beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-scratch-sweep-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryDirectory, { recursive: true, force: true })
  })

  it('removes the directories of archived and deleted Sessions only', async () => {
    const root = sessionScratchRoot(temporaryDirectory)
    const [active, archived, deleted] = await Promise.all(
      ['session-active', 'session-archived', 'session-deleted'].map((id) =>
        prepareSessionScratchDirectory(id, root),
      ),
    )
    const database = SqliteClient.layer({
      filename: path.join(temporaryDirectory, 'catalog.sqlite'),
      prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
    })

    const removed = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.unsafe('CREATE TABLE sessions (id TEXT PRIMARY KEY, archived INTEGER NOT NULL)')
        yield* sql`INSERT INTO sessions (id, archived) VALUES
          (${'session-active'}, ${0}), (${'session-archived'}, ${1})`
        return yield* sweepSessionScratchDirectoriesOnce({ root, now: Date.now() + TWO_HOURS_MS })
      }).pipe(Effect.provide(database)),
    )

    expect(removed).toBe(2)
    expect((await fs.stat(active)).isDirectory()).toBe(true)
    await expect(fs.access(archived)).rejects.toThrow()
    await expect(fs.access(deleted)).rejects.toThrow()
  })
})

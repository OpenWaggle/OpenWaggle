import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { SESSION_QUERY_CONTRACT_VERSION } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as ManagedRuntime from 'effect/ManagedRuntime'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getDatabasePath, seedSessions, seedSingleSession } from '../../e2e/support/session-fixtures'
import { SqliteSessionQueryRepositoryLive } from '../../src/main/adapters/sqlite-session-query-repository'
import { SessionQueryRepository } from '../../src/main/ports/session-query-repository'
import { CURRENT_SESSION_SCHEMA_STATEMENTS } from '../../src/main/services/database-schema'
import { SESSION_HOST_TARGET_SCHEMA_STATEMENTS } from '../../src/main/services/session-host-target-schema'

describe('interrupted E2E Session fixtures', () => {
  let userDataDir = ''

  beforeEach(async () => {
    userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-session-fixture-test-'))
    await fs.mkdir(path.dirname(getDatabasePath(userDataDir)), { recursive: true })
    const database = new DatabaseSync(getDatabasePath(userDataDir))
    try {
      for (const statement of [
        ...CURRENT_SESSION_SCHEMA_STATEMENTS,
        ...SESSION_HOST_TARGET_SCHEMA_STATEMENTS,
      ]) {
        database.exec(statement)
      }
    } finally {
      database.close()
    }
  })

  afterEach(async () => {
    await fs.rm(userDataDir, { recursive: true, force: true })
  })

  it('keeps branch row pips and the exact Host interrupted filter in agreement', async () => {
    await seedSessions(userDataDir, [
      { title: 'Calm', projectPath: '/alpha', updatedAt: 30, messages: [] },
      {
        title: 'Stuck alpha',
        projectPath: '/alpha',
        updatedAt: 20,
        messages: [],
        interruptedRun: true,
      },
      { title: 'Stuck beta', projectPath: '/beta', updatedAt: 10, messages: [], interruptedRun: true },
    ])
    const database = new DatabaseSync(getDatabasePath(userDataDir))
    try {
      expect(
        database
          .prepare("SELECT COUNT(*) AS count FROM session_active_runs WHERE status = 'interrupted'")
          .get(),
      ).toEqual({ count: 2 })
    } finally {
      database.close()
    }

    const runtime = ManagedRuntime.make(
      SqliteSessionQueryRepositoryLive.pipe(
        Layer.provide(SqliteClient.layer({ filename: getDatabasePath(userDataDir) })),
      ),
    )
    try {
      const response = await runtime.runPromise(
        Effect.gen(function* () {
          const repository = yield* SessionQueryRepository
          return yield* repository.execute({
            request: {
              contractVersion: SESSION_QUERY_CONTRACT_VERSION,
              requestId: 'sidebar-interrupted-fixture',
              query: { operation: 'list', archived: false, interrupted: true, limit: 10 },
            },
          })
        }),
      )
      expect(response.outcome).toMatchObject({
        operation: 'list',
        totalCount: 2,
        sessions: [{ title: 'Stuck alpha' }, { title: 'Stuck beta' }],
      })
    } finally {
      await runtime.dispose()
    }
  })

  it('seeds the same interrupted Run for a single Session and its main branch', async () => {
    const sessionId = await seedSingleSession(userDataDir, {
      title: 'Interrupted single Session',
      updatedAt: 10,
      messages: [],
      interruptedRun: true,
    })
    const database = new DatabaseSync(getDatabasePath(userDataDir))
    try {
      expect(
        database
          .prepare(`
            SELECT runs.id, runs.status, branch_runs.branch_id
            FROM session_runs AS runs
            JOIN session_active_runs AS branch_runs ON branch_runs.run_id = runs.id
            WHERE runs.session_id = ? AND branch_runs.status = 'interrupted'
          `)
          .all(sessionId),
      ).toEqual([{ id: `run-${sessionId}`, status: 'interrupted', branch_id: `${sessionId}:main` }])
    } finally {
      database.close()
    }
  })

  it('rolls back the canonical Run when its branch projection cannot be seeded', async () => {
    const database = new DatabaseSync(getDatabasePath(userDataDir))
    try {
      database.exec(`
        CREATE TRIGGER reject_interrupted_fixture BEFORE INSERT ON session_active_runs
        BEGIN SELECT RAISE(ABORT, 'branch fixture rejected'); END
      `)
      await expect(
        seedSessions(userDataDir, [
          { title: 'Rejected interruption', updatedAt: 10, messages: [], interruptedRun: true },
        ]),
      ).rejects.toThrow('branch fixture rejected')
      expect(database.prepare('SELECT COUNT(*) AS count FROM session_runs').get()).toEqual({ count: 0 })
      expect(database.prepare('SELECT COUNT(*) AS count FROM session_active_runs').get()).toEqual({
        count: 0,
      })
    } finally {
      database.close()
    }
  })
})

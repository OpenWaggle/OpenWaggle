import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import { assertSessionAgentLifecycleProjectKnown } from '../session-tool-project-catalog'

function launch(projectPath: string): LocalSessionCommandPayload {
  return {
    contract: 'session-lifecycle-v2',
    request: {
      contractVersion: 2,
      requestId: 'request-launch',
      idempotencyKey: 'launch-once',
      command: {
        operation: 'launch',
        projectPath,
        objective: 'Investigate.',
        attachmentIds: [],
        workspace: { mode: 'local' },
      },
    },
  }
}

function create(projectPath: string): LocalSessionCommandPayload {
  return {
    contract: 'session-lifecycle-v2',
    request: {
      contractVersion: 2,
      requestId: 'request-create',
      idempotencyKey: 'create-once',
      command: { operation: 'create', projectPath },
    },
  }
}

describe('Session agent lifecycle project catalog check', () => {
  let root = ''

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-project-catalog-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  function check(
    payload: LocalSessionCommandPayload,
    callerScope: { all?: boolean } = { all: true },
  ) {
    const database = SqliteClient.layer({
      filename: path.join(root, 'catalog.sqlite'),
      prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
    })
    return Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.unsafe('CREATE TABLE IF NOT EXISTS sessions (id TEXT, project_path TEXT)')
        yield* sql.unsafe(
          'CREATE TABLE IF NOT EXISTS workspace_resources (id TEXT, project_path TEXT NOT NULL)',
        )
        yield* sql`DELETE FROM sessions`
        yield* sql`DELETE FROM workspace_resources`
        yield* sql`INSERT INTO sessions (id, project_path) VALUES (${'s'}, ${'/projects/gosafe'})`
        yield* sql`INSERT INTO workspace_resources (id, project_path)
          VALUES (${'w'}, ${'/projects/openwaggle'})`
        return yield* assertSessionAgentLifecycleProjectKnown(sql, callerScope, payload)
      }).pipe(Effect.provide(database)),
    )
  }

  it('allows launch and create in a project that has a Session or a Workspace', async () => {
    await expect(check(launch('/projects/gosafe'))).resolves.toBeUndefined()
    await expect(check(create('/projects/openwaggle'))).resolves.toBeUndefined()
  })

  it.each([
    ['launch', launch],
    ['create', create],
  ])('refuses %s in a directory that is not a project in OpenWaggle', async (_name, payload) => {
    await expect(check(payload('/Users/me/Downloads/untrusted-repo'))).rejects.toThrow(
      'is not a project in OpenWaggle',
    )
  })

  it('leaves a narrower caller to its own scope check, so it cannot probe for projects', async () => {
    await expect(check(launch('/Users/me/Downloads/untrusted-repo'), {})).resolves.toBeUndefined()
  })
})

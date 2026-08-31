import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionExportResourceResolver } from '../../ports/session-export-resource-resolver'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import { FilesystemSessionExportResourceResolverLive } from '../filesystem-session-export-resource-resolver'

describe('Filesystem Session export resource resolver', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-export-resource-resolver-')),
    )
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('rejects a workspace handoff after authority was checked instead of opening the new root', async () => {
    const authorizedWorkspace = path.join(temporaryRoot, 'authorized')
    const replacementWorkspace = path.join(temporaryRoot, 'replacement')
    await Promise.all([
      fs.mkdir(authorizedWorkspace),
      fs.mkdir(replacementWorkspace),
      fs.writeFile(path.join(temporaryRoot, 'placeholder'), ''),
    ])
    await fs.writeFile(path.join(replacementWorkspace, 'secret.md'), 'must not be opened')

    const sqlite = SqliteClient.layer({
      filename: path.join(temporaryRoot, 'resolver.sqlite'),
      prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
    })
    const schema = Layer.effectDiscard(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.unsafe(`
          CREATE TABLE workspace_resources (
            id TEXT PRIMARY KEY,
            working_path TEXT NOT NULL,
            lifecycle_state TEXT NOT NULL
          )
        `)
        yield* sql.unsafe(`
          CREATE TABLE session_workspace_bindings (
            session_id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL
          )
        `)
        yield* sql`
          INSERT INTO workspace_resources (id, working_path, lifecycle_state)
          VALUES (${'workspace-replacement'}, ${replacementWorkspace}, ${'ready'})
        `
        yield* sql`
          INSERT INTO session_workspace_bindings (session_id, workspace_id)
          VALUES (${'session-1'}, ${'workspace-replacement'})
        `
      }).pipe(Effect.provide(sqlite)),
    )
    const layer = Layer.mergeAll(
      sqlite,
      schema,
      FilesystemSessionExportResourceResolverLive.pipe(Layer.provide(sqlite)),
    )

    const outcome = await Effect.runPromise(
      Effect.either(
        Effect.gen(function* () {
          const resolver = yield* SessionExportResourceResolver
          return yield* resolver.resolve({
            sessionId: 'session-1',
            resource: { kind: 'workspace-file', path: 'secret.md' },
            expectedWorkspacePath: authorizedWorkspace,
          })
        }).pipe(Effect.provide(layer)),
      ),
    )

    expect(outcome).toMatchObject({
      _tag: 'Left',
      left: {
        message: expect.stringContaining('workspace changed after export resource authorization'),
      },
    })
  })
})

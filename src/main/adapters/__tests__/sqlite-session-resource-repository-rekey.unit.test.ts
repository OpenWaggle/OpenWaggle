import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionResourceRepository } from '../../ports/session-resource-repository'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import {
  CURRENT_SESSION_RESOURCE_SCHEMA_STATEMENTS,
  CURRENT_SESSION_SCHEMA_STATEMENTS,
} from '../../services/database-schema'
import { SqliteSessionResourceRepositoryLive } from '../sqlite-session-resource-repository'

let tmpRoot = ''

function makeTestLayer(databasePath: string) {
  const sqliteLayer = SqliteClient.layer({
    filename: databasePath,
    prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
  })
  const schemaLayer = Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql.unsafe('PRAGMA foreign_keys = ON')
      for (const statement of [
        ...CURRENT_SESSION_SCHEMA_STATEMENTS,
        ...CURRENT_SESSION_RESOURCE_SCHEMA_STATEMENTS,
      ]) {
        yield* sql.unsafe(statement)
      }
      yield* sql`
        INSERT INTO sessions (
          id, pi_session_id, title, archived, created_at, updated_at
        ) VALUES (
          'session-1', 'pi-session-1', 'Session', 0, 1000, 1000
        )
      `
    }).pipe(Effect.provide(sqliteLayer)),
  )
  const repositoryLayer = SqliteSessionResourceRepositoryLive.pipe(Layer.provide(sqliteLayer))
  return Layer.mergeAll(schemaLayer, repositoryLayer, sqliteLayer)
}

describe('SqliteSessionResourceRepositoryLive re-keying', () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-session-resource-rekey-'))
  })

  afterEach(async () => {
    if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('preserves a recovered resource identity when its digest is unique', async () => {
    const layer = makeTestLayer(path.join(tmpRoot, 'rekey-unique.sqlite'))
    const sessionId = SessionId('session-1')

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionResourceRepository
        yield* repository.upsert({
          id: 'missing-resource',
          sessionId,
          canonicalKey: 'file:/input/missing.png',
          kind: 'image',
          title: 'missing.png',
          mimeType: 'image/png',
          locator: '/input/missing.png',
          managedPath: null,
          available: false,
          occurrence: {
            id: 'occurrence-recovered',
            nodeId: 'node-recovered',
            branchId: null,
            actor: 'user',
            activity: 'provided',
            label: null,
            createdAt: 1000,
          },
          createdAt: 1000,
          updatedAt: 1000,
        })

        const rekeyed = yield* repository.rekey({
          sessionId,
          resourceId: 'missing-resource',
          canonicalKey: 'sha256:unique-digest',
          updatedAt: 2000,
        })
        const oldKey = yield* repository.findByCanonicalKey(sessionId, 'file:/input/missing.png')
        const digest = yield* repository.findByCanonicalKey(sessionId, 'sha256:unique-digest')
        return { rekeyed, oldKey, digest }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.rekeyed).toMatchObject({
      id: 'missing-resource',
      canonicalKey: 'sha256:unique-digest',
      updatedAt: 2000,
    })
    expect(result.oldKey).toBeNull()
    expect(result.digest?.id).toBe('missing-resource')
  })
})

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

describe('SqliteSessionResourceRepositoryLive semantic kinds', () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-session-resources-'))
  })

  afterEach(async () => {
    if (tmpRoot) {
      await fs.rm(tmpRoot, { recursive: true, force: true })
    }
  })

  it('preserves semantic URL kinds regardless of capture order or reused ids', async () => {
    const layer = makeTestLayer(path.join(tmpRoot, 'semantic-kinds.sqlite'))
    const sessionId = SessionId('session-1')

    const resources = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionResourceRepository
        const upsert = (
          canonicalKey: string,
          id: string,
          kind: 'link' | 'site' | 'change-request',
          occurrenceId: string,
          createdAt: number,
        ) =>
          repository.upsert({
            id,
            sessionId,
            canonicalKey,
            kind,
            title: `${kind} title`,
            mimeType: null,
            locator: canonicalKey.slice('url:'.length),
            managedPath: null,
            available: true,
            occurrence: {
              id: occurrenceId,
              nodeId: 'node-agent',
              branchId: 'branch-main',
              actor: 'agent',
              activity: kind === 'change-request' ? 'created' : 'read',
              label: null,
              locator: canonicalKey.slice('url:'.length),
              createdAt,
            },
            createdAt,
            updatedAt: createdAt,
          })

        yield* upsert('url:https://example.test/forward', 'link-first', 'link', 'link-read', 1)
        yield* upsert(
          'url:https://example.test/forward',
          'request-second',
          'change-request',
          'request-created',
          2,
        )
        yield* upsert(
          'url:https://example.test/reverse',
          'request-first',
          'change-request',
          'reverse-request-created',
          1,
        )
        yield* upsert('url:https://example.test/reverse', 'site-second', 'site', 'site-read', 2)
        yield* upsert(
          'url:https://example.test/reused-id',
          'shared-resource',
          'change-request',
          'shared-request-created',
          1,
        )
        yield* upsert(
          'url:https://example.test/reused-id',
          'shared-resource',
          'site',
          'shared-site-read',
          2,
        )
        return yield* repository.list(sessionId)
      }).pipe(Effect.provide(layer)),
    )

    expect(resources).toHaveLength(3)
    expect(
      Object.fromEntries(
        resources.map(({ canonicalKey, kind, title }) => [canonicalKey, { kind, title }]),
      ),
    ).toEqual({
      'url:https://example.test/forward': {
        kind: 'change-request',
        title: 'change-request title',
      },
      'url:https://example.test/reused-id': {
        kind: 'change-request',
        title: 'change-request title',
      },
      'url:https://example.test/reverse': {
        kind: 'change-request',
        title: 'change-request title',
      },
    })
  })
})

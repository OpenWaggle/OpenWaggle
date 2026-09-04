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

  return Layer.mergeAll(
    schemaLayer,
    SqliteSessionResourceRepositoryLive.pipe(Layer.provide(sqliteLayer)),
    sqliteLayer,
  )
}

describe('SqliteSessionResourceRepositoryLive repair state', () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-resource-repair-'))
  })

  afterEach(async () => {
    if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('marks a missing managed copy unavailable and restores it after repair', async () => {
    const sessionId = SessionId('session-1')
    const layer = makeTestLayer(path.join(tmpRoot, 'resources.sqlite'))
    const occurrence = {
      id: 'attachment:node-user:0',
      nodeId: 'node-user',
      branchId: 'branch-main',
      actor: 'user',
      activity: 'provided',
      label: null,
      createdAt: 1000,
    } as const

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionResourceRepository
        const base = {
          id: 'resource-1',
          sessionId,
          canonicalKey: 'sha256:digest',
          kind: 'image',
          title: 'image.png',
          mimeType: 'image/png',
          occurrence,
          createdAt: 1000,
        } as const
        yield* repository.upsert({
          ...base,
          locator: 'session-resource://resource-1',
          managedPath: '/managed/missing.png',
          available: true,
          updatedAt: 1000,
        })
        yield* repository.upsert({
          ...base,
          locator: '/input/image.png',
          managedPath: null,
          available: false,
          updatedAt: 2000,
        })
        const unavailable = yield* repository.findByCanonicalKey(sessionId, base.canonicalKey)
        const unavailableLocation = yield* repository.getContentLocation(sessionId, base.id)

        yield* repository.upsert({
          ...base,
          locator: 'session-resource://resource-1',
          managedPath: '/managed/repaired.png',
          available: true,
          updatedAt: 3000,
        })
        const repaired = yield* repository.findByCanonicalKey(sessionId, base.canonicalKey)
        const repairedLocation = yield* repository.getContentLocation(sessionId, base.id)
        return { repaired, repairedLocation, unavailable, unavailableLocation }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.unavailable).toMatchObject({
      id: 'resource-1',
      locator: '/input/image.png',
      available: false,
    })
    expect(result.unavailableLocation).toBeNull()
    expect(result.repaired).toMatchObject({
      id: 'resource-1',
      locator: 'session-resource://resource-1',
      available: true,
    })
    expect(result.repairedLocation).toMatchObject({
      resourceId: 'resource-1',
      managedPath: '/managed/repaired.png',
    })
  })

  it('persists a monotonic session-scoped backfill cursor', async () => {
    const sessionId = SessionId('session-1')
    const layer = makeTestLayer(path.join(tmpRoot, 'cursor.sqlite'))

    const cursors = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionResourceRepository
        const initial = yield* repository.getBackfillCursor(sessionId)
        yield* repository.advanceBackfillCursor(sessionId, 41)
        yield* repository.advanceBackfillCursor(sessionId, 12)
        const advanced = yield* repository.getBackfillCursor(sessionId)
        const otherSession = yield* repository.getBackfillCursor(SessionId('session-2'))
        return { advanced, initial, otherSession }
      }).pipe(Effect.provide(layer)),
    )

    expect(cursors).toEqual({ advanced: 41, initial: -1, otherSession: -1 })
  })
})

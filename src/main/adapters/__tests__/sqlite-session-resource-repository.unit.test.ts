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
        ), (
          'session-2', 'pi-session-2', 'Other session', 0, 1000, 1000
        )
      `
    }).pipe(Effect.provide(sqliteLayer)),
  )
  const repositoryLayer = SqliteSessionResourceRepositoryLive.pipe(Layer.provide(sqliteLayer))

  return Layer.mergeAll(schemaLayer, repositoryLayer, sqliteLayer)
}

describe('SqliteSessionResourceRepositoryLive', () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-session-resources-'))
  })

  afterEach(async () => {
    if (tmpRoot) {
      await fs.rm(tmpRoot, { recursive: true, force: true })
    }
  })

  it('deduplicates a resource while preserving its source and output occurrences', async () => {
    const layer = makeTestLayer(path.join(tmpRoot, 'resources.sqlite'))
    const sessionId = SessionId('session-1')

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionResourceRepository
        yield* repository.upsert({
          id: 'resource-1',
          sessionId,
          canonicalKey: 'file:/project/report.png',
          kind: 'image',
          title: 'report.png',
          mimeType: 'image/png',
          locator: 'session-resource://resource-1',
          managedPath: '/managed/resource-1.png',
          available: true,
          occurrence: {
            id: 'occurrence-provided',
            nodeId: 'node-user',
            branchId: 'branch-main',
            actor: 'user',
            activity: 'provided',
            label: null,
            createdAt: 1000,
          },
          createdAt: 1000,
          updatedAt: 1000,
        })
        yield* repository.upsert({
          id: 'resource-new-id-is-ignored',
          sessionId,
          canonicalKey: 'file:/project/report.png',
          kind: 'image',
          title: 'report.png',
          mimeType: 'image/png',
          locator: 'session-resource://replacement-id',
          managedPath: '/managed/replacement.png',
          available: true,
          occurrence: {
            id: 'occurrence-created',
            nodeId: 'node-agent',
            branchId: 'branch-main',
            actor: 'agent',
            activity: 'created',
            label: null,
            createdAt: 2000,
          },
          createdAt: 2000,
          updatedAt: 2000,
        })
        yield* repository.upsert({
          id: 'older-observation',
          sessionId,
          canonicalKey: 'file:/project/report.png',
          kind: 'link',
          title: 'stale-title',
          mimeType: null,
          locator: 'https://example.invalid/stale',
          managedPath: null,
          available: true,
          occurrence: {
            id: 'occurrence-provided',
            nodeId: 'node-old-branch',
            branchId: 'branch-old',
            actor: 'agent',
            activity: 'read',
            label: null,
            createdAt: 500,
          },
          createdAt: 500,
          updatedAt: 500,
        })

        const resources = yield* repository.list(sessionId)
        const found = yield* repository.findByCanonicalKey(sessionId, 'file:/project/report.png')
        const location = yield* repository.getContentLocation(sessionId, 'resource-1')
        const providedExists = yield* repository.hasOccurrence(sessionId, 'occurrence-provided')
        const otherSessionExists = yield* repository.hasOccurrence(
          SessionId('session-2'),
          'occurrence-provided',
        )
        return { resources, found, location, providedExists, otherSessionExists }
      }).pipe(Effect.provide(layer)),
    )

    const { resources } = result
    expect(resources).toHaveLength(1)
    expect(resources[0]).toMatchObject({
      id: 'resource-1',
      locator: 'session-resource://replacement-id',
      kind: 'image',
      title: 'report.png',
      updatedAt: 2000,
      isSource: true,
      isOutput: true,
    })
    expect(resources[0]?.occurrences.map((occurrence) => occurrence.activity)).toEqual([
      'provided',
      'created',
    ])
    expect(result.found).toMatchObject({ id: 'resource-1' })
    expect(result.location).toMatchObject({
      resourceId: 'resource-1',
      managedPath: '/managed/replacement.png',
    })
    expect(result.providedExists).toBe(true)
    expect(result.otherSessionExists).toBe(false)
  })

  it('scopes identical resources to their session and cascades them on session deletion', async () => {
    const layer = makeTestLayer(path.join(tmpRoot, 'isolation.sqlite'))

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionResourceRepository
        const sql = yield* SqlClient.SqlClient
        for (const sessionId of [SessionId('session-1'), SessionId('session-2')]) {
          yield* repository.upsert({
            id: `resource-${sessionId}`,
            sessionId,
            canonicalKey: 'sha256:same-content',
            kind: 'image',
            title: 'same.png',
            mimeType: 'image/png',
            locator: `session-resource://resource-${sessionId}`,
            managedPath: `/managed/${sessionId}.png`,
            available: true,
            occurrence: {
              id: `occurrence-${sessionId}`,
              nodeId: null,
              branchId: null,
              actor: 'user',
              activity: 'provided',
              label: null,
              createdAt: 1000,
            },
            createdAt: 1000,
            updatedAt: 1000,
          })
        }

        const beforeDelete = yield* repository.list(SessionId('session-2'))
        yield* sql`DELETE FROM sessions WHERE id = 'session-1'`
        const deleted = yield* repository.list(SessionId('session-1'))
        const preserved = yield* repository.list(SessionId('session-2'))
        return { beforeDelete, deleted, preserved }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.beforeDelete).toHaveLength(1)
    expect(result.beforeDelete[0]?.sessionId).toBe('session-2')
    expect(result.deleted).toEqual([])
    expect(result.preserved).toHaveLength(1)
  })

  it('re-keys recovered resources by digest and merges duplicate occurrences', async () => {
    const layer = makeTestLayer(path.join(tmpRoot, 'rekey.sqlite'))
    const sessionId = SessionId('session-1')

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionResourceRepository
        yield* repository.upsert({
          id: 'digest-resource',
          sessionId,
          canonicalKey: 'sha256:attachment-digest',
          kind: 'image',
          title: 'existing.png',
          mimeType: 'image/png',
          locator: 'session-resource://digest-resource',
          managedPath: '/managed/existing.png',
          available: true,
          occurrence: {
            id: 'occurrence-existing',
            nodeId: 'node-existing',
            branchId: null,
            actor: 'user',
            activity: 'provided',
            label: null,
            createdAt: 500,
          },
          createdAt: 500,
          updatedAt: 500,
        })
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
          canonicalKey: 'sha256:attachment-digest',
          updatedAt: 2000,
        })
        const resources = yield* repository.list(sessionId)
        const oldKey = yield* repository.findByCanonicalKey(sessionId, 'file:/input/missing.png')
        return { rekeyed, resources, oldKey }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.rekeyed).toMatchObject({
      id: 'digest-resource',
      canonicalKey: 'sha256:attachment-digest',
      updatedAt: 2000,
    })
    expect(result.rekeyed.occurrences.map((occurrence) => occurrence.id)).toEqual([
      'occurrence-existing',
      'occurrence-recovered',
    ])
    expect(result.resources).toHaveLength(1)
    expect(result.oldKey).toBeNull()
  })
})

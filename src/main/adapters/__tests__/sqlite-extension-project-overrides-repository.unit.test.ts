import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ExtensionProjectOverridesRepository } from '../../ports/extension-project-overrides-repository'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import { CURRENT_EXTENSION_SCHEMA_STATEMENTS } from '../../services/database-schema'
import { SqliteExtensionProjectOverridesRepositoryLive } from '../sqlite-extension-project-overrides-repository'

let tmpRoot = ''

function makeTestLayer(databasePath: string) {
  const sqliteLayer = SqliteClient.layer({
    filename: databasePath,
    prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
  })
  const schemaLayer = Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      for (const statement of CURRENT_EXTENSION_SCHEMA_STATEMENTS) {
        yield* sql.unsafe(statement)
      }
    }).pipe(Effect.provide(sqliteLayer)),
  )
  const repositoryLayer = SqliteExtensionProjectOverridesRepositoryLive.pipe(
    Layer.provide(sqliteLayer),
  )

  return Layer.mergeAll(schemaLayer, repositoryLayer)
}

describe('SqliteExtensionProjectOverridesRepositoryLive', () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-extension-overrides-'))
  })

  afterEach(async () => {
    if (tmpRoot) {
      await fs.rm(tmpRoot, { recursive: true, force: true })
    }
  })

  it('persists project override state by extension, source scope, and project path', async () => {
    const layer = makeTestLayer(path.join(tmpRoot, 'extensions.sqlite'))
    const projectPath = path.join(tmpRoot, 'project')
    const createdAt = Date.now()
    const updatedAt = createdAt + 1

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* ExtensionProjectOverridesRepository
        yield* repository.upsert({
          extensionId: 'sample-extension',
          scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
          projectPath,
          disabled: true,
          createdAt,
          updatedAt,
        })
        return yield* repository.get({
          extensionId: 'sample-extension',
          scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
          projectPath,
        })
      }).pipe(Effect.provide(layer)),
    )

    expect(result).toEqual({
      extensionId: 'sample-extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      projectPath,
      disabled: true,
      createdAt,
      updatedAt,
    })
  })

  it('keeps overrides isolated between selected projects', async () => {
    const layer = makeTestLayer(path.join(tmpRoot, 'extensions.sqlite'))
    const firstProjectPath = path.join(tmpRoot, 'first-project')
    const secondProjectPath = path.join(tmpRoot, 'second-project')
    const now = Date.now()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* ExtensionProjectOverridesRepository
        yield* repository.upsert({
          extensionId: 'sample-extension',
          scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
          projectPath: firstProjectPath,
          disabled: true,
          createdAt: now,
          updatedAt: now,
        })
        return yield* repository.get({
          extensionId: 'sample-extension',
          scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
          projectPath: secondProjectPath,
        })
      }).pipe(Effect.provide(layer)),
    )

    expect(result).toBeNull()
  })
})

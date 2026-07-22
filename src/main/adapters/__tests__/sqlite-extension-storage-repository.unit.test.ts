import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { JsonValue } from '@shared/types/json'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ExtensionStorageRepository } from '../../ports/extension-storage-repository'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import { CURRENT_EXTENSION_SCHEMA_STATEMENTS } from '../../services/database-schema'
import { SqliteExtensionStorageRepositoryLive } from '../sqlite-extension-storage-repository'

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
  const repositoryLayer = SqliteExtensionStorageRepositoryLive.pipe(Layer.provide(sqliteLayer))

  return Layer.mergeAll(schemaLayer, repositoryLayer)
}

describe('SqliteExtensionStorageRepositoryLive', () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-extension-storage-'))
  })

  afterEach(async () => {
    if (tmpRoot) {
      await fs.rm(tmpRoot, { recursive: true, force: true })
    }
  })

  it('persists extension storage by package scope and storage scope', async () => {
    const layer = makeTestLayer(path.join(tmpRoot, 'extensions.sqlite'))
    const projectPath = path.join(tmpRoot, 'project')
    const globalValue = { mode: 'global' } satisfies JsonValue
    const projectValue = { mode: 'project', enabled: true } satisfies JsonValue

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* ExtensionStorageRepository
        yield* repository.upsert({
          extensionId: 'sample-extension',
          packageScope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
          storageKind: OPENWAGGLE_EXTENSION.STORAGE.KIND.CONFIG,
          storageScope: { kind: OPENWAGGLE_EXTENSION.STORAGE.SCOPE.GLOBAL_KIND },
          key: 'settings',
          value: globalValue,
          createdAt: 1000,
          updatedAt: 1000,
        })
        yield* repository.upsert({
          extensionId: 'sample-extension',
          packageScope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
          storageKind: OPENWAGGLE_EXTENSION.STORAGE.KIND.CONFIG,
          storageScope: {
            kind: OPENWAGGLE_EXTENSION.STORAGE.SCOPE.PROJECT_KIND,
            projectPath,
          },
          key: 'settings',
          value: projectValue,
          createdAt: 2000,
          updatedAt: 2000,
        })

        const globalItem = yield* repository.get({
          extensionId: 'sample-extension',
          packageScope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
          storageKind: OPENWAGGLE_EXTENSION.STORAGE.KIND.CONFIG,
          storageScope: { kind: OPENWAGGLE_EXTENSION.STORAGE.SCOPE.GLOBAL_KIND },
          key: 'settings',
        })
        const projectItem = yield* repository.get({
          extensionId: 'sample-extension',
          packageScope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
          storageKind: OPENWAGGLE_EXTENSION.STORAGE.KIND.CONFIG,
          storageScope: {
            kind: OPENWAGGLE_EXTENSION.STORAGE.SCOPE.PROJECT_KIND,
            projectPath,
          },
          key: 'settings',
        })

        return { globalItem, projectItem }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.globalItem?.value).toEqual(globalValue)
    expect(result.projectItem?.value).toEqual(projectValue)
  })

  it('lists and deletes keys within one extension storage scope', async () => {
    const layer = makeTestLayer(path.join(tmpRoot, 'extensions.sqlite'))
    const packageScope = { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND }
    const storageScope = { kind: OPENWAGGLE_EXTENSION.STORAGE.SCOPE.GLOBAL_KIND }

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* ExtensionStorageRepository
        yield* repository.upsert({
          extensionId: 'sample-extension',
          packageScope,
          storageKind: OPENWAGGLE_EXTENSION.STORAGE.KIND.STATE,
          storageScope,
          key: 'first',
          value: 'one',
          createdAt: 1000,
          updatedAt: 1000,
        })
        yield* repository.upsert({
          extensionId: 'sample-extension',
          packageScope,
          storageKind: OPENWAGGLE_EXTENSION.STORAGE.KIND.STATE,
          storageScope,
          key: 'second',
          value: 'two',
          createdAt: 1000,
          updatedAt: 1000,
        })
        yield* repository.delete({
          extensionId: 'sample-extension',
          packageScope,
          storageKind: OPENWAGGLE_EXTENSION.STORAGE.KIND.STATE,
          storageScope,
          key: 'first',
        })

        return yield* repository.listKeys({
          extensionId: 'sample-extension',
          packageScope,
          storageKind: OPENWAGGLE_EXTENSION.STORAGE.KIND.STATE,
          storageScope,
        })
      }).pipe(Effect.provide(layer)),
    )

    expect(result).toEqual(['second'])
  })
})

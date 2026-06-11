import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ExtensionLifecycleRepository } from '../../ports/extension-lifecycle-repository'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import { CURRENT_EXTENSION_SCHEMA_STATEMENTS } from '../../services/database-schema'
import { SqliteExtensionLifecycleRepositoryLive } from '../sqlite-extension-lifecycle-repository'

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
  const repositoryLayer = SqliteExtensionLifecycleRepositoryLive.pipe(Layer.provide(sqliteLayer))

  return Layer.mergeAll(schemaLayer, repositoryLayer)
}

describe('SqliteExtensionLifecycleRepositoryLive', () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-extension-lifecycle-'))
  })

  afterEach(async () => {
    if (tmpRoot) {
      await fs.rm(tmpRoot, { recursive: true, force: true })
    }
  })

  it('persists lifecycle state by extension and scope', async () => {
    const layer = makeTestLayer(path.join(tmpRoot, 'extensions.sqlite'))
    const now = Date.now()
    const projectPath = path.join(tmpRoot, 'project')

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* ExtensionLifecycleRepository
        yield* repository.upsert({
          extensionId: 'sample-extension',
          scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath },
          enabled: true,
          trusted: true,
          grantedCapabilities: ['settings.read'],
          contentHash: 'abc123',
          packageVersion: '1.0.0',
          approvedBuildPlanHash: 'build-plan-hash',
          buildStatus: OPENWAGGLE_EXTENSION.BUILD_RUN_STATUS.NOT_RUN,
          buildLog: null,
          reloadStatus: OPENWAGGLE_EXTENSION.RELOAD_STATUS.NOT_RELOADED,
          lastReloadedAt: null,
          sdkRange: '>=0.1.0 <0.2.0',
          sdkCompatible: true,
          diagnostics: [
            {
              severity: 'warning',
              code: 'filesystem-error',
              message: 'diagnostic kept for display',
            },
          ],
          installedAt: now,
          updatedAt: now,
        })
        return yield* repository.get({
          extensionId: 'sample-extension',
          scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath },
        })
      }).pipe(Effect.provide(layer)),
    )

    expect(result).toEqual({
      extensionId: 'sample-extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath },
      enabled: true,
      trusted: true,
      grantedCapabilities: ['settings.read'],
      contentHash: 'abc123',
      packageVersion: '1.0.0',
      approvedBuildPlanHash: 'build-plan-hash',
      buildStatus: OPENWAGGLE_EXTENSION.BUILD_RUN_STATUS.NOT_RUN,
      buildLog: null,
      reloadStatus: OPENWAGGLE_EXTENSION.RELOAD_STATUS.NOT_RELOADED,
      lastReloadedAt: null,
      sdkRange: '>=0.1.0 <0.2.0',
      sdkCompatible: true,
      diagnostics: [
        {
          severity: 'warning',
          code: 'filesystem-error',
          message: 'diagnostic kept for display',
        },
      ],
      installedAt: now,
      updatedAt: now,
    })
  })

  it('lists only lifecycle states for the requested scope', async () => {
    const layer = makeTestLayer(path.join(tmpRoot, 'extensions.sqlite'))
    const projectPath = path.join(tmpRoot, 'project')

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* ExtensionLifecycleRepository
        yield* repository.upsert({
          extensionId: 'global-extension',
          scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
          enabled: true,
          trusted: false,
          grantedCapabilities: [],
          contentHash: null,
          packageVersion: null,
          approvedBuildPlanHash: null,
          buildStatus: OPENWAGGLE_EXTENSION.BUILD_RUN_STATUS.NOT_RUN,
          buildLog: null,
          reloadStatus: OPENWAGGLE_EXTENSION.RELOAD_STATUS.NOT_RELOADED,
          lastReloadedAt: null,
          sdkRange: null,
          sdkCompatible: false,
          diagnostics: [],
          installedAt: Date.now(),
          updatedAt: Date.now(),
        })
        yield* repository.upsert({
          extensionId: 'project-extension',
          scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath },
          enabled: false,
          trusted: false,
          grantedCapabilities: [],
          contentHash: null,
          packageVersion: null,
          approvedBuildPlanHash: null,
          buildStatus: OPENWAGGLE_EXTENSION.BUILD_RUN_STATUS.NOT_RUN,
          buildLog: null,
          reloadStatus: OPENWAGGLE_EXTENSION.RELOAD_STATUS.NOT_RELOADED,
          lastReloadedAt: null,
          sdkRange: null,
          sdkCompatible: false,
          diagnostics: [],
          installedAt: Date.now(),
          updatedAt: Date.now(),
        })
        return yield* repository.list({
          kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND,
          projectPath,
        })
      }).pipe(Effect.provide(layer)),
    )

    expect(result.map((entry) => entry.extensionId)).toEqual(['project-extension'])
  })

  it('persists reload lifecycle state across repository restarts', async () => {
    const databasePath = path.join(tmpRoot, 'extensions.sqlite')
    const projectPath = path.join(tmpRoot, 'project')
    const firstLayer = makeTestLayer(databasePath)
    const reloadedAt = Date.now()

    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* ExtensionLifecycleRepository
        yield* repository.upsert({
          extensionId: 'sample-extension',
          scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath },
          enabled: true,
          trusted: true,
          grantedCapabilities: ['settings.read'],
          contentHash: 'abc123',
          packageVersion: '1.0.0',
          approvedBuildPlanHash: null,
          buildStatus: OPENWAGGLE_EXTENSION.BUILD_RUN_STATUS.NOT_RUN,
          buildLog: null,
          reloadStatus: OPENWAGGLE_EXTENSION.RELOAD_STATUS.SUCCEEDED,
          lastReloadedAt: reloadedAt,
          sdkRange: '>=0.1.0 <0.2.0',
          sdkCompatible: true,
          diagnostics: [],
          installedAt: reloadedAt,
          updatedAt: reloadedAt,
        })
      }).pipe(Effect.provide(firstLayer)),
    )

    const secondLayer = makeTestLayer(databasePath)
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* ExtensionLifecycleRepository
        return yield* repository.get({
          extensionId: 'sample-extension',
          scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath },
        })
      }).pipe(Effect.provide(secondLayer)),
    )

    expect(result).toMatchObject({
      extensionId: 'sample-extension',
      reloadStatus: OPENWAGGLE_EXTENSION.RELOAD_STATUS.SUCCEEDED,
      lastReloadedAt: reloadedAt,
    })
  })

  it('deletes lifecycle state for extension uninstall cleanup', async () => {
    const layer = makeTestLayer(path.join(tmpRoot, 'extensions.sqlite'))
    const projectPath = path.join(tmpRoot, 'project')
    const now = Date.now()

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* ExtensionLifecycleRepository
        const key = {
          extensionId: 'remove-extension',
          scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath },
        } as const
        yield* repository.upsert({
          ...key,
          enabled: true,
          trusted: true,
          grantedCapabilities: ['settings.read'],
          contentHash: 'abc123',
          packageVersion: '1.0.0',
          approvedBuildPlanHash: null,
          buildStatus: OPENWAGGLE_EXTENSION.BUILD_RUN_STATUS.NOT_RUN,
          buildLog: null,
          reloadStatus: OPENWAGGLE_EXTENSION.RELOAD_STATUS.SUCCEEDED,
          lastReloadedAt: now,
          sdkRange: '>=0.1.0 <0.2.0',
          sdkCompatible: true,
          diagnostics: [],
          installedAt: now,
          updatedAt: now,
        })
        const deleteLifecycle = repository.delete
        if (!deleteLifecycle) {
          throw new Error('Expected lifecycle repository delete support.')
        }
        yield* deleteLifecycle(key)
        return yield* repository.get(key)
      }).pipe(Effect.provide(layer)),
    )

    expect(result).toBeNull()
  })
})

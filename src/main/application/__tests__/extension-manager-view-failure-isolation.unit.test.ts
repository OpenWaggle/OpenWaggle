import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it } from 'vitest'
import {
  ExtensionDiscoveryError,
  ExtensionLifecycleRepositoryError,
  ExtensionProjectOverrideRepositoryError,
} from '../../errors'
import { ExtensionLifecycleRepository } from '../../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../../ports/extension-manager-service'
import { ExtensionProjectOverridesRepository } from '../../ports/extension-project-overrides-repository'
import { listExtensionPackagesView } from '../extension-manager-view-service'
import { makePackage, PROJECT_PATH } from './extension-contribution-registry-test-utils'

const discoveredPackage = makePackage({
  id: 'sample-extension',
  name: 'Sample Extension',
  scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: PROJECT_PATH },
  contributions: {
    commands: [{ id: 'sample.run', title: 'Run Sample' }],
  },
})

describe('listExtensionPackagesView failure isolation', () => {
  it('returns a diagnostic package when project extension discovery fails', async () => {
    const layer = Layer.mergeAll(
      Layer.succeed(ExtensionManagerService, {
        listPackages: ({ projectPath }) =>
          projectPath === PROJECT_PATH
            ? Effect.fail(
                new ExtensionDiscoveryError({
                  operation: 'list-packages',
                  cause: new Error('project discovery exploded'),
                }),
              )
            : Effect.succeed([]),
      }),
      Layer.succeed(ExtensionLifecycleRepository, {
        get: () => Effect.succeed(null),
        list: () => Effect.succeed([]),
        upsert: () => Effect.void,
      }),
      Layer.succeed(ExtensionProjectOverridesRepository, {
        get: () => Effect.succeed(null),
        upsert: () => Effect.void,
      }),
    )

    const view = await Effect.runPromise(
      listExtensionPackagesView({ projectPaths: [PROJECT_PATH] }).pipe(Effect.provide(layer)),
    )

    expect(view.packages).toHaveLength(1)
    expect(view.packages[0]).toMatchObject({
      id: 'project-extension-discovery',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: PROJECT_PATH },
      manifest: null,
      lifecycle: null,
      diagnostics: [
        expect.objectContaining({
          severity: OPENWAGGLE_EXTENSION.DIAGNOSTIC.SEVERITY.ERROR,
          code: OPENWAGGLE_EXTENSION.DIAGNOSTIC.CODE.FILESYSTEM_ERROR,
          message: expect.stringContaining('project discovery exploded'),
        }),
      ],
    })
  })

  it('keeps manager view construction safe when lifecycle and project override reads fail', async () => {
    const layer = Layer.mergeAll(
      Layer.succeed(ExtensionManagerService, {
        listPackages: () => Effect.succeed([discoveredPackage]),
      }),
      Layer.succeed(ExtensionLifecycleRepository, {
        get: () =>
          Effect.fail(
            new ExtensionLifecycleRepositoryError({
              operation: 'get',
              cause: new Error('lifecycle database unavailable'),
            }),
          ),
        list: () => Effect.succeed([]),
        upsert: () => Effect.void,
      }),
      Layer.succeed(ExtensionProjectOverridesRepository, {
        get: () =>
          Effect.fail(
            new ExtensionProjectOverrideRepositoryError({
              operation: 'get',
              cause: new Error('override database unavailable'),
            }),
          ),
        upsert: () => Effect.void,
      }),
    )

    const view = await Effect.runPromise(
      listExtensionPackagesView({ projectPaths: [PROJECT_PATH] }).pipe(Effect.provide(layer)),
    )

    expect(view.packages[0]).toMatchObject({
      id: 'sample-extension',
      lifecycle: null,
      projectOverride: {
        projectPath: PROJECT_PATH,
        disabled: true,
        updatedAt: null,
      },
    })
    expect(view.packages[0]?.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      OPENWAGGLE_EXTENSION.DIAGNOSTIC.CODE.LIFECYCLE_STATE_UNAVAILABLE,
      OPENWAGGLE_EXTENSION.DIAGNOSTIC.CODE.PROJECT_OVERRIDE_UNAVAILABLE,
    ])
  })
})

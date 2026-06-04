import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it } from 'vitest'
import {
  ExtensionDiscoveryError,
  ExtensionLifecycleRepositoryError,
  ExtensionProjectOverrideRepositoryError,
} from '../../errors'
import type { ExtensionLifecycleState } from '../../extensions/types'
import { ExtensionLifecycleRepository } from '../../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../../ports/extension-manager-service'
import { ExtensionProjectOverridesRepository } from '../../ports/extension-project-overrides-repository'
import { listExtensionContributionRegistryView } from '../extension-contribution-registry-service'
import {
  expectFirstEntry,
  loadRegistry,
  makeLifecycle,
  makePackage,
  OTHER_PROJECT_PATH,
  PROJECT_PATH,
} from './extension-contribution-registry-test-utils'

describe('listExtensionContributionRegistryView failure isolation', () => {
  it('keeps sibling contributions when one project discovery call fails', async () => {
    const globalPackage = makePackage({
      id: 'global-extension',
      name: 'Global Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      contributions: {
        commands: [{ id: 'global.run', title: 'Run Global' }],
      },
    })
    const layer = Layer.mergeAll(
      Layer.succeed(ExtensionManagerService, {
        listPackages: ({ projectPath }) =>
          projectPath === PROJECT_PATH
            ? Effect.fail(
                new ExtensionDiscoveryError({
                  operation: 'list-packages',
                  cause: new Error('project extension root failed'),
                }),
              )
            : Effect.succeed([globalPackage]),
      }),
      Layer.succeed(ExtensionLifecycleRepository, {
        get: (key) =>
          Effect.succeed(
            key.extensionId === globalPackage.id ? makeLifecycle(globalPackage) : null,
          ),
        list: () => Effect.succeed([makeLifecycle(globalPackage)]),
        upsert: () => Effect.void,
      }),
      Layer.succeed(ExtensionProjectOverridesRepository, {
        get: () => Effect.succeed(null),
        upsert: () => Effect.void,
      }),
    )

    const registry = await Effect.runPromise(
      listExtensionContributionRegistryView({ projectPaths: [PROJECT_PATH] }).pipe(
        Effect.provide(layer),
      ),
    )

    expect(registry.entries.map((entry) => entry.contributionId)).toEqual(['global.run'])
  })

  it('skips only the package whose lifecycle state cannot be read', async () => {
    const goodPackage = makePackage({
      id: 'good-extension',
      name: 'Good Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      contributions: {
        commands: [{ id: 'good.run', title: 'Run Good' }],
      },
    })
    const brokenPackage = makePackage({
      id: 'broken-extension',
      name: 'Broken Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      contributions: {
        commands: [{ id: 'broken.run', title: 'Run Broken' }],
      },
    })
    const goodLifecycle = makeLifecycle(goodPackage)

    const layer = Layer.mergeAll(
      Layer.succeed(ExtensionManagerService, {
        listPackages: ({ projectPath }) =>
          Effect.succeed(projectPath === null ? [goodPackage, brokenPackage] : []),
      }),
      Layer.succeed(ExtensionLifecycleRepository, {
        get: (key) =>
          key.extensionId === brokenPackage.id
            ? Effect.fail(
                new ExtensionLifecycleRepositoryError({
                  operation: 'get',
                  cause: new Error('lifecycle read failed'),
                }),
              )
            : Effect.succeed(goodLifecycle),
        list: () => Effect.succeed([goodLifecycle]),
        upsert: () => Effect.void,
      }),
      Layer.succeed(ExtensionProjectOverridesRepository, {
        get: () => Effect.succeed(null),
        upsert: () => Effect.void,
      }),
    )

    const registry = await Effect.runPromise(
      listExtensionContributionRegistryView({ projectPaths: [PROJECT_PATH] }).pipe(
        Effect.provide(layer),
      ),
    )

    expect(registry.entries.map((entry) => entry.contributionId)).toEqual(['good.run'])
  })

  it('fails closed for the project whose override cannot be read while keeping eligible projects', async () => {
    const globalPackage = makePackage({
      id: 'global-extension',
      name: 'Global Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      contributions: {
        commands: [{ id: 'global.run', title: 'Run Global' }],
      },
    })
    const lifecycle = makeLifecycle(globalPackage)
    const layer = Layer.mergeAll(
      Layer.succeed(ExtensionManagerService, {
        listPackages: ({ projectPath }) =>
          Effect.succeed(projectPath === null ? [globalPackage] : []),
      }),
      Layer.succeed(ExtensionLifecycleRepository, {
        get: () => Effect.succeed(lifecycle),
        list: () => Effect.succeed([lifecycle]),
        upsert: () => Effect.void,
      }),
      Layer.succeed(ExtensionProjectOverridesRepository, {
        get: (key) =>
          key.projectPath === PROJECT_PATH
            ? Effect.fail(
                new ExtensionProjectOverrideRepositoryError({
                  operation: 'get',
                  cause: new Error('override read failed'),
                }),
              )
            : Effect.succeed(null),
        upsert: () => Effect.void,
      }),
    )

    const registry = await Effect.runPromise(
      listExtensionContributionRegistryView({
        projectPaths: [PROJECT_PATH, OTHER_PROJECT_PATH],
      }).pipe(Effect.provide(layer)),
    )

    const entry = expectFirstEntry(registry)
    expect(entry.projectPaths).toEqual([OTHER_PROJECT_PATH])
    expect(entry.eligibility.disabledProjectPaths).toEqual([PROJECT_PATH])
    expect(entry.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      OPENWAGGLE_EXTENSION.DIAGNOSTIC.CODE.PROJECT_OVERRIDE_UNAVAILABLE,
    ])
  })

  it('derives unregister behavior when a package is disabled or absent from discovery', async () => {
    const extensionPackage = makePackage({
      id: 'multi-extension',
      name: 'Multi Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      contributions: {
        commands: [{ id: 'multi.run', title: 'Run Multi' }],
        settingsSections: [
          {
            id: 'multi.settings',
            title: 'Multi Settings',
            lane: 'declarative',
            entry: 'dist/settings.js',
          },
        ],
      },
    })
    const enabledLifecycle = makeLifecycle(extensionPackage)
    const disabledLifecycle = {
      ...enabledLifecycle,
      enabled: false,
    } satisfies ExtensionLifecycleState

    const enabledRegistry = await loadRegistry({
      packages: [extensionPackage],
      lifecycles: [enabledLifecycle],
      projectPaths: [PROJECT_PATH],
    })
    const disabledRegistry = await loadRegistry({
      packages: [extensionPackage],
      lifecycles: [disabledLifecycle],
      projectPaths: [PROJECT_PATH],
    })
    const uninstalledRegistry = await loadRegistry({
      packages: [],
      lifecycles: [enabledLifecycle],
      projectPaths: [PROJECT_PATH],
    })

    expect(enabledRegistry.entries.map((entry) => entry.contributionId)).toEqual([
      'multi.run',
      'multi.settings',
    ])
    expect(disabledRegistry.entries).toEqual([])
    expect(uninstalledRegistry.entries).toEqual([])
  })
})

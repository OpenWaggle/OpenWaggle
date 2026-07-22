import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { beforeEach, describe, expect, it } from 'vitest'
import type {
  DiscoveredExtensionPackage,
  ExtensionLifecycleState,
  ExtensionProjectOverrideState,
} from '../../extensions/types'
import { ExtensionLifecycleRepository } from '../../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../../ports/extension-manager-service'
import { ExtensionProjectOverridesRepository } from '../../ports/extension-project-overrides-repository'
import {
  clearExtensionContributionRegistryCacheForTests,
  getExtensionContributionRegistryCacheStatsForTests,
} from '../extension-contribution-registry-cache'
import { listExtensionContributionRegistryView } from '../extension-contribution-registry-service'
import {
  reloadExtension,
  setExtensionEnabled,
  setExtensionProjectDisabled,
} from '../extension-lifecycle-service'
import {
  makeLifecycle,
  makePackage,
  PROJECT_PATH,
} from './extension-contribution-registry-test-utils'
import { TrustedMainActivationDependenciesTestLayer } from './extension-trusted-main-activation-test-layer'

const projectPackage = makePackage({
  id: 'teardown-cache-extension',
  name: 'Teardown Cache Extension',
  scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: PROJECT_PATH },
  contributions: {
    commands: [{ id: 'teardown-cache.run', title: 'Run Teardown Cache' }],
    settingsSections: [
      {
        id: 'teardown-cache.settings',
        title: 'Teardown Cache Settings',
        runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
        execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.FRAME,
        entry: 'dist/settings.js',
      },
    ],
  },
})

function makeCacheHarness(input: {
  readonly lifecycle: ExtensionLifecycleState
  readonly packages: readonly DiscoveredExtensionPackage[]
  readonly projectOverride?: ExtensionProjectOverrideState | null
}) {
  let storedLifecycle = input.lifecycle
  let storedPackages = input.packages
  let storedProjectOverride = input.projectOverride ?? null

  return {
    layer: Layer.mergeAll(
      Layer.succeed(ExtensionManagerService, {
        listPackages: () => Effect.sync(() => storedPackages),
      }),
      Layer.succeed(ExtensionLifecycleRepository, {
        get: () => Effect.sync(() => storedLifecycle),
        list: () => Effect.sync(() => [storedLifecycle]),
        upsert: (state) =>
          Effect.sync(() => {
            storedLifecycle = state
          }),
      }),
      Layer.succeed(ExtensionProjectOverridesRepository, {
        get: () => Effect.sync(() => storedProjectOverride),
        upsert: (state) =>
          Effect.sync(() => {
            storedProjectOverride = state
          }),
      }),
      TrustedMainActivationDependenciesTestLayer,
    ),
    setPackages: (packages: readonly DiscoveredExtensionPackage[]) => {
      storedPackages = packages
    },
  }
}

function contributionIds(registry: Awaited<ReturnType<typeof loadRegistry>>) {
  return registry.entries.map((entry) => entry.contributionId)
}

type CacheHarnessLayer = ReturnType<typeof makeCacheHarness>['layer']

async function loadRegistry(layer: CacheHarnessLayer) {
  return Effect.runPromise(
    listExtensionContributionRegistryView({ projectPaths: [PROJECT_PATH] }).pipe(
      Effect.provide(layer),
    ),
  )
}

describe('extension lifecycle teardown registration cache', () => {
  beforeEach(() => {
    clearExtensionContributionRegistryCacheForTests()
  })

  it('clears cached registrations on disable and creates fresh state after reload', async () => {
    const harness = makeCacheHarness({
      lifecycle: makeLifecycle(projectPackage),
      packages: [projectPackage],
    })

    expect(contributionIds(await loadRegistry(harness.layer))).toEqual([
      'teardown-cache.run',
      'teardown-cache.settings',
    ])
    expect(getExtensionContributionRegistryCacheStatsForTests()).toMatchObject({
      misses: 1,
      size: 1,
    })

    await Effect.runPromise(
      setExtensionEnabled({
        extensionId: projectPackage.id,
        scope: projectPackage.scope,
        enabled: false,
      }).pipe(Effect.provide(harness.layer)),
    )

    expect(getExtensionContributionRegistryCacheStatsForTests()).toMatchObject({
      invalidations: 1,
      size: 0,
    })
    expect((await loadRegistry(harness.layer)).entries).toEqual([])

    await Effect.runPromise(
      setExtensionEnabled({
        extensionId: projectPackage.id,
        scope: projectPackage.scope,
        enabled: true,
      }).pipe(Effect.provide(harness.layer)),
    )
    await Effect.runPromise(
      reloadExtension({
        extensionId: projectPackage.id,
        scope: projectPackage.scope,
      }).pipe(Effect.provide(harness.layer)),
    )

    const reloadedContributionIds = contributionIds(await loadRegistry(harness.layer))
    expect(reloadedContributionIds).toEqual(['teardown-cache.run', 'teardown-cache.settings'])
    expect(new Set(reloadedContributionIds).size).toBe(2)
    expect(getExtensionContributionRegistryCacheStatsForTests()).toMatchObject({
      misses: 2,
      size: 1,
    })
  })

  it('clears cached registrations when a project opts out of a global extension', async () => {
    const globalPackage = makePackage({
      id: 'global-teardown-cache-extension',
      name: 'Global Teardown Cache Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      contributions: {
        commands: [{ id: 'global-teardown-cache.run', title: 'Run Global Teardown Cache' }],
      },
    })
    const harness = makeCacheHarness({
      lifecycle: makeLifecycle(globalPackage),
      packages: [globalPackage],
    })

    expect(contributionIds(await loadRegistry(harness.layer))).toEqual([
      'global-teardown-cache.run',
    ])
    expect(getExtensionContributionRegistryCacheStatsForTests()).toMatchObject({
      misses: 1,
      size: 1,
    })

    await Effect.runPromise(
      setExtensionProjectDisabled({
        extensionId: globalPackage.id,
        scope: globalPackage.scope,
        projectPath: PROJECT_PATH,
        disabled: true,
      }).pipe(Effect.provide(harness.layer)),
    )

    expect((await loadRegistry(harness.layer)).entries).toEqual([])
    expect(getExtensionContributionRegistryCacheStatsForTests()).toMatchObject({
      invalidations: 1,
      size: 0,
    })

    await Effect.runPromise(
      setExtensionProjectDisabled({
        extensionId: globalPackage.id,
        scope: globalPackage.scope,
        projectPath: PROJECT_PATH,
        disabled: false,
      }).pipe(Effect.provide(harness.layer)),
    )

    expect(contributionIds(await loadRegistry(harness.layer))).toEqual([
      'global-teardown-cache.run',
    ])
    expect(getExtensionContributionRegistryCacheStatsForTests()).toMatchObject({
      misses: 2,
      size: 1,
    })
  })

  it('prunes cached registrations when a package disappears from discovery', async () => {
    const harness = makeCacheHarness({
      lifecycle: makeLifecycle(projectPackage),
      packages: [projectPackage],
    })

    expect(contributionIds(await loadRegistry(harness.layer))).toEqual([
      'teardown-cache.run',
      'teardown-cache.settings',
    ])
    expect(getExtensionContributionRegistryCacheStatsForTests()).toMatchObject({
      misses: 1,
      size: 1,
    })

    harness.setPackages([])

    expect((await loadRegistry(harness.layer)).entries).toEqual([])
    expect(getExtensionContributionRegistryCacheStatsForTests()).toMatchObject({
      invalidations: 1,
      size: 0,
    })
  })
})

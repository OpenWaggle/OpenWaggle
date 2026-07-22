import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { beforeEach, describe, expect, it } from 'vitest'
import { ExtensionDiscoveryError } from '../../errors'
import type { ExtensionLifecycleState } from '../../extensions/types'
import { ExtensionLifecycleRepository } from '../../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../../ports/extension-manager-service'
import { ExtensionProjectOverridesRepository } from '../../ports/extension-project-overrides-repository'
import { clearExtensionContributionRegistryCacheForTests } from '../extension-contribution-registry-cache'
import { listExtensionContributionRegistryView } from '../extension-contribution-registry-service'
import { setExtensionEnabled } from '../extension-lifecycle-service'
import { isExtensionRuntimeModuleAccessAllowed } from '../extension-runtime-module-access-service'
import { listRuntimeEnabledOpenWaggleExtensionPackagePaths } from '../extension-runtime-service'
import {
  makeLifecycle,
  makePackage,
  PROJECT_PATH,
} from './extension-contribution-registry-test-utils'
import { TrustedMainActivationDependenciesTestLayer } from './extension-trusted-main-activation-test-layer'

const extensionPackage = makePackage({
  id: 'teardown-extension',
  name: 'Teardown Extension',
  scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: PROJECT_PATH },
  contributions: {
    commands: [{ id: 'teardown.run', title: 'Run Teardown' }],
    settingsSections: [
      {
        id: 'teardown.settings',
        title: 'Teardown Settings',
        runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
        execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.FRAME,
        entry: 'dist/settings.js',
      },
    ],
  },
})

function makeTeardownHarness(lifecycle: ExtensionLifecycleState) {
  let storedLifecycle = lifecycle

  return {
    layer: Layer.mergeAll(
      Layer.succeed(ExtensionManagerService, {
        listPackages: () => Effect.succeed([extensionPackage]),
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
        get: () => Effect.succeed(null),
        upsert: () => Effect.void,
      }),
      TrustedMainActivationDependenciesTestLayer,
    ),
    getStoredLifecycle: () => storedLifecycle,
  }
}

describe('extension lifecycle teardown', () => {
  beforeEach(() => {
    clearExtensionContributionRegistryCacheForTests()
  })

  it('tears down reload state and runtime eligibility when disabling an extension', async () => {
    const harness = makeTeardownHarness({
      ...makeLifecycle(extensionPackage),
      reloadStatus: OPENWAGGLE_EXTENSION.RELOAD_STATUS.SUCCEEDED,
      lastReloadedAt: 3000,
    })

    const view = await Effect.runPromise(
      setExtensionEnabled({
        extensionId: extensionPackage.id,
        scope: extensionPackage.scope,
        enabled: false,
      }).pipe(Effect.provide(harness.layer)),
    )
    const enabledPackagePaths = await Effect.runPromise(
      listRuntimeEnabledOpenWaggleExtensionPackagePaths(PROJECT_PATH).pipe(
        Effect.provide(harness.layer),
      ),
    )

    expect(harness.getStoredLifecycle()).toMatchObject({
      extensionId: extensionPackage.id,
      enabled: false,
      trusted: true,
      reloadStatus: OPENWAGGLE_EXTENSION.RELOAD_STATUS.NOT_RELOADED,
      lastReloadedAt: null,
    })
    expect(view.packages[0]?.lifecycle).toMatchObject({
      enabled: false,
      trusted: true,
      reloadStatus: OPENWAGGLE_EXTENSION.RELOAD_STATUS.NOT_RELOADED,
      lastReloadedAt: null,
    })
    expect(enabledPackagePaths).toEqual([])
  })

  it('removes registered contributions and sandbox module access when disabling an extension', async () => {
    const harness = makeTeardownHarness({
      ...makeLifecycle(extensionPackage),
      reloadStatus: OPENWAGGLE_EXTENSION.RELOAD_STATUS.SUCCEEDED,
      lastReloadedAt: 3000,
    })

    const enabledRegistry = await Effect.runPromise(
      listExtensionContributionRegistryView({ projectPaths: [PROJECT_PATH] }).pipe(
        Effect.provide(harness.layer),
      ),
    )
    const enabledModuleAccess = await Effect.runPromise(
      isExtensionRuntimeModuleAccessAllowed({
        packagePath: extensionPackage.packagePath,
        contentHash: extensionPackage.contentHash ?? '',
        projectPaths: [PROJECT_PATH],
      }).pipe(Effect.provide(harness.layer)),
    )

    await Effect.runPromise(
      setExtensionEnabled({
        extensionId: extensionPackage.id,
        scope: extensionPackage.scope,
        enabled: false,
      }).pipe(Effect.provide(harness.layer)),
    )

    const disabledRegistry = await Effect.runPromise(
      listExtensionContributionRegistryView({ projectPaths: [PROJECT_PATH] }).pipe(
        Effect.provide(harness.layer),
      ),
    )
    const disabledModuleAccess = await Effect.runPromise(
      isExtensionRuntimeModuleAccessAllowed({
        packagePath: extensionPackage.packagePath,
        contentHash: extensionPackage.contentHash ?? '',
        projectPaths: [PROJECT_PATH],
      }).pipe(Effect.provide(harness.layer)),
    )

    expect(enabledRegistry.entries.map((entry) => entry.contributionId)).toEqual([
      'teardown.run',
      'teardown.settings',
    ])
    expect(enabledModuleAccess).toBe(true)
    expect(disabledRegistry.entries).toEqual([])
    expect(disabledModuleAccess).toBe(false)
  })

  it('excludes enabled-but-not-reloaded extensions from runtime startup', async () => {
    const harness = makeTeardownHarness({
      ...makeLifecycle(extensionPackage),
      reloadStatus: OPENWAGGLE_EXTENSION.RELOAD_STATUS.NOT_RELOADED,
      lastReloadedAt: null,
    })

    const registry = await Effect.runPromise(
      listExtensionContributionRegistryView({ projectPaths: [PROJECT_PATH] }).pipe(
        Effect.provide(harness.layer),
      ),
    )
    const enabledPackagePaths = await Effect.runPromise(
      listRuntimeEnabledOpenWaggleExtensionPackagePaths(PROJECT_PATH).pipe(
        Effect.provide(harness.layer),
      ),
    )

    expect(registry.entries).toEqual([])
    expect(enabledPackagePaths).toEqual([])
  })

  it('fails closed when extension discovery fails during runtime startup', async () => {
    const layer = Layer.mergeAll(
      Layer.succeed(ExtensionManagerService, {
        listPackages: () =>
          Effect.fail(
            new ExtensionDiscoveryError({
              operation: 'list-packages',
              cause: new Error('extension root unavailable'),
            }),
          ),
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
      TrustedMainActivationDependenciesTestLayer,
    )

    const enabledPackagePaths = await Effect.runPromise(
      listRuntimeEnabledOpenWaggleExtensionPackagePaths(PROJECT_PATH).pipe(Effect.provide(layer)),
    )

    expect(enabledPackagePaths).toEqual([])
  })
})

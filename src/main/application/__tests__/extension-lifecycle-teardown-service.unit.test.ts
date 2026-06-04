import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it } from 'vitest'
import type { ExtensionLifecycleState } from '../../extensions/types'
import { ExtensionLifecycleRepository } from '../../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../../ports/extension-manager-service'
import { ExtensionProjectOverridesRepository } from '../../ports/extension-project-overrides-repository'
import { setExtensionEnabled } from '../extension-lifecycle-service'
import { listRuntimeEnabledOpenWaggleExtensionPackagePaths } from '../extension-runtime-service'
import {
  makeLifecycle,
  makePackage,
  PROJECT_PATH,
} from './extension-contribution-registry-test-utils'

const extensionPackage = makePackage({
  id: 'teardown-extension',
  name: 'Teardown Extension',
  scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: PROJECT_PATH },
  contributions: {
    commands: [{ id: 'teardown.run', title: 'Run Teardown' }],
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
    ),
    getStoredLifecycle: () => storedLifecycle,
  }
}

describe('extension lifecycle teardown', () => {
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
})

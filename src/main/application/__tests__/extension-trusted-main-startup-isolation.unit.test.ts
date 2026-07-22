import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it } from 'vitest'
import type { TrustedMainExtensionModuleLoader } from '../../extensions/trusted-main-runtime'
import {
  activateTrustedMainExtensionsForActiveProjectSafely,
  activateTrustedMainExtensionsForProject,
  clearTrustedMainExtensionActivationsForTests,
} from '../extension-trusted-main-activation-service'
import {
  makeTrustedMainActivationHarness,
  makeTrustedMainLifecycle,
  makeTrustedMainPackage,
  TRUSTED_MAIN_TEST_PROJECT_PATH,
} from './extension-trusted-main-activation-test-utils'

describe('trusted main extension startup isolation', () => {
  beforeEach(() => {
    clearTrustedMainExtensionActivationsForTests()
  })

  it('disables a package whose trusted main module fails to load while activating viable packages', async () => {
    const failingPackage = makeTrustedMainPackage({ id: 'module-load-failing-extension' })
    const viablePackage = makeTrustedMainPackage({ id: 'module-load-viable-extension' })
    const activatedIds: string[] = []
    const loader: TrustedMainExtensionModuleLoader = async (extensionPackage) => {
      if (extensionPackage.id === 'module-load-failing-extension') {
        throw new Error('module import failed')
      }

      return {
        entryPath: `${extensionPackage.packagePath}/dist/main.mjs`,
        module: {
          activate: () => {
            activatedIds.push(extensionPackage.id)
            return undefined
          },
        },
      }
    }
    const harness = makeTrustedMainActivationHarness({
      packages: [failingPackage, viablePackage],
      lifecycles: [
        makeTrustedMainLifecycle(failingPackage),
        makeTrustedMainLifecycle(viablePackage),
      ],
    })

    const results = await Effect.runPromise(
      activateTrustedMainExtensionsForProject(TRUSTED_MAIN_TEST_PROJECT_PATH, {
        loadModule: loader,
        now: () => 6000,
      }).pipe(Effect.provide(harness.layer)),
    )

    expect(results).toEqual([
      {
        extensionId: 'module-load-failing-extension',
        status: 'failed',
        errorMessage: 'module import failed',
      },
      { extensionId: 'module-load-viable-extension', status: 'activated' },
    ])
    expect(activatedIds).toEqual(['module-load-viable-extension'])
    expect(harness.getLifecycle('module-load-failing-extension')).toMatchObject({
      enabled: false,
      reloadStatus: OPENWAGGLE_EXTENSION.RELOAD_STATUS.FAILED,
      lastReloadedAt: null,
      updatedAt: 6000,
      diagnostics: [{ code: OPENWAGGLE_EXTENSION.DIAGNOSTIC.CODE.RUNTIME_LOAD_FAILED }],
    })
    expect(harness.getLifecycle('module-load-viable-extension')).toMatchObject({
      enabled: true,
      reloadStatus: OPENWAGGLE_EXTENSION.RELOAD_STATUS.SUCCEEDED,
    })
  })

  it('keeps startup non-fatal when active-project trusted main activation cannot start', async () => {
    const harness = makeTrustedMainActivationHarness({
      packages: [],
      lifecycles: [],
      settingsGetFailure: new Error('settings unavailable'),
    })

    const results = await Effect.runPromise(
      activateTrustedMainExtensionsForActiveProjectSafely().pipe(Effect.provide(harness.layer)),
    )

    expect(results).toEqual([])
    expect(harness.capturedLogs()).toEqual([
      {
        namespace: 'extension-trusted-main',
        message: 'Skipped trusted main extension startup after activation failure',
      },
    ])
  })
})

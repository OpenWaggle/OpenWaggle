import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it } from 'vitest'
import { reloadExtension, setExtensionProjectDisabled } from '../extension-lifecycle-service'
import { clearTrustedMainExtensionActivationsForTests } from '../extension-trusted-main-activation-service'
import {
  makeTrustedMainActivationHarness,
  makeTrustedMainLifecycle,
  makeTrustedMainPackage,
  TRUSTED_MAIN_TEST_PROJECT_PATH,
} from './extension-trusted-main-activation-test-utils'

describe('extension lifecycle safe startup isolation', () => {
  beforeEach(() => {
    clearTrustedMainExtensionActivationsForTests()
  })

  it('keeps reload state when active-project trusted main activation cannot start', async () => {
    const extensionPackage = makeTrustedMainPackage({ id: 'reload-safe-start-extension' })
    const harness = makeTrustedMainActivationHarness({
      packages: [extensionPackage],
      lifecycles: [
        {
          ...makeTrustedMainLifecycle(extensionPackage),
          reloadStatus: OPENWAGGLE_EXTENSION.RELOAD_STATUS.NOT_RELOADED,
          lastReloadedAt: null,
        },
      ],
      settingsGetFailure: new Error('settings unavailable'),
    })

    const view = await Effect.runPromise(
      reloadExtension({
        extensionId: extensionPackage.id,
        scope: extensionPackage.scope,
      }).pipe(Effect.provide(harness.layer)),
    )

    expect(harness.getLifecycle(extensionPackage.id)).toMatchObject({
      extensionId: extensionPackage.id,
      enabled: true,
      reloadStatus: OPENWAGGLE_EXTENSION.RELOAD_STATUS.SUCCEEDED,
    })
    expect(harness.getLifecycle(extensionPackage.id)?.lastReloadedAt).toEqual(expect.any(Number))
    expect(view.packages[0]?.lifecycle).toMatchObject({
      enabled: true,
      reloadStatus: OPENWAGGLE_EXTENSION.RELOAD_STATUS.SUCCEEDED,
    })
    expect(harness.capturedLogs()).toEqual([
      {
        namespace: 'extension-trusted-main',
        message: 'Skipped trusted main extension startup after activation failure',
      },
    ])
  })

  it('persists project opt-outs when trusted main reconciliation cannot start', async () => {
    const extensionPackage = makeTrustedMainPackage({
      id: 'project-opt-out-safe-start-extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
    })
    const harness = makeTrustedMainActivationHarness({
      packages: [extensionPackage],
      lifecycles: [makeTrustedMainLifecycle(extensionPackage)],
      settingsGetFailure: new Error('settings unavailable'),
    })

    const view = await Effect.runPromise(
      setExtensionProjectDisabled({
        extensionId: extensionPackage.id,
        scope: extensionPackage.scope,
        projectPath: TRUSTED_MAIN_TEST_PROJECT_PATH,
        disabled: true,
      }).pipe(Effect.provide(harness.layer)),
    )

    expect(
      harness.getProjectOverride({
        extensionId: extensionPackage.id,
        scope: extensionPackage.scope,
        projectPath: TRUSTED_MAIN_TEST_PROJECT_PATH,
      }),
    ).toMatchObject({
      disabled: true,
    })
    expect(view.packages[0]?.projectOverride).toMatchObject({
      projectPath: TRUSTED_MAIN_TEST_PROJECT_PATH,
      disabled: true,
    })
    expect(harness.capturedLogs()).toEqual([
      {
        namespace: 'extension-trusted-main',
        message: 'Skipped trusted main extension startup after activation failure',
      },
    ])
  })
})

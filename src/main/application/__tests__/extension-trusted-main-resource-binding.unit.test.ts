import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it } from 'vitest'
import type { TrustedMainExtensionModuleLoader } from '../../extensions/trusted-main-runtime'
import {
  activateTrustedMainExtensionsForProject,
  clearTrustedMainExtensionActivationsForTests,
} from '../extension-trusted-main-activation-service'
import {
  makeTrustedMainActivationHarness,
  makeTrustedMainLifecycle,
  makeTrustedMainPackage,
  TRUSTED_MAIN_TEST_PROJECT_PATH,
} from './extension-trusted-main-activation-test-utils'

describe('trusted-main resource Session binding', () => {
  beforeEach(() => {
    clearTrustedMainExtensionActivationsForTests()
  })

  it('rejects Session resource access through the unmounted trusted-main transport', async () => {
    const extensionPackage = makeTrustedMainPackage({
      id: 'trusted-main-resources-extension',
      capabilities: [
        {
          id: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RESOURCES,
          methods: [OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST_RESOURCES],
          scopes: ['session'],
        },
      ],
    })
    let failureCode = ''
    const loader: TrustedMainExtensionModuleLoader = async (loadedPackage) => ({
      entryPath: `${loadedPackage.packagePath}/dist/main.mjs`,
      module: {
        activate: async (context) => {
          const result = await context.sdk.openWaggle.resources.list({
            kind: 'session',
            projectPath: TRUSTED_MAIN_TEST_PROJECT_PATH,
            sessionId: SessionId('trusted-main-session'),
          })
          if (!result.ok) {
            failureCode = result.error.code
          }
          return undefined
        },
      },
    })
    const harness = makeTrustedMainActivationHarness({
      packages: [extensionPackage],
      lifecycles: [makeTrustedMainLifecycle(extensionPackage)],
    })

    await Effect.runPromise(
      activateTrustedMainExtensionsForProject(TRUSTED_MAIN_TEST_PROJECT_PATH, {
        loadModule: loader,
      }).pipe(Effect.provide(harness.layer)),
    )

    expect(failureCode).toBe(OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.OUT_OF_SCOPE)
  })
})

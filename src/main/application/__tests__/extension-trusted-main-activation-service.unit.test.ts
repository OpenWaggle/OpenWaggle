import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TRUSTED_MAIN_CONTRIBUTION_ID,
  type TrustedMainExtensionModuleLoader,
} from '../../extensions/trusted-main-runtime'
import {
  activateTrustedMainExtensionsForProject,
  clearTrustedMainExtensionActivationsForTests,
  getTrustedMainExtensionActivationCountForTests,
  reconcileTrustedMainExtensionsForProject,
} from '../extension-trusted-main-activation-service'
import {
  makeTrustedMainActivationHarness,
  makeTrustedMainLifecycle,
  makeTrustedMainPackage,
  TRUSTED_MAIN_TEST_PROJECT_PATH,
} from './extension-trusted-main-activation-test-utils'

describe('trusted main extension activation', () => {
  const OTHER_PROJECT_PATH = '/tmp/other-project'

  beforeEach(() => {
    clearTrustedMainExtensionActivationsForTests()
  })

  it('activates only trusted, enabled, reloaded packages with the trusted-main grant', async () => {
    const eligiblePackage = makeTrustedMainPackage({ id: 'eligible-extension' })
    const missingGrantPackage = makeTrustedMainPackage({ id: 'missing-grant-extension' })
    const disabledPackage = makeTrustedMainPackage({ id: 'disabled-extension' })
    const activatedIds: string[] = []
    const loader = vi.fn<TrustedMainExtensionModuleLoader>(async (extensionPackage) => ({
      entryPath: `${extensionPackage.packagePath}/dist/main.mjs`,
      module: {
        activate: () => {
          activatedIds.push(extensionPackage.id)
          return undefined
        },
      },
    }))
    const harness = makeTrustedMainActivationHarness({
      packages: [eligiblePackage, missingGrantPackage, disabledPackage],
      lifecycles: [
        makeTrustedMainLifecycle(eligiblePackage),
        makeTrustedMainLifecycle(missingGrantPackage, { grantedCapabilities: [] }),
        makeTrustedMainLifecycle(disabledPackage, { enabled: false }),
      ],
    })

    const results = await Effect.runPromise(
      activateTrustedMainExtensionsForProject(TRUSTED_MAIN_TEST_PROJECT_PATH, {
        loadModule: loader,
      }).pipe(Effect.provide(harness.layer)),
    )

    expect(results).toEqual([{ extensionId: 'eligible-extension', status: 'activated' }])
    expect(activatedIds).toEqual(['eligible-extension'])
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('routes trusted main SDK calls through the broker virtual contribution identity', async () => {
    const extensionPackage = makeTrustedMainPackage({
      id: 'sdk-extension',
      capabilities: [
        {
          id: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
          methods: [OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE],
          scopes: ['project'],
        },
      ],
    })
    let brokerSucceeded = false
    let brokerContributionId = ''
    const loader: TrustedMainExtensionModuleLoader = async (loadedPackage) => ({
      entryPath: `${loadedPackage.packagePath}/dist/main.mjs`,
      module: {
        activate: async (context) => {
          const result = await context.sdk.hostContext.getScope({
            kind: 'project',
            projectPath: TRUSTED_MAIN_TEST_PROJECT_PATH,
          })
          if (result.ok) {
            brokerSucceeded = true
            brokerContributionId = result.audit.contributionId
          }
          return undefined
        },
      },
    })
    const harness = makeTrustedMainActivationHarness({
      packages: [extensionPackage],
      lifecycles: [makeTrustedMainLifecycle(extensionPackage)],
    })

    const results = await Effect.runPromise(
      activateTrustedMainExtensionsForProject(TRUSTED_MAIN_TEST_PROJECT_PATH, {
        loadModule: loader,
      }).pipe(Effect.provide(harness.layer)),
    )

    expect(results).toEqual([{ extensionId: 'sdk-extension', status: 'activated' }])
    expect(brokerSucceeded).toBe(true)
    expect(brokerContributionId).toBe(TRUSTED_MAIN_CONTRIBUTION_ID)
  })

  it('keeps trusted main SDK calls inside declared broker capabilities', async () => {
    const extensionPackage = makeTrustedMainPackage({ id: 'undeclared-extension' })
    let failureCode = ''
    const loader: TrustedMainExtensionModuleLoader = async (loadedPackage) => ({
      entryPath: `${loadedPackage.packagePath}/dist/main.mjs`,
      module: {
        activate: async (context) => {
          const result = await context.sdk.invoke({
            capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
            method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET,
            scope: { kind: 'project', projectPath: TRUSTED_MAIN_TEST_PROJECT_PATH },
            payload: {},
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

    expect(failureCode).toBe(OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.UNDECLARED_CAPABILITY)
  })

  it('disables a failing trusted main package while continuing to activate viable packages', async () => {
    const failingPackage = makeTrustedMainPackage({ id: 'failing-extension' })
    const viablePackage = makeTrustedMainPackage({ id: 'viable-extension' })
    const activatedIds: string[] = []
    const loader: TrustedMainExtensionModuleLoader = async (extensionPackage) => ({
      entryPath: `${extensionPackage.packagePath}/dist/main.mjs`,
      module: {
        activate: () => {
          if (extensionPackage.id === 'failing-extension') {
            throw new Error('activation failed')
          }
          activatedIds.push(extensionPackage.id)
          return undefined
        },
      },
    })
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
        now: () => 5000,
      }).pipe(Effect.provide(harness.layer)),
    )

    expect(results).toEqual([
      { extensionId: 'failing-extension', status: 'failed', errorMessage: 'activation failed' },
      { extensionId: 'viable-extension', status: 'activated' },
    ])
    expect(activatedIds).toEqual(['viable-extension'])
    expect(harness.getLifecycle('failing-extension')).toMatchObject({
      enabled: false,
      reloadStatus: OPENWAGGLE_EXTENSION.RELOAD_STATUS.FAILED,
      lastReloadedAt: null,
      updatedAt: 5000,
      diagnostics: [{ code: OPENWAGGLE_EXTENSION.DIAGNOSTIC.CODE.RUNTIME_LOAD_FAILED }],
    })
    expect(harness.getLifecycle('viable-extension')).toMatchObject({
      enabled: true,
      reloadStatus: OPENWAGGLE_EXTENSION.RELOAD_STATUS.SUCCEEDED,
    })
  })

  it('reconciles active trusted main packages when the active project changes', async () => {
    const firstProjectPath = '/tmp/first-project'
    const secondProjectPath = '/tmp/second-project'
    const firstProjectPackage = makeTrustedMainPackage({
      id: 'first-project-extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: firstProjectPath },
    })
    const secondProjectPackage = makeTrustedMainPackage({
      id: 'second-project-extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: secondProjectPath },
    })
    const activatedIds: string[] = []
    const cleanedUpIds: string[] = []
    const loader: TrustedMainExtensionModuleLoader = async (extensionPackage) => ({
      entryPath: `${extensionPackage.packagePath}/dist/main.mjs`,
      module: {
        activate: () => {
          activatedIds.push(extensionPackage.id)
          return () => {
            cleanedUpIds.push(extensionPackage.id)
          }
        },
      },
    })
    const harness = makeTrustedMainActivationHarness({
      packages: [firstProjectPackage, secondProjectPackage],
      lifecycles: [
        makeTrustedMainLifecycle(firstProjectPackage),
        makeTrustedMainLifecycle(secondProjectPackage),
      ],
    })

    await Effect.runPromise(
      activateTrustedMainExtensionsForProject(firstProjectPath, {
        loadModule: loader,
      }).pipe(Effect.provide(harness.layer)),
    )
    const results = await Effect.runPromise(
      reconcileTrustedMainExtensionsForProject(secondProjectPath, {
        loadModule: loader,
      }).pipe(Effect.provide(harness.layer)),
    )

    expect(results).toEqual([{ extensionId: 'second-project-extension', status: 'activated' }])
    expect(activatedIds).toEqual(['first-project-extension', 'second-project-extension'])
    expect(cleanedUpIds).toEqual(['first-project-extension'])
    expect(getTrustedMainExtensionActivationCountForTests()).toBe(1)
  })

  it('keeps global activations project-specific when another project has opted out', async () => {
    const globalPackage = makeTrustedMainPackage({
      id: 'global-extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
    })
    const activatedIds: string[] = []
    const cleanedUpIds: string[] = []
    const loader: TrustedMainExtensionModuleLoader = async (extensionPackage) => ({
      entryPath: `${extensionPackage.packagePath}/dist/main.mjs`,
      module: {
        activate: () => {
          activatedIds.push(extensionPackage.id)
          return () => {
            cleanedUpIds.push(extensionPackage.id)
          }
        },
      },
    })
    const harness = makeTrustedMainActivationHarness({
      packages: [globalPackage],
      lifecycles: [makeTrustedMainLifecycle(globalPackage)],
      projectOverrides: [
        {
          extensionId: globalPackage.id,
          scope: globalPackage.scope,
          projectPath: OTHER_PROJECT_PATH,
          disabled: true,
          createdAt: 1000,
          updatedAt: 2000,
        },
      ],
    })

    const activeProjectResults = await Effect.runPromise(
      activateTrustedMainExtensionsForProject(TRUSTED_MAIN_TEST_PROJECT_PATH, {
        loadModule: loader,
      }).pipe(Effect.provide(harness.layer)),
    )
    const optedOutProjectResults = await Effect.runPromise(
      reconcileTrustedMainExtensionsForProject(OTHER_PROJECT_PATH, {
        loadModule: loader,
      }).pipe(Effect.provide(harness.layer)),
    )

    expect(activeProjectResults).toEqual([{ extensionId: 'global-extension', status: 'activated' }])
    expect(optedOutProjectResults).toEqual([])
    expect(activatedIds).toEqual(['global-extension'])
    expect(cleanedUpIds).toEqual(['global-extension'])
    expect(getTrustedMainExtensionActivationCountForTests()).toBe(0)
  })
})

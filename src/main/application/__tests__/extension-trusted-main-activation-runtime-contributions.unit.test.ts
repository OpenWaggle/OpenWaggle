import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it } from 'vitest'
import type { TrustedMainExtensionModuleLoader } from '../../extensions/trusted-main-runtime'
import {
  clearExtensionContributionRegistryCacheForTests,
  registerRuntimePackageContribution,
} from '../extension-contribution-registry-cache'
import {
  activateTrustedMainExtensionsForProject,
  clearTrustedMainExtensionActivationsForTests,
  reconcileTrustedMainExtensionsForProject,
} from '../extension-trusted-main-activation-service'
import { loadRegistry } from './extension-contribution-registry-test-utils'
import {
  makeTrustedMainActivationHarness,
  makeTrustedMainLifecycle,
  makeTrustedMainPackage,
} from './extension-trusted-main-activation-test-utils'

const RUNTIME_TOOL_CONTRIBUTION_ID = 'runtime.tool'

function runtimeToolRegistration(targetProjectPath: string) {
  return {
    family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.TOOL_RENDERERS,
    contribution: {
      id: RUNTIME_TOOL_CONTRIBUTION_ID,
      title: 'Runtime Tool Renderer',
      runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
      execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
      entry: 'dist/runtime-tool.js',
      target: { projectPaths: [targetProjectPath] },
    },
  } as const
}

describe('trusted main activation runtime contributions', () => {
  beforeEach(() => {
    clearTrustedMainExtensionActivationsForTests()
    clearExtensionContributionRegistryCacheForTests()
  })

  it('clears dynamic registrations when a stale project activation is deactivated', async () => {
    const firstProjectPath = '/tmp/first-project'
    const secondProjectPath = '/tmp/second-project'
    const firstProjectPackage = makeTrustedMainPackage({
      id: 'first-project-extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: firstProjectPath },
      contributions: { toolRenderers: [] },
    })
    const secondProjectPackage = makeTrustedMainPackage({
      id: 'second-project-extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: secondProjectPath },
    })
    const firstProjectLifecycle = makeTrustedMainLifecycle(firstProjectPackage)
    const secondProjectLifecycle = makeTrustedMainLifecycle(secondProjectPackage)
    const cleanedUpIds: string[] = []
    const loader: TrustedMainExtensionModuleLoader = async (extensionPackage) => ({
      entryPath: `${extensionPackage.packagePath}/dist/main.mjs`,
      module: {
        activate: () => () => {
          cleanedUpIds.push(extensionPackage.id)
        },
      },
    })
    const packages = [firstProjectPackage, secondProjectPackage]
    const lifecycles = [firstProjectLifecycle, secondProjectLifecycle]
    const harness = makeTrustedMainActivationHarness({ packages, lifecycles })

    await Effect.runPromise(
      activateTrustedMainExtensionsForProject(firstProjectPath, { loadModule: loader }).pipe(
        Effect.provide(harness.layer),
      ),
    )
    registerRuntimePackageContribution({
      extensionPackage: firstProjectPackage,
      registration: runtimeToolRegistration(firstProjectPath),
    })
    const activeProjectRegistry = await loadRegistry({
      packages,
      lifecycles,
      projectPaths: [firstProjectPath],
    })
    expect(activeProjectRegistry.entries.map((entry) => entry.contributionId)).toEqual([
      RUNTIME_TOOL_CONTRIBUTION_ID,
    ])

    await Effect.runPromise(
      reconcileTrustedMainExtensionsForProject(secondProjectPath, { loadModule: loader }).pipe(
        Effect.provide(harness.layer),
      ),
    )
    const staleProjectRegistry = await loadRegistry({
      packages,
      lifecycles,
      projectPaths: [firstProjectPath],
    })

    expect(cleanedUpIds).toEqual(['first-project-extension'])
    expect(staleProjectRegistry.entries).toEqual([])
  })

  it('clears dynamic registrations when activation fails after registering them', async () => {
    const projectPath = '/tmp/project'
    const extensionPackage = makeTrustedMainPackage({
      id: 'failing-extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath },
      contributions: { toolRenderers: [] },
    })
    const lifecycle = makeTrustedMainLifecycle(extensionPackage)
    const loader: TrustedMainExtensionModuleLoader = async () => ({
      entryPath: `${extensionPackage.packagePath}/dist/main.mjs`,
      module: {
        activate: () => {
          registerRuntimePackageContribution({
            extensionPackage,
            registration: runtimeToolRegistration(projectPath),
          })
          throw new Error('activation failed')
        },
      },
    })
    const harness = makeTrustedMainActivationHarness({
      packages: [extensionPackage],
      lifecycles: [lifecycle],
    })

    const results = await Effect.runPromise(
      activateTrustedMainExtensionsForProject(projectPath, {
        loadModule: loader,
        now: () => 5000,
      }).pipe(Effect.provide(harness.layer)),
    )
    const registry = await loadRegistry({
      packages: [extensionPackage],
      lifecycles: [lifecycle],
      projectPaths: [projectPath],
    })

    expect(results).toEqual([
      { extensionId: 'failing-extension', status: 'failed', errorMessage: 'activation failed' },
    ])
    expect(registry.entries).toEqual([])
  })
})

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TrustedMainActivationDependenciesTestLayer } from '../../application/__tests__/extension-trusted-main-activation-test-layer'
import { getExtensionPackageRemoveProposalHash } from '../../application/extension-package-workflow-model'
import type { DiscoveredExtensionPackage, ExtensionLifecycleState } from '../../extensions/types'
import { ExtensionLifecycleRepository } from '../../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../../ports/extension-manager-service'
import { ExtensionPackageRepository } from '../../ports/extension-package-repository'
import { ExtensionProjectOverridesRepository } from '../../ports/extension-project-overrides-repository'

const { typedHandleMock, listPackagesMock, removePackageMock, deleteLifecycleMock } = vi.hoisted(
  () => ({
    typedHandleMock: vi.fn(),
    listPackagesMock: vi.fn(),
    removePackageMock: vi.fn(),
    deleteLifecycleMock: vi.fn(),
  }),
)

vi.mock('../typed-ipc', () => ({
  typedHandle: typedHandleMock,
}))

import { registerExtensionsHandlers } from '../extensions-handler'

function makeDiscoveredPackage(projectPath: string): DiscoveredExtensionPackage {
  return {
    id: 'sample-extension',
    scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath },
    packagePath: `${projectPath}/.openwaggle/extensions/sample-extension`,
    manifestPath: `${projectPath}/.openwaggle/extensions/sample-extension/openwaggle.extension.json`,
    manifest: {
      manifestVersion: 1,
      id: 'sample-extension',
      name: 'Sample Extension',
      version: '1.0.0',
      sdk: { openwaggle: '>=0.1.0 <0.2.0' },
      sourceFiles: ['src/index.ts'],
      builtArtifacts: ['dist/index.js'],
      capabilities: [{ id: 'sample.invoke' }],
    },
    buildPlan: null,
    contentHash: 'abcdef',
    sdkCompatibility: {
      hostVersion: OPENWAGGLE_EXTENSION.SDK_VERSION,
      requiredRange: '>=0.1.0 <0.2.0',
      compatible: true,
    },
    diagnostics: [],
  }
}

function makeLifecycleState(extensionPackage: DiscoveredExtensionPackage): ExtensionLifecycleState {
  return {
    extensionId: extensionPackage.id,
    scope: extensionPackage.scope,
    enabled: true,
    trusted: true,
    grantedCapabilities: ['sample.invoke'],
    contentHash: 'abcdef',
    packageVersion: '1.0.0',
    approvedBuildPlanHash: null,
    buildStatus: OPENWAGGLE_EXTENSION.BUILD_RUN_STATUS.NOT_RUN,
    buildLog: null,
    reloadStatus: OPENWAGGLE_EXTENSION.RELOAD_STATUS.SUCCEEDED,
    lastReloadedAt: 1000,
    sdkRange: '>=0.1.0 <0.2.0',
    sdkCompatible: true,
    diagnostics: [],
    installedAt: 1000,
    updatedAt: 2000,
  }
}

function makeTestLayer(extensionPackage: DiscoveredExtensionPackage) {
  let packages: readonly DiscoveredExtensionPackage[] = [extensionPackage]
  let lifecycle: ExtensionLifecycleState | null = makeLifecycleState(extensionPackage)
  return Layer.mergeAll(
    Layer.succeed(ExtensionManagerService, {
      listPackages: (input) =>
        Effect.sync(() => {
          listPackagesMock(input)
          return packages
        }),
    }),
    Layer.succeed(ExtensionLifecycleRepository, {
      get: () => Effect.sync(() => lifecycle),
      list: () => Effect.sync(() => (lifecycle ? [lifecycle] : [])),
      upsert: () => Effect.void,
      delete: (key) =>
        Effect.sync(() => {
          lifecycle = null
          deleteLifecycleMock(key)
        }),
    }),
    Layer.succeed(ExtensionProjectOverridesRepository, {
      get: () => Effect.succeed(null),
      upsert: () => Effect.void,
    }),
    Layer.succeed(ExtensionPackageRepository, {
      writePackage: (input) =>
        Effect.succeed({
          packagePath: '/tmp/package',
          manifestPath: '/tmp/package/openwaggle.extension.json',
          mode: input.mode,
        }),
      removePackage: (input) =>
        Effect.sync(() => {
          removePackageMock(input)
          packages = []
          return { packagePath: extensionPackage.packagePath, removed: true }
        }),
    }),
    TrustedMainActivationDependenciesTestLayer,
  )
}

function getRegisteredHandler(name: string, layer: ReturnType<typeof makeTestLayer>) {
  const call = typedHandleMock.mock.calls.find(
    (candidate: readonly unknown[]) => candidate[0] === name && typeof candidate[1] === 'function',
  )
  const handler = call?.[1]
  if (typeof handler !== 'function') {
    return undefined
  }
  return (...args: unknown[]) => Effect.runPromise(Effect.provide(handler(...args), layer))
}

describe('registerExtensionsHandlers remove workflow', () => {
  beforeEach(() => {
    typedHandleMock.mockReset()
    listPackagesMock.mockReset()
    removePackageMock.mockReset()
    deleteLifecycleMock.mockReset()
  })

  it('registers extensions:propose-package-remove and returns an approval hash', async () => {
    const extensionPackage = makeDiscoveredPackage('/tmp/project')
    const layer = makeTestLayer(extensionPackage)
    registerExtensionsHandlers()
    const handler = getRegisteredHandler('extensions:propose-package-remove', layer)

    const proposal = await handler?.(
      {},
      {
        extensionId: 'sample-extension',
        scope: { kind: 'global' },
        actor: { kind: 'user', userId: 'settings' },
      },
    )

    expect(proposal).toMatchObject({
      extensionId: 'sample-extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      operation: 'remove',
      proposalHash: getExtensionPackageRemoveProposalHash({
        extensionId: 'sample-extension',
        scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      }),
      requiresGlobalConfirmation: true,
    })
    expect(removePackageMock).not.toHaveBeenCalled()
  })

  it('registers extensions:apply-package-remove and tears down approved package state', async () => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-ipc-remove-'))
    const realProjectPath = await fs.realpath(projectPath)
    const extensionPackage = makeDiscoveredPackage(realProjectPath)
    const layer = makeTestLayer(extensionPackage)
    const scope = { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: realProjectPath }
    const proposalHash = getExtensionPackageRemoveProposalHash({
      extensionId: extensionPackage.id,
      scope,
    })
    registerExtensionsHandlers()
    const handler = getRegisteredHandler('extensions:apply-package-remove', layer)

    try {
      await handler?.(
        {},
        {
          extensionId: extensionPackage.id,
          scope,
          viewProjectPaths: [projectPath],
          actor: { kind: 'user', userId: 'settings' },
          userApproval: {
            approved: true,
            approvedProposalHash: proposalHash,
            approvedBy: 'settings',
            approvedAt: 1000,
          },
        },
      )

      expect(removePackageMock).toHaveBeenCalledWith({ extensionId: extensionPackage.id, scope })
      expect(deleteLifecycleMock).toHaveBeenCalledWith({ extensionId: extensionPackage.id, scope })
      expect(listPackagesMock).toHaveBeenCalledWith({ projectPath: realProjectPath })
    } finally {
      await fs.rm(projectPath, { recursive: true, force: true })
    }
  })
})

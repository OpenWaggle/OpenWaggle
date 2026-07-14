import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TrustedMainActivationDependenciesTestLayer } from '../../application/__tests__/extension-trusted-main-activation-test-layer'
import type { DiscoveredExtensionPackage, ExtensionLifecycleState } from '../../extensions/types'
import { ExtensionLifecycleRepository } from '../../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../../ports/extension-manager-service'
import { ExtensionPackageRepository } from '../../ports/extension-package-repository'
import { ExtensionProjectOverridesRepository } from '../../ports/extension-project-overrides-repository'

const { typedHandleMock, listPackagesMock, upsertLifecycleMock } = vi.hoisted(() => ({
  typedHandleMock: vi.fn(),
  listPackagesMock: vi.fn(),
  upsertLifecycleMock: vi.fn(),
}))

vi.mock('../typed-ipc', () => ({
  typedHandle: typedHandleMock,
}))

import { registerExtensionsHandlers } from '../extensions-handler'

const discoveredPackage: DiscoveredExtensionPackage = {
  id: 'sample-extension',
  scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
  packagePath: '/tmp/user-data/extensions/sample-extension',
  manifestPath: '/tmp/user-data/extensions/sample-extension/openwaggle.extension.json',
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

const trustedLifecycleState: ExtensionLifecycleState = {
  extensionId: 'sample-extension',
  scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
  enabled: false,
  trusted: true,
  grantedCapabilities: ['sample.invoke'],
  contentHash: 'abcdef',
  packageVersion: '1.0.0',
  approvedBuildPlanHash: null,
  buildStatus: OPENWAGGLE_EXTENSION.BUILD_RUN_STATUS.NOT_RUN,
  buildLog: null,
  reloadStatus: OPENWAGGLE_EXTENSION.RELOAD_STATUS.NOT_RELOADED,
  lastReloadedAt: null,
  sdkRange: '>=0.1.0 <0.2.0',
  sdkCompatible: true,
  diagnostics: [],
  installedAt: 1000,
  updatedAt: 2000,
}

function makeTestLayer(lifecycle: ExtensionLifecycleState | null = null) {
  let storedLifecycle = lifecycle
  return Layer.mergeAll(
    Layer.succeed(ExtensionManagerService, {
      listPackages: (input) => Effect.sync(() => listPackagesMock(input)),
    }),
    Layer.succeed(ExtensionLifecycleRepository, {
      get: () => Effect.sync(() => storedLifecycle),
      list: () => Effect.sync(() => (storedLifecycle ? [storedLifecycle] : [])),
      upsert: (state) =>
        Effect.sync(() => {
          storedLifecycle = state
          upsertLifecycleMock(state)
        }),
      delete: () => Effect.void,
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
      removePackage: () => Effect.succeed({ packagePath: '/tmp/package', removed: false }),
    }),
    TrustedMainActivationDependenciesTestLayer,
  )
}

function getRegisteredHandler(name: string, layer = makeTestLayer()) {
  const call = typedHandleMock.mock.calls.find(
    (candidate: readonly unknown[]) => candidate[0] === name && typeof candidate[1] === 'function',
  )
  const handler = call?.[1]
  if (typeof handler !== 'function') {
    return undefined
  }
  return (...args: unknown[]) => Effect.runPromise(Effect.provide(handler(...args), layer))
}

describe('registerExtensionsHandlers lifecycle mutations', () => {
  beforeEach(() => {
    typedHandleMock.mockReset()
    listPackagesMock.mockReset()
    upsertLifecycleMock.mockReset()
    listPackagesMock.mockReturnValue([discoveredPackage])
  })

  it('registers extensions:set-trusted and persists trusted lifecycle state', async () => {
    const layer = makeTestLayer()
    registerExtensionsHandlers()
    const handler = getRegisteredHandler('extensions:set-trusted', layer)

    await handler?.(
      {},
      { extensionId: 'sample-extension', scope: { kind: 'global' }, trusted: true },
    )

    expect(upsertLifecycleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        extensionId: 'sample-extension',
        trusted: true,
        enabled: false,
        contentHash: 'abcdef',
      }),
    )
  })

  it('registers extensions:set-enabled and persists enabled lifecycle state', async () => {
    const layer = makeTestLayer(trustedLifecycleState)
    registerExtensionsHandlers()
    const handler = getRegisteredHandler('extensions:set-enabled', layer)

    await handler?.(
      {},
      { extensionId: 'sample-extension', scope: { kind: 'global' }, enabled: true },
    )

    expect(upsertLifecycleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        extensionId: 'sample-extension',
        trusted: true,
        enabled: true,
        contentHash: 'abcdef',
      }),
    )
  })

  it('registers extensions:reload and persists reload lifecycle state', async () => {
    const layer = makeTestLayer({ ...trustedLifecycleState, enabled: true })
    registerExtensionsHandlers()
    const handler = getRegisteredHandler('extensions:reload', layer)

    await handler?.({}, { extensionId: 'sample-extension', scope: { kind: 'global' } })

    expect(upsertLifecycleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        extensionId: 'sample-extension',
        trusted: true,
        enabled: true,
        reloadStatus: OPENWAGGLE_EXTENSION.RELOAD_STATUS.SUCCEEDED,
        lastReloadedAt: expect.any(Number),
      }),
    )
  })

  it('registers extensions:accept-update and persists the approved package pin', async () => {
    const updatedPackage: DiscoveredExtensionPackage = {
      ...discoveredPackage,
      manifest: discoveredPackage.manifest
        ? { ...discoveredPackage.manifest, version: '1.1.0' }
        : null,
      contentHash: 'changed-hash',
    }
    listPackagesMock.mockReturnValue([updatedPackage])
    const layer = makeTestLayer({
      ...trustedLifecycleState,
      enabled: true,
      contentHash: 'abcdef',
      packageVersion: '1.0.0',
    })
    registerExtensionsHandlers()
    const handler = getRegisteredHandler('extensions:accept-update', layer)

    await handler?.({}, { extensionId: 'sample-extension', scope: { kind: 'global' } })

    expect(upsertLifecycleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        extensionId: 'sample-extension',
        trusted: true,
        enabled: false,
        contentHash: 'changed-hash',
        packageVersion: '1.1.0',
      }),
    )
  })

  it('rejects malformed lifecycle mutation payloads before discovery', async () => {
    registerExtensionsHandlers()
    const handler = getRegisteredHandler('extensions:set-enabled')

    await expect(handler?.({}, { extensionId: 'Sample Extension' })).rejects.toThrow()
    expect(listPackagesMock).not.toHaveBeenCalled()
  })
})

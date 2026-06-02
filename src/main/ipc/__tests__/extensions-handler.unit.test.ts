import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiscoveredExtensionPackage, ExtensionLifecycleState } from '../../extensions/types'
import { ExtensionLifecycleRepository } from '../../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../../ports/extension-manager-service'

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
  contentHash: 'abcdef',
  sdkCompatibility: {
    hostVersion: OPENWAGGLE_EXTENSION.SDK_VERSION,
    requiredRange: '>=0.1.0 <0.2.0',
    compatible: true,
  },
  diagnostics: [],
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
    }),
  )
}

const trustedLifecycleState: ExtensionLifecycleState = {
  extensionId: 'sample-extension',
  scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
  enabled: false,
  trusted: true,
  grantedCapabilities: ['sample.invoke'],
  contentHash: 'abcdef',
  sdkRange: '>=0.1.0 <0.2.0',
  sdkCompatible: true,
  diagnostics: [],
  installedAt: 1000,
  updatedAt: 2000,
}

const brokenPackage: DiscoveredExtensionPackage = {
  ...discoveredPackage,
  manifest: null,
  contentHash: null,
  sdkCompatibility: null,
  diagnostics: [
    {
      severity: 'error',
      code: 'manifest-missing',
      message: 'Missing manifest.',
    },
  ],
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

describe('registerExtensionsHandlers', () => {
  beforeEach(() => {
    typedHandleMock.mockReset()
    listPackagesMock.mockReset()
    upsertLifecycleMock.mockReset()
    listPackagesMock.mockReturnValue([brokenPackage])
  })

  it('registers extensions:list-packages and returns discovered packages', async () => {
    registerExtensionsHandlers()
    const handler = getRegisteredHandler('extensions:list-packages')

    const view = await handler?.({}, null)

    expect(listPackagesMock).toHaveBeenCalledWith({ projectPath: null })
    expect(view).toMatchObject({
      packages: [
        {
          id: 'sample-extension',
          diagnostics: [{ code: 'manifest-missing' }],
        },
      ],
    })
  })

  it('rejects malformed project path payloads before discovery', async () => {
    registerExtensionsHandlers()
    const handler = getRegisteredHandler('extensions:list-packages')

    await expect(handler?.({}, 123)).rejects.toThrow(
      'Project path must be a string, null, or undefined.',
    )
    expect(listPackagesMock).not.toHaveBeenCalled()
  })

  it('registers extensions:set-trusted and persists trusted lifecycle state', async () => {
    listPackagesMock.mockReturnValue([discoveredPackage])
    const layer = makeTestLayer()
    registerExtensionsHandlers()
    const handler = getRegisteredHandler('extensions:set-trusted', layer)

    await handler?.(
      {},
      {
        extensionId: 'sample-extension',
        scope: { kind: 'global' },
        viewProjectPath: null,
        trusted: true,
      },
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
    listPackagesMock.mockReturnValue([discoveredPackage])
    const layer = makeTestLayer(trustedLifecycleState)
    registerExtensionsHandlers()
    const handler = getRegisteredHandler('extensions:set-enabled', layer)

    await handler?.(
      {},
      {
        extensionId: 'sample-extension',
        scope: { kind: 'global' },
        viewProjectPath: null,
        enabled: true,
      },
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

  it('rejects malformed lifecycle mutation payloads before discovery', async () => {
    registerExtensionsHandlers()
    const handler = getRegisteredHandler('extensions:set-enabled')

    await expect(handler?.({}, { extensionId: 'Sample Extension' })).rejects.toThrow()
    expect(listPackagesMock).not.toHaveBeenCalled()
  })
})

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  DiscoveredExtensionPackage,
  ExtensionLifecycleState,
  ExtensionProjectOverrideState,
} from '../../extensions/types'
import { ExtensionLifecycleRepository } from '../../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../../ports/extension-manager-service'
import { ExtensionProjectOverridesRepository } from '../../ports/extension-project-overrides-repository'

const { typedHandleMock, listPackagesMock, upsertLifecycleMock, upsertProjectOverrideMock } =
  vi.hoisted(() => ({
    typedHandleMock: vi.fn(),
    listPackagesMock: vi.fn(),
    upsertLifecycleMock: vi.fn(),
    upsertProjectOverrideMock: vi.fn(),
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
  let storedProjectOverride: ExtensionProjectOverrideState | null = null
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
    Layer.succeed(ExtensionProjectOverridesRepository, {
      get: () => Effect.sync(() => storedProjectOverride),
      upsert: (state) =>
        Effect.sync(() => {
          storedProjectOverride = state
          upsertProjectOverrideMock(state)
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
    upsertProjectOverrideMock.mockReset()
    listPackagesMock.mockReturnValue([brokenPackage])
  })

  it('registers extensions:list-packages and returns discovered packages', async () => {
    registerExtensionsHandlers()
    const handler = getRegisteredHandler('extensions:list-packages')

    const view = await handler?.({})

    expect(listPackagesMock).toHaveBeenCalledWith({ projectPath: null })
    expect(view).toMatchObject({
      projectPath: null,
      projectPaths: [],
      packages: [
        {
          id: 'sample-extension',
          diagnostics: [{ code: 'manifest-missing' }],
        },
      ],
    })
  })

  it('accepts multiple project paths for extensions:list-packages', async () => {
    const firstProjectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-ipc-first-'))
    const secondProjectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-ipc-second-'))
    const realFirstProjectPath = await fs.realpath(firstProjectPath)
    const realSecondProjectPath = await fs.realpath(secondProjectPath)
    registerExtensionsHandlers()
    const handler = getRegisteredHandler('extensions:list-packages')

    try {
      const view = await handler?.(
        {},
        { projectPaths: [firstProjectPath, secondProjectPath, firstProjectPath] },
      )

      expect(view).toMatchObject({
        projectPath: realFirstProjectPath,
        projectPaths: [realFirstProjectPath, realSecondProjectPath],
      })
      expect(listPackagesMock).toHaveBeenCalledWith({ projectPath: null })
      expect(listPackagesMock).toHaveBeenCalledWith({ projectPath: realFirstProjectPath })
      expect(listPackagesMock).toHaveBeenCalledWith({ projectPath: realSecondProjectPath })
    } finally {
      await fs.rm(firstProjectPath, { recursive: true, force: true })
      await fs.rm(secondProjectPath, { recursive: true, force: true })
    }
  })

  it('rejects malformed project path payloads before discovery', async () => {
    registerExtensionsHandlers()
    const handler = getRegisteredHandler('extensions:list-packages')

    await expect(handler?.({}, 123)).rejects.toThrow()
    await expect(handler?.({}, null)).rejects.toThrow()
    await expect(handler?.({}, '/tmp/project')).rejects.toThrow()
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

  it('registers extensions:set-project-disabled and persists user-local project override state', async () => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-ipc-project-'))
    const realProjectPath = await fs.realpath(projectPath)
    listPackagesMock.mockReturnValue([discoveredPackage])
    const layer = makeTestLayer()
    registerExtensionsHandlers()
    const handler = getRegisteredHandler('extensions:set-project-disabled', layer)

    try {
      await handler?.(
        {},
        {
          extensionId: 'sample-extension',
          scope: { kind: 'global' },
          projectPath,
          disabled: true,
        },
      )

      expect(listPackagesMock).toHaveBeenCalledWith({ projectPath: realProjectPath })
      expect(upsertProjectOverrideMock).toHaveBeenCalledWith(
        expect.objectContaining({
          extensionId: 'sample-extension',
          scope: { kind: 'global' },
          projectPath: realProjectPath,
          disabled: true,
        }),
      )
    } finally {
      await fs.rm(projectPath, { recursive: true, force: true })
    }
  })

  it('rejects malformed lifecycle mutation payloads before discovery', async () => {
    registerExtensionsHandlers()
    const handler = getRegisteredHandler('extensions:set-enabled')

    await expect(handler?.({}, { extensionId: 'Sample Extension' })).rejects.toThrow()
    expect(listPackagesMock).not.toHaveBeenCalled()
  })
})

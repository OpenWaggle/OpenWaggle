import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiscoveredExtensionPackage, ExtensionLifecycleState } from '../../extensions/types'
import { ExtensionLifecycleRepository } from '../../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../../ports/extension-manager-service'
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
    Layer.succeed(ExtensionProjectOverridesRepository, {
      get: () => Effect.succeed(null),
      upsert: () => Effect.void,
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

const brokenPackage: DiscoveredExtensionPackage = {
  ...discoveredPackage,
  manifest: null,
  buildPlan: null,
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

  it('ignores unavailable project paths when listing extension packages', async () => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-ipc-valid-'))
    const unavailableProjectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-ipc-stale-'))
    const realProjectPath = await fs.realpath(projectPath)
    await fs.rm(unavailableProjectPath, { recursive: true, force: true })
    registerExtensionsHandlers()
    const handler = getRegisteredHandler('extensions:list-packages')

    try {
      const view = await handler?.({}, { projectPaths: [unavailableProjectPath, projectPath] })

      expect(view).toMatchObject({
        projectPath: realProjectPath,
        projectPaths: [realProjectPath],
      })
      expect(listPackagesMock).toHaveBeenCalledWith({ projectPath: null })
      expect(listPackagesMock).toHaveBeenCalledWith({ projectPath: realProjectPath })
      expect(listPackagesMock).not.toHaveBeenCalledWith({ projectPath: unavailableProjectPath })
    } finally {
      await fs.rm(projectPath, { recursive: true, force: true })
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

  it('registers extensions:reload and persists reload lifecycle state', async () => {
    listPackagesMock.mockReturnValue([discoveredPackage])
    const layer = makeTestLayer({ ...trustedLifecycleState, enabled: true })
    registerExtensionsHandlers()
    const handler = getRegisteredHandler('extensions:reload', layer)

    await handler?.(
      {},
      {
        extensionId: 'sample-extension',
        scope: { kind: 'global' },
      },
    )

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

    await handler?.(
      {},
      {
        extensionId: 'sample-extension',
        scope: { kind: 'global' },
      },
    )

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

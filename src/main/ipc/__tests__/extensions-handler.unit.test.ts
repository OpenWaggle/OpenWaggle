import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TrustedMainActivationDependenciesTestLayer } from '../../application/__tests__/extension-trusted-main-activation-test-layer'
import type { DiscoveredExtensionPackage } from '../../extensions/types'
import { ExtensionLifecycleRepository } from '../../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../../ports/extension-manager-service'
import { ExtensionPackageRepository } from '../../ports/extension-package-repository'
import { ExtensionProjectOverridesRepository } from '../../ports/extension-project-overrides-repository'

const { typedHandleMock, listPackagesMock } = vi.hoisted(() => ({
  typedHandleMock: vi.fn(),
  listPackagesMock: vi.fn(),
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

function makeTestLayer() {
  return Layer.mergeAll(
    Layer.succeed(ExtensionManagerService, {
      listPackages: (input) => Effect.sync(() => listPackagesMock(input)),
    }),
    Layer.succeed(ExtensionLifecycleRepository, {
      get: () => Effect.succeed(null),
      list: () => Effect.succeed([]),
      upsert: () => Effect.void,
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
      removePackage: (_input) => Effect.succeed({ packagePath: '/tmp/package', removed: false }),
    }),
    TrustedMainActivationDependenciesTestLayer,
  )
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
})

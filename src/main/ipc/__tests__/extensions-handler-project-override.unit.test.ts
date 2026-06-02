import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  DiscoveredExtensionPackage,
  ExtensionProjectOverrideState,
} from '../../extensions/types'
import { ExtensionLifecycleRepository } from '../../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../../ports/extension-manager-service'
import { ExtensionProjectOverridesRepository } from '../../ports/extension-project-overrides-repository'

const { typedHandleMock, listPackagesMock, upsertProjectOverrideMock } = vi.hoisted(() => ({
  typedHandleMock: vi.fn(),
  listPackagesMock: vi.fn(),
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
  let storedProjectOverride: ExtensionProjectOverrideState | null = null
  return Layer.mergeAll(
    Layer.succeed(ExtensionManagerService, {
      listPackages: (input) => Effect.sync(() => listPackagesMock(input)),
    }),
    Layer.succeed(ExtensionLifecycleRepository, {
      get: () => Effect.succeed(null),
      list: () => Effect.succeed([]),
      upsert: () => Effect.void,
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

function getRegisteredHandler(layer = makeTestLayer()) {
  const call = typedHandleMock.mock.calls.find(
    (candidate: readonly unknown[]) =>
      candidate[0] === 'extensions:set-project-disabled' && typeof candidate[1] === 'function',
  )
  const handler = call?.[1]
  if (typeof handler !== 'function') {
    return undefined
  }
  return (...args: unknown[]) => Effect.runPromise(Effect.provide(handler(...args), layer))
}

describe('registerExtensionsHandlers project override', () => {
  beforeEach(() => {
    typedHandleMock.mockReset()
    listPackagesMock.mockReset()
    upsertProjectOverrideMock.mockReset()
    listPackagesMock.mockReturnValue([discoveredPackage])
  })

  it('persists user-local project override state', async () => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-ipc-project-'))
    const realProjectPath = await fs.realpath(projectPath)
    registerExtensionsHandlers()
    const handler = getRegisteredHandler()

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
})

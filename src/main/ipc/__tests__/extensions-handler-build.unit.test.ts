import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiscoveredExtensionPackage, ExtensionLifecycleState } from '../../extensions/types'
import { ExtensionLifecycleRepository } from '../../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../../ports/extension-manager-service'
import { ExtensionProjectOverridesRepository } from '../../ports/extension-project-overrides-repository'

const { typedHandleMock, upsertLifecycleMock } = vi.hoisted(() => ({
  typedHandleMock: vi.fn(),
  upsertLifecycleMock: vi.fn(),
}))

vi.mock('../typed-ipc', () => ({
  typedHandle: typedHandleMock,
}))

import { registerExtensionsHandlers } from '../extensions-handler'

const localBuildPackage: DiscoveredExtensionPackage = {
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
  buildPlan: {
    installSource: OPENWAGGLE_EXTENSION.INSTALL_SOURCE.LOCAL_BUILD,
    command: 'pnpm build',
    outputPaths: ['dist/index.js'],
    approvalRequired: true,
    inputHash: 'build-plan-hash',
  },
  contentHash: 'abcdef',
  sdkCompatibility: {
    hostVersion: OPENWAGGLE_EXTENSION.SDK_VERSION,
    requiredRange: '>=0.1.0 <0.2.0',
    compatible: true,
  },
  diagnostics: [],
}

function makeTestLayer() {
  let storedLifecycle: ExtensionLifecycleState | null = null
  return Layer.mergeAll(
    Layer.succeed(ExtensionManagerService, {
      listPackages: () => Effect.succeed([localBuildPackage]),
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

function getRegisteredHandler(layer = makeTestLayer()) {
  const call = typedHandleMock.mock.calls.find(
    (candidate: readonly unknown[]) =>
      candidate[0] === 'extensions:approve-build' && typeof candidate[1] === 'function',
  )
  const handler = call?.[1]
  if (typeof handler !== 'function') {
    return undefined
  }
  return (...args: unknown[]) => Effect.runPromise(Effect.provide(handler(...args), layer))
}

describe('registerExtensionsHandlers build approval', () => {
  beforeEach(() => {
    typedHandleMock.mockReset()
    upsertLifecycleMock.mockReset()
  })

  it('persists the approved local-build plan hash', async () => {
    registerExtensionsHandlers()
    const handler = getRegisteredHandler()

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
        trusted: false,
        enabled: false,
        approvedBuildPlanHash: 'build-plan-hash',
      }),
    )
  })
})

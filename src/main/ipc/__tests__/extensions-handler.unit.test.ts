import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiscoveredExtensionPackage } from '../../extensions/types'
import { ExtensionLifecycleRepository } from '../../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../../ports/extension-manager-service'

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
  scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: '/tmp/project' },
  packagePath: '/tmp/project/.openwaggle/extensions/sample-extension',
  manifestPath: '/tmp/project/.openwaggle/extensions/sample-extension/openwaggle.extension.json',
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

const TestLayer = Layer.mergeAll(
  Layer.succeed(ExtensionManagerService, {
    listPackages: (input) => Effect.sync(() => listPackagesMock(input)),
  }),
  Layer.succeed(ExtensionLifecycleRepository, {
    get: () => Effect.succeed(null),
    list: () => Effect.succeed([]),
    upsert: () => Effect.void,
  }),
)

function getRegisteredHandler(name: string) {
  const call = typedHandleMock.mock.calls.find(
    (candidate: readonly unknown[]) => candidate[0] === name && typeof candidate[1] === 'function',
  )
  const handler = call?.[1]
  if (typeof handler !== 'function') {
    return undefined
  }
  return (...args: unknown[]) => Effect.runPromise(Effect.provide(handler(...args), TestLayer))
}

describe('registerExtensionsHandlers', () => {
  beforeEach(() => {
    typedHandleMock.mockReset()
    listPackagesMock.mockReset()
    listPackagesMock.mockReturnValue([discoveredPackage])
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
})

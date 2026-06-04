import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { describe, expect, it } from 'vitest'
import { makeExpectBrokerFailure } from './extension-capability-broker-assertions'
import {
  makeStorageBrokerPackage,
  makeStorageInvocation,
  makeStorageUiBrokerPackage,
  STORAGE_CONTRIBUTION_ID,
} from './extension-capability-broker-storage-test-utils'
import { makeBrokerHarness, runBroker, TIMESTAMP } from './extension-capability-broker-test-utils'
import { makeLifecycle, PROJECT_PATH } from './extension-contribution-registry-test-utils'

const expectFailure = makeExpectBrokerFailure(TIMESTAMP)

describe('invokeExtensionCapability storage routing', () => {
  it('reads, writes, lists, and deletes extension storage through the broker', async () => {
    const extensionPackage = makeStorageBrokerPackage()
    const harness = makeBrokerHarness({
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
    })

    const setResult = await harness.run(
      makeStorageInvocation({
        contributionId: STORAGE_CONTRIBUTION_ID.SET,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.SET,
        key: 'settings',
        value: { enabled: true },
      }),
    )
    const getResult = await harness.run(
      makeStorageInvocation({
        contributionId: STORAGE_CONTRIBUTION_ID.GET,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET,
        key: 'settings',
      }),
    )
    const listResult = await harness.run(
      makeStorageInvocation({
        contributionId: STORAGE_CONTRIBUTION_ID.LIST,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST,
      }),
    )
    const deleteResult = await harness.run(
      makeStorageInvocation({
        contributionId: STORAGE_CONTRIBUTION_ID.DELETE,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.DELETE,
        key: 'settings',
      }),
    )
    const getAfterDeleteResult = await harness.run(
      makeStorageInvocation({
        contributionId: STORAGE_CONTRIBUTION_ID.GET,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET,
        key: 'settings',
      }),
    )

    expect(setResult).toMatchObject({
      ok: true,
      value: {
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.SET,
        storageKind: OPENWAGGLE_EXTENSION.STORAGE.KIND.CONFIG,
        storageScope: {
          kind: OPENWAGGLE_EXTENSION.STORAGE.SCOPE.PROJECT_KIND,
          projectPath: PROJECT_PATH,
        },
        key: 'settings',
        value: { enabled: true },
        createdAt: expect.any(Number),
        updatedAt: expect.any(Number),
      },
    })
    expect(getResult).toMatchObject({
      ok: true,
      value: {
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET,
        key: 'settings',
        value: { enabled: true },
      },
    })
    expect(listResult).toMatchObject({
      ok: true,
      value: {
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST,
        keys: ['settings'],
      },
    })
    expect(deleteResult).toMatchObject({
      ok: true,
      value: {
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.DELETE,
        key: 'settings',
        deleted: true,
      },
    })
    expect(getAfterDeleteResult).toMatchObject({
      ok: true,
      value: {
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET,
        key: 'settings',
        value: null,
      },
    })
    expect(harness.storageItems()).toEqual([])
  })

  it('stores global app-data storage separately from project-scoped storage', async () => {
    const extensionPackage = makeStorageBrokerPackage()
    const harness = makeBrokerHarness({
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
    })

    await harness.run(
      makeStorageInvocation({
        contributionId: STORAGE_CONTRIBUTION_ID.SET,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.SET,
        storageScope: OPENWAGGLE_EXTENSION.STORAGE.SCOPE.GLOBAL_KIND,
        key: 'mode',
        value: 'global',
      }),
    )
    await harness.run(
      makeStorageInvocation({
        contributionId: STORAGE_CONTRIBUTION_ID.SET,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.SET,
        storageScope: OPENWAGGLE_EXTENSION.STORAGE.SCOPE.PROJECT_KIND,
        key: 'mode',
        value: 'project',
      }),
    )

    const globalResult = await harness.run(
      makeStorageInvocation({
        contributionId: STORAGE_CONTRIBUTION_ID.GET,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET,
        storageScope: OPENWAGGLE_EXTENSION.STORAGE.SCOPE.GLOBAL_KIND,
        key: 'mode',
      }),
    )
    const projectResult = await harness.run(
      makeStorageInvocation({
        contributionId: STORAGE_CONTRIBUTION_ID.GET,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET,
        storageScope: OPENWAGGLE_EXTENSION.STORAGE.SCOPE.PROJECT_KIND,
        key: 'mode',
      }),
    )

    expect(globalResult).toMatchObject({
      ok: true,
      value: {
        storageScope: { kind: OPENWAGGLE_EXTENSION.STORAGE.SCOPE.GLOBAL_KIND },
        value: 'global',
      },
    })
    expect(projectResult).toMatchObject({
      ok: true,
      value: {
        storageScope: {
          kind: OPENWAGGLE_EXTENSION.STORAGE.SCOPE.PROJECT_KIND,
          projectPath: PROJECT_PATH,
        },
        value: 'project',
      },
    })
  })

  it('allows one UI contribution to use declared storage methods', async () => {
    const extensionPackage = makeStorageUiBrokerPackage()
    const harness = makeBrokerHarness({
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
    })
    const contributionId = STORAGE_CONTRIBUTION_ID.SETTINGS

    const setResult = await harness.run(
      makeStorageInvocation({
        contributionId,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.SET,
        key: 'settings',
        value: { theme: 'default' },
      }),
    )
    const getResult = await harness.run(
      makeStorageInvocation({
        contributionId,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET,
        key: 'settings',
      }),
    )
    const listResult = await harness.run(
      makeStorageInvocation({
        contributionId,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST,
      }),
    )
    const deleteResult = await harness.run(
      makeStorageInvocation({
        contributionId,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.DELETE,
        key: 'settings',
      }),
    )

    expect(setResult).toMatchObject({
      ok: true,
      value: { method: OPENWAGGLE_EXTENSION_BROKER.METHOD.SET },
    })
    expect(getResult).toMatchObject({
      ok: true,
      value: { method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET, value: { theme: 'default' } },
    })
    expect(listResult).toMatchObject({
      ok: true,
      value: { method: OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST, keys: ['settings'] },
    })
    expect(deleteResult).toMatchObject({
      ok: true,
      value: { method: OPENWAGGLE_EXTENSION_BROKER.METHOD.DELETE, deleted: true },
    })
  })

  it('rejects project-scoped extension storage from app scope', async () => {
    const extensionPackage = makeStorageBrokerPackage()
    const result = await runBroker({
      invocation: makeStorageInvocation({
        contributionId: STORAGE_CONTRIBUTION_ID.GET,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET,
        scope: { kind: 'app' },
        key: 'settings',
      }),
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
    })

    expectFailure(result, OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.OUT_OF_SCOPE)
  })

  it('rejects invalid extension storage payloads', async () => {
    const extensionPackage = makeStorageBrokerPackage()
    const result = await runBroker({
      invocation: makeStorageInvocation({
        contributionId: STORAGE_CONTRIBUTION_ID.SET,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.SET,
        key: 'settings',
      }),
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
    })

    expectFailure(result, OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_PAYLOAD)
  })
})

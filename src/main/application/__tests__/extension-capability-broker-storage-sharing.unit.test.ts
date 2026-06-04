import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { describe, expect, it } from 'vitest'
import {
  makeStorageBrokerPackage,
  makeStorageInvocation,
  makeStorageUiBrokerPackage,
  STORAGE_CONTRIBUTION_ID,
} from './extension-capability-broker-storage-test-utils'
import { makeBrokerHarness } from './extension-capability-broker-test-utils'
import { makeLifecycle, PROJECT_PATH } from './extension-contribution-registry-test-utils'

describe('invokeExtensionCapability package storage sharing', () => {
  it('shares package storage across multiple UI contributions from the same extension package', async () => {
    const extensionPackage = makeStorageUiBrokerPackage()
    const harness = makeBrokerHarness({
      packages: [extensionPackage],
      lifecycles: [makeLifecycle(extensionPackage)],
    })

    const setResult = await harness.run(
      makeStorageInvocation({
        contributionId: STORAGE_CONTRIBUTION_ID.SETTINGS,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.SET,
        storageKind: OPENWAGGLE_EXTENSION.STORAGE.KIND.STATE,
        key: 'issue-filter',
        value: { query: 'assignee:@me' },
      }),
    )
    const getResult = await harness.run(
      makeStorageInvocation({
        contributionId: STORAGE_CONTRIBUTION_ID.DIALOG,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET,
        storageKind: OPENWAGGLE_EXTENSION.STORAGE.KIND.STATE,
        key: 'issue-filter',
      }),
    )

    expect(setResult).toMatchObject({
      ok: true,
      value: {
        contributionId: STORAGE_CONTRIBUTION_ID.SETTINGS,
        storageKind: OPENWAGGLE_EXTENSION.STORAGE.KIND.STATE,
        key: 'issue-filter',
        value: { query: 'assignee:@me' },
      },
    })
    expect(getResult).toMatchObject({
      ok: true,
      value: {
        contributionId: STORAGE_CONTRIBUTION_ID.DIALOG,
        storageKind: OPENWAGGLE_EXTENSION.STORAGE.KIND.STATE,
        key: 'issue-filter',
        value: { query: 'assignee:@me' },
      },
    })
    expect(harness.storageItems()).toEqual([
      expect.objectContaining({
        extensionId: extensionPackage.id,
        packageScope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
        storageKind: OPENWAGGLE_EXTENSION.STORAGE.KIND.STATE,
        storageScope: {
          kind: OPENWAGGLE_EXTENSION.STORAGE.SCOPE.PROJECT_KIND,
          projectPath: PROJECT_PATH,
        },
        key: 'issue-filter',
        value: { query: 'assignee:@me' },
      }),
    ])
  })

  it('keeps same-extension global and project package storage isolated', async () => {
    const globalPackage = makeStorageBrokerPackage()
    const projectPackage = makeStorageBrokerPackage({
      scope: {
        kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND,
        projectPath: PROJECT_PATH,
      },
    })
    const harness = makeBrokerHarness({
      packages: [globalPackage, projectPackage],
      lifecycles: [makeLifecycle(globalPackage), makeLifecycle(projectPackage)],
    })

    await harness.run(
      makeStorageInvocation({
        contributionId: STORAGE_CONTRIBUTION_ID.SET,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.SET,
        scope: { kind: 'app' },
        storageScope: OPENWAGGLE_EXTENSION.STORAGE.SCOPE.GLOBAL_KIND,
        key: 'mode',
        value: 'global-package',
      }),
    )
    await harness.run(
      makeStorageInvocation({
        contributionId: STORAGE_CONTRIBUTION_ID.SET,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.SET,
        storageScope: OPENWAGGLE_EXTENSION.STORAGE.SCOPE.GLOBAL_KIND,
        key: 'mode',
        value: 'project-package',
      }),
    )

    const globalResult = await harness.run(
      makeStorageInvocation({
        contributionId: STORAGE_CONTRIBUTION_ID.GET,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET,
        scope: { kind: 'app' },
        storageScope: OPENWAGGLE_EXTENSION.STORAGE.SCOPE.GLOBAL_KIND,
        key: 'mode',
      }),
    )
    const projectResult = await harness.run(
      makeStorageInvocation({
        contributionId: STORAGE_CONTRIBUTION_ID.GET,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET,
        storageScope: OPENWAGGLE_EXTENSION.STORAGE.SCOPE.GLOBAL_KIND,
        key: 'mode',
      }),
    )

    expect(globalResult).toMatchObject({
      ok: true,
      value: {
        storageScope: { kind: OPENWAGGLE_EXTENSION.STORAGE.SCOPE.GLOBAL_KIND },
        value: 'global-package',
      },
    })
    expect(projectResult).toMatchObject({
      ok: true,
      value: {
        storageScope: { kind: OPENWAGGLE_EXTENSION.STORAGE.SCOPE.GLOBAL_KIND },
        value: 'project-package',
      },
    })
    expect(harness.storageItems()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          packageScope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
          value: 'global-package',
        }),
        expect.objectContaining({
          packageScope: {
            kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND,
            projectPath: PROJECT_PATH,
          },
          value: 'project-package',
        }),
      ]),
    )
  })

  it('keeps package storage isolated by extension id', async () => {
    const firstPackage = makeStorageBrokerPackage()
    const secondPackage = makeStorageBrokerPackage({
      extensionId: 'other-extension',
      name: 'Other Extension',
    })
    const harness = makeBrokerHarness({
      packages: [firstPackage, secondPackage],
      lifecycles: [makeLifecycle(firstPackage), makeLifecycle(secondPackage)],
    })

    await harness.run(
      makeStorageInvocation({
        contributionId: STORAGE_CONTRIBUTION_ID.SET,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.SET,
        storageScope: OPENWAGGLE_EXTENSION.STORAGE.SCOPE.GLOBAL_KIND,
        key: 'mode',
        value: 'first',
      }),
    )

    const secondResult = await harness.run(
      makeStorageInvocation({
        extensionId: 'other-extension',
        contributionId: STORAGE_CONTRIBUTION_ID.GET,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET,
        storageScope: OPENWAGGLE_EXTENSION.STORAGE.SCOPE.GLOBAL_KIND,
        key: 'mode',
      }),
    )

    expect(secondResult).toMatchObject({
      ok: true,
      value: {
        extensionId: 'other-extension',
        value: null,
      },
    })
  })
})

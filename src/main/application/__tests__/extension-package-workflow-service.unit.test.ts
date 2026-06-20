import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it } from 'vitest'
import type { DiscoveredExtensionPackage } from '../../extensions/types'
import { clearExtensionContributionRegistryCacheForTests } from '../extension-contribution-registry-cache'
import { listExtensionContributionRegistryView } from '../extension-contribution-registry-service'
import {
  EXTENSION_PACKAGE_WORKFLOW,
  type ExtensionPackageWriteWorkflowInput,
} from '../extension-package-workflow-model'
import {
  createOrUpdateExtensionPackage,
  removeExtensionPackage,
} from '../extension-package-workflow-service'
import { isExtensionRuntimeModuleAccessAllowed } from '../extension-runtime-module-access-service'
import {
  activateTrustedMainExtensionPackage,
  clearTrustedMainExtensionActivationsForTests,
  getTrustedMainExtensionActivationCountForTests,
} from '../extension-trusted-main-activation-service'
import {
  makeLifecycle,
  makePackage,
  PROJECT_PATH,
} from './extension-contribution-registry-test-utils'
import {
  AGENT_ACTOR,
  approvedRemoveInput,
  approvedWriteInput,
  GLOBAL_SCOPE,
  makeWorkflowHarness,
  PROJECT_SCOPE,
  packageFiles,
} from './extension-package-workflow-test-utils'

describe('extension package workflow service', () => {
  beforeEach(() => {
    clearExtensionContributionRegistryCacheForTests()
    clearTrustedMainExtensionActivationsForTests()
  })

  it('rejects direct extension actors before package writes can run', async () => {
    const extensionPackage = makePackage({
      id: 'workflow-extension',
      name: 'Workflow Extension',
      scope: PROJECT_SCOPE,
      contributions: { commands: [{ id: 'workflow.run', title: 'Run Workflow' }] },
    })
    const harness = makeWorkflowHarness({
      packages: [extensionPackage],
      lifecycle: null,
      packageAfterWrite: extensionPackage,
    })
    const baseInput = {
      extensionId: extensionPackage.id,
      scope: extensionPackage.scope,
      mode: 'update',
      files: packageFiles(extensionPackage.id),
      actor: { kind: 'extension', extensionId: extensionPackage.id },
      viewProjectPaths: [PROJECT_PATH],
    } satisfies Omit<ExtensionPackageWriteWorkflowInput, 'userApproval' | 'globalConfirmation'>

    await expect(
      Effect.runPromise(
        createOrUpdateExtensionPackage(approvedWriteInput(baseInput)).pipe(
          Effect.provide(harness.layer),
        ),
      ),
    ).rejects.toThrow(EXTENSION_PACKAGE_WORKFLOW.ERROR.EXTENSION_ACTOR_REJECTED)
    expect(harness.getWrites()).toEqual([])
  })

  it('requires stronger confirmation for global extension writes', async () => {
    const globalPackage = makePackage({
      id: 'global-workflow-extension',
      name: 'Global Workflow Extension',
      scope: GLOBAL_SCOPE,
      contributions: { commands: [{ id: 'global-workflow.run', title: 'Run Global' }] },
    })
    const harness = makeWorkflowHarness({
      packages: [],
      lifecycle: null,
      packageAfterWrite: globalPackage,
    })
    const input = approvedWriteInput({
      extensionId: globalPackage.id,
      scope: globalPackage.scope,
      mode: 'create',
      files: packageFiles(globalPackage.id),
      actor: AGENT_ACTOR,
      viewProjectPaths: [PROJECT_PATH],
    })

    await expect(
      Effect.runPromise(createOrUpdateExtensionPackage(input).pipe(Effect.provide(harness.layer))),
    ).rejects.toThrow(EXTENSION_PACKAGE_WORKFLOW.ERROR.GLOBAL_CONFIRMATION_REQUIRED)
    expect(harness.getWrites()).toEqual([])
  })

  it('rejects approved package writes whose manifest id does not match the approved target id', async () => {
    const extensionId = 'workflow-apply-manifest-identity-extension'
    const harness = makeWorkflowHarness({
      packages: [],
      lifecycle: null,
    })

    await expect(
      Effect.runPromise(
        createOrUpdateExtensionPackage(
          approvedWriteInput({
            extensionId,
            scope: PROJECT_SCOPE,
            mode: 'create',
            files: packageFiles('other-approved-manifest-extension'),
            actor: AGENT_ACTOR,
            viewProjectPaths: [PROJECT_PATH],
          }),
        ).pipe(Effect.provide(harness.layer)),
      ),
    ).rejects.toThrow(EXTENSION_PACKAGE_WORKFLOW.ERROR.MANIFEST_ID_MISMATCH)
    expect(harness.getWrites()).toEqual([])
  })

  it('disables runtime loading and unregisters contributions after an approved package update', async () => {
    const extensionPackage = makePackage({
      id: 'workflow-update-extension',
      name: 'Workflow Update Extension',
      scope: PROJECT_SCOPE,
      contributions: {
        commands: [{ id: 'workflow-update.run', title: 'Run Workflow Update' }],
        settingsSections: [
          {
            id: 'workflow-update.settings',
            title: 'Workflow Update Settings',
            runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
            execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.FRAME,
            entry: 'dist/settings.js',
          },
        ],
      },
    })
    const updatedPackage = { ...extensionPackage, contentHash: 'updated-content-hash' }
    const harness = makeWorkflowHarness({
      packages: [extensionPackage],
      lifecycle: makeLifecycle(extensionPackage),
      packageAfterWrite: updatedPackage,
    })

    const enabledRegistry = await Effect.runPromise(
      listExtensionContributionRegistryView({ projectPaths: [PROJECT_PATH] }).pipe(
        Effect.provide(harness.layer),
      ),
    )
    const enabledModuleAccess = await Effect.runPromise(
      isExtensionRuntimeModuleAccessAllowed({
        packagePath: extensionPackage.packagePath,
        contentHash: extensionPackage.contentHash ?? '',
        projectPaths: [PROJECT_PATH],
      }).pipe(Effect.provide(harness.layer)),
    )

    await Effect.runPromise(
      createOrUpdateExtensionPackage(
        approvedWriteInput({
          extensionId: extensionPackage.id,
          scope: extensionPackage.scope,
          mode: 'update',
          files: packageFiles(extensionPackage.id),
          actor: AGENT_ACTOR,
          viewProjectPaths: [PROJECT_PATH],
        }),
      ).pipe(Effect.provide(harness.layer)),
    )

    const disabledRegistry = await Effect.runPromise(
      listExtensionContributionRegistryView({ projectPaths: [PROJECT_PATH] }).pipe(
        Effect.provide(harness.layer),
      ),
    )
    const disabledModuleAccess = await Effect.runPromise(
      isExtensionRuntimeModuleAccessAllowed({
        packagePath: updatedPackage.packagePath,
        contentHash: updatedPackage.contentHash ?? '',
        projectPaths: [PROJECT_PATH],
      }).pipe(Effect.provide(harness.layer)),
    )

    expect(enabledRegistry.entries.map((entry) => entry.contributionId)).toEqual([
      'workflow-update.run',
      'workflow-update.settings',
    ])
    expect(enabledModuleAccess).toBe(true)
    expect(harness.getStoredLifecycle()).toMatchObject({
      extensionId: extensionPackage.id,
      enabled: false,
      trusted: true,
      reloadStatus: OPENWAGGLE_EXTENSION.RELOAD_STATUS.NOT_RELOADED,
      lastReloadedAt: null,
    })
    expect(disabledRegistry.entries).toEqual([])
    expect(disabledModuleAccess).toBe(false)
  })

  it('removes package files, lifecycle state, contributions, and sandbox module access on uninstall', async () => {
    const basePackage = makePackage({
      id: 'workflow-remove-extension',
      name: 'Workflow Remove Extension',
      scope: PROJECT_SCOPE,
      contributions: {
        commands: [{ id: 'workflow-remove.run', title: 'Run Workflow Remove' }],
        sidePanels: [
          {
            id: 'workflow-remove.panel',
            title: 'Workflow Remove Panel',
            runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
            execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.FRAME,
            entry: 'dist/panel.js',
          },
        ],
      },
    })
    const extensionPackage: DiscoveredExtensionPackage = {
      ...basePackage,
      manifest: basePackage.manifest
        ? {
            ...basePackage.manifest,
            builtArtifacts: [...basePackage.manifest.builtArtifacts, 'dist/main.js'],
            trusted: { main: 'dist/main.js' },
          }
        : null,
    }
    const harness = makeWorkflowHarness({
      packages: [extensionPackage],
      lifecycle: makeLifecycle(extensionPackage),
    })

    await Effect.runPromise(
      activateTrustedMainExtensionPackage(
        { extensionPackage, lifecycle: makeLifecycle(extensionPackage) },
        {
          loadModule: async () => ({
            entryPath: `${extensionPackage.packagePath}/dist/main.js`,
            module: {
              activate: () => () => undefined,
            },
          }),
        },
      ).pipe(Effect.provide(harness.layer)),
    )
    expect(getTrustedMainExtensionActivationCountForTests()).toBe(1)

    const enabledRegistry = await Effect.runPromise(
      listExtensionContributionRegistryView({ projectPaths: [PROJECT_PATH] }).pipe(
        Effect.provide(harness.layer),
      ),
    )
    const enabledModuleAccess = await Effect.runPromise(
      isExtensionRuntimeModuleAccessAllowed({
        packagePath: extensionPackage.packagePath,
        contentHash: extensionPackage.contentHash ?? '',
        projectPaths: [PROJECT_PATH],
      }).pipe(Effect.provide(harness.layer)),
    )

    const view = await Effect.runPromise(
      removeExtensionPackage(
        approvedRemoveInput({
          extensionId: extensionPackage.id,
          scope: extensionPackage.scope,
          actor: AGENT_ACTOR,
          viewProjectPaths: [PROJECT_PATH],
        }),
      ).pipe(Effect.provide(harness.layer)),
    )
    const removedRegistry = await Effect.runPromise(
      listExtensionContributionRegistryView({ projectPaths: [PROJECT_PATH] }).pipe(
        Effect.provide(harness.layer),
      ),
    )
    const removedModuleAccess = await Effect.runPromise(
      isExtensionRuntimeModuleAccessAllowed({
        packagePath: extensionPackage.packagePath,
        contentHash: extensionPackage.contentHash ?? '',
        projectPaths: [PROJECT_PATH],
      }).pipe(Effect.provide(harness.layer)),
    )

    expect(enabledRegistry.entries.map((entry) => entry.contributionId)).toEqual([
      'workflow-remove.run',
      'workflow-remove.panel',
    ])
    expect(enabledModuleAccess).toBe(true)
    expect(getTrustedMainExtensionActivationCountForTests()).toBe(0)
    expect(view.packages).toEqual([])
    expect(harness.getStoredLifecycle()).toBeNull()
    expect(harness.getRemoves()).toHaveLength(1)
    expect(removedRegistry.entries).toEqual([])
    expect(removedModuleAccess).toBe(false)
  })
})

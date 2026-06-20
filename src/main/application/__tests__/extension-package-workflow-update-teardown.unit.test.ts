import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it } from 'vitest'
import type { DiscoveredExtensionPackage } from '../../extensions/types'
import { createOrUpdateExtensionPackage } from '../extension-package-workflow-service'
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
  approvedWriteInput,
  makeWorkflowHarness,
  PROJECT_SCOPE,
  packageFiles,
} from './extension-package-workflow-test-utils'

function trustedMainPackage(): DiscoveredExtensionPackage {
  const basePackage = makePackage({
    id: 'workflow-update-trusted-main-extension',
    name: 'Workflow Update Trusted Main Extension',
    scope: PROJECT_SCOPE,
    contributions: {
      commands: [{ id: 'workflow-update-trusted-main.run', title: 'Run Trusted Main' }],
    },
  })

  return {
    ...basePackage,
    manifest: basePackage.manifest
      ? {
          ...basePackage.manifest,
          builtArtifacts: [...basePackage.manifest.builtArtifacts, 'dist/main.js'],
          trusted: { main: 'dist/main.js' },
        }
      : null,
  }
}

describe('extension package update teardown', () => {
  beforeEach(() => {
    clearTrustedMainExtensionActivationsForTests()
  })

  it('deactivates active trusted main runtime before replacing package files', async () => {
    const extensionPackage = trustedMainPackage()
    const updatedPackage = { ...extensionPackage, contentHash: 'updated-trusted-main-content-hash' }
    const events: string[] = []
    const harness = makeWorkflowHarness({
      packages: [extensionPackage],
      lifecycle: makeLifecycle(extensionPackage),
      packageAfterWrite: updatedPackage,
      onWritePackage: () => events.push('write'),
    })

    await Effect.runPromise(
      activateTrustedMainExtensionPackage(
        { extensionPackage, lifecycle: makeLifecycle(extensionPackage) },
        {
          loadModule: async () => ({
            entryPath: `${extensionPackage.packagePath}/dist/main.js`,
            module: {
              activate: () => () => {
                events.push('cleanup')
              },
            },
          }),
        },
      ).pipe(Effect.provide(harness.layer)),
    )
    expect(getTrustedMainExtensionActivationCountForTests()).toBe(1)

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

    expect(events).toEqual(['cleanup', 'write'])
    expect(getTrustedMainExtensionActivationCountForTests()).toBe(0)
  })
})

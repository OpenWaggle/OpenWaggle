import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it } from 'vitest'
import type { DiscoveredExtensionPackage } from '../../extensions/types'
import { ExtensionLifecycleRepository } from '../../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../../ports/extension-manager-service'
import { ExtensionProjectOverridesRepository } from '../../ports/extension-project-overrides-repository'
import { listExtensionPackagesView } from '../extension-manager-view-service'

const PROJECT_PATH = '/tmp/project'
const OTHER_PROJECT_PATH = '/tmp/other-project'

const projectPackage: DiscoveredExtensionPackage = {
  id: 'sample-extension',
  scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: PROJECT_PATH },
  packagePath: '/tmp/project/.openwaggle/extensions/sample-extension',
  manifestPath: '/tmp/project/.openwaggle/extensions/sample-extension/openwaggle.extension.json',
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

const globalPackage: DiscoveredExtensionPackage = {
  ...projectPackage,
  id: 'global-extension',
  scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
  packagePath: '/tmp/user-data/extensions/global-extension',
  manifestPath: '/tmp/user-data/extensions/global-extension/openwaggle.extension.json',
  manifest: projectPackage.manifest
    ? { ...projectPackage.manifest, id: 'global-extension', name: 'Global Extension' }
    : null,
}

const otherProjectPackage: DiscoveredExtensionPackage = {
  ...projectPackage,
  id: 'other-extension',
  scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: OTHER_PROJECT_PATH },
  packagePath: '/tmp/other-project/.openwaggle/extensions/other-extension',
  manifestPath:
    '/tmp/other-project/.openwaggle/extensions/other-extension/openwaggle.extension.json',
  manifest: projectPackage.manifest
    ? { ...projectPackage.manifest, id: 'other-extension', name: 'Other Extension' }
    : null,
}

describe('listExtensionPackagesView multi-project aggregation', () => {
  it('collects global packages once and project packages for every requested project', async () => {
    const listInputs: Array<string | null | undefined> = []
    const layer = Layer.mergeAll(
      Layer.succeed(ExtensionManagerService, {
        listPackages: (input) =>
          Effect.sync(() => {
            listInputs.push(input.projectPath)
            if (input.projectPath === PROJECT_PATH) {
              return [globalPackage, projectPackage]
            }
            if (input.projectPath === OTHER_PROJECT_PATH) {
              return [globalPackage, otherProjectPackage]
            }
            return [globalPackage]
          }),
      }),
      Layer.succeed(ExtensionLifecycleRepository, {
        get: () => Effect.succeed(null),
        list: () => Effect.succeed([]),
        upsert: () => Effect.void,
      }),
      Layer.succeed(ExtensionProjectOverridesRepository, {
        get: () => Effect.succeed(null),
        upsert: () => Effect.void,
      }),
    )

    const view = await Effect.runPromise(
      listExtensionPackagesView({
        projectPaths: [PROJECT_PATH, OTHER_PROJECT_PATH],
      }).pipe(Effect.provide(layer)),
    )

    expect(listInputs).toEqual([null, PROJECT_PATH, OTHER_PROJECT_PATH])
    expect(view.projectPaths).toEqual([PROJECT_PATH, OTHER_PROJECT_PATH])
    expect(view.packages.map((extensionPackage) => extensionPackage.id)).toEqual([
      'global-extension',
      'sample-extension',
      'other-extension',
    ])
    expect(view.packages[0]?.projectOverrides).toEqual([
      { projectPath: PROJECT_PATH, disabled: false, updatedAt: null },
      { projectPath: OTHER_PROJECT_PATH, disabled: false, updatedAt: null },
    ])
  })
})

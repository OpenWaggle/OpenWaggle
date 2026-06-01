import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it } from 'vitest'
import type { DiscoveredExtensionPackage, ExtensionLifecycleState } from '../../extensions/types'
import { ExtensionLifecycleRepository } from '../../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../../ports/extension-manager-service'
import { listExtensionPackagesView } from '../extension-manager-view-service'

const PROJECT_PATH = '/tmp/project'

const discoveredPackage: DiscoveredExtensionPackage = {
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
    capabilities: [{ id: 'sample.invoke' }],
    contributions: {
      commands: [{ id: 'sample.run', title: 'Run Sample' }],
      routes: [
        { id: 'sample.route', title: 'Sample Route', lane: 'declarative', entry: 'dist/route.js' },
      ],
    },
    trusted: { main: 'dist/main.js' },
  },
  contentHash: 'abcdef',
  sdkCompatibility: {
    hostVersion: OPENWAGGLE_EXTENSION.SDK_VERSION,
    requiredRange: '>=0.1.0 <0.2.0',
    compatible: true,
  },
  diagnostics: [],
}

const lifecycleState: ExtensionLifecycleState = {
  extensionId: 'sample-extension',
  scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: PROJECT_PATH },
  enabled: true,
  trusted: true,
  grantedCapabilities: ['sample.invoke'],
  contentHash: 'abcdef',
  sdkRange: '>=0.1.0 <0.2.0',
  sdkCompatible: true,
  diagnostics: [],
  installedAt: 1000,
  updatedAt: 2000,
}

const TestLayer = Layer.mergeAll(
  Layer.succeed(ExtensionManagerService, {
    listPackages: () => Effect.succeed([discoveredPackage]),
  }),
  Layer.succeed(ExtensionLifecycleRepository, {
    get: () => Effect.succeed(lifecycleState),
    list: () => Effect.succeed([lifecycleState]),
    upsert: () => Effect.void,
  }),
)

describe('listExtensionPackagesView', () => {
  it('maps discovered packages and lifecycle state to a renderer-safe view', async () => {
    const view = await Effect.runPromise(
      listExtensionPackagesView(PROJECT_PATH).pipe(Effect.provide(TestLayer)),
    )

    expect(view.projectPath).toBe(PROJECT_PATH)
    expect(view.packages).toHaveLength(1)
    expect(view.packages[0]).toMatchObject({
      id: 'sample-extension',
      scope: { kind: 'project', label: 'Project', projectPath: PROJECT_PATH },
      manifest: {
        name: 'Sample Extension',
        contributionCount: 2,
        capabilityCount: 1,
        trustedMain: true,
      },
      lifecycle: {
        enabled: true,
        trusted: true,
        grantedCapabilities: ['sample.invoke'],
      },
    })
  })
})

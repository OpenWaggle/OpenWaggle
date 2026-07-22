import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it } from 'vitest'
import type { DiscoveredExtensionPackage, ExtensionLifecycleState } from '../../extensions/types'
import { ExtensionLifecycleRepository } from '../../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../../ports/extension-manager-service'
import { ExtensionProjectOverridesRepository } from '../../ports/extension-project-overrides-repository'
import { setExtensionEnabled, setExtensionTrusted } from '../extension-lifecycle-service'
import { TrustedMainActivationDependenciesTestLayer } from './extension-trusted-main-activation-test-layer'

const PROJECT_PATH = '/tmp/project'

const discoveredManifest = {
  manifestVersion: 1,
  id: 'sample-extension',
  name: 'Sample Extension',
  version: '1.0.0',
  sdk: { openwaggle: '>=0.1.0 <0.2.0' },
  sourceFiles: ['src/index.ts'],
  builtArtifacts: ['dist/index.js'],
  capabilities: [{ id: 'sample.invoke' }],
} satisfies NonNullable<DiscoveredExtensionPackage['manifest']>

const discoveredPackage: DiscoveredExtensionPackage = {
  id: 'sample-extension',
  scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: PROJECT_PATH },
  packagePath: '/tmp/project/.openwaggle/extensions/sample-extension',
  manifestPath: '/tmp/project/.openwaggle/extensions/sample-extension/openwaggle.extension.json',
  manifest: discoveredManifest,
  buildPlan: null,
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
  packageVersion: '1.0.0',
  approvedBuildPlanHash: null,
  buildStatus: OPENWAGGLE_EXTENSION.BUILD_RUN_STATUS.NOT_RUN,
  buildLog: null,
  reloadStatus: OPENWAGGLE_EXTENSION.RELOAD_STATUS.SUCCEEDED,
  lastReloadedAt: 3000,
  sdkRange: '>=0.1.0 <0.2.0',
  sdkCompatible: true,
  diagnostics: [],
  installedAt: 1000,
  updatedAt: 2000,
}

function makeTestHarness(input: {
  readonly packages: readonly DiscoveredExtensionPackage[]
  readonly lifecycle: ExtensionLifecycleState | null
}) {
  let storedLifecycle = input.lifecycle
  return {
    layer: Layer.mergeAll(
      Layer.succeed(ExtensionManagerService, {
        listPackages: () => Effect.succeed(input.packages),
      }),
      Layer.succeed(ExtensionLifecycleRepository, {
        get: () => Effect.sync(() => storedLifecycle),
        list: () => Effect.sync(() => (storedLifecycle ? [storedLifecycle] : [])),
        upsert: (state) =>
          Effect.sync(() => {
            storedLifecycle = state
          }),
      }),
      Layer.succeed(ExtensionProjectOverridesRepository, {
        get: () => Effect.succeed(null),
        upsert: () => Effect.void,
      }),
      TrustedMainActivationDependenciesTestLayer,
    ),
    getStoredLifecycle: () => storedLifecycle,
  }
}

describe('extension lifecycle privilege grants', () => {
  it('records consent grants for privileged extension permissions', async () => {
    const privilegedPackage: DiscoveredExtensionPackage = {
      ...discoveredPackage,
      manifest: {
        ...discoveredManifest,
        builtArtifacts: ['dist/index.js', 'dist/main.js', 'dist/renderer.js'],
        network: { origins: ['https://api.github.com'] },
        trusted: {
          main: 'dist/main.js',
          renderer: 'dist/renderer.js',
        },
      },
    }
    const harness = makeTestHarness({ packages: [privilegedPackage], lifecycle: null })

    await Effect.runPromise(
      setExtensionTrusted({
        extensionId: 'sample-extension',
        scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: PROJECT_PATH },
        trusted: true,
      }).pipe(Effect.provide(harness.layer)),
    )

    expect(harness.getStoredLifecycle()?.grantedCapabilities).toEqual([
      'sample.invoke',
      OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.TRUSTED_MAIN,
      OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.TRUSTED_RENDERER,
      OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.NETWORK,
    ])
  })

  it('rejects enabling when the lifecycle is missing required privilege grants', async () => {
    const networkPackage: DiscoveredExtensionPackage = {
      ...discoveredPackage,
      manifest: {
        ...discoveredManifest,
        network: { origins: ['https://api.github.com'] },
      },
    }
    const harness = makeTestHarness({
      packages: [networkPackage],
      lifecycle: {
        ...lifecycleState,
        enabled: false,
        grantedCapabilities: ['sample.invoke'],
      },
    })

    await expect(
      Effect.runPromise(
        setExtensionEnabled({
          extensionId: 'sample-extension',
          scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: PROJECT_PATH },
          enabled: true,
        }).pipe(Effect.provide(harness.layer)),
      ),
    ).rejects.toThrow(OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.NETWORK)
  })
})

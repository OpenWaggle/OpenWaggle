import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it } from 'vitest'
import type { DiscoveredExtensionPackage, ExtensionLifecycleState } from '../../extensions/types'
import { ExtensionLifecycleRepository } from '../../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../../ports/extension-manager-service'
import { ExtensionProjectOverridesRepository } from '../../ports/extension-project-overrides-repository'
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
        {
          id: 'sample.route',
          title: 'Sample Route',
          runtime: 'federated-module',
          execution: 'host-renderer',
          entry: 'dist/route.js',
        },
      ],
    },
    trusted: { main: 'dist/main.js' },
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

const lifecycleState: ExtensionLifecycleState = {
  extensionId: 'sample-extension',
  scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: PROJECT_PATH },
  enabled: true,
  trusted: true,
  grantedCapabilities: ['sample.invoke', OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.TRUSTED_MAIN],
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

function makeTestHarness({
  packages,
  lifecycle,
}: {
  readonly packages: readonly DiscoveredExtensionPackage[]
  readonly lifecycle: ExtensionLifecycleState | null
}) {
  let storedLifecycle = lifecycle
  return {
    layer: Layer.mergeAll(
      Layer.succeed(ExtensionManagerService, {
        listPackages: () => Effect.succeed(packages),
      }),
      Layer.succeed(ExtensionLifecycleRepository, {
        get: () => Effect.sync(() => storedLifecycle),
        list: () => Effect.succeed(storedLifecycle ? [storedLifecycle] : []),
        upsert: (state) =>
          Effect.sync(() => {
            storedLifecycle = state
          }),
      }),
      Layer.succeed(ExtensionProjectOverridesRepository, {
        get: () => Effect.succeed(null),
        upsert: () => Effect.void,
      }),
    ),
    getStoredLifecycle: () => storedLifecycle,
  }
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
  Layer.succeed(ExtensionProjectOverridesRepository, {
    get: () => Effect.succeed(null),
    upsert: () => Effect.void,
  }),
)

describe('listExtensionPackagesView', () => {
  it('maps discovered packages and lifecycle state to a renderer-safe view', async () => {
    const view = await Effect.runPromise(
      listExtensionPackagesView({ projectPaths: [PROJECT_PATH] }).pipe(Effect.provide(TestLayer)),
    )

    expect(view.projectPath).toBe(PROJECT_PATH)
    expect(view.projectPaths).toEqual([PROJECT_PATH])
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
        updateAvailable: false,
        grantedCapabilities: ['sample.invoke', OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.TRUSTED_MAIN],
        packageVersion: '1.0.0',
      },
      projectOverride: {
        projectPath: PROJECT_PATH,
        disabled: false,
        updatedAt: null,
      },
      projectOverrides: [
        {
          projectPath: PROJECT_PATH,
          disabled: false,
          updatedAt: null,
        },
      ],
    })
  })

  it('treats a stale trust pin as untrusted and disabled in the renderer view', async () => {
    const harness = makeTestHarness({
      packages: [{ ...discoveredPackage, contentHash: 'changed-hash' }],
      lifecycle: lifecycleState,
    })

    const view = await Effect.runPromise(
      listExtensionPackagesView({ projectPaths: [PROJECT_PATH] }).pipe(
        Effect.provide(harness.layer),
      ),
    )

    expect(view.packages[0]?.lifecycle).toMatchObject({
      enabled: false,
      trusted: false,
      updateAvailable: true,
      contentHash: 'abcdef',
      packageVersion: '1.0.0',
    })
  })

  it('treats an SDK-incompatible package as effectively untrusted even when the hash pin matches', async () => {
    const harness = makeTestHarness({
      packages: [
        {
          ...discoveredPackage,
          sdkCompatibility: {
            hostVersion: OPENWAGGLE_EXTENSION.SDK_VERSION,
            requiredRange: '>=999.0.0',
            compatible: false,
            reason: 'Extension SDK range is incompatible.',
          },
        },
      ],
      lifecycle: lifecycleState,
    })

    const view = await Effect.runPromise(
      listExtensionPackagesView({ projectPaths: [PROJECT_PATH] }).pipe(
        Effect.provide(harness.layer),
      ),
    )

    expect(view.packages[0]?.lifecycle).toMatchObject({
      enabled: false,
      trusted: false,
      grantedCapabilities: [],
      contentHash: 'abcdef',
    })
  })

  it('treats a package with current error diagnostics as effectively untrusted', async () => {
    const harness = makeTestHarness({
      packages: [
        {
          ...discoveredPackage,
          diagnostics: [
            {
              severity: 'error',
              code: 'built-artifact-missing',
              message: 'Declared built artifact does not exist.',
            },
          ],
        },
      ],
      lifecycle: lifecycleState,
    })

    const view = await Effect.runPromise(
      listExtensionPackagesView({ projectPaths: [PROJECT_PATH] }).pipe(
        Effect.provide(harness.layer),
      ),
    )

    expect(view.packages[0]?.lifecycle).toMatchObject({
      enabled: false,
      trusted: false,
      grantedCapabilities: [],
      contentHash: 'abcdef',
    })
  })
})

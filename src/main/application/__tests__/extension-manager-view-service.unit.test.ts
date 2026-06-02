import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it } from 'vitest'
import type { DiscoveredExtensionPackage, ExtensionLifecycleState } from '../../extensions/types'
import { ExtensionLifecycleRepository } from '../../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../../ports/extension-manager-service'
import { setExtensionEnabled, setExtensionTrusted } from '../extension-lifecycle-service'
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

  it('treats a stale trust pin as untrusted and disabled in the renderer view', async () => {
    const harness = makeTestHarness({
      packages: [{ ...discoveredPackage, contentHash: 'changed-hash' }],
      lifecycle: lifecycleState,
    })

    const view = await Effect.runPromise(
      listExtensionPackagesView(PROJECT_PATH).pipe(Effect.provide(harness.layer)),
    )

    expect(view.packages[0]?.lifecycle).toMatchObject({
      enabled: false,
      trusted: false,
      contentHash: 'abcdef',
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
      listExtensionPackagesView(PROJECT_PATH).pipe(Effect.provide(harness.layer)),
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
      listExtensionPackagesView(PROJECT_PATH).pipe(Effect.provide(harness.layer)),
    )

    expect(view.packages[0]?.lifecycle).toMatchObject({
      enabled: false,
      trusted: false,
      grantedCapabilities: [],
      contentHash: 'abcdef',
    })
  })

  it('trusts a valid extension by pinning the current content hash', async () => {
    const harness = makeTestHarness({
      packages: [discoveredPackage],
      lifecycle: null,
    })

    const view = await Effect.runPromise(
      setExtensionTrusted({
        extensionId: 'sample-extension',
        scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: PROJECT_PATH },
        viewProjectPath: PROJECT_PATH,
        trusted: true,
      }).pipe(Effect.provide(harness.layer)),
    )

    expect(harness.getStoredLifecycle()).toMatchObject({
      extensionId: 'sample-extension',
      enabled: false,
      trusted: true,
      grantedCapabilities: ['sample.invoke'],
      contentHash: 'abcdef',
      sdkCompatible: true,
    })
    expect(view.packages[0]?.lifecycle).toMatchObject({
      enabled: false,
      trusted: true,
    })
  })

  it('does not preserve stale enabled state when trusting an updated package', async () => {
    const updatedPackage = { ...discoveredPackage, contentHash: 'changed-hash' }
    const harness = makeTestHarness({
      packages: [updatedPackage],
      lifecycle: lifecycleState,
    })

    const view = await Effect.runPromise(
      setExtensionTrusted({
        extensionId: 'sample-extension',
        scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: PROJECT_PATH },
        viewProjectPath: PROJECT_PATH,
        trusted: true,
      }).pipe(Effect.provide(harness.layer)),
    )

    expect(harness.getStoredLifecycle()).toMatchObject({
      extensionId: 'sample-extension',
      enabled: false,
      trusted: true,
      contentHash: 'changed-hash',
    })
    expect(view.packages[0]?.lifecycle).toMatchObject({
      enabled: false,
      trusted: true,
      contentHash: 'changed-hash',
    })
  })

  it('rejects enabling an extension before it has a current trust pin', async () => {
    const harness = makeTestHarness({
      packages: [discoveredPackage],
      lifecycle: null,
    })

    await expect(
      Effect.runPromise(
        setExtensionEnabled({
          extensionId: 'sample-extension',
          scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: PROJECT_PATH },
          viewProjectPath: PROJECT_PATH,
          enabled: true,
        }).pipe(Effect.provide(harness.layer)),
      ),
    ).rejects.toThrow('Trust extension "sample-extension" before enabling it.')
  })

  it('enables a trusted extension when the trust pin matches the current content hash', async () => {
    const harness = makeTestHarness({
      packages: [discoveredPackage],
      lifecycle: lifecycleState,
    })

    const view = await Effect.runPromise(
      setExtensionEnabled({
        extensionId: 'sample-extension',
        scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: PROJECT_PATH },
        viewProjectPath: PROJECT_PATH,
        enabled: true,
      }).pipe(Effect.provide(harness.layer)),
    )

    expect(harness.getStoredLifecycle()).toMatchObject({
      extensionId: 'sample-extension',
      enabled: true,
      trusted: true,
      contentHash: 'abcdef',
    })
    expect(view.packages[0]?.lifecycle).toMatchObject({
      enabled: true,
      trusted: true,
    })
  })
})
